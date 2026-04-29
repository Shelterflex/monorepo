/**
 * Comprehensive rate limiting middleware with per-endpoint and per-user tracking.
 *
 * Provides:
 * - Per-endpoint rate limits
 * - Per-user rate limits
 * - Per-IP rate limits
 * - Detailed logging of rate limit events
 * - Standard HTTP rate limit headers
 */

import { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { quotaService } from '../services/QuotaService.js'
import type { User } from '../repositories/AuthRepository.js'
import { env } from '../schemas/env.js'

/**
 * Rate limit tracking store (in-memory for single-node deployments).
 * For distributed deployments, use Redis or similar.
 */
interface RateLimitEntry {
  count: number
  resetTime: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()

/**
 * Clean up expired rate limit entries periodically.
 */
function startCleanupInterval(): void {
  setInterval(() => {
    const now = Date.now()
    let cleaned = 0
    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.resetTime <= now) {
        rateLimitStore.delete(key)
        cleaned++
      }
    }
    if (cleaned > 0) {
      logger.debug(`Rate limit store cleaned up ${cleaned} expired entries`)
    }
  }, 60 * 1000) // Clean every minute
}

// Initialize cleanup on module load
if (typeof process !== 'undefined' && !globalThis.__rateLimitCleanupStarted) {
  startCleanupInterval()
  globalThis.__rateLimitCleanupStarted = true
}

/**
 * Configuration for endpoint-specific rate limits.
 */
export interface EndpointRateLimitConfig {
  windowMs: number // Time window in milliseconds
  limit: number // Max requests per window
  skipSuccessfulRequests?: boolean // Don't count successful (2xx) responses
  skipFailedRequests?: boolean // Don't count failed (4xx, 5xx) responses
}

/**
 * Endpoint-specific rate limit configurations.
 */
const endpointLimits: Map<string, EndpointRateLimitConfig> = new Map([
  // Auth endpoints - strict limits
  ['POST /api/auth/request-otp', { windowMs: 15 * 60 * 1000, limit: 5 }],
  ['POST /api/auth/verify-otp', { windowMs: 15 * 60 * 1000, limit: 10 }],
  ['POST /api/auth/wallet-challenge', { windowMs: 60 * 1000, limit: 20 }],
  ['POST /api/auth/wallet-verify', { windowMs: 60 * 1000, limit: 20 }],

  // Wallet endpoints - strict limits
  ['/api/wallet', { windowMs: 60 * 1000, limit: 30 }],
  ['/api/wallet/ngn', { windowMs: 60 * 1000, limit: 30 }],

  // Admin endpoints - very strict limits
  ['/api/admin', { windowMs: 60 * 1000, limit: 10 }],

  // General API endpoints - moderate limits
  ['GET /api', { windowMs: 60 * 1000, limit: 100 }],
  ['POST /api', { windowMs: 60 * 1000, limit: 50 }],
  ['PUT /api', { windowMs: 60 * 1000, limit: 50 }],
  ['DELETE /api', { windowMs: 60 * 1000, limit: 30 }],
  ['PATCH /api', { windowMs: 60 * 1000, limit: 50 }],
])

/**
 * Get rate limit configuration for an endpoint.
 */
function getEndpointConfig(method: string, path: string): EndpointRateLimitConfig | null {
  // 1. Exact match with method
  const exactKey = `${method} ${path}`
  if (endpointLimits.has(exactKey)) return endpointLimits.get(exactKey)!

  // 2. Exact match path only (applies to all methods)
  if (endpointLimits.has(path)) return endpointLimits.get(path)!

  // 3. Prefix match (for wildcard endpoints like /api/admin/*)
  // Sort keys by length descending to find the most specific match first
  const sortedKeys = Array.from(endpointLimits.keys()).sort((a, b) => b.length - a.length)
  for (const key of sortedKeys) {
    if (path.startsWith(key) && !key.includes(' ')) {
      return endpointLimits.get(key)!
    }
  }

  return null
}

/**
 * Check rate limit for a given identifier within a window.
 */
function checkRateLimit(key: string, limit: number, windowMs: number): {
  allowed: boolean
  count: number
  remaining: number
  reset: number
} {
  const now = Date.now()
  let entry = rateLimitStore.get(key)

  if (!entry || entry.resetTime <= now) {
    entry = {
      count: 0,
      resetTime: now + windowMs,
    }
  }

  const remaining = Math.max(0, limit - entry.count - 1)
  const allowed = entry.count < limit
  entry.count++
  rateLimitStore.set(key, entry)

  return {
    allowed,
    count: entry.count,
    remaining,
    reset: entry.resetTime,
  }
}

/**
 * Comprehensive rate limiting middleware factory.
 *
 * Supports per-user, per-IP, and per-endpoint rate limits.
 */
