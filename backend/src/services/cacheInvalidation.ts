import { logger } from '../utils/logger.js'
import { recordCacheInvalidation } from '../middleware/cacheControl.js'

/**
 * Cache invalidation event
 */
export interface CacheInvalidationEvent {
  /** Tags to invalidate */
  tags: string[]
  /** Specific cache keys to invalidate (optional) */
  keys?: string[]
  /** Timestamp of the invalidation */
  timestamp: number
  /** Source of the invalidation (e.g., 'property_update', 'review_create') */
  source: string
  /** Related entity IDs */
  entityIds?: Record<string, string>
}

/**
 * Webhook destination for cache invalidation
 */
export interface CacheWebhookDestination {
  /** URL to send webhook to */
  url: string
  /** Secret for signature verification */
  secret?: string
  /** Whether this destination is enabled */
  enabled: boolean
}

/**
 * Cache invalidation webhook payload
 */
interface CacheInvalidationWebhookPayload {
  version: string
  timestamp: number
  events: CacheInvalidationEvent[]
  signature?: string
}

/**
 * Cache invalidation service
 */
export class CacheInvalidationService {
  private webhookDestinations: Map<string, CacheWebhookDestination> = new Map()
  private eventQueue: CacheInvalidationEvent[] = []
  private processing = false
  private maxQueueSize = 1000
  private batchSize = 50
  private flushIntervalMs = 5000 // 5 seconds

  constructor() {
    this.startFlushInterval()
  }

  /**
   * Register a webhook destination
   */
  registerWebhook(id: string, destination: CacheWebhookDestination): void {
    this.webhookDestinations.set(id, destination)
    logger.info('Cache invalidation webhook registered', { id, url: destination.url })
  }

  /**
   * Unregister a webhook destination
   */
  unregisterWebhook(id: string): void {
    this.webhookDestinations.delete(id)
    logger.info('Cache invalidation webhook unregistered', { id })
  }

  /**
   * Queue a cache invalidation event
   */
  invalidate(event: CacheInvalidationEvent): void {
    if (this.eventQueue.length >= this.maxQueueSize) {
      logger.warn('Cache invalidation queue full, dropping event', { event })
      return
    }

    this.eventQueue.push(event)
    recordCacheInvalidation(event.tags)

    logger.debug('Cache invalidation event queued', {
      tags: event.tags,
      source: event.source,
      queueSize: this.eventQueue.length,
    })
  }

  /**
   * Invalidate by tags
   */
  invalidateByTags(
    tags: string[],
    source: string,
    entityIds?: Record<string, string>
  ): void {
    this.invalidate({
      tags,
      timestamp: Date.now(),
      source,
      entityIds,
    })
  }

  /**
   * Invalidate by specific keys
   */
  invalidateByKeys(
    keys: string[],
    source: string,
    entityIds?: Record<string, string>
  ): void {
    this.invalidate({
      tags: [],
      keys,
      timestamp: Date.now(),
      source,
      entityIds,
    })
  }

  /**
   * Process queued invalidation events
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.eventQueue.length === 0) {
      return
    }

    this.processing = true

    try {
      // Take a batch of events
      const batch = this.eventQueue.splice(0, this.batchSize)

      logger.info('Processing cache invalidation batch', {
        batchSize: batch.length,
        remaining: this.eventQueue.length,
      })

      // Send to all enabled webhook destinations
      const promises = Array.from(this.webhookDestinations.entries())
        .filter(([_, dest]) => dest.enabled)
        .map(([id, dest]) => this.sendWebhook(id, dest, batch))

      await Promise.allSettled(promises)
    } catch (error) {
      logger.error('Error processing cache invalidation queue', { error })
    } finally {
      this.processing = false
    }
  }

  /**
   * Send webhook to a destination
   */
  private async sendWebhook(
    id: string,
    destination: CacheWebhookDestination,
    events: CacheInvalidationEvent[]
  ): Promise<void> {
    try {
      const payload: CacheInvalidationWebhookPayload = {
        version: '1.0',
        timestamp: Date.now(),
        events,
      }

      // Add signature if secret is provided
      if (destination.secret) {
        payload.signature = this.generateSignature(payload, destination.secret)
      }

      const response = await fetch(destination.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cache-Invalidation-Version': '1.0',
          ...(destination.secret && {
            'X-Cache-Invalidation-Signature': payload.signature,
          }),
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}`)
      }

      logger.info('Cache invalidation webhook sent successfully', {
        id,
        url: destination.url,
        eventCount: events.length,
      })
    } catch (error) {
      logger.error('Failed to send cache invalidation webhook', {
        id,
        url: destination.url,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Generate signature for webhook payload
   */
  private generateSignature(
    payload: Omit<CacheInvalidationWebhookPayload, 'signature'>,
    secret: string
  ): string {
    const crypto = require('crypto')
    const payloadString = JSON.stringify(payload)
    return crypto.createHmac('sha256', secret).update(payloadString).digest('hex')
  }

  /**
   * Start periodic flush interval
   */
  private startFlushInterval(): void {
    setInterval(() => {
      this.processQueue()
    }, this.flushIntervalMs)
  }

  /**
   * Flush queue immediately
   */
  async flush(): Promise<void> {
    await this.processQueue()
  }

  /**
   * Get queue status
   */
  getQueueStatus(): { size: number; processing: boolean } {
    return {
      size: this.eventQueue.length,
      processing: this.processing,
    }
  }

  /**
   * Clear queue (for testing/emergency)
   */
  clearQueue(): void {
    this.eventQueue = []
    logger.warn('Cache invalidation queue cleared')
  }
}

// Singleton instance
export const cacheInvalidationService = new CacheInvalidationService()

/**
 * Initialize default webhook destinations from environment
 */
export function initializeCacheInvalidationWebhooks(): void {
  const {
    CACHE_INVALIDATION_WEBHOOK_URL,
    CACHE_INVALIDATION_WEBHOOK_SECRET,
    CACHE_INVALIDATION_WEBHOOK_ENABLED,
  } = process.env

  if (CACHE_INVALIDATION_WEBHOOK_URL) {
    cacheInvalidationService.registerWebhook('default', {
      url: CACHE_INVALIDATION_WEBHOOK_URL,
      secret: CACHE_INVALIDATION_WEBHOOK_SECRET,
      enabled: CACHE_INVALIDATION_WEBHOOK_ENABLED === 'true',
    })
  }

  logger.info('Cache invalidation webhooks initialized', {
    hasDefaultWebhook: !!CACHE_INVALIDATION_WEBHOOK_URL,
    enabled: CACHE_INVALIDATION_WEBHOOK_ENABLED === 'true',
  })
}

/**
 * Helper function to invalidate cache when data changes
 */
export function invalidateCacheOnMutation(
  entityType: string,
  entityId: string,
  operation: 'create' | 'update' | 'delete'
): void {
  const tags = [`${entityType}:${entityId}`, entityType]

  // Add related entity tags
  if (entityType === 'property') {
    tags.push('listings', 'search')
  } else if (entityType === 'review') {
    tags.push('reviews', `property:${entityId}`)
  } else if (entityType === 'user') {
    tags.push('users', 'profiles')
  }

  cacheInvalidationService.invalidateByTags(tags, `${entityType}_${operation}`, {
    [`${entityType}Id`]: entityId,
  })
}
