import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestAgent, expectErrorShape } from '../test-helpers.js'
import { otpChallengeStore, sessionStore, userStore, walletChallengeStore } from '../models/authStore.js'
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
    walletChallengeStore.clear()
    _testOnly_clearAuthRateLimits()
    vi.useRealTimers()
    // Reset request count for test agent by creating fresh instance
    vi.stubEnv('STELLAR_SERVER_SECRET_KEY', 'SBQWY3DNPFWGSQZ7BHHCQLZNX35O6W23DMU4Y3FJ3A6BKGWXOQ5F3Z2O')
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

describe('Auth Routes (Wallet)', () => {
  const request = createTestAgent()

  beforeEach(() => {
    otpChallengeStore.clear()
    sessionStore.clear()
    userStore.clear()
    walletChallengeStore.clear()
    _testOnly_clearAuthRateLimits()
    vi.useRealTimers()
    vi.stubEnv('STELLAR_SERVER_SECRET_KEY', 'SBQWY3DNPFWGSQZ7BHHCQLZNX35O6W23DMU4Y3FJ3A6BKGWXOQ5F3Z2O')
  })

  it('POST /api/auth/wallet/challenge should create challenge XDR', async () => {
    const address = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

    const res = await request.post('/api/auth/wallet/challenge').send({ address })
    expect(res.status).toBe(200)

    expect(res.body).toHaveProperty('challengeXdr')
    expect(res.body).toHaveProperty('expiresAt')

    const challenge = walletChallengeStore.getByAddress(address.toLowerCase())
    expect(challenge).toBeDefined()
    expect(challenge!.address).toBe(address.toLowerCase())
    expect(typeof challenge!.challengeXdr).toBe('string')
    expect(challenge!.attempts).toBe(0)
  })

  it.skip('POST /api/auth/wallet/verify should return session token on success', async () => {
    // TODO: Implement with proper mocking of Stellar SDK
  })

  it('POST /api/auth/wallet/verify should fail with expired challenge', async () => {
    const address = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

    // Create an expired challenge
    const expiredChallenge = {
      address: address.toLowerCase(),
      challengeXdr: 'mock-xdr',
      nonce: 'mock-nonce',
      expiresAt: new Date(Date.now() - 1000), // Already expired
      attempts: 0,
    }
    walletChallengeStore.set(expiredChallenge)

    const res = await request.post('/api/auth/wallet/verify').send({
      address,
      signedChallengeXdr: 'mock-signed-xdr',
    })

    expect(res.status).toBe(401)
    expect(res.body.message).toBe('Challenge has expired')
  })

  it('verify should increment attempts and eventually fail after too many attempts', async () => {
    const address = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

    // Create a challenge
    const challenge = {
      address: address.toLowerCase(),
      challengeXdr: 'mock-xdr',
      nonce: 'mock-nonce',
      expiresAt: new Date(Date.now() + 60000),
      attempts: 0,
    }
    walletChallengeStore.set(challenge)

    for (let i = 0; i < 3; i++) {
      const res = await request.post('/api/auth/wallet/verify').send({
        address,
        signedChallengeXdr: 'invalid-xdr',
      })
      expect(res.status).toBe(401)
    }

    const res = await request.post('/api/auth/wallet/verify').send({
      address,
      signedChallengeXdr: 'still-invalid-xdr',
    })
    expect(res.status).toBe(401)
    expect(res.body.message).toBe('Too many failed attempts')
  })
})
