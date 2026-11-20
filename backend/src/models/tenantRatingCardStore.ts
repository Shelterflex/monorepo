import { getPool } from '../db.js'
import { TenantRating, RatingCardToken, TenantRatingCardResponse, PublicRatingCardResponse } from '../schemas/tenantRatingCard.js'
import { randomBytes } from 'crypto'

export interface ITenantRatingCardStore {
  createRating(tenantId: string, landlordId: string, rating: any): Promise<TenantRating>
  getRatingCard(tenantId: string): Promise<TenantRatingCardResponse>
  createShareToken(tenantId: string, ttlDays: number): Promise<{ token: string; expiresAt: Date }>
  revokeShareToken(tokenId: string): Promise<void>
  getPublicRatingCard(token: string): Promise<PublicRatingCardResponse>
  canRateDeal(tenantId: string, landlordId: string, dealId: string): Promise<boolean>
  hasExistingRating(tenantId: string, landlordId: string, dealId: string): Promise<boolean>
}

export class InMemoryTenantRatingCardStore implements ITenantRatingCardStore {
  private ratings: Map<string, TenantRating> = new Map()
  private tokens: Map<string, RatingCardToken> = new Map()

  async createRating(tenantId: string, landlordId: string, rating: any): Promise<TenantRating> {
    const id = Math.random().toString(36).substring(7)
    const tenantRating: TenantRating = {
      id,
      tenantId,
      landlordId,
      dealId: rating.dealId,
      paymentTimeliness: rating.paymentTimeliness,
      propertyCare: rating.propertyCare,
      communication: rating.communication,
      overall: rating.overall,
      comment: rating.comment || null,
      createdAt: new Date(),
    }
    this.ratings.set(id, tenantRating)
    return tenantRating
  }

  async getRatingCard(tenantId: string): Promise<TenantRatingCardResponse> {
    const tenantRatings = Array.from(this.ratings.values()).filter(
      (r) => r.tenantId === tenantId,
    )

    if (tenantRatings.length === 0) {
      return {
        aggregates: { paymentTimeliness: 0, propertyCare: 0, communication: 0, overall: 0 },
        ratingCount: 0,
        recentComments: [],
      }
    }

    const avg = (values: number[]) =>
      Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10

    return {
      aggregates: {
        paymentTimeliness: avg(tenantRatings.map((r) => r.paymentTimeliness)),
        propertyCare: avg(tenantRatings.map((r) => r.propertyCare)),
        communication: avg(tenantRatings.map((r) => r.communication)),
        overall: avg(tenantRatings.map((r) => r.overall)),
      },
      ratingCount: tenantRatings.length,
      recentComments: tenantRatings
        .filter((r) => r.comment)
        .slice(-5)
        .map((r) => ({
          landlordInitial: r.landlordId.charAt(0).toUpperCase(),
          comment: r.comment || '',
          createdAt: r.createdAt,
        })),
    }
  }

  async createShareToken(tenantId: string, ttlDays: number): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('hex')
    const id = Math.random().toString(36).substring(7)
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)

    this.tokens.set(id, {
      id,
      tenantId,
      token,
      expiresAt,
      createdAt: new Date(),
    })

    return { token, expiresAt }
  }

  async revokeShareToken(tokenId: string): Promise<void> {
    this.tokens.delete(tokenId)
  }

  async getPublicRatingCard(token: string): Promise<PublicRatingCardResponse> {
    const shareToken = Array.from(this.tokens.values()).find((t) => t.token === token)
    if (!shareToken || shareToken.expiresAt < new Date()) {
      throw new Error('Invalid or expired token')
    }

    const tenantRatings = Array.from(this.ratings.values()).filter(
      (r) => r.tenantId === shareToken.tenantId,
    )

    if (tenantRatings.length === 0) {
      return {
        aggregates: { paymentTimeliness: 0, propertyCare: 0, communication: 0, overall: 0 },
        ratingCount: 0,
        recentComments: [],
      }
    }

    const avg = (values: number[]) =>
      Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10

    return {
      aggregates: {
        paymentTimeliness: avg(tenantRatings.map((r) => r.paymentTimeliness)),
        propertyCare: avg(tenantRatings.map((r) => r.propertyCare)),
        communication: avg(tenantRatings.map((r) => r.communication)),
        overall: avg(tenantRatings.map((r) => r.overall)),
      },
      ratingCount: tenantRatings.length,
      recentComments: tenantRatings
        .filter((r) => r.comment)
        .slice(-5)
        .map((r) => r.comment || ''),
    }
  }

  async canRateDeal(tenantId: string, landlordId: string, dealId: string): Promise<boolean> {
    // In memory, always allow. In production, check deal status/timeline
    return true
  }

  async hasExistingRating(tenantId: string, landlordId: string, dealId: string): Promise<boolean> {
    return Array.from(this.ratings.values()).some(
      (r) =>
        r.tenantId === tenantId &&
        r.landlordId === landlordId &&
        r.dealId === dealId,
    )
  }
}

