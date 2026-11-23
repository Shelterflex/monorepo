/**
 * Landlord analytics route (issue #2054).
 *
 *   GET /api/v1/landlord/analytics
 *
 * Landlord only. Accepts optional startDate and endDate (YYYY-MM-DD, UTC, both
 * inclusive) and propertyId. The window defaults to the last 12 months and may span
 * at most 24. The response is the bare analytics object, not wrapped in an envelope,
 * as the landlord dashboard endpoints are.
 */

import { Router, type Response, type NextFunction } from 'express'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { landlordAnalyticsQuerySchema, type LandlordAnalyticsQuery } from '../schemas/landlordAnalytics.js'
import { resolveAnalyticsWindow } from '../services/landlordAnalytics.js'
import { computeLandlordAnalytics } from '../services/landlordAnalyticsData.js'

export function createLandlordAnalyticsRouter(): Router {
  const router = Router()

  router.get(
    '/',
    authenticateToken,
    validate(landlordAnalyticsQuerySchema, 'query'),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        if (!req.user) {
          throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Authentication required')
        }
        if (req.user.role !== 'landlord') {
          throw new AppError(ErrorCode.FORBIDDEN, 403, 'Only landlords can view analytics')
        }

        const query = req.query as unknown as LandlordAnalyticsQuery
        const now = new Date()
        const window = resolveAnalyticsWindow(query, now)

        const analytics = await computeLandlordAnalytics({
          landlordId: req.user.id,
          window,
          propertyId: query.propertyId,
          now,
        })

        res.json(analytics)
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