export function createComprehensiveRateLimiter(options: {
  defaultWindowMs?: number
  defaultLimit?: number
  userLimits?: Map<string, EndpointRateLimitConfig>
} = {}) {
  const defaultWindowMs = options.defaultWindowMs || env.RATE_LIMIT_WINDOW_MS
  const defaultLimit = options.defaultLimit || env.RATE_LIMIT_MAX_REQUESTS

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const requestId = (req as any).id || 'unknown'
    const user = (req as any).user as User | undefined
    const userId = user?.id
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown'
    const endpoint = `${req.method} ${req.baseUrl}${req.path}`

    // Skip health checks and documentation
    if (
      req.path === '/health' ||
      req.path.startsWith('/health/') ||
      req.path.startsWith('/openapi') ||
      req.path.startsWith('/docs') ||
      req.path.startsWith('/api/public')
    ) {
      return next()
    }

    try {
      // Get user-specific limits from quota service
      const userTierLimits = await quotaService.getUserLimits(user)

      // Get endpoint-specific configuration or use defaults
      const config = getEndpointConfig(req.method, req.path) || {
        windowMs: defaultWindowMs,
        limit: options.defaultLimit || userTierLimits.requestsPerMinute || defaultLimit,
      }

      // Combine multiple rate limit checks
      const checks = []

      // Check 1: Per-user rate limit (if authenticated)
      let userLimited = false
      if (userId) {
        const userKey = `ratelimit:user:${userId}`
        const userCheck = checkRateLimit(userKey, config.limit * 2, config.windowMs)
        checks.push({ type: 'user', ...userCheck })
        if (!userCheck.allowed) {
          userLimited = true
        }
      }

      // Check 2: Per-IP rate limit (for non-authenticated requests)
      let ipLimited = false
      if (!userId) {
        const ipKey = `ratelimit:ip:${clientIp}`
        const ipCheck = checkRateLimit(ipKey, config.limit, config.windowMs)
        checks.push({ type: 'ip', ...ipCheck })
        if (!ipCheck.allowed) {
          ipLimited = true
        }
      }

      // Check 3: Per-endpoint global limit
      const endpointKey = `ratelimit:endpoint:${endpoint}`
      const endpointCheck = checkRateLimit(endpointKey, config.limit * 10, config.windowMs)
      checks.push({ type: 'endpoint', ...endpointCheck })

      // Determine if request is rate limited
      const isRateLimited = userLimited || ipLimited || !endpointCheck.allowed

      // Set standard rate limit headers
      const usedLimit = userId ? checks[0]?.count || 0 : checks[0]?.count || 0
      const totalLimit = config.limit * (userId ? 2 : 1)
      const resetTime = Math.min(...checks.map((c) => c.reset))
      const retryAfter = Math.ceil((resetTime - Date.now()) / 1000)

      res.setHeader('X-RateLimit-Limit', totalLimit)
      res.setHeader('X-RateLimit-Remaining', Math.max(0, totalLimit - usedLimit))
      res.setHeader('X-RateLimit-Reset', Math.ceil(resetTime / 1000))

      if (isRateLimited) {
        logger.warn(`Rate limit exceeded`, {
          requestId,
          endpoint,
          userId,
          clientIp,
          checks,
        })

        res.setHeader('Retry-After', retryAfter)

        throw new AppError(
          ErrorCode.TOO_MANY_REQUESTS,
          429,
          'Too many requests. Please try again later.'
        )
      }

      // Log rate limit status for monitoring
      if (checks.some((c) => c.count > config.limit * 0.8)) {
        logger.info(`Rate limit approaching threshold`, {
          requestId,
          endpoint,
          userId,
          checks,
        })
      }

      next()
    } catch (error) {
      if (error instanceof AppError) {
        return next(error)
      }
      logger.error(`Rate limiting middleware error`, {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      })
      next() // Allow request on error to avoid blocking users
    }
  }
}

/**
 * Set custom rate limits for specific endpoints.
 */
export function setEndpointRateLimit(
  method: string,
  path: string,
  config: EndpointRateLimitConfig
): void {
  const key = method ? `${method} ${path}` : path
  endpointLimits.set(key, config)
}

/**
 * Get rate limit stats for monitoring/debugging.
 */
export function getRateLimitStats(): {
  totalTrackedKeys: number
  activeKeys: number
  oldestReset: number
  newestReset: number
} {
  if (rateLimitStore.size === 0) {
    return {
      totalTrackedKeys: 0,
      activeKeys: 0,
      oldestReset: Date.now(),
      newestReset: Date.now(),
    }
  }

  const now = Date.now()
  const entries = Array.from(rateLimitStore.values())
  const activeEntries = entries.filter((e) => e.resetTime > now)

  return {
    totalTrackedKeys: rateLimitStore.size,
    activeKeys: activeEntries.length,
    oldestReset: Math.min(...entries.map((e) => e.resetTime)),
    newestReset: Math.max(...entries.map((e) => e.resetTime)),
  }
}

/**
 * Reset the rate limit store (for testing purposes only).
 */
export function resetRateLimitStore(): void {
  rateLimitStore.clear()
  endpointLimits.clear()
  // Re-initialize default endpoint limits
  endpointLimits.set('POST /api/auth/request-otp', { windowMs: 15 * 60 * 1000, limit: 5 })
  endpointLimits.set('POST /api/auth/verify-otp', { windowMs: 15 * 60 * 1000, limit: 10 })
  endpointLimits.set('POST /api/auth/wallet-challenge', { windowMs: 60 * 1000, limit: 20 })
  endpointLimits.set('POST /api/auth/wallet-verify', { windowMs: 60 * 1000, limit: 20 })
  endpointLimits.set('/api/wallet', { windowMs: 60 * 1000, limit: 30 })
  endpointLimits.set('/api/wallet/ngn', { windowMs: 60 * 1000, limit: 30 })
  endpointLimits.set('/api/admin', { windowMs: 60 * 1000, limit: 10 })
  endpointLimits.set('GET /api', { windowMs: 60 * 1000, limit: 100 })
  endpointLimits.set('POST /api', { windowMs: 60 * 1000, limit: 50 })
  endpointLimits.set('PUT /api', { windowMs: 60 * 1000, limit: 50 })
  endpointLimits.set('DELETE /api', { windowMs: 60 * 1000, limit: 30 })
  endpointLimits.set('PATCH /api', { windowMs: 60 * 1000, limit: 50 })
}

/**
 * Global type augmentation for rate limit tracking state.
 */
declare global {
  var __rateLimitCleanupStarted: boolean
}
