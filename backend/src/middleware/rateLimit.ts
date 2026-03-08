import rateLimit from 'express-rate-limit'
import type { Request, Response } from 'express'
import type { Env } from '../schemas/env.js'

/**
 * Rate limiter for public endpoints (/health, /soroban/config).
 * Returns HTTP 429 with standard error format when the limit is exceeded.
 */
export function createPublicRateLimiter(env: Env) {
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        error: 'Too many requests. Please try again later.',
      })
    },
  })
}

/**
 * Rate limiter for authentication endpoints.
 * More restrictive than public endpoints to prevent brute force attacks.
 */
export function createAuthRateLimiter(env: Env) {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 10, // 10 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        error: 'Too many authentication attempts. Please try again later.',
      })
    },
  })
}

/**
 * Rate limiter for wallet endpoints.
 * Restricts wallet operations to prevent abuse.
 */
export function createWalletRateLimiter(env: Env) {
  return rateLimit({
    windowMs: 60 * 1000, // 1 minute
    limit: 30, // 30 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        error: 'Too many wallet operations. Please try again later.',
      })
    },
  })
}
