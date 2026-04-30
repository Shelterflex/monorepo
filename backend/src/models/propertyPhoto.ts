/**
 * Property Photo model and types
 */

export interface PropertyPhoto {
  id: string
  propertyId: string
  url: string
  orderIndex: number
  isFeatured: boolean
  fileName?: string
  fileSize?: number
  width?: number
  height?: number
  mimeType?: string
  uploadedAt: Date
  createdAt: Date
  updatedAt: Date
}

export interface CreatePhotoInput {
  propertyId: string
  url: string
  orderIndex?: number
  isFeatured?: boolean
  fileName?: string
  fileSize?: number
  width?: number
  height?: number
  mimeType?: string
}

export interface UpdatePhotoInput {
  url?: string
  orderIndex?: number
  isFeatured?: boolean
  fileName?: string
  fileSize?: number
  width?: number
  height?: number
  mimeType?: string
}

export interface PhotoFilters {
  propertyId?: string
  isFeatured?: boolean
}

export interface ReorderPhotosInput {
  photoId: string
  newOrderIndex: number
}
