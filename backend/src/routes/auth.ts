import { Router, type Request, type Response, type NextFunction } from 'express'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { validate } from '../middleware/validate.js'
import { otpRequestRateLimit, otpVerifyRateLimit, refreshTokenRateLimit, walletAuthRateLimit } from '../middleware/authRateLimit.js'
import { createRateLimiter } from '../middleware/rateLimiter.js'
import { rateLimitProfiles } from '../config/rateLimitConfig.js'
import { requestOtpSchema, verifyOtpSchema, walletChallengeSchema, walletVerifySchema } from '../schemas/auth.js'
import { generateId, generateOtp, generateToken } from '../utils/tokens.js'
import { generateOtpSalt, hashOtp, verifyOtpHash } from '../utils/otp.js'
import { generateNonce, generateChallengeXdr, verifySignedChallenge, normalizeStellarAddress } from '../utils/wallet.js'
import {
  REFRESH_TOKEN_TTL_MS,
  otpChallengeStore,
  refreshTokenStore,
  sessionStore,
  userStore,
  walletChallengeStore,
} from '../models/authStore.js'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'
import { PostgresLinkedAddressStore } from '../models/linkedAddressStore.js'
import { createOtpDeliveryProvider } from '../services/otpDeliveryFactory.js'
import { detectCredentialStuffing } from '../services/abuseDetectionService.js'
import { referralService } from '../services/referralService.js'
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
import { sanitiseForClient } from '../utils/sanitiseForClient.js'

const router = Router()

const OTP_TTL_MS = 10 * 60 * 1000
const OTP_TTL_MINUTES = OTP_TTL_MS / (60 * 1000)
const OTP_MAX_ATTEMPTS = 5
const WALLET_TTL_MS = 5 * 60 * 1000
const WALLET_MAX_ATTEMPTS = 3

// Initialize OTP delivery provider
const otpDeliveryProvider = createOtpDeliveryProvider()

// Redis-backed rate limiters (issue #1046)
const authLimiter = createRateLimiter(rateLimitProfiles.auth)
const otpLimiter = createRateLimiter(rateLimitProfiles.otp)

const REFRESH_COOKIE_NAME = 'refreshToken'

function getCookie(req: Request, name: string): string | undefined {
  const cookie = req.headers.cookie
  if (!cookie) return undefined
  for (const part of cookie.split(';')) {
    const [key, ...valueParts] = part.trim().split('=')
    if (key === name) return decodeURIComponent(valueParts.join('='))
  }
  return undefined
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: REFRESH_TOKEN_TTL_MS,
    path: '/api/auth',
  })
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/api/auth',
  })
}

async function issueSessionPair(
  res: Response,
  user: { id: string; email: string },
  auditInfo: { ip?: string; userAgent?: string },
  family = generateId(),
): Promise<string> {
  const accessToken = generateToken()
  const refreshToken = generateToken()
  await sessionStore.create(user.email, accessToken, auditInfo)
  await refreshTokenStore.create({
    userId: user.id,
    email: user.email,
    rawToken: refreshToken,
    family,
  })
  setRefreshCookie(res, refreshToken)
  return accessToken
}

/**
 * POST /api/auth/request-otp
 * Body: { email }
 */
router.post(
  '/request-otp',
  validate(requestOtpSchema, 'body'),
  authLimiter,
  otpLimiter,
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
  authLimiter,
  otpLimiter,
  otpVerifyRateLimit(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = (req.body.email as string).toLowerCase()
      const otp = req.body.otp as string

      const challenge = await otpChallengeStore.getByEmail(email)
      if (!challenge) {
        auditAuthLoginFailed(req, { email, reason: 'no_otp_challenge' })
        await detectCredentialStuffing(req.ip || 'unknown')
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'No OTP requested for this email')
      }

      if (new Date() > challenge.expiresAt) {
        await otpChallengeStore.deleteByEmail(email)
        auditAuthLoginFailed(req, { email, reason: 'otp_expired' })
        await detectCredentialStuffing(req.ip || 'unknown')
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'OTP has expired')
      }

      if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
        await otpChallengeStore.deleteByEmail(email)
        auditAuthLoginFailed(req, { email, reason: 'max_attempts_exceeded' })
        await detectCredentialStuffing(req.ip || 'unknown')
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid OTP')
      }

      const ok = verifyOtpHash(otp, challenge.salt, challenge.otpHash)
      if (!ok) {
        await otpChallengeStore.updateAttempts(email, challenge.attempts + 1)
        auditAuthLoginFailed(req, { email, reason: 'invalid_otp' })
        await detectCredentialStuffing(req.ip || 'unknown')
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid OTP')
      }

      await otpChallengeStore.deleteByEmail(email)

      // Check if user exists before creation
      const existingUser = await userStore.getByEmail(email)
      const isNewUser = !existingUser

      const user = await userStore.getOrCreateByEmail(email)
      const token = await issueSessionPair(
        res,
        user,
        { ip: req.ip, userAgent: req.get('User-Agent') },
      )

      // Generate referral code for new tenants
      if (isNewUser && user.role === 'tenant') {
        try {
          await referralService.generateReferralCode(user.id)
        } catch (error) {
          // Log error but don't fail registration if referral code generation fails
          console.error('Failed to generate referral code:', error)
        }
      }

      // Apply referral code if provided (only for new users)
      const referralCode = (req.body as any).referralCode
      if (isNewUser && referralCode && user.role === 'tenant') {
        try {
          await referralService.applyReferralCode(referralCode, user.id)
        } catch (error) {
          // Log error but don't fail registration if referral code application fails
          console.error('Failed to apply referral code:', error)
        }
      }

      auditAuthLoginSuccess(req, { userId: user.id, email: user.email })

      res.json({ token, user: sanitiseForClient({ ...user }) })
    } catch (error) {
      next(error)
    }
  },
)

