/**
 * Account erasure routes (#2053), mounted at /api/v1/tenant/erasure.
 *
 *   POST   /              request erasure (refused while deals, withdrawals, balance or disputes block it)
 *   GET    /              the latest request, or null
 *   POST   /:id/confirm   confirm a pending request; starts the 14-day grace period
 *   DELETE /              cancel the open request while the grace period is running
 */

import { Router, type NextFunction, type Response } from 'express'
import { z } from 'zod'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { extractAuditContext } from '../utils/auditLogger.js'
import {
  cancelErasure,
  confirmErasure,
  getErasure,
  requestErasure,
} from '../services/erasureService.js'

const erasureIdParamsSchema = z.object({
  id: z.string().uuid('Invalid erasure request id'),
})

function callerId(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Authentication required')
  }
  return req.user.id
}

export function createErasureRouter(): Router {
  const router = Router()

  router.post(
    '/',
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const view = await requestErasure(callerId(req), extractAuditContext(req, 'user'))
        res.status(201).json({ success: true, data: view })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/',
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const view = await getErasure(callerId(req))
        res.json({ success: true, data: view })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/:id/confirm',
    authenticateToken,
    validate(erasureIdParamsSchema, 'params'),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params as { id: string }
        const view = await confirmErasure(callerId(req), id, extractAuditContext(req, 'user'))
        res.json({ success: true, data: view })
      } catch (error) {
        next(error)
      }
    },
  )

  router.delete(
    '/',
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const view = await cancelErasure(callerId(req), extractAuditContext(req, 'user'))
        res.json({ success: true, data: view })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
