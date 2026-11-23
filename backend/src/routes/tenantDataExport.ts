/**
 * Tenant personal-data export routes (#2052), mounted at /api/v1/tenant/data-export.
 *
 *   POST /      queue an export; the archive is built by a scheduled job
 *   GET  /:id   status of one of the caller's exports, plus a short-lived download URL once ready
 */

import { Router, type NextFunction, type Response } from 'express'
import { z } from 'zod'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { getExport, requestExport } from '../services/tenantDataExportService.js'

const exportIdParamsSchema = z.object({
  id: z.string().uuid('Invalid export id'),
})

function callerId(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Authentication required')
  }
  return req.user.id
}

export function createTenantDataExportRouter(): Router {
  const router = Router()

  router.post(
    '/',
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const view = await requestExport(callerId(req))
        res.status(202).json({ success: true, data: view })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/:id',
    authenticateToken,
    validate(exportIdParamsSchema, 'params'),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params as { id: string }
        const view = await getExport(callerId(req), id)
        res.set('Cache-Control', 'no-store')
        res.json({ success: true, data: view })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
