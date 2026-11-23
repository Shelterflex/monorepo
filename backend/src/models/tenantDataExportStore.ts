/**
 * Tenant data export store (#2052), backed by `tenant_data_exports` (migration 20261019120200).
 * The partial unique index allows at most one pending or processing export per user.
 * The store picks PostgreSQL when DATABASE_URL is set and the in-memory store otherwise.
 */

import { randomUUID } from 'node:crypto'
import { getPool } from '../db.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

export type TenantDataExportStatus = 'pending' | 'processing' | 'ready' | 'failed' | 'expired'

export interface TenantDataExport {
  id: string
  userId: string
  status: TenantDataExportStatus
  storageKey: string | null
  failureReason: string | null
  requestedAt: Date
  completedAt: Date | null
  expiresAt: Date | null
}

export interface TenantDataExportStore {
  /** Throws a 409 AppError when the user already has a pending or processing export. */
  create(record: { id: string; userId: string; requestedAt: Date }): Promise<TenantDataExport>
  findById(id: string): Promise<TenantDataExport | null>
  findActiveForUser(userId: string): Promise<TenantDataExport | null>
  countRequestedSince(userId: string, since: Date): Promise<number>
  markProcessing(id: string): Promise<void>
  markReady(id: string, storageKey: string, completedAt: Date, expiresAt: Date): Promise<void>
  markFailed(id: string, reason: string, completedAt: Date): Promise<void>
  listExpiredReady(now: Date): Promise<TenantDataExport[]>
  markExpired(id: string): Promise<void>
}

const ACTIVE_STATUSES: readonly TenantDataExportStatus[] = ['pending', 'processing']

function activeConflict(): AppError {
  return new AppError(ErrorCode.CONFLICT, 409, 'A data export is already in progress')
}

export class InMemoryTenantDataExportStore implements TenantDataExportStore {
  private exports = new Map<string, TenantDataExport>()

  async create(record: { id: string; userId: string; requestedAt: Date }): Promise<TenantDataExport> {
    if (await this.findActiveForUser(record.userId)) throw activeConflict()
    const row: TenantDataExport = {
      id: record.id,
      userId: record.userId,
      status: 'pending',
      storageKey: null,
      failureReason: null,
      requestedAt: record.requestedAt,
      completedAt: null,
      expiresAt: null,
    }
    this.exports.set(row.id, row)
    return { ...row }
  }

  async findById(id: string): Promise<TenantDataExport | null> {
    const row = this.exports.get(id)
    return row ? { ...row } : null
  }

  async findActiveForUser(userId: string): Promise<TenantDataExport | null> {
    const row = [...this.exports.values()].find(
      (e) => e.userId === userId && ACTIVE_STATUSES.includes(e.status),
    )
    return row ? { ...row } : null
  }

  async countRequestedSince(userId: string, since: Date): Promise<number> {
    return [...this.exports.values()].filter(
      (e) => e.userId === userId && e.requestedAt.getTime() >= since.getTime(),
    ).length
  }

  async markProcessing(id: string): Promise<void> {
    const row = this.exports.get(id)
    if (row) row.status = 'processing'
  }

  async markReady(id: string, storageKey: string, completedAt: Date, expiresAt: Date): Promise<void> {
    const row = this.exports.get(id)
    if (!row) return
    Object.assign(row, { status: 'ready', storageKey, completedAt, expiresAt })
  }

  async markFailed(id: string, reason: string, completedAt: Date): Promise<void> {
    const row = this.exports.get(id)
    if (!row) return
    Object.assign(row, { status: 'failed', failureReason: reason, completedAt })
  }

  async listExpiredReady(now: Date): Promise<TenantDataExport[]> {
    return [...this.exports.values()]
      .filter((e) => e.status === 'ready' && e.expiresAt !== null && e.expiresAt.getTime() <= now.getTime())
      .map((e) => ({ ...e }))
  }

  async markExpired(id: string): Promise<void> {
    const row = this.exports.get(id)
    if (row) row.status = 'expired'
  }

  /** Test helper. */
  async clear(): Promise<void> {
    this.exports.clear()
  }
}

function mapRow(row: Record<string, unknown>): TenantDataExport {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    status: row.status as TenantDataExportStatus,
    storageKey: (row.storage_key as string | null) ?? null,
    failureReason: (row.failure_reason as string | null) ?? null,
    requestedAt: new Date(row.requested_at as string),
    completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
    expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
  }
}

const SELECT_EXPORT = `SELECT id, user_id, status, storage_key, failure_reason, requested_at, completed_at, expires_at
  FROM tenant_data_exports`

