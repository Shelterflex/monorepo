import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { AuthenticatedRequest } from '../middleware/auth.js'
import { inspectorProfileStore } from '../models/inspectorProfileStore.js'
import { userStore } from '../models/authStore.js'
import { auditLog, extractAuditContext } from '../utils/auditLogger.js'
import { logger } from '../utils/logger.js'

const onboardingSchema = z.object({
  personalInfo: z.object({
    fullName: z.string().min(1, 'Full name is required'),
    email: z.string().email('Valid email is required'),
    phone: z.string().min(5, 'Phone number is required'),
    nin: z.string().optional(),
    yearsExperience: z.union([z.string(), z.number()]).optional(),
  }),
  kyc: z.object({
    idType: z.string().optional(),
    idNumber: z.string().optional(),
    hasPassport: z.boolean().optional(),
    hasDriverLicense: z.boolean().optional(),
  }).passthrough().optional(),
  serviceAreas: z.array(z.string()).min(1, 'At least one service area is required'),
  bankDetails: z.object({
    bankName: z.string().min(1, 'Bank name is required'),
    accountNumber: z.string().min(10, 'Account number must be at least 10 digits'),
    accountName: z.string().min(1, 'Account name is required'),
    isVerified: z.boolean().optional(),
  }),
})

export function createInspectorOnboardingRouter(): Router {
  const router = Router()

  /**
   * POST /api/inspector/onboarding
   * Persists new inspector onboarding application and returns a unique inspector ID.
   */
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = onboardingSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          400,
          `Validation failed: ${parsed.error.errors.map((e) => e.message).join(', ')}`,
        )
      }

      const { personalInfo, kyc, serviceAreas, bankDetails } = parsed.data
      const authReq = req as AuthenticatedRequest
      const userId = authReq.user?.id || `usr_ins_${randomUUID().slice(0, 8)}`
      const inspectorId = `INS-${randomUUID().slice(0, 8).toUpperCase()}`

      // Create or update inspector profile
      const profile = await inspectorProfileStore.create({
        userId,
        bio: `Inspector based in ${serviceAreas.join(', ')}`,
        serviceAreas,
      })

      // Update user details if user exists in auth store
      try {
        await userStore.updateLandlordProfile(userId, {
          phone: personalInfo.phone,
          bankName: bankDetails.bankName,
          accountNumber: bankDetails.accountNumber,
          accountName: bankDetails.accountName,
        })
      } catch (err) {
        // Non-fatal if user is not pre-registered in userStore
        logger.debug('Inspector onboarding: userStore sync skipped', { userId })
      }

      logger.info('Inspector onboarding registered', {
        inspectorId,
        userId,
        email: personalInfo.email,
        serviceAreas,
      })

      res.status(201).json({
        success: true,
        message: 'Inspector onboarding completed successfully',
        inspectorId,
        userId,
        status: profile.verificationStatus,
      })
    } catch (error) {
      next(error)
    }
  })

  /**
   * GET /api/inspector/onboarding/:userId
   * Retrieves status for an onboarding applicant.
   */
  router.get('/:userId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.params
      const profile = await inspectorProfileStore.getByUserId(userId)

      if (!profile) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Inspector profile not found')
      }

      res.json({
        success: true,
        profile,
      })
    } catch (error) {
      next(error)
    }
  })

  return router
}
