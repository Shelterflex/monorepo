import { outboxStore } from './store.js'
import { OutboxSender } from './sender.js'
import { OutboxStatus, type OutboxItem } from './types.js'
import { logger } from '../utils/logger.js'

const MAX_RETRY_COUNT = 10
const BASE_BACKOFF_MS = 1000 // 1 second

function getBackoffMs(retryCount: number): number {
  // Exponential backoff: 2^retryCount * BASE_BACKOFF_MS, capped at 1 hour
  return Math.min(Math.pow(2, retryCount) * BASE_BACKOFF_MS, 60 * 60 * 1000)
}

function shouldRetry(item: OutboxItem): boolean {
  if (item.retryCount >= MAX_RETRY_COUNT) return false
  if (!item.nextRetryAt) return true // If never scheduled, allow retry
  return Date.now() >= new Date(item.nextRetryAt).getTime()
}

export class OutboxWorker {
  private intervalId: NodeJS.Timeout | null = null
  private running = false
  private sender: OutboxSender

  constructor(sender: OutboxSender) {
    this.sender = sender
  }

  start(intervalMs = 60000) {
    if (this.running) return
    this.running = true
    this.intervalId = setInterval(() => this.process(), intervalMs)
    logger.info('OutboxWorker started', { intervalMs })
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId)
    this.running = false
    logger.info('OutboxWorker stopped')
  }

  async process() {
    const failed = await outboxStore.listByStatus(OutboxStatus.FAILED)
    for (const item of failed) {
      if (!shouldRetry(item)) continue
      logger.info('Retrying outbox item', {
        outboxId: item.id,
        txId: item.txId,
        retryCount: item.retryCount,
        lastError: item.lastError,
      })
      const success = await this.sender.send(item)
      // Update retry fields
      item.retryCount += 1
      item.nextRetryAt = new Date(Date.now() + getBackoffMs(item.retryCount))
      item.processedAt = new Date()
      await outboxStore.updateStatus(item.id, success ? OutboxStatus.SENT : OutboxStatus.FAILED, item.lastError)
      // Persist retry fields (in real DB, update these fields)
      outboxStore.items.set(item.id, item)
    }
  }
}
