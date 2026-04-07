import { randomUUID } from 'node:crypto'
import {
  OutboxStatus,
  TxType,
  type OutboxItem,
  type CreateOutboxItemInput,
  type CanonicalExternalRefV1,
} from './types.js'
import { computeTxId, buildCanonicalString } from './canonicalization.js'
import { getPool } from '../db.js'

// ---------------------------------------------------------------------------
// Shared interface so both implementations are interchangeable
// ---------------------------------------------------------------------------
export interface OutboxHealthSummary {
  pending: number
  sent: number
  failed: number
  dead: number
  total: number
  oldestPending: string | null
  oldestFailed: string | null
}

export interface IOutboxStore {
  create(input: CreateOutboxItemInput): Promise<OutboxItem>
  getById(id: string): Promise<OutboxItem | null>
  getByExternalRef(source: string, ref: string): Promise<OutboxItem | null>
  listByStatus(status: OutboxStatus): Promise<OutboxItem[]>
  updateStatus(
    id: string,
    status: OutboxStatus,
    options?: { error?: string; nextRetryAt?: Date | null },
  ): Promise<OutboxItem | null>
  markDead(id: string, reason: string): Promise<OutboxItem | null>
  listByDealId(dealId: string, txType?: TxType): Promise<OutboxItem[]>
  listAll(limit?: number): Promise<OutboxItem[]>
  getHealthSummary(): Promise<OutboxHealthSummary>
  clear(): Promise<void>
}

// ---------------------------------------------------------------------------
// Row → OutboxItem mapper (shared)
// ---------------------------------------------------------------------------
function mapRow(row: Record<string, unknown>): OutboxItem {
  return {
    id: row.id as string,
    txType: row.tx_type as TxType,
    canonicalExternalRefV1: row.canonical_external_ref_v1 as CanonicalExternalRefV1,
    txId: row.tx_id as string,
    payload: row.payload as Record<string, unknown>,
    status: row.status as OutboxStatus,
    attempts: Number(row.attempts),
    lastError: (row.last_error as string) ?? '',
    aggregateType: (row.aggregate_type as string) ?? '',
    aggregateId: (row.aggregate_id as string) ?? '',
    eventType: (row.event_type as string) ?? '',
    retryCount: Number(row.retry_count),
    nextRetryAt: row.next_retry_at ? new Date(row.next_retry_at as string) : null,
    processedAt: row.processed_at ? new Date(row.processed_at as string) : null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }
}

// ---------------------------------------------------------------------------
// In-memory implementation (test / fallback)
// ---------------------------------------------------------------------------
class InMemoryOutboxStore implements IOutboxStore {
  public items = new Map<string, OutboxItem>()
  private refIndex = new Map<CanonicalExternalRefV1, string>()

  async create(input: CreateOutboxItemInput): Promise<OutboxItem> {
    const canonicalExternalRefV1 = buildCanonicalString(input.source, input.ref)
    const existingId = this.refIndex.get(canonicalExternalRefV1)
    if (existingId) {
      const existing = this.items.get(existingId)
      if (existing) return existing
    }

    const txId = computeTxId(input.source, input.ref)
    const now = new Date()
    const item: OutboxItem = {
      id: randomUUID(),
      txType: input.txType,
      canonicalExternalRefV1,
      txId,
      payload: input.payload,
      status: OutboxStatus.PENDING,
      attempts: 0,
      lastError: '',
      aggregateId: input.aggregateId ?? '',
      aggregateType: input.aggregateType ?? '',
      eventType: input.eventType ?? '',
      nextRetryAt: null,
      processedAt: null,
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
    }
    this.items.set(item.id, item)
    this.refIndex.set(canonicalExternalRefV1, item.id)
    return item
  }

  async getById(id: string) { return this.items.get(id) ?? null }

  async getByExternalRef(source: string, ref: string) {
    const canonical = buildCanonicalString(source, ref)
    const id = this.refIndex.get(canonical)
    if (!id) return null
    return this.items.get(id) ?? null
  }

