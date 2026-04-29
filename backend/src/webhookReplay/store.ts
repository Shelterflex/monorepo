import { logger } from '../utils/logger.js'
import { getPool } from '../db.js'
import type {
  WebhookEvent,
  WebhookReplayAttempt,
  WebhookProcessingStatus,
  ReplayStatus,
  ActorType,
  ReplayRequest,
  ReplayPreview,
} from './types.js'

export interface IWebhookReplayStore {
  createEvent(event: Omit<WebhookEvent, 'id' | 'receivedAt'>): Promise<WebhookEvent>
  getEventById(id: string): Promise<WebhookEvent | null>
  getEventByProviderAndExternalId(provider: string, externalId: string): Promise<WebhookEvent | null>
  listEvents(request: ReplayRequest): Promise<WebhookEvent[]>
  updateEventStatus(id: string, status: WebhookProcessingStatus, error?: string): Promise<void>
  createReplayAttempt(attempt: Omit<WebhookReplayAttempt, 'id' | 'startedAt'>): Promise<WebhookReplayAttempt>
  updateReplayAttempt(id: string, status: ReplayStatus, outcome?: Record<string, unknown>, error?: string): Promise<void>
  listReplayAttempts(webhookEventId?: string, actorUserId?: string): Promise<WebhookReplayAttempt[]>
  getReplayPreview(request: ReplayRequest): Promise<ReplayPreview>
}

export class PostgresWebhookReplayStore implements IWebhookReplayStore {
  async createEvent(event: Omit<WebhookEvent, 'id' | 'receivedAt'>): Promise<WebhookEvent> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')
    const result = await pool.query(
      `INSERT INTO webhook_events 
       (provider, event_type, external_id, payload, headers, processing_status, processing_error)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, provider, event_type, external_id, payload, headers, 
                 received_at, processed_at, processing_status, processing_error`,
      [
        event.provider,
        event.eventType,
        event.externalId,
        JSON.stringify(event.payload),
        event.headers ? JSON.stringify(event.headers) : null,
        event.processingStatus,
        event.processingError || null,
      ]
    )

    return this.mapRowToEvent(result.rows[0])
  }

  async getEventById(id: string): Promise<WebhookEvent | null> {
    const pool = await getPool()
    if (!pool) return null
    const result = await pool.query(
      'SELECT * FROM webhook_events WHERE id = $1',
      [id]
    )
    return result.rows[0] ? this.mapRowToEvent(result.rows[0]) : null
  }

  async getEventByProviderAndExternalId(provider: string, externalId: string): Promise<WebhookEvent | null> {
    const pool = await getPool()
    if (!pool) return null
    const result = await pool.query(
      'SELECT * FROM webhook_events WHERE provider = $1 AND external_id = $2',
      [provider, externalId]
    )
    return result.rows[0] ? this.mapRowToEvent(result.rows[0]) : null
  }

  async listEvents(request: ReplayRequest): Promise<WebhookEvent[]> {
    const pool = await getPool()
    if (!pool) return []
    
    const conditions: string[] = []
    const params: any[] = []
    let paramIndex = 1

    if (request.provider) {
      conditions.push(`provider = $${paramIndex++}`)
      params.push(request.provider)
    }
    if (request.eventType) {
      conditions.push(`event_type = $${paramIndex++}`)
      params.push(request.eventType)
    }
    if (request.startTime) {
      conditions.push(`received_at >= $${paramIndex++}`)
      params.push(request.startTime)
    }
    if (request.endTime) {
      conditions.push(`received_at <= $${paramIndex++}`)
      params.push(request.endTime)
    }
    if (request.webhookEventId) {
      conditions.push(`id = $${paramIndex++}`)
      params.push(request.webhookEventId)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const query = `SELECT * FROM webhook_events ${whereClause} ORDER BY received_at DESC`

    const result = await pool.query(query, params)
    return result.rows.map((row: any) => this.mapRowToEvent(row))
  }

  async updateEventStatus(id: string, status: WebhookProcessingStatus, error?: string): Promise<void> {
    const pool = await getPool()
    if (!pool) return
    await pool.query(
      `UPDATE webhook_events 
       SET processing_status = $1, processing_error = $2, processed_at = $3
       WHERE id = $4`,
      [status, error || null, status === 'processed' ? new Date() : null, id]
    )
  }

  async createReplayAttempt(attempt: Omit<WebhookReplayAttempt, 'id' | 'startedAt'>): Promise<WebhookReplayAttempt> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')
    const result = await pool.query(
      `INSERT INTO webhook_replay_attempts 
       (webhook_event_id, actor_user_id, actor_type, reason, dry_run, status, outcome, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, webhook_event_id, actor_user_id, actor_type, reason, dry_run, 
                 status, outcome, error_message, started_at, completed_at`,
      [
        attempt.webhookEventId,
        attempt.actorUserId,
        attempt.actorType,
        attempt.reason,
        attempt.dryRun,
        attempt.status,
        attempt.outcome ? JSON.stringify(attempt.outcome) : null,
        attempt.errorMessage || null,
      ]
    )

    return this.mapRowToReplayAttempt(result.rows[0])
  }

  async updateReplayAttempt(id: string, status: ReplayStatus, outcome?: Record<string, unknown>, error?: string): Promise<void> {
    const pool = await getPool()
    if (!pool) return
    await pool.query(
      `UPDATE webhook_replay_attempts 
       SET status = $1, outcome = $2, error_message = $3, completed_at = $4
       WHERE id = $5`,
      [
        status,
        outcome ? JSON.stringify(outcome) : null,
        error || null,
        status === 'success' || status === 'failed' ? new Date() : null,
        id,
      ]
    )
  }

  async listReplayAttempts(webhookEventId?: string, actorUserId?: string): Promise<WebhookReplayAttempt[]> {
    const pool = await getPool()
    if (!pool) return []
    
    const conditions: string[] = []
    const params: any[] = []
    let paramIndex = 1

    if (webhookEventId) {
      conditions.push(`webhook_event_id = $${paramIndex++}`)
      params.push(webhookEventId)
    }
    if (actorUserId) {
      conditions.push(`actor_user_id = $${paramIndex++}`)
      params.push(actorUserId)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const query = `SELECT * FROM webhook_replay_attempts ${whereClause} ORDER BY started_at DESC`

    const result = await pool.query(query, params)
    return result.rows.map((row: any) => this.mapRowToReplayAttempt(row))
  }

  async getReplayPreview(request: ReplayRequest): Promise<ReplayPreview> {
    const events = await this.listEvents(request)
    return {
      totalEvents: events.length,
      events,
    }
  }

  private mapRowToEvent(row: any): WebhookEvent {
    return {
      id: row.id,
      provider: row.provider,
      eventType: row.event_type,
      externalId: row.external_id,
      payload: row.payload,
      headers: row.headers,
      receivedAt: row.received_at,
      processedAt: row.processed_at,
      processingStatus: row.processing_status,
      processingError: row.processing_error,
    }
  }

  private mapRowToReplayAttempt(row: any): WebhookReplayAttempt {
    return {
      id: row.id,
      webhookEventId: row.webhook_event_id,
      actorUserId: row.actor_user_id,
      actorType: row.actor_type,
      reason: row.reason,
      dryRun: row.dry_run,
      status: row.status,
      outcome: row.outcome,
      errorMessage: row.error_message,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    }
  }
}