export class PostgresTenantRatingCardStore implements ITenantRatingCardStore {
  async createRating(tenantId: string, landlordId: string, rating: any): Promise<TenantRating> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    const result = await pool.query(
      `INSERT INTO tenant_ratings (tenant_id, landlord_id, deal_id, payment_timeliness, property_care, communication, overall, comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, tenant_id, landlord_id, deal_id, payment_timeliness, property_care, communication, overall, comment, created_at`,
      [
        tenantId,
        landlordId,
        rating.dealId,
        rating.paymentTimeliness,
        rating.propertyCare,
        rating.communication,
        rating.overall,
        rating.comment || null,
      ],
    )

    const row = result.rows[0]
    return {
      id: row.id,
      tenantId: row.tenant_id,
      landlordId: row.landlord_id,
      dealId: row.deal_id,
      paymentTimeliness: row.payment_timeliness,
      propertyCare: row.property_care,
      communication: row.communication,
      overall: row.overall,
      comment: row.comment,
      createdAt: row.created_at,
    }
  }

  async getRatingCard(tenantId: string): Promise<TenantRatingCardResponse> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    const result = await pool.query(
      `SELECT payment_timeliness, property_care, communication, overall, comment, landlord_id, created_at
       FROM tenant_ratings
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [tenantId],
    )

    if (result.rows.length === 0) {
      return {
        aggregates: { paymentTimeliness: 0, propertyCare: 0, communication: 0, overall: 0 },
        ratingCount: 0,
        recentComments: [],
      }
    }

    const avg = (key: string) => {
      const values = result.rows.map((r: any) => r[key])
      return Math.round((values.reduce((a: number, b: number) => a + b, 0) / values.length) * 10) / 10
    }

    return {
      aggregates: {
        paymentTimeliness: avg('payment_timeliness'),
        propertyCare: avg('property_care'),
        communication: avg('communication'),
        overall: avg('overall'),
      },
      ratingCount: result.rows.length,
      recentComments: result.rows
        .filter((r: any) => r.comment)
        .slice(0, 5)
        .map((r: any) => ({
          landlordInitial: r.landlord_id.charAt(0).toUpperCase(),
          comment: r.comment,
          createdAt: r.created_at,
        })),
    }
  }

  async createShareToken(tenantId: string, ttlDays: number): Promise<{ token: string; expiresAt: Date }> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)

    await pool.query(
      `INSERT INTO rating_card_tokens (tenant_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [tenantId, token, expiresAt],
    )

    return { token, expiresAt }
  }

  async revokeShareToken(tokenId: string): Promise<void> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    await pool.query(`DELETE FROM rating_card_tokens WHERE id = $1`, [tokenId])
  }

  async getPublicRatingCard(token: string): Promise<PublicRatingCardResponse> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    const tokenResult = await pool.query(
      `SELECT tenant_id, expires_at FROM rating_card_tokens WHERE token = $1`,
      [token],
    )

    if (tokenResult.rows.length === 0) {
      throw new Error('Invalid or expired token')
    }

    const { tenant_id: tenantId, expires_at: expiresAt } = tokenResult.rows[0]

    if (new Date(expiresAt) < new Date()) {
      throw new Error('Invalid or expired token')
    }

    const ratingsResult = await pool.query(
      `SELECT payment_timeliness, property_care, communication, overall, comment
       FROM tenant_ratings
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [tenantId],
    )

    if (ratingsResult.rows.length === 0) {
      return {
        aggregates: { paymentTimeliness: 0, propertyCare: 0, communication: 0, overall: 0 },
        ratingCount: 0,
        recentComments: [],
      }
    }

    const avg = (key: string) => {
      const values = ratingsResult.rows.map((r: any) => r[key])
      return Math.round((values.reduce((a: number, b: number) => a + b, 0) / values.length) * 10) / 10
    }

    return {
      aggregates: {
        paymentTimeliness: avg('payment_timeliness'),
        propertyCare: avg('property_care'),
        communication: avg('communication'),
        overall: avg('overall'),
      },
      ratingCount: ratingsResult.rows.length,
      recentComments: ratingsResult.rows
        .filter((r: any) => r.comment)
        .slice(0, 5)
        .map((r: any) => r.comment),
    }
  }

  async canRateDeal(tenantId: string, landlordId: string, dealId: string): Promise<boolean> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    const result = await pool.query(
      `SELECT status FROM deals WHERE id = $1`,
      [dealId],
    )

    if (result.rows.length === 0) return false

    const status = result.rows[0].status
    // Can rate if deal is completed or has been active for N months
    return status === 'completed' || status === 'active'
  }

  async hasExistingRating(tenantId: string, landlordId: string, dealId: string): Promise<boolean> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    const result = await pool.query(
      `SELECT id FROM tenant_ratings WHERE tenant_id = $1 AND landlord_id = $2 AND deal_id = $3`,
      [tenantId, landlordId, dealId],
    )

    return result.rows.length > 0
  }
}

let tenantRatingCardStore: ITenantRatingCardStore

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

export const inMemoryTenantRatingCardStore = new InMemoryTenantRatingCardStore()
