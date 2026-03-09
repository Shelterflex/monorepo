import { z } from 'zod'

export const freezeReasonSchema = z.enum(['NEGATIVE_BALANCE', 'MANUAL', 'COMPLIANCE'])

export const userRiskStateSchema = z.object({
  userId: z.string(),
  isFrozen: z.boolean(),
  freezeReason: freezeReasonSchema.nullable(),
  frozenAt: z.string().nullable(),
  unfrozenAt: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const freezeUserRequestSchema = z.object({
  reason: freezeReasonSchema,
  notes: z.string().optional(),
})

export const unfreezeUserRequestSchema = z.object({
  notes: z.string().optional(),
})

export const userRiskDetailResponseSchema = z.object({
  success: z.boolean().optional(),
  riskState: userRiskStateSchema,
  balances: z.object({
    availableNgn: z.number(),
    heldNgn: z.number(),
    totalNgn: z.number(),
  }),
})

export const frozenUsersResponseSchema = z.object({
  success: z.boolean().optional(),
  users: z.array(userRiskStateSchema),
})

export const depositReversalWebhookSchema = z.object({
  provider: z.enum(['onramp', 'offramp']),
  providerRef: z.string(),
  reversalRef: z.string(),
  eventType: z.literal('deposit.reversed'),
  timestamp: z.string(),
})

export type FreezeReason = z.infer<typeof freezeReasonSchema>
export type UserRiskStateResponse = z.infer<typeof userRiskStateSchema>
export type FreezeUserRequest = z.infer<typeof freezeUserRequestSchema>
export type UnfreezeUserRequest = z.infer<typeof unfreezeUserRequestSchema>
export type UserRiskDetailResponse = z.infer<typeof userRiskDetailResponseSchema>
export type FrozenUsersResponse = z.infer<typeof frozenUsersResponseSchema>
export type DepositReversalWebhook = z.infer<typeof depositReversalWebhookSchema>
