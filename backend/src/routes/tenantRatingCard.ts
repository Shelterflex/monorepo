/**
 * Tenant rating card routes (#2051).
 *
 *   POST   /api/v1/deals/:dealId/tenant-rating          landlord rates the tenant on a deal (one per deal)
 *   GET    /api/v1/tenant/rating-card                   tenant views their own aggregated card
 *   POST   /api/v1/tenant/rating-card/share             create an expiring share link
 *   DELETE /api/v1/tenant/rating-card/share/:tokenId    revoke one of the tenant's share links
 *   GET    /api/v1/public/rating-card/:token            public card for a live link (rate limited)
 */

import { Router, type NextFunction, type Response } from 'express'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { createRateLimiter } from '../middleware/rateLimiter.js'
import { getTenantRatingCardStore } from '../models/tenantRatingCardStore.js'
import { dealStore } from '../models/dealStore.js'
import { DealStatus } from '../models/deal.js'
import {
  dealIdParamsSchema,
  shareRatingCardSchema,
  shareTokenIdParamsSchema,
  tenantRatingBodySchema,
  type CreateTenantRatingRequest,
  type ShareRatingCardRequest,
} from '../schemas/tenantRatingCard.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

/** A tenant can be rated only once the deal is running or finished. */
const RATEABLE_DEAL_STATUSES: readonly DealStatus[] = [DealStatus.ACTIVE, DealStatus.COMPLETED]

/** Share tokens are 32 random bytes, hex encoded. Anything else cannot match a token. */
const SHARE_TOKEN_PATTERN = /^[a-f0-9]{64}$/

function callerId(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Authentication required')
  }
  return req.user.id
}

export function createTenantRatingCardRouter(): Router {
  const router = Router()
  const store = getTenantRatingCardStore()
  const publicCardLimiter = createRateLimiter({
    points: 30,
    duration: 60,
    keyPrefix: 'rating-card-public',
    keyBy: 'ip',
  })

  router.post(
    '/deals/:dealId/tenant-rating',
    authenticateToken,
    validate(dealIdParamsSchema, 'params'),
    validate(tenantRatingBodySchema),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const landlordId = callerId(req)
        const { dealId } = req.params as { dealId: string }
        const body = req.body as Omit<CreateTenantRatingRequest, 'dealId'>

        const deal = await dealStore.findById(dealId)
        if (!deal) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, 'Deal not found')
        }
        if (deal.landlordId !== landlordId) {
          throw new AppError(ErrorCode.FORBIDDEN, 403, 'Only the landlord of this deal can rate the tenant')
        }
        if (!RATEABLE_DEAL_STATUSES.includes(deal.status)) {
          throw new AppError(
            ErrorCode.INVALID_STATE_TRANSITION,
            409,
            'The tenant can be rated only once the deal is active or completed',
          )
        }

        // The tenant comes from the deal, not the request body, so a landlord cannot rate someone else.
        // A second rating for the same deal is rejected with a 409 by the store.
        const rating = await store.createRating(deal.tenantId, landlordId, { ...body, dealId })

        res.status(201).json({ success: true, data: rating })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/tenant/rating-card',
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const tenantId = callerId(req)
        const card = await store.getRatingCard(tenantId)
        res.json({ success: true, data: card })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/tenant/rating-card/share',
    authenticateToken,
    validate(shareRatingCardSchema),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const tenantId = callerId(req)
        const body = req.body as ShareRatingCardRequest
        const link = await store.createShareToken(tenantId, body.ttlDays)

        res.status(201).json({
          success: true,
          data: {
            id: link.id,
            token: link.token,
            expiresAt: link.expiresAt,
            shareUrl: `/api/v1/public/rating-card/${link.token}`,
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.delete(
    '/tenant/rating-card/share/:tokenId',
    authenticateToken,
    validate(shareTokenIdParamsSchema, 'params'),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const tenantId = callerId(req)
        const { tokenId } = req.params as { tokenId: string }

        const revoked = await store.revokeShareToken(tenantId, tokenId)
        if (!revoked) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, 'Share link not found')
        }

        res.json({ success: true, message: 'Share link revoked' })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/public/rating-card/:token',
    publicCardLimiter,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        res.set('Cache-Control', 'no-store')

        const { token } = req.params as { token: string }
        // Malformed, unknown, expired and revoked tokens all get the same answer.
        const card = SHARE_TOKEN_PATTERN.test(token) ? await store.getPublicRatingCard(token) : null
        if (!card) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, 'Rating card not found or expired')
        }

        res.json({ success: true, data: card })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
