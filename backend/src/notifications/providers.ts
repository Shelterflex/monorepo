import { Resend } from 'resend'
import { logger } from '../utils/logger.js'
import { env } from '../schemas/env.js'
import { meter } from '../utils/metrics.js'
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
      logger.error('[Notification] Email provider not configured (RESEND_API_KEY missing), cannot send email', {
        recipient: payload.recipient,
        subject: payload.subject,
      })
      if (process.env.NODE_ENV !== 'test') {
        meter.createCounter('notifications_skipped_unconfigured_total', {
          description: 'Total notifications skipped due to missing provider configuration',
        }).add(1, { channel: this.channel })
      }
      throw new Error('Email notification provider not configured (RESEND_API_KEY missing)')
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
 * Mask values that must never reach logs or a terminal: one-time codes, tokens,
 * JWTs and credential-like query parameters.
 */
export function maskSensitiveValues(text: string): string {
  return text
    .replace(/\b(token|code|otp|secret|key|signature)=([^&\s]+)/gi, '$1=[REDACTED]')
    .replace(/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[REDACTED]')
    .replace(/\b\d{4,10}\b/g, '[REDACTED]')
}

/**
 * Dev-mode notification output is opt-in: set NOTIFICATION_DEV_PRINT=true (and
 * LOG_LEVEL=debug to see it). It is never available in production.
 */
export function isDevNotificationPrintEnabled(): boolean {
  return env.NODE_ENV !== 'production' && process.env.NOTIFICATION_DEV_PRINT === 'true'
}

/**
 * Console Notification Provider (fallback for development/testing)
 *
 * Does not deliver anything. By default it only records that a notification was
 * skipped (recipient and subject, never the body). With NOTIFICATION_DEV_PRINT=true
 * the body is also logged at debug level with one-time codes and tokens masked.
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

    // Never log the body at info level: it can contain one-time codes or personal data.
    logger.info('[Notification] Console provider', {
      recipient: payload.recipient,
      subject: payload.subject,
    })

    if (isDevNotificationPrintEnabled()) {
      logger.debug('[Notification] Console provider body (dev mode)', {
        recipient: payload.recipient,
        subject: payload.subject || 'Notification',
        body: maskSensitiveValues(payload.body ?? ''),
      })
    }
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
