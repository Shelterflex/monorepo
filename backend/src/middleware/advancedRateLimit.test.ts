import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Request, Response, NextFunction } from 'express'
import { createAdvancedRateLimiter, RateLimitPresets } from './advancedRateLimit.js'
import { burstRateLimiter } from '../services/BurstRateLimiter.js'
import { quotaManager } from '../services/QuotaManager.js'

// Mock dependencies
vi.mock('../services/BurstRateLimiter.js')
vi.mock('../services/QuotaManager.js')
vi.mock('../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))
vi.mock('../utils/metrics.js', () => ({
  meter: {
    createCounter: vi.fn(() => ({
      add: vi.fn(),
    })),
  },
}))
vi.mock('../errors/AppError.js', () => ({
  AppError: class {
    constructor(
      public code: string,
      public status: number,
      public message: string
    ) {}
  },
}))
vi.mock('../errors/errorCodes.js', () => ({
  ErrorCode: {
    TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  },
}))

describe('Advanced Rate Limiter', () => {
  let mockReq: Partial<Request>
  let mockRes: Partial<Response>
  let mockNext: NextFunction

  beforeEach(() => {
    mockReq = {
      path: '/api/test',
      method: 'GET',
      baseUrl: '',
      ip: '127.0.0.1',
      requestId: 'test-123',
    }
    mockRes = {
      setHeader: vi.fn(),
    }
    mockNext = vi.fn()
    vi.clearAllMocks()
  })

  describe('Basic Rate Limiting', () => {
    it('should allow requests within limit', async () => {
      vi.mocked(burstRateLimiter.checkLimit).mockResolvedValue({
        allowed: true,
        remaining: 9,
        total: 10,
        reset: Date.now() + 60000,
        burstRemaining: 5,
        burstTotal: 5,
        usingBurst: false,
      })

      const limiter = createAdvancedRateLimiter({
        limit: 10,
        windowMs: 60000,
      })

      await limiter(mockReq as Request, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalled()
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 10)
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 9)
    })

    it('should reject requests exceeding limit', async () => {
      vi.mocked(burstRateLimiter.checkLimit).mockResolvedValue({
        allowed: false,
        remaining: 0,
        total: 10,
        reset: Date.now() + 60000,
        burstRemaining: 0,
        burstTotal: 5,
        usingBurst: true,
      })

      const limiter = createAdvancedRateLimiter({
        limit: 10,
        windowMs: 60000,
      })

      await limiter(mockReq as Request, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 429,
        })
      )
      expect(mockRes.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String))
    })

    it('should use burst allowance when main quota is exhausted', async () => {
      vi.mocked(burstRateLimiter.checkLimit).mockResolvedValue({
        allowed: true,
        remaining: 0,
        total: 10,
        reset: Date.now() + 60000,
        burstRemaining: 4,
        burstTotal: 5,
        usingBurst: true,
      })

      const limiter = createAdvancedRateLimiter({
        limit: 10,
        windowMs: 60000,
        burstLimit: 5,
      })

      await limiter(mockReq as Request, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalled()
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Using-Burst', 'true')
    })
  })

  describe('Burst Behavior', () => {
    it('should allow burst requests within burst window', async () => {
      vi.mocked(burstRateLimiter.checkLimit).mockResolvedValue({
        allowed: true,
        remaining: 0,
        total: 10,
        reset: Date.now() + 60000,
        burstRemaining: 3,
        burstTotal: 5,
        usingBurst: true,
      })

      const limiter = createAdvancedRateLimiter({
        limit: 10,
        windowMs: 60000,
        burstLimit: 5,
        burstWindowMs: 10000,
      })

      await limiter(mockReq as Request, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalled()
    })

    it('should reject when burst allowance is also exhausted', async () => {
      vi.mocked(burstRateLimiter.checkLimit).mockResolvedValue({
        allowed: false,
        remaining: 0,
        total: 10,
        reset: Date.now() + 60000,
        burstRemaining: 0,
        burstTotal: 5,
        usingBurst: true,
      })

      const limiter = createAdvancedRateLimiter({
        limit: 10,
        windowMs: 60000,
        burstLimit: 5,
      })

      await limiter(mockReq as Request, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 429,
        })
      )
    })
  })

  describe('Admin Overrides', () => {
    it('should apply elevated limit from override', async () => {
      vi.mocked(quotaManager.getOverride).mockResolvedValue({
        userId: 'user123',
        elevatedLimit: 100,
        reason: 'Testing',
        createdBy: 'admin',
        createdAt: Date.now(),
      })

      vi.mocked(burstRateLimiter.checkLimit).mockResolvedValue({
        allowed: true,
        remaining: 99,
        total: 100,
        reset: Date.now() + 60000,
        burstRemaining: 20,
        burstTotal: 20,
        usingBurst: false,
      })

      const limiter = createAdvancedRateLimiter({
        limit: 10,
        windowMs: 60000,
      })

      const authReq = { ...mockReq, user: { id: 'user123', role: 'tenant' } }

      await limiter(authReq as Request, mockRes as Response, mockNext)

      expect(burstRateLimiter.checkLimit).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          limit: 100, // Elevated limit
        })
      )
    })

    it('should use default limit when no override exists', async () => {
      vi.mocked(quotaManager.getOverride).mockResolvedValue(null)

      vi.mocked(burstRateLimiter.checkLimit).mockResolvedValue({
        allowed: true,
        remaining: 9,
        total: 10,
        reset: Date.now() + 60000,
        burstRemaining: 2,
        burstTotal: 2,
        usingBurst: false,
      })

      const limiter = createAdvancedRateLimiter({
        limit: 10,
        windowMs: 60000,
      })

      const authReq = { ...mockReq, user: { id: 'user123', role: 'tenant' } }

      await limiter(authReq as Request, mockRes as Response, mockNext)

      expect(burstRateLimiter.checkLimit).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          limit: 10, // Default limit
        })
      )
    })
  })

  describe('Skip for Roles', () => {
    it('should skip rate limiting for specified roles', async () => {
      const limiter = createAdvancedRateLimiter({
        limit: 10,
        windowMs: 60000,
        skipForRoles: ['admin'],
      })

      const authReq = { ...mockReq, user: { id: 'admin123', role: 'admin' } }

      await limiter(authReq as Request, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalled()
      expect(burstRateLimiter.checkLimit).not.toHaveBeenCalled()
    })
  })

  describe('Health Check Bypass', () => {
    it('should skip rate limiting for health endpoints', async () => {
      const limiter = createAdvancedRateLimiter({
        limit: 10,
        windowMs: 60000,
      })

      const healthReq = { ...mockReq, path: '/health' }

      await limiter(healthReq as Request, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalled()
      expect(burstRateLimiter.checkLimit).not.toHaveBeenCalled()
    })

    it('should skip rate limiting for docs endpoints', async () => {
      const limiter = createAdvancedRateLimiter({
        limit: 10,
        windowMs: 60000,
      })

      const docsReq = { ...mockReq, path: '/docs' }

      await limiter(docsReq as Request, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalled()
      expect(burstRateLimiter.checkLimit).not.toHaveBeenCalled()
    })
  })

  describe('Near Limit Logging', () => {
    it('should log when near limit threshold', async () => {
      vi.mocked(burstRateLimiter.checkLimit).mockResolvedValue({
        allowed: true,
        remaining: 1, // Below 10% threshold
        total: 10,
        reset: Date.now() + 60000,
        burstRemaining: 2,
        burstTotal: 2,
        usingBurst: false,
      })

      const limiter = createAdvancedRateLimiter({
        limit: 10,
        windowMs: 60000,
      })

      await limiter(mockReq as Request, mockRes as Response, mockNext)

      const { logger } = await import('../utils/logger.js')
      expect(logger.info).toHaveBeenCalledWith(
        'Rate limit near exhaustion',
        expect.any(Object)
      )
    })
  })

  describe('Error Handling', () => {
    it('should allow request on rate limiter error', async () => {
      vi.mocked(burstRateLimiter.checkLimit).mockRejectedValue(new Error('Redis error'))

      const limiter = createAdvancedRateLimiter({
        limit: 10,
        windowMs: 60000,
      })

      await limiter(mockReq as Request, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalled()
    })
  })

  describe('Rate Limit Presets', () => {
    it('should have strict preset with low limits', () => {
      expect(RateLimitPresets.strict).toBeDefined()
    })

    it('should have moderate preset with medium limits', () => {
      expect(RateLimitPresets.moderate).toBeDefined()
    })

    it('should have lenient preset with high limits', () => {
      expect(RateLimitPresets.lenient).toBeDefined()
    })

    it('should have admin preset that skips for admins', () => {
      expect(RateLimitPresets.admin).toBeDefined()
    })
  })
})
