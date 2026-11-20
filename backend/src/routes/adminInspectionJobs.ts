import { Router, Request, Response } from 'express'
import { authenticateToken } from '../middleware/auth.js'
import { requirePermission } from '../middleware/rbac.js'
import { requireFlag } from '../middleware/requireFlag.js'
import { getInspectionJobStore } from '../models/inspectionJobStore.js'
import {
  createInspectionJobSchema,
  rejectInspectionJobSchema,
} from '../schemas/inspectionJob.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

const router = Router()
const store = getInspectionJobStore()

/**
 * POST /api/v1/admin/inspector/jobs
 * Create a new inspection job for a whistleblower listing
 *
 * @authenticated - admin with 'inspections' resource 'create' permission
 * @requireFlag INSPECTOR_DASHBOARD_ENABLED
 */
router.post(
  '/inspector/jobs',
  authenticateToken,
  requirePermission('inspections', 'create'),
  requireFlag('INSPECTOR_DASHBOARD_ENABLED'),
  async (req: Request, res: Response, next) => {
    try {
      const validatedData = createInspectionJobSchema.parse(req.body)
      const job = await store.createJob(
        validatedData.listingId,
        validatedData.offeredFeeNgn,
      )

      res.status(201).json({
        success: true,
        data: job,
      })
    } catch (error) {
      next(error)
    }
  },
)

/**
 * GET /api/v1/admin/inspector/jobs
 * List inspection jobs for admin review/approval
 *
 * @authenticated - admin with 'inspections' resource 'review' permission
 * @requireFlag INSPECTOR_DASHBOARD_ENABLED
 */
router.get(
  '/inspector/jobs',
  authenticateToken,
  requirePermission('inspections', 'review'),
  requireFlag('INSPECTOR_DASHBOARD_ENABLED'),
  async (req: Request, res: Response, next) => {
    try {
      const { status = 'submitted', page = 1, limit = 20 } = req.query

      const { jobs, total } = await store.listAvailableJobs(
        status as string,
        undefined,
        parseInt(page as string, 10),
        parseInt(limit as string, 10),
      )

      res.json({
        success: true,
        data: {
          jobs,
          pagination: {
            page: parseInt(page as string, 10),
            limit: parseInt(limit as string, 10),
            total,
            pages: Math.ceil(total / parseInt(limit as string, 10)),
          },
        },
      })
    } catch (error) {
      next(error)
    }
  },
)

/**
 * POST /api/v1/admin/inspector/jobs/:id/approve
 * Approve a submitted inspection report
 *
 * @authenticated - admin with 'inspections' resource 'review' permission
 * @requireFlag INSPECTOR_DASHBOARD_ENABLED
 */
router.post(
  '/inspector/jobs/:id/approve',
  authenticateToken,
  requirePermission('inspections', 'review'),
  requireFlag('INSPECTOR_DASHBOARD_ENABLED'),
  async (req: Request, res: Response, next) => {
    try {
      const { id: jobId } = req.params

      const job = await store.getJob(jobId)
      if (!job) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Job not found')
      }

      if (job.status !== 'submitted') {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          400,
          'Only submitted jobs can be approved',
        )
      }

      const approvedJob = await store.approveJob(jobId)

      res.json({
        success: true,
        data: approvedJob,
      })
    } catch (error) {
      next(error)
    }
  },
)

/**
 * POST /api/v1/admin/inspector/jobs/:id/reject
 * Reject a submitted inspection report with reason
 *
 * @authenticated - admin with 'inspections' resource 'review' permission
 * @requireFlag INSPECTOR_DASHBOARD_ENABLED
 */
router.post(
  '/inspector/jobs/:id/reject',
  authenticateToken,
  requirePermission('inspections', 'review'),
  requireFlag('INSPECTOR_DASHBOARD_ENABLED'),
  async (req: Request, res: Response, next) => {
    try {
      const { id: jobId } = req.params

      const validatedData = rejectInspectionJobSchema.parse(req.body)

      const job = await store.getJob(jobId)
      if (!job) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Job not found')
      }

      if (job.status !== 'submitted') {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          400,
          'Only submitted jobs can be rejected',
        )
      }

      const rejectedJob = await store.rejectJob(jobId, validatedData.reason)

      res.json({
        success: true,
        data: rejectedJob,
      })
    } catch (error) {
      next(error)
    }
  },
)

export function createAdminInspectionJobsRouter() {
  return router
}
