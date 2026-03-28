import type { Request, Response, NextFunction } from 'express'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

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

  return (req: Request, _res: Response, next: NextFunction) => {
    const email = typeof req.body?.email === 'string' ? req.body.email : ''
    const ip = req.ip

    if (email) {
      const c = bumpCounter(emailOtpRequestCounters, email.toLowerCase(), windowMs)
      if (c.count > maxPerEmail) {
        return next(
          new AppError(
            ErrorCode.TOO_MANY_REQUESTS,
            429,
            'Too many OTP requests for this email. Please try again later.',
          ),
        )
      }
    }

    if (ip) {
      const c = bumpCounter(ipOtpRequestCounters, ip, windowMs)
      if (c.count > maxPerIp) {
        return next(
          new AppError(
            ErrorCode.TOO_MANY_REQUESTS,
            429,
            'Too many OTP requests from this IP. Please try again later.',
          ),
        )
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

  return (req: Request, _res: Response, next: NextFunction) => {
    const address = typeof req.body?.address === 'string' ? req.body.address : ''
    const ip = req.ip

    if (address) {
      const c = bumpCounter(walletChallengeRequestCounters, address.toLowerCase(), windowMs)
      if (c.count > maxPerAddress) {
        return next(
          new AppError(
            ErrorCode.TOO_MANY_REQUESTS,
            429,
            'Too many requests for this wallet. Please try again later.',
          ),
        )
      }
    }

    if (ip) {
      const c = bumpCounter(ipWalletChallengeRequestCounters, ip, windowMs)
      if (c.count > maxPerIp) {
        return next(
          new AppError(
            ErrorCode.TOO_MANY_REQUESTS,
            429,
            'Too many requests from this IP. Please try again later.',
          ),
        )
      }
    }

    next()
  }
}

export function _testOnly_clearAuthRateLimits() {
  emailOtpRequestCounters.clear()
  ipOtpRequestCounters.clear()
  walletChallengeRequestCounters.clear()
  ipWalletChallengeRequestCounters.clear()
}

export function _testOnly_prefillEmailOtpCounter(email: string, count: number) {
  emailOtpRequestCounters.set(email.toLowerCase(), {
    count,
    resetAtMs: nowMs() + 15 * 60 * 1000,
  })
}
