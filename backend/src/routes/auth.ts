import { Router, type Request, type Response } from 'express'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { validate } from '../middleware/validate.js'
import { otpRequestRateLimit } from '../middleware/authRateLimit.js'
import { requestOtpSchema, verifyOtpSchema, walletChallengeSchema, walletVerifySchema } from '../schemas/auth.js'
import { generateOtp, generateToken } from '../utils/tokens.js'
import { generateOtpSalt, hashOtp, verifyOtpHash } from '../utils/otp.js'
import { generateNonce, createChallengeMessage, verifySignature } from '../utils/wallet.js'
import { otpChallengeStore, sessionStore, userStore, walletChallengeStore } from '../models/authStore.js'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

const OTP_TTL_MS = 10 * 60 * 1000
const OTP_MAX_ATTEMPTS = 5
const WALLET_TTL_MS = 5 * 60 * 1000
const WALLET_MAX_ATTEMPTS = 3

/**
 * POST /api/auth/request-otp
 * Body: { email }
 */
router.post(
  '/request-otp',
  validate(requestOtpSchema, 'body'),
  otpRequestRateLimit(),
  (req: Request, res: Response) => {
    const email = (req.body.email as string).toLowerCase()

    const otp = generateOtp()
    const salt = generateOtpSalt()
    const otpHash = hashOtp(otp, salt)
    const expiresAt = new Date(Date.now() + OTP_TTL_MS)

    otpChallengeStore.set({ email, otpHash, salt, expiresAt, attempts: 0 })

    // MVP: No email provider integrated. For development, log OTP.
    // Never persist plaintext OTP.
    console.log(`[auth] OTP for ${email}: ${otp}`)

    res.json({ message: 'OTP sent to your email' })
  },
)

/**
 * POST /api/auth/verify-otp
 * Body: { email, otp } -> { token }
 */
router.post(
  '/verify-otp',
  validate(verifyOtpSchema, 'body'),
  (req: Request, res: Response) => {
    const email = (req.body.email as string).toLowerCase()
    const otp = req.body.otp as string

    const challenge = otpChallengeStore.getByEmail(email)
    if (!challenge) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'No OTP requested for this email')
    }

    if (new Date() > challenge.expiresAt) {
      otpChallengeStore.deleteByEmail(email)
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'OTP has expired')
    }

    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      otpChallengeStore.deleteByEmail(email)
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid OTP')
    }

    const ok = verifyOtpHash(otp, challenge.salt, challenge.otpHash)
    if (!ok) {
      challenge.attempts += 1
      otpChallengeStore.set(challenge)
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid OTP')
    }

    otpChallengeStore.deleteByEmail(email)

    const user = userStore.getOrCreateByEmail(email)
    const token = generateToken()
    sessionStore.create(email, token)

    res.json({ token, user })
  },
)

/**
 * POST /api/auth/logout
 */
router.post('/logout', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (token) {
    sessionStore.deleteByToken(token)
  }
  res.json({ message: 'Logged out' })
})

/**
 * GET /api/auth/me
 */
router.get('/me', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  res.json({ user: req.user })
})

/**
 * POST /api/auth/wallet/challenge
 * Body: { address } -> { message, nonce }
 */
router.post(
  '/wallet/challenge',
  validate(walletChallengeSchema, 'body'),
  (req: Request, res: Response) => {
    const address = req.body.address as string
    const normalizedAddress = address.toLowerCase()

    // Check if wallet is already linked to another user
    const existingUser = userStore.getByWalletAddress(normalizedAddress)
    if (existingUser) {
      // Allow existing user to request new challenge
    }

    const nonce = generateNonce()
    const message = createChallengeMessage(address, nonce)
    const expiresAt = new Date(Date.now() + WALLET_TTL_MS)

    walletChallengeStore.set({
      address: normalizedAddress,
      message,
      nonce,
      expiresAt,
      attempts: 0,
    })

    res.json({ message, nonce })
  },
)

/**
 * POST /api/auth/wallet/verify
 * Body: { address, signature } -> { token, user }
 */
router.post(
  '/wallet/verify',
  validate(walletVerifySchema, 'body'),
  (req: Request, res: Response) => {
    const address = req.body.address as string
    const signature = req.body.signature as string
    const normalizedAddress = address.toLowerCase()

    const challenge = walletChallengeStore.getByAddress(normalizedAddress)
    if (!challenge) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'No challenge requested for this address')
    }

    if (new Date() > challenge.expiresAt) {
      walletChallengeStore.deleteByAddress(normalizedAddress)
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Challenge has expired')
    }

    if (challenge.attempts >= WALLET_MAX_ATTEMPTS) {
      walletChallengeStore.deleteByAddress(normalizedAddress)
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Too many failed attempts')
    }

    const isValid = verifySignature(normalizedAddress, challenge.message, signature)
    if (!isValid) {
      challenge.attempts += 1
      walletChallengeStore.set(challenge)
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid signature')
    }

    walletChallengeStore.deleteByAddress(normalizedAddress)

    // Check if user already exists with this wallet
    let user = userStore.getByWalletAddress(normalizedAddress)
    
    if (!user) {
      // Create new user with wallet as primary identifier
      // We need an email for the user store, so we'll create a placeholder
      const placeholderEmail = `${normalizedAddress}@wallet.user`
      user = userStore.getOrCreateByEmail(placeholderEmail)
      userStore.linkWalletToUser(placeholderEmail, normalizedAddress)
      user.name = `Wallet ${normalizedAddress.slice(0, 6)}...${normalizedAddress.slice(-4)}`
    }

    const token = generateToken()
    sessionStore.create(user.email, token)

    res.json({ token, user })
  },
)

export default router