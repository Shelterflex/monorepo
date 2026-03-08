import { z } from 'zod'

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const depositsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['unmatched', 'matched', 'reversed']).optional(),
})

export const walletsQuerySchema = paginationQuerySchema.extend({
  negative: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => (v ? v === 'true' : undefined)),
})

export const conversionsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['pending', 'completed', 'failed']).optional(),
})

export const outboxReconQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['pending', 'failed']).optional(),
})

export type DepositsQuery = z.infer<typeof depositsQuerySchema>
export type WalletsQuery = z.infer<typeof walletsQuerySchema>
export type ConversionsQuery = z.infer<typeof conversionsQuerySchema>
export type OutboxReconQuery = z.infer<typeof outboxReconQuerySchema>

