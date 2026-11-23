/**
 * Apartment review store (#2050), backed by `apartment_reviews` and
 * `apartment_review_reports` (migrations 020, 20261019210514 and 20261123090000).
 *
 * Reads never return hidden reviews. The store picks PostgreSQL when DATABASE_URL
 * is set and the in-memory store otherwise, the same way savedPropertyStore does.
 */

import { randomUUID } from 'node:crypto'
import { getPool } from '../db.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import type {
  ApartmentReview,
  ApartmentReviewPage,
  ApartmentReviewSort,
  PublicApartmentReview,
} from '../schemas/apartmentReview.js'

export interface CreateApartmentReviewInput {
  listingId: string
  userId: string
  rating: number
  text: string
  verifiedStay: boolean
}

export interface ApartmentReviewListFilter {
  listingId?: string
  sort: ApartmentReviewSort
  page: number
  pageSize: number
}

export interface ApartmentReviewReportResult {
  review: ApartmentReview
  /** False when this reporter had already reported the review. */
  created: boolean
}

export interface ApartmentReviewStore {
  /** Throws a 409 AppError when the user has already reviewed this listing. */
  create(input: CreateApartmentReviewInput): Promise<ApartmentReview>
  findById(id: string): Promise<ApartmentReview | null>
  listVisible(filter: ApartmentReviewListFilter): Promise<ApartmentReviewPage>
  /** Counts one distinct report from `reporterId`. Returns null when the review does not exist. */
  recordReport(reviewId: string, reporterId: string, hideAtCount: number): Promise<ApartmentReviewReportResult | null>
  setHidden(id: string, isHidden: boolean): Promise<ApartmentReview | null>
}

export function toPublicReview(review: ApartmentReview): PublicApartmentReview {
  return {
    id: review.id,
    listingId: review.listingId,
    rating: review.rating,
    text: review.text,
    verifiedStay: review.verifiedStay,
    createdAt: review.createdAt,
  }
}

function buildPage(
  visible: ApartmentReview[],
  filter: ApartmentReviewListFilter,
): ApartmentReviewPage {
  const total = visible.length
  const start = (filter.page - 1) * filter.pageSize
  const sum = visible.reduce((acc, review) => acc + review.rating, 0)
  return {
    reviews: visible.slice(start, start + filter.pageSize).map(toPublicReview),
    total,
    page: filter.page,
    pageSize: filter.pageSize,
    totalPages: Math.ceil(total / filter.pageSize),
    averageRating: total > 0 ? Math.round((sum / total) * 10) / 10 : null,
  }
}

function compareReviews(sort: ApartmentReviewSort) {
  return (a: ApartmentReview, b: ApartmentReview): number => {
    const byDate = b.createdAt.getTime() - a.createdAt.getTime()
    if (sort === 'rating_desc') return b.rating - a.rating || byDate
    if (sort === 'rating_asc') return a.rating - b.rating || byDate
    return byDate
  }
}

/** In-memory implementation, used when DATABASE_URL is not set. */
export class InMemoryApartmentReviewStore implements ApartmentReviewStore {
  private reviews = new Map<string, ApartmentReview>()
  /** `${reviewId}:${reporterId}` for every distinct report. */
  private reports = new Set<string>()

  async create(input: CreateApartmentReviewInput): Promise<ApartmentReview> {
    const duplicate = [...this.reviews.values()].some(
      (r) => r.userId === input.userId && r.listingId === input.listingId,
    )
    if (duplicate) {
      throw new AppError(ErrorCode.CONFLICT, 409, 'You have already reviewed this listing')
    }
    const now = new Date()
    const review: ApartmentReview = {
      id: randomUUID(),
      listingId: input.listingId,
      userId: input.userId,
      rating: input.rating,
      text: input.text,
      verifiedStay: input.verifiedStay,
      isHidden: false,
      isReported: false,
      reportCount: 0,
      createdAt: now,
      updatedAt: now,
    }
    this.reviews.set(review.id, review)
    return review
  }

  async findById(id: string): Promise<ApartmentReview | null> {
    return this.reviews.get(id) ?? null
  }

  async listVisible(filter: ApartmentReviewListFilter): Promise<ApartmentReviewPage> {
    const visible = [...this.reviews.values()]
      .filter((r) => !r.isHidden)
      .filter((r) => !filter.listingId || r.listingId === filter.listingId)
      .sort(compareReviews(filter.sort))
    return buildPage(visible, filter)
  }

  async recordReport(
    reviewId: string,
    reporterId: string,
    hideAtCount: number,
  ): Promise<ApartmentReviewReportResult | null> {
    const review = this.reviews.get(reviewId)
    if (!review) return null

    const key = `${reviewId}:${reporterId}`
    if (this.reports.has(key)) {
      return { review, created: false }
    }
    this.reports.add(key)

    review.reportCount += 1
    review.isReported = true
    if (review.reportCount >= hideAtCount) review.isHidden = true
    review.updatedAt = new Date()
    return { review, created: true }
  }

  async setHidden(id: string, isHidden: boolean): Promise<ApartmentReview | null> {
    const review = this.reviews.get(id)
    if (!review) return null
    review.isHidden = isHidden
    review.updatedAt = new Date()
    return review
  }

  /** Test helper. */
  async clear(): Promise<void> {
    this.reviews.clear()
    this.reports.clear()
  }
}

const SELECT_REVIEW = `
  SELECT id, listing_id, user_id, rating, content, verified_stay, is_hidden,
         is_reported, report_count, created_at, updated_at
  FROM apartment_reviews`

