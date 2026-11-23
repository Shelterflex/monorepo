/**
 * Tenant saved-property routes (issue #2049): a tenant's shortlist of listings.
 *
 *   GET    /api/v1/tenant/saved-properties                 saved listing ids, paginated
 *   PUT    /api/v1/tenant/saved-properties/:listingId      save a publicly visible listing
 *   DELETE /api/v1/tenant/saved-properties/:listingId      remove a saved listing
 *
 * Every query is keyed by the caller's own id, so a tenant can only read or change
 * their own list. Save and remove are idempotent.
 */

import { Router, type Response, type NextFunction } from 'express'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { listingStore } from '../models/listingStore.js'
import { ListingStatus } from '../models/listing.js'
import { savedPropertyStore } from '../models/savedPropertyStore.js'
import {
  savedPropertiesListQuerySchema,
  savedPropertyParamsSchema,
  type SavedPropertiesListQuery,
} from '../schemas/tenantSavedProperties.js'

function callerId(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Authentication required')
  }
  return req.user.id
}

export function createTenantSavedPropertiesRouter(): Router {
  const router = Router()

  router.get(
    '/',
    authenticateToken,
    validate(savedPropertiesListQuerySchema, 'query'),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const userId = callerId(req)
        const { page, pageSize } = req.query as unknown as SavedPropertiesListQuery

        const { listingIds, total } = await savedPropertyStore.listPage(userId, page, pageSize)

        res.json({
          success: true,
          data: listingIds,
          pagination: {
            page,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize),
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.put(
    '/:listingId',
    authenticateToken,
    validate(savedPropertyParamsSchema, 'params'),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const userId = callerId(req)
        const { listingId } = req.params

        // Unknown and non-public listings get the same 404, so the endpoint does not reveal drafts.
        const listing = await listingStore.getById(listingId)
        if (!listing || listing.status !== ListingStatus.APPROVED) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, 'Listing not found')
        }

        await savedPropertyStore.save(userId, listingId)
        res.json({ success: true, data: { listingId, saved: true } })
      } catch (error) {
        next(error)
      }
    },
  )

  router.delete(
    '/:listingId',
    authenticateToken,
    validate(savedPropertyParamsSchema, 'params'),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const userId = callerId(req)
        const { listingId } = req.params

        // No listing lookup here, so a listing that was rejected or rented after being saved can still be removed.
        await savedPropertyStore.remove(userId, listingId)
        res.json({ success: true, data: { listingId, saved: false } })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
