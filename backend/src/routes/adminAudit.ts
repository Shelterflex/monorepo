/**
 * Admin Audit Log Routes
 *
 * GET  /api/admin/audit         — search audit log with filters + pagination
 * GET  /api/admin/audit/verify  — verify the hash-chain integrity
 */

import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { env } from '../schemas/env.js'
import { auditRepository } from '../repositories/AuditRepository.js'
import type { AuditEventType, ActorType } from '../utils/auditLogger.js'

const auditSearchQuerySchema = z.object({
  eventType: z.string().optional(),
  actorType: z.enum(['user', 'admin', 'system']).optional(),
  userId: z.string().optional(),
  requestId: z.string().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

const verifyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(10000).default(1000),
})

export function createAdminAuditRouter() {
  const router = Router()

  function requireAdminSecret(req: Request): void {
    const headerSecret = req.headers['x-admin-secret']
    if (env.MANUAL_ADMIN_SECRET && headerSecret !== env.MANUAL_ADMIN_SECRET) {
      throw new AppError(ErrorCode.FORBIDDEN, 403, 'Invalid admin secret')
    }
  }

  /**
   * GET /api/admin/audit
   *
   * Query params:
   *   eventType   — filter by event type
   *   actorType   — filter by actor type (user | admin | system)
   *   userId      — filter by user ID
   *   requestId   — filter by request correlation ID
   *   dateFrom    — ISO 8601 lower bound (inclusive)
   *   dateTo      — ISO 8601 upper bound (inclusive)
   *   page        — page number (default 1)
   *   pageSize    — entries per page (default 50, max 200)
   */
  router.get('/audit', async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireAdminSecret(req)

      const parsed = auditSearchQuerySchema.safeParse(req.query)
      if (!parsed.success) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          400,
          parsed.error.errors.map((e) => e.message).join('; '),
        )
      }

      const q = parsed.data
      const result = await auditRepository.search({
        eventType: q.eventType as AuditEventType | undefined,
        actorType: q.actorType as ActorType | undefined,
        userId: q.userId,
        requestId: q.requestId,
        dateFrom: q.dateFrom ? new Date(q.dateFrom) : undefined,
        dateTo: q.dateTo ? new Date(q.dateTo) : undefined,
        page: q.page,
        pageSize: q.pageSize,
      })

      res.json({
        entries: result.entries.map((e) => ({
          id: e.id,
          eventType: e.eventType,
          actorType: e.actorType,
          userId: e.userId,
          requestId: e.requestId,
          ipAddress: e.ipAddress,
          httpMethod: e.httpMethod,
          httpPath: e.httpPath,
          metadata: e.metadata,
          createdAt: e.createdAt.toISOString(),
        })),
        pagination: {
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
          totalPages: result.totalPages,
        },
      })
    } catch (error) {
      next(error)
    }
  })

  /**
   * GET /api/admin/audit/verify
   *
   * Verify hash-chain integrity for the most recent N rows.
   *
   * Query params:
   *   limit — max rows to verify (default 1000, max 10000)
   */
  router.get('/audit/verify', async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireAdminSecret(req)

      const parsed = verifyQuerySchema.safeParse(req.query)
      if (!parsed.success) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          400,
          parsed.error.errors.map((e) => e.message).join('; '),
        )
      }

      const result = await auditRepository.verifyChain(parsed.data.limit)

      res.status(result.valid ? 200 : 409).json({
        valid: result.valid,
        checkedCount: result.checkedCount,
        firstBrokenId: result.firstBrokenId,
        error: result.error,
      })
    } catch (error) {
      next(error)
    }
  })

  return router
}
