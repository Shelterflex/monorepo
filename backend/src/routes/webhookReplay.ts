import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { AppError, ErrorCode } from '../errors/index.js'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'
import { extractAuditContext } from '../utils/auditLogger.js'
import { getWebhookReplayService, ActorType } from '../webhookReplay/index.js'
import { ReplayRequest } from '../webhookReplay/types.js'
import { env } from '../schemas/env.js'

const router = Router()

// Admin check middleware
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const headerSecret = req.headers['x-admin-secret']
  if (env.MANUAL_ADMIN_SECRET && headerSecret !== env.MANUAL_ADMIN_SECRET) {
    throw new AppError(ErrorCode.FORBIDDEN, 403, 'Invalid admin secret')
  }
  next()
}

// Validation schemas
const replayRequestSchema = z.object({
  provider: z.string().optional(),
  eventType: z.string().optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  webhookEventId: z.string().uuid().optional(),
  dryRun: z.boolean(),
  reason: z.string().min(1, 'Reason is required'),
})

/**
 * POST /api/admin/webhook-replay/preview
 * Preview which events would be replayed
 */
router.post(
  '/preview',
  authenticateToken,
  requireAdmin,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id
      if (!userId) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Authentication required')
      }

      const validated = replayRequestSchema.parse(req.body)
      const replayRequest: ReplayRequest = {
        ...validated,
        startTime: validated.startTime ? new Date(validated.startTime) : undefined,
        endTime: validated.endTime ? new Date(validated.endTime) : undefined,
      }

      const service = getWebhookReplayService()
      const preview = await service.previewReplay(replayRequest)

      res.json({
        totalEvents: preview.totalEvents,
        events: preview.events,
      })
    } catch (error) {
      next(error)
    }
  }
)

/**
 * POST /api/admin/webhook-replay/execute
 * Execute a webhook replay
 */
router.post(
  '/execute',
  authenticateToken,
  requireAdmin,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id
      if (!userId) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Authentication required')
      }

      const validated = replayRequestSchema.parse(req.body)
      const replayRequest: ReplayRequest = {
        ...validated,
        startTime: validated.startTime ? new Date(validated.startTime) : undefined,
        endTime: validated.endTime ? new Date(validated.endTime) : undefined,
      }

      const context = extractAuditContext(req, ActorType.ADMIN)
      const service = getWebhookReplayService()
      const attempt = await service.executeReplay(replayRequest, context)

      res.status(201).json(attempt)
    } catch (error) {
      next(error)
    }
  }
)

/**
 * GET /api/admin/webhook-replay/history
 * Get replay history
 */
router.get(
  '/history',
  authenticateToken,
  requireAdmin,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id
      if (!userId) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Authentication required')
      }

      const { webhookEventId, actorUserId } = req.query

      const service = getWebhookReplayService()
      const history = await service.getReplayHistory(
        webhookEventId as string | undefined,
        actorUserId as string | undefined
      )

      res.json(history)
    } catch (error) {
      next(error)
    }
  }
)

/**
 * GET /api/admin/webhook-replay/events/:id
 * Get a specific webhook event
 */
router.get(
  '/events/:id',
  authenticateToken,
  requireAdmin,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id
      if (!userId) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Authentication required')
      }

      const { id } = req.params

      const service = getWebhookReplayService()
      const event = await service.getWebhookEvent(id)

      if (!event) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Webhook event not found')
      }

      res.json(event)
    } catch (error) {
      next(error)
    }
  }
)

export function createWebhookReplayRouter(): Router {
  return router
}
