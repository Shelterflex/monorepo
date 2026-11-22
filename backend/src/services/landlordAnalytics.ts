/**
 * Metric maths for landlord analytics (issue #2054).
 *
 * Pure functions with no I/O, so the edge cases (empty portfolio, partial months,
 * paid items with no timestamp, unpaid items that are not yet due) can be
 * unit-tested directly. landlordAnalyticsData.ts gathers the inputs.
 */

import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import {
  DEFAULT_ANALYTICS_MONTHS,
  MAX_ANALYTICS_MONTHS,
  monthsSpanned,
  parseUtcDay,
} from '../schemas/landlordAnalytics.js'

export interface OccupancyInput {
  propertyId: string
  /**
   * When the property's current deal started occupancy. The property counts as
   * occupied from this instant onward. Undefined means the property is vacant.
   */
  occupiedFrom?: Date
}

export interface PaymentRecord {
  amountNgn: number
  dueDate: Date
  /** Whether the instalment has been paid. */
  paid: boolean
  /** When it was paid, if the schedule recorded that. */
  paidAt?: Date
}

export interface VacancyFill {
  /** When the property became available to rent. */
  availableFrom: Date
  /** When it was let. */
  filledAt: Date
}

export interface OccupancyPoint {
  date: string
  rate: number
}

export interface RevenuePoint {
  month: string
  expected: number
  collected: number
}

export interface PaymentTrendPoint {
  date: string
  onTime: number
  late: number
  missed: number
}

export interface VacancyMetrics {
  averageTimeToFill: number
  currentVacancyCount: number
}

export interface LandlordAnalytics {
  occupancyTrend: OccupancyPoint[]
  revenueBreakdown: RevenuePoint[]
  paymentTrends: PaymentTrendPoint[]
  vacancyMetrics: VacancyMetrics
}

export interface AnalyticsWindow {
  /** Start of the first day, UTC, inclusive. */
  start: Date
  /** End of the last day, UTC, inclusive. */
  end: Date
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Inclusive list of `YYYY-MM` keys between two dates. */
export function enumerateMonths(start: Date, end: Date): string[] {
  const months: string[] = []
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1))
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1))
  while (cursor <= last) {
    months.push(monthKey(cursor))
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return months
}

function monthBounds(month: string): { from: Date; to: Date } {
  const from = new Date(`${month}-01T00:00:00.000Z`)
  const to = new Date(from)
  to.setUTCMonth(to.getUTCMonth() + 1)
  to.setUTCMilliseconds(-1)
  return { from, to }
}

/**
 * Share of properties occupied at some point in each month, as a whole percentage.
 * A month with no properties reports 0.
 */
export function computeOccupancyTrend(
  properties: OccupancyInput[],
  start: Date,
  end: Date,
): OccupancyPoint[] {
  return enumerateMonths(start, end).map((month) => {
    if (properties.length === 0) return { date: month, rate: 0 }
    const { to } = monthBounds(month)
    const occupied = properties.filter((p) => p.occupiedFrom !== undefined && p.occupiedFrom <= to).length
    return { date: month, rate: Math.round((occupied / properties.length) * 100) }
  })
}

/**
 * Expected and collected rent per month. An instalment counts as expected in the
 * month it is due. It counts as collected in the month it was paid. When the
 * schedule marks an instalment paid without a timestamp, it counts as collected in
 * its due month.
 */
export function computeRevenueBreakdown(
  payments: PaymentRecord[],
  start: Date,
  end: Date,
): RevenuePoint[] {
  const expected = new Map<string, number>()
  const collected = new Map<string, number>()

  for (const payment of payments) {
    const dueMonth = monthKey(payment.dueDate)
    expected.set(dueMonth, (expected.get(dueMonth) ?? 0) + payment.amountNgn)

    if (payment.paid) {
      const paidMonth = monthKey(payment.paidAt ?? payment.dueDate)
      collected.set(paidMonth, (collected.get(paidMonth) ?? 0) + payment.amountNgn)
    }
  }

  return enumerateMonths(start, end).map((month) => ({
    month,
    expected: expected.get(month) ?? 0,
    collected: collected.get(month) ?? 0,
  }))
}

