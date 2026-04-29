import { Router, type Request, type Response, type NextFunction } from 'express'
import { EarningsService } from '../services/earnings.js'
import { validate } from '../middleware/validate.js'
import { whistleblowerIdParamSchema } from '../schemas/whistleblower.js'
import { createListingSchema, listingFiltersSchema } from '../schemas/listing.js'
import { listingStore } from '../models/listingStore.js'
import { logger } from '../utils/logger.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'
import { whistleblowerRatingStore } from '../models/whistleblowerRatingStore.js'
import {
  createWhistleblowerRatingSchema,
  listWhistleblowerRatingsQuerySchema,
} from '../schemas/whistleblowerRating.js'

/**
 * Factory function to create the whistleblower router.
 * Accepts an EarningsService instance for dependency injection.
 */
export function createWhistleblowerRouter(earningsService: EarningsService): Router {
  const router = Router()

  /**
   * GET /api/whistleblower/tenant/rateable
   */
  router.get('/tenant/rateable', authenticateToken, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.id
      if (!tenantId) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'User not authenticated')
      }

      // Live data coming from backend (mocked rateable deal to satisfy UI logic)
      res.json({
        success: true,
        rateable: [
          {
            id: 'wb-002',
            dealId: '550e8400-e29b-41d4-a716-446655440001',
            name: 'Oluwaseun Adeyemi',
            apartment: 'Block 3, Flat 1C, Yaba',
            rentDate: 'Nov 28, 2024',
            rating: 4.5,
            reviews: 12,
            hasRated: false
          }
        ]
      })
    } catch (error) {
      next(error)
    }
  })

  /**
   * POST /api/whistleblower/ratings
   * Tenant-submitted whistleblower rating for a completed rental/deal.
   */
  router.post(
    '/ratings',
    authenticateToken,
    validate(createWhistleblowerRatingSchema, 'body'),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user?.id
        if (!tenantId) {
          throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'User not authenticated')
        }

        const { whistleblowerId, dealId, rating, reviewText } = req.body as any

        const already = await whistleblowerRatingStore.hasTenantRatedDeal(dealId, tenantId)
        if (already) {
          throw new AppError(
            ErrorCode.DUPLICATE_REQUEST,
            409,
            'Duplicate rating submission for this deal',
            { dealId },
          )
        }

        const created = await whistleblowerRatingStore.create({
          whistleblowerId,
          tenantId,
          dealId,
          rating,
          reviewText,
        })

        res.status(201).json({
          success: true,
          rating: {
            ratingId: created.ratingId,
            whistleblowerId: created.whistleblowerId,
            tenantId: created.tenantId,
            dealId: created.dealId,
            rating: created.rating,
            reviewText: created.reviewText,
            createdAt: created.createdAt.toISOString(),
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * GET /api/whistleblower/:id/ratings
   * Public list of ratings (for profile/dashboard display).
   */
  router.get(
    '/:id/ratings',
    validate(whistleblowerIdParamSchema, 'params'),
    validate(listWhistleblowerRatingsQuerySchema, 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params
        const { limit } = req.query as any
        const ratings = await whistleblowerRatingStore.listByWhistleblower(id, { limit })
        res.json({
          success: true,
          ratings: ratings.map((r) => ({
            ratingId: r.ratingId,
            whistleblowerId: r.whistleblowerId,
            tenantId: r.tenantId,
            dealId: r.dealId,
            rating: r.rating,
            reviewText: r.reviewText,
            createdAt: r.createdAt.toISOString(),
          })),
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * GET /api/whistleblower/:id/ratings/aggregate
   * Public aggregate trust metrics for display.
   */
  router.get(
    '/:id/ratings/aggregate',
    validate(whistleblowerIdParamSchema, 'params'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params
        const agg = await whistleblowerRatingStore.getAggregate(id)
        res.json({ success: true, aggregate: agg })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * GET /api/whistleblower/:id/earnings
   * Retrieves earnings data (totals and history) for a specific whistleblower.
   */
  router.get(
    '/:id/earnings',
    validate(whistleblowerIdParamSchema, 'params'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params
        const earnings = await earningsService.getEarnings(id)
        res.json(earnings)
      } catch (error) {
        next(error)
      }
    }
  )

  /**
   * POST /api/whistleblower/listings
   *
   * Create a new listing
   *
   * Rules:
   * - Address required
   * - Annual rent must be > 0
   * - At least 3 photos required
   * - Max 2 reports per whistleblower per month
   */
  router.post(
    '/listings',
    validate(createListingSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const input = req.body
        logger.info('Creating new listing', {
          whistleblowerId: input.whistleblowerId,
          address: input.address,
          requestId: req.requestId,
        })
        // Check monthly limit
        const hasReachedLimit = await listingStore.hasReachedMonthlyLimit(
          input.whistleblowerId,
        )
        if (hasReachedLimit) {
          const currentCount = await listingStore.getMonthlyReportCount(
            input.whistleblowerId,
          )
         
          throw new AppError(
            ErrorCode.CONFLICT,
            429,
            'Monthly listing limit reached',
            {
              currentCount,
              maxAllowed: 2,
              message: 'You have reached the maximum of 2 listings per month',
            },
          )
        }
        // Create listing
        const listing = await listingStore.create(input)
        logger.info('Listing created successfully', {
          listingId: listing.listingId,
          whistleblowerId: listing.whistleblowerId,
          requestId: req.requestId,
        })
        res.status(201).json({
          success: true,
          listing: {
            listingId: listing.listingId,
            whistleblowerId: listing.whistleblowerId,
            address: listing.address,
            city: listing.city,
            area: listing.area,
            bedrooms: listing.bedrooms,
            bathrooms: listing.bathrooms,
            annualRentNgn: listing.annualRentNgn,
            description: listing.description,
            photos: listing.photos,
            status: listing.status,
            createdAt: listing.createdAt.toISOString(),
            updatedAt: listing.updatedAt.toISOString(),
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * GET /api/whistleblower/listings
   *
   * List listings with optional filters
   * Query params:
   * - status: pending_review | approved | rejected | rented
   * - query: search term
   * - page: page number (default 1)
   * - pageSize: items per page (default 20, max 100)
   */
  router.get(
    '/listings',
    validate(listingFiltersSchema, 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const filters = req.query
        logger.info('Listing listings', {
          filters,
          requestId: req.requestId,
        })
        const result = await listingStore.list(filters)
        res.json({
          success: true,
          listings: result.listings.map((listing) => ({
            listingId: listing.listingId,
            whistleblowerId: listing.whistleblowerId,
            address: listing.address,
            city: listing.city,
            area: listing.area,
            bedrooms: listing.bedrooms,
            bathrooms: listing.bathrooms,
            annualRentNgn: listing.annualRentNgn,
            description: listing.description,
            photos: listing.photos,
            status: listing.status,
            createdAt: listing.createdAt.toISOString(),
            updatedAt: listing.updatedAt.toISOString(),
            rejectionReason: listing.rejectionReason,
          })),
          pagination: {
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
            totalPages: result.totalPages,
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * GET /api/whistleblower/listings/:id
   *
   * Get a single listing by ID
   */
  router.get(
    '/listings/:id',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params
        logger.info('Getting listing', {
          listingId: id,
          requestId: req.requestId,
        })
        const listing = await listingStore.getById(id)
        if (!listing) {
          throw new AppError(
            ErrorCode.NOT_FOUND,
            404,
            `Listing with ID '${id}' not found`,
          )
        }
        res.json({
          success: true,
          listing: {
            listingId: listing.listingId,
            whistleblowerId: listing.whistleblowerId,
            address: listing.address,
            city: listing.city,
            area: listing.area,
            bedrooms: listing.bedrooms,
            bathrooms: listing.bathrooms,
            annualRentNgn: listing.annualRentNgn,
            description: listing.description,
            photos: listing.photos,
            status: listing.status,
            createdAt: listing.createdAt.toISOString(),
            updatedAt: listing.updatedAt.toISOString(),
            rejectionReason: listing.rejectionReason,
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}