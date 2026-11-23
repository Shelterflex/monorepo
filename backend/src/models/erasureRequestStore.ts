/**
 * Account erasure request store (#2053), backed by `erasure_requests`
 * (migrations 033, 20261018300000 and 20261123100000).
 *
 * Every state change is a conditional transition: it applies only when the row is
 * still in one of the expected states. Two concurrent confirms or a cancel racing
 * the grace-period job therefore cannot both succeed.
 */

import { randomUUID } from 'node:crypto'
import { getPool } from '../db.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

export type ErasureStatus = 'pending' | 'scheduled' | 'completed' | 'cancelled' | 'expired'

export const OPEN_ERASURE_STATUSES: readonly ErasureStatus[] = ['pending', 'scheduled']

export interface ErasureRequest {
  id: string
  userId: string
  status: ErasureStatus
  requestedAt: Date
  /** The user must confirm before this, or the request expires. */
  confirmBy: Date
  confirmedAt: Date | null
  /** End of the grace window. Cancelling is allowed until then. */
  graceEndsAt: Date | null
  cancelledAt: Date | null
  updatedAt: Date
}

export interface ErasureTransitionPatch {
  confirmedAt?: Date
  graceEndsAt?: Date
  cancelledAt?: Date
}

export interface ErasureRequestStore {
  /** Throws a 409 AppError when the user already has an open request. */
  create(input: { userId: string; requestedAt: Date; confirmBy: Date }): Promise<ErasureRequest>
  findById(id: string): Promise<ErasureRequest | null>
  findOpenForUser(userId: string): Promise<ErasureRequest | null>
  findLatestForUser(userId: string): Promise<ErasureRequest | null>
  /** Moves a request to `to` only if it is currently in one of `from`. Returns null when it was not. */
  transition(
    id: string,
    from: readonly ErasureStatus[],
    to: ErasureStatus,
    patch: ErasureTransitionPatch,
    now: Date,
  ): Promise<ErasureRequest | null>
  /** Scheduled requests whose grace window has ended. */
  listDueForCompletion(now: Date): Promise<ErasureRequest[]>
  /** Pending requests whose confirm-by date has passed. */
  listStalePending(now: Date): Promise<ErasureRequest[]>
}

function openConflict(): AppError {
  return new AppError(ErrorCode.CONFLICT, 409, 'An account erasure request is already open')
}

function applyPatch(row: ErasureRequest, patch: ErasureTransitionPatch): void {
  if (patch.confirmedAt !== undefined) row.confirmedAt = patch.confirmedAt
  if (patch.graceEndsAt !== undefined) row.graceEndsAt = patch.graceEndsAt
  if (patch.cancelledAt !== undefined) row.cancelledAt = patch.cancelledAt
}

export class InMemoryErasureRequestStore implements ErasureRequestStore {
  private rows = new Map<string, ErasureRequest>()

  async create(input: { userId: string; requestedAt: Date; confirmBy: Date }): Promise<ErasureRequest> {
    if (await this.findOpenForUser(input.userId)) throw openConflict()
    const row: ErasureRequest = {
      id: randomUUID(),
      userId: input.userId,
      status: 'pending',
      requestedAt: input.requestedAt,
      confirmBy: input.confirmBy,
      confirmedAt: null,
      graceEndsAt: null,
      cancelledAt: null,
      updatedAt: input.requestedAt,
    }
    this.rows.set(row.id, row)
    return { ...row }
  }

  async findById(id: string): Promise<ErasureRequest | null> {
    const row = this.rows.get(id)
    return row ? { ...row } : null
  }

  async findOpenForUser(userId: string): Promise<ErasureRequest | null> {
    const row = [...this.rows.values()].find(
      (r) => r.userId === userId && OPEN_ERASURE_STATUSES.includes(r.status),
    )
    return row ? { ...row } : null
  }

  async findLatestForUser(userId: string): Promise<ErasureRequest | null> {
    const latest = [...this.rows.values()]
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime())[0]
    return latest ? { ...latest } : null
  }

  async transition(
    id: string,
    from: readonly ErasureStatus[],
    to: ErasureStatus,
    patch: ErasureTransitionPatch,
    now: Date,
  ): Promise<ErasureRequest | null> {
    const row = this.rows.get(id)
    if (!row || !from.includes(row.status)) return null
    row.status = to
    applyPatch(row, patch)
    row.updatedAt = now
    return { ...row }
  }

  async listDueForCompletion(now: Date): Promise<ErasureRequest[]> {
    return [...this.rows.values()]
      .filter((r) => r.status === 'scheduled' && r.graceEndsAt !== null && r.graceEndsAt.getTime() <= now.getTime())
      .map((r) => ({ ...r }))
  }

  async listStalePending(now: Date): Promise<ErasureRequest[]> {
    return [...this.rows.values()]
      .filter((r) => r.status === 'pending' && r.confirmBy.getTime() <= now.getTime())
      .map((r) => ({ ...r }))
  }

  /** Test helper. */
  async clear(): Promise<void> {
    this.rows.clear()
  }
}

