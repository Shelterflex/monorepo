/**
 * Landlord Payout Schedule Routes
 * Handles schedule timeline, listing, and drill-down for landlord payouts
 */

import { Router, type Request, type Response, type NextFunction } from 'express'
import { authenticateToken } from '../middleware/auth.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { listPayoutScheduleSchema } from '../schemas/landlordPayoutSchedule.js'
import { getLandlordPayoutScheduleStore } from '../models/landlordPayoutScheduleStore.js'

const router = Router()

function requireLandlord(req: Request): string {
  const user = (req as any).user
  if (!user?.id) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'User not authenticated')
  }
  return user.id as string
}

/**
 * GET /api/landlord/payout-schedule
 * Returns grouped payout timeline with summary
 */
router.get(
  '/',
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const landlordId = requireLandlord(req)
      const parsed = listPayoutScheduleSchema.safeParse(req.query)
      if (!parsed.success) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Invalid query parameters')
      }
      const f = parsed.data
      const store = getLandlordPayoutScheduleStore()
      const { periods, summary } = await store.getSchedule(landlordId, {
        propertyId: f.propertyId,
        status: f.status,
        channel: f.channel,
        grouping: f.grouping,
        from: f.from,
        to: f.to,
      })
      res.json({ success: true, data: { periods, summary } })
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return next(new AppError(ErrorCode.VALIDATION_ERROR, 400, error.message))
      }
      next(error)
    }
  },
)

/**
 * GET /api/landlord/payout-schedule/payouts
 * Flat list of payouts with pagination and filters
 */
router.get(
  '/payouts',
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const landlordId = requireLandlord(req)
      const parsed = listPayoutScheduleSchema.safeParse(req.query)
      if (!parsed.success) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Invalid query parameters')
      }
      const f = parsed.data
      const store = getLandlordPayoutScheduleStore()
      const result = await store.listPayouts(landlordId, {
        propertyId: f.propertyId,
        status: f.status,
        channel: f.channel,
        from: f.from,
        to: f.to,
        page: f.page,
        pageSize: f.pageSize,
      })
      res.json({
        success: true,
        data: result.payouts,
        pagination: {
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
          totalPages: Math.ceil(result.total / result.pageSize),
        },
      })
    } catch (error) {
      next(error)
    }
  },
)

/**
 * GET /api/landlord/payout-schedule/:payoutId
 * Drill-down: single payout with full deduction and delay details
 */
router.get(
  '/:payoutId',
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const landlordId = requireLandlord(req)
      const { payoutId } = req.params
      if (!payoutId) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Payout ID is required')
      }
      const store = getLandlordPayoutScheduleStore()
      const payout = await store.getPayoutById(payoutId, landlordId)
      if (!payout) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Payout not found')
      }
      res.json({ success: true, data: payout })
    } catch (error) {
      next(error)
    }
  },
)

export function createLandlordPayoutScheduleRouter(): Router {
  return router
}
