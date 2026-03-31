import { Router, type Request, type Response, type NextFunction } from 'express'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { validate } from '../middleware/validate.js'
import { otpRequestRateLimit, walletAuthRateLimit } from '../middleware/authRateLimit.js'
import { requestOtpSchema, verifyOtpSchema, walletChallengeSchema, walletVerifySchema } from '../schemas/auth.js'
import { generateOtp, generateToken } from '../utils/tokens.js'
import { generateOtpSalt, hashOtp, verifyOtpHash } from '../utils/otp.js'
import { generateNonce, generateChallengeXdr, verifySignedChallenge, normalizeStellarAddress } from '../utils/wallet.js'
import { otpChallengeStore, sessionStore, userStore, walletChallengeStore } from '../models/authStore.js'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'
import { PostgresLinkedAddressStore } from '../models/linkedAddressStore.js'
import { createOtpDeliveryProvider } from '../services/otpDeliveryFactory.js'
import {
  auditAuthOtpRequested,
  auditAuthLoginSuccess,
  auditAuthLoginFailed,
  auditAuthLogout,
  auditAuthLogoutAll,
  auditAuthWalletChallengeIssued,
  auditAuthWalletLoginSuccess,
  auditAuthWalletLoginFailed,
} from '../utils/auditLogger.js'

const router = Router()

const OTP_TTL_MS = 10 * 60 * 1000
const OTP_TTL_MINUTES = OTP_TTL_MS / (60 * 1000)
const OTP_MAX_ATTEMPTS = 5
const WALLET_TTL_MS = 5 * 60 * 1000
const WALLET_MAX_ATTEMPTS = 3

// Initialize OTP delivery provider
const otpDeliveryProvider = createOtpDeliveryProvider()

/**
 * POST /api/auth/request-otp
 * Body: { email }
 */
router.post(
  '/request-otp',
  validate(requestOtpSchema, 'body'),
  otpRequestRateLimit(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = (req.body.email as string).toLowerCase()

      const otp = generateOtp()
      const salt = generateOtpSalt()
      const otpHash = hashOtp(otp, salt)
      const expiresAt = new Date(Date.now() + OTP_TTL_MS)

      await otpChallengeStore.set({ email, otpHash, salt, expiresAt, attempts: 0 })

      // Send OTP via configured delivery provider
      // The provider handles logging appropriately (console in dev, email in production)
      // Plaintext OTP is never stored or logged in production mode
      await otpDeliveryProvider.sendOtp(email, otp, OTP_TTL_MINUTES)

      auditAuthOtpRequested(req, { email })

      res.json({ message: 'OTP sent to your email' })
    } catch (error) {
      next(error)
    }
  },
)

/**
 * POST /api/auth/verify-otp
 * Body: { email, otp } -> { token }
 */
router.post(
  '/verify-otp',
  validate(verifyOtpSchema, 'body'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = (req.body.email as string).toLowerCase()
      const otp = req.body.otp as string

      const challenge = await otpChallengeStore.getByEmail(email)
      if (!challenge) {
        auditAuthLoginFailed(req, { email, reason: 'no_otp_challenge' })
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'No OTP requested for this email')
      }

      if (new Date() > challenge.expiresAt) {
        await otpChallengeStore.deleteByEmail(email)
        auditAuthLoginFailed(req, { email, reason: 'otp_expired' })
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'OTP has expired')
      }

      if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
        await otpChallengeStore.deleteByEmail(email)
        auditAuthLoginFailed(req, { email, reason: 'max_attempts_exceeded' })
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid OTP')
      }

      const ok = verifyOtpHash(otp, challenge.salt, challenge.otpHash)
      if (!ok) {
        await otpChallengeStore.updateAttempts(email, challenge.attempts + 1)
        auditAuthLoginFailed(req, { email, reason: 'invalid_otp' })
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid OTP')
      }

      await otpChallengeStore.deleteByEmail(email)

      const user = await userStore.getOrCreateByEmail(email)
      const token = generateToken()
      await sessionStore.create(email, token, { ip: req.ip, userAgent: req.get('User-Agent') })

      auditAuthLoginSuccess(req, { userId: user.id, email: user.email })

      res.json({ token, user })
    } catch (error) {
      next(error)
    }
  },
)

/**
 * POST /api/auth/logout
 */
router.post('/logout', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (token) {
    await sessionStore.deleteByToken(token)
  }
  auditAuthLogout(req)
  res.json({ message: 'Logged out' })
})