  async listByStatus(status: OutboxStatus) {
    return [...this.items.values()]
      .filter((i) => i.status === status)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }

  async updateStatus(
    id: string,
    status: OutboxStatus,
    options?: { error?: string; nextRetryAt?: Date | null },
  ) {
    const item = this.items.get(id)
    if (!item) return null
    item.status = status
    item.attempts += 1
    item.retryCount += 1
    item.updatedAt = new Date()
    item.processedAt = new Date()
    if (options?.error !== undefined) item.lastError = options.error
    if (options?.nextRetryAt !== undefined) item.nextRetryAt = options.nextRetryAt
    this.items.set(id, item)
    return item
  }

  async markDead(id: string, reason: string) {
    const item = this.items.get(id)
    if (!item) return null
    item.status = OutboxStatus.DEAD
    item.lastError = reason
    item.nextRetryAt = null
    item.updatedAt = new Date()
    this.items.set(id, item)
    return item
  }

  async listByDealId(dealId: string, txType?: TxType) {
    return [...this.items.values()]
      .filter(i => i.payload.dealId === dealId && (txType === undefined || i.txType === txType))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }

  async listAll(limit = 100) {
    return [...this.items.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
  }

  async getHealthSummary(): Promise<OutboxHealthSummary> {
    const all = [...this.items.values()]
    const counts = { pending: 0, sent: 0, failed: 0, dead: 0 }
    let oldestPending: Date | null = null
    let oldestFailed: Date | null = null

    for (const item of all) {
      if (item.status in counts) counts[item.status as keyof typeof counts]++
      if (item.status === OutboxStatus.PENDING && (!oldestPending || item.createdAt < oldestPending)) {
        oldestPending = item.createdAt
      }
      if (item.status === OutboxStatus.FAILED && (!oldestFailed || item.createdAt < oldestFailed)) {
        oldestFailed = item.createdAt
      }
    }

    return {
      ...counts,
      total: all.length,
      oldestPending: oldestPending?.toISOString() ?? null,
      oldestFailed: oldestFailed?.toISOString() ?? null,
    }
  }

  async clear() {
    this.items.clear()
    this.refIndex.clear()
  }
}

// ---------------------------------------------------------------------------
// Postgres implementation
// ---------------------------------------------------------------------------
export class PostgresOutboxStore implements IOutboxStore {
  private async pool() {
    const pool = await getPool()
    if (!pool) throw new Error('Postgres pool not available')
    return pool
  }

  /**
   * Idempotent: if canonical_external_ref_v1 already exists, return the
   * existing row (even under concurrent inserts via ON CONFLICT DO NOTHING).
   */
  async create(input: CreateOutboxItemInput): Promise<OutboxItem> {
    const pool = await this.pool()
    const canonicalExternalRefV1 = buildCanonicalString(input.source, input.ref)
    const txId = computeTxId(input.source, input.ref)
    const id = randomUUID()

    const { rows } = await pool.query(
      `INSERT INTO outbox_items (
         id, tx_id, tx_type, canonical_external_ref_v1,
         aggregate_id, aggregate_type, event_type, payload
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (canonical_external_ref_v1) DO NOTHING
       RETURNING *`,
      [
        id, txId, input.txType, canonicalExternalRefV1,
        input.aggregateId ?? '', input.aggregateType ?? '', input.eventType ?? '',
        JSON.stringify(input.payload),
      ],
    )

    if (rows.length > 0) return mapRow(rows[0])

    // Row already existed — fetch and return it
    const { rows: existing } = await pool.query(
      `SELECT * FROM outbox_items WHERE canonical_external_ref_v1 = $1`,
      [canonicalExternalRefV1],
    )
    return mapRow(existing[0])
  }

