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
  private processingPromise: Promise<void> | null = null

  constructor(sender: OutboxSender) {
    this.sender = sender
  }

  start(intervalMs = 60000) {
    if (this.running) return
    this.running = true
    this.intervalId = setInterval(() => {
      this.processingPromise = this.process().finally(() => {
        this.processingPromise = null
      })
    }, intervalMs)
    logger.info('OutboxWorker started', { intervalMs })
  }

  async stop() {
    this.running = false
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    if (this.processingPromise) {
      logger.info('OutboxWorker waiting for in-progress task to complete...')
      await this.processingPromise
    }
    logger.info('OutboxWorker stopped')
  }

  async process() {
    const failed = await outboxStore.listByStatus(OutboxStatus.FAILED)
    for (const item of failed) {
      if (item.retryCount >= MAX_RETRY_COUNT) {
        await outboxStore.markDead(item.id, 'Max retry count reached')
        logger.warn('Outbox item moved to dead letter state', {
          outboxId: item.id,
          txId: item.txId,
          retryCount: item.retryCount,
        })
        continue
      }
      if (!shouldRetry(item)) continue
      logger.info('Retrying outbox item', {
        outboxId: item.id,
        txId: item.txId,
        retryCount: item.retryCount,
        lastError: item.lastError,
      })
      // sender.send handles updating retry info and status in store
      await this.sender.send(item)
    }
  }
}
