import { z } from 'zod'

/** Path parameter for the saved-property routes. Listing ids are UUIDs (see listingStore). */
export const savedPropertyParamsSchema = z.object({
  listingId: z.string().uuid('listingId must be a valid listing id'),
})

/** Query for listing the caller's saved properties. */
export const savedPropertiesListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
})

export type SavedPropertiesListQuery = z.infer<typeof savedPropertiesListQuerySchema>
