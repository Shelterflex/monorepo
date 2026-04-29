import { logger } from '../utils/logger.js'
import { auditLog, type AuditContext, type AuditEventType } from '../utils/auditLogger.js'
import { getScheduler } from '../jobs/scheduler/worker.js'
import { getWebhookReplayStore } from './store.js'
import {
  ReplayStatus,
  ActorType,
  type WebhookEvent,
  type WebhookReplayAttempt,
  type ReplayRequest,
  type ReplayPreview,
} from './types.js'

/**
 * Webhook Replay Service
 * 
 * Provides secure webhook replay functionality with audit logging,
 * idempotency checks, and dry-run support.
 */
export class WebhookReplayService {
  constructor(private readonly store = getWebhookReplayStore()) {}

  /**
   * Preview which events would be replayed based on the request
   */
  async previewReplay(request: ReplayRequest): Promise<ReplayPreview> {
    return await this.store.getReplayPreview(request)
  }

  /**
   * Execute a webhook replay
   */
  async executeReplay(
    request: ReplayRequest,
    context: AuditContext
  ): Promise<WebhookReplayAttempt> {
    // Get events to replay
    const preview = await this.previewReplay(request)
    
    if (preview.totalEvents === 0) {
      throw new Error('No events found matching the replay criteria')
    }

    // Create replay attempt record
    const attempt = await this.store.createReplayAttempt({
      webhookEventId: preview.events[0].id, // Primary event for single-event replay
      actorUserId: context.userId,
      actorType: context.actorType as ActorType,
      reason: request.reason,
      dryRun: request.dryRun,
      status: 'pending' as ReplayStatus,
    })

    // Audit log the replay attempt
    auditLog('WEBHOOK_REPLAY_INITIATED' as any, context, {
      replayAttemptId: attempt.id,
      eventCount: preview.totalEvents,
      dryRun: request.dryRun,
      provider: request.provider,
      eventType: request.eventType,
    })

    try {
      if (request.dryRun) {
        // Dry run - just validate and return
        await this.store.updateReplayAttempt(attempt.id, ReplayStatus.SUCCESS, {
          message: 'Dry run completed successfully',
          eventsPreviewed: preview.totalEvents,
        })

        logger.info('[WebhookReplay] Dry run completed', {
          replayAttemptId: attempt.id,
          eventCount: preview.totalEvents,
        })
      } else {
        // Actual replay - schedule jobs for each event
        for (const event of preview.events) {
          await this.scheduleReplayJob(event, attempt.id, context)
        }

        await this.store.updateReplayAttempt(attempt.id, ReplayStatus.SUCCESS, {
          message: 'Replay jobs scheduled successfully',
          eventsScheduled: preview.totalEvents,
        })

        logger.info('[WebhookReplay] Replay jobs scheduled', {
          replayAttemptId: attempt.id,
          eventCount: preview.totalEvents,
        })
      }

      // Get updated attempt
      const attempts = await this.store.listReplayAttempts(undefined, undefined)
      const updatedAttempt = attempts.find(a => a.id === attempt.id)!

      // Audit log success
      auditLog('WEBHOOK_REPLAY_COMPLETED' as any, context, {
        replayAttemptId: attempt.id,
        success: true,
      })

      return updatedAttempt
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      await this.store.updateReplayAttempt(attempt.id, ReplayStatus.FAILED, undefined, errorMessage)

      // Audit log failure
      auditLog('WEBHOOK_REPLAY_FAILED' as any, context, {
        replayAttemptId: attempt.id,
        error: errorMessage,
      })

      logger.error('[WebhookReplay] Replay failed', {
        replayAttemptId: attempt.id,
        error: errorMessage,
      })

      throw error
    }
  }

  /**
   * Get replay history for an event or actor
   */
  async getReplayHistory(webhookEventId?: string, actorUserId?: string): Promise<WebhookReplayAttempt[]> {
    return await this.store.listReplayAttempts(webhookEventId, actorUserId)
  }

  /**
   * Get a specific webhook event
   */
  async getWebhookEvent(id: string): Promise<WebhookEvent | null> {
    return await this.store.getEventById(id)
  }

  /**
   * Schedule a replay job for a webhook event
   */
  private async scheduleReplayJob(
    event: WebhookEvent,
    replayAttemptId: string,
    context: AuditContext
  ): Promise<void> {
    const scheduler = getScheduler()

    await scheduler.schedule({
      name: `webhook_replay_${event.provider}`,
      handler: 'webhook.replay',
      payload: {
        webhookEventId: event.id,
        replayAttemptId,
        provider: event.provider,
        eventType: event.eventType,
        payload: event.payload,
        headers: event.headers,
        actorUserId: context.userId,
      },
      priority: 10, // High priority for replays
      maxRetries: 3,
    })

    logger.info('[WebhookReplay] Replay job scheduled', {
      webhookEventId: event.id,
      replayAttemptId,
      provider: event.provider,
    })
  }

  /**
   * Helper to update and return the updated attempt
   */
  private async updateReplayAttemptStatus(id: string, status: ReplayStatus): Promise<WebhookReplayAttempt> {
    const attempts = await this.store.listReplayAttempts(undefined, undefined)
    return attempts.find(a => a.id === id)!
  }
}

// Singleton instance
let webhookReplayService: WebhookReplayService | null = null

export function getWebhookReplayService(): WebhookReplayService {
  if (!webhookReplayService) {
    webhookReplayService = new WebhookReplayService()
  }
  return webhookReplayService
}

export function initWebhookReplayService(service: WebhookReplayService): void {
  webhookReplayService = service
}
