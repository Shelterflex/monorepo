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
  propertyId: z.string().optional(),
  status: payoutStatusSchema.optional(),
  channel: payoutChannelSchema.optional(),
  grouping: payoutGroupingSchema.optional().default('monthly'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 1)),
  pageSize: z
    .string()
    .optional()
    .transform((v) => Math.min(100, v ? parseInt(v, 10) : 20)),
})

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
