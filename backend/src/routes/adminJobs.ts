import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { validate } from '../middleware/validate.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { env } from '../schemas/env.js'
import { getJobStore } from '../jobs/scheduler/store.js'
import { getScheduler } from '../jobs/scheduler/worker.js'
import { JobStatus } from '../jobs/scheduler/types.js'

const listJobsQuerySchema = z.object({
  status: z.nativeEnum(JobStatus).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

const scheduleJobBodySchema = z.object({
  name: z.string().min(1),
  handler: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
  priority: z.number().int().min(1).max(10).default(5),
  cronExpression: z.string().optional(),
  nextRunAt: z.coerce.date().optional(),
  maxRetries: z.number().int().min(0).max(20).default(3),
})

const rescheduleBodySchema = z.object({
  nextRunAt: z.coerce.date(),
})

export function createAdminJobsRouter() {
  const router = Router()

  function requireAdmin(req: Request) {
    const headerSecret = req.headers['x-admin-secret']
    if (env.MANUAL_ADMIN_SECRET && headerSecret !== env.MANUAL_ADMIN_SECRET) {
      throw new AppError(ErrorCode.FORBIDDEN, 403, 'Invalid admin secret')
    }
  }

  /**
   * GET /api/admin/jobs
   * List all jobs with optional status filter and pagination.
   */
  router.get(
    '/',
    validate(listJobsQuerySchema, 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        requireAdmin(req)
        const { status, limit, offset } = req.query as z.infer<typeof listJobsQuerySchema>
        const jobs = await getJobStore().listAll({ status, limit, offset })
        res.json({ jobs })
      } catch (err) {
        next(err)
      }
    },
  )

  /**
   * GET /api/admin/jobs/:id
   * Get a single job by ID.
   */
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireAdmin(req)
      const job = await getJobStore().findById(req.params.id)
      if (!job) throw new AppError(ErrorCode.NOT_FOUND, 404, `Job ${req.params.id} not found`)
      res.json({ job })
    } catch (err) {
      next(err)
    }
  })

  /**
   * POST /api/admin/jobs
   * Schedule a new job immediately or at a future time.
   */
  router.post(
    '/',
    validate(scheduleJobBodySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        requireAdmin(req)
        const body = req.body as z.infer<typeof scheduleJobBodySchema>
        const job = await getScheduler().schedule(body)
        res.status(201).json({ job })
      } catch (err) {
        next(err)
      }
    },
  )

  /**
   * POST /api/admin/jobs/:id/reschedule
   * Reset a failed/dead/cancelled job and schedule it to run at a new time.
   */
  router.post(
    '/:id/reschedule',
    validate(rescheduleBodySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        requireAdmin(req)
        const { nextRunAt } = req.body as z.infer<typeof rescheduleBodySchema>
        const store = getJobStore()
        const job = await store.findById(req.params.id)
        if (!job) throw new AppError(ErrorCode.NOT_FOUND, 404, `Job ${req.params.id} not found`)
        await store.reschedule(req.params.id, nextRunAt)
        const updated = await store.findById(req.params.id)
        res.json({ job: updated })
      } catch (err) {
        next(err)
      }
    },
  )

  /**
   * POST /api/admin/jobs/:id/cancel
   * Cancel a pending or failed job so it will not run again.
   */
  router.post('/:id/cancel', async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireAdmin(req)
      const store = getJobStore()
      const job = await store.findById(req.params.id)
      if (!job) throw new AppError(ErrorCode.NOT_FOUND, 404, `Job ${req.params.id} not found`)
      await store.cancel(req.params.id)
      res.json({ success: true })
    } catch (err) {
      next(err)
    }
  })

  return router
}
