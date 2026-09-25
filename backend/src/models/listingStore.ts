import { randomUUID } from 'node:crypto'
import { getPool, type PgPoolLike } from '../db.js'
import {
  Listing,
  ListingSearchResult,
  ListingStatus,
  CreateListingInput,
  ListingFilters,
  PaginatedListings,
} from './listing.js'

interface ListingStorePort {
  create(input: CreateListingInput): Promise<Listing>
  getById(listingId: string): Promise<Listing | null>
  list(filters?: ListingFilters): Promise<PaginatedListings>
  search(filters?: ListingFilters): Promise<PaginatedListings>
  suggest(query: string): Promise<string[]>
  updateStatus(listingId: string, status: ListingStatus, rejectionReason?: string): Promise<Listing | null>
  lockToDeal(listingId: string, dealId: string): Promise<Listing | null>
  tryLockToDeal(listingId: string, dealId: string): Promise<{ listing: Listing | null; error?: string }>
  hasReachedMonthlyLimit(whistleblowerId: string): Promise<boolean>
  getMonthlyReportCount(whistleblowerId: string): Promise<number>
  moderate(
    listingId: string,
    status: ListingStatus.APPROVED | ListingStatus.REJECTED,
    reviewedBy: string,
    rejectionReason?: string,
  ): Promise<Listing | null>
  updateTrustScore(listingId: string, trustScore: number, hasVerifiedInspection: boolean): Promise<Listing | null>
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
      outrightPriceNgn: input.outrightPriceNgn,
      installmentBasePriceNgn: input.installmentBasePriceNgn,
      negotiatedLandlordRateNgn: input.negotiatedLandlordRateNgn,
      description: input.description,
      photos: input.photos,
      status: ListingStatus.PENDING_REVIEW,
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
    return this.search(filters)
  }

  async search(filters: ListingFilters = {}): Promise<PaginatedListings> {
    const { status, query, q, page = 1, pageSize = 20 } = filters
    const searchQuery = q ?? query
    let filtered = Array.from(this.listings.values())

    if (status) {
      filtered = filtered.filter((l) => l.status === status)
    }

    if (searchQuery && searchQuery.trim()) {
      const searchTerm = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (l) =>
          l.address.toLowerCase().includes(searchTerm) ||
          l.city?.toLowerCase().includes(searchTerm) ||
          l.area?.toLowerCase().includes(searchTerm) ||
          l.description?.toLowerCase().includes(searchTerm),
      )
    }

    if (filters.minPrice != null) {
      filtered = filtered.filter((l) => (l.installmentBasePriceNgn ?? l.annualRentNgn) >= filters.minPrice!)
    }
    if (filters.maxPrice != null) {
      filtered = filtered.filter((l) => (l.installmentBasePriceNgn ?? l.annualRentNgn) <= filters.maxPrice!)
    }
    if (filters.bedrooms != null) {
      filtered = filtered.filter((l) => l.bedrooms === filters.bedrooms)
    }
    if (filters.lga && filters.lga.trim()) {
      const lga = filters.lga.toLowerCase()
      filtered = filtered.filter((l) => l.area?.toLowerCase() === lga)
    }
    if (filters.paymentPlan && filters.paymentPlan !== 'outright') {
      filtered = filtered.filter((l) => l.installmentBasePriceNgn != null)
    }

    filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    const total = filtered.length
    const totalPages = Math.ceil(total / pageSize)
    const start = (page - 1) * pageSize
    const end = start + pageSize
    const listings = filtered.slice(start, end)

    return {
      listings: listings.map((listing) => ({
        ...listing,
        highlightedSnippet: listing.description ?? listing.address,
        rank: 0,
      })),
      total,
      page,
      pageSize,
      totalPages,
    }
  }

  async suggest(query: string): Promise<string[]> {
    const searchTerm = query.trim().toLowerCase()
    const suggestions = new Set<string>()

    for (const listing of this.listings.values()) {
      for (const candidate of [listing.address, listing.area, listing.city]) {
        if (candidate?.toLowerCase().includes(searchTerm)) {
          suggestions.add(candidate)
        }
      }
      if (suggestions.size >= 5) break
    }

    return Array.from(suggestions).slice(0, 5)
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

  async tryLockToDeal(listingId: string, dealId: string): Promise<{ listing: Listing | null; error?: string }> {
    const listing = this.listings.get(listingId)
    if (!listing) {
      return { listing: null, error: 'Listing not found' }
    }

    if (listing.status === ListingStatus.RENTED) {
      return { listing: null, error: 'Listing already rented' }
    }

    if (listing.dealId) {
      return { listing: null, error: `Listing already linked to deal ${listing.dealId}` }
    }

    if (listing.status !== ListingStatus.APPROVED) {
      return { listing: null, error: `Listing must be approved to create a deal. Current status: ${listing.status}` }
    }

    listing.status = ListingStatus.RENTED
    listing.dealId = dealId
    listing.updatedAt = new Date()
    this.listings.set(listingId, listing)
    return { listing }
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

  async updateTrustScore(listingId: string, trustScore: number, hasVerifiedInspection: boolean): Promise<Listing | null> {
    const listing = this.listings.get(listingId)
    if (!listing) return null

    listing.trustScore = trustScore
    listing.hasVerifiedInspection = hasVerifiedInspection
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
  outright_price_ngn: string | number | null
  installment_base_price_ngn: string | number | null
  negotiated_landlord_rate_ngn: string | number | null
  description: string | null
  photos: unknown
  status: ListingStatus
  reviewed_by: string | null
  reviewed_at: Date | null
  rejection_reason: string | null
  deal_id: string | null
  trust_score: number | null
  has_verified_inspection: boolean | null
  created_at: Date
  updated_at: Date
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
        outright_price_ngn,
        installment_base_price_ngn,
        negotiated_landlord_rate_ngn,
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
        input.outrightPriceNgn ?? null,
        input.installmentBasePriceNgn ?? null,
        input.negotiatedLandlordRateNgn ?? null,
        input.description ?? null,
        JSON.stringify(input.photos),
      ],
    )

    return this.mapRow(rows[0] as ListingRow)
  }

  async getById(listingId: string): Promise<Listing | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      'SELECT * FROM whistleblower_listings WHERE listing_id = $1 AND deleted_at IS NULL',
      [listingId],
    )

    if (rows.length === 0) return null
    return this.mapRow(rows[0] as ListingRow)
  }

  async list(filters: ListingFilters = {}): Promise<PaginatedListings> {
    return this.search(filters)
  }

  async search(filters: ListingFilters = {}): Promise<PaginatedListings> {
    const pool = await this.pool()
    const where: string[] = ['deleted_at IS NULL']
    const values: unknown[] = []
    let rankExpression = '0::real'
    let headlineExpression = `COALESCE(description, address)`

    if (filters.status) {
      values.push(filters.status)
      where.push(`status = $${values.length}`)
    }

    const freeText = (filters.q ?? filters.query)?.trim()
    if (freeText) {
      values.push(freeText)
      const idx = values.length
      where.push(`search_vector @@ plainto_tsquery('english', $${idx})`)
      rankExpression = `ts_rank(search_vector, plainto_tsquery('english', $${idx}))`
      headlineExpression = `ts_headline(
        'english',
        COALESCE(description, address),
        plainto_tsquery('english', $${idx}),
        'StartSel=<mark>, StopSel=</mark>, MaxWords=24, MinWords=8'
      )`
    }

    if (filters.minPrice != null) {
      values.push(filters.minPrice)
      where.push(`COALESCE(installment_base_price_ngn, annual_rent_ngn) >= $${values.length}`)
    }

    if (filters.maxPrice != null) {
      values.push(filters.maxPrice)
      where.push(`COALESCE(installment_base_price_ngn, annual_rent_ngn) <= $${values.length}`)
    }

    if (filters.bedrooms != null) {
      values.push(filters.bedrooms)
      where.push(`bedrooms = $${values.length}`)
    }

    if (filters.lga && filters.lga.trim()) {
      values.push(filters.lga.trim())
      where.push(`LOWER(COALESCE(area, '')) = LOWER($${values.length})`)
    }

    if (filters.paymentPlan && filters.paymentPlan !== 'outright') {
      where.push('installment_base_price_ngn IS NOT NULL')
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const page = filters.page && filters.page > 0 ? filters.page : 1
    const pageSize = filters.pageSize && filters.pageSize > 0 ? filters.pageSize : 20
    const offset = (page - 1) * pageSize

    const countResult = await pool.query(
      `SELECT COUNT(*) AS count FROM whistleblower_listings ${whereClause}`,
      values,
    )

    const queryValues = [...values, pageSize, offset]
    const listingRows = await pool.query(
      `SELECT *, ${rankExpression} AS search_rank, ${headlineExpression} AS highlighted_snippet
       FROM whistleblower_listings ${whereClause}
       ORDER BY search_rank DESC, created_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      queryValues,
    )

    const total = Number((countResult.rows[0] as { count: string }).count)
    const listings = listingRows.rows.map((row) => this.mapSearchRow(row as ListingRow & {
      highlighted_snippet: string | null
      search_rank: string | number | null
    }))

    return {
      listings,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    }
  }

  async suggest(query: string): Promise<string[]> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `SELECT suggestion
       FROM (
         SELECT address AS suggestion, created_at FROM whistleblower_listings
         WHERE status = $1 AND deleted_at IS NULL AND address ILIKE $2
         UNION ALL
         SELECT area AS suggestion, created_at FROM whistleblower_listings
         WHERE status = $1 AND deleted_at IS NULL AND area ILIKE $2
         UNION ALL
         SELECT city AS suggestion, created_at FROM whistleblower_listings
         WHERE status = $1 AND deleted_at IS NULL AND city ILIKE $2
       ) suggestions
       WHERE suggestion IS NOT NULL
       GROUP BY suggestion
       ORDER BY MAX(created_at) DESC
       LIMIT 5`,
      [ListingStatus.APPROVED, `%${query.trim()}%`],
    )

    return rows.map((row) => (row as { suggestion: string }).suggestion)
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

  async tryLockToDeal(listingId: string, dealId: string): Promise<{ listing: Listing | null; error?: string }> {
    const pool = await this.pool()
    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      const { rows } = await client.query(
        `SELECT * FROM whistleblower_listings
         WHERE listing_id = $1 AND deleted_at IS NULL
         FOR UPDATE`,
        [listingId],
      )

      if (rows.length === 0) {
        await client.query('ROLLBACK')
        return { listing: null, error: 'Listing not found' }
      }

      const row = rows[0] as ListingRow

      if (row.status === ListingStatus.RENTED) {
        await client.query('ROLLBACK')
        return { listing: null, error: 'Listing already rented' }
      }

      if (row.deal_id) {
        await client.query('ROLLBACK')
        return { listing: null, error: `Listing already linked to deal ${row.deal_id}` }
      }

      if (row.status !== ListingStatus.APPROVED) {
        await client.query('ROLLBACK')
        return { listing: null, error: `Listing must be approved to create a deal. Current status: ${row.status}` }
      }

      const { rows: updateRows } = await client.query(
        `UPDATE whistleblower_listings
         SET status = $2,
             deal_id = $3,
             updated_at = NOW()
         WHERE listing_id = $1
         RETURNING *`,
        [listingId, ListingStatus.RENTED, dealId],
      )

      await client.query('COMMIT')

      if (updateRows.length === 0) {
        return { listing: null, error: 'Listing not found' }
      }

      return { listing: this.mapRow(updateRows[0] as ListingRow) }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
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

  async updateTrustScore(listingId: string, trustScore: number, hasVerifiedInspection: boolean): Promise<Listing | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `UPDATE whistleblower_listings
       SET trust_score = $2,
           has_verified_inspection = $3,
           updated_at = NOW()
       WHERE listing_id = $1
       RETURNING *`,
      [listingId, trustScore, hasVerifiedInspection],
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
      outrightPriceNgn: row.outright_price_ngn != null ? toNumber(row.outright_price_ngn) : undefined,
      installmentBasePriceNgn: row.installment_base_price_ngn != null ? toNumber(row.installment_base_price_ngn) : undefined,
      negotiatedLandlordRateNgn: row.negotiated_landlord_rate_ngn != null ? toNumber(row.negotiated_landlord_rate_ngn) : undefined,
      description: row.description ?? undefined,
      photos,
      status: row.status,
      reviewedBy: row.reviewed_by ?? undefined,
      reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : undefined,
      rejectionReason: row.rejection_reason ?? undefined,
      dealId: row.deal_id ?? undefined,
      trustScore: row.trust_score ?? undefined,
      hasVerifiedInspection: row.has_verified_inspection ?? undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }
  }

  private mapSearchRow(row: ListingRow & {
    highlighted_snippet: string | null
    search_rank: string | number | null
  }): ListingSearchResult {
    return {
      ...this.mapRow(row),
      highlightedSnippet: row.highlighted_snippet ?? row.description ?? row.address,
      rank: row.search_rank == null ? 0 : toNumber(row.search_rank),
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

  async search(filters: ListingFilters = {}): Promise<PaginatedListings> {
    const adapter = await this.adapter()
    return adapter.search(filters)
  }

  async suggest(query: string): Promise<string[]> {
    const adapter = await this.adapter()
    return adapter.suggest(query)
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

  async tryLockToDeal(listingId: string, dealId: string): Promise<{ listing: Listing | null; error?: string }> {
    const adapter = await this.adapter()
    return adapter.tryLockToDeal(listingId, dealId)
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

  async updateTrustScore(listingId: string, trustScore: number, hasVerifiedInspection: boolean): Promise<Listing | null> {
    const adapter = await this.adapter()
    return adapter.updateTrustScore(listingId, trustScore, hasVerifiedInspection)
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
