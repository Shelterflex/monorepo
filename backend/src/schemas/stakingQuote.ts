import { z } from 'zod'

export const paymentRailSchema = z.enum(['paystack', 'flutterwave', 'bank_transfer', 'manual_admin'])

export const stakingQuoteSchema = z.object({
  amountNgn: z.number().positive(),
  paymentRail: paymentRailSchema,
})

export type StakingQuoteRequest = z.infer<typeof stakingQuoteSchema>
