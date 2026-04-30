import { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { burstRateLimiter } from '../services/BurstRateLimiter.js'
import { quotaManager } from '../services/QuotaManager.js'
import type { User } from '../repositories/AuthRepository.js'
import { meter } from '../utils/metrics.js'

export interface AdvancedRateLimitConfig {
  /** Base rate limit per window */
  limit: number
  /** Window duration in milliseconds */
  windowMs: number
  /** Burst allowance (additional requests allowed temporarily) */
  burstLimit?: number
  /** Burst window duration in milliseconds (shorter than main window) */
  burstWindowMs?: number
  /** Skip rate limiting for specific user roles */
  skipForRoles?: ('admin' | 'landlord' | 'tenant' | 'agent')[]
  /** Per-endpoint key prefix */
  keyPrefix?: string
}

/**
 * Advanced rate limiting middleware with burst allowance and admin overrides.
 */
export function createAdvancedRateLimiter(config: AdvancedRateLimitConfig) {
  const {
    limit,
    windowMs,
    burstLimit = Math.floor(limit * 0.2), // 20% burst allowance by default
    burstWindowMs = Math.floor(windowMs * 0.1), // 10% of main window
    skipForRoles = [],
    keyPrefix = 'api',
  } = config

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const requestId = (req as any).requestId || 'unknown'
    const user = (req as any).user as User | undefined
    const userId = user?.id
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown'
    const endpoint = `${req.method} ${req.baseUrl}${req.path}`

    // Skip health checks and documentation
    if (
      req.path === '/health' ||
      req.path.startsWith('/health/') ||
      req.path.startsWith('/openapi') ||
      req.path.startsWith('/docs')
    ) {
      return next()
    }

    // Skip for specified user roles (e.g., admins)
    if (userId && skipForRoles.includes(user.role as any)) {
      logger.debug('Rate limit skipped for user role', {
        requestId,
        userId,
        role: user.role,
        endpoint,
      })
      return next()
    }

    try {
      // Check for admin overrides
      const override = userId ? await quotaManager.getOverride(userId, endpoint) : null
      const effectiveLimit = override?.elevatedLimit ?? limit

      // Build rate limit key
      const identifier = userId ? `user:${userId}` : `ip:${clientIp}`
      const key = `ratelimit:${keyPrefix}:${identifier}:${endpoint}`

      // Check rate limit with burst allowance
      const result = await burstRateLimiter.checkLimit(key, {
        limit: effectiveLimit,
        windowMs,
        burstLimit,
        burstWindowMs,
      })

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', result.total)
      res.setHeader('X-RateLimit-Remaining', result.remaining)
      res.setHeader('X-RateLimit-Reset', Math.ceil(result.reset / 1000))
      res.setHeader('X-RateLimit-Burst-Limit', result.burstTotal)
      res.setHeader('X-RateLimit-Burst-Remaining', result.burstRemaining)
      res.setHeader('X-RateLimit-Using-Burst', result.usingBurst ? 'true' : 'false')

      // Log if using burst allowance
      if (result.usingBurst) {
        logger.info('Request using burst allowance', {
          requestId,
          userId,
          endpoint,
          burstRemaining: result.burstRemaining,
        })
      }

      // Track quota usage
      if (userId && result.allowed) {
        await quotaManager.trackUsage(userId, endpoint)
      }

      // Check if request is denied
      if (!result.allowed) {
        const retryAfter = Math.ceil((result.reset - Date.now()) / 1000)

        // Structured logging for quota violations
        logger.warn('Rate limit exceeded', {
          requestId,
          userId,
          clientIp,
          endpoint,
          limit: result.total,
          burstLimit: result.burstTotal,
          usingBurst: result.usingBurst,
          override: override ? 'active' : 'none',
          retryAfter,
        })

        // Record metric
        meter
          .createCounter('rate_limit_exceeded_total', {
            description: 'Total number of rate limit violations',
          })
          .add(1, {
            user_id: userId || 'anonymous',
            endpoint,
            using_burst: result.usingBurst ? 'true' : 'false',
          })

        res.setHeader('Retry-After', retryAfter.toString())

        throw new AppError(
          ErrorCode.TOO_MANY_REQUESTS,
          429,
          `Rate limit exceeded. Please try again after ${retryAfter} seconds.`
        )
      }

      // Log near-limit condition
      if (result.remaining <= result.total * 0.1) {
        logger.info('Rate limit near exhaustion', {
          requestId,
          userId,
          endpoint,
          remaining: result.remaining,
          total: result.total,
          burstRemaining: result.burstRemaining,
        })

        // Record near-limit metric
        meter
          .createCounter('rate_limit_near_exhaustion_total', {
            description: 'Total number of near-limit events',
          })
          .add(1, { user_id: userId || 'anonymous', endpoint })
      }

      next()
    } catch (error) {
      if (error instanceof AppError) {
        return next(error)
      }

      logger.error('Rate limiting middleware error', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      })

      // Allow request on error to avoid blocking users
      next()
    }
  }
}

/**
 * Pre-configured rate limiters for common use cases
 */
export const RateLimitPresets = {
  /** Strict rate limiter for sensitive endpoints (auth, payments) */
  strict: createAdvancedRateLimiter({
    limit: 10,
    windowMs: 60 * 1000, // 1 minute
    burstLimit: 5,
    burstWindowMs: 10 * 1000, // 10 seconds
  }),

  /** Moderate rate limiter for general API endpoints */
  moderate: createAdvancedRateLimiter({
    limit: 100,
    windowMs: 60 * 1000, // 1 minute
    burstLimit: 20,
    burstWindowMs: 10 * 1000, // 10 seconds
  }),

  /** Lenient rate limiter for public endpoints */
  lenient: createAdvancedRateLimiter({
    limit: 300,
    windowMs: 60 * 1000, // 1 minute
    burstLimit: 50,
    burstWindowMs: 10 * 1000, // 10 seconds
  }),

  /** Admin rate limiter (skips for admin role) */
  admin: createAdvancedRateLimiter({
    limit: 50,
    windowMs: 60 * 1000, // 1 minute
    burstLimit: 10,
    burstWindowMs: 10 * 1000, // 10 seconds
    skipForRoles: ['admin'],
  }),
}
