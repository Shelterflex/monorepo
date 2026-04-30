import { Router, Response } from 'express'
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js'
import { apartmentReviewStore } from '../models/apartmentReviewStore.js'
import { landlordPropertyStore } from '../models/landlordPropertyStore.js'
import { validate } from '../middleware/validate.js'
import {
  createApartmentReviewSchema,
  apartmentReviewFiltersSchema,
} from '../schemas/apartmentReview.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { logger } from '../utils/logger.js'
import { cacheControl, CachePresets, registerEndpointCache } from '../middleware/cacheControl.js'
import { invalidateCacheOnMutation } from '../services/cacheInvalidation.js'

const router = Router()

// Register cache configurations
registerEndpointCache('/api/apartment-reviews', {
  ...CachePresets.dynamic,
  tags: ['reviews'],
  cacheKey: 'reviews:list',
})

/**
 * List reviews for an apartment
 * GET /api/apartment-reviews
 */
router.get(
  '/',
  cacheControl(CachePresets.dynamic),
  async (req, res, next) => {
    try {
      const filters = apartmentReviewFiltersSchema.parse(req.query)
      const result = await apartmentReviewStore.list(filters)
      res.json(result)
    } catch (error) {
      next(error)
    }
  }
)

/**
 * Create a new review
 * POST /api/apartment-reviews
 */
router.post(
  '/',
  authenticateToken,
  validate(createApartmentReviewSchema, 'body'),
  cacheControl(CachePresets.noCache),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const { apartmentId, rating, content, verifiedStay } = req.body

      // Verify apartment exists
      const apartment = await landlordPropertyStore.getById(apartmentId)
      if (!apartment) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Apartment not found')
      }

      const review = await apartmentReviewStore.create({
        apartmentId,
        userId: req.user!.id,
        rating,
        content,
        verifiedStay,
      })

      // Invalidate cache for reviews and property
      invalidateCacheOnMutation('review', review.id, 'create')
      invalidateCacheOnMutation('property', apartmentId, 'update')

      logger.info('Apartment review created', { reviewId: review.id, apartmentId, userId: req.user!.id })
      res.status(201).json(review)
    } catch (error) {
      next(error)
    }
  }
)

/**
 * Report a review
 * POST /api/apartment-reviews/:id/report
 */
router.post(
  '/:id/report',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const success = await apartmentReviewStore.report(req.params.id)
      if (!success) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Review not found')
      }
      res.json({ success: true, message: 'Review reported' })
    } catch (error) {
      next(error)
    }
  }
)

/**
 * Hide/Unhide review (Admin only)
 * PATCH /api/apartment-reviews/:id/visibility
 */
router.patch(
  '/:id/visibility',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const { isHidden } = req.body
      if (typeof isHidden !== 'boolean') {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'isHidden must be a boolean')
      }

      const success = await apartmentReviewStore.setHidden(req.params.id, isHidden)
      if (!success) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Review not found')
      }
      res.json({ success: true, isHidden })
    } catch (error) {
      next(error)
    }
  }
)

export function createApartmentReviewsRouter(): Router {
  return router
}
