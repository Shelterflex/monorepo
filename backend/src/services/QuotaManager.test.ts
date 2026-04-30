import { describe, it, expect, beforeEach, vi } from 'vitest'
import { QuotaManager, QuotaOverride } from './QuotaManager.js'

// Mock Redis client - vi.hoisted runs before vi.mock factory
const mockRedis = vi.hoisted(() => ({
  get: vi.fn(),
  setex: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(),
  zcard: vi.fn(),
  pttl: vi.fn(),
  pipeline: vi.fn(),
}))

const mockPipeline = {
  zremrangebyscore: vi.fn(),
  zadd: vi.fn(),
  expire: vi.fn(),
  exec: vi.fn(),
}

vi.mock('../utils/redis.js', () => ({
  getRedisClient: () => mockRedis,
}))

vi.mock('../utils/logger.js', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock('../utils/metrics.js', () => ({
  meter: {
    createCounter: vi.fn(() => ({
      add: vi.fn(),
    })),
  },
}))

vi.mock('./QuotaService.js', () => ({
  quotaService: {
    getUserLimits: vi.fn(() => ({
      requestsPerMinute: 60,
      requestsPerDay: 1000,
    })),
  },
}))

describe('QuotaManager', () => {
  let manager: QuotaManager

  beforeEach(() => {
    manager = new QuotaManager()
    vi.clearAllMocks()
    mockRedis.get.mockReset()
    mockRedis.pipeline.mockReturnValue(mockPipeline)
    mockPipeline.exec.mockResolvedValue([])
  })

  describe('getOverride', () => {
    it('should return override from cache', async () => {
      const override: QuotaOverride = {
        userId: 'user123',
        elevatedLimit: 100,
        reason: 'Testing',
        createdBy: 'admin',
        createdAt: Date.now(),
      }

      manager['overrideCache'].set('user123:all', override)

      const result = await manager.getOverride('user123')

      expect(result).toEqual(override)
    })

    it('should return override from Redis', async () => {
      const override: QuotaOverride = {
        userId: 'user123',
        elevatedLimit: 100,
        reason: 'Testing',
        createdBy: 'admin',
        createdAt: Date.now(),
      }

      mockRedis.get.mockResolvedValue(JSON.stringify(override))

      const result = await manager.getOverride('user123')

      expect(result).toEqual(override)
    })

    it('should return null for expired override', async () => {
      const override: QuotaOverride = {
        userId: 'user123',
        elevatedLimit: 100,
        reason: 'Testing',
        createdBy: 'admin',
        createdAt: Date.now(),
        expiresAt: Date.now() - 1000, // Expired
      }

      mockRedis.get.mockResolvedValue(JSON.stringify(override))

      const result = await manager.getOverride('user123')

      expect(result).toBeNull()
    })

    it('should return null when no override exists', async () => {
      mockRedis.get.mockResolvedValue(null)

      const result = await manager.getOverride('user123')

      expect(result).toBeNull()
    })
  })

  describe('setOverride', () => {
    it('should set override in Redis and cache', async () => {
      const override: QuotaOverride = {
        userId: 'user123',
        elevatedLimit: 100,
        reason: 'Testing',
        createdBy: 'admin',
        createdAt: Date.now(),
      }

      mockRedis.setex.mockResolvedValue('OK')

      await manager.setOverride(override)

      expect(mockRedis.setex).toHaveBeenCalledWith(
        'quota:override:user123:all',
        expect.any(Number),
        JSON.stringify(override)
      )
      expect(manager['overrideCache'].get('user123:all')).toEqual(override)
    })

    it('should log admin action', async () => {
      const override: QuotaOverride = {
        userId: 'user123',
        elevatedLimit: 100,
        reason: 'Testing',
        createdBy: 'admin',
        createdAt: Date.now(),
      }

      mockRedis.setex.mockResolvedValue('OK')

      await manager.setOverride(override)

      const { logger } = await import('../utils/logger.js')
      expect(logger.warn).toHaveBeenCalledWith('Quota override created', expect.any(Object))
    })

    it('should record metric', async () => {
      const override: QuotaOverride = {
        userId: 'user123',
        elevatedLimit: 100,
        reason: 'Testing',
        createdBy: 'admin',
        createdAt: Date.now(),
      }

      mockRedis.setex.mockResolvedValue('OK')

      await manager.setOverride(override)

      const { meter } = await import('../utils/metrics.js')
      expect(meter.createCounter).toHaveBeenCalledWith(
        'quota_override_created_total',
        expect.any(Object)
      )
    })
  })

  describe('removeOverride', () => {
    it('should remove override from Redis and cache', async () => {
      mockRedis.del.mockResolvedValue(1)

      await manager.removeOverride('user123', 'api/test')

      expect(mockRedis.del).toHaveBeenCalledWith('quota:override:user123:api/test')
    })

    it('should log removal action', async () => {
      mockRedis.del.mockResolvedValue(1)

      await manager.removeOverride('user123')

      const { logger } = await import('../utils/logger.js')
      expect(logger.info).toHaveBeenCalledWith('Quota override removed', expect.any(Object))
    })
  })

  describe('getQuotaUsage', () => {
    it('should return quota usage for user', async () => {
      mockRedis.zcard.mockResolvedValueOnce(5).mockResolvedValueOnce(50)
      mockRedis.pttl.mockResolvedValueOnce(30000).mockResolvedValueOnce(86400000)

      const usage = await manager.getQuotaUsage('user123', 'api/test')

      expect(usage.userId).toBe('user123')
      expect(usage.endpoint).toBe('api/test')
      expect(usage.minuteUsage).toBe(5)
      expect(usage.dayUsage).toBe(50)
      expect(usage.nearLimit).toBe(false)
    })

    it('should mark as near limit when usage exceeds 80%', async () => {
      mockRedis.zcard.mockResolvedValueOnce(55).mockResolvedValueOnce(50)
      mockRedis.pttl.mockResolvedValueOnce(30000).mockResolvedValueOnce(86400000)

      const usage = await manager.getQuotaUsage('user123', 'api/test')

      expect(usage.nearLimit).toBe(true)
    })

    it('should apply elevated limit from override', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          userId: 'user123',
          elevatedLimit: 200,
          reason: 'Testing',
          createdBy: 'admin',
          createdAt: Date.now(),
        })
      )
      mockRedis.zcard.mockResolvedValueOnce(5).mockResolvedValueOnce(50)
      mockRedis.pttl.mockResolvedValueOnce(30000).mockResolvedValueOnce(86400000)

      const usage = await manager.getQuotaUsage('user123', 'api/test')

      expect(usage.minuteLimit).toBe(200)
    })

    it('should record near-limit metric', async () => {
      mockRedis.zcard.mockResolvedValueOnce(55).mockResolvedValueOnce(50)
      mockRedis.pttl.mockResolvedValueOnce(30000).mockResolvedValueOnce(86400000)

      const usage = await manager.getQuotaUsage('user123', 'api/test')

      expect(usage.nearLimit).toBe(true)
    })
  })

  describe('trackUsage', () => {
    it('should track usage in both minute and day windows', async () => {
      await manager.trackUsage('user123', 'api/test')

      expect(mockRedis.pipeline).toHaveBeenCalled()
      expect(mockPipeline.zremrangebyscore).toHaveBeenCalledTimes(2)
      expect(mockPipeline.zadd).toHaveBeenCalledTimes(2)
      expect(mockPipeline.expire).toHaveBeenCalledTimes(2)
      expect(mockPipeline.exec).toHaveBeenCalled()
    })

    it('should not throw on Redis error', async () => {
      mockRedis.pipeline.mockImplementation(() => {
        throw new Error('Redis error')
      })

      await expect(manager.trackUsage('user123', 'api/test')).resolves.not.toThrow()
    })
  })

  describe('getUserOverrides', () => {
    it('should return all overrides for a user', async () => {
      const override1: QuotaOverride = {
        userId: 'user123',
        endpoint: 'api/test',
        elevatedLimit: 100,
        reason: 'Testing',
        createdBy: 'admin',
        createdAt: Date.now(),
      }

      const override2: QuotaOverride = {
        userId: 'user123',
        endpoint: 'api/other',
        elevatedLimit: 200,
        reason: 'Testing',
        createdBy: 'admin',
        createdAt: Date.now(),
      }

      mockRedis.keys.mockResolvedValue([
        'quota:override:user123:api/test',
        'quota:override:user123:api/other',
      ])
      mockRedis.get.mockImplementation((key) => {
        if (key.includes('api/test')) return JSON.stringify(override1)
        if (key.includes('api/other')) return JSON.stringify(override2)
        return null
      })

      const overrides = await manager.getUserOverrides('user123')

      expect(overrides).toHaveLength(2)
    })

    it('should filter out expired overrides', async () => {
      const expiredOverride: QuotaOverride = {
        userId: 'user123',
        elevatedLimit: 100,
        reason: 'Testing',
        createdBy: 'admin',
        createdAt: Date.now(),
        expiresAt: Date.now() - 1000,
      }

      mockRedis.keys.mockResolvedValue(['quota:override:user123:api/test'])
      mockRedis.get.mockResolvedValue(JSON.stringify(expiredOverride))

      const overrides = await manager.getUserOverrides('user123')

      expect(overrides).toHaveLength(0)
    })
  })

  describe('getQuotaStats', () => {
    it('should return quota statistics', async () => {
      mockRedis.keys.mockResolvedValue([
        'quota:override:user1:api/test',
        'quota:override:user2:api/test',
      ])
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          userId: 'user1',
          elevatedLimit: 100,
          reason: 'Testing',
          createdBy: 'admin',
          createdAt: Date.now(),
        })
      )

      const stats = await manager.getQuotaStats()

      expect(stats.totalOverrides).toBe(2)
      expect(stats.activeOverrides).toBe(2)
    })

    it('should handle Redis errors gracefully', async () => {
      mockRedis.keys.mockRejectedValue(new Error('Redis error'))

      const stats = await manager.getQuotaStats()

      expect(stats.totalOverrides).toBe(0)
      expect(stats.activeOverrides).toBe(0)
    })
  })
})
