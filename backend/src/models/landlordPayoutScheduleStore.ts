/**
 * Landlord Payout Schedule Store — issue #1892.
 *
 * Reads `landlord_payouts` (migrations/026) and `landlord_payout_preferences`
 * (migrations/049). Every query is scoped to a landlord id; a payout belonging
 * to another landlord is indistinguishable from one that does not exist.
 */

import { getPool } from '../db.js'
import type {
  Deduction,
  DelayReason,
  LandlordPayout,
  PayoutChannel,
  PayoutSchedulePreference,
  PayoutStatus,
} from '../schemas/landlordPayoutSchedule.js'

export interface LandlordPayoutFilters {
  propertyId?: string
  status?: PayoutStatus
  channel?: PayoutChannel
  /** ISO timestamp, inclusive lower bound on scheduledDate. */
  from?: string
  /** ISO timestamp, inclusive upper bound on scheduledDate. */
  to?: string
}

export interface LandlordPayoutScheduleStore {
  /** All matching payouts for the landlord, soonest scheduled first. */
  listForLandlord(landlordId: string, filters?: LandlordPayoutFilters): Promise<LandlordPayout[]>
  /** One page of matching payouts plus the total count across all pages. */
  listPageForLandlord(
    landlordId: string,
    filters: LandlordPayoutFilters,
    page: number,
    pageSize: number,
  ): Promise<{ items: LandlordPayout[]; total: number }>
  findForLandlord(landlordId: string, payoutId: string): Promise<LandlordPayout | null>
  getPreference(landlordId: string): Promise<PayoutSchedulePreference>
  setPreference(
    landlordId: string,
    preference: PayoutSchedulePreference,
  ): Promise<PayoutSchedulePreference>
  /**
   * Insert a payout unless one with the same id already exists. Returns true
   * when a row was written and false for a replay, so callers can be idempotent.
   */
  insertIfAbsent(payout: LandlordPayout): Promise<boolean>
  /** Sum of gross amounts of the landlord's non-failed payouts created at or after `since`. */
  sumGrossSince(landlordId: string, since: Date): Promise<number>
}

export const DEFAULT_PAYOUT_SCHEDULE_PREFERENCE: PayoutSchedulePreference = 'monthly'

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function matchesFilters(payout: LandlordPayout, filters: LandlordPayoutFilters): boolean {
  if (filters.propertyId && payout.propertyId !== filters.propertyId) return false
  if (filters.status && payout.status !== filters.status) return false
  if (filters.channel && payout.channel !== filters.channel) return false
  const scheduled = Date.parse(payout.scheduledDate)
  if (filters.from && scheduled < Date.parse(filters.from)) return false
  if (filters.to && scheduled > Date.parse(filters.to)) return false
  return true
}

/**
 * In-memory implementation for testing
 */
export class InMemoryLandlordPayoutScheduleStore implements LandlordPayoutScheduleStore {
  private payouts: LandlordPayout[] = []
  private preferences = new Map<string, PayoutSchedulePreference>()

  /** Test helper: seed a payout. */
  add(payout: LandlordPayout): void {
    this.payouts.push({ ...payout, deductions: [...payout.deductions] })
  }

  async insertIfAbsent(payout: LandlordPayout): Promise<boolean> {
    if (this.payouts.some((p) => p.id === payout.id)) return false
    this.payouts.push({ ...payout, deductions: [...payout.deductions] })
    return true
  }

  async sumGrossSince(landlordId: string, since: Date): Promise<number> {
    return this.payouts
      .filter(
        (p) =>
          p.landlordId === landlordId &&
          p.status !== 'failed' &&
          Date.parse(p.createdAt) >= since.getTime(),
      )
      .reduce((sum, p) => sum + p.grossAmount, 0)
  }

  private forLandlord(landlordId: string, filters: LandlordPayoutFilters): LandlordPayout[] {
    return this.payouts
      .filter((p) => p.landlordId === landlordId && matchesFilters(p, filters))
      .sort((a, b) => Date.parse(a.scheduledDate) - Date.parse(b.scheduledDate))
  }

  async listForLandlord(
    landlordId: string,
    filters: LandlordPayoutFilters = {},
  ): Promise<LandlordPayout[]> {
    return this.forLandlord(landlordId, filters)
  }

  async listPageForLandlord(
    landlordId: string,
    filters: LandlordPayoutFilters,
    page: number,
    pageSize: number,
  ): Promise<{ items: LandlordPayout[]; total: number }> {
    const all = this.forLandlord(landlordId, filters)
    const start = (page - 1) * pageSize
    return { items: all.slice(start, start + pageSize), total: all.length }
  }

