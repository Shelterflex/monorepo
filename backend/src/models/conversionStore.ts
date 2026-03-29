import { randomUUID } from 'node:crypto'
import { type ConversionRecord } from './conversion.js'
import { getPool } from '../db.js'
import { conversionCache } from '../utils/cache.js'

function mapRow(row: any): ConversionRecord {
  return {
    conversionId: String(row.conversion_id),
    depositId: String(row.deposit_id),
    userId: String(row.user_id),
    amountNgn: Number(row.amount_ngn),
    amountUsdc: String(row.amount_usdc),
    fxRateNgnPerUsdc: Number(row.fx_rate_ngn_per_usdc),
    provider: row.provider,
    providerRef: String(row.provider_ref ?? ''),
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    failedAt: row.failed_at ? new Date(row.failed_at) : null,
    failureReason: row.failure_reason ?? null,
  }
}

/**
 * In-memory conversion store.
 * Enforces once-per-deposit by unique depositId.
 */
class ConversionStore {
  private byId = new Map<string, ConversionRecord>()
  private byDepositId = new Map<string, string>()

  private async pool() {
    const pool = await getPool()
    return pool
  }

  async listByStatus(options?: {
    status?: 'pending' | 'completed' | 'failed'
    limit?: number
    cursorCreatedAt?: Date
  }): Promise<ConversionRecord[]> {
    const pool = await this.pool()
    const limit = Math.max(1, Math.min(1000, options?.limit ?? 50))
    const status = options?.status
    const cursor = options?.cursorCreatedAt

    if (!pool) {
      let items = Array.from(this.byId.values())
      if (status) {
        items = items.filter((r) => r.status === status)
      }
      items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      if (cursor) {
        items = items.filter((r) => r.createdAt < cursor)
      }
      return items.slice(0, limit)
    }

    const params: any[] = []
    const where: string[] = []
    if (status) {
      params.push(status)
      where.push(`status = $${params.length}`)
    }
    if (cursor) {
      params.push(cursor.toISOString())
      where.push(`created_at < $${params.length}`)
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    params.push(limit)
    const { rows } = await pool.query(
      `SELECT * FROM conversions ${whereSql} ORDER BY created_at DESC LIMIT $${params.length}`,
      params,
    )
    return rows.map(mapRow)
  }

  async getByConversionId(conversionId: string): Promise<ConversionRecord | null> {
    const cached = await conversionCache.get(`id:${conversionId}`)
    if (cached) return cached

    const pool = await this.pool()
    if (!pool) {
      return this.byId.get(conversionId) ?? null
    }

    const { rows } = await pool.query(`SELECT * FROM conversions WHERE conversion_id=$1`, [conversionId])
    const row = rows[0]
    if (!row) return null

    const record = mapRow(row)
    await conversionCache.set(`id:${conversionId}`, record)
    await conversionCache.set(`deposit:${record.depositId}`, record)
    return record
  }

  async getByDepositId(depositId: string): Promise<ConversionRecord | null> {
    const cached = await conversionCache.get(`deposit:${depositId}`)
    if (cached) return cached

    const pool = await this.pool()
    if (!pool) {
      const id = this.byDepositId.get(depositId)
      if (!id) return null
      return this.byId.get(id) ?? null
    }

    const { rows } = await pool.query(
      `SELECT * FROM conversions WHERE deposit_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [depositId],
    )
    const row = rows[0]
    if (!row) return null

    const record = mapRow(row)
    await conversionCache.set(`id:${record.conversionId}`, record)
    await conversionCache.set(`deposit:${depositId}`, record)
    return record
  }

  async createPending(input: {
    depositId: string
    userId: string
    amountNgn: number
    provider: 'onramp' | 'offramp' | 'manual_admin'
  }): Promise<ConversionRecord> {
    const pool = await this.pool()
    if (!pool) {
      const existing = await this.getByDepositId(input.depositId)
      if (existing) return existing

      const now = new Date()
      const record: ConversionRecord = {
        conversionId: randomUUID(),
        depositId: input.depositId,
        userId: input.userId,
        amountNgn: input.amountNgn,
        amountUsdc: '0',
        fxRateNgnPerUsdc: 0,
        provider: input.provider,
        providerRef: '',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        failedAt: null,
        failureReason: null,
      }

      this.byId.set(record.conversionId, record)
      this.byDepositId.set(record.depositId, record.conversionId)

      return record
    }

    // Idempotent: insert if not exists, else return existing row.
    const { rows } = await pool.query(
      `INSERT INTO conversions (deposit_id, user_id, amount_ngn, provider)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (deposit_id)
       DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      [input.depositId, input.userId, Math.trunc(input.amountNgn), input.provider],
    )
    return mapRow(rows[0])
  }

  async markCompleted(conversionId: string, data: {
    amountUsdc: string
    fxRateNgnPerUsdc: number
    providerRef: string
  }): Promise<ConversionRecord | null> {
    const pool = await this.pool()
    if (!pool) {
      const existing = this.byId.get(conversionId)
      if (!existing) return null

      const now = new Date()
      const updated: ConversionRecord = {
        ...existing,
        amountUsdc: data.amountUsdc,
        fxRateNgnPerUsdc: data.fxRateNgnPerUsdc,
        providerRef: data.providerRef,
        status: 'completed',
        updatedAt: now,
        completedAt: now,
        failedAt: null,
        failureReason: null,
      }

      this.byId.set(conversionId, updated)
      return updated
    }

    const { rows } = await pool.query(
      `UPDATE conversions
       SET amount_usdc=$2,
           fx_rate_ngn_per_usdc=$3,
           provider_ref=$4,
           status='completed',
           updated_at=NOW(),
           completed_at=NOW(),
           failed_at=NULL,
           failure_reason=NULL
       WHERE conversion_id=$1
       RETURNING *`,
      [conversionId, data.amountUsdc, data.fxRateNgnPerUsdc, data.providerRef],
    )
    const row = rows[0]
    return row ? mapRow(row) : null
  }

  async markFailed(conversionId: string, reason: string): Promise<ConversionRecord | null> {
    const pool = await this.pool()
    if (!pool) {
      const existing = this.byId.get(conversionId)
      if (!existing) return null

      const now = new Date()
      const updated: ConversionRecord = {
        ...existing,
        status: 'failed',
        updatedAt: now,
        failedAt: now,
        failureReason: reason,
      }

      this.byId.set(conversionId, updated)
      return updated
    }

    const { rows } = await pool.query(
      `UPDATE conversions
       SET status='failed',
           updated_at=NOW(),
           failed_at=NOW(),
           failure_reason=$2
       WHERE conversion_id=$1
       RETURNING *`,
      [conversionId, reason],
    )
    const row = rows[0]
    return row ? mapRow(row) : null
  }

  async listCompleted(): Promise<ConversionRecord[]> {
    const pool = await this.pool()
    if (!pool) {
      const results: ConversionRecord[] = []
      for (const record of this.byId.values()) {
        if (record.status === 'completed') {
          results.push(record)
        }
      }
      return results.sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      )
    }

    const { rows } = await pool.query(`SELECT * FROM conversions WHERE status='completed'`)
    return rows.map(mapRow).sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )
  }

  async clear(): Promise<void> {
    const pool = await this.pool()
    if (pool) {
      await pool.query('DELETE FROM conversions')
      return
    }

    this.byId.clear()
    this.byDepositId.clear()
  }
}

export const conversionStore = new ConversionStore()
