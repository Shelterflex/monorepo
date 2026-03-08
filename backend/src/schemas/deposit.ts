import { z } from 'zod'

export const depositInitiateSchema = z.object({
  quoteId: z.string().min(1),
  paymentRail: z.string().min(1),
  customerMeta: z
    .object({
      name: z.string().min(1).optional(),
      phone: z.string().min(1).optional(),
    })
    .optional(),
})

export type DepositInitiateRequest = z.infer<typeof depositInitiateSchema>

export const paymentsWebhookSchema = z.object({
  externalRefSource: z.string().min(1),
  externalRef: z.string().min(1),
  status: z.enum(['confirmed', 'failed', 'reversed']).default('confirmed'),
  providerStatus: z.string().optional().describe('Provider-specific status code for mapping'),
})

export type PaymentsWebhookRequest = z.infer<typeof paymentsWebhookSchema>
export const depositProviderSchema = z.enum(['onramp', 'offramp', 'manual_admin'])

export const confirmDepositSchema = z.object({
  depositId: z.string().min(1).describe('Canonical deposit identifier: {provider}:{id}'),
  userId: z.string().min(1).describe('User ID that owns this deposit'),
  amountNgn: z.number().positive().describe('Confirmed deposit amount in NGN'),
  provider: depositProviderSchema.describe('Deposit source / liquidity route'),
  providerRef: z.string().min(1).describe('Provider-specific reference for reconciliation'),
})

export type ConfirmDepositRequest = z.infer<typeof confirmDepositSchema>
