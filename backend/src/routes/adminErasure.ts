import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { assertAdminSecret } from '../middleware/adminSecret.js'
import { erasureService } from '../services/erasureService.js'
import { auditLog, extractAuditContext } from '../utils/auditLogger.js'
import { validate } from '../middleware/validate.js'

const confirmErasureParamsSchema = z.object({
  requestId: z.string().uuid(),
})

export function createAdminErasureRouter(): Router {
  const router = Router()

  /**
   * POST /api/admin/erasure/:requestId/confirm
   * Admin confirms a pending erasure request and anonymises user PII.
   */
  router.post(
    '/:requestId/confirm',
    validate(confirmErasureParamsSchema, 'params'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        assertAdminSecret(req)
        const adminUserId = (req as any).user?.id ?? 'admin'
        const { requestId } = req.params

        try {
          await erasureService.confirmErasure(requestId, adminUserId)
        } catch (err) {
          if (err instanceof Error) {
            if (err.message === 'ERASURE_NOT_FOUND') {
              throw new AppError(ErrorCode.NOT_FOUND, 404, 'Erasure request not found')
            }
            if (err.message === 'ERASURE_NOT_PENDING') {
              throw new AppError(ErrorCode.CONFLICT, 409, 'Erasure request is not pending')
            }
          }
          throw err
        }

        auditLog('USER_ERASURE_COMPLETED', extractAuditContext(req, 'admin'), {
          erasureRequestId: requestId,
          confirmedBy: adminUserId,
        })

        res.json({ success: true, message: 'User data anonymised and account deactivated' })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