/**
 * POST /api/auth/refresh
 * Body/cookie: refreshToken -> { token, user }
 */
router.post(
  '/refresh',
  authLimiter,
  refreshTokenRateLimit(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const refreshToken = getCookie(req, REFRESH_COOKIE_NAME)
      if (!refreshToken) {
        throw new AppError(ErrorCode.INVALID_TOKEN, 401, 'Refresh token required')
      }

      const record = await refreshTokenStore.findByRawToken(refreshToken)
      if (!record || record.expiresAt.getTime() < Date.now()) {
        throw new AppError(ErrorCode.INVALID_TOKEN, 401, 'Invalid refresh token')
      }

      if (record.usedAt) {
        await refreshTokenStore.invalidateFamily(record.family)
        clearRefreshCookie(res)
        throw new AppError(ErrorCode.INVALID_TOKEN, 401, 'Refresh token replay detected')
      }

      await refreshTokenStore.markUsed(refreshToken)
      const token = await issueSessionPair(
        res,
        { id: record.userId, email: record.email },
        { ip: req.ip, userAgent: req.get('User-Agent') },
        record.family,
      )
      const user = await userStore.getById(record.userId)

      res.json({ token, user: user ? sanitiseForClient({ ...user }) : undefined })
    } catch (error) {
      next(error)
    }
  },
)

router.post('/logout', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (token) {
    await sessionStore.deleteByToken(token)
  }
  const refreshToken = getCookie(req, REFRESH_COOKIE_NAME)
  if (refreshToken) {
    const record = await refreshTokenStore.findByRawToken(refreshToken)
    if (record) await refreshTokenStore.invalidateFamily(record.family)
  }
  clearRefreshCookie(res)
  auditAuthLogout(req)
  res.json({ message: 'Logged out' })
})

/**
 * POST /api/auth/logout-all
 * Invalidates every active session for the calling user.
 */
router.post('/logout-all', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const email = req.user!.email
  const count = sessionStore.revokeAllByEmail(email)
  const refreshCount = await refreshTokenStore.invalidateAllByUserId(req.user!.id)
  clearRefreshCookie(res)
  auditAuthLogoutAll(req, { userId: req.user!.id, sessionCount: count + refreshCount })
  res.json({ message: `Logged out from ${count + refreshCount} session(s)` })
})

/**
 * GET /api/auth/me
 */
router.get('/me', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  res.json({ user: sanitiseForClient({ ...req.user! }) })
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
        await detectCredentialStuffing(req.ip || 'unknown')
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid address or signature')
      }

      if (new Date() > challenge.expiresAt) {
        await walletChallengeStore.deleteByAddress(normalizedAddress)
        auditAuthWalletLoginFailed(req, { address: normalizedAddress, reason: 'challenge_expired' })
        await detectCredentialStuffing(req.ip || 'unknown')
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid address or signature')
      }

      if (challenge.attempts >= WALLET_MAX_ATTEMPTS) {
        await walletChallengeStore.deleteByAddress(normalizedAddress)
        auditAuthWalletLoginFailed(req, { address: normalizedAddress, reason: 'max_attempts_exceeded' })
        await detectCredentialStuffing(req.ip || 'unknown')
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid address or signature')
      }

      // Pass original-case address to the Stellar SDK — it requires uppercase keys
      const isValid = verifySignedChallenge(address, signedChallengeXdr, challenge.nonce)
      if (!isValid) {
        await walletChallengeStore.updateAttempts(normalizedAddress, challenge.attempts + 1)
        auditAuthWalletLoginFailed(req, { address: normalizedAddress, reason: 'invalid_signature' })
        await detectCredentialStuffing(req.ip || 'unknown')
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

      const token = await issueSessionPair(
        res,
        user,
        { ip: req.ip, userAgent: req.get('User-Agent') },
      )

      if (process.env.DATABASE_URL) {
        const linkedAddressStore = new PostgresLinkedAddressStore()
        try {
          await linkedAddressStore.setLinkedAddress(user.id, normalizedAddress)
        } catch (error) {
          console.error('Failed to set linked address:', error)
        }
      }

      auditAuthWalletLoginSuccess(req, { address: normalizedAddress, userId: user.id })

      res.json({ token, user: sanitiseForClient({ ...user }) })
    } catch (error) {
      next(error)
    }
  },
)

export default router