export class PostgresTenantDataExportStore implements TenantDataExportStore {
  private async pool() {
    const pool = await getPool()
    if (!pool) throw new Error('Database pool not initialized')
    return pool
  }

  async create(record: { id: string; userId: string; requestedAt: Date }): Promise<TenantDataExport> {
    const pool = await this.pool()
    try {
      const result = await pool.query(
        `INSERT INTO tenant_data_exports (id, user_id, status, requested_at)
         VALUES ($1, $2, 'pending', $3)
         RETURNING id, user_id, status, storage_key, failure_reason, requested_at, completed_at, expires_at`,
        [record.id, record.userId, record.requestedAt],
      )
      return mapRow(result.rows[0])
    } catch (error) {
      // 23505 is tenant_data_exports_one_active_per_user.
      if ((error as { code?: string }).code === '23505') throw activeConflict()
      throw error
    }
  }

  async findById(id: string): Promise<TenantDataExport | null> {
    const pool = await this.pool()
    const result = await pool.query(`${SELECT_EXPORT} WHERE id = $1`, [id])
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null
  }

  async findActiveForUser(userId: string): Promise<TenantDataExport | null> {
    const pool = await this.pool()
    const result = await pool.query(
      `${SELECT_EXPORT} WHERE user_id = $1 AND status IN ('pending', 'processing') LIMIT 1`,
      [userId],
    )
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null
  }

  async countRequestedSince(userId: string, since: Date): Promise<number> {
    const pool = await this.pool()
    const result = await pool.query(
      `SELECT COUNT(*)::int AS total FROM tenant_data_exports WHERE user_id = $1 AND requested_at >= $2`,
      [userId, since],
    )
    return Number(result.rows[0]?.total ?? 0)
  }

  async markProcessing(id: string): Promise<void> {
    const pool = await this.pool()
    await pool.query(`UPDATE tenant_data_exports SET status = 'processing', updated_at = NOW() WHERE id = $1`, [id])
  }

  async markReady(id: string, storageKey: string, completedAt: Date, expiresAt: Date): Promise<void> {
    const pool = await this.pool()
    await pool.query(
      `UPDATE tenant_data_exports
       SET status = 'ready', storage_key = $2, completed_at = $3, expires_at = $4, updated_at = NOW()
       WHERE id = $1`,
      [id, storageKey, completedAt, expiresAt],
    )
  }

  async markFailed(id: string, reason: string, completedAt: Date): Promise<void> {
    const pool = await this.pool()
    await pool.query(
      `UPDATE tenant_data_exports
       SET status = 'failed', failure_reason = $2, completed_at = $3, updated_at = NOW()
       WHERE id = $1`,
      [id, reason, completedAt],
    )
  }

  async listExpiredReady(now: Date): Promise<TenantDataExport[]> {
    const pool = await this.pool()
    const result = await pool.query(
      `${SELECT_EXPORT} WHERE status = 'ready' AND expires_at <= $1`,
      [now],
    )
    return result.rows.map((row: Record<string, unknown>) => mapRow(row))
  }

  async markExpired(id: string): Promise<void> {
    const pool = await this.pool()
    await pool.query(`UPDATE tenant_data_exports SET status = 'expired', updated_at = NOW() WHERE id = $1`, [id])
  }
}

class HybridTenantDataExportStore implements TenantDataExportStore {
  private memory = new InMemoryTenantDataExportStore()
  private postgres = new PostgresTenantDataExportStore()

  private async adapter(): Promise<TenantDataExportStore> {
    return (await getPool()) ? this.postgres : this.memory
  }

  async create(record: { id: string; userId: string; requestedAt: Date }) {
    return (await this.adapter()).create(record)
  }

  async findById(id: string) {
    return (await this.adapter()).findById(id)
  }

  async findActiveForUser(userId: string) {
    return (await this.adapter()).findActiveForUser(userId)
  }

  async countRequestedSince(userId: string, since: Date) {
    return (await this.adapter()).countRequestedSince(userId, since)
  }

  async markProcessing(id: string) {
    return (await this.adapter()).markProcessing(id)
  }

  async markReady(id: string, storageKey: string, completedAt: Date, expiresAt: Date) {
    return (await this.adapter()).markReady(id, storageKey, completedAt, expiresAt)
  }

  async markFailed(id: string, reason: string, completedAt: Date) {
    return (await this.adapter()).markFailed(id, reason, completedAt)
  }

  async listExpiredReady(now: Date) {
    return (await this.adapter()).listExpiredReady(now)
  }

  async markExpired(id: string) {
    return (await this.adapter()).markExpired(id)
  }
}

export const tenantDataExportStore: TenantDataExportStore = new HybridTenantDataExportStore()

export function newExportId(): string {
  return randomUUID()
}