  async getById(id: string): Promise<OutboxItem | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `SELECT * FROM outbox_items WHERE id = $1`,
      [id],
    )
    return rows.length ? mapRow(rows[0]) : null
  }

  async getByExternalRef(source: string, ref: string): Promise<OutboxItem | null> {
    const pool = await this.pool()
    const canonical = buildCanonicalString(source, ref)
    const { rows } = await pool.query(
      `SELECT * FROM outbox_items WHERE canonical_external_ref_v1 = $1`,
      [canonical],
    )
    return rows.length ? mapRow(rows[0]) : null
  }

  async listByStatus(status: OutboxStatus): Promise<OutboxItem[]> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `SELECT * FROM outbox_items WHERE status = $1 ORDER BY created_at ASC`,
      [status],
    )
    return rows.map(mapRow)
  }

  async updateStatus(
    id: string,
    status: OutboxStatus,
    options?: { error?: string; nextRetryAt?: Date | null },
  ): Promise<OutboxItem | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `UPDATE outbox_items
       SET status        = $2,
           attempts      = attempts + 1,
           retry_count   = retry_count + 1,
           last_error    = COALESCE($3, last_error),
           next_retry_at = $4,
           processed_at  = NOW(),
           updated_at    = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, status, options?.error ?? null, options?.nextRetryAt ?? null],
    )
    return rows.length ? mapRow(rows[0]) : null
  }

  async markDead(id: string, reason: string): Promise<OutboxItem | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `UPDATE outbox_items
       SET status        = $2,
           last_error    = $3,
           next_retry_at = NULL,
           updated_at    = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, OutboxStatus.DEAD, reason],
    )
    return rows.length ? mapRow(rows[0]) : null
  }

  async listByDealId(dealId: string, txType?: TxType): Promise<OutboxItem[]> {
    const pool = await this.pool()
    const params: unknown[] = [dealId]
    let sql = `SELECT * FROM outbox_items WHERE payload->>'dealId' = $1`
    if (txType !== undefined) { params.push(txType); sql += ` AND tx_type = $${params.length}` }
    sql += ' ORDER BY created_at ASC'
    const { rows } = await pool.query(sql, params)
    return rows.map(mapRow)
  }

  async listAll(limit = 100): Promise<OutboxItem[]> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `SELECT * FROM outbox_items ORDER BY created_at DESC LIMIT $1`,
      [limit],
    )
    return rows.map(mapRow)
  }

  async getHealthSummary(): Promise<OutboxHealthSummary> {
    const pool = await this.pool()
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'sent')    AS sent,
        COUNT(*) FILTER (WHERE status = 'failed')  AS failed,
        COUNT(*) FILTER (WHERE status = 'dead')    AS dead,
        COUNT(*)                                    AS total,
        MIN(created_at) FILTER (WHERE status = 'pending') AS oldest_pending,
        MIN(created_at) FILTER (WHERE status = 'failed')  AS oldest_failed
      FROM outbox_items
    `)
    const row = rows[0]
    return {
      pending: Number(row.pending),
      sent: Number(row.sent),
      failed: Number(row.failed),
      dead: Number(row.dead),
      total: Number(row.total),
      oldestPending: row.oldest_pending ? new Date(row.oldest_pending).toISOString() : null,
      oldestFailed: row.oldest_failed ? new Date(row.oldest_failed).toISOString() : null,
    }
  }

  async clear(): Promise<void> {
    const pool = await this.pool()
    await pool.query(`DELETE FROM outbox_items`)
  }
}

// ---------------------------------------------------------------------------
// Singleton — in-memory by default, Postgres when DATABASE_URL is set.
// app.ts calls initOutboxStore() once at startup.
// ---------------------------------------------------------------------------
let _store: IOutboxStore = new InMemoryOutboxStore()

export function initOutboxStore(store: IOutboxStore) {
  _store = store
}

/**
 * Proxy that routes all calls to the active backing store.
 * Existing code that imports `outboxStore` continues to work unchanged.
 */
export const outboxStore: IOutboxStore = new Proxy({} as IOutboxStore, {
  get(_target, prop) {
    return (_store as unknown as Record<string, unknown>)[prop as string]
  },
})
