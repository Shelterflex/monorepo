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
  negotiatedLandlordRateNgn?: number
  outrightPriceNgn?: number
  installmentBasePriceNgn?: number
  description?: string
  photos: string[]
  status: ListingStatus
  reviewedBy?: string
  reviewedAt?: Date
  rejectionReason?: string
  dealId?: string
  hasVerifiedInspection?: boolean
  trustScore?: number
  createdAt: Date
  updatedAt: Date
}

export interface CreateListingInput {
  whistleblowerId: string
  address: string
  city?: string
  area?: string
  bedrooms: number
  bathrooms: number
  annualRentNgn: number
  negotiatedLandlordRateNgn?: number
  outrightPriceNgn?: number
  installmentBasePriceNgn?: number
  description?: string
  photos: string[]
}

export interface ListingFilters {
  status?: ListingStatus
  query?: string
  city?: string
  area?: string
  minBedrooms?: number
  maxBedrooms?: number
  minBathrooms?: number
  maxBathrooms?: number
  minAnnualRent?: number
  maxAnnualRent?: number
  sortBy?: 'price_asc' | 'price_desc' | 'newest' | 'bedrooms_desc'
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
