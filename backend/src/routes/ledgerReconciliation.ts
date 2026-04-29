import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { env } from '../schemas/env.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { validate } from '../middleware/validate.js'
import {
  listMismatches,
  getMismatchAgingReport,
  updateMismatchStatus,
  ingestLedgerEvent,
  ingestProviderEvent,
} from '../reconciliation/store.js'
import { runReconciliationPass } from '../reconciliation/engine.js'
import { runResolutionPass } from '../reconciliation/resolver.js'
import type { MismatchStatus, MismatchClass } from '../reconciliation/types.js'

function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const headerSecret = req.headers['x-admin-secret']
  if (env.MANUAL_ADMIN_SECRET && headerSecret !== env.MANUAL_ADMIN_SECRET) {
    return next(new AppError(ErrorCode.FORBIDDEN, 403, 'Invalid admin secret'))
  }
  return next()
}

const mismatchQuerySchema = z.object({
  status: z.enum(['open', 'auto_resolved', 'escalated', 'closed']).optional(),
  mismatch_class: z
    .enum(['missing_credit', 'duplicate_debit', 'amount_mismatch', 'delayed_settlement'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  cursor: z.string().datetime().optional(),
})

const ingestLedgerSchema = z.object({
  eventType: z.enum(['credit', 'debit']),
  amountMinor: z.number().int().positive(),
  currency: z.string().default('NGN'),
  internalRef: z.string().min(1),
  rail: z.string().min(1),
  userId: z.string().optional(),
  occurredAt: z.string().datetime(),
})

const ingestProviderSchema = z.object({
  provider: z.string().min(1),
  providerEventId: z.string().min(1),
  eventType: z.enum(['credit', 'debit']),
  amountMinor: z.number().int().positive(),
  currency: z.string().default('NGN'),
  internalRef: z.string().optional(),
  rawStatus: z.string().min(1),
  occurredAt: z.string().datetime(),
})

export function createLedgerReconciliationRouter() {
  const router = Router()

  // ── Reports ──────────────────────────────────────────────────────────────────

  /** GET /api/admin/ledger-reconciliation/mismatches — paginated mismatch list */
  router.get(
    '/mismatches',
    requireAdmin,
    validate(mismatchQuerySchema, 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const q = req.query as unknown as z.infer<typeof mismatchQuerySchema>
        const mismatches = await listMismatches({
          status: q.status as MismatchStatus | undefined,
          mismatchClass: q.mismatch_class as MismatchClass | undefined,
          limit: q.limit,
          cursorCreatedAt: q.cursor ? new Date(q.cursor) : undefined,
        })
        res.json({ data: mismatches, count: mismatches.length })
      } catch (err) {
        next(err)
      }
    },
  )

  /** GET /api/admin/ledger-reconciliation/aging — SLA aging report grouped by class/status */
  router.get(
    '/aging',
    requireAdmin,
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const report = await getMismatchAgingReport()
        res.json({ data: report })
      } catch (err) {
        next(err)
      }
    },
  )

  // ── Actions ───────────────────────────────────────────────────────────────────

  /** POST /api/admin/ledger-reconciliation/mismatches/:id/close — manually close a mismatch */
  router.post(
    '/mismatches/:id/close',
    requireAdmin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params
        await updateMismatchStatus(id, 'closed', {
          resolutionWorkflow: 'manual_close',
          lastResolutionAt: new Date(),
        })
        res.json({ ok: true })
      } catch (err) {
        next(err)
      }
    },
  )

  /** POST /api/admin/ledger-reconciliation/run — trigger an immediate reconciliation pass */
  router.post(
    '/run',
    requireAdmin,
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const [reconResult, resolveResult] = await Promise.all([
          runReconciliationPass(),
          runResolutionPass(),
        ])
        res.json({ reconciliation: reconResult, resolution: resolveResult })
      } catch (err) {
        next(err)
      }
    },
  )

  // ── Event ingestion ───────────────────────────────────────────────────────────

  /** POST /api/admin/ledger-reconciliation/ledger-events — ingest an internal ledger event */
  router.post(
    '/ledger-events',
    requireAdmin,
    validate(ingestLedgerSchema, 'body'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = req.body as z.infer<typeof ingestLedgerSchema>
        const event = await ingestLedgerEvent({
          ...body,
          amountMinor: BigInt(body.amountMinor),
          occurredAt: new Date(body.occurredAt),
        })
        res.status(201).json({ data: { ...event, amountMinor: event.amountMinor.toString() } })
      } catch (err) {
        next(err)
      }
    },
  )

  /** POST /api/admin/ledger-reconciliation/provider-events — ingest a provider settlement event */
  router.post(
    '/provider-events',
    requireAdmin,
    validate(ingestProviderSchema, 'body'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = req.body as z.infer<typeof ingestProviderSchema>
        const event = await ingestProviderEvent({
          ...body,
          amountMinor: BigInt(body.amountMinor),
          occurredAt: new Date(body.occurredAt),
        })
        res.status(201).json({ data: { ...event, amountMinor: event.amountMinor.toString() } })
      } catch (err) {
        next(err)
      }
    },
  )

  return router
}