/**
 * On-time, late and missed instalments, counted by due day. Instalments due inside
 * the window are included, and `now` decides which unpaid ones are overdue. Due
 * dates are days, so the comparison is by UTC day, not by time of day:
 *   - paid on or before its due day: on time
 *   - paid after its due day: late
 *   - unpaid and already due: missed
 *   - unpaid but not yet due: not counted yet
 *   - paid with no timestamp: skipped, because the timing is unknown
 */
export function computePaymentTrends(
  payments: PaymentRecord[],
  start: Date,
  end: Date,
  now: Date,
): PaymentTrendPoint[] {
  const buckets = new Map<string, PaymentTrendPoint>()

  for (const payment of payments) {
    if (payment.dueDate < start || payment.dueDate > end) continue
    if (payment.paid && !payment.paidAt) continue
    if (!payment.paid && payment.dueDate >= now) continue

    const key = dayKey(payment.dueDate)
    const point = buckets.get(key) ?? { date: key, onTime: 0, late: 0, missed: 0 }

    if (!payment.paid) {
      point.missed += 1
    } else if (payment.paidAt && dayKey(payment.paidAt) <= dayKey(payment.dueDate)) {
      point.onTime += 1
    } else if (payment.paidAt) {
      point.late += 1
    }
    buckets.set(key, point)
  }

  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Vacancy metrics. `averageTimeToFill` is the mean number of days from a property
 * becoming available to its deal starting, over vacancies that have been filled.
 * Open vacancies have no fill time, so they are left out of that average. They are
 * counted in `currentVacancyCount`, which is the number of properties with no
 * occupancy now.
 */
export function computeVacancyMetrics(
  properties: OccupancyInput[],
  fills: VacancyFill[],
): VacancyMetrics {
  const currentVacancyCount = properties.filter((p) => p.occupiedFrom === undefined).length

  if (fills.length === 0) {
    return { averageTimeToFill: 0, currentVacancyCount }
  }

  const totalDays = fills.reduce((sum, fill) => {
    const days = (fill.filledAt.getTime() - fill.availableFrom.getTime()) / MS_PER_DAY
    return sum + Math.max(0, days)
  }, 0)

  return {
    averageTimeToFill: Math.round(totalDays / fills.length),
    currentVacancyCount,
  }
}

function utcDayOf(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Turns the query dates into an inclusive UTC window.
 *   - No dates: the last DEFAULT_ANALYTICS_MONTHS calendar months, ending today.
 *   - Only startDate: it runs up to today.
 *   - Only endDate: it covers DEFAULT_ANALYTICS_MONTHS calendar months back from it.
 * Throws a 400 AppError if the range is inverted or spans too many months.
 */
export function resolveAnalyticsWindow(
  query: { startDate?: string; endDate?: string },
  now: Date,
): AnalyticsWindow {
  const endDay = query.endDate ?? utcDayOf(now)
  const startDay =
    query.startDate ??
    utcDayOf(new Date(Date.UTC(
      Number(endDay.slice(0, 4)),
      Number(endDay.slice(5, 7)) - 1 - (DEFAULT_ANALYTICS_MONTHS - 1),
      1,
    )))

  if (!parseUtcDay(startDay) || !parseUtcDay(endDay)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Dates must be valid YYYY-MM-DD values')
  }
  if (startDay > endDay) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'startDate must be on or before endDate')
  }
  if (monthsSpanned(startDay, endDay) > MAX_ANALYTICS_MONTHS) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      400,
      `Analytics window cannot exceed ${MAX_ANALYTICS_MONTHS} months`,
    )
  }

  return {
    start: new Date(`${startDay}T00:00:00.000Z`),
    end: new Date(`${endDay}T23:59:59.999Z`),
  }
}