// In-memory implementation for testing
export class InMemoryWebhookReplayStore implements IWebhookReplayStore {
  private events = new Map<string, WebhookEvent>()
  private replayAttempts = new Map<string, WebhookReplayAttempt>()
  private idCounter = 1

  async createEvent(event: Omit<WebhookEvent, 'id' | 'receivedAt'>): Promise<WebhookEvent> {
    const id = `event-${this.idCounter++}`
    const newEvent: WebhookEvent = {
      ...event,
      id,
      receivedAt: new Date(),
    }
    this.events.set(id, newEvent)
    return newEvent
  }

  async getEventById(id: string): Promise<WebhookEvent | null> {
    return this.events.get(id) || null
  }

  async getEventByProviderAndExternalId(provider: string, externalId: string): Promise<WebhookEvent | null> {
    for (const event of this.events.values()) {
      if (event.provider === provider && event.externalId === externalId) {
        return event
      }
    }
    return null
  }

  async listEvents(request: ReplayRequest): Promise<WebhookEvent[]> {
    let events = Array.from(this.events.values())

    if (request.provider) {
      events = events.filter(e => e.provider === request.provider)
    }
    if (request.eventType) {
      events = events.filter(e => e.eventType === request.eventType)
    }
    if (request.startTime) {
      events = events.filter(e => e.receivedAt >= request.startTime!)
    }
    if (request.endTime) {
      events = events.filter(e => e.receivedAt <= request.endTime!)
    }
    if (request.webhookEventId) {
      events = events.filter(e => e.id === request.webhookEventId)
    }

    return events.sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
  }

  async updateEventStatus(id: string, status: WebhookProcessingStatus, error?: string): Promise<void> {
    const event = this.events.get(id)
    if (event) {
      event.processingStatus = status
      event.processingError = error
      if (status === 'processed') {
        event.processedAt = new Date()
      }
    }
  }

  async createReplayAttempt(attempt: Omit<WebhookReplayAttempt, 'id' | 'startedAt'>): Promise<WebhookReplayAttempt> {
    const id = `replay-${this.idCounter++}`
    const newAttempt: WebhookReplayAttempt = {
      ...attempt,
      id,
      startedAt: new Date(),
    }
    this.replayAttempts.set(id, newAttempt)
    return newAttempt
  }

  async updateReplayAttempt(id: string, status: ReplayStatus, outcome?: Record<string, unknown>, error?: string): Promise<void> {
    const attempt = this.replayAttempts.get(id)
    if (attempt) {
      attempt.status = status
      attempt.outcome = outcome
      attempt.errorMessage = error
      if (status === 'success' || status === 'failed') {
        attempt.completedAt = new Date()
      }
    }
  }

  async listReplayAttempts(webhookEventId?: string, actorUserId?: string): Promise<WebhookReplayAttempt[]> {
    let attempts = Array.from(this.replayAttempts.values())

    if (webhookEventId) {
      attempts = attempts.filter(a => a.webhookEventId === webhookEventId)
    }
    if (actorUserId) {
      attempts = attempts.filter(a => a.actorUserId === actorUserId)
    }

    return attempts.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
  }

  async getReplayPreview(request: ReplayRequest): Promise<ReplayPreview> {
    const events = await this.listEvents(request)
    return {
      totalEvents: events.length,
      events,
    }
  }
}

let store: IWebhookReplayStore | null = null

export function getWebhookReplayStore(): IWebhookReplayStore {
  if (!store) {
    store = new InMemoryWebhookReplayStore()
  }
  return store
}

export function initWebhookReplayStore(s: IWebhookReplayStore): void {
  store = s
}

// Alias for app.ts import
export { initWebhookReplayStore as initStore }
