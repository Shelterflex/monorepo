/**
 * Listing model and types
 */

export enum ListingStatus {
  PENDING_REVIEW = 'pending_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  RENTED = 'rented',
}

export interface Listing {
  listingId: string
  whistleblowerId: string
  address: string
  city?: string
  area?: string
  bedrooms: number
  bathrooms: number
  annualRentNgn: number
  description?: string
  photos: string[]
  status: ListingStatus
  createdAt: Date
  updatedAt: Date
  rejectionReason?: string
  dealId?: string
}

export interface CreateListingInput {
  whistleblowerId: string
  address: string
  city?: string
  area?: string
  bedrooms: number
  bathrooms: number
  annualRentNgn: number
  description?: string
  photos: string[]
}

export interface ListingFilters {
  status?: ListingStatus
  query?: string
  page?: number
  pageSize?: number
}

export interface PaginatedListings {
  listings: Listing[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
