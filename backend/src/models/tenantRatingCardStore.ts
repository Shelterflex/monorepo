/**
 * Tenant rating card store (#2051), backed by `tenant_ratings` and
 * `rating_card_tokens` (migration 032).
 *
 * Share tokens are 256-bit random values. Revoking a link needs the caller to own
 * it. Unknown, expired and revoked tokens all come back as `null`, so the public
 * endpoint can answer each of them with the same 404.
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { getPool } from '../db.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import type {
  CreateTenantRatingRequest,
  PublicRatingCardResponse,
  TenantRating,
  TenantRatingCardResponse,
} from '../schemas/tenantRatingCard.js'

const RECENT_COMMENT_LIMIT = 5

export interface StoredRatingRow {
  landlordId: string
  paymentTimeliness: number
  propertyCare: number
  communication: number
  overall: number
  comment: string | null
  createdAt: Date
}

export interface CreatedShareToken {
  id: string
  token: string
  expiresAt: Date
}

export interface ITenantRatingCardStore {
  createRating(tenantId: string, landlordId: string, input: CreateTenantRatingRequest): Promise<TenantRating>
  hasExistingRating(tenantId: string, landlordId: string, dealId: string): Promise<boolean>
  getRatingCard(tenantId: string): Promise<TenantRatingCardResponse>
  createShareToken(tenantId: string, ttlDays: number): Promise<CreatedShareToken>
  /** Revokes a link the tenant owns. Returns false when no such link exists for that tenant. */
  revokeShareToken(tenantId: string, tokenId: string): Promise<boolean>
  /** Returns the public card for a live token, or null for an unknown, expired or revoked token. */
  getPublicRatingCard(token: string): Promise<PublicRatingCardResponse | null>
}

const EMPTY_AGGREGATES = { paymentTimeliness: 0, propertyCare: 0, communication: 0, overall: 0 }

function average(values: number[]): number {
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
}

function newestFirst(rows: StoredRatingRow[]): StoredRatingRow[] {
  return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

/** Aggregates a tenant's ratings. Shared by the tenant view and the public view. */
export function aggregateRatings(rows: StoredRatingRow[]): {
  aggregates: typeof EMPTY_AGGREGATES
  ratingCount: number
  recent: StoredRatingRow[]
} {
  if (rows.length === 0) {
    return { aggregates: { ...EMPTY_AGGREGATES }, ratingCount: 0, recent: [] }
  }
  return {
    aggregates: {
      paymentTimeliness: average(rows.map((r) => r.paymentTimeliness)),
      propertyCare: average(rows.map((r) => r.propertyCare)),
      communication: average(rows.map((r) => r.communication)),
      overall: average(rows.map((r) => r.overall)),
    },
    ratingCount: rows.length,
    recent: newestFirst(rows).filter((r) => r.comment).slice(0, RECENT_COMMENT_LIMIT),
  }
}

export function toTenantRatingCard(rows: StoredRatingRow[]): TenantRatingCardResponse {
  const { aggregates, ratingCount, recent } = aggregateRatings(rows)
  return {
    aggregates,
    ratingCount,
    recentComments: recent.map((r) => ({
      landlordInitial: r.landlordId.charAt(0).toUpperCase(),
      comment: r.comment ?? '',
      createdAt: r.createdAt,
    })),
  }
}

/** The public card carries comments only: no landlord ids, dates or other personal data. */
export function toPublicRatingCard(rows: StoredRatingRow[]): PublicRatingCardResponse {
  const { aggregates, ratingCount, recent } = aggregateRatings(rows)
  return {
    aggregates,
    ratingCount,
    recentComments: recent.map((r) => r.comment ?? ''),
  }
}

interface InMemoryRating extends StoredRatingRow {
  id: string
  tenantId: string
  dealId: string
}

interface InMemoryToken {
  id: string
  tenantId: string
  token: string
  expiresAt: Date
}

export class InMemoryTenantRatingCardStore implements ITenantRatingCardStore {
  private ratings = new Map<string, InMemoryRating>()
  private tokens = new Map<string, InMemoryToken>()

  async createRating(tenantId: string, landlordId: string, input: CreateTenantRatingRequest): Promise<TenantRating> {
    if (await this.hasExistingRating(tenantId, landlordId, input.dealId)) {
      throw new AppError(ErrorCode.CONFLICT, 409, 'Rating for this deal already exists')
    }
    const rating: InMemoryRating = {
      id: randomUUID(),
      tenantId,
      landlordId,
      dealId: input.dealId,
      paymentTimeliness: input.paymentTimeliness,
      propertyCare: input.propertyCare,
      communication: input.communication,
      overall: input.overall,
      comment: input.comment ?? null,
      createdAt: new Date(),
    }
    this.ratings.set(rating.id, rating)
    return { ...rating }
  }

  async hasExistingRating(tenantId: string, landlordId: string, dealId: string): Promise<boolean> {
    return [...this.ratings.values()].some(
      (r) => r.tenantId === tenantId && r.landlordId === landlordId && r.dealId === dealId,
    )
  }

  async getRatingCard(tenantId: string): Promise<TenantRatingCardResponse> {
    return toTenantRatingCard(this.ratingsFor(tenantId))
  }

  async createShareToken(tenantId: string, ttlDays: number): Promise<CreatedShareToken> {
    const id = randomUUID()
    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)
    this.tokens.set(id, { id, tenantId, token, expiresAt })
    return { id, token, expiresAt }
  }

  async revokeShareToken(tenantId: string, tokenId: string): Promise<boolean> {
    const existing = this.tokens.get(tokenId)
    if (!existing || existing.tenantId !== tenantId) return false
    this.tokens.delete(tokenId)
    return true
  }

  async getPublicRatingCard(token: string): Promise<PublicRatingCardResponse | null> {
    const live = [...this.tokens.values()].find((t) => t.token === token && t.expiresAt.getTime() > Date.now())
    if (!live) return null
    return toPublicRatingCard(this.ratingsFor(live.tenantId))
  }

  private ratingsFor(tenantId: string): StoredRatingRow[] {
    return [...this.ratings.values()].filter((r) => r.tenantId === tenantId)
  }

  /** Test helper. */
  async clear(): Promise<void> {
    this.ratings.clear()
    this.tokens.clear()
  }
}

