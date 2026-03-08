import { randomUUID } from 'node:crypto'
import {
  OutboxStatus,
  TxType,
  type OutboxItem,
  type CreateOutboxItemInput,
  type CanonicalExternalRefV1,
} from './types.js'
import { computeTxId, buildCanonicalString } from './canonicalization.js'

/**
 * In-memory outbox store
 *
 * MVP implementation using Map for storage.
 * Designed to be easily replaced with database persistence.
 */
class OutboxStore {
  public items = new Map<string, OutboxItem>()
  private refIndex = new Map<CanonicalExternalRefV1, string>() // ref -> id mapping

  /**
   * Create a new outbox item
   * Returns existing item if canonicalExternalRefV1 already exists (idempotent)
   */
  async create(input: CreateOutboxItemInput): Promise<OutboxItem> {
    // Build canonical string from source and ref
    const canonicalExternalRefV1 = buildCanonicalString(input.source, input.ref)

    // Check if item already exists for this external reference
    const existingId = this.refIndex.get(canonicalExternalRefV1)
    if (existingId) {
      const existing = this.items.get(existingId)
      if (existing) {
        return existing
      }
    }

    // Compute deterministic tx_id from source and ref only
    const txId = computeTxId(input.source, input.ref)

    const now = new Date()
    const item: OutboxItem = {
      id: randomUUID(),
      txType: input.txType,
      canonicalExternalRefV1,
      txId,
      payload: input.payload,
      status: OutboxStatus.PENDING,
      attempts: 0,

      lastError: "",
      aggregateId: input.aggregateId ?? "",
      aggregateType: input.aggregateType ?? "",
      eventType: input.eventType ?? "",
      nextRetryAt: null,
      processedAt: null,
      retryCount: 0,

      createdAt: now,
      updatedAt: now,
    }

    this.items.set(item.id, item)
    this.refIndex.set(canonicalExternalRefV1, item.id)

    return item
  }

  /**
   * Get item by ID
   */
  async getById(id: string): Promise<OutboxItem | null> {
    return this.items.get(id) ?? null
  }

  /**
   * Get item by external reference
   */
  async getByExternalRef(source: string, ref: string): Promise<OutboxItem | null> {
    const canonical = buildCanonicalString(source, ref)
    const id = this.refIndex.get(canonical)
    if (!id) return null
    return this.items.get(id) ?? null
  }

  /**
   * List items by status
   */
  async listByStatus(status: OutboxStatus): Promise<OutboxItem[]> {
    const items: OutboxItem[] = []
    for (const item of this.items.values()) {
      if (item.status === status) {
        items.push(item)
      }
    }
    // Sort by createdAt ascending
    return items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }

  /**
   * Update item status
   */
  async updateStatus(
    id: string,
    status: OutboxStatus,
    error?: string,
  ): Promise<OutboxItem | null> {
    const item = this.items.get(id)
    if (!item) return null

    item.status = status
    item.attempts += 1
    item.updatedAt = new Date()

    if (error) {
      item.lastError = error
    }

    this.items.set(id, item)
    return item
  }

  /**
   * List items by dealId, optionally filtered by txType
   * Only returns items whose payload.dealId matches.
   */
  async listByDealId(dealId: string, txType?: TxType): Promise<OutboxItem[]> {
    const items: OutboxItem[] = []
    for (const item of this.items.values()) {
      if (item.payload.dealId !== dealId) continue
      if (txType !== undefined && item.txType !== txType) continue
      items.push(item)
    }
    // Sort by createdAt ascending (chronological order)
    return items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }

  /**
   * Get all items (for admin visibility)
   */
  async listAll(limit = 100): Promise<OutboxItem[]> {
    const items = Array.from(this.items.values())
    // Sort by createdAt descending (newest first)
    return items
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
  }

  /**
   * Clear all items (for testing)
   */
  async clear(): Promise<void> {
    this.items.clear()
    this.refIndex.clear()
  }
}

// Singleton instance
export const outboxStore = new OutboxStore()
