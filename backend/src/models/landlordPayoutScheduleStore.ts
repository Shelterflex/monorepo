/**
 * Landlord Payout Schedule Store
 */

import { getPool } from '../db.js'
import {
  type LandlordPayout, type PayoutPeriod, type PayoutScheduleSummary,
  type PayoutStatus, type PayoutChannel, type PayoutGrouping, type Deduction,
} from '../schemas/landlordPayoutSchedule.js'

export interface LandlordPayoutScheduleStore {
  listPayouts(landlordId: string, filters?: {
    propertyId?: string; status?: PayoutStatus; channel?: PayoutChannel
    from?: string; to?: string; page?: number; pageSize?: number
  }): Promise<{ payouts: LandlordPayout[]; total: number; page: number; pageSize: number }>
  getPayoutById(payoutId: string, landlordId: string): Promise<LandlordPayout | null>
  getSchedule(landlordId: string, filters?: {
    propertyId?: string; status?: PayoutStatus; channel?: PayoutChannel
    grouping?: PayoutGrouping; from?: string; to?: string
  }): Promise<{ periods: PayoutPeriod[]; summary: PayoutScheduleSummary }>
}

function getWeekNumber(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 1)
  return Math.ceil(((d.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7)
}

export function groupPayouts(payouts: LandlordPayout[], grouping: PayoutGrouping): PayoutPeriod[] {
  const map = new Map<string, LandlordPayout[]>()
  for (const p of payouts) {
    const d = new Date(p.scheduledDate)
    const key = grouping === 'weekly'
      ? `${d.getFullYear()}-W${String(getWeekNumber(d)).padStart(2, '0')}`
      : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(p)
  }
  const periods: PayoutPeriod[] = []
  for (const [label, ps] of map) {
    const sorted = ps.sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime())
    periods.push({
      periodLabel: label, periodStart: sorted[0].periodStart,
      periodEnd: sorted[sorted.length - 1].periodEnd,
      grossTotal: ps.reduce((s, p) => s + p.grossAmount, 0),
      deductionsTotal: ps.reduce((s, p) => s + p.deductions.reduce((d, dd) => d + dd.amount, 0), 0),
      netTotal: ps.reduce((s, p) => s + p.netAmount, 0),
      payoutCount: ps.length, delayedCount: ps.filter(p => p.status === 'delayed').length, payouts: sorted,
    })
  }
  return periods.sort((a, b) => a.periodLabel.localeCompare(b.periodLabel))
}

export function computeSummary(payouts: LandlordPayout[]): PayoutScheduleSummary {
  return {
    totalGross: payouts.reduce((s, p) => s + p.grossAmount, 0),
    totalDeductions: payouts.reduce((s, p) => s + p.deductions.reduce((d, dd) => d + dd.amount, 0), 0),
    totalNet: payouts.reduce((s, p) => s + p.netAmount, 0),
    totalPayouts: payouts.length,
    delayedPayouts: payouts.filter(p => p.status === 'delayed').length,
    onHoldPayouts: payouts.filter(p => p.status === 'on_hold').length,
    currency: payouts[0]?.currency ?? 'NGN',
  }
}

function filterPayouts(payouts: LandlordPayout[], landlordId: string, filters?: {
  propertyId?: string; status?: PayoutStatus; channel?: PayoutChannel; from?: string; to?: string
}): LandlordPayout[] {
  let r = payouts.filter(p => p.landlordId === landlordId)
  if (filters?.propertyId) r = r.filter(p => p.propertyId === filters.propertyId)
  if (filters?.status) r = r.filter(p => p.status === filters.status)
  if (filters?.channel) r = r.filter(p => p.channel === filters.channel)
  if (filters?.from) r = r.filter(p => p.scheduledDate >= filters.from!)
  if (filters?.to) r = r.filter(p => p.scheduledDate <= filters.to!)
  return r
}

export class InMemoryLandlordPayoutScheduleStore implements LandlordPayoutScheduleStore {
  private payouts: Map<string, LandlordPayout> = new Map()
  seed(payout: LandlordPayout): void { this.payouts.set(payout.id, payout) }

  async listPayouts(landlordId: string, filters?: {
    propertyId?: string; status?: PayoutStatus; channel?: PayoutChannel
    from?: string; to?: string; page?: number; pageSize?: number
  }): Promise<{ payouts: LandlordPayout[]; total: number; page: number; pageSize: number }> {
    let results = filterPayouts(Array.from(this.payouts.values()), landlordId, filters)
    results.sort((a, b) => new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime())
    const page = filters?.page ?? 1, pageSize = filters?.pageSize ?? 20, total = results.length
    return { payouts: results.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize }
  }

  async getPayoutById(payoutId: string, landlordId: string): Promise<LandlordPayout | null> {
    const p = this.payouts.get(payoutId)
    return p && p.landlordId === landlordId ? p : null
  }

