import { z } from 'zod'

/** Longest review text accepted, in characters. */
export const APARTMENT_REVIEW_MAX_LENGTH = 2000

/** A review is hidden automatically once this many distinct users have reported it. */
export const APARTMENT_REVIEW_REPORT_THRESHOLD = 3

export const apartmentReviewSortSchema = z.enum(['recent', 'rating_desc', 'rating_asc'])
export type ApartmentReviewSort = z.infer<typeof apartmentReviewSortSchema>

/** Review text is plain text only: HTML brackets are rejected rather than stored. */
const reviewTextSchema = z
  .string()
  .trim()
  .min(1, 'Review text is required')
  .max(APARTMENT_REVIEW_MAX_LENGTH, `Review text must be at most ${APARTMENT_REVIEW_MAX_LENGTH} characters`)
  .refine((value) => !/[<>]/.test(value), 'Review text must be plain text and cannot contain HTML')

export const createApartmentReviewSchema = z.object({
  listingId: z.string().uuid('listingId must be a valid listing id'),
  rating: z.number().int().min(1, 'Rating must be between 1 and 5').max(5, 'Rating must be between 1 and 5'),
  text: reviewTextSchema,
})
export type CreateApartmentReviewRequest = z.infer<typeof createApartmentReviewSchema>

export const apartmentReviewListQuerySchema = z.object({
  listingId: z.string().uuid('listingId must be a valid listing id').optional(),
  sort: apartmentReviewSortSchema.optional().default('recent'),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional().default(20),
})
export type ApartmentReviewListQuery = z.infer<typeof apartmentReviewListQuerySchema>

export const apartmentReviewIdParamsSchema = z.object({
  id: z.string().uuid('Invalid review id'),
})

export const moderateApartmentReviewSchema = z.object({
  isHidden: z.boolean(),
})
export type ModerateApartmentReviewRequest = z.infer<typeof moderateApartmentReviewSchema>

export interface ApartmentReview {
  id: string
  listingId: string
  userId: string
  rating: number
  text: string
  verifiedStay: boolean
  isHidden: boolean
  isReported: boolean
  reportCount: number
  createdAt: Date
  updatedAt: Date
}

/** The public view of a review. The reviewer's user id is left out. */
export interface PublicApartmentReview {
  id: string
  listingId: string
  rating: number
  text: string
  verifiedStay: boolean
  createdAt: Date
}

export interface ApartmentReviewPage {
  reviews: PublicApartmentReview[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  /** Average rating over every visible review that matches the filter, or null when there are none. */
  averageRating: number | null
}
