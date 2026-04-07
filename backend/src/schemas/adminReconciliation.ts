import { z } from 'zod'

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  cursor: z.string().optional(),
})

export const depositsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['pending', 'confirmed', 'failed', 'reversed']).optional(),
})

export const depositItemSchema = z.object({
  depositId: z.string(),
  userId: z.string(),
  amountNgn: z.number(),
  rail: z.string().nullable(),
  status: z.enum(['pending', 'confirmed', 'failed', 'reversed']),
  hasExternalRef: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  flow: z.enum(['ngn_wallet', 'staking']),
})

export const depositsResponseSchema = z.object({
  items: z.array(depositItemSchema),
  nextCursor: z.string().nullable(),
})

export const walletsQuerySchema = paginationQuerySchema.extend({
  negative: z.coerce.boolean().default(true),
})

export const walletItemSchema = z.object({
  userId: z.string(),
  availableNgn: z.number(),
  heldNgn: z.number(),
  totalNgn: z.number(),
  isFrozen: z.boolean().optional(),
})

export const walletsResponseSchema = z.object({
  items: z.array(walletItemSchema),
  nextCursor: z.string().nullable(),
})

export const conversionsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['pending', 'completed', 'failed']).optional(),
})

export const conversionItemSchema = z.object({
  conversionId: z.string(),
  depositId: z.string(),
  userId: z.string(),
  amountNgn: z.number(),
  amountUsdc: z.string(),
  fxRateNgnPerUsdc: z.number(),
  provider: z.string(),
  status: z.enum(['pending', 'completed', 'failed']),
  createdAt: z.string(),
  updatedAt: z.string(),
  failedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  failureReason: z.string().nullable(),
})

export const conversionsResponseSchema = z.object({
  items: z.array(conversionItemSchema),
  nextCursor: z.string().nullable(),
})

export const outboxQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['pending', 'sent', 'failed', 'dead']).optional(),
})

export const outboxItemSchema = z.object({
  id: z.string(),
  txType: z.string(),
  txId: z.string(),
  externalRef: z.string(),
  status: z.string(),
  attempts: z.number(),
  lastError: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const outboxResponseSchema = z.object({
  items: z.array(outboxItemSchema),
  nextCursor: z.string().nullable(),
})

export type DepositsQuery = z.infer<typeof depositsQuerySchema>
export type DepositsResponse = z.infer<typeof depositsResponseSchema>
export type WalletsQuery = z.infer<typeof walletsQuerySchema>
export type WalletsResponse = z.infer<typeof walletsResponseSchema>
export type ConversionsQuery = z.infer<typeof conversionsQuerySchema>
export type ConversionsResponse = z.infer<typeof conversionsResponseSchema>
export type OutboxQuery = z.infer<typeof outboxQuerySchema>
export type OutboxResponse = z.infer<typeof outboxResponseSchema>

