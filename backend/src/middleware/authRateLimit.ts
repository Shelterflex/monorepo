import type { Request, Response, NextFunction } from 'express'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { slidingWindowLimiter } from '../services/SlidingWindowLimiter.js'
import { logger } from '../utils/logger.js'

type Counter = {
  count: number
  resetAtMs: number
}

function nowMs() {
  return Date.now()
}

function bumpCounter(map: Map<string, Counter>, key: string, windowMs: number): Counter {
  const now = nowMs()
  const existing = map.get(key)

  if (!existing || now >= existing.resetAtMs) {
    const c: Counter = { count: 1, resetAtMs: now + windowMs }
    map.set(key, c)
    return c
  }

  existing.count += 1
  return existing
}

const emailOtpRequestCounters = new Map<string, Counter>()
const ipOtpRequestCounters = new Map<string, Counter>()
const ipOtpVerifyCounters = new Map<string, Counter>()
const ipRefreshCounters = new Map<string, Counter>()
const walletChallengeRequestCounters = new Map<string, Counter>()
const ipWalletChallengeRequestCounters = new Map<string, Counter>()

export function otpRequestRateLimit(options?: {
  windowMs?: number
  maxPerEmail?: number
  maxPerIp?: number
}) {
  const windowMs = options?.windowMs ?? 15 * 60 * 1000
  const maxPerEmail = options?.maxPerEmail ?? 100
  const maxPerIp = options?.maxPerIp ?? 100

  return async (req: Request, _res: Response, next: NextFunction) => {
    const email = typeof req.body?.email === 'string' ? req.body.email : ''
    const ip = req.ip

    if (email) {
      const key = `auth:otp:email:${email.toLowerCase()}`
      try {
        const result = await slidingWindowLimiter.checkLimit(key, maxPerEmail, windowMs)
        if (!result.allowed) {
          return next(
            new AppError(
              ErrorCode.TOO_MANY_REQUESTS,
              429,
              'Too many OTP requests for this email. Please try again later.',
            ),
          )
        }
      } catch (error) {
        logger.warn('[authRateLimit] Redis error for OTP email rate limit, failing open', { error: String(error), key })
      }
    }

    if (ip) {
      const key = `auth:otp:ip:${ip}`
      try {
        const result = await slidingWindowLimiter.checkLimit(key, maxPerIp, windowMs)
        if (!result.allowed) {
          return next(
            new AppError(
              ErrorCode.TOO_MANY_REQUESTS,
              429,
              'Too many OTP requests from this IP. Please try again later.',
            ),
          )
        }
      } catch (error) {
        logger.warn('[authRateLimit] Redis error for OTP IP rate limit, failing open', { error: String(error), key })
      }
    }

    next()
  }
}

export function walletAuthRateLimit(options?: {
  windowMs?: number
  maxPerAddress?: number
  maxPerIp?: number
}) {
  const windowMs = options?.windowMs ?? 15 * 60 * 1000
  const maxPerAddress = options?.maxPerAddress ?? 20
  const maxPerIp = options?.maxPerIp ?? 50

  return async (req: Request, _res: Response, next: NextFunction) => {
    const address = typeof req.body?.address === 'string' ? req.body.address : ''
    const ip = req.ip

    if (address) {
      const key = `auth:wallet:address:${address.toLowerCase()}`
      try {
        const result = await slidingWindowLimiter.checkLimit(key, maxPerAddress, windowMs)
        if (!result.allowed) {
          return next(
            new AppError(
              ErrorCode.TOO_MANY_REQUESTS,
              429,
              'Too many requests for this wallet. Please try again later.',
            ),
          )
        }
      } catch (error) {
        logger.warn('[authRateLimit] Redis error for wallet address rate limit, failing open', { error: String(error), key })
      }
    }

    if (ip) {
      const key = `auth:wallet:ip:${ip}`
      try {
        const result = await slidingWindowLimiter.checkLimit(key, maxPerIp, windowMs)
        if (!result.allowed) {
          return next(
            new AppError(
              ErrorCode.TOO_MANY_REQUESTS,
              429,
              'Too many requests from this IP. Please try again later.',
            ),
          )
        }
      } catch (error) {
        logger.warn('[authRateLimit] Redis error for wallet IP rate limit, failing open', { error: String(error), key })
      }
    }

    next()
  }
}

/**
 * Per-IP limiter for OTP verification attempts. Mirrors the stricter
 * `rateLimitProfiles.otp` posture (5 attempts / 10 minutes) applied to
 * /request-otp, and complements the per-challenge attempt cap: the cap only
 * protects a single email address, this one protects against a single IP
 * brute-forcing many challenges.
 */
export function otpVerifyRateLimit(options?: {
  windowMs?: number
  maxPerIp?: number
}) {
  const windowMs = options?.windowMs ?? 10 * 60 * 1000
  const maxPerIp = options?.maxPerIp ?? 5

  return (req: Request, _res: Response, next: NextFunction) => {
    const ip = req.ip

    if (ip) {
      const c = bumpCounter(ipOtpVerifyCounters, ip, windowMs)
      if (c.count > maxPerIp) {
        return next(
          new AppError(
            ErrorCode.TOO_MANY_REQUESTS,
            429,
            'Too many OTP verification attempts from this IP. Please try again later.',
          ),
        )
      }
    }

    next()
  }
}

/**
 * Per-IP limiter for refresh-token exchanges. Each call performs a database
 * lookup and can mint a new access token, so it needs the same protection as
 * the other sensitive auth routes.
 */
export function refreshTokenRateLimit(options?: {
  windowMs?: number
  maxPerIp?: number
}) {
  const windowMs = options?.windowMs ?? 15 * 60 * 1000
  const maxPerIp = options?.maxPerIp ?? 10

  return (req: Request, _res: Response, next: NextFunction) => {
    const ip = req.ip

    if (ip) {
      const c = bumpCounter(ipRefreshCounters, ip, windowMs)
      if (c.count > maxPerIp) {
        return next(
          new AppError(
            ErrorCode.TOO_MANY_REQUESTS,
            429,
            'Too many token refresh attempts from this IP. Please try again later.',
          ),
        )
      }
    }

    next()
  }
}

export function _testOnly_clearAuthRateLimits() {
  slidingWindowLimiter.clear()
  emailOtpRequestCounters.clear()
  ipOtpRequestCounters.clear()
  ipOtpVerifyCounters.clear()
  ipRefreshCounters.clear()
  walletChallengeRequestCounters.clear()
  ipWalletChallengeRequestCounters.clear()
}

export function _testOnly_prefillEmailOtpCounter(email: string, count: number) {
  emailOtpRequestCounters.set(email.toLowerCase(), {
    count,
    resetAtMs: nowMs() + 15 * 60 * 1000,
  })
}

export function _testOnly_prefillIpOtpVerifyCounter(ip: string, count: number) {
  ipOtpVerifyCounters.set(ip, {
    count,
    resetAtMs: nowMs() + 10 * 60 * 1000,
  })
}

export function _testOnly_prefillIpRefreshCounter(ip: string, count: number) {
  ipRefreshCounters.set(ip, {
    count,
    resetAtMs: nowMs() + 15 * 60 * 1000,
  })
}
