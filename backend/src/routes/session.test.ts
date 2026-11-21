import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestAgent, expectErrorShape, RATE_LIMIT_BYPASS_TOKEN } from '../test-helpers.js'
import { sessionStore, userStore, otpChallengeStore, SESSION_TTL_MS } from '../models/authStore.js'
import { _testOnly_clearAuthRateLimits } from '../middleware/authRateLimit.js'
import { resetRateLimitStore } from '../middleware/comprehensiveRateLimit.js'

vi.mock('../utils/tokens.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../utils/tokens.js')>()
  return {
    ...mod,
    generateOtp: () => '123456',
    generateToken: () => `tok-${Math.random().toString(36).slice(2)}`,
  }
})

describe('Session Hardening', () => {
  const email = 'sessiontest@example.com'

  async function freshState() {
    sessionStore.clear()
    userStore.clear()
    otpChallengeStore.clear()
    _testOnly_clearAuthRateLimits()
    await resetRateLimitStore()
    vi.useRealTimers()
  }

  beforeEach(freshState)

  async function loginAndGetToken(agent: ReturnType<typeof createTestAgent>): Promise<string> {
    _testOnly_clearAuthRateLimits()
    await agent
      .post('/api/auth/request-otp')
      .set('x-ratelimit-bypass', RATE_LIMIT_BYPASS_TOKEN)
      .send({ email })
      .expect(200)
    const res = await agent
      .post('/api/auth/verify-otp')
      .set('x-ratelimit-bypass', RATE_LIMIT_BYPASS_TOKEN)
      .send({ email, otp: '123456' })
      .expect(200)
    return res.body.token as string
  }

  it('expired token should be rejected with 401', async () => {
    const agent = createTestAgent()
    const token = await loginAndGetToken(agent)

    // Advance past access token TTL (15 minutes)
    vi.useFakeTimers()
    vi.advanceTimersByTime(SESSION_TTL_MS + 1000)

    const res = await agent
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .set('x-ratelimit-bypass', RATE_LIMIT_BYPASS_TOKEN)
    vi.useRealTimers()

    expect(res.status).toBe(401)
    expect(res.body.error.message).toBe('Access token expired')
  })

  it('logout: token is immediately invalidated', async () => {
    const agent = createTestAgent()
    const token = await loginAndGetToken(agent)

    // Confirm it works before logout
    await agent
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .set('x-ratelimit-bypass', RATE_LIMIT_BYPASS_TOKEN)
      .expect(200)

    // Logout
    await agent
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .set('x-ratelimit-bypass', RATE_LIMIT_BYPASS_TOKEN)
      .expect(200)

    // Now it must fail with Invalid token
    const res = await agent
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .set('x-ratelimit-bypass', RATE_LIMIT_BYPASS_TOKEN)
    expect(res.status).toBe(401)
    expect(res.body.error.message).toBe('Invalid token')
  })

  it('logout-all: all sessions for the user are invalidated', async () => {
    const agent = createTestAgent()

    const token1 = await loginAndGetToken(agent)
    const token2 = await loginAndGetToken(agent)

    // Both work
    await agent
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token1}`)
      .set('x-ratelimit-bypass', RATE_LIMIT_BYPASS_TOKEN)
      .expect(200)
    await agent
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token2}`)
      .set('x-ratelimit-bypass', RATE_LIMIT_BYPASS_TOKEN)
      .expect(200)

    // Logout-all using token1
    const logoutRes = await agent
      .post('/api/auth/logout-all')
      .set('Authorization', `Bearer ${token1}`)
      .set('x-ratelimit-bypass', RATE_LIMIT_BYPASS_TOKEN)
      .expect(200)
    expect(logoutRes.body.message).toMatch(/2 session/)

    // Both tokens must now be invalid
    expectErrorShape(
      await agent
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token1}`)
        .set('x-ratelimit-bypass', RATE_LIMIT_BYPASS_TOKEN),
      'INVALID_TOKEN',
      401,
    )
    expectErrorShape(
      await agent
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token2}`)
        .set('x-ratelimit-bypass', RATE_LIMIT_BYPASS_TOKEN),
      'INVALID_TOKEN',
      401,
    )
  })

  it('revoked token is rejected even if not yet expired', async () => {
    const agent = createTestAgent()
    const token = await loginAndGetToken(agent)

    sessionStore.revokeByToken(token)

    const res = await agent
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .set('x-ratelimit-bypass', RATE_LIMIT_BYPASS_TOKEN)
    expect(res.status).toBe(401)
    expect(res.body.error.message).toBe('Invalid token')
  })

  it('missing token returns 401', async () => {
    const agent = createTestAgent()
    const res = await agent
      .get('/api/auth/me')
      .set('x-ratelimit-bypass', RATE_LIMIT_BYPASS_TOKEN)
    expectErrorShape(res, 'UNAUTHORIZED', 401)
  })

  it('session stores userAgent when provided', async () => {
    const agent = createTestAgent()
    _testOnly_clearAuthRateLimits()

    await agent
      .post('/api/auth/request-otp')
      .set('x-ratelimit-bypass', RATE_LIMIT_BYPASS_TOKEN)
      .send({ email })
      .expect(200)
    await agent
      .post('/api/auth/verify-otp')
      .set('x-ratelimit-bypass', RATE_LIMIT_BYPASS_TOKEN)
      .set('User-Agent', 'TestBrowser/1.0')
      .send({ email, otp: '123456' })
      .expect(200)

    const sessions = sessionStore.getActiveSessionsByEmail(email)
    expect(sessions.length).toBe(1)
    expect(sessions[0].userAgent).toBe('TestBrowser/1.0')
  })

  it('session has a 15-minute expiry by default', async () => {
    const agent = createTestAgent()
    await loginAndGetToken(agent)

    const sessions = sessionStore.getActiveSessionsByEmail(email)
    expect(sessions.length).toBeGreaterThan(0)

    const ttlMs = sessions[0].expiresAt.getTime() - sessions[0].createdAt.getTime()
    expect(ttlMs).toBeGreaterThanOrEqual(SESSION_TTL_MS - 1000)
    expect(ttlMs).toBeLessThanOrEqual(SESSION_TTL_MS + 1000)
  })
})
