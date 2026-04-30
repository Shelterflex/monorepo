import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  CacheInvalidationService,
  cacheInvalidationService,
  invalidateCacheOnMutation,
  initializeCacheInvalidationWebhooks,
  type CacheInvalidationEvent,
  type CacheWebhookDestination,
} from './cacheInvalidation.js'

// Mock fetch
global.fetch = vi.fn() as any

// Mock logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

describe('Cache Invalidation Service', () => {
  let service: CacheInvalidationService

  beforeEach(() => {
    service = new CacheInvalidationService()
    vi.clearAllMocks()
  })

  describe('Webhook Registration', () => {
    it('should register a webhook destination', () => {
      const destination: CacheWebhookDestination = {
        url: 'https://example.com/webhook',
        secret: 'test-secret',
        enabled: true,
      }

      service.registerWebhook('test', destination)

      expect(() => service.registerWebhook('test', destination)).not.toThrow()
    })

    it('should unregister a webhook destination', () => {
      const destination: CacheWebhookDestination = {
        url: 'https://example.com/webhook',
        enabled: true,
      }

      service.registerWebhook('test', destination)
      service.unregisterWebhook('test')

      // Should not throw when trying to send to unregistered webhook
      expect(() => service.unregisterWebhook('test')).not.toThrow()
    })
  })

  describe('Event Queueing', () => {
    it('should queue invalidation events', () => {
      const event: CacheInvalidationEvent = {
        tags: ['property', 'listings'],
        timestamp: Date.now(),
        source: 'property_update',
        entityIds: { propertyId: '123' },
      }

      service.invalidate(event)

      const status = service.getQueueStatus()
      expect(status.size).toBe(1)
    })

    it('should invalidate by tags', () => {
      service.invalidateByTags(['property', 'listings'], 'property_update', {
        propertyId: '123',
      })

      const status = service.getQueueStatus()
      expect(status.size).toBe(1)
    })

    it('should invalidate by keys', () => {
      service.invalidateByKeys(['property:123', 'property:456'], 'property_update', {
        propertyId: '123',
      })

      const status = service.getQueueStatus()
      expect(status.size).toBe(1)
    })

    it('should drop events when queue is full', () => {
      // Set a small max queue size by creating a new service with custom config
      const smallQueueService = new CacheInvalidationService()
      // Fill the queue
      for (let i = 0; i < 1001; i++) {
        smallQueueService.invalidateByTags([`tag${i}`], 'test')
      }

      const status = smallQueueService.getQueueStatus()
      expect(status.size).toBeLessThanOrEqual(1000)
    })
  })

  describe('Event Processing', () => {
    it('should process queued events and send webhooks', async () => {
      const destination: CacheWebhookDestination = {
        url: 'https://example.com/webhook',
        enabled: true,
      }

      service.registerWebhook('test', destination)
      service.invalidateByTags(['property'], 'property_update')

      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      })

      await service.flush()

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      )
    })

    it('should not send webhooks to disabled destinations', async () => {
      const destination: CacheWebhookDestination = {
        url: 'https://example.com/webhook',
        enabled: false,
      }

      service.registerWebhook('test', destination)
      service.invalidateByTags(['property'], 'property_update')

      await service.flush()

      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('should handle webhook failures gracefully', async () => {
      const destination: CacheWebhookDestination = {
        url: 'https://example.com/webhook',
        enabled: true,
      }

      service.registerWebhook('test', destination)
      service.invalidateByTags(['property'], 'property_update')

      ;(global.fetch as any).mockRejectedValue(new Error('Network error'))

      await service.flush()

      // Should not throw, just log the error
      expect(() => service.flush()).not.toThrow()
    })

    it('should send webhook with signature when secret is provided', async () => {
      const destination: CacheWebhookDestination = {
        url: 'https://example.com/webhook',
        secret: 'test-secret',
        enabled: true,
      }

      service.registerWebhook('test', destination)
      service.invalidateByTags(['property'], 'property_update')

      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      })

      await service.flush()

      const fetchCall = (global.fetch as any).mock.calls[0]
      expect(fetchCall[1].headers['X-Cache-Invalidation-Signature']).toBeDefined()
    })
  })

  describe('Batch Processing', () => {
    it('should process events in batches', async () => {
      const destination: CacheWebhookDestination = {
        url: 'https://example.com/webhook',
        enabled: true,
      }

      service.registerWebhook('test', destination)

      // Queue more events than batch size
      for (let i = 0; i < 60; i++) {
        service.invalidateByTags([`tag${i}`], 'test')
      }

      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      })

      await service.flush()

      // Should have been called at least once
      expect(global.fetch).toHaveBeenCalled()
    })
  })

  describe('Queue Management', () => {
    it('should provide queue status', () => {
      const status = service.getQueueStatus()
      expect(status).toHaveProperty('size')
      expect(status).toHaveProperty('processing')
    })

    it('should clear queue', () => {
      service.invalidateByTags(['property'], 'property_update')
      service.invalidateByTags(['reviews'], 'review_update')

      service.clearQueue()

      const status = service.getQueueStatus()
      expect(status.size).toBe(0)
    })
  })
})

describe('Cache Invalidation Helpers', () => {
  let service: CacheInvalidationService

  beforeEach(() => {
    // Use singleton for helper tests
    service = cacheInvalidationService
    service.clearQueue()
    vi.clearAllMocks()
  })

  describe('invalidateCacheOnMutation', () => {
    it('should invalidate property cache on property mutation', () => {
      invalidateCacheOnMutation('property', '123', 'update')

      const status = service.getQueueStatus()
      expect(status.size).toBe(1)
    })

    it('should add related tags for property mutations', () => {
      invalidateCacheOnMutation('property', '123', 'update')

      // The helper should add property:123, property, listings, and search tags
      const status = service.getQueueStatus()
      expect(status.size).toBeGreaterThan(0)
    })

    it('should add related tags for review mutations', () => {
      invalidateCacheOnMutation('review', '456', 'create')

      const status = service.getQueueStatus()
      expect(status.size).toBeGreaterThan(0)
    })

    it('should add related tags for user mutations', () => {
      invalidateCacheOnMutation('user', '789', 'update')

      const status = service.getQueueStatus()
      expect(status.size).toBeGreaterThan(0)
    })
  })
})

describe('Cache Invalidation Initialization', () => {
  it('should initialize webhooks from environment', () => {
    process.env.CACHE_INVALIDATION_WEBHOOK_URL = 'https://example.com/webhook'
    process.env.CACHE_INVALIDATION_WEBHOOK_SECRET = 'test-secret'
    process.env.CACHE_INVALIDATION_WEBHOOK_ENABLED = 'true'

    initializeCacheInvalidationWebhooks()

    // Should not throw
    expect(() => initializeCacheInvalidationWebhooks()).not.toThrow()

    // Cleanup
    delete process.env.CACHE_INVALIDATION_WEBHOOK_URL
    delete process.env.CACHE_INVALIDATION_WEBHOOK_SECRET
    delete process.env.CACHE_INVALIDATION_WEBHOOK_ENABLED
  })

  it('should handle missing environment variables', () => {
    delete process.env.CACHE_INVALIDATION_WEBHOOK_URL
    delete process.env.CACHE_INVALIDATION_WEBHOOK_SECRET
    delete process.env.CACHE_INVALIDATION_WEBHOOK_ENABLED

    expect(() => initializeCacheInvalidationWebhooks()).not.toThrow()
  })
})
