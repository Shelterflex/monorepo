import { logger } from '../utils/logger.js'
import { env } from '../schemas/env.js'
import { getScheduler } from '../jobs/scheduler/worker.js'
import { JobStatus } from '../jobs/scheduler/types.js'
import { meter } from '../utils/metrics.js'
import type { NotificationJobPayload, NotificationProvider } from './types.js'
import { NotificationChannel, NotificationStatus } from './types.js'
import { EmailNotificationProvider, ConsoleNotificationProvider, FailoverNotificationProvider } from './providers.js'

/**
 * Notification Service
 * 
 * Manages asynchronous notification delivery via the job scheduler.
 * Supports multiple channels (email, SMS, push) with provider failover.
 */
export class NotificationService {
  private providers = new Map<NotificationChannel, NotificationProvider>()
  private failoverManager: FailoverNotificationProvider | null = null

  constructor() {
    this.initializeProviders()
  }

  private initializeProviders(): void {
    // Email provider with failover
    const emailPrimary = new EmailNotificationProvider()
    const emailFallback = new ConsoleNotificationProvider()
    this.failoverManager = new FailoverNotificationProvider(emailPrimary, emailFallback)
    this.providers.set(NotificationChannel.EMAIL, this.failoverManager)

    // SMS and push providers can be added here when implemented
    // For now, they use console fallback
    this.providers.set(NotificationChannel.SMS, new ConsoleNotificationProvider())
    this.providers.set(NotificationChannel.PUSH, new ConsoleNotificationProvider())
  }

  /**
   * Enqueue a notification for asynchronous delivery
   */
  async enqueue(payload: NotificationJobPayload): Promise<string> {
    const scheduler = getScheduler()
    
    const job = await scheduler.schedule({
      name: `notification_${payload.channel}`,
      handler: 'notification.send',
      payload,
      priority: 5, // Normal priority
      maxRetries: 5, // Allow more retries for notifications
    })

    logger.info('[Notification] Enqueued for delivery', {
      jobId: job.id,
      channel: payload.channel,
      recipient: payload.recipient,
    })

    // Record metrics
    if (process.env.NODE_ENV !== 'test') {
      meter.createCounter('notifications_enqueued_total', {
        description: 'Total notifications enqueued',
      }).add(1, { channel: payload.channel })
    }

    return job.id
  }

  /**
   * Send a notification synchronously (used by job handler)
   */
  async send(payload: NotificationJobPayload): Promise<void> {
    const provider = this.providers.get(payload.channel)
    
    if (!provider) {
      throw new Error(`No provider configured for channel: ${payload.channel}`)
    }

    const startTime = Date.now()
    let success = false

    try {
      await provider.send(payload)
      success = true

      logger.info('[Notification] Delivered successfully', {
        channel: payload.channel,
        recipient: payload.recipient,
        durationMs: Date.now() - startTime,
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      logger.error('[Notification] Delivery failed', {
        channel: payload.channel,
        recipient: payload.recipient,
        error: errorMessage,
        durationMs: Date.now() - startTime,
      })

      // Record failure metrics
      if (process.env.NODE_ENV !== 'test') {
        meter.createCounter('notifications_failed_total', {
          description: 'Total notifications failed',
        }).add(1, { channel: payload.channel })
      }

      throw error
    } finally {
      // Record delivery metrics
      if (process.env.NODE_ENV !== 'test') {
        meter.createHistogram('notification_delivery_duration_ms', {
          description: 'Notification delivery latency in milliseconds',
        }).record(Date.now() - startTime, { channel: payload.channel })

        if (success) {
          meter.createCounter('notifications_delivered_total', {
            description: 'Total notifications delivered successfully',
          }).add(1, { channel: payload.channel })
        }
      }
    }
  }

  /**
   * Get current failover state for email channel
   */
  getFailoverState(): { useSecondary: boolean; failureCount: number } | null {
    return this.failoverManager?.getFailoverState() || null
  }

  /**
   * Reset failover state (admin operation)
   */
  resetFailover(): void {
    this.failoverManager?.resetFailover()
  }
}

// Singleton instance
let notificationService: NotificationService | null = null

export function getNotificationService(): NotificationService {
  if (!notificationService) {
    notificationService = new NotificationService()
  }
  return notificationService
}

export function initNotificationService(service: NotificationService): void {
  notificationService = service
}
