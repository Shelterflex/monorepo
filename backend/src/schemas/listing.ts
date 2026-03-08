import { z } from 'zod'
import { ListingStatus } from '../models/listing.js'

/**
 * Schema for creating a new listing
 */
export const createListingSchema = z.object({
  whistleblowerId: z.string().min(1, 'Whistleblower ID is required'),
  address: z.string().min(1, 'Address is required'),
  city: z.string().optional(),
  area: z.string().optional(),
  bedrooms: z.number().int().min(0, 'Bedrooms must be 0 or greater'),
  bathrooms: z.number().int().min(0, 'Bathrooms must be 0 or greater'),
  annualRentNgn: z
    .number()
    .positive('Annual rent must be greater than 0')
    .int('Annual rent must be a whole number'),
  description: z.string().optional(),
  photos: z
    .array(z.string().url('Each photo must be a valid URL'))
    .min(3, 'At least 3 photos are required')
    .max(20, 'Maximum 20 photos allowed'),
})

export type CreateListingRequest = z.infer<typeof createListingSchema>

/**
 * Schema for listing filters (query params)
 */
export const listingFiltersSchema = z.object({
  status: z.nativeEnum(ListingStatus).optional(),
  query: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type ListingFiltersRequest = z.infer<typeof listingFiltersSchema>