  async getSchedule(landlordId: string, filters?: {
    propertyId?: string; status?: PayoutStatus; channel?: PayoutChannel
    grouping?: PayoutGrouping; from?: string; to?: string
  }): Promise<{ periods: PayoutPeriod[]; summary: PayoutScheduleSummary }> {
    const results = filterPayouts(Array.from(this.payouts.values()), landlordId, filters)
    return { periods: groupPayouts(results, filters?.grouping ?? 'monthly'), summary: computeSummary(results) }
  }
}

function mapRow(row: Record<string, unknown>): LandlordPayout {
  const deductions = typeof row.deductions === 'string' ? JSON.parse(row.deductions as string) : (row.deductions as Deduction[]) || []
  const delayReasons = typeof row.delay_reasons === 'string' ? JSON.parse(row.delay_reasons as string) : (row.delay_reasons as string[]) || []
  return {
    id: row.id as string, landlordId: row.landlord_id as string,
    propertyId: row.property_id as string, propertyName: row.property_name as string,
    scheduledDate: new Date(row.scheduled_date as string).toISOString(),
    completedDate: row.completed_date ? new Date(row.completed_date as string).toISOString() : null,
    grossAmount: Number(row.gross_amount), deductions, netAmount: Number(row.net_amount),
    currency: (row.currency as string) || 'NGN',
    status: row.status as PayoutStatus, channel: row.channel as PayoutChannel,
    delayReasons: delayReasons as string[] as any,
    periodStart: new Date(row.period_start as string).toISOString(),
    periodEnd: new Date(row.period_end as string).toISOString(),
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  }
}

export class PostgresLandlordPayoutScheduleStore implements LandlordPayoutScheduleStore {
  async listPayouts(landlordId: string, filters?: {
    propertyId?: string; status?: PayoutStatus; channel?: PayoutChannel
    from?: string; to?: string; page?: number; pageSize?: number
  }): Promise<{ payouts: LandlordPayout[]; total: number; page: number; pageSize: number }> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not configured')
    const conds = ['landlord_id = $1'], params: unknown[] = [landlordId]
    let i = 2
    if (filters?.propertyId) { conds.push(`property_id = $${i++}`); params.push(filters.propertyId) }
    if (filters?.status) { conds.push(`status = $${i++}`); params.push(filters.status) }
    if (filters?.channel) { conds.push(`channel = $${i++}`); params.push(filters.channel) }
    if (filters?.from) { conds.push(`scheduled_date >= $${i++}`); params.push(filters.from) }
    if (filters?.to) { conds.push(`scheduled_date <= $${i++}`); params.push(filters.to) }
    const where = `WHERE ${conds.join(' AND ')}`
    const page = filters?.page ?? 1, pageSize = Math.min(100, filters?.pageSize ?? 20)
    const cr = await pool.query(`SELECT COUNT(*)::int AS total FROM landlord_payouts ${where}`, params)
    const dr = await pool.query(`SELECT * FROM landlord_payouts ${where} ORDER BY scheduled_date DESC LIMIT $${i++} OFFSET $${i}`, [...params, pageSize, (page - 1) * pageSize])
    return { payouts: dr.rows.map(mapRow), total: cr.rows[0].total, page, pageSize }
  }

  async getPayoutById(payoutId: string, landlordId: string): Promise<LandlordPayout | null> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not configured')
    const { rows } = await pool.query(`SELECT * FROM landlord_payouts WHERE id = $1 AND landlord_id = $2`, [payoutId, landlordId])
    return rows.length > 0 ? mapRow(rows[0]) : null
  }

  async getSchedule(landlordId: string, filters?: {
    propertyId?: string; status?: PayoutStatus; channel?: PayoutChannel
    grouping?: PayoutGrouping; from?: string; to?: string
  }): Promise<{ periods: PayoutPeriod[]; summary: PayoutScheduleSummary }> {
    const all = await this.listPayouts(landlordId, { ...filters, page: 1, pageSize: 1000 })
    const payouts = all.payouts
    return { periods: groupPayouts(payouts, filters?.grouping ?? 'monthly'), summary: computeSummary(payouts) }
  }
}

let store: LandlordPayoutScheduleStore

export function getLandlordPayoutScheduleStore(): LandlordPayoutScheduleStore {
  if (!store) {
    store = process.env.DATABASE_URL
      ? new PostgresLandlordPayoutScheduleStore()
      : new InMemoryLandlordPayoutScheduleStore()
  }
  return store
}

export function initLandlordPayoutScheduleStore(usePostgres: boolean): void {
  store = usePostgres ? new PostgresLandlordPayoutScheduleStore() : new InMemoryLandlordPayoutScheduleStore()
}
