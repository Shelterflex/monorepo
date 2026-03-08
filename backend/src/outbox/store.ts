import { randomUUID } from 'node:crypto'
import {
  OutboxStatus,
  type OutboxItem,
  type CreateOutboxItemInput,
  type CanonicalExternalRefV1,
} from './types.js'
import { computeTxId } from './canonicalization.js'

/**
 * In-memory outbox store
 * 
 * MVP implementation using Map for storage.
 * Designed to be easily replaced with database persistence.
 */
class OutboxStore {
  private items = new Map<string, OutboxItem>()
  private refIndex = new Map<CanonicalExternalRefV1, string>() // ref -> id mapping

  /**
   * Create a new outbox item
   * Returns existing item if canonicalExternalRefV1 already exists (idempotent)
   */
  async create(input: CreateOutboxItemInput): Promise<OutboxItem> {
    // Check if item already exists for this external reference
    const existingId = this.refIndex.get(input.canonicalExternalRefV1)
    if (existingId) {
      const existing = this.items.get(existingId)
      if (existing) {
        return existing
      }
    }

    // Compute deterministic tx_id
    const txId = computeTxId({
      txType: input.txType,
      externalRef: input.canonicalExternalRefV1,
      payload: input.payload,
    })

    const now = new Date()
    const item: OutboxItem = {
      id: randomUUID(),
      txType: input.txType,
      canonicalExternalRefV1: input.canonicalExternalRefV1,
      txId,
      payload: input.payload,
      status: OutboxStatus.PENDING,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    }

    this.items.set(item.id, item)
    this.refIndex.set(input.canonicalExternalRefV1, item.id)

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
  async getByExternalRef(ref: CanonicalExternalRefV1): Promise<OutboxItem | null> {
    const id = this.refIndex.get(ref)
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