  async findForLandlord(landlordId: string, payoutId: string): Promise<LandlordPayout | null> {
    return this.payouts.find((p) => p.id === payoutId && p.landlordId === landlordId) ?? null
  }

  async getPreference(landlordId: string): Promise<PayoutSchedulePreference> {
    return this.preferences.get(landlordId) ?? DEFAULT_PAYOUT_SCHEDULE_PREFERENCE
  }

  async setPreference(
    landlordId: string,
    preference: PayoutSchedulePreference,
  ): Promise<PayoutSchedulePreference> {
    this.preferences.set(landlordId, preference)
    return preference
  }

  // Test helper
  async clear(): Promise<void> {
    this.payouts = []
    this.preferences.clear()
  }
}

const PAYOUT_COLUMNS = `
  id, landlord_id, property_id, property_name, scheduled_date, completed_date,
  gross_amount, deductions, net_amount, currency, status, channel, delay_reasons,
  period_start, period_end, created_at, updated_at`

/**
 * PostgreSQL implementation
 */
export class PostgresLandlordPayoutScheduleStore implements LandlordPayoutScheduleStore {
  private buildWhere(
    landlordId: string,
    filters: LandlordPayoutFilters,
  ): { where: string; params: unknown[] } {
    const params: unknown[] = [landlordId]
    const clauses = ['landlord_id = $1']
    if (filters.propertyId) {
      params.push(filters.propertyId)
      clauses.push(`property_id = $${params.length}`)
    }
    if (filters.status) {
      params.push(filters.status)
      clauses.push(`status = $${params.length}`)
    }
    if (filters.channel) {
      params.push(filters.channel)
      clauses.push(`channel = $${params.length}`)
    }
    if (filters.from) {
      params.push(filters.from)
      clauses.push(`scheduled_date >= $${params.length}`)
    }
    if (filters.to) {
      params.push(filters.to)
      clauses.push(`scheduled_date <= $${params.length}`)
    }
    return { where: clauses.join(' AND '), params }
  }

  async listForLandlord(
    landlordId: string,
    filters: LandlordPayoutFilters = {},
  ): Promise<LandlordPayout[]> {
    const pool = await getPool()
    if (!pool) throw new Error('Database pool not initialized')
    const { where, params } = this.buildWhere(landlordId, filters)
    const result = await pool.query(
      `SELECT ${PAYOUT_COLUMNS}
       FROM landlord_payouts
       WHERE ${where}
       ORDER BY scheduled_date ASC, id ASC`,
      params,
    )
    return result.rows.map((row: any) => this.mapRow(row))
  }

