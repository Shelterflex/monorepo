import { z } from 'zod'

/** Longest window the analytics endpoint will compute, in calendar months. */
export const MAX_ANALYTICS_MONTHS = 24

/** Window used when the caller gives no dates: the 12 calendar months up to today. */
export const DEFAULT_ANALYTICS_MONTHS = 12

const UTC_DAY = /^\d{4}-\d{2}-\d{2}$/

/** Parses a YYYY-MM-DD string as a real UTC calendar date, or returns null. */
export function parseUtcDay(value: string): Date | null {
  if (!UTC_DAY.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null
  return date
}

/**
 * Number of calendar months a window covers, counting both end months. For example,
 * 2026-01-15 to 2026-02-01 covers 2 months. Both inputs must be valid YYYY-MM-DD strings.
 */
export function monthsSpanned(startDay: string, endDay: string): number {
  const start = new Date(`${startDay}T00:00:00.000Z`)
  const end = new Date(`${endDay}T00:00:00.000Z`)
  return (
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth()) +
    1
  )
}

const utcDay = z
  .string()
  .regex(UTC_DAY, 'Dates must be YYYY-MM-DD')
  .refine((value) => parseUtcDay(value) !== null, 'Not a valid calendar date')

/**
 * Query for GET /landlord/analytics. Dates are whole UTC days and both ends are
 * inclusive. When both dates are given, the range must not be inverted and must
 * not span more than MAX_ANALYTICS_MONTHS. The service repeats the span check for
 * windows where one end is defaulted.
 */
export const landlordAnalyticsQuerySchema = z
  .object({
    startDate: utcDay.optional(),
    endDate: utcDay.optional(),
    propertyId: z.string().trim().min(1).max(128).optional(),
  })
  .superRefine((query, ctx) => {
    if (!query.startDate || !query.endDate) return
    if (query.startDate > query.endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startDate'],
        message: 'startDate must be on or before endDate',
      })
      return
    }
    if (monthsSpanned(query.startDate, query.endDate) > MAX_ANALYTICS_MONTHS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: `Analytics window cannot exceed ${MAX_ANALYTICS_MONTHS} months`,
      })
    }
  })

export type LandlordAnalyticsQuery = z.infer<typeof landlordAnalyticsQuerySchema>