function mapRow(row: Record<string, unknown>): ErasureRequest {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    status: row.status as ErasureStatus,
    requestedAt: new Date(row.requested_at as string),
    confirmBy: new Date(row.confirm_by as string),
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at as string) : null,
    graceEndsAt: row.grace_ends_at ? new Date(row.grace_ends_at as string) : null,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at as string) : null,
    updatedAt: new Date(row.updated_at as string),
  }
}

const SELECT_ERASURE = `SELECT id, user_id, status, requested_at, confirm_by, confirmed_at, grace_ends_at,
  cancelled_at, updated_at FROM erasure_requests`

export class PostgresErasureRequestStore implements ErasureRequestStore {
  private async pool() {
    const pool = await getPool()
    if (!pool) throw new Error('Database pool not initialized')
    return pool
  }

  async create(input: { userId: string; requestedAt: Date; confirmBy: Date }): Promise<ErasureRequest> {
    const pool = await this.pool()
    try {
      const result = await pool.query(
        `INSERT INTO erasure_requests (id, user_id, status, requested_at, confirm_by)
         VALUES ($1, $2, 'pending', $3, $4)
         RETURNING id, user_id, status, requested_at, confirm_by, confirmed_at, grace_ends_at, cancelled_at, updated_at`,
        [randomUUID(), input.userId, input.requestedAt, input.confirmBy],
      )
      return mapRow(result.rows[0])
    } catch (error) {
      // 23505 is the partial unique index on open requests.
      if ((error as { code?: string }).code === '23505') throw openConflict()
      throw error
    }
  }

  async findById(id: string): Promise<ErasureRequest | null> {
    const pool = await this.pool()
    const result = await pool.query(`${SELECT_ERASURE} WHERE id = $1`, [id])
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null
  }

  async findOpenForUser(userId: string): Promise<ErasureRequest | null> {
    const pool = await this.pool()
    const result = await pool.query(
      `${SELECT_ERASURE} WHERE user_id = $1 AND status IN ('pending', 'scheduled') LIMIT 1`,
      [userId],
    )
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null
  }

  async findLatestForUser(userId: string): Promise<ErasureRequest | null> {
    const pool = await this.pool()
    const result = await pool.query(
      `${SELECT_ERASURE} WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 1`,
      [userId],
    )
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null
  }

  async transition(
    id: string,
    from: readonly ErasureStatus[],
    to: ErasureStatus,
    patch: ErasureTransitionPatch,
    now: Date,
  ): Promise<ErasureRequest | null> {
    const pool = await this.pool()
    const result = await pool.query(
      `UPDATE erasure_requests
       SET status = $2,
           confirmed_at = COALESCE($3, confirmed_at),
           grace_ends_at = COALESCE($4, grace_ends_at),
           cancelled_at = COALESCE($5, cancelled_at),
           updated_at = $6
       WHERE id = $1 AND status = ANY($7::text[])
       RETURNING id, user_id, status, requested_at, confirm_by, confirmed_at, grace_ends_at, cancelled_at, updated_at`,
      [
        id,
        to,
        patch.confirmedAt ?? null,
        patch.graceEndsAt ?? null,
        patch.cancelledAt ?? null,
        now,
        [...from],
      ],
    )
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null
  }

  async listDueForCompletion(now: Date): Promise<ErasureRequest[]> {
    const pool = await this.pool()
    const result = await pool.query(
      `${SELECT_ERASURE} WHERE status = 'scheduled' AND grace_ends_at <= $1`,
      [now],
    )
    return result.rows.map((row: Record<string, unknown>) => mapRow(row))
  }

  async listStalePending(now: Date): Promise<ErasureRequest[]> {
    const pool = await this.pool()
    const result = await pool.query(`${SELECT_ERASURE} WHERE status = 'pending' AND confirm_by <= $1`, [now])
    return result.rows.map((row: Record<string, unknown>) => mapRow(row))
  }
}

class HybridErasureRequestStore implements ErasureRequestStore {
  private memory = new InMemoryErasureRequestStore()
  private postgres = new PostgresErasureRequestStore()

  private async adapter(): Promise<ErasureRequestStore> {
    return (await getPool()) ? this.postgres : this.memory
  }

  async create(input: { userId: string; requestedAt: Date; confirmBy: Date }) {
    return (await this.adapter()).create(input)
  }

  async findById(id: string) {
    return (await this.adapter()).findById(id)
  }

  async findOpenForUser(userId: string) {
    return (await this.adapter()).findOpenForUser(userId)
  }

  async findLatestForUser(userId: string) {
    return (await this.adapter()).findLatestForUser(userId)
  }

  async transition(
    id: string,
    from: readonly ErasureStatus[],
    to: ErasureStatus,
    patch: ErasureTransitionPatch,
    now: Date,
  ) {
    return (await this.adapter()).transition(id, from, to, patch, now)
  }

  async listDueForCompletion(now: Date) {
    return (await this.adapter()).listDueForCompletion(now)
  }

  async listStalePending(now: Date) {
    return (await this.adapter()).listStalePending(now)
  }
}

export const erasureRequestStore: ErasureRequestStore = new HybridErasureRequestStore()