  async listPageForLandlord(
    landlordId: string,
    filters: LandlordPayoutFilters,
    page: number,
    pageSize: number,
  ): Promise<{ items: LandlordPayout[]; total: number }> {
    const pool = await getPool()
    if (!pool) throw new Error('Database pool not initialized')
    const { where, params } = this.buildWhere(landlordId, filters)

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM landlord_payouts WHERE ${where}`,
      params,
    )
    const pageParams = [...params, pageSize, (page - 1) * pageSize]
    const result = await pool.query(
      `SELECT ${PAYOUT_COLUMNS}
       FROM landlord_payouts
       WHERE ${where}
       ORDER BY scheduled_date ASC, id ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      pageParams,
    )
    return {
      items: result.rows.map((row: any) => this.mapRow(row)),
      total: Number(countResult.rows[0]?.total ?? 0),
    }
  }

  async findForLandlord(landlordId: string, payoutId: string): Promise<LandlordPayout | null> {
    const pool = await getPool()
    if (!pool) throw new Error('Database pool not initialized')
    const result = await pool.query(
      `SELECT ${PAYOUT_COLUMNS}
       FROM landlord_payouts
       WHERE id = $1 AND landlord_id = $2`,
      [payoutId, landlordId],
    )
    return result.rows[0] ? this.mapRow(result.rows[0]) : null
  }

  async getPreference(landlordId: string): Promise<PayoutSchedulePreference> {
    const pool = await getPool()
    if (!pool) throw new Error('Database pool not initialized')
    const result = await pool.query(
      `SELECT schedule_preference FROM landlord_payout_preferences WHERE landlord_id = $1`,
      [landlordId],
    )
    return (result.rows[0]?.schedule_preference as PayoutSchedulePreference) ??
      DEFAULT_PAYOUT_SCHEDULE_PREFERENCE
  }

  async setPreference(
    landlordId: string,
    preference: PayoutSchedulePreference,
  ): Promise<PayoutSchedulePreference> {
    const pool = await getPool()
    if (!pool) throw new Error('Database pool not initialized')
    const result = await pool.query(
      `INSERT INTO landlord_payout_preferences (landlord_id, schedule_preference, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (landlord_id) DO UPDATE
         SET schedule_preference = EXCLUDED.schedule_preference,
             updated_at = NOW()
       RETURNING schedule_preference`,
      [landlordId, preference],
    )
    return result.rows[0].schedule_preference as PayoutSchedulePreference
  }

  async insertIfAbsent(payout: LandlordPayout): Promise<boolean> {
    const pool = await getPool()
    if (!pool) throw new Error('Database pool not initialized')
    const result = await pool.query(
      `INSERT INTO landlord_payouts (
         id, landlord_id, property_id, property_name, scheduled_date, completed_date,
         gross_amount, deductions, net_amount, currency, status, channel, delay_reasons,
         period_start, period_end, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11, $12, $13,
         $14, $15, $16, $17
       )
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [
        payout.id,
        payout.landlordId,
        payout.propertyId,
        payout.propertyName,
        payout.scheduledDate,
        payout.completedDate,
        payout.grossAmount,
        JSON.stringify(payout.deductions),
        payout.netAmount,
        payout.currency,
        payout.status,
        payout.channel,
        JSON.stringify(payout.delayReasons),
        payout.periodStart,
        payout.periodEnd,
        payout.createdAt,
        payout.updatedAt,
      ],
    )
    return result.rows.length > 0
  }

  async sumGrossSince(landlordId: string, since: Date): Promise<number> {
    const pool = await getPool()
    if (!pool) throw new Error('Database pool not initialized')
    const result = await pool.query(
      `SELECT COALESCE(SUM(gross_amount), 0) AS total
       FROM landlord_payouts
       WHERE landlord_id = $1 AND created_at >= $2 AND status <> 'failed'`,
      [landlordId, since.toISOString()],
    )
    return Number(result.rows[0]?.total ?? 0)
  }

  private mapRow(row: any): LandlordPayout {
    const deductions: Deduction[] = Array.isArray(row.deductions)
      ? row.deductions.map((d: any) => ({
          type: d.type,
          label: d.label,
          amount: Number(d.amount),
        }))
      : []
    const delayReasons: DelayReason[] = Array.isArray(row.delay_reasons)
      ? row.delay_reasons
      : []
    return {
      id: row.id,
      landlordId: row.landlord_id,
      propertyId: row.property_id,
      propertyName: row.property_name,
      scheduledDate: toIso(row.scheduled_date),
      completedDate: row.completed_date ? toIso(row.completed_date) : null,
      grossAmount: Number(row.gross_amount),
      deductions,
      netAmount: Number(row.net_amount),
      currency: row.currency,
      status: row.status,
      channel: row.channel,
      delayReasons,
      periodStart: toIso(row.period_start),
      periodEnd: toIso(row.period_end),
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    }
  }
}

/**
 * Picks PostgreSQL when DATABASE_URL is set and the in-memory store otherwise.
 * Nothing calls an init function, so the default has to choose the backend
 * itself. Otherwise production would quietly read an empty in-memory store.
 */
class HybridLandlordPayoutScheduleStore implements LandlordPayoutScheduleStore {
  private memory = new InMemoryLandlordPayoutScheduleStore()
  private postgres = new PostgresLandlordPayoutScheduleStore()

  private async adapter(): Promise<LandlordPayoutScheduleStore> {
    return (await getPool()) ? this.postgres : this.memory
  }

  async listForLandlord(landlordId: string, filters?: LandlordPayoutFilters): Promise<LandlordPayout[]> {
    return (await this.adapter()).listForLandlord(landlordId, filters)
  }

  async listPageForLandlord(
    landlordId: string,
    filters: LandlordPayoutFilters,
    page: number,
    pageSize: number,
  ): Promise<{ items: LandlordPayout[]; total: number }> {
    return (await this.adapter()).listPageForLandlord(landlordId, filters, page, pageSize)
  }

  async findForLandlord(landlordId: string, payoutId: string): Promise<LandlordPayout | null> {
    return (await this.adapter()).findForLandlord(landlordId, payoutId)
  }

  async getPreference(landlordId: string): Promise<PayoutSchedulePreference> {
    return (await this.adapter()).getPreference(landlordId)
  }

  async setPreference(
    landlordId: string,
    preference: PayoutSchedulePreference,
  ): Promise<PayoutSchedulePreference> {
    return (await this.adapter()).setPreference(landlordId, preference)
  }

  async insertIfAbsent(payout: LandlordPayout): Promise<boolean> {
    return (await this.adapter()).insertIfAbsent(payout)
  }

  async sumGrossSince(landlordId: string, since: Date): Promise<number> {
    return (await this.adapter()).sumGrossSince(landlordId, since)
  }
}

export const landlordPayoutScheduleStore: LandlordPayoutScheduleStore =
  new HybridLandlordPayoutScheduleStore()
