import { randomUUID } from 'node:crypto'
import { getPool, type PgPoolLike } from '../db.js'
import {
  Listing,
  ListingStatus,
  CreateListingInput,
  ListingFilters,
  PaginatedListings,
} from './listing.js'

interface ListingStorePort {
  create(input: CreateListingInput): Promise<Listing>
  getById(listingId: string): Promise<Listing | null>
  list(filters?: ListingFilters): Promise<PaginatedListings>
  updateStatus(listingId: string, status: ListingStatus, rejectionReason?: string): Promise<Listing | null>
  lockToDeal(listingId: string, dealId: string): Promise<Listing | null>
  hasReachedMonthlyLimit(whistleblowerId: string): Promise<boolean>
  getMonthlyReportCount(whistleblowerId: string): Promise<number>
  moderate(
    listingId: string,
    status: ListingStatus.APPROVED | ListingStatus.REJECTED,
    reviewedBy: string,
    rejectionReason?: string,
  ): Promise<Listing | null>
  markVerifiedInspection(listingId: string): Promise<Listing | null>
  clear(): Promise<void>
}

class InMemoryListingStore implements ListingStorePort {
  private listings = new Map<string, Listing>()
  private whistleblowerMonthlyReports = new Map<string, Date[]>()

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
      negotiatedLandlordRateNgn: input.negotiatedLandlordRateNgn,
      outrightPriceNgn: input.outrightPriceNgn,
      installmentBasePriceNgn: input.installmentBasePriceNgn,
      description: input.description,
      photos: input.photos,
      status: ListingStatus.PENDING_REVIEW,
      hasVerifiedInspection: false,
      trustScore: 0,
      createdAt: now,
      updatedAt: now,
    }

    this.listings.set(listing.listingId, listing)
    this.trackReport(input.whistleblowerId, now)
    return listing
  }

  async getById(listingId: string): Promise<Listing | null> {
    return this.listings.get(listingId) ?? null
  }

  async list(filters: ListingFilters = {}): Promise<PaginatedListings> {
    const { status, query, city, area, minBedrooms, maxBedrooms, minBathrooms, maxBathrooms, minAnnualRent, maxAnnualRent, sortBy, page = 1, pageSize = 20 } = filters
    let filtered = Array.from(this.listings.values())

    if (status) {
      filtered = filtered.filter((l) => l.status === status)
    }

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

    if (city) {
      filtered = filtered.filter((l) => l.city?.toLowerCase() === city.toLowerCase())
    }

    if (area) {
      filtered = filtered.filter((l) => l.area?.toLowerCase().includes(area.toLowerCase()))
    }

    if (minBedrooms !== undefined) {
      filtered = filtered.filter((l) => l.bedrooms >= minBedrooms)
    }

    if (maxBedrooms !== undefined) {
      filtered = filtered.filter((l) => l.bedrooms <= maxBedrooms)
    }

    if (minBathrooms !== undefined) {
      filtered = filtered.filter((l) => l.bathrooms >= minBathrooms)
    }

    if (maxBathrooms !== undefined) {
      filtered = filtered.filter((l) => l.bathrooms <= maxBathrooms)
    }

    if (minAnnualRent !== undefined) {
      filtered = filtered.filter((l) => l.annualRentNgn >= minAnnualRent)
    }

    if (maxAnnualRent !== undefined) {
      filtered = filtered.filter((l) => l.annualRentNgn <= maxAnnualRent)
    }

    // Sorting
    switch (sortBy) {
      case 'price_asc':
        filtered.sort((a, b) => a.annualRentNgn - b.annualRentNgn)
        break
      case 'price_desc':
        filtered.sort((a, b) => b.annualRentNgn - a.annualRentNgn)
        break
      case 'bedrooms_desc':
        filtered.sort((a, b) => b.bedrooms - a.bedrooms)
        break
      case 'newest':
      default:
        filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        break
    }

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

  async updateStatus(
    listingId: string,
    status: ListingStatus,
    rejectionReason?: string,
  ): Promise<Listing | null> {
    const listing = this.listings.get(listingId)
    if (!listing) return null

    listing.status = status
    listing.updatedAt = new Date()
    listing.rejectionReason = rejectionReason
    this.listings.set(listingId, listing)
    return listing
  }

  async lockToDeal(listingId: string, dealId: string): Promise<Listing | null> {
    const listing = this.listings.get(listingId)
    if (!listing) return null

    listing.status = ListingStatus.RENTED
    listing.dealId = dealId
    listing.updatedAt = new Date()
    this.listings.set(listingId, listing)
    return listing
  }

  async hasReachedMonthlyLimit(whistleblowerId: string): Promise<boolean> {
    const reports = this.whistleblowerMonthlyReports.get(whistleblowerId) || []
    const now = new Date()
    const currentMonth = now.getMonth()
    const currentYear = now.getFullYear()

    const reportsThisMonth = reports.filter(
      (date) => date.getMonth() === currentMonth && date.getFullYear() === currentYear,
    )

    return reportsThisMonth.length >= 2
  }

  async getMonthlyReportCount(whistleblowerId: string): Promise<number> {
    const reports = this.whistleblowerMonthlyReports.get(whistleblowerId) || []
    const now = new Date()
    const currentMonth = now.getMonth()
    const currentYear = now.getFullYear()

    return reports.filter(
      (date) => date.getMonth() === currentMonth && date.getFullYear() === currentYear,
    ).length
  }

  private trackReport(whistleblowerId: string, date: Date): void {
    const reports = this.whistleblowerMonthlyReports.get(whistleblowerId) || []
    reports.push(date)
    this.whistleblowerMonthlyReports.set(whistleblowerId, reports)
  }

  async moderate(
    listingId: string,
    status: ListingStatus.APPROVED | ListingStatus.REJECTED,
    reviewedBy: string,
    rejectionReason?: string,
  ): Promise<Listing | null> {
    const listing = this.listings.get(listingId)
    if (!listing) return null

    const now = new Date()
    listing.status = status
    listing.reviewedBy = reviewedBy
    listing.reviewedAt = now
    listing.updatedAt = now
    listing.rejectionReason = rejectionReason
    this.listings.set(listingId, listing)
    return listing
  }

  async markVerifiedInspection(listingId: string): Promise<Listing | null> {
    const listing = this.listings.get(listingId)
    if (!listing) return null
    listing.hasVerifiedInspection = true
    listing.trustScore = Math.max(listing.trustScore ?? 0, 25) + 10
    listing.updatedAt = new Date()
    this.listings.set(listingId, listing)
    return listing
  }

  async clear(): Promise<void> {
    this.listings.clear()
    this.whistleblowerMonthlyReports.clear()
  }
}

