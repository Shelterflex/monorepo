import { describe, it, expect, beforeEach, vi } from 'vitest'
import supertest from 'supertest'
import express from 'express'
import { Keypair, TransactionBuilder, Networks, Transaction, xdr } from '@stellar/stellar-sdk'
import { errorHandler } from '../middleware/errorHandler.js'
import { requestIdMiddleware } from '../middleware/requestId.js'
import { validate } from '../middleware/validate.js'
import { walletChallengeSchema, walletVerifySchema } from '../schemas/auth.js'
import { walletChallengeStore, userStore, sessionStore } from '../models/authStore.js'
import { walletAuthRateLimit, _testOnly_clearAuthRateLimits } from '../middleware/authRateLimit.js'
import { generateNonce, generateChallengeXdr, verifySignedChallenge } from '../utils/wallet.js'
import { generateToken } from '../utils/tokens.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

const WALLET_TTL_MS = 5 * 60 * 1000
const WALLET_MAX_ATTEMPTS = 3

/** Signs a Stellar challenge XDR and returns the signed XDR (base64). */
async function signChallengeXdr(keypair: Keypair, challengeXdr: string): Promise<string> {
  const envelope = xdr.TransactionEnvelope.fromXDR(challengeXdr, 'base64')
  const tx = new Transaction(envelope, Networks.TESTNET)
  tx.sign(keypair)
  return tx.toEnvelope().toXDR('base64')
}

function buildApp(rateLimitOptions?: { maxPerAddress?: number; maxPerIp?: number; windowMs?: number }) {
  const app = express()
  app.use(requestIdMiddleware)
  app.use(express.json())

  app.post(
    '/api/auth/wallet/challenge',
    validate(walletChallengeSchema, 'body'),
    walletAuthRateLimit(rateLimitOptions),
    async (req, res) => {
      const address = req.body.address as string
      const normalizedAddress = address.toLowerCase()
      const nonce = generateNonce()
      const challengeXdr = generateChallengeXdr(address, nonce)
      const expiresAt = new Date(Date.now() + WALLET_TTL_MS)
      await walletChallengeStore.set({ address: normalizedAddress, challengeXdr, nonce, expiresAt, attempts: 0 })
      res.json({ challengeXdr, expiresAt })
    },
  )

  app.post(
    '/api/auth/wallet/verify',
    validate(walletVerifySchema, 'body'),
    walletAuthRateLimit(rateLimitOptions),
    async (req, res, next) => {
      try {
        const address = req.body.address as string
        const signedChallengeXdr = req.body.signedChallengeXdr as string
        const normalizedAddress = address.toLowerCase()

        const challenge = await walletChallengeStore.getByAddress(normalizedAddress)
        if (!challenge) throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid address or signature')

        if (new Date() > challenge.expiresAt) {
          await walletChallengeStore.deleteByAddress(normalizedAddress)
          throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid address or signature')
        }

        if (challenge.attempts >= WALLET_MAX_ATTEMPTS) {
          await walletChallengeStore.deleteByAddress(normalizedAddress)
          throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid address or signature')
        }

        // Pass original-case address — Stellar SDK requires uppercase
        const isValid = verifySignedChallenge(address, signedChallengeXdr, challenge.nonce)
        if (!isValid) {
          challenge.attempts += 1
          await walletChallengeStore.set(challenge)
          throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid address or signature')
        }

        await walletChallengeStore.deleteByAddress(normalizedAddress)
        const token = generateToken()
        const placeholderEmail = `${normalizedAddress}@wallet.user`
        await userStore.getOrCreateByEmail(placeholderEmail)
        await sessionStore.create(placeholderEmail, token)
        res.json({ token })
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
    const keypair = Keypair.random()
    const address = keypair.publicKey()
    const app = buildApp()
    const request = supertest(app)

    const { body } = await request.post('/api/auth/wallet/challenge').send({ address }).expect(200)
    const signedChallengeXdr = await signChallengeXdr(keypair, body.challengeXdr)

    // First verify — success
    await request.post('/api/auth/wallet/verify').send({ address, signedChallengeXdr }).expect(200)

    // Replay — challenge is consumed, must fail
    const replay = await request.post('/api/auth/wallet/verify').send({ address, signedChallengeXdr })
    expect(replay.status).toBe(401)
    expect(replay.body.error.message).toBe('Invalid address or signature')
  })

  it('expiry: should fail when challenge has expired', async () => {
    const keypair = Keypair.random()
    const address = keypair.publicKey()
    const app = buildApp()
    const request = supertest(app)

    vi.useFakeTimers()

    const { body } = await request.post('/api/auth/wallet/challenge').send({ address }).expect(200)
    const signedChallengeXdr = await signChallengeXdr(keypair, body.challengeXdr)

    // Advance past the 5-minute TTL
    vi.advanceTimersByTime(6 * 60 * 1000)

    const res = await request.post('/api/auth/wallet/verify').send({ address, signedChallengeXdr })
    expect(res.status).toBe(401)
    expect(res.body.error.message).toBe('Invalid address or signature')
    await expect(walletChallengeStore.getByAddress(address.toLowerCase())).resolves.toBeUndefined()
  })

  it('brute force: should lock out after too many wrong-key attempts', async () => {
    const legitKeypair = Keypair.random()
    const attackerKeypair = Keypair.random()
    const address = legitKeypair.publicKey()
    const app = buildApp()
    const request = supertest(app)

    const { body } = await request.post('/api/auth/wallet/challenge').send({ address }).expect(200)

    // Sign with attacker key — valid XDR format but wrong signer
    for (let i = 0; i < WALLET_MAX_ATTEMPTS; i++) {
      const wrongXdr = await signChallengeXdr(attackerKeypair, body.challengeXdr)
      const res = await request.post('/api/auth/wallet/verify').send({ address, signedChallengeXdr: wrongXdr })
      expect(res.status).toBe(401)
      expect(res.body.error.message).toBe('Invalid address or signature')
    }

    // Even with the real key now, challenge is deleted
    const validXdr = await signChallengeXdr(legitKeypair, body.challengeXdr)
    const res = await request.post('/api/auth/wallet/verify').send({ address, signedChallengeXdr: validXdr })
    expect(res.status).toBe(401)
    await expect(walletChallengeStore.getByAddress(address.toLowerCase())).resolves.toBeUndefined()
  })

  it('rate limit: should throttle challenge requests per address', async () => {
    const keypair = Keypair.random()
    const address = keypair.publicKey()
    const app = buildApp({ maxPerAddress: 3, maxPerIp: 10_000 })
    const request = supertest(app)

    for (let i = 0; i < 3; i++) {
      await request.post('/api/auth/wallet/challenge').send({ address }).expect(200)
    }

    const res = await request.post('/api/auth/wallet/challenge').send({ address })
    expect(res.status).toBe(429)
    expect(res.body.error.message).toContain('Too many requests for this wallet')
  })

  it('non-enumerating: missing challenge returns same error as wrong signature', async () => {
    const keypair = Keypair.random()
    const address = keypair.publicKey()
    const app = buildApp()
    const request = supertest(app)

    // No challenge was stored for this address — just send any string as the XDR
    const res = await request
      .post('/api/auth/wallet/verify')
      .send({ address, signedChallengeXdr: 'not-a-real-xdr' })
    expect(res.status).toBe(401)
    expect(res.body.error.message).toBe('Invalid address or signature')
  })
})