function mapRow(row: Record<string, unknown>): ApartmentReview {
  return {
    id: String(row.id),
    listingId: String(row.listing_id),
    userId: String(row.user_id),
    rating: Number(row.rating),
    text: String(row.content),
    verifiedStay: Boolean(row.verified_stay),
    isHidden: Boolean(row.is_hidden),
    isReported: Boolean(row.is_reported),
    reportCount: Number(row.report_count),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }
}

/** PostgreSQL implementation. */
export class PostgresApartmentReviewStore implements ApartmentReviewStore {
  private async pool() {
    const pool = await getPool()
    if (!pool) throw new Error('Database pool not initialized')
    return pool
  }

  async create(input: CreateApartmentReviewInput): Promise<ApartmentReview> {
    const pool = await this.pool()
    try {
      const result = await pool.query(
        `INSERT INTO apartment_reviews (listing_id, user_id, rating, content, verified_stay)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, listing_id, user_id, rating, content, verified_stay, is_hidden,
                   is_reported, report_count, created_at, updated_at`,
        [input.listingId, input.userId, input.rating, input.text, input.verifiedStay],
      )
      return mapRow(result.rows[0])
    } catch (error) {
      // 23505 is the unique violation from apartment_reviews_one_per_user_listing_uidx.
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(ErrorCode.CONFLICT, 409, 'You have already reviewed this listing')
      }
      throw error
    }
  }

  async findById(id: string): Promise<ApartmentReview | null> {
    const pool = await this.pool()
    const result = await pool.query(`${SELECT_REVIEW} WHERE id = $1`, [id])
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null
  }

  async listVisible(filter: ApartmentReviewListFilter): Promise<ApartmentReviewPage> {
    const pool = await this.pool()
    const params: unknown[] = []
    const conditions = ['is_hidden = false']
    if (filter.listingId) {
      params.push(filter.listingId)
      conditions.push(`listing_id = $${params.length}`)
    }
    const where = conditions.join(' AND ')

    const orderBy =
      filter.sort === 'rating_desc'
        ? 'rating DESC, created_at DESC'
        : filter.sort === 'rating_asc'
          ? 'rating ASC, created_at DESC'
          : 'created_at DESC, id DESC'

    const stats = await pool.query(
      `SELECT COUNT(*)::int AS total, AVG(rating)::float8 AS average FROM apartment_reviews WHERE ${where}`,
      params,
    )
    const pageParams = [...params, filter.pageSize, (filter.page - 1) * filter.pageSize]
    const rows = await pool.query(
      `${SELECT_REVIEW} WHERE ${where} ORDER BY ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      pageParams,
    )

    const total = Number(stats.rows[0]?.total ?? 0)
    const average = stats.rows[0]?.average
    return {
      reviews: rows.rows.map((row: Record<string, unknown>) => toPublicReview(mapRow(row))),
      total,
      page: filter.page,
      pageSize: filter.pageSize,
      totalPages: Math.ceil(total / filter.pageSize),
      averageRating: average === null || average === undefined ? null : Math.round(Number(average) * 10) / 10,
    }
  }

  async recordReport(
    reviewId: string,
    reporterId: string,
    hideAtCount: number,
  ): Promise<ApartmentReviewReportResult | null> {
    const pool = await this.pool()
    const existing = await this.findById(reviewId)
    if (!existing) return null

    // The composite primary key makes the insert a no-op for a repeat report.
    const inserted = await pool.query(
      `INSERT INTO apartment_review_reports (review_id, reporter_id)
       VALUES ($1, $2)
       ON CONFLICT (review_id, reporter_id) DO NOTHING
       RETURNING review_id`,
      [reviewId, reporterId],
    )
    if (inserted.rows.length === 0) {
      return { review: existing, created: false }
    }

    const updated = await pool.query(
      `UPDATE apartment_reviews
       SET report_count = report_count + 1,
           is_reported = true,
           is_hidden = CASE WHEN report_count + 1 >= $2 THEN true ELSE is_hidden END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, listing_id, user_id, rating, content, verified_stay, is_hidden,
                 is_reported, report_count, created_at, updated_at`,
      [reviewId, hideAtCount],
    )
    return { review: mapRow(updated.rows[0]), created: true }
  }

  async setHidden(id: string, isHidden: boolean): Promise<ApartmentReview | null> {
    const pool = await this.pool()
    const result = await pool.query(
      `UPDATE apartment_reviews SET is_hidden = $2, updated_at = NOW() WHERE id = $1
       RETURNING id, listing_id, user_id, rating, content, verified_stay, is_hidden,
                 is_reported, report_count, created_at, updated_at`,
      [id, isHidden],
    )
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null
  }
}

class HybridApartmentReviewStore implements ApartmentReviewStore {
  private memory = new InMemoryApartmentReviewStore()
  private postgres = new PostgresApartmentReviewStore()

  private async adapter(): Promise<ApartmentReviewStore> {
    return (await getPool()) ? this.postgres : this.memory
  }

  async create(input: CreateApartmentReviewInput) {
    return (await this.adapter()).create(input)
  }

  async findById(id: string) {
    return (await this.adapter()).findById(id)
  }

  async listVisible(filter: ApartmentReviewListFilter) {
    return (await this.adapter()).listVisible(filter)
  }

  async recordReport(reviewId: string, reporterId: string, hideAtCount: number) {
    return (await this.adapter()).recordReport(reviewId, reporterId, hideAtCount)
  }

  async setHidden(id: string, isHidden: boolean) {
    return (await this.adapter()).setHidden(id, isHidden)
  }
}

export const apartmentReviewStore: ApartmentReviewStore = new HybridApartmentReviewStore()