function rowToStored(row: Record<string, unknown>): StoredRatingRow {
  return {
    landlordId: String(row.landlord_id),
    paymentTimeliness: Number(row.payment_timeliness),
    propertyCare: Number(row.property_care),
    communication: Number(row.communication),
    overall: Number(row.overall),
    comment: (row.comment as string | null) ?? null,
    createdAt: new Date(row.created_at as string),
  }
}

export class PostgresTenantRatingCardStore implements ITenantRatingCardStore {
  private async pool() {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')
    return pool
  }

  async createRating(tenantId: string, landlordId: string, input: CreateTenantRatingRequest): Promise<TenantRating> {
    const pool = await this.pool()
    try {
      const result = await pool.query(
        `INSERT INTO tenant_ratings (tenant_id, landlord_id, deal_id, payment_timeliness, property_care, communication, overall, comment)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, tenant_id, landlord_id, deal_id, payment_timeliness, property_care, communication, overall, comment, created_at`,
        [
          tenantId,
          landlordId,
          input.dealId,
          input.paymentTimeliness,
          input.propertyCare,
          input.communication,
          input.overall,
          input.comment ?? null,
        ],
      )
      const row = result.rows[0]
      return {
        id: String(row.id),
        tenantId: String(row.tenant_id),
        landlordId: String(row.landlord_id),
        dealId: String(row.deal_id),
        paymentTimeliness: Number(row.payment_timeliness),
        propertyCare: Number(row.property_care),
        communication: Number(row.communication),
        overall: Number(row.overall),
        comment: (row.comment as string | null) ?? null,
        createdAt: new Date(row.created_at as string),
      }
    } catch (error) {
      // 23505 is tenant_ratings_unique: one rating per tenant, landlord and deal.
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(ErrorCode.CONFLICT, 409, 'Rating for this deal already exists')
      }
      throw error
    }
  }

  async hasExistingRating(tenantId: string, landlordId: string, dealId: string): Promise<boolean> {
    const pool = await this.pool()
    const result = await pool.query(
      `SELECT id FROM tenant_ratings WHERE tenant_id = $1 AND landlord_id = $2 AND deal_id = $3`,
      [tenantId, landlordId, dealId],
    )
    return result.rows.length > 0
  }

  async getRatingCard(tenantId: string): Promise<TenantRatingCardResponse> {
    return toTenantRatingCard(await this.ratingsFor(tenantId))
  }

  async createShareToken(tenantId: string, ttlDays: number): Promise<CreatedShareToken> {
    const pool = await this.pool()
    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)
    const result = await pool.query(
      `INSERT INTO rating_card_tokens (tenant_id, token, expires_at)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [tenantId, token, expiresAt],
    )
    return { id: String(result.rows[0].id), token, expiresAt }
  }

  async revokeShareToken(tenantId: string, tokenId: string): Promise<boolean> {
    const pool = await this.pool()
    const result = await pool.query(
      `DELETE FROM rating_card_tokens WHERE id = $1 AND tenant_id = $2`,
      [tokenId, tenantId],
    )
    return (result.rowCount ?? 0) > 0
  }

  async getPublicRatingCard(token: string): Promise<PublicRatingCardResponse | null> {
    const pool = await this.pool()
    const live = await pool.query(
      `SELECT tenant_id FROM rating_card_tokens WHERE token = $1 AND expires_at > NOW()`,
      [token],
    )
    if (live.rows.length === 0) return null
    return toPublicRatingCard(await this.ratingsFor(String(live.rows[0].tenant_id)))
  }

  private async ratingsFor(tenantId: string): Promise<StoredRatingRow[]> {
    const pool = await this.pool()
    const result = await pool.query(
      `SELECT landlord_id, payment_timeliness, property_care, communication, overall, comment, created_at
       FROM tenant_ratings WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    )
    return result.rows.map((row: Record<string, unknown>) => rowToStored(row))
  }
}

let tenantRatingCardStore: ITenantRatingCardStore | undefined

export function initTenantRatingCardStore(store: ITenantRatingCardStore) {
  tenantRatingCardStore = store
}

export function getTenantRatingCardStore(): ITenantRatingCardStore {
  if (!tenantRatingCardStore) {
    tenantRatingCardStore = process.env.DATABASE_URL
      ? new PostgresTenantRatingCardStore()
      : new InMemoryTenantRatingCardStore()
  }
  return tenantRatingCardStore
}
