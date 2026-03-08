import { randomUUID } from 'node:crypto'
import {
  Listing,
  ListingStatus,
  CreateListingInput,
  ListingFilters,
  PaginatedListings,
} from './listing.js'

/**
 * In-memory listing store
 * MVP implementation - designed for easy database migration
 */
class ListingStore {
  private listings = new Map<string, Listing>()
  private whistleblowerMonthlyReports = new Map<string, Date[]>() // whistleblowerId -> report dates

  /**
   * Create a new listing
   */
  async create(input: CreateListingInput): Promise<Listing> {
    const now = new Date()
    const listing: Listing = {
      listingId: randomUUID(),
      whistleblowerId: input.whistleblowerId,
      address: input.address,
      city: input.city,
      area: input.area,
      bedrooms: input.bedrooms,
      bathrooms: input.bathrooms,
      annualRentNgn: input.annualRentNgn,
      description: input.description,
      photos: input.photos,
      status: ListingStatus.PENDING_REVIEW,
      createdAt: now,
      updatedAt: now,
    }

    this.listings.set(listing.listingId, listing)
    
    // Track report for monthly limit
    this.trackReport(input.whistleblowerId, now)

    return listing
  }

  /**
   * Get listing by ID
   */
  async getById(listingId: string): Promise<Listing | null> {
    return this.listings.get(listingId) ?? null
  }

  /**
   * List listings with filters and pagination
   */
  async list(filters: ListingFilters): Promise<PaginatedListings> {
    const { status, query, page = 1, pageSize = 20 } = filters

    let filtered = Array.from(this.listings.values())

    // Filter by status
    if (status) {
      filtered = filtered.filter((l) => l.status === status)
    }

    // Filter by query (search in address, city, area, description)
    if (query && query.trim()) {
      const searchTerm = query.toLowerCase()
      filtered = filtered.filter(
        (l) =>
          l.address.toLowerCase().includes(searchTerm) ||
          l.city?.toLowerCase().includes(searchTerm) ||
          l.area?.toLowerCase().includes(searchTerm) ||
          l.description?.toLowerCase().includes(searchTerm),
      )
    }

    // Sort by createdAt descending (newest first)
    filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    // Pagination
    const total = filtered.length
    const totalPages = Math.ceil(total / pageSize)
    const start = (page - 1) * pageSize
    const end = start + pageSize
    const listings = filtered.slice(start, end)

    return {
      listings,
      total,
      page,
      pageSize,
      totalPages,
    }
  }

  /**
   * Update listing status
   */
  async updateStatus(
    listingId: string,
    status: ListingStatus,
    rejectionReason?: string,
  ): Promise<Listing | null> {
    const listing = this.listings.get(listingId)
    if (!listing) return null

    listing.status = status
    listing.updatedAt = new Date()
    
    if (rejectionReason) {
      listing.rejectionReason = rejectionReason
    }

    this.listings.set(listingId, listing)
    return listing
  }

  /**
   * Lock listing to a deal
   * Updates listing status to RENTED and sets dealId
   */
  async lockToDeal(listingId: string, dealId: string): Promise<Listing | null> {
    const listing = this.listings.get(listingId)
    if (!listing) return null

    listing.status = ListingStatus.RENTED
    listing.dealId = dealId
    listing.updatedAt = new Date()

    this.listings.set(listingId, listing)
    return listing
  }

  /**
   * Check if whistleblower has reached monthly report limit
   */
  async hasReachedMonthlyLimit(whistleblowerId: string): Promise<boolean> {
    const reports = this.whistleblowerMonthlyReports.get(whistleblowerId) || []
    const now = new Date()
    const currentMonth = now.getMonth()
    const currentYear = now.getFullYear()

    // Count reports in current month
    const reportsThisMonth = reports.filter((date) => {
      return date.getMonth() === currentMonth && date.getFullYear() === currentYear
    })

    return reportsThisMonth.length >= 2
  }

  /**
   * Get report count for current month
   */
  async getMonthlyReportCount(whistleblowerId: string): Promise<number> {
    const reports = this.whistleblowerMonthlyReports.get(whistleblowerId) || []
    const now = new Date()
    const currentMonth = now.getMonth()
    const currentYear = now.getFullYear()

    return reports.filter((date) => {
      return date.getMonth() === currentMonth && date.getFullYear() === currentYear
    }).length
  }

  /**
   * Track a report for monthly limit enforcement
   */
  private trackReport(whistleblowerId: string, date: Date): void {
    const reports = this.whistleblowerMonthlyReports.get(whistleblowerId) || []
    reports.push(date)
    this.whistleblowerMonthlyReports.set(whistleblowerId, reports)
  }

  /**
   * Clear all data (for testing)
   */
  async clear(): Promise<void> {
    this.listings.clear()
    this.whistleblowerMonthlyReports.clear()
  }
}

// Singleton instance
export const listingStore = new ListingStore()
