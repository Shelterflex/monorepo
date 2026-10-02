import { getPool } from '../db.js'
import type { WebhookSubscription, WebhookDeliveryLog, WebhookEventType } from '../models/webhookSubscription.js'

export class PostgresWebhookSubscriptionRepository {
  private async pool() {
    const pool = await getPool()
    if (!pool) {
      throw new Error('Database pool is not available (DATABASE_URL/pg not configured)')
    }
    return pool
  }

  async create(data: {
    ownerId: string
    targetUrl: string
    secret: string
    events: WebhookEventType[]
  }): Promise<WebhookSubscription> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `INSERT INTO webhook_subscriptions (owner_id, target_url, secret, events, active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, owner_id, target_url, secret, events, active, created_at`,
      [data.ownerId, data.targetUrl, data.secret, data.events]
    )

    const row = rows[0]
    return {
      id: row.id,
      ownerId: row.owner_id,
      targetUrl: row.target_url,
      secret: row.secret,
      events: row.events,
      active: row.active,
      createdAt: row.created_at,
    }
  }

  async findById(id: string): Promise<WebhookSubscription | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `SELECT id, owner_id, target_url, secret, events, active, created_at
       FROM webhook_subscriptions WHERE id = $1`,
      [id]
    )

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      id: row.id,
      ownerId: row.owner_id,
      targetUrl: row.target_url,
      secret: row.secret,
      events: row.events,
      active: row.active,
      createdAt: row.created_at,
    }
  }

  async listByOwner(ownerId: string): Promise<WebhookSubscription[]> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `SELECT id, owner_id, target_url, secret, events, active, created_at
       FROM webhook_subscriptions WHERE owner_id = $1
       ORDER BY created_at DESC`,
      [ownerId]
    )

    return rows.map(row => ({
      id: row.id,
      ownerId: row.owner_id,
      targetUrl: row.target_url,
      secret: row.secret,
      events: row.events,
      active: row.active,
      createdAt: row.created_at,
    }))
  }

  async listActiveByEvent(event: WebhookEventType): Promise<WebhookSubscription[]> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `SELECT id, owner_id, target_url, secret, events, active, created_at
       FROM webhook_subscriptions
       WHERE active = true AND $1 = ANY(events)
       ORDER BY created_at DESC`,
      [event]
    )

    return rows.map(row => ({
      id: row.id,
      ownerId: row.owner_id,
      targetUrl: row.target_url,
      secret: row.secret,
      events: row.events,
      active: row.active,
      createdAt: row.created_at,
    }))
  }

  async delete(id: string): Promise<boolean> {
    const pool = await this.pool()
    const { rowCount } = await pool.query(
      `DELETE FROM webhook_subscriptions WHERE id = $1`,
      [id]
    )
    return (rowCount ?? 0) > 0
  }

  async updateActive(id: string, active: boolean): Promise<void> {
    const pool = await this.pool()
    await pool.query(
      `UPDATE webhook_subscriptions SET active = $1 WHERE id = $2`,
      [active, id]
    )
  }
}

export class PostgresWebhookDeliveryLogRepository {
  private async pool() {
    const pool = await getPool()
    if (!pool) {
      throw new Error('Database pool is not available (DATABASE_URL/pg not configured)')
    }
    return pool
  }

  async logAttempt(log: Omit<WebhookDeliveryLog, 'id' | 'attemptedAt'>): Promise<WebhookDeliveryLog> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `INSERT INTO webhook_delivery_logs (subscription_id, event, payload, status, response_code, response_body, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, subscription_id, event, payload, status, response_code, response_body, request_id, attempted_at`,
      [
        log.subscriptionId,
        log.event,
        JSON.stringify(log.payload),
        log.status,
        log.responseCode ?? null,
        log.responseBody ?? null,
        log.requestId ?? null,
      ]
    )

    const row = rows[0]
    return {
      id: row.id,
      subscriptionId: row.subscription_id,
      event: row.event,
      payload: row.payload,
      status: row.status,
      responseCode: row.response_code,
      responseBody: row.response_body,
      requestId: row.request_id,
      attemptedAt: row.attempted_at,
    }
  }

  async getHistoryBySubscription(subscriptionId: string): Promise<WebhookDeliveryLog[]> {
    const pool = await this.pool()
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const { rows } = await pool.query(
      `SELECT id, subscription_id, event, payload, status, response_code, response_body, request_id, attempted_at
       FROM webhook_delivery_logs
       WHERE subscription_id = $1 AND attempted_at > $2
       ORDER BY attempted_at DESC`,
      [subscriptionId, thirtyDaysAgo]
    )

    return rows.map(row => ({
      id: row.id,
      subscriptionId: row.subscription_id,
      event: row.event,
      payload: row.payload,
      status: row.status,
      responseCode: row.response_code,
      responseBody: row.response_body,
      requestId: row.request_id,
      attemptedAt: row.attempted_at,
    }))
  }
}
