import { z } from 'zod'

export const ngnTopupInitiateSchema = z.object({
  amountNgn: z.number().min(100, 'Minimum top-up is 100 NGN').max(5000000, 'Maximum top-up is 5,000,000 NGN'),
  rail: z.enum(['paystack', 'flutterwave', 'bank_transfer', 'manual_admin']),
})

export type NgnTopupInitiateRequest = z.infer<typeof ngnTopupInitiateSchema>

export const ngnTopupInitiateResponseSchema = z.object({
  success: z.boolean().optional(),
  depositId: z.string(),
  externalRefSource: z.string(),
  externalRef: z.string(),
  redirectUrl: z.string().optional().nullable(),
  bankDetails: z.record(z.string()).optional().nullable(),
})

export type NgnTopupInitiateResponse = z.infer<typeof ngnTopupInitiateResponseSchema>
