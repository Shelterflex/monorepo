import { Router, Response } from 'express'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import {
  inspectorApplicationSchema,
  inspectionReportSchema,
  inspectionReviewSchema,
} from '../schemas/propertyInspection.js'
import { propertyInspectionService } from '../services/propertyInspectionService.js'

const router = Router()

function requireUser(req: AuthenticatedRequest): string {
  if (!req.user?.id) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Authentication required')
  }
  return req.user.id
}

function requireAdmin(req: AuthenticatedRequest): void {
  const headerSecret = req.headers['x-admin-secret']
  const adminSecret = process.env.ADMIN_SECRET
  const hasAdminSecret =
    typeof headerSecret === 'string' &&
    typeof adminSecret === 'string' &&
    adminSecret.length > 0 &&
    headerSecret === adminSecret
  if (req.user?.role !== 'admin' && !hasAdminSecret) {
    throw new AppError(ErrorCode.FORBIDDEN, 403, 'Admin access required')
  }
}

router.post(
  '/inspector/apply',
  authenticateToken,
  validate(inspectorApplicationSchema, 'body'),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const profile = await propertyInspectionService.apply(requireUser(req), req.body as any)
      res.status(201).json({ success: true, data: profile })
    } catch (error) {
      next(error)
    }
  },
)

router.get('/inspector/jobs', authenticateToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const jobs = await propertyInspectionService.listJobs(requireUser(req))
    res.json({ success: true, data: jobs })
  } catch (error) {
    next(error)
  }
})

router.post('/inspector/jobs/:inspectionId/accept', authenticateToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const inspection = await propertyInspectionService.acceptJob(requireUser(req), req.params.inspectionId)
    res.json({ success: true, data: inspection })
  } catch (error) {
    next(error)
  }
})

router.post(
  '/inspector/jobs/:inspectionId/report',
  authenticateToken,
  validate(inspectionReportSchema, 'body'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const report = await propertyInspectionService.submitReport({
        ...(req.body as any),
        inspectionId: req.params.inspectionId,
        inspectorId: requireUser(req),
      })
      res.json({ success: true, data: report })
    } catch (error) {
      next(error)
    }
  },
)

router.get('/inspector/earnings', authenticateToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    const earnings = await propertyInspectionService.getEarnings(requireUser(req))
    res.json({ success: true, data: earnings })
  } catch (error) {
    next(error)
  }
})

router.patch(
  '/admin/inspections/:inspectionId/review',
  authenticateToken,
  validate(inspectionReviewSchema, 'body'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      requireAdmin(req)
      const body = req.body as { decision: 'approved' | 'rejected'; rejectionReason?: string }
      const report = await propertyInspectionService.reviewInspection(
        req.params.inspectionId,
        body.decision === 'approved',
        body.rejectionReason,
      )
      res.json({ success: true, data: report })
    } catch (error) {
      next(error)
    }
  },
)

router.get('/properties/:propertyId/inspection-summary', async (req, res, next) => {
  try {
    const summary = await propertyInspectionService.getApprovedSummary(req.params.propertyId)
    res.json({ success: true, data: summary })
  } catch (error) {
    next(error)
  }
})

export function createPropertyInspectionsRouter(): Router {
  return router
}
