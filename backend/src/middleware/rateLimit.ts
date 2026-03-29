import type { Request, Response, NextFunction } from 'express'
import type { Env } from '../schemas/env.js'
import { slidingWindowLimiter } from '../services/SlidingWindowLimiter.js'
import { quotaService } from '../services/QuotaService.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import type { User } from '../repositories/AuthRepository.js'

/**
 * Advanced rate limiter middleware with sliding window and user quotas.
 */
export function createAdvancedRateLimiter(options: {
  windowMs?: number
  limit?: number
  keyPrefix?: string
} = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // 1. Bypass health checks
    if (req.path === '/health') {
      return next()
    }

    try {
      // 2. Identify user and tier
      const user = (req as any).user as User | undefined
      const limits = await quotaService.getUserLimits(user)

      const windowMs = options.windowMs ?? 60 * 1000 // default 1 minute
      const limit = options.limit ?? limits.requestsPerMinute

      const identifier = user ? `user:${user.id}` : `ip:${req.ip}`
      const key = `ratelimit:${options.keyPrefix ?? 'api'}:${identifier}`

      // 3. Check limit using sliding window
      const result = await slidingWindowLimiter.checkLimit(key, limit, windowMs)

      // 4. Set headers
      res.setHeader('X-RateLimit-Limit', result.total)
      res.setHeader('X-RateLimit-Remaining', result.remaining)
      res.setHeader('X-RateLimit-Reset', Math.ceil(result.reset / 1000))

      if (!result.allowed) {
        throw new AppError(
          ErrorCode.TOO_MANY_REQUESTS,
          429,
          'Rate limit exceeded. Please try again later.'
        )
      }

      next()
    } catch (error) {
      if (error instanceof AppError) {
        return next(error)
      }
      console.error('[rateLimit] unexpected error:', error)
      next() // allow request on internal error to avoid blocking users
    }
  }
}

/**
 * Legacy compatibility / Convenience wrappers
 */
export function createPublicRateLimiter(_env: Env) {
  return createAdvancedRateLimiter({ keyPrefix: 'public' })
}

export function createAuthRateLimiter(_env: Env) {
  return createAdvancedRateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    keyPrefix: 'auth'
  })
}

export function createWalletRateLimiter(_env: Env) {
  return createAdvancedRateLimiter({
    windowMs: 60 * 1000,
    limit: 30,
    keyPrefix: 'wallet'
  })
}