/**
 * POST /api/auth/logout-all
 * Invalidates every active session for the calling user.
 */
router.post('/logout-all', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const email = req.user!.email
  const count = sessionStore.revokeAllByEmail(email)
  auditAuthLogoutAll(req, { userId: req.user!.id, sessionCount: count })
  res.json({ message: `Logged out from ${count} session(s)` })
})

/**
 * GET /api/auth/me
 */
router.get('/me', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  res.json({ user: req.user })
})

/**
 * POST /api/auth/wallet/challenge
 * Body: { address } -> { challengeXdr, expiresAt }
 */
router.post(
  '/wallet/challenge',
  validate(walletChallengeSchema, 'body'),
  walletAuthRateLimit(),
  async (req: Request, res: Response, next: NextFunction) => {
    const address = req.body.address as string
    const normalizedAddress = normalizeStellarAddress(address)

    // Check if wallet is already linked to another user
    const existingUser = await userStore.getByWalletAddress(normalizedAddress)
    if (existingUser) {
      // Allow existing user to request new challenge
    }

    const nonce = generateNonce()
    const challengeXdr = generateChallengeXdr(address, nonce)
    const expiresAt = new Date(Date.now() + WALLET_TTL_MS)

    await walletChallengeStore.set({
      address: normalizedAddress,
      challengeXdr,
      nonce,
      expiresAt,
      attempts: 0,
    })

    auditAuthWalletChallengeIssued(req, { address: normalizedAddress })

    res.json({ challengeXdr, expiresAt })
  },
)

/**
 * POST /api/auth/wallet/verify
 * Body: { address, signedChallengeXdr } -> { token, user }
 */
router.post(
  '/wallet/verify',
  validate(walletVerifySchema, 'body'),
  walletAuthRateLimit(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const address = req.body.address as string
      const signedChallengeXdr = req.body.signedChallengeXdr as string
      // Stellar public keys are base32/uppercase — use normalizeStellarAddress, never toLowerCase
      const normalizedAddress = normalizeStellarAddress(address)

      const challenge = await walletChallengeStore.getByAddress(normalizedAddress)
      if (!challenge) {
        auditAuthWalletLoginFailed(req, { address: normalizedAddress, reason: 'no_challenge' })
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid address or signature')
      }

      if (new Date() > challenge.expiresAt) {
        await walletChallengeStore.deleteByAddress(normalizedAddress)
        auditAuthWalletLoginFailed(req, { address: normalizedAddress, reason: 'challenge_expired' })
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid address or signature')
      }

      if (challenge.attempts >= WALLET_MAX_ATTEMPTS) {
        await walletChallengeStore.deleteByAddress(normalizedAddress)
        auditAuthWalletLoginFailed(req, { address: normalizedAddress, reason: 'max_attempts_exceeded' })
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid address or signature')
      }

      // Pass original-case address to the Stellar SDK — it requires uppercase keys
      const isValid = verifySignedChallenge(address, signedChallengeXdr, challenge.nonce)
      if (!isValid) {
        await walletChallengeStore.updateAttempts(normalizedAddress, challenge.attempts + 1)
        auditAuthWalletLoginFailed(req, { address: normalizedAddress, reason: 'invalid_signature' })
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid address or signature')
      }

      await walletChallengeStore.deleteByAddress(normalizedAddress)

      // Check if user already exists with this wallet
      let user = await userStore.getByWalletAddress(normalizedAddress)

      if (!user) {
        const placeholderEmail = `${normalizedAddress}@wallet.user`
        user = await userStore.getOrCreateByEmail(placeholderEmail)
        await userStore.linkWalletToUser(placeholderEmail, normalizedAddress)
        user.name = `Wallet ${normalizedAddress.slice(0, 6)}...${normalizedAddress.slice(-4)}`
      }

      const token = generateToken()
      await sessionStore.create(user.email, token, { ip: req.ip, userAgent: req.get('User-Agent') })

      if (process.env.DATABASE_URL) {
        const linkedAddressStore = new PostgresLinkedAddressStore()
        try {
          await linkedAddressStore.setLinkedAddress(user.id, normalizedAddress)
        } catch (error) {
          console.error('Failed to set linked address:', error)
        }
      }

      auditAuthWalletLoginSuccess(req, { address: normalizedAddress, userId: user.id })

      res.json({ token, user })
    } catch (error) {
      next(error)
    }
  },
)

export default router