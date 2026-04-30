import { z } from 'zod'

export const createPhotoSchema = z.object({
  propertyId: z.string().uuid('Invalid property ID'),
  url: z.string().url('Invalid photo URL'),
  orderIndex: z.number().int().min(0).optional(),
  isFeatured: z.boolean().optional(),
  fileName: z.string().optional(),
  fileSize: z.number().int().positive().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  mimeType: z.string().optional(),
})

export const updatePhotoSchema = z.object({
  url: z.string().url().optional(),
  orderIndex: z.number().int().min(0).optional(),
  isFeatured: z.boolean().optional(),
  fileName: z.string().optional(),
  fileSize: z.number().int().positive().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  mimeType: z.string().optional(),
})

export const reorderPhotosSchema = z.object({
  photoId: z.string().uuid('Invalid photo ID'),
  newOrderIndex: z.number().int().min(0, 'Order index must be non-negative'),
})

export const setFeaturedSchema = z.object({
  photoId: z.string().uuid('Invalid photo ID'),
  propertyId: z.string().uuid('Invalid property ID'),
})

export const photoFiltersSchema = z.object({
  propertyId: z.string().uuid().optional(),
  isFeatured: z.coerce.boolean().optional(),
})
