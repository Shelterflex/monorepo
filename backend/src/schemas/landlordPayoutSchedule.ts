import { z } from 'zod'

export const payoutStatusSchema = z.enum([
  'scheduled',
  'processing',
  'completed',
  'delayed',
  'failed',
  'on_hold',
])

export const payoutChannelSchema = z.enum([
  'bank_transfer',
  'mobile_money',
  'crypto_wallet',
  'check',
])

export const delayReasonSchema = z.enum([
  'bank_processing',
  'dispute_hold',
  'kyc_incomplete',
  'insufficient_funds',
  'compliance_review',
  'system_error',
  'weekend_holiday',
])

export const payoutGroupingSchema = z.enum(['weekly', 'monthly'])

export const deductionTypeSchema = z.enum([
  'platform_fee',
  'tax_withholding',
  'insurance_premium',
  'maintenance_reserve',
  'late_penalty',
  'dispute_deduction',
  'other',
])

export const deductionSchema = z.object({
  type: deductionTypeSchema,
  label: z.string().min(1).max(100),
  amount: z.number().nonnegative(),
})

export const listPayoutScheduleSchema = z.object({
  propertyId: z.string().min(1).max(128).optional(),
  status: payoutStatusSchema.optional(),
  channel: payoutChannelSchema.optional(),
  grouping: payoutGroupingSchema.optional().default('monthly'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
})

export const payoutScheduleIdParamsSchema = z.object({
  payoutId: z.string().min(1).max(128),
})

export const payoutSchedulePreferenceSchema = z.enum(['activation', 'weekly', 'monthly'])

export const updatePayoutSchedulePreferenceSchema = z.object({
  schedulePreference: payoutSchedulePreferenceSchema,
})

/** Query for the upcoming schedule (GET /landlord/payout-schedule). */
export const payoutScheduleQuerySchema = z.object({
  propertyId: z.string().min(1).max(128).optional(),
  grouping: payoutGroupingSchema.optional().default('monthly'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

export type PayoutScheduleQuery = z.infer<typeof payoutScheduleQuerySchema>

/** Statuses that have not been paid out yet. The schedule shows these. */
export const UPCOMING_PAYOUT_STATUSES: readonly PayoutStatus[] = [
  'scheduled',
  'processing',
  'delayed',
  'on_hold',
]

/** Bank account that payouts are sent to. It is stored on the landlord profile. */
export const payoutDestinationSchema = z.object({
  bankName: z.string().trim().min(2, 'bankName is required').max(100),
  /** Nigerian NUBAN account numbers are exactly 10 digits. */
  accountNumber: z.string().trim().regex(/^\d{10}$/, 'accountNumber must be 10 digits'),
  accountName: z.string().trim().min(2, 'accountName is required').max(100),
})

export type PayoutDestination = z.infer<typeof payoutDestinationSchema>

/** Body for PUT /landlord/payout-schedule/preference: frequency, destination, or both. */
export const updatePayoutPreferenceBodySchema = z
  .object({
    schedulePreference: payoutSchedulePreferenceSchema.optional(),
    destination: payoutDestinationSchema.optional(),
  })
  .refine((body) => body.schedulePreference !== undefined || body.destination !== undefined, {
    message: 'Provide schedulePreference, destination, or both',
  })

export type UpdatePayoutPreferenceBody = z.infer<typeof updatePayoutPreferenceBodySchema>

export type PayoutSchedulePreference = z.infer<typeof payoutSchedulePreferenceSchema>
export type UpdatePayoutSchedulePreferenceRequest = z.infer<
  typeof updatePayoutSchedulePreferenceSchema
>

export type PayoutStatus = z.infer<typeof payoutStatusSchema>
export type PayoutChannel = z.infer<typeof payoutChannelSchema>
export type DelayReason = z.infer<typeof delayReasonSchema>
export type PayoutGrouping = z.infer<typeof payoutGroupingSchema>
export type DeductionType = z.infer<typeof deductionTypeSchema>
export type Deduction = z.infer<typeof deductionSchema>
export type ListPayoutScheduleRequest = z.infer<typeof listPayoutScheduleSchema>

export interface LandlordPayout {
  id: string
  landlordId: string
  propertyId: string
  propertyName: string
  scheduledDate: string
  completedDate: string | null
  grossAmount: number
  deductions: Deduction[]
  netAmount: number
  currency: string
  status: PayoutStatus
  channel: PayoutChannel
  delayReasons: DelayReason[]
  periodStart: string
  periodEnd: string
  createdAt: string
  updatedAt: string
}

export interface PayoutPeriod {
  periodLabel: string
  periodStart: string
  periodEnd: string
  grossTotal: number
  deductionsTotal: number
  netTotal: number
  payoutCount: number
  delayedCount: number
  payouts: LandlordPayout[]
}

export interface PayoutScheduleSummary {
  totalGross: number
  totalDeductions: number
  totalNet: number
  totalPayouts: number
  delayedPayouts: number
  onHoldPayouts: number
  currency: string
}

export const DELAY_REASON_LABELS: Record<DelayReason, string> = {
  bank_processing: 'Bank Processing Delay',
  dispute_hold: 'Dispute Hold',
  kyc_incomplete: 'KYC Incomplete',
  insufficient_funds: 'Insufficient Funds',
  compliance_review: 'Compliance Review',
  system_error: 'System Error',
  weekend_holiday: 'Weekend/Holiday',
}

export const DEDUCTION_TYPE_LABELS: Record<DeductionType, string> = {
  platform_fee: 'Platform Fee',
  tax_withholding: 'Tax Withholding',
  insurance_premium: 'Insurance Premium',
  maintenance_reserve: 'Maintenance Reserve',
  late_penalty: 'Late Penalty',
  dispute_deduction: 'Dispute Deduction',
  other: 'Other',
}

export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  scheduled: 'Scheduled',
  processing: 'Processing',
  completed: 'Completed',
  delayed: 'Delayed',
  failed: 'Failed',
  on_hold: 'On Hold',
}

export const PAYOUT_CHANNEL_LABELS: Record<PayoutChannel, string> = {
  bank_transfer: 'Bank Transfer',
  mobile_money: 'Mobile Money',
  crypto_wallet: 'Crypto Wallet',
  check: 'Check',
}
