/**
 * Deal management routes
 */

import { Router, Request, Response, NextFunction } from 'express'
import { dealStore } from '../models/dealStore.js'
import { listingStore } from '../models/listingStore.js'
import { ListingStatus } from '../models/listing.js'
import { 
  createDealSchema, 
  dealFiltersSchema, 
  updateDealStatusSchema,
  updateScheduleItemSchema,
  CreateDealRequest,
  DealFiltersRequest,
  UpdateDealStatusRequest,
  UpdateScheduleItemRequest
} from '../schemas/deal.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { outboxStore } from '../outbox/index.js'
import { TxType } from '../outbox/types.js'
import { computeDealProgress } from '../services/dealProgress.js'

const router = Router()

/**
 * POST /api/deals
 * Create a new deal with repayment schedule
 * 
 * RACE CONDITION HANDLING (MVP):
 * This implementation uses synchronous validation and locking for the in-memory store.
 * While this prevents most race conditions in single-threaded Node.js execution,
 * it does NOT provide true atomicity guarantees.
 * 
 * Known limitations:
 * - Multiple concurrent requests could theoretically pass validation before any locks
 * - No distributed locking mechanism for multi-instance deployments
 * 
 * Production recommendations:
 * - Use database transactions (BEGIN/COMMIT) to ensure atomic read-check-update
 * - Implement optimistic locking with version numbers on the listing record
 * - Use distributed locks (Redis, etc.) for multi-instance deployments
 * - Add unique constraint on listing.dealId at database level
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validatedData: CreateDealRequest = createDealSchema.parse(req.body)
    const deal = await dealStore.create(validatedData as any)
    if (validatedData.listingId) {
      const listing = await listingStore.getById(validatedData.listingId)
      if (listing && listing.status !== ListingStatus.RENTED && !listing.dealId) {
        await listingStore.lockToDeal(validatedData.listingId, deal.dealId)
      }
    }
    res.status(201).json({
      success: true,
      data: deal
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      return next(new AppError(ErrorCode.VALIDATION_ERROR, 400, error.message))
    }
    return next(error)
  }
})

/**
 * GET /api/deals/:dealId
 * Get a specific deal by ID with schedule
 */
router.get('/:dealId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { dealId } = req.params
    if (!dealId) {
      return next(new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Deal ID is required'))
    }
    const deal = await dealStore.findById(dealId)
    if (!deal) {
      return next(new AppError(ErrorCode.NOT_FOUND, 404, `Deal with ID ${dealId} not found`))
    }
    res.json({
      success: true,
      data: deal
    })
  } catch (error) {
    return next(error)
  }
})

/**
 * GET /api/deals
 * Get deals with optional filtering
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validatedFilters: DealFiltersRequest = dealFiltersSchema.parse(req.query)
    
    const result = await dealStore.findMany(validatedFilters)
    
    res.json({
      success: true,
      data: result
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      return next(new AppError(ErrorCode.VALIDATION_ERROR, 400, error.message))
    }
    return next(error)
  }
})

/**
 * PATCH /api/deals/:dealId/status
 * Update deal status
 */
router.patch('/:dealId/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { dealId } = req.params
    if (!dealId) {
      return next(new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Deal ID is required'))
    }
    const validatedData: UpdateDealStatusRequest = updateDealStatusSchema.parse(req.body)
    
    const deal = await dealStore.updateStatus(dealId, validatedData.status)
    
    if (!deal) {
      return next(new AppError(ErrorCode.NOT_FOUND, 404, `Deal with ID ${dealId} not found`))
    }
    
    res.json({
      success: true,
      data: deal
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      return next(new AppError(ErrorCode.VALIDATION_ERROR, 400, error.message))
    }
    return next(error)
  }
})

/**
 * PATCH /api/deals/:dealId/schedule/:period
 * Update schedule item status
 */
router.patch('/:dealId/schedule/:period', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { dealId } = req.params
    const period = parseInt(req.params.period, 10)
    if (!dealId || isNaN(period)) {
      return next(new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Deal ID and period are required'))
    }
    const validatedData: UpdateScheduleItemRequest = updateScheduleItemSchema.parse({
      ...req.body,
      period
    })
    
    const deal = await dealStore.updateScheduleItemStatus(
      dealId, 
      validatedData.period, 
      validatedData.status as any
    )
    
    if (!deal) {
      return next(new AppError(ErrorCode.NOT_FOUND, 404, `Deal with ID ${dealId} not found`))
    }
    
    res.json({
      success: true,
      data: deal
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      return next(new AppError(ErrorCode.VALIDATION_ERROR, 400, error.message))
    }
    return next(error)
  }
})

export function createDealsRouter(): Router {
  return router
}
