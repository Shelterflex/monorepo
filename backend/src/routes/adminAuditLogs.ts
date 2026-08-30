/**
 * Admin Audit Log Viewer Route
 *
 * GET /api/v1/admin/audit-logs
 *
 * Filterable, paginated view of the audit_log table for compliance and
 * internal security reviews.  Non-admin requests receive 403.
 *
 * Query params:
 *   actorId      — filter by the user/actor ID that performed the action
 *   action       — filter by event type (e.g. USER_LOGIN, DEAL_APPROVED)
 *   resourceType — filter by resource type stored in metadata (e.g. deal, user)
 *   resourceId   — filter by resource ID stored in metadata
 *   startDate    — ISO 8601 lower bound on created_at (inclusive)
 *   endDate      — ISO 8601 upper bound on created_at (inclusive)
 *   page         — page number (default 1)
 *   limit        — items per page (default 50, max 200)
 */

import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { assertAdminSecret } from '../middleware/adminSecret.js'
import { auditLogRepository } from '../repositories/AuditLogRepository.js'

const auditLogsQuerySchema = z.object({
  actorId: z.string().optional(),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export function createAdminAuditLogsRouter() {
  const router = Router()

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      assertAdminSecret(req)

      const parsed = auditLogsQuerySchema.safeParse(req.query)
      if (!parsed.success) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          400,
          parsed.error.errors.map((e) => e.message).join('; '),
        )
      }

      const q = parsed.data
      const result = await auditLogRepository.list(
        {
          actorId: q.actorId,
          action: q.action,
          resourceType: q.resourceType,
          resourceId: q.resourceId,
          startDate: q.startDate ? new Date(q.startDate) : undefined,
          endDate: q.endDate ? new Date(q.endDate) : undefined,
        },
        { page: q.page, limit: q.limit },
      )

      res.json({
        entries: result.entries.map((e) => ({
          id: e.id,
          action: e.action,
          actorId: e.actorId,
          actorType: e.actorType,
          resourceType: e.resourceType,
          resourceId: e.resourceId,
          ipAddress: e.ipAddress,
          result: e.result,
          metadata: e.metadata,
          createdAt: e.createdAt.toISOString(),
        })),
        pagination: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
        },
      })
    } catch (error) {
      next(error)
    }
  })

  return router
}