type ListingRow = {
  listing_id: string
  whistleblower_id: string
  address: string
  city: string | null
  area: string | null
  bedrooms: number
  bathrooms: number
  annual_rent_ngn: string | number
  negotiated_landlord_rate_ngn: string | number | null
  outright_price_ngn: string | number | null
  installment_base_price_ngn: string | number | null
  description: string | null
  photos: unknown
  status: ListingStatus
  reviewed_by: string | null
  reviewed_at: Date | null
  rejection_reason: string | null
  deal_id: string | null
  created_at: Date
  updated_at: Date
  has_verified_inspection?: boolean | null
  trust_score?: string | number | null
}

class PostgresListingStore implements ListingStorePort {
  private async pool(): Promise<PgPoolLike> {
    const pool = await getPool()
    if (!pool) {
      throw new Error('Database pool is not available (DATABASE_URL/pg not configured)')
    }
    return pool
  }

  async isAvailable(): Promise<boolean> {
    return (await getPool()) !== null
  }

  async create(input: CreateListingInput): Promise<Listing> {
    const pool = await this.pool()
    const listingId = randomUUID()
    const { rows } = await pool.query(
      `INSERT INTO whistleblower_listings (
        listing_id,
        whistleblower_id,
        address,
        city,
        area,
        bedrooms,
        bathrooms,
        annual_rent_ngn,
        negotiated_landlord_rate_ngn,
        outright_price_ngn,
        installment_base_price_ngn,
        description,
        photos
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
      RETURNING *`,
      [
        listingId,
        input.whistleblowerId,
        input.address,
        input.city ?? null,
        input.area ?? null,
        input.bedrooms,
        input.bathrooms,
        input.annualRentNgn,
        input.negotiatedLandlordRateNgn ?? null,
        input.outrightPriceNgn ?? null,
        input.installmentBasePriceNgn ?? null,
        input.description ?? null,
        JSON.stringify(input.photos),
      ],
    )

    return this.mapRow(rows[0] as ListingRow)
  }

