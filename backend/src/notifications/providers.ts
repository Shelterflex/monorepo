import { Resend } from 'resend'
import { logger } from '../utils/logger.js'
import { env } from '../schemas/env.js'
import type { NotificationJobPayload, NotificationProvider, NotificationDeliveryResult } from './types.js'
import { NotificationChannel } from './types.js'

/**
 * Email Notification Provider using Resend
 */
export class EmailNotificationProvider implements NotificationProvider {
  channel = NotificationChannel.EMAIL
  private resend: Resend | null = null
  private readonly providerName = 'resend'

  constructor() {
    if (env.RESEND_API_KEY) {
      this.resend = new Resend(env.RESEND_API_KEY)
    } else {
      logger.warn('[Notification] RESEND_API_KEY not configured, email provider disabled')
    }
  }

  async send(payload: NotificationJobPayload): Promise<void> {
    if (!this.resend) {
      logger.warn('[Notification] Email provider not configured, skipping send', {
        recipient: payload.recipient,
        subject: payload.subject,
      })
      return
    }

    const fromEmail = env.RESEND_FROM_EMAIL
    if (!fromEmail) {
      throw new Error('RESEND_FROM_EMAIL is not configured')
    }

    logger.info('[Notification] Sending email', {
      recipient: payload.recipient,
      subject: payload.subject,
      provider: this.providerName,
    })

    const result = await this.resend.emails.send({
      from: fromEmail,
      to: payload.recipient,
      subject: payload.subject || 'Notification',
      html: payload.html || payload.body,
    })

    if (result.error) {
      throw new Error(`Resend provider error: ${result.error.message}`)
    }
  }
}

/**
 * Console Notification Provider (fallback for development/testing)
 */
export class ConsoleNotificationProvider implements NotificationProvider {
  channel = NotificationChannel.EMAIL
  private readonly providerName = 'console'

  async send(payload: NotificationJobPayload): Promise<void> {
    if (env.NODE_ENV === 'production') {
      logger.warn('[Notification] Console provider used in production', {
        recipient: payload.recipient,
      })
      throw new Error('ConsoleNotificationProvider should not be used in production')
    }

    logger.info('[Notification] Console provider', {
      recipient: payload.recipient,
      subject: payload.subject,
      body: payload.body,
    })

    console.log('\n' + '='.repeat(60))
    console.log('📧 Notification (Dev Mode)')
    console.log('='.repeat(60))
    console.log(`To: ${payload.recipient}`)
    console.log(`Subject: ${payload.subject || 'Notification'}`)
    console.log(`\n${payload.body}`)
    console.log('='.repeat(60) + '\n')
  }
}

/**
 * Provider with failover support
 * Attempts primary provider, falls back to secondary on failure
 */
export class FailoverNotificationProvider implements NotificationProvider {
  channel: NotificationChannel
  private primary: NotificationProvider
  private secondary: NotificationProvider
  private failureCount = 0
  private readonly failoverThreshold = 3
  private useSecondary = false

  constructor(primary: NotificationProvider, secondary: NotificationProvider) {
    this.channel = primary.channel
    this.primary = primary
    this.secondary = secondary
  }

  async send(payload: NotificationJobPayload): Promise<void> {
    const provider = this.useSecondary ? this.secondary : this.primary

    try {
      await provider.send(payload)
      
      // Reset failure count on success
      if (!this.useSecondary) {
        this.failureCount = 0
      }
      
      logger.info('[Notification] Sent successfully', {
        channel: this.channel,
        provider: this.useSecondary ? 'secondary' : 'primary',
        recipient: payload.recipient,
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      if (!this.useSecondary) {
        this.failureCount++
        logger.error('[Notification] Primary provider failed', {
          channel: this.channel,
          failureCount: this.failureCount,
          threshold: this.failoverThreshold,
          error: errorMessage,
        })

        // Switch to secondary if threshold exceeded
        if (this.failureCount >= this.failoverThreshold) {
          this.useSecondary = true
          logger.warn('[Notification] Switching to secondary provider', {
            channel: this.channel,
            failureCount: this.failureCount,
          })
        }
      }

      // Try secondary if we're in failover mode
      if (this.useSecondary) {
        try {
          await this.secondary.send(payload)
          logger.info('[Notification] Sent via secondary provider', {
            channel: this.channel,
            recipient: payload.recipient,
          })
        } catch (secondaryError) {
          const secondaryErrorMessage = secondaryError instanceof Error ? secondaryError.message : String(secondaryError)
          logger.error('[Notification] Secondary provider also failed', {
            channel: this.channel,
            error: secondaryErrorMessage,
          })
          throw new Error(`Both providers failed: primary=${errorMessage}, secondary=${secondaryErrorMessage}`)
        }
      } else {
        throw error
      }
    }
  }

  /**
   * Reset failover state (call when primary provider is known to be healthy)
   */
  resetFailover(): void {
    this.useSecondary = false
    this.failureCount = 0
    logger.info('[Notification] Failover state reset', {
      channel: this.channel,
    })
  }

  /**
   * Get current failover state
   */
  getFailoverState(): { useSecondary: boolean; failureCount: number } {
    return {
      useSecondary: this.useSecondary,
      failureCount: this.failureCount,
    }
  }
}
