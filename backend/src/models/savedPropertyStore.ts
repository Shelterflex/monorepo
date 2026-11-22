/**
 * Tenant saved-property store (issue #2049), backed by `tenant_saved_properties`
 * (migrations/20261019140000). Every method is keyed by the user id, and save and
 * remove are idempotent.
 *
 * `savedPropertyStore` picks PostgreSQL when DATABASE_URL is set and the
 * in-memory store otherwise, the same way landlordPropertyStore does.
 */

import { getPool } from '../db.js'

export interface SavedPropertyPage {
  /** Saved listing ids for this page, most recently saved first. */
  listingIds: string[]
  /** Total number of saved listings across all pages. */
  total: number
}

export interface SavedPropertyStore {
  listPage(userId: string, page: number, pageSize: number): Promise<SavedPropertyPage>
  /** Saves a listing. Saving it again changes nothing. */
  save(userId: string, listingId: string): Promise<void>
  /** Removes a saved listing. Removing one that is not saved changes nothing. */
  remove(userId: string, listingId: string): Promise<void>
}

/** In-memory implementation, used when DATABASE_URL is not set. */
export class InMemorySavedPropertyStore implements SavedPropertyStore {
  /** userId -> (listingId -> insertion sequence) */
  private saved = new Map<string, Map<string, number>>()
  private sequence = 0

  private orderedFor(userId: string): string[] {
    const entries = this.saved.get(userId)
    if (!entries) return []
    return [...entries.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([listingId]) => listingId)
  }

  async listPage(userId: string, page: number, pageSize: number): Promise<SavedPropertyPage> {
    const all = this.orderedFor(userId)
    const start = (page - 1) * pageSize
    return { listingIds: all.slice(start, start + pageSize), total: all.length }
  }

  async save(userId: string, listingId: string): Promise<void> {
    let entries = this.saved.get(userId)
    if (!entries) {
      entries = new Map()
      this.saved.set(userId, entries)
    }
    if (!entries.has(listingId)) {
      entries.set(listingId, ++this.sequence)
    }
  }

  async remove(userId: string, listingId: string): Promise<void> {
    this.saved.get(userId)?.delete(listingId)
  }

  /** Test helper. */
  async clear(): Promise<void> {
    this.saved.clear()
    this.sequence = 0
  }
}

/** PostgreSQL implementation. The composite primary key enforces one row per (user, listing). */
export class PostgresSavedPropertyStore implements SavedPropertyStore {
  private async pool() {
    const pool = await getPool()
    if (!pool) throw new Error('Database pool not initialized')
    return pool
  }

  async listPage(userId: string, page: number, pageSize: number): Promise<SavedPropertyPage> {
    const pool = await this.pool()
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM tenant_saved_properties WHERE user_id = $1`,
      [userId],
    )
    const result = await pool.query(
      `SELECT listing_id FROM tenant_saved_properties
       WHERE user_id = $1
       ORDER BY created_at DESC, listing_id
       LIMIT $2 OFFSET $3`,
      [userId, pageSize, (page - 1) * pageSize],
    )
    return {
      listingIds: result.rows.map((row: { listing_id: string }) => row.listing_id),
      total: Number(countResult.rows[0]?.total ?? 0),
    }
  }

  async save(userId: string, listingId: string): Promise<void> {
    const pool = await this.pool()
    await pool.query(
      `INSERT INTO tenant_saved_properties (user_id, listing_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, listing_id) DO NOTHING`,
      [userId, listingId],
    )
  }

  async remove(userId: string, listingId: string): Promise<void> {
    const pool = await this.pool()
    await pool.query(
      `DELETE FROM tenant_saved_properties WHERE user_id = $1 AND listing_id = $2`,
      [userId, listingId],
    )
  }
}

class HybridSavedPropertyStore implements SavedPropertyStore {
  private memory = new InMemorySavedPropertyStore()
  private postgres = new PostgresSavedPropertyStore()

  private async adapter(): Promise<SavedPropertyStore> {
    return (await getPool()) ? this.postgres : this.memory
  }

  async listPage(userId: string, page: number, pageSize: number): Promise<SavedPropertyPage> {
    return (await this.adapter()).listPage(userId, page, pageSize)
  }

  async save(userId: string, listingId: string): Promise<void> {
    return (await this.adapter()).save(userId, listingId)
  }

  async remove(userId: string, listingId: string): Promise<void> {
    return (await this.adapter()).remove(userId, listingId)
  }
}

export const savedPropertyStore: SavedPropertyStore = new HybridSavedPropertyStore()
