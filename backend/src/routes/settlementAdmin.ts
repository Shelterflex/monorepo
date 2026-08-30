import { Router, type Request, type Response, type NextFunction } from 'express'
import { getPool } from '../db.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { assertAdminSecret as requireAdmin } from '../middleware/adminSecret.js'
import { generateId } from '../utils/tokens.js'
import { logger } from '../utils/logger.js'

/**
 * Admin tools for dead-letter queue replay (settlement outbox).
 * POST /api/admin/settlement-dlq/:id/replay — requeues a row from `settlement_outbox_dlq` into `settlement_outbox`.
 */
export function createSettlementAdminRouter() {
  const r = Router()

  r.post(
    '/settlement-dlq/:id/replay',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        requireAdmin(req)
        const pool = await getPool()
        if (!pool) {
          return res.status(501).json({ error: { message: 'Database required for DLQ replay' } })
        }
        const id = String(req.params.id)
        const { rows } = await pool.query(
          `SELECT * FROM settlement_outbox_dlq WHERE id = $1`,
          [id],
        )
        if (rows.length === 0) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, 'DLQ entry not found')
        }
        const row = rows[0] as {
          deal_id: string
          period: number
          event_type: string
          idempotency_key: string
          payload: unknown
        }
        const newId = generateId()
        const payload = typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload)
        try {
          await pool.query(
            `INSERT INTO settlement_outbox (id, deal_id, period, event_type, idempotency_key, payload, status, attempts, next_retry_at, last_error)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'pending', 0, NULL, NULL)`,
            [newId, row.deal_id, row.period, row.event_type, row.idempotency_key, payload],
          )
        } catch (e: unknown) {
          const err = e as { code?: string }
          if (err.code === '23505') {
            await pool.query(
              `UPDATE settlement_outbox
               SET status = 'pending', attempts = 0, next_retry_at = NULL, last_error = NULL, updated_at = NOW()
               WHERE idempotency_key = $1`,
              [row.idempotency_key],
            )
          } else {
            throw e
          }
        }
        await pool.query(
          `UPDATE settlement_outbox_dlq SET replayed_at = NOW() WHERE id = $1`,
          [id],
        )
        logger.info('DLQ entry replayed to settlement outbox', { oldId: id, newId })
        res.json({ success: true, newOutboxId: newId })
      } catch (e) {
        next(e)
      }
    },
  )

  r.get(
    '/settlement-dlq',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        requireAdmin(req)
        const pool = await getPool()
        if (!pool) {
          return res.json({ items: [] })
        }
        const { rows } = await pool.query(
          `SELECT id, deal_id, period, event_type, idempotency_key, last_error, failed_at, replayed_at
           FROM settlement_outbox_dlq ORDER BY failed_at DESC LIMIT 100`,
        )
        res.json({ success: true, data: { items: rows } })
      } catch (e) {
        next(e)
      }
    },
  )

  return r
}
