import type { Request, Response, NextFunction } from 'express'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { slidingWindowLimiter } from '../services/SlidingWindowLimiter.js'
import { logger } from '../utils/logger.js'

/**
 * Rate limiter for public tenant rating card endpoints.
 * Applies IP-based rate limiting to prevent token enumeration and scraping attacks.
 * 
 * Configuration:
 * - 20 requests per 15 minutes per IP (conservative limit for legitimate single-link sharing)
 * - Applies to both valid and invalid tokens to prevent fast token-validity oracle
 */
export function publicTenantRatingRateLimit(options?: {
  windowMs?: number
  maxRequests?: number
}) {
  const windowMs = options?.windowMs ?? 15 * 60 * 1000 // 15 minutes
  const maxRequests = options?.maxRequests ?? 20 // 20 requests per window

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown'
    const endpoint = req.path

    try {
      const key = `ratelimit:public_tenant_rating:ip:${clientIp}`

      const result = await slidingWindowLimiter.checkLimit(key, maxRequests, windowMs)

      // Set rate limit headers for transparency
      res.setHeader('X-RateLimit-Limit', result.total.toString())
      res.setHeader('X-RateLimit-Remaining', result.remaining.toString())
      res.setHeader('X-RateLimit-Reset', Math.ceil(result.reset / 1000).toString())

      if (!result.allowed) {
        const retryAfter = Math.ceil((result.reset - Date.now()) / 1000)
        res.setHeader('Retry-After', retryAfter.toString())

        logger.warn('Public tenant rating rate limit exceeded', {
          clientIp,
          endpoint,
          limit: result.total,
          resetAt: new Date(result.reset).toISOString(),
        })

        throw new AppError(
          ErrorCode.TOO_MANY_REQUESTS,
          429,
          'Too many requests. Please try again later.'
        )
      }

      next()
    } catch (error) {
      if (error instanceof AppError) {
        return next(error)
      }
      logger.error('Public tenant rating rate limiting error:', error)
      // On error, allow the request to avoid blocking legitimate users
      next()
    }
  }
}

