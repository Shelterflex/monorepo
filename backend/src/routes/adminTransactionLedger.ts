/**
 * Admin Transaction Ledger API  (#683)
 *
 * GET  /api/admin/transaction-ledger         — paginated ledger with filters
 * GET  /api/admin/transaction-ledger/export  — CSV export scoped to active filters
 */

import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { env } from '../schemas/env.js'
import { getPool } from '../db.js'
import { validate } from '../middleware/validate.js'

// ── Schema ────────────────────────────────────────────────────────────────────

const ledgerQuerySchema = z.object({
  // Pagination
  cursor:     z.string().optional(),        // ISO datetime of last seen row
  limit:      z.coerce.number().int().min(1).max(500).default(50),
  // Filters
  dateFrom:   z.string().datetime().optional(),
  dateTo:     z.string().datetime().optional(),
  type:       z.string().optional(),        // e.g. deposit, withdrawal, conversion
  currency:   z.string().optional(),        // NGN, USDC, XLM …
  status:     z.string().optional(),        // pending, confirmed, failed, reversed
  actor:      z.string().optional(),        // userId or email partial
  amountMin:  z.coerce.bigint().optional(),
  amountMax:  z.coerce.bigint().optional(),
  // Sort
  sortBy:     z.enum(['date', 'amount', 'status']).default('date'),
  sortDir:    z.enum(['asc', 'desc']).default('desc'),
})

type LedgerQuery = z.infer<typeof ledgerQuerySchema>

// ── Helpers ───────────────────────────────────────────────────────────────────

function requireAdmin(req: Request): void {
  const secret = req.headers['x-admin-secret']
  if (env.MANUAL_ADMIN_SECRET && secret !== env.MANUAL_ADMIN_SECRET) {
    throw new AppError(ErrorCode.FORBIDDEN, 403, 'Invalid admin secret')
  }
}

function buildWhereClause(
  q: LedgerQuery,
  params: unknown[],
  startIdx = 1,
): string {
  const conditions: string[] = []
  let idx = startIdx

  if (q.cursor)    { conditions.push(`tl.created_at < $${idx++}`);  params.push(q.cursor) }
  if (q.dateFrom)  { conditions.push(`tl.created_at >= $${idx++}`); params.push(q.dateFrom) }
  if (q.dateTo)    { conditions.push(`tl.created_at <= $${idx++}`); params.push(q.dateTo) }
  if (q.type)      { conditions.push(`tl.tx_type = $${idx++}`);     params.push(q.type) }
  if (q.currency)  { conditions.push(`tl.currency = $${idx++}`);    params.push(q.currency) }
  if (q.status)    { conditions.push(`tl.status = $${idx++}`);      params.push(q.status) }
  if (q.actor)     { conditions.push(`(tl.user_id::text ILIKE $${idx++} OR u.email ILIKE $${idx++})`);
                     params.push(`%${q.actor}%`); params.push(`%${q.actor}%`); idx++ }
  if (q.amountMin !== undefined) { conditions.push(`tl.amount_minor >= $${idx++}`); params.push(q.amountMin.toString()) }
  if (q.amountMax !== undefined) { conditions.push(`tl.amount_minor <= $${idx++}`); params.push(q.amountMax.toString()) }

  return conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
}

const SORT_COL: Record<string, string> = {
  date:   'tl.created_at',
  amount: 'tl.amount_minor',
  status: 'tl.status',
}

async function queryLedger(q: LedgerQuery) {
  const pool = await getPool()
  if (!pool) return { rows: [], total: 0 }

  const params: unknown[] = []
  const where = buildWhereClause(q, params)
  const col = SORT_COL[q.sortBy]
  const dir = q.sortDir.toUpperCase()

  const sql = `
    SELECT
      tl.id, tl.tx_type, tl.internal_ref, tl.external_ref,
      tl.amount_minor, tl.currency, tl.status,
      tl.user_id, u.email AS actor_email,
      tl.created_at, tl.updated_at
    FROM transaction_ledger tl
    LEFT JOIN users u ON u.id = tl.user_id
    ${where}
    ORDER BY ${col} ${dir}, tl.id ${dir}
    LIMIT $${params.length + 1}
  `
  params.push(q.limit + 1) // fetch one extra to detect hasNextPage

  const { rows } = await pool.query(sql, params)
  const hasNextPage = rows.length > q.limit
  return { rows: hasNextPage ? rows.slice(0, q.limit) : rows, hasNextPage }
}

function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return 'id,tx_type,internal_ref,external_ref,amount_minor,currency,status,actor_email,created_at\n'
  const headers = ['id','tx_type','internal_ref','external_ref','amount_minor','currency','status','actor_email','created_at']
  const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(','))
  }
  return lines.join('\n') + '\n'
}

// ── Router ────────────────────────────────────────────────────────────────────

export function createAdminTransactionLedgerRouter() {
  const router = Router()

  /** GET /api/admin/transaction-ledger — paginated ledger */
  router.get(
    '/',
    validate(ledgerQuerySchema, 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        requireAdmin(req)
        const q = req.query as unknown as LedgerQuery
        const { rows, hasNextPage } = await queryLedger(q)
        const nextCursor = hasNextPage
          ? (rows[rows.length - 1] as Record<string, unknown>)['created_at']
          : null
        res.json({ data: rows, count: rows.length, hasNextPage: !!hasNextPage, nextCursor })
      } catch (err) {
        next(err)
      }
    },
  )

  /** GET /api/admin/transaction-ledger/export — CSV export */
  router.get(
    '/export',
    validate(ledgerQuerySchema.omit({ cursor: true, limit: true, sortBy: true, sortDir: true }), 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        requireAdmin(req)
        // For CSV export, fetch all matching rows (cap at 100k to avoid OOM)
        const q: LedgerQuery = {
          ...(req.query as unknown as LedgerQuery),
          limit: 100_000,
          sortBy: 'date',
          sortDir: 'desc',
        }
        const { rows } = await queryLedger(q)
        const csv = rowsToCsv(rows as Record<string, unknown>[])
        const filename = `transaction-ledger-${new Date().toISOString().slice(0, 10)}.csv`
        res.setHeader('Content-Type', 'text/csv; charset=utf-8')
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
        res.send(csv)
      } catch (err) {
        next(err)
      }
    },
  )

  return router
}
