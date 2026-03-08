import { getPool } from '../db.js'
import { OutboxItem } from '../outbox/types.js'


export class OutboxRepository {
  private async pool() {
    const pool = await getPool()
    if (!pool) {
      throw new Error('Database pool is not available (DATABASE_URL/pg not configured)')
    }
    return pool
  }

  async add(item: OutboxItem) {
    const pool = await this.pool()
    await pool.query(
      `INSERT INTO outbox_items (aggregate_type, aggregate_id, event_type, payload)
       VALUES ($1,$2,$3,$4)`,
      [item.aggregateType, item.aggregateId, item.eventType, item.payload]
    )
  }

  async fetchPending() {
    const pool = await this.pool()
    const { rows } = await pool.query(`
      SELECT *
      FROM outbox_items
      WHERE status='PENDING' AND (next_retry_at IS NULL OR next_retry_at <= NOW())
      ORDER BY created_at
      LIMIT 50
      FOR UPDATE SKIP LOCKED
    `)
    return rows;
  }

  async markProcessed(id: string) {
    const pool = await this.pool()
    await pool.query(
      `UPDATE outbox_items SET status='PROCESSED', processed_at=NOW() WHERE id=$1`,
      [id]
    )
  }

  async markRetry(id: string) {
    const pool = await this.pool()
    await pool.query(
      `UPDATE outbox_items
       SET retry_count = retry_count+1,
           next_retry_at = NOW() + INTERVAL '5 minutes'
       WHERE id=$1`,
      [id]
    )
  }
}