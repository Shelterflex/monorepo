import { describe, it, expect, beforeEach, vi } from 'vitest'
import { BurstRateLimiter, BurstRateLimitConfig } from './BurstRateLimiter.js'

// Mock Redis client - vi.hoisted runs before vi.mock factory
const mockRedis = vi.hoisted(() => ({
  eval: vi.fn(),
  zcard: vi.fn(),
  pttl: vi.fn(),
  del: vi.fn(),
}))

vi.mock('../utils/redis.js', () => ({
  getRedisClient: () => mockRedis,
}))

vi.mock('../utils/logger.js', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('../utils/metrics.js', () => ({
  meter: {
    createCounter: vi.fn(() => ({
      add: vi.fn(),
    })),
  },
}))

describe('BurstRateLimiter', () => {
  let limiter: BurstRateLimiter

  beforeEach(() => {
    limiter = new BurstRateLimiter()
    vi.clearAllMocks()
  })

  describe('checkLimit', () => {
    it('should allow request within main quota', async () => {
      mockRedis.eval.mockResolvedValue([1, 9, 10, Date.now() + 60000, 5, 5, 0])

      const config: BurstRateLimitConfig = {
        limit: 10,
        windowMs: 60000,
        burstLimit: 5,
        burstWindowMs: 10000,
      }

      const result = await limiter.checkLimit('test-key', config)

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(9)
      expect(result.total).toBe(10)
      expect(result.usingBurst).toBe(false)
    })

    it('should allow request using burst allowance', async () => {
      mockRedis.eval.mockResolvedValue([1, 0, 10, Date.now() + 60000, 4, 5, 1])

      const config: BurstRateLimitConfig = {
        limit: 10,
        windowMs: 60000,
        burstLimit: 5,
        burstWindowMs: 10000,
      }

      const result = await limiter.checkLimit('test-key', config)

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(0)
      expect(result.usingBurst).toBe(true)
      expect(result.burstRemaining).toBe(4)
    })

    it('should deny request when both main quota and burst are exhausted', async () => {
      mockRedis.eval.mockResolvedValue([0, 0, 10, Date.now() + 60000, 0, 5, 1])

      const config: BurstRateLimitConfig = {
        limit: 10,
        windowMs: 60000,
        burstLimit: 5,
        burstWindowMs: 10000,
      }

      const result = await limiter.checkLimit('test-key', config)

      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
      expect(result.burstRemaining).toBe(0)
    })

    it('should allow request on Redis error', async () => {
      mockRedis.eval.mockRejectedValue(new Error('Redis connection error'))

      const config: BurstRateLimitConfig = {
        limit: 10,
        windowMs: 60000,
        burstLimit: 5,
        burstWindowMs: 10000,
      }

      const result = await limiter.checkLimit('test-key', config)

      expect(result.allowed).toBe(true) // Fail open
      expect(result.remaining).toBe(10)
    })

    it('should record metrics for allowed requests', async () => {
      mockRedis.eval.mockResolvedValue([1, 9, 10, Date.now() + 60000, 5, 5, 0])

      const config: BurstRateLimitConfig = {
        limit: 10,
        windowMs: 60000,
        burstLimit: 5,
        burstWindowMs: 10000,
      }

      await limiter.checkLimit('test-key', config)

      const { meter } = await import('../utils/metrics.js')
      expect(meter.createCounter).toHaveBeenCalledWith(
        'rate_limit_allowed_total',
        expect.any(Object)
      )
    })

    it('should record metrics for denied requests', async () => {
      mockRedis.eval.mockResolvedValue([0, 0, 10, Date.now() + 60000, 0, 5, 1])

      const config: BurstRateLimitConfig = {
        limit: 10,
        windowMs: 60000,
        burstLimit: 5,
        burstWindowMs: 10000,
      }

      await limiter.checkLimit('test-key', config)

      const { meter } = await import('../utils/metrics.js')
      expect(meter.createCounter).toHaveBeenCalledWith(
        'rate_limit_denied_total',
        expect.any(Object)
      )
    })
  })

  describe('getQuotaState', () => {
    it('should return current quota state', async () => {
      mockRedis.zcard.mockResolvedValueOnce(5).mockResolvedValueOnce(3)
      mockRedis.pttl.mockResolvedValueOnce(30000).mockResolvedValueOnce(15000)

      const state = await limiter.getQuotaState('test-key')

      expect(state.mainCount).toBe(5)
      expect(state.burstCount).toBe(3)
      expect(state.mainReset).toBeGreaterThan(Date.now())
      expect(state.burstReset).toBeGreaterThan(Date.now())
    })

    it('should handle Redis errors gracefully', async () => {
      mockRedis.zcard.mockRejectedValue(new Error('Redis error'))

      const state = await limiter.getQuotaState('test-key')

      expect(state.mainCount).toBe(0)
      expect(state.burstCount).toBe(0)
    })
  })

  describe('resetQuota', () => {
    it('should reset quota for a key', async () => {
      mockRedis.del.mockResolvedValue(1)

      await limiter.resetQuota('test-key')

      expect(mockRedis.del).toHaveBeenCalledWith('test-key:main', 'test-key:burst')
    })

    it('should throw error on Redis failure', async () => {
      mockRedis.del.mockRejectedValue(new Error('Redis error'))

      await expect(limiter.resetQuota('test-key')).rejects.toThrow()
    })
  })

  describe('Burst Behavior', () => {
    it('should handle burst window shorter than main window', async () => {
      mockRedis.eval.mockResolvedValue([1, 0, 10, Date.now() + 60000, 4, 5, 1])

      const config: BurstRateLimitConfig = {
        limit: 10,
        windowMs: 60000, // 1 minute
        burstLimit: 5,
        burstWindowMs: 5000, // 5 seconds
      }

      await limiter.checkLimit('test-key', config)

      expect(mockRedis.eval).toHaveBeenCalledTimes(1)
      expect(mockRedis.eval.mock.calls[0][1]).toBe(1)
      expect(mockRedis.eval.mock.calls[0][2]).toBe('test-key')
      expect(mockRedis.eval.mock.calls[0].length).toBe(10)
    })

    it('should allow burst recovery after burst window expires', async () => {
      // First call uses burst
      mockRedis.eval.mockResolvedValueOnce([1, 0, 10, Date.now() + 60000, 4, 5, 1])

      const config: BurstRateLimitConfig = {
        limit: 10,
        windowMs: 60000,
        burstLimit: 5,
        burstWindowMs: 10000,
      }

      await limiter.checkLimit('test-key', config)

      // After burst window, burst should be available again
      mockRedis.eval.mockResolvedValueOnce([1, 0, 10, Date.now() + 60000, 5, 5, 1])

      const result = await limiter.checkLimit('test-key', config)

      expect(result.burstRemaining).toBe(5)
    })
  })
})
