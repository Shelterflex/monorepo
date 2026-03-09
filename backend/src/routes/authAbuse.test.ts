import { describe, it, expect, beforeEach, vi } from 'vitest'
import supertest from 'supertest'
import express from 'express'
import { errorHandler } from '../middleware/errorHandler.js'
import { requestIdMiddleware } from '../middleware/requestId.js'
import { validate } from '../middleware/validate.js'
import { walletChallengeSchema, walletVerifySchema } from '../schemas/auth.js'
import { walletChallengeStore, userStore, sessionStore } from '../models/authStore.js'
import { walletAuthRateLimit, _testOnly_clearAuthRateLimits } from '../middleware/authRateLimit.js'
import { generateNonce, createChallengeMessage, verifySignature } from '../utils/wallet.js'
import { generateToken } from '../utils/tokens.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { ethers } from 'ethers'

// ---- Build a minimal express app that shares the same module-level stores ----
const WALLET_TTL_MS = 5 * 60 * 1000
const WALLET_MAX_ATTEMPTS = 3

function buildApp(rateLimitOptions?: { maxPerAddress?: number; maxPerIp?: number; windowMs?: number }) {
  const app = express()
  app.use(requestIdMiddleware)
  app.use(express.json())

  app.post(
    '/api/auth/wallet/challenge',
    validate(walletChallengeSchema, 'body'),
    walletAuthRateLimit(rateLimitOptions),
    (req, res) => {
      const address = (req.body.address as string).toLowerCase()
      const nonce = generateNonce()
      const message = createChallengeMessage(address, nonce)
      const expiresAt = new Date(Date.now() + WALLET_TTL_MS)
      walletChallengeStore.set({ address, message, nonce, expiresAt, attempts: 0 })
      res.json({ message, nonce })
    },
  )

  app.post(
    '/api/auth/wallet/verify',
    validate(walletVerifySchema, 'body'),
    walletAuthRateLimit(rateLimitOptions),
    async (req, res, next) => {
      try {
        const address = (req.body.address as string).toLowerCase()
        const signature = req.body.signature as string

        const challenge = walletChallengeStore.getByAddress(address)
        if (!challenge) {
          throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid address or signature')
        }
        if (new Date() > challenge.expiresAt) {
          walletChallengeStore.deleteByAddress(address)
          throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid address or signature')
        }
        if (challenge.attempts >= WALLET_MAX_ATTEMPTS) {
          walletChallengeStore.deleteByAddress(address)
          throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid address or signature')
        }

        const isValid = verifySignature(address, challenge.message, signature)
        if (!isValid) {
          challenge.attempts += 1
          walletChallengeStore.set(challenge)
          throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid address or signature')
        }

        walletChallengeStore.deleteByAddress(address)
        const placeholderEmail = `${address}@wallet.user`
        const user = userStore.getOrCreateByEmail(placeholderEmail)
        userStore.linkWalletToUser(placeholderEmail, address)

        const token = generateToken()
        sessionStore.create(user.email, token)
        res.json({ token, user })
      } catch (err) {
        next(err)
      }
    },
  )

  app.use(errorHandler)
  return app
}

describe('Wallet Auth Abuse Protection', () => {
  beforeEach(() => {
    walletChallengeStore.clear()
    userStore.clear()
    sessionStore.clear()
    _testOnly_clearAuthRateLimits()
    vi.useRealTimers()
  })

  it('replay: should fail when using a nonce that has already been verified (single-use)', async () => {
    const wallet = ethers.Wallet.createRandom()
    const address = wallet.address
    const app = buildApp()
    const request = supertest(app)

    const challengeRes = await request.post('/api/auth/wallet/challenge').send({ address }).expect(200)
    const { message } = challengeRes.body
    const signature = await wallet.signMessage(message)

    // First verify — succeeds
    await request.post('/api/auth/wallet/verify').send({ address, signature }).expect(200)

    // Replay — challenge is gone, must fail
    const replayRes = await request.post('/api/auth/wallet/verify').send({ address, signature })
    expect(replayRes.status).toBe(401)
    expect(replayRes.body.error.message).toBe('Invalid address or signature')
  })

  it('expiry: should fail when challenge has expired', async () => {
    const wallet = ethers.Wallet.createRandom()
    const address = wallet.address
    const app = buildApp()
    const request = supertest(app)

    vi.useFakeTimers()

    const challengeRes = await request.post('/api/auth/wallet/challenge').send({ address }).expect(200)
    const { message } = challengeRes.body
    const signature = await wallet.signMessage(message)

    // Advance past the 5-minute TTL
    vi.advanceTimersByTime(6 * 60 * 1000)

    const res = await request.post('/api/auth/wallet/verify').send({ address, signature })
    expect(res.status).toBe(401)
    expect(res.body.error.message).toBe('Invalid address or signature')

    // Challenge should be cleaned up
    expect(walletChallengeStore.getByAddress(address)).toBeUndefined()
  })

  it('brute force: should lock out after too many failed signature attempts', async () => {
    const legitWallet = ethers.Wallet.createRandom()
    const attackerWallet = ethers.Wallet.createRandom()
    const address = legitWallet.address
    const app = buildApp()
    const request = supertest(app)

    const challengeRes = await request.post('/api/auth/wallet/challenge').send({ address }).expect(200)
    const { message } = challengeRes.body

    // Sign with a DIFFERENT wallet — valid EVM signature format but wrong key
    for (let i = 0; i < WALLET_MAX_ATTEMPTS; i++) {
      const wrongSig = await attackerWallet.signMessage(message)
      const res = await request.post('/api/auth/wallet/verify').send({ address, signature: wrongSig })
      expect(res.status).toBe(401)
      expect(res.body.error.message).toBe('Invalid address or signature')
    }

    // Even with the real key, challenge is deleted — must fail
    const validSig = await legitWallet.signMessage(message)
    const res = await request.post('/api/auth/wallet/verify').send({ address, signature: validSig })
    expect(res.status).toBe(401)
    expect(res.body.error.message).toBe('Invalid address or signature')
    expect(walletChallengeStore.getByAddress(address)).toBeUndefined()
  })

  it('rate limit: should throttle challenge requests per address', async () => {
    const wallet = ethers.Wallet.createRandom()
    const address = wallet.address
    // Use a tight per-address limit so the test is fast
    const app = buildApp({ maxPerAddress: 3, maxPerIp: 10_000 })
    const request = supertest(app)

    for (let i = 0; i < 3; i++) {
      await request.post('/api/auth/wallet/challenge').send({ address }).expect(200)
    }

    const res = await request.post('/api/auth/wallet/challenge').send({ address })
    expect(res.status).toBe(429)
    expect(res.body.error.message).toContain('Too many requests for this wallet')
  })

  it('non-enumerating: verify with no challenge should return same error as wrong signature', async () => {
    const wallet = ethers.Wallet.createRandom()
    const address = wallet.address
    const app = buildApp()
    const request = supertest(app)

    // No challenge created — error must not reveal whether address exists
    const wrongSig = await ethers.Wallet.createRandom().signMessage('some message')
    const res = await request.post('/api/auth/wallet/verify').send({ address, signature: wrongSig })
    expect(res.status).toBe(401)
    expect(res.body.error.message).toBe('Invalid address or signature')
  })
})
