import { z } from 'zod'

export const tenantRatingSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string(),
  landlordId: z.string(),
  dealId: z.string().uuid(),
  paymentTimeliness: z.number().int().min(1).max(5),
  propertyCare: z.number().int().min(1).max(5),
  communication: z.number().int().min(1).max(5),
  overall: z.number().int().min(1).max(5),
  comment: z.string().max(500).nullable().optional(),
  createdAt: z.date(),
})

export type TenantRating = z.infer<typeof tenantRatingSchema>

export const createTenantRatingSchema = z.object({
  dealId: z.string().uuid(),
  paymentTimeliness: z.number().int().min(1).max(5),
  propertyCare: z.number().int().min(1).max(5),
  communication: z.number().int().min(1).max(5),
  overall: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
})

export type CreateTenantRatingRequest = z.infer<typeof createTenantRatingSchema>

/** Landlord rating body. The deal id comes from the path, and the tenant is read from the deal. */
export const tenantRatingBodySchema = createTenantRatingSchema.omit({ dealId: true })

export const dealIdParamsSchema = z.object({
  dealId: z.string().uuid('dealId must be a valid deal id'),
})

export const shareTokenIdParamsSchema = z.object({
  tokenId: z.string().uuid('tokenId must be a valid share link id'),
})

export const shareRatingCardSchema = z.object({
  ttlDays: z.number().int().min(1).max(30),
})

export type ShareRatingCardRequest = z.infer<typeof shareRatingCardSchema>

export interface RatingCardToken {
  id: string
  tenantId: string
  token: string
  expiresAt: Date
  createdAt: Date
}

export interface PublicRatingCardResponse {
  aggregates: {
    paymentTimeliness: number
    propertyCare: number
    communication: number
    overall: number
  }
  ratingCount: number
  recentComments: string[]
}

export interface TenantRatingCardResponse {
  aggregates: {
    paymentTimeliness: number
    propertyCare: number
    communication: number
    overall: number
  }
  ratingCount: number
  recentComments: Array<{
    landlordInitial: string
    comment: string
    createdAt: Date
  }>
}
