/**
 * Admin Underwriting Routes
 * Internal admin endpoint for reviewing underwriting decisions and rationale
 */

import { Router, Request, Response } from 'express'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'
import { underwritingDecisionTraceStore } from '../models/underwritingDecisionTraceStore.js'
import { underwritingService } from '../services/underwritingService.js'
import { tenantApplicationStore } from '../models/tenantApplicationStore.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

const router = Router()

/**
 * GET /api/admin/underwriting/decisions
 * List underwriting decisions with optional filters
 *
 * @authenticated
 */
router.get('/decisions', authenticateToken, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const decision = req.query.decision as string
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0

    const filters: any = { limit, offset }
    if (decision && ['APPROVE', 'REVIEW', 'REJECT'].includes(decision as string)) {
      filters.decision = decision
    }

    const result = await underwritingDecisionTraceStore.list(filters)

    res.json({
      success: true,
      data: result.traces,
      total: result.total,
      limit,
      offset,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/admin/underwriting/decisions/:traceId
 * Get a specific decision trace by ID
 *
 * @authenticated
 */
router.get('/decisions/:traceId', authenticateToken, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const { traceId } = req.params

    if (!traceId) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Trace ID is required')
    }

    const trace = await underwritingDecisionTraceStore.findById(traceId)

    if (!trace) {
      throw new AppError(ErrorCode.NOT_FOUND, 404, `Decision trace ${traceId} not found`)
    }

    res.json({
      success: true,
      data: trace,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/admin/underwriting/decisions/application/:applicationId
 * Get all decision traces for a specific application
 *
 * @authenticated
 */
router.get('/decisions/application/:applicationId', authenticateToken, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const { applicationId } = req.params

    if (!applicationId) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Application ID is required')
    }

    const traces = await underwritingDecisionTraceStore.findByApplicationId(applicationId)

    res.json({
      success: true,
      data: traces,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/admin/underwriting/decisions/user/:userId
 * Get all decision traces for a specific user
 *
 * @authenticated
 */
router.get('/decisions/user/:userId', authenticateToken, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const { userId } = req.params

    if (!userId) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'User ID is required')
    }

    const traces = await underwritingDecisionTraceStore.findByUserId(userId)

    res.json({
      success: true,
      data: traces,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/admin/underwriting/evaluate/:applicationId
 * Manually trigger underwriting evaluation for an application
 *
 * @authenticated
 */
router.post('/evaluate/:applicationId', authenticateToken, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const { applicationId } = req.params

    if (!applicationId) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Application ID is required')
    }

    const paymentHistory = req.body.paymentHistory
    const metadata = req.body.metadata

    const result = await underwritingService.evaluateApplication({
      applicationId,
      paymentHistory,
      metadata,
    })

    res.json({
      success: true,
      data: result,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/admin/underwriting/config
 * Get current rule engine configuration
 *
 * @authenticated
 */
router.get('/config', authenticateToken, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const config = underwritingService.getRuleConfig()

    res.json({
      success: true,
      data: config,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * PUT /api/admin/underwriting/config
 * Update rule engine configuration
 *
 * @authenticated
 */
router.put('/config', authenticateToken, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const configUpdate = req.body

    // Validate config update
    if (configUpdate.approveThreshold !== undefined) {
      if (typeof configUpdate.approveThreshold !== 'number' || configUpdate.approveThreshold < 0 || configUpdate.approveThreshold > 100) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Approve threshold must be between 0 and 100')
      }
    }

    if (configUpdate.reviewThreshold !== undefined) {
      if (typeof configUpdate.reviewThreshold !== 'number' || configUpdate.reviewThreshold < 0 || configUpdate.reviewThreshold > 100) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Review threshold must be between 0 and 100')
      }
    }

    underwritingService.updateRuleConfig(configUpdate)

    const updatedConfig = underwritingService.getRuleConfig()

    res.json({
      success: true,
      data: updatedConfig,
    })
  } catch (error) {
    next(error)
  }
})

export function createAdminUnderwritingRouter(): Router {
  return router
}
