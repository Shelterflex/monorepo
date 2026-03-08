import { getPool } from '../db.js'
import { Deal } from '../outbox/types.js'

export class DealRepository {
  private async pool() {
    const pool = await getPool()
    if (!pool) {
      throw new Error('Database pool is not available (DATABASE_URL/pg not configured)')
    }
    return pool
  }

  async create(deal: Deal) {
    const pool = await this.pool()
    await pool.query(
      `INSERT INTO deals (id, canonical_external_ref_v1, status, payload)
       VALUES ($1, $2, $3, $4)`,
      [deal.id, deal.canonicalRef, deal.status, deal.payload],
    )
  }

  async findByCanonicalRef(ref: string) {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `SELECT * FROM deals WHERE canonical_external_ref_v1 = $1`,
      [ref],
    )
    return rows[0] ?? null
  }

  async updateStatus(id: string, status: string) {
    const pool = await this.pool()
    await pool.query(
      `UPDATE deals SET status=$2, updated_at=NOW() WHERE id=$1`,
      [id, status],
    )
  }
}