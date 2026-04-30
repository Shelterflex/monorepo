import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { validate } from '../middleware/validate.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { env } from '../schemas/env.js'
import { getFraudStore } from '../fraud/store.js'
import { getFraudEngine } from '../fraud/engine.js'
import { SignalType, RiskLevel, ActionType, EntityType } from '../fraud/types.js'

const createSignalSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  signalType: z.nativeEnum(SignalType),
  config: z.record(z.unknown()),
  enabled: z.boolean().optional(),
  scoreWeight: z.number().int().min(1).max(100).optional(),
})

const updateSignalSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  signalType: z.nativeEnum(SignalType).optional(),
  config: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
  scoreWeight: z.number().int().min(1).max(100).optional(),
})

const evaluateEventSchema = z.object({
  entityType: z.nativeEnum(EntityType),
  entityId: z.string().min(1),
  eventData: z.record(z.unknown()),
  metadata: z.record(z.unknown()).optional(),
})

const listAssessmentsQuerySchema = z.object({
  riskLevel: z.nativeEnum(RiskLevel).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

const releaseHoldSchema = z.object({
  releasedBy: z.string().min(1),
})

const updateThresholdsSchema = z.object({
  medium: z.number().int().min(0).optional(),
  high: z.number().int().min(0).optional(),
  critical: z.number().int().min(0).optional(),
})

export function createAdminFraudRouter() {
  const router = Router()

  function requireAdmin(req: Request) {
    const headerSecret = req.headers['x-admin-secret']
    if (env.MANUAL_ADMIN_SECRET && headerSecret !== env.MANUAL_ADMIN_SECRET) {
      throw new AppError(ErrorCode.FORBIDDEN, 403, 'Invalid admin secret')
    }
  }

  // ---------------------------------------------------------------------------
  // Signal Management
  // ---------------------------------------------------------------------------

  /**
   * GET /api/admin/fraud/signals
   * List all fraud signals
   */
  router.get('/signals', async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireAdmin(req)
      const enabled = req.query.enabled === 'true' ? true : req.query.enabled === 'false' ? false : undefined
      const signals = await getFraudStore().listSignals({ enabled })
      res.json({ signals })
    } catch (err) {
      next(err)
    }
  })

  /**
   * GET /api/admin/fraud/signals/:id
   * Get a single fraud signal
   */
  router.get('/signals/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireAdmin(req)
      const signal = await getFraudStore().getSignal(req.params.id)
      if (!signal) throw new AppError(ErrorCode.NOT_FOUND, 404, `Signal ${req.params.id} not found`)
      res.json({ signal })
    } catch (err) {
      next(err)
    }
  })

  /**
   * POST /api/admin/fraud/signals
   * Create a new fraud signal
   */
  router.post(
    '/signals',
    validate(createSignalSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        requireAdmin(req)
        const body = req.body as z.infer<typeof createSignalSchema>
        const signal = await getFraudStore().createSignal(body)
        res.status(201).json({ signal })
      } catch (err) {
        next(err)
      }
    },
  )

  /**
   * PUT /api/admin/fraud/signals/:id
   * Update a fraud signal
   */
  router.put(
    '/signals/:id',
    validate(updateSignalSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        requireAdmin(req)
        const body = req.body as z.infer<typeof updateSignalSchema>
        const signal = await getFraudStore().updateSignal(req.params.id, body)
        res.json({ signal })
      } catch (err) {
        next(err)
      }
    },
  )

  /**
   * DELETE /api/admin/fraud/signals/:id
   * Delete a fraud signal
   */
  router.delete('/signals/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireAdmin(req)
      await getFraudStore().deleteSignal(req.params.id)
      res.json({ success: true })
    } catch (err) {
      next(err)
    }
  })

  /**
   * POST /api/admin/fraud/signals/:id/enable
   * Enable a fraud signal
   */
  router.post('/signals/:id/enable', async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireAdmin(req)
      await getFraudStore().enableSignal(req.params.id)
      res.json({ success: true })
    } catch (err) {
      next(err)
    }
  })

  /**
   * POST /api/admin/fraud/signals/:id/disable
   * Disable a fraud signal
   */
  router.post('/signals/:id/disable', async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireAdmin(req)
      await getFraudStore().disableSignal(req.params.id)
      res.json({ success: true })
    } catch (err) {
      next(err)
    }
  })

  // ---------------------------------------------------------------------------
  // Assessment Management
  // ---------------------------------------------------------------------------

  /**
   * POST /api/admin/fraud/evaluate
   * Manually evaluate an event against fraud signals
   */
  router.post(
    '/evaluate',
    validate(evaluateEventSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        requireAdmin(req)
        const body = req.body as z.infer<typeof evaluateEventSchema>
        const engine = getFraudEngine()
        const assessment = await engine.evaluate(body)
        res.json({ assessment })
      } catch (err) {
        next(err)
      }
    },
  )

  /**
   * GET /api/admin/fraud/assessments
   * List fraud assessments
   */
  router.get(
    '/assessments',
    validate(listAssessmentsQuerySchema, 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        requireAdmin(req)
        const { riskLevel, limit, offset } = req.query as unknown as z.infer<typeof listAssessmentsQuerySchema>
        const assessments = await getFraudStore().listAssessments({ riskLevel, limit, offset })
        res.json({ assessments })
      } catch (err) {
        next(err)
      }
    },
  )

  /**
   * GET /api/admin/fraud/assessments/:id
   * Get a single assessment
   */
  router.get('/assessments/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireAdmin(req)
      const assessment = await getFraudStore().getAssessment(req.params.id)
      if (!assessment) throw new AppError(ErrorCode.NOT_FOUND, 404, `Assessment ${req.params.id} not found`)
      res.json({ assessment })
    } catch (err) {
      next(err)
    }
  })

  /**
   * GET /api/admin/fraud/assessments/entity/:type/:id
   * Get assessments for a specific entity
   */
  router.get(
    '/assessments/entity/:type/:id',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        requireAdmin(req)
        const entityType = req.params.type as EntityType
        const entityId = req.params.id
        const limit = parseInt(req.query.limit as string) || 50
        const assessments = await getFraudStore().getAssessmentsByEntity(entityType, entityId, limit)
        res.json({ assessments })
      } catch (err) {
        next(err)
      }
    },
  )

  // ---------------------------------------------------------------------------
  // Account Hold Management
  // ---------------------------------------------------------------------------

  /**
   * GET /api/admin/fraud/holds/:accountId
   * Get active holds for an account
   */
  router.get('/holds/:accountId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireAdmin(req)
      const holds = await getFraudStore().getActiveHolds(req.params.accountId)
      res.json({ holds })
    } catch (err) {
      next(err)
    }
  })

  /**
   * POST /api/admin/fraud/holds/:holdId/release
   * Release an account hold
   */
  router.post(
    '/holds/:holdId/release',
    validate(releaseHoldSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        requireAdmin(req)
        const { releasedBy } = req.body as z.infer<typeof releaseHoldSchema>
        await getFraudStore().releaseHold(req.params.holdId, releasedBy)
        res.json({ success: true })
      } catch (err) {
        next(err)
      }
    },
  )

  // ---------------------------------------------------------------------------
  // Threshold Management
  // ---------------------------------------------------------------------------

  /**
   * GET /api/admin/fraud/thresholds
   * Get current risk thresholds
   */
  router.get('/thresholds', async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireAdmin(req)
      const engine = getFraudEngine()
      const thresholds = engine.getThresholds()
      res.json({ thresholds })
    } catch (err) {
      next(err)
    }
  })

  /**
   * PUT /api/admin/fraud/thresholds
   * Update risk thresholds
   */
  router.put(
    '/thresholds',
    validate(updateThresholdsSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        requireAdmin(req)
        const body = req.body as z.infer<typeof updateThresholdsSchema>
        const engine = getFraudEngine()
        engine.updateThresholds(body)
        const thresholds = engine.getThresholds()
        res.json({ thresholds })
      } catch (err) {
        next(err)
      }
    },
  )

  return router
}
