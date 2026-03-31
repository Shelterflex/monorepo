/**
 * AuditRepository
 *
 * Append-only storage for audit log entries backed by PostgreSQL.
 * Each entry is HMAC-signed and chained to the previous entry so that
 * any retrospective modification is detectable.
 *
 * Hash-chain invariant:
 *   event_hash  = HMAC-SHA256(AUDIT_HMAC_SECRET, canonicalPayload(row))
 *   chain_hash  = HMAC-SHA256(AUDIT_HMAC_SECRET, event_hash + ":" + prev_hash)
 *
 * Verification:
 *   Re-derive event_hash from stored fields, check it equals the stored value.
 *   Check that each row's prev_hash equals the event_hash of the preceding row.
 */

import { createHmac } from 'node:crypto'
import { getPool } from '../db.js'
import type { AuditEventType, ActorType } from '../utils/auditLogger.js'

export interface AuditEntry {
  id: string
  eventType: AuditEventType
  actorType: ActorType
  userId: string | null
  requestId: string | null
  ipAddress: string | null
  httpMethod: string | null
  httpPath: string | null
  metadata: Record<string, unknown>
  prevHash: string
  eventHash: string
  chainHash: string
  createdAt: Date
}

export interface AuditSearchFilters {
  eventType?: AuditEventType
  actorType?: ActorType
  userId?: string
  requestId?: string
  dateFrom?: Date
  dateTo?: Date
  page?: number
  pageSize?: number
}

export interface AuditSearchResult {
  entries: AuditEntry[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface ChainVerificationResult {
  valid: boolean
  checkedCount: number
  firstBrokenId: string | null
  error: string | null
}

const GENESIS_HASH = 'GENESIS'
const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

function getHmacSecret(): string {
  const secret = process.env.AUDIT_HMAC_SECRET
  if (secret) return secret
  // Fall back to the encryption key in non-production environments
  const encKey = process.env.ENCRYPTION_KEY
  if (encKey) return encKey
  return 'insecure-default-audit-hmac-secret-replace-in-production'
}

/**
 * Canonical payload used for computing event_hash.
 * Must be deterministic: same field order, no extra whitespace.
 */
function canonicalPayload(fields: {
  eventType: string
  actorType: string
  userId: string | null
  requestId: string | null
  ipAddress: string | null
  httpMethod: string | null
  httpPath: string | null
  metadata: Record<string, unknown>
  createdAt: string
}): string {
  return JSON.stringify({
    eventType: fields.eventType,
    actorType: fields.actorType,
    userId: fields.userId,
    requestId: fields.requestId,
    ipAddress: fields.ipAddress,
    httpMethod: fields.httpMethod,
    httpPath: fields.httpPath,
    metadata: fields.metadata,
    createdAt: fields.createdAt,
  })
}

function computeEventHash(
  fields: Parameters<typeof canonicalPayload>[0],
  secret: string
): string {
  return createHmac('sha256', secret).update(canonicalPayload(fields)).digest('hex')
}

function computeChainHash(eventHash: string, prevHash: string, secret: string): string {
  return createHmac('sha256', secret).update(`${eventHash}:${prevHash}`).digest('hex')
}

function rowToEntry(row: Record<string, unknown>): AuditEntry {
  return {
    id: row.id as string,
    eventType: row.event_type as AuditEventType,
    actorType: row.actor_type as ActorType,
    userId: (row.user_id as string | null) ?? null,
    requestId: (row.request_id as string | null) ?? null,
    ipAddress: (row.ip_address as string | null) ?? null,
    httpMethod: (row.http_method as string | null) ?? null,
    httpPath: (row.http_path as string | null) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    prevHash: row.prev_hash as string,
    eventHash: row.event_hash as string,
    chainHash: row.chain_hash as string,
    createdAt: new Date(row.created_at as string),
  }
}

export class AuditRepository {
  private async pool() {
    const pool = await getPool()
    if (!pool) {
      throw new Error('Database pool is not available (DATABASE_URL/pg not configured)')
    }
    return pool
  }

  /**
   * Fetch the event_hash of the most recently inserted row,
   * or GENESIS if the table is empty.
   */
  private async getLastHash(): Promise<string> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `SELECT event_hash FROM audit_log ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    return rows.length > 0 ? (rows[0].event_hash as string) : GENESIS_HASH
  }

  /**
   * Append one audit log entry.
   * Computes event_hash and chain_hash before inserting.
   */
  async append(entry: {
    eventType: AuditEventType
    actorType: ActorType
    userId?: string | null
    requestId?: string | null
    ipAddress?: string | null
    httpMethod?: string | null
    httpPath?: string | null
    metadata?: Record<string, unknown>
    createdAt?: Date
  }): Promise<AuditEntry> {
    const pool = await this.pool()
    const secret = getHmacSecret()
    const createdAt = entry.createdAt ?? new Date()
    const createdAtIso = createdAt.toISOString()

    const fields = {
      eventType: entry.eventType,
      actorType: entry.actorType,
      userId: entry.userId ?? null,
      requestId: entry.requestId ?? null,
      ipAddress: entry.ipAddress ?? null,
      httpMethod: entry.httpMethod ?? null,
      httpPath: entry.httpPath ?? null,
      metadata: entry.metadata ?? {},
      createdAt: createdAtIso,
    }

    const prevHash = await this.getLastHash()
    const eventHash = computeEventHash(fields, secret)
    const chainHash = computeChainHash(eventHash, prevHash, secret)

    const { rows } = await pool.query(
      `INSERT INTO audit_log
         (event_type, actor_type, user_id, request_id, ip_address,
          http_method, http_path, metadata, prev_hash, event_hash, chain_hash, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        fields.eventType,
        fields.actorType,
        fields.userId,
        fields.requestId,
        fields.ipAddress,
        fields.httpMethod,
        fields.httpPath,
        JSON.stringify(fields.metadata),
        prevHash,
        eventHash,
        chainHash,
        createdAt,
      ],
    )

    return rowToEntry(rows[0])
  }

