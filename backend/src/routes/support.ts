/**
 * Support routes (issue #2056). The contact form was failing because nothing
 * mounted its endpoint, so this router restores it.
 *
 *   POST /api/v1/support/messages          public contact-form submission, rate limited per IP
 *   GET  /api/v1/admin/support/messages    admin list: paginated, optional status filter
 */

import { Router, type Response, type NextFunction } from 'express'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'
import { requirePermission } from '../middleware/rbac.js'
import { validate } from '../middleware/validate.js'
import { createRateLimiter } from '../middleware/rateLimiter.js'
import { rateLimitProfiles } from '../config/rateLimitConfig.js'
import { supportMessageStore } from '../models/supportMessageStore.js'
import {
  createSupportMessageSchema,
  listSupportMessagesQuerySchema,
  type CreateSupportMessageRequest,
  type ListSupportMessagesQuery,
} from '../schemas/supportMessage.js'
import { logger } from '../utils/logger.js'

/** Public router. Mounted at /api/v1/support, so the handler path is /messages. */
export function createSupportRouter(): Router {
  const router = Router()
  // Built per router, so each app gets its own counters.
  const publicRateLimiter = createRateLimiter(rateLimitProfiles.supportMessage)

  router.post(
    '/messages',
    publicRateLimiter,
    validate(createSupportMessageSchema, 'body'),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const body = req.body as CreateSupportMessageRequest

        const message = await supportMessageStore.create({
          name: body.name,
          email: body.email,
          phone: body.phone ?? null,
          subject: body.subject,
          message: body.message,
          ip: req.ip ?? null,
          userAgent: req.get('user-agent') ?? null,
        })

        // Log the id only. The body holds personal details and does not belong in logs.
        logger.info('[support] Message received', { messageId: message.messageId })

        // Same response shape as the frontend's SupportMessageResponse.
        res.status(201).json({ success: true, messageId: message.messageId })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}

/** Admin router. Mounted at /api/v1/admin/support, so the handler path is /messages. */
export function createAdminSupportRouter(): Router {
  const router = Router()

  router.get(
    '/messages',
    authenticateToken,
    requirePermission('support', 'view'),
    validate(listSupportMessagesQuerySchema, 'query'),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const query = req.query as unknown as ListSupportMessagesQuery

        const result = await supportMessageStore.list({
          page: query.page,
          pageSize: query.pageSize,
          status: query.status,
        })

        res.json({
          success: true,
          data: result.messages,
          pagination: {
            page: result.page,
            pageSize: result.pageSize,
            total: result.total,
            totalPages: result.totalPages,
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
