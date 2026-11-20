import { Router, Request, Response } from 'express'
import { authenticateToken } from '../middleware/auth.js'
import { requireFlag } from '../middleware/requireFlag.js'
import { getInspectionJobStore } from '../models/inspectionJobStore.js'
import {
  listInspectionJobsSchema,
  submitInspectionReportSchema,
} from '../schemas/inspectionJob.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

const router = Router()
const store = getInspectionJobStore()

/**
 * GET /api/v1/inspector/jobs
 * List available inspection jobs filtered by inspector's service area
 *
 * @authenticated - verified inspector only
 * @requireFlag INSPECTOR_DASHBOARD_ENABLED
 */
router.get(
  '/inspector/jobs',
  authenticateToken,
  requireFlag('INSPECTOR_DASHBOARD_ENABLED'),
  async (req: Request, res: Response, next) => {
    try {
      const { status = 'available', area, page = 1, limit = 20 } = req.query

      const validatedData = listInspectionJobsSchema.parse({
        status: status as string,
        area: area as string | undefined,
        page: parseInt(page as string, 10),
        limit: parseInt(limit as string, 10),
      })

      const { jobs, total } = await store.listAvailableJobs(
        validatedData.status,
        validatedData.area,
        validatedData.page,
        validatedData.limit,
      )

      res.json({
        success: true,
        data: {
          jobs,
          pagination: {
            page: validatedData.page,
            limit: validatedData.limit,
            total,
            pages: Math.ceil(total / validatedData.limit),
          },
        },
      })
    } catch (error) {
      next(error)
    }
  },
)

/**
 * POST /api/v1/inspector/jobs/:id/claim
 * Atomic claim operation for an available job
 *
 * @authenticated - verified inspector only
 * @requireFlag INSPECTOR_DASHBOARD_ENABLED
 */
router.post(
  '/inspector/jobs/:id/claim',
  authenticateToken,
  requireFlag('INSPECTOR_DASHBOARD_ENABLED'),
  async (req: Request, res: Response, next) => {
    try {
      const inspectorId = (req as any).user?.userId
      const { id: jobId } = req.params

      if (!inspectorId) {
        throw new AppError(
          ErrorCode.UNAUTHORIZED,
          401,
          'User not authenticated',
        )
      }

      const job = await store.claimJob(jobId, inspectorId)

      res.status(200).json({
        success: true,
        data: job,
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found or already claimed')) {
        return next(new AppError(
          ErrorCode.CONFLICT,
          409,
          'Job not found or already claimed',
        ))
      }
      next(error)
    }
  },
)

/**
 * GET /api/v1/inspector/jobs/mine
 * Get all jobs claimed by or submitted by the authenticated inspector
 *
 * @authenticated - inspector
 * @requireFlag INSPECTOR_DASHBOARD_ENABLED
 */
router.get(
  '/inspector/jobs/mine',
  authenticateToken,
  requireFlag('INSPECTOR_DASHBOARD_ENABLED'),
  async (req: Request, res: Response, next) => {
    try {
      const inspectorId = (req as any).user?.userId
      if (!inspectorId) {
        throw new AppError(
          ErrorCode.UNAUTHORIZED,
          401,
          'User not authenticated',
        )
      }

      const jobs = await store.listInspectorJobs(inspectorId)

      res.json({
        success: true,
        data: { jobs },
      })
    } catch (error) {
      next(error)
    }
  },
)

/**
 * POST /api/v1/inspector/jobs/:id/report
 * Submit inspection report for a claimed job
 *
 * @authenticated - inspector
 * @requireFlag INSPECTOR_DASHBOARD_ENABLED
 */
router.post(
  '/inspector/jobs/:id/report',
  authenticateToken,
  requireFlag('INSPECTOR_DASHBOARD_ENABLED'),
  async (req: Request, res: Response, next) => {
    try {
      const { id: jobId } = req.params
      const inspectorId = (req as any).user?.userId

      if (!inspectorId) {
        throw new AppError(
          ErrorCode.UNAUTHORIZED,
          401,
          'User not authenticated',
        )
      }

      const job = await store.getJob(jobId)
      if (!job) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Job not found')
      }

      if (job.inspectorId !== inspectorId) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          403,
          'Only the assigned inspector can submit a report',
        )
      }

      const validatedData = submitInspectionReportSchema.parse(req.body)
      const report = await store.submitReport(jobId, validatedData)

      res.status(201).json({
        success: true,
        data: report,
      })
    } catch (error) {
      next(error)
    }
  },
)

export function createInspectionJobsRouter() {
  return router
}
