/**
 * Admin routes for payment disputes: list + resolve.
 *
 * paymentDispute.ts already implements this exact logic (GET /admin,
 * POST /admin/:disputeId/resolve) but that router is never mounted in
 * app.ts — see the PR description. This router is the reachable one; it is
 * deliberately kept separate from tenantPayments.ts's live POST/GET
 * /disputes (the tenant-facing create/list routes) rather than merged, to
 * avoid touching that router's request/response shape.
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { paymentDisputeRepository } from '../repositories/PaymentDisputeRepository.js'
import { authenticateToken } from '../middleware/auth.js'
import { requirePermission } from '../middleware/rbac.js'
import { validate } from '../middleware/validate.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { auditLog, extractAuditContext, type AuditEventType } from '../utils/auditLogger.js'
import { logger } from '../utils/logger.js'
import { enqueueResolveRentDispute } from '../services/disputes/rentReleaseSync.js'

const resolveDisputeSchema = z.object({
  status: z.enum(['resolved', 'rejected']),
  resolution: z.string().max(1000, 'Resolution must be at most 1000 characters').optional(),
})

const router = Router()

router.get(
  '/',
  authenticateToken,
  requirePermission('disputes', 'view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, userId, page, pageSize } = req.query
      const result = await paymentDisputeRepository.list({
        status: status as any,
        userId: userId as string,
        page: parseInt(page as string) || 1,
        pageSize: parseInt(pageSize as string) || 50,
      })

      res.json(result)
    } catch (error) {
      next(error)
    }
  },
)

router.post(
  '/:disputeId/resolve',
  authenticateToken,
  requirePermission('disputes', 'resolve'),
  validate(resolveDisputeSchema, 'body'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { disputeId } = req.params
      const adminId = (req as any).user.id as string
      const { status, resolution } = req.body as { status: string; resolution?: string }

      const dispute = await paymentDisputeRepository.findById(disputeId)
      if (!dispute) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Dispute not found')
      }

      const newStatus = status === 'resolved' ? 'resolved' : 'rejected'
      const resolved = await paymentDisputeRepository.updateStatus(
        disputeId,
        newStatus,
        resolution,
        adminId,
      )

      enqueueResolveRentDispute(resolved, newStatus, resolution ?? '').catch((err) =>
        logger.error('Failed to enqueue resolve_rent_dispute for dispute:', err),
      )

      auditLog('DISPUTE_RESOLVED' as AuditEventType, extractAuditContext(req, 'admin'), {
        disputeId,
        status: newStatus,
        resolution,
      })

      res.json({ success: true })
    } catch (error) {
      next(error)
    }
  },
)

export function createDisputeAdminRouter(): Router {
  return router
}
