import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestAgent, expectErrorShape } from '../test-helpers.js'
import { otpChallengeStore, sessionStore, userStore } from '../models/authStore.js'
import { _testOnly_clearAuthRateLimits } from '../middleware/authRateLimit.js'

vi.mock('../utils/tokens.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../utils/tokens.js')>()
  return {
    ...mod,
    generateOtp: () => '123456',
    generateToken: () => 'session-token-abc',
  }
})

describe('Auth Routes (OTP)', () => {
  const request = createTestAgent()

  beforeEach(() => {
    otpChallengeStore.clear()
    sessionStore.clear()
    userStore.clear()
    _testOnly_clearAuthRateLimits()
    vi.useRealTimers()
    // Reset request count for test agent by creating fresh instance
  })

  it('POST /api/auth/request-otp should create hashed challenge (no plaintext stored)', async () => {
    const email = 'a@example.com'

    const res = await request.post('/api/auth/request-otp').send({ email })
    expect(res.status).toBe(200)

    const challenge = otpChallengeStore.getByEmail(email)
    expect(challenge).toBeDefined()
    expect(challenge!.email).toBe(email)
    expect(typeof challenge!.otpHash).toBe('string')
    expect(challenge!.otpHash).not.toBe('123456')
    expect(typeof challenge!.salt).toBe('string')
    expect(challenge!.attempts).toBe(0)
  })

  it('POST /api/auth/verify-otp should return session token on success', async () => {
    const email = 'b@example.com'

    await request.post('/api/auth/request-otp').send({ email }).expect(200)

    const res = await request
      .post('/api/auth/verify-otp')
      .send({ email, otp: '123456' })
      .expect(200)

    expect(res.body).toHaveProperty('token', 'session-token-abc')
    expect(res.body).toHaveProperty('user')
    expect(res.body.user).toHaveProperty('email', email)

    const session = sessionStore.getByToken('session-token-abc')
    expect(session).toBeDefined()
    expect(session!.email).toBe(email)
  })

  it('verify should increment attempts and eventually fail after too many attempts', async () => {
    const email = 'c@example.com'

    await request.post('/api/auth/request-otp').send({ email }).expect(200)

    for (let i = 0; i < 5; i++) {
      const res = await request.post('/api/auth/verify-otp').send({ email, otp: '000000' })
      expect(res.status).toBe(401)
    }

    const res = await request.post('/api/auth/verify-otp').send({ email, otp: '123456' })
    expect(res.status).toBe(401)
  })

  it.skip('request-otp should rate limit by email', async () => {
    // TODO: Re-enable when test agent supports custom middleware
  })

  it.skip('GET /api/auth/me should require auth and return user when authenticated', async () => {
    // TODO: Fix rate limiting test interference
  })
})