  async getById(listingId: string): Promise<Listing | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      'SELECT * FROM whistleblower_listings WHERE listing_id = $1',
      [listingId],
    )

    if (rows.length === 0) return null
    return this.mapRow(rows[0] as ListingRow)
  }

  async list(filters: ListingFilters = {}): Promise<PaginatedListings> {
    const pool = await this.pool()
    const where: string[] = []
    const values: unknown[] = []

    if (filters.status) {
      values.push(filters.status)
      where.push(`status = $${values.length}`)
    }

    if (filters.query && filters.query.trim()) {
      values.push(`%${filters.query.trim()}%`)
      const idx = values.length
      where.push(`(
        address ILIKE $${idx} OR
        COALESCE(city, '') ILIKE $${idx} OR
        COALESCE(area, '') ILIKE $${idx} OR
        COALESCE(description, '') ILIKE $${idx}
      )`)
    }

    if (filters.city) {
      values.push(filters.city)
      where.push(`LOWER(city) = LOWER($${values.length})`)
    }

    if (filters.area) {
      values.push(`%${filters.area}%`)
      where.push(`LOWER(area) ILIKE LOWER($${values.length})`)
    }

    if (filters.minBedrooms !== undefined) {
      values.push(filters.minBedrooms)
      where.push(`bedrooms >= $${values.length}`)
    }

    if (filters.maxBedrooms !== undefined) {
      values.push(filters.maxBedrooms)
      where.push(`bedrooms <= $${values.length}`)
    }

    if (filters.minBathrooms !== undefined) {
      values.push(filters.minBathrooms)
      where.push(`bathrooms >= $${values.length}`)
    }

    if (filters.maxBathrooms !== undefined) {
      values.push(filters.maxBathrooms)
      where.push(`bathrooms <= $${values.length}`)
    }

    if (filters.minAnnualRent !== undefined) {
      values.push(filters.minAnnualRent)
      where.push(`annual_rent_ngn >= $${values.length}`)
    }

    if (filters.maxAnnualRent !== undefined) {
      values.push(filters.maxAnnualRent)
      where.push(`annual_rent_ngn <= $${values.length}`)
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const page = filters.page && filters.page > 0 ? filters.page : 1
    const pageSize = filters.pageSize && filters.pageSize > 0 ? filters.pageSize : 20
    const offset = (page - 1) * pageSize

    // Sorting
    let orderBy = 'ORDER BY created_at DESC'
    switch (filters.sortBy) {
      case 'price_asc':
        orderBy = 'ORDER BY annual_rent_ngn ASC'
        break
      case 'price_desc':
        orderBy = 'ORDER BY annual_rent_ngn DESC'
        break
      case 'bedrooms_desc':
        orderBy = 'ORDER BY bedrooms DESC'
        break
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) AS count FROM whistleblower_listings ${whereClause}`,
      values,
    )

    const queryValues = [...values, pageSize, offset]
    const listingRows = await pool.query(
      `SELECT * FROM whistleblower_listings ${whereClause}
       ${orderBy}
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      queryValues,
    )

    const total = Number((countResult.rows[0] as { count: string }).count)
    const listings = listingRows.rows.map((row) => this.mapRow(row as ListingRow))

    return {
      listings,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    }
  }

  async updateStatus(
    listingId: string,
    status: ListingStatus,
    rejectionReason?: string,
  ): Promise<Listing | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `UPDATE whistleblower_listings
       SET status = $2,
           rejection_reason = $3,
           updated_at = NOW()
       WHERE listing_id = $1
       RETURNING *`,
      [listingId, status, rejectionReason ?? null],
    )

    if (rows.length === 0) return null
    return this.mapRow(rows[0] as ListingRow)
  }

  async lockToDeal(listingId: string, dealId: string): Promise<Listing | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `UPDATE whistleblower_listings
       SET status = $2,
           deal_id = $3,
           updated_at = NOW()
       WHERE listing_id = $1
       RETURNING *`,
      [listingId, ListingStatus.RENTED, dealId],
    )

    if (rows.length === 0) return null
    return this.mapRow(rows[0] as ListingRow)
  }

  async hasReachedMonthlyLimit(whistleblowerId: string): Promise<boolean> {
    const count = await this.getMonthlyReportCount(whistleblowerId)
    return count >= 2
  }

  async getMonthlyReportCount(whistleblowerId: string): Promise<number> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS count
       FROM whistleblower_listings
       WHERE whistleblower_id = $1
         AND date_trunc('month', created_at) = date_trunc('month', NOW())`,
      [whistleblowerId],
    )

    return Number((rows[0] as { count: string }).count)
  }

  async moderate(
    listingId: string,
    status: ListingStatus.APPROVED | ListingStatus.REJECTED,
    reviewedBy: string,
    rejectionReason?: string,
  ): Promise<Listing | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `UPDATE whistleblower_listings
       SET status = $2,
           reviewed_by = $3,
           reviewed_at = NOW(),
           rejection_reason = $4,
           updated_at = NOW()
       WHERE listing_id = $1
       RETURNING *`,
      [listingId, status, reviewedBy, rejectionReason ?? null],
    )

    if (rows.length === 0) return null
    return this.mapRow(rows[0] as ListingRow)
  }

  async markVerifiedInspection(listingId: string): Promise<Listing | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `UPDATE whistleblower_listings
       SET has_verified_inspection = TRUE,
           trust_score = GREATEST(COALESCE(trust_score, 0), 25) + 10,
           updated_at = NOW()
       WHERE listing_id = $1
       RETURNING *`,
      [listingId],
    )
    if (rows.length === 0) return null
    return this.mapRow(rows[0] as ListingRow)
  }

  async clear(): Promise<void> {
    const pool = await this.pool()
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('listingStore.clear() is only supported in test env when using Postgres')
    }
    await pool.query('TRUNCATE whistleblower_listings RESTART IDENTITY CASCADE')
  }

  private mapRow(row: ListingRow): Listing {
    const photosValue = row.photos
    const photos = Array.isArray(photosValue)
      ? (photosValue as string[])
      : typeof photosValue === 'string'
        ? (JSON.parse(photosValue) as string[])
        : []

    return {
      listingId: row.listing_id,
      whistleblowerId: row.whistleblower_id,
      address: row.address,
      city: row.city ?? undefined,
      area: row.area ?? undefined,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      annualRentNgn: toNumber(row.annual_rent_ngn),
      negotiatedLandlordRateNgn: row.negotiated_landlord_rate_ngn != null ? toNumber(row.negotiated_landlord_rate_ngn) : undefined,
      outrightPriceNgn: row.outright_price_ngn != null ? toNumber(row.outright_price_ngn) : undefined,
      installmentBasePriceNgn: row.installment_base_price_ngn != null ? toNumber(row.installment_base_price_ngn) : undefined,
      description: row.description ?? undefined,
      photos,
      status: row.status,
      reviewedBy: row.reviewed_by ?? undefined,
      reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : undefined,
      rejectionReason: row.rejection_reason ?? undefined,
      dealId: row.deal_id ?? undefined,
      hasVerifiedInspection: Boolean(row.has_verified_inspection),
      trustScore: row.trust_score != null ? toNumber(row.trust_score) : 0,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }
  }
}

class HybridListingStore implements ListingStorePort {
  private memory = new InMemoryListingStore()
  private postgres = new PostgresListingStore()

  private async adapter(): Promise<ListingStorePort> {
    if (await this.postgres.isAvailable()) {
      return this.postgres
    }
    return this.memory
  }

  async create(input: CreateListingInput): Promise<Listing> {
    const adapter = await this.adapter()
    return adapter.create(input)
  }

  async getById(listingId: string): Promise<Listing | null> {
    const adapter = await this.adapter()
    return adapter.getById(listingId)
  }

  async list(filters: ListingFilters = {}): Promise<PaginatedListings> {
    const adapter = await this.adapter()
    return adapter.list(filters)
  }

  async updateStatus(
    listingId: string,
    status: ListingStatus,
    rejectionReason?: string,
  ): Promise<Listing | null> {
    const adapter = await this.adapter()
    return adapter.updateStatus(listingId, status, rejectionReason)
  }

  async lockToDeal(listingId: string, dealId: string): Promise<Listing | null> {
    const adapter = await this.adapter()
    return adapter.lockToDeal(listingId, dealId)
  }

  async hasReachedMonthlyLimit(whistleblowerId: string): Promise<boolean> {
    const adapter = await this.adapter()
    return adapter.hasReachedMonthlyLimit(whistleblowerId)
  }

  async getMonthlyReportCount(whistleblowerId: string): Promise<number> {
    const adapter = await this.adapter()
    return adapter.getMonthlyReportCount(whistleblowerId)
  }

  async moderate(
    listingId: string,
    status: ListingStatus.APPROVED | ListingStatus.REJECTED,
    reviewedBy: string,
    rejectionReason?: string,
  ): Promise<Listing | null> {
    const adapter = await this.adapter()
    return adapter.moderate(listingId, status, reviewedBy, rejectionReason)
  }

  async markVerifiedInspection(listingId: string): Promise<Listing | null> {
    const adapter = await this.adapter()
    return adapter.markVerifiedInspection(listingId)
  }

  async clear(): Promise<void> {
    const adapter = await this.adapter()
    return adapter.clear()
  }
}

function toNumber(value: string | number): number {
  return typeof value === 'number' ? value : Number(value)
}

export const listingStore = new HybridListingStore()