  /**
   * Search audit log entries with optional filters and pagination.
   */
  async search(filters: AuditSearchFilters = {}): Promise<AuditSearchResult> {
    const pool = await this.pool()
    const page = Math.max(1, filters.page ?? 1)
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE))
    const offset = (page - 1) * pageSize

    const conditions: string[] = []
    const params: unknown[] = []
    let paramIndex = 1

    if (filters.eventType) {
      conditions.push(`event_type = $${paramIndex++}`)
      params.push(filters.eventType)
    }
    if (filters.actorType) {
      conditions.push(`actor_type = $${paramIndex++}`)
      params.push(filters.actorType)
    }
    if (filters.userId) {
      conditions.push(`user_id = $${paramIndex++}`)
      params.push(filters.userId)
    }
    if (filters.requestId) {
      conditions.push(`request_id = $${paramIndex++}`)
      params.push(filters.requestId)
    }
    if (filters.dateFrom) {
      conditions.push(`created_at >= $${paramIndex++}`)
      params.push(filters.dateFrom)
    }
    if (filters.dateTo) {
      conditions.push(`created_at <= $${paramIndex++}`)
      params.push(filters.dateTo)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM audit_log ${where}`,
      params,
    )
    const total: number = countResult.rows[0].total

    const dataResult = await pool.query(
      `SELECT * FROM audit_log ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, pageSize, offset],
    )

    return {
      entries: dataResult.rows.map(rowToEntry),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    }
  }

  /**
   * Verify the integrity of the hash chain for a range of rows.
   * Reads rows in ascending created_at order and re-derives every hash.
   *
   * @param limit - max rows to verify in one call (default 1000)
   */
  async verifyChain(limit = 1000): Promise<ChainVerificationResult> {
    const pool = await this.pool()
    const secret = getHmacSecret()

    const { rows } = await pool.query(
      `SELECT * FROM audit_log ORDER BY created_at ASC, id ASC LIMIT $1`,
      [limit],
    )

    if (rows.length === 0) {
      return { valid: true, checkedCount: 0, firstBrokenId: null, error: null }
    }

    let expectedPrevHash = GENESIS_HASH

    for (const row of rows) {
      const entry = rowToEntry(row)

      // Re-derive event_hash
      const recomputed = computeEventHash(
        {
          eventType: entry.eventType,
          actorType: entry.actorType,
          userId: entry.userId,
          requestId: entry.requestId,
          ipAddress: entry.ipAddress,
          httpMethod: entry.httpMethod,
          httpPath: entry.httpPath,
          metadata: entry.metadata,
          createdAt: entry.createdAt.toISOString(),
        },
        secret,
      )

      if (recomputed !== entry.eventHash) {
        return {
          valid: false,
          checkedCount: rows.indexOf(row),
          firstBrokenId: entry.id,
          error: `event_hash mismatch for row ${entry.id}`,
        }
      }

      if (entry.prevHash !== expectedPrevHash) {
        return {
          valid: false,
          checkedCount: rows.indexOf(row),
          firstBrokenId: entry.id,
          error: `prev_hash mismatch for row ${entry.id}`,
        }
      }

      const recomputedChain = computeChainHash(entry.eventHash, entry.prevHash, secret)
      if (recomputedChain !== entry.chainHash) {
        return {
          valid: false,
          checkedCount: rows.indexOf(row),
          firstBrokenId: entry.id,
          error: `chain_hash mismatch for row ${entry.id}`,
        }
      }

      expectedPrevHash = entry.eventHash
    }

    return { valid: true, checkedCount: rows.length, firstBrokenId: null, error: null }
  }
}

export const auditRepository = new AuditRepository()
