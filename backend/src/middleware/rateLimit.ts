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
