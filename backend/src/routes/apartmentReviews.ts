/**
 * Apartment review routes (#2050).
 *
 *   GET  /api/v1/apartment-reviews                  public, paginated and sorted, hidden reviews excluded
 *   POST /api/v1/apartment-reviews                  authenticated; caller must have a deal or application for the listing
 *   POST /api/v1/apartment-reviews/:id/report       authenticated; one report per user per review
 *   PATCH /api/v1/admin/apartment-reviews/:id       admin moderation (listings:moderate)
 */

import { Router, type NextFunction, type Response } from 'express'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { requirePermission } from '../middleware/rbac.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { apartmentReviewStore, toPublicReview } from '../models/apartmentReviewStore.js'
import { dealStore } from '../models/dealStore.js'
import { DealStatus } from '../models/deal.js'
import { ListingApplicationStatus } from '../models/listingApplication.js'
import { listingApplicationRepository } from '../repositories/ListingApplicationRepository.js'
import {
  APARTMENT_REVIEW_REPORT_THRESHOLD,
  apartmentReviewIdParamsSchema,
  apartmentReviewListQuerySchema,
  createApartmentReviewSchema,
  moderateApartmentReviewSchema,
  type ApartmentReviewListQuery,
  type CreateApartmentReviewRequest,
  type ModerateApartmentReviewRequest,
} from '../schemas/apartmentReview.js'
import { auditLog, extractAuditContext } from '../utils/auditLogger.js'

const STAY_DEAL_STATUSES: readonly DealStatus[] = [DealStatus.ACTIVE, DealStatus.COMPLETED]
const APPLICATION_STATUSES_THAT_QUALIFY: readonly ListingApplicationStatus[] = [
  ListingApplicationStatus.PENDING,
  ListingApplicationStatus.UNDER_REVIEW,
  ListingApplicationStatus.APPROVED,
]
const DEAL_PAGE_SIZE = 100

/**
 * Works out what the user has to do with a listing before reviewing it.
 * Returns `verifiedStay` when the user has an active or completed deal on the listing,
 * `false` when they only have a live application, and `null` when neither exists.
 */
async function relationshipToListing(
  userId: string,
  listingId: string,
): Promise<{ verifiedStay: boolean } | null> {
  let page = 1
  for (;;) {
    const result = await dealStore.findMany({ tenantId: userId, page, pageSize: DEAL_PAGE_SIZE })
    const stay = result.deals.some(
      (deal) => deal.listingId === listingId && STAY_DEAL_STATUSES.includes(deal.status),
    )
    if (stay) return { verifiedStay: true }
    if (result.deals.length === 0 || page * DEAL_PAGE_SIZE >= result.total) break
    page += 1
  }

  const applications = await listingApplicationRepository.findByTenantId(userId)
  const applied = applications.some(
    (application) =>
      application.listingId === listingId &&
      APPLICATION_STATUSES_THAT_QUALIFY.includes(application.status),
  )
  return applied ? { verifiedStay: false } : null
}

function callerId(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Authentication required')
  }
  return req.user.id
}

export function createApartmentReviewsRouter(): Router {
  const router = Router()

  router.get(
    '/',
    validate(apartmentReviewListQuerySchema, 'query'),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const query = req.query as unknown as ApartmentReviewListQuery
        const page = await apartmentReviewStore.listVisible({
          listingId: query.listingId,
          sort: query.sort,
          page: query.page,
          pageSize: query.pageSize,
        })
        res.json({ success: true, data: page })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/',
    authenticateToken,
    validate(createApartmentReviewSchema),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const userId = callerId(req)
        const body = req.body as CreateApartmentReviewRequest

        const relationship = await relationshipToListing(userId, body.listingId)
        if (!relationship) {
          throw new AppError(
            ErrorCode.FORBIDDEN,
            403,
            'Only a tenant with a deal or application for this listing can review it',
          )
        }

        const review = await apartmentReviewStore.create({
          listingId: body.listingId,
          userId,
          rating: body.rating,
          text: body.text,
          verifiedStay: relationship.verifiedStay,
        })

        res.status(201).json({ success: true, data: toPublicReview(review) })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/:id/report',
    authenticateToken,
    validate(apartmentReviewIdParamsSchema, 'params'),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const userId = callerId(req)
        const { id } = req.params as { id: string }

        const existing = await apartmentReviewStore.findById(id)
        if (!existing) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, 'Review not found')
        }
        if (existing.userId === userId) {
          throw new AppError(ErrorCode.FORBIDDEN, 403, 'You cannot report your own review')
        }

        const outcome = await apartmentReviewStore.recordReport(
          id,
          userId,
          APARTMENT_REVIEW_REPORT_THRESHOLD,
        )
        if (!outcome) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, 'Review not found')
        }

        res.json({
          success: true,
          data: { reviewId: id, reported: true, alreadyReported: !outcome.created },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}

export function createAdminApartmentReviewsRouter(): Router {
  const router = Router()

  router.patch(
    '/:id',
    authenticateToken,
    requirePermission('listings', 'moderate'),
    validate(apartmentReviewIdParamsSchema, 'params'),
    validate(moderateApartmentReviewSchema),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params as { id: string }
        const body = req.body as ModerateApartmentReviewRequest

        const review = await apartmentReviewStore.setHidden(id, body.isHidden)
        if (!review) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, 'Review not found')
        }

        auditLog(
          'APARTMENT_REVIEW_MODERATED',
          extractAuditContext(req, 'admin'),
          { reviewId: id, isHidden: body.isHidden },
        )

        res.json({ success: true, data: { id: review.id, isHidden: review.isHidden } })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
