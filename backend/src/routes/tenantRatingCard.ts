import { Router, Request, Response } from 'express'
import { authenticateToken } from '../middleware/auth.js'
import { getTenantRatingCardStore } from '../models/tenantRatingCardStore.js'
import {
  createTenantRatingSchema,
  shareRatingCardSchema,
} from '../schemas/tenantRatingCard.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

const router = Router()
const store = getTenantRatingCardStore()

/**
 * POST /api/v1/deals/:dealId/tenant-rating
 * Create a rating for a tenant after a deal is completed
 *
 * @authenticated - landlord only
 */
router.post(
  '/deals/:dealId/tenant-rating',
  authenticateToken,
  async (req: Request, res: Response, next) => {
    try {
      const landlordId = (req as any).user?.userId
      const tenantId = req.body.tenantId
      const { dealId } = req.params

      if (!landlordId) {
        throw new AppError(
          ErrorCode.UNAUTHORIZED,
          401,
          'User not authenticated',
        )
      }

      if (!tenantId) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          400,
          'tenantId is required',
        )
      }

      // Validate schema
      const validatedData = createTenantRatingSchema.parse({
        ...req.body,
        dealId,
      })

      // Check if landlord can rate this deal
      const canRate = await store.canRateDeal(tenantId, landlordId, dealId)
      if (!canRate) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          403,
          'Cannot rate this deal yet. Deal must be completed or active for sufficient time.',
        )
      }

      // Check for duplicate rating
      const hasRating = await store.hasExistingRating(tenantId, landlordId, dealId)
      if (hasRating) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          400,
          'Rating for this deal already exists',
        )
      }

      const rating = await store.createRating(tenantId, landlordId, validatedData)

      res.status(201).json({
        success: true,
        data: rating,
      })
    } catch (error) {
      next(error)
    }
  },
)

/**
 * GET /api/v1/tenant/rating-card
 * Get the authenticated tenant's aggregated rating card
 *
 * @authenticated - tenant
 */
router.get(
  '/tenant/rating-card',
  authenticateToken,
  async (req: Request, res: Response, next) => {
    try {
      const tenantId = (req as any).user?.userId
      if (!tenantId) {
        throw new AppError(
          ErrorCode.UNAUTHORIZED,
          401,
          'User not authenticated',
        )
      }

      const ratingCard = await store.getRatingCard(tenantId)
      res.json({
        success: true,
        data: ratingCard,
      })
    } catch (error) {
      next(error)
    }
  },
)

/**
 * POST /api/v1/tenant/rating-card/share
 * Create an expiring share link for the rating card
 *
 * @authenticated - tenant
 */
router.post(
  '/tenant/rating-card/share',
  authenticateToken,
  async (req: Request, res: Response, next) => {
    try {
      const tenantId = (req as any).user?.userId
      if (!tenantId) {
        throw new AppError(
          ErrorCode.UNAUTHORIZED,
          401,
          'User not authenticated',
        )
      }

      const validatedData = shareRatingCardSchema.parse(req.body)
      const { token, expiresAt } = await store.createShareToken(
        tenantId,
        validatedData.ttlDays,
      )

      res.status(201).json({
        success: true,
        data: {
          token,
          expiresAt,
          shareUrl: `/api/v1/public/rating-card/${token}`,
        },
      })
    } catch (error) {
      next(error)
    }
  },
)

/**
 * DELETE /api/v1/tenant/rating-card/share/:tokenId
 * Revoke a share link
 *
 * @authenticated - tenant
 */
router.delete(
  '/tenant/rating-card/share/:tokenId',
  authenticateToken,
  async (req: Request, res: Response, next) => {
    try {
      const { tokenId } = req.params
      await store.revokeShareToken(tokenId)

      res.json({
        success: true,
        message: 'Share link revoked',
      })
    } catch (error) {
      next(error)
    }
  },
)

/**
 * GET /api/v1/public/rating-card/:token
 * Public endpoint: view tenant rating card with expiring token
 *
 * @public - no auth required
 * @rateLimit yes
 */
router.get(
  '/public/rating-card/:token',
  async (req: Request, res: Response, next) => {
    try {
      const { token } = req.params

      // Set cache headers for public endpoints
      res.set('Cache-Control', 'no-store')

      const ratingCard = await store.getPublicRatingCard(token)

      res.json({
        success: true,
        data: ratingCard,
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes('expired')) {
        const appError = new AppError(
          ErrorCode.NOT_FOUND,
          404,
          'Rating card not found or expired',
        )
        return next(appError)
      }
      next(error)
    }
  },
)

export function createTenantRatingCardRouter() {
  return router
}
