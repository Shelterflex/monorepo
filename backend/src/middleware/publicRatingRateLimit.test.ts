import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import { publicTenantRatingRateLimit } from './publicRatingRateLimit.js'
import { slidingWindowLimiter } from '../services/SlidingWindowLimiter.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

vi.mock('../services/SlidingWindowLimiter.js', () => ({
  slidingWindowLimiter: {
    checkLimit: vi.fn(),
    clear: vi.fn(),
  },
}))

vi.mock('../utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

describe('publicTenantRatingRateLimit', () => {
  let req: Partial<Request>
  let res: Partial<Response>
  let next: NextFunction

  beforeEach(() => {
    vi.clearAllMocks()
    
    req = {
      ip: '192.168.1.100',
      path: '/api/public/tenant-rating/test-token',
      socket: {
        remoteAddress: '192.168.1.100',
      } as any,
    }

    res = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    }

    next = vi.fn()

    slidingWindowLimiter.clear()
  })

  it('should allow request when within rate limit', async () => {
    vi.mocked(slidingWindowLimiter.checkLimit).mockResolvedValue({
      allowed: true,
      remaining: 19,
      total: 20,
      reset: Date.now() + 15 * 60 * 1000,
    })

    const middleware = publicTenantRatingRateLimit()
    await middleware(req as Request, res as Response, next)

    expect(next).toHaveBeenCalledWith()
    expect(next).not.toHaveBeenCalledWith(expect.any(AppError))
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '20')
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '19')
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(String))
  })

  it('should block request when rate limit exceeded', async () => {
    const resetTime = Date.now() + 15 * 60 * 1000

    vi.mocked(slidingWindowLimiter.checkLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      total: 20,
      reset: resetTime,
    })

    const middleware = publicTenantRatingRateLimit()
    await middleware(req as Request, res as Response, next)

    expect(next).toHaveBeenCalledWith(expect.any(AppError))
    const error = (next as any).mock.calls[0][0] as AppError
    expect(error.code).toBe(ErrorCode.TOO_MANY_REQUESTS)
    expect(error.statusCode).toBe(429)
    expect(error.message).toBe('Too many requests. Please try again later.')
    
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '20')
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '0')
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String))
  })

  it('should use IP address from req.ip', async () => {
    vi.mocked(slidingWindowLimiter.checkLimit).mockResolvedValue({
      allowed: true,
      remaining: 19,
      total: 20,
      reset: Date.now() + 15 * 60 * 1000,
    })

    const middleware = publicTenantRatingRateLimit()
    await middleware(req as Request, res as Response, next)

    expect(slidingWindowLimiter.checkLimit).toHaveBeenCalledWith(
      'ratelimit:public_tenant_rating:ip:192.168.1.100',
      20,
      15 * 60 * 1000
    )
  })

  it('should fallback to socket.remoteAddress if req.ip is not available', async () => {
    req.ip = undefined

    vi.mocked(slidingWindowLimiter.checkLimit).mockResolvedValue({
      allowed: true,
      remaining: 19,
      total: 20,
      reset: Date.now() + 15 * 60 * 1000,
    })

    const middleware = publicTenantRatingRateLimit()
    await middleware(req as Request, res as Response, next)

    expect(slidingWindowLimiter.checkLimit).toHaveBeenCalledWith(
      'ratelimit:public_tenant_rating:ip:192.168.1.100',
      20,
      15 * 60 * 1000
    )
  })

  it('should use "unknown" as IP if neither req.ip nor socket.remoteAddress is available', async () => {
    req.ip = undefined
    req.socket = {} as any

    vi.mocked(slidingWindowLimiter.checkLimit).mockResolvedValue({
      allowed: true,
      remaining: 19,
      total: 20,
      reset: Date.now() + 15 * 60 * 1000,
    })

    const middleware = publicTenantRatingRateLimit()
    await middleware(req as Request, res as Response, next)

    expect(slidingWindowLimiter.checkLimit).toHaveBeenCalledWith(
      'ratelimit:public_tenant_rating:ip:unknown',
      20,
      15 * 60 * 1000
    )
  })

  it('should respect custom windowMs and maxRequests options', async () => {
    vi.mocked(slidingWindowLimiter.checkLimit).mockResolvedValue({
      allowed: true,
      remaining: 9,
      total: 10,
      reset: Date.now() + 5 * 60 * 1000,
    })

    const middleware = publicTenantRatingRateLimit({
      windowMs: 5 * 60 * 1000,
      maxRequests: 10,
    })
    await middleware(req as Request, res as Response, next)

    expect(slidingWindowLimiter.checkLimit).toHaveBeenCalledWith(
      'ratelimit:public_tenant_rating:ip:192.168.1.100',
      10,
      5 * 60 * 1000
    )
  })

  it('should allow request on rate limiter error to avoid blocking legitimate users', async () => {
    vi.mocked(slidingWindowLimiter.checkLimit).mockRejectedValue(
      new Error('Redis connection failed')
    )

    const middleware = publicTenantRatingRateLimit()
    await middleware(req as Request, res as Response, next)

    expect(next).toHaveBeenCalledWith()
    expect(next).not.toHaveBeenCalledWith(expect.any(AppError))
  })

  it('should apply rate limit to both valid and invalid tokens', async () => {
    // First request - valid token
    vi.mocked(slidingWindowLimiter.checkLimit).mockResolvedValue({
      allowed: true,
      remaining: 19,
      total: 20,
      reset: Date.now() + 15 * 60 * 1000,
    })

    const middleware = publicTenantRatingRateLimit()
    await middleware(req as Request, res as Response, next)

    expect(slidingWindowLimiter.checkLimit).toHaveBeenCalledTimes(1)

    // Second request - invalid token (same IP)
    req.path = '/api/public/tenant-rating/invalid-token'
    
    vi.mocked(slidingWindowLimiter.checkLimit).mockResolvedValue({
      allowed: true,
      remaining: 18,
      total: 20,
      reset: Date.now() + 15 * 60 * 1000,
    })

    await middleware(req as Request, res as Response, next)

    expect(slidingWindowLimiter.checkLimit).toHaveBeenCalledTimes(2)
    // Both calls should use the same key (IP-based)
    expect(slidingWindowLimiter.checkLimit).toHaveBeenLastCalledWith(
      'ratelimit:public_tenant_rating:ip:192.168.1.100',
      20,
      15 * 60 * 1000
    )
  })

  it('should set proper Retry-After header when rate limit exceeded', async () => {
    const now = Date.now()
    const resetTime = now + 15 * 60 * 1000 // 15 minutes from now

    vi.mocked(slidingWindowLimiter.checkLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      total: 20,
      reset: resetTime,
    })

    const middleware = publicTenantRatingRateLimit()
    await middleware(req as Request, res as Response, next)

    expect(res.setHeader).toHaveBeenCalledWith(
      'Retry-After',
      expect.stringMatching(/^\d+$/)
    )

    // Verify Retry-After is approximately 900 seconds (15 minutes)
    const retryAfterCall = (res.setHeader as any).mock.calls.find(
      (call: any[]) => call[0] === 'Retry-After'
    )
    const retryAfterValue = parseInt(retryAfterCall[1])
    expect(retryAfterValue).toBeGreaterThan(850)
    expect(retryAfterValue).toBeLessThan(950)
  })
})

