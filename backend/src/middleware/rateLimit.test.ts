import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '../errors/AppError.js'
import { createSensitiveRateLimiters, _testOnly_clearRateLimitState } from './rateLimit.js'

function buildEnvLike() {
  return {
    RATE_LIMIT_STORE: 'memory',
    ADMIN_RATE_LIMIT_WINDOW_MS: 1_000,
    ADMIN_RATE_LIMIT_MAX_REQUESTS: 2,
    ADMIN_RISK_RATE_LIMIT_WINDOW_MS: 1_000,
    ADMIN_RISK_RATE_LIMIT_MAX_REQUESTS: 2,
    ADMIN_RECONCILIATION_RATE_LIMIT_WINDOW_MS: 1_000,
    ADMIN_RECONCILIATION_RATE_LIMIT_MAX_REQUESTS: 2,
    WALLET_CREATE_RATE_LIMIT_WINDOW_MS: 1_000,
    WALLET_CREATE_RATE_LIMIT_MAX_REQUESTS: 2,
    WALLET_SIGN_RATE_LIMIT_WINDOW_MS: 1_000,
    WALLET_SIGN_RATE_LIMIT_MAX_REQUESTS: 1,
    NGN_WITHDRAW_RATE_LIMIT_WINDOW_MS: 1_000,
    NGN_WITHDRAW_RATE_LIMIT_MAX_REQUESTS: 1,
    NGN_TOPUP_RATE_LIMIT_WINDOW_MS: 1_000,
    NGN_TOPUP_RATE_LIMIT_MAX_REQUESTS: 1,
  }
}

async function invoke(
  handler: ReturnType<typeof createSensitiveRateLimiters>[keyof ReturnType<typeof createSensitiveRateLimiters>],
  ip = '127.0.0.1',
) {
  const headers = new Map<string, string>()
  let nextError: unknown

  const req = {
    ip,
    headers: {},
  } as any

  const res = {
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), String(value))
      return this
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase())
    },
  } as any

  await handler(req, res, (error?: unknown) => {
    nextError = error
  })

  return { headers, nextError: nextError as AppError | undefined }
}

describe('sensitive rate limiting middleware', () => {
  beforeEach(() => {
    _testOnly_clearRateLimitState()
  })

  it('returns a rate-limit error with retry-after headers after the configured limit is exceeded', async () => {
    const limiters = createSensitiveRateLimiters(buildEnvLike() as any)

    await invoke(limiters.admin)
    await invoke(limiters.admin)
    const blocked = await invoke(limiters.admin)

    expect(blocked.nextError?.status).toBe(429)
    expect(blocked.nextError?.code).toBe('TOO_MANY_REQUESTS')
    expect(blocked.nextError?.message).toBe('Too many admin requests. Please try again later.')
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(blocked.headers.get('x-ratelimit-limit')).toBe('2')
    expect(blocked.headers.get('x-ratelimit-remaining')).toBe('0')
  })

  it('tracks limits independently per sensitive endpoint bucket', async () => {
    const limiters = createSensitiveRateLimiters(buildEnvLike() as any)

    await invoke(limiters.admin)
    await invoke(limiters.admin)
    const blockedAdmin = await invoke(limiters.admin)
    const walletAttempt = await invoke(limiters.walletSigning)

    expect(blockedAdmin.nextError?.status).toBe(429)
    expect(walletAttempt.nextError).toBeUndefined()
    expect(walletAttempt.headers.get('x-ratelimit-remaining')).toBe('0')
  })
})
