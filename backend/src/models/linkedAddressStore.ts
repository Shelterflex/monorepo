import { getPool } from '../db.js'

export interface LinkedAddressStore {
  setLinkedAddress(userId: string, address: string): Promise<void>
  getLinkedAddress(userId: string): Promise<string | null>
  clear(): Promise<void>
}

export class InMemoryLinkedAddressStore implements LinkedAddressStore {
  private linked = new Map<string, string>()

  async setLinkedAddress(userId: string, address: string): Promise<void> {
    this.linked.set(userId, address)
  }

  async getLinkedAddress(userId: string): Promise<string | null> {
    return this.linked.get(userId) ?? null
  }

  async clear(): Promise<void> {
    this.linked.clear()
  }
}

export class PostgresLinkedAddressStore implements LinkedAddressStore {
  private async pool() {
    const pool = await getPool()
    if (!pool) {
      throw new Error('Database pool is not available (DATABASE_URL/pg not configured)')
    }
    return pool
  }

  async setLinkedAddress(userId: string, address: string): Promise<void> {
    const pool = await this.pool()
    await pool.query(
      `INSERT INTO linked_addresses (user_id, address)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET address = EXCLUDED.address, updated_at = NOW()`,
      [userId, address.toLowerCase()],
    )
  }

  async getLinkedAddress(userId: string): Promise<string | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `SELECT address FROM linked_addresses WHERE user_id = $1`,
      [userId],
    )
    const row = rows[0]
    return row ? String(row.address) : null
  }

  async clear(): Promise<void> {
    const pool = await this.pool()
    await pool.query('DELETE FROM linked_addresses')
  }
}
