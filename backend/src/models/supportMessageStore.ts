/**
 * Support message store (issue #2056), backed by `support_messages`
 * (migrations/016 and migrations/20261122090000 for the status column).
 *
 * `supportMessageStore` uses PostgreSQL when DATABASE_URL is set and the
 * in-memory store otherwise, the same way landlordPropertyStore does.
 */

import { randomUUID } from 'node:crypto'
import { getPool } from '../db.js'
import type {
  SupportMessage,
  SupportMessagePage,
  SupportMessageStatus,
} from '../schemas/supportMessage.js'

export interface CreateSupportMessageData {
  name: string
  email: string
  phone: string | null
  subject: string
  message: string
  ip: string | null
  userAgent: string | null
}

export interface ListSupportMessagesOptions {
  page: number
  pageSize: number
  status?: SupportMessageStatus
}

export interface SupportMessageStore {
  create(data: CreateSupportMessageData): Promise<SupportMessage>
  list(options: ListSupportMessagesOptions): Promise<SupportMessagePage>
}

function pageOf(
  messages: SupportMessage[],
  total: number,
  page: number,
  pageSize: number,
): SupportMessagePage {
  return { messages, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
}

/** In-memory implementation, used when DATABASE_URL is not set. */
export class InMemorySupportMessageStore implements SupportMessageStore {
  private messages: SupportMessage[] = []

  async create(data: CreateSupportMessageData): Promise<SupportMessage> {
    const message: SupportMessage = {
      messageId: randomUUID(),
      ...data,
      status: 'new',
      createdAt: new Date(),
    }
    this.messages.push(message)
    return message
  }

  async list({ page, pageSize, status }: ListSupportMessagesOptions): Promise<SupportMessagePage> {
    const matching = this.messages
      .filter((m) => !status || m.status === status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    const start = (page - 1) * pageSize
    return pageOf(matching.slice(start, start + pageSize), matching.length, page, pageSize)
  }

  /** Test helper. */
  async clear(): Promise<void> {
    this.messages = []
  }
}

const MESSAGE_COLUMNS = `message_id, name, email, phone, subject, message, status, ip, user_agent, created_at`

/** PostgreSQL implementation. */
export class PostgresSupportMessageStore implements SupportMessageStore {
  private async pool() {
    const pool = await getPool()
    if (!pool) throw new Error('Database pool not initialized')
    return pool
  }

  async create(data: CreateSupportMessageData): Promise<SupportMessage> {
    const pool = await this.pool()
    const result = await pool.query(
      `INSERT INTO support_messages (name, email, phone, subject, message, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${MESSAGE_COLUMNS}`,
      [data.name, data.email, data.phone, data.subject, data.message, data.ip, data.userAgent],
    )
    return this.mapRow(result.rows[0])
  }

  async list({ page, pageSize, status }: ListSupportMessagesOptions): Promise<SupportMessagePage> {
    const pool = await this.pool()
    const where = status ? 'WHERE status = $1' : ''
    const filterParams = status ? [status] : []

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM support_messages ${where}`,
      filterParams,
    )
    const result = await pool.query(
      `SELECT ${MESSAGE_COLUMNS} FROM support_messages ${where}
       ORDER BY created_at DESC, message_id
       LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}`,
      [...filterParams, pageSize, (page - 1) * pageSize],
    )

    return pageOf(
      result.rows.map((row: unknown) => this.mapRow(row)),
      Number(countResult.rows[0]?.total ?? 0),
      page,
      pageSize,
    )
  }

  private mapRow(row: any): SupportMessage {
    return {
      messageId: row.message_id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      subject: row.subject,
      message: row.message,
      status: row.status,
      ip: row.ip,
      userAgent: row.user_agent,
      createdAt: new Date(row.created_at),
    }
  }
}

class HybridSupportMessageStore implements SupportMessageStore {
  private memory = new InMemorySupportMessageStore()
  private postgres = new PostgresSupportMessageStore()

  private async adapter(): Promise<SupportMessageStore> {
    return (await getPool()) ? this.postgres : this.memory
  }

  async create(data: CreateSupportMessageData): Promise<SupportMessage> {
    return (await this.adapter()).create(data)
  }

  async list(options: ListSupportMessagesOptions): Promise<SupportMessagePage> {
    return (await this.adapter()).list(options)
  }
}

export const supportMessageStore: SupportMessageStore = new HybridSupportMessageStore()
