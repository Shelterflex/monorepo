/**
 * Groups landlord payouts by property and period, and computes the schedule
 * summary (issue #2055).
 *
 * Pure functions with no I/O. Bucketing is done in UTC, so a payout scheduled at
 * 23:30 on the last day of a month lands in that month for every caller.
 *
 * Period labels match what the frontend parses:
 *   monthly  "YYYY-MM"    (e.g. "2026-01")
 *   weekly   "YYYY-Www"   ISO week, Monday to Sunday (e.g. "2026-W05")
 */

import {
  UPCOMING_PAYOUT_STATUSES,
  type LandlordPayout,
  type PayoutGrouping,
  type PayoutPeriod,
  type PayoutScheduleSummary,
} from '../schemas/landlordPayoutSchedule.js'

const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface PeriodBounds {
  label: string
  start: Date
  end: Date
}

export interface PropertyPayoutSchedule {
  propertyId: string
  propertyName: string
  periods: PayoutPeriod[]
}

function endOfDay(day: Date): Date {
  return new Date(day.getTime() + MS_PER_DAY - 1)
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export function monthlyPeriodFor(date: Date): PeriodBounds {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  const start = new Date(Date.UTC(year, month, 1))
  const end = endOfDay(new Date(Date.UTC(year, month + 1, 0)))
  return { label: `${year}-${String(month + 1).padStart(2, '0')}`, start, end }
}

export function weeklyPeriodFor(date: Date): PeriodBounds {
  const day = startOfUtcDay(date)
  // Monday = 0 … Sunday = 6
  const dayOfWeek = (day.getUTCDay() + 6) % 7
  const start = new Date(day.getTime() - dayOfWeek * MS_PER_DAY)
  const end = endOfDay(new Date(start.getTime() + 6 * MS_PER_DAY))

  // ISO week numbering: a week belongs to the year that contains its Thursday.
  const thursday = new Date(start.getTime() + 3 * MS_PER_DAY)
  const isoYear = thursday.getUTCFullYear()
  const jan1 = new Date(Date.UTC(isoYear, 0, 1))
  const dayOfYear = (thursday.getTime() - jan1.getTime()) / MS_PER_DAY + 1
  const week = Math.ceil(dayOfYear / 7)
  return { label: `${isoYear}-W${String(week).padStart(2, '0')}`, start, end }
}

export function periodFor(date: Date, grouping: PayoutGrouping): PeriodBounds {
  return grouping === 'weekly' ? weeklyPeriodFor(date) : monthlyPeriodFor(date)
}

function cents(value: number): number {
  return Math.round(value * 100) / 100
}

/** Sum of the payout's fees and deductions. */
export function totalDeductions(payout: LandlordPayout): number {
  return cents(payout.deductions.reduce((sum, d) => sum + d.amount, 0))
}

/**
 * Net is always gross minus fees, so the net amount is computed here instead of
 * trusting the stored value.
 */
export function withNetAmount(payout: LandlordPayout): LandlordPayout {
  return { ...payout, netAmount: cents(payout.grossAmount - totalDeductions(payout)) }
}

export function isUpcoming(payout: LandlordPayout): boolean {
  return UPCOMING_PAYOUT_STATUSES.includes(payout.status)
}

export function summarizePayouts(payouts: LandlordPayout[]): PayoutScheduleSummary {
  let totalGross = 0
  let totalFees = 0
  let totalNet = 0
  let delayedPayouts = 0
  let onHoldPayouts = 0

  for (const payout of payouts) {
    const normalised = withNetAmount(payout)
    totalGross += normalised.grossAmount
    totalFees += totalDeductions(normalised)
    totalNet += normalised.netAmount
    if (normalised.status === 'delayed') delayedPayouts += 1
    if (normalised.status === 'on_hold') onHoldPayouts += 1
  }

  return {
    totalGross: cents(totalGross),
    totalDeductions: cents(totalFees),
    totalNet: cents(totalNet),
    totalPayouts: payouts.length,
    delayedPayouts,
    onHoldPayouts,
    currency: payouts[0]?.currency ?? 'NGN',
  }
}

/** Groups payouts into periods, oldest period first. Each period's payouts are sorted by scheduled date. */
export function groupPayoutsIntoPeriods(
  payouts: LandlordPayout[],
  grouping: PayoutGrouping,
): PayoutPeriod[] {
  const buckets = new Map<string, { bounds: PeriodBounds; payouts: LandlordPayout[] }>()

  for (const payout of payouts) {
    const bounds = periodFor(new Date(payout.scheduledDate), grouping)
    const bucket = buckets.get(bounds.label) ?? { bounds, payouts: [] }
    bucket.payouts.push(withNetAmount(payout))
    buckets.set(bounds.label, bucket)
  }

  return Array.from(buckets.values())
    .sort((a, b) => a.bounds.start.getTime() - b.bounds.start.getTime())
    .map(({ bounds, payouts: periodPayouts }) => {
      const sorted = [...periodPayouts].sort(
        (a, b) => Date.parse(a.scheduledDate) - Date.parse(b.scheduledDate),
      )
      const totals = sorted.reduce(
        (acc, payout) => ({
          gross: acc.gross + payout.grossAmount,
          deductions: acc.deductions + totalDeductions(payout),
          net: acc.net + payout.netAmount,
          delayed: acc.delayed + (payout.status === 'delayed' ? 1 : 0),
        }),
        { gross: 0, deductions: 0, net: 0, delayed: 0 },
      )
      return {
        periodLabel: bounds.label,
        periodStart: bounds.start.toISOString(),
        periodEnd: bounds.end.toISOString(),
        grossTotal: cents(totals.gross),
        deductionsTotal: cents(totals.deductions),
        netTotal: cents(totals.net),
        payoutCount: sorted.length,
        delayedCount: totals.delayed,
        payouts: sorted,
      }
    })
}

/**
 * Groups payouts by property, and within each property by period. Properties are
 * ordered by name, then by id.
 */
export function groupPayoutsByProperty(
  payouts: LandlordPayout[],
  grouping: PayoutGrouping,
): PropertyPayoutSchedule[] {
  const byProperty = new Map<string, LandlordPayout[]>()
  for (const payout of payouts) {
    const list = byProperty.get(payout.propertyId) ?? []
    list.push(payout)
    byProperty.set(payout.propertyId, list)
  }

  return Array.from(byProperty.entries())
    .map(([propertyId, list]) => ({
      propertyId,
      propertyName: list[0].propertyName,
      periods: groupPayoutsIntoPeriods(list, grouping),
    }))
    .sort(
      (a, b) =>
        a.propertyName.localeCompare(b.propertyName) || a.propertyId.localeCompare(b.propertyId),
    )
}
