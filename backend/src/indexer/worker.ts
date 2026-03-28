import { SorobanAdapter } from '../soroban/adapter.js'
import { ReceiptRepository } from './receipt-repository.js'
import { parseReceiptEvent } from './event-parser.js'
import { logger } from '../utils/logger.js'

export interface IndexerConfig {
  pollIntervalMs: number
  startLedger?: number
  /** Max consecutive failures before triggering failureBehavior. Default: 5 */
  maxConsecutiveFailures?: number
  /**
   * Behavior when max consecutive failures reached:
   * - 'exit': Stop the indexer (throw error)
   * - 'pause': Stop polling but keep process alive (manual intervention needed)
   * - 'continue': Keep running (for dev/demo environments)
   * Default: 'exit' (production-safe default)
   */
  failureBehavior?: 'exit' | 'pause' | 'continue'
  /** Base backoff in ms. Default: 1000 */
  backoffBaseMs?: number
  /** Max backoff in ms. Default: 60000 (1 minute) */
  backoffMaxMs?: number
}

export interface IndexerMetrics {
  receiptsIndexed: number
  checkpointLedger: number | null
  lastPollDurationMs: number
  lastPollTimestamp: string | null
  consecutiveFailures: number
  totalFailures: number
  isRunning: boolean
  isPaused: boolean
}

export class ReceiptIndexer {
  private running = false
  private paused = false
  private lastLedger: number | null = null
  private latestSeenLedger: number | null = null
  private consecutiveFailures = 0
  private totalFailures = 0
  private receiptsIndexed = 0
  private lastPollDurationMs = 0
  private lastPollTimestamp: string | null = null
  private currentBackoffMs: number
  private readonly maxConsecutiveFailures: number
  private readonly failureBehavior: 'exit' | 'pause' | 'continue'
  private readonly backoffBaseMs: number
  private readonly backoffMaxMs: number

  constructor(
    private adapter: SorobanAdapter,
    private repo: ReceiptRepository,
    private config: IndexerConfig
  ) {
    this.maxConsecutiveFailures = config.maxConsecutiveFailures ?? 5
    this.failureBehavior = config.failureBehavior ?? 'exit'
    this.backoffBaseMs = config.backoffBaseMs ?? 1000
    this.backoffMaxMs = config.backoffMaxMs ?? 60000
    this.currentBackoffMs = this.config.pollIntervalMs
  }

  private stopPromise: Promise<void> | null = null
  private resolveStop: (() => void) | null = null

  async start(): Promise<void> {
    if (this.running) {
      logger.warn('[Indexer] Already running, ignoring start() call')
      return
    }

    this.running = true
    this.paused = false
    this.stopPromise = new Promise(resolve => {
      this.resolveStop = resolve
    })

    // Load checkpoint from database or use config startLedger
    const checkpoint = await this.repo.getCheckpoint()
    this.lastLedger = checkpoint ?? this.config.startLedger ?? null
    this.latestSeenLedger = this.lastLedger

    logger.info('[Indexer] Starting', {
      fromLedger: this.lastLedger ?? 'latest',
      pollIntervalMs: this.config.pollIntervalMs,
      maxConsecutiveFailures: this.maxConsecutiveFailures,
      failureBehavior: this.failureBehavior,
    })

    try {
      while (this.running) {
        // If paused, wait and check again
        if (this.paused) {
          await this.sleep(5000)
          continue
        }

        const pollStart = Date.now()
        this.lastPollTimestamp = new Date().toISOString()

        try {
          const indexed = await this.poll()

          // Reset backoff on success
          this.consecutiveFailures = 0
          this.currentBackoffMs = this.config.pollIntervalMs

          // Log successful poll with metrics
          logger.info('[Indexer] Poll completed', {
            receiptsIndexedThisPoll: indexed,
            totalReceiptsIndexed: this.receiptsIndexed,
            checkpointLedger: this.lastLedger,
            latestSeenLedger: this.latestSeenLedger,
            pollDurationMs: this.lastPollDurationMs,
          })
        } catch (err) {
          this.consecutiveFailures++
          this.totalFailures++

          const errorMessage = err instanceof Error ? err.message : String(err)
          logger.error('[Indexer] Poll failed', {
            consecutiveFailures: this.consecutiveFailures,
            totalFailures: this.totalFailures,
            maxConsecutiveFailures: this.maxConsecutiveFailures,
            error: errorMessage,
            checkpointLedger: this.lastLedger,
          }, err)

          // Check if we've exceeded max consecutive failures
          if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
            await this.handleMaxFailures(err)
          }
        } finally {
          this.lastPollDurationMs = Date.now() - pollStart
        }

        // Apply backoff before next poll
        if (this.running) {
          await this.sleep(this.currentBackoffMs)
        }

        // Exponential backoff for next failure (capped at max)
        if (this.consecutiveFailures > 0) {
          const jitter = Math.floor(Math.random() * 250)
          this.currentBackoffMs = Math.min(
            this.backoffMaxMs,
            this.backoffBaseMs * Math.pow(2, this.consecutiveFailures - 1) + jitter
          )
          logger.warn('[Indexer] Increasing backoff', {
            nextBackoffMs: this.currentBackoffMs,
            consecutiveFailures: this.consecutiveFailures,
          })
        }
      }
    } finally {
      this.running = false
      if (this.resolveStop) {
        this.resolveStop()
      }
      logger.info('[Indexer] Stopped')
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return
    logger.info('[Indexer] Stopping...')
    this.running = false
    this.paused = false
    if (this.stopPromise) {
      await this.stopPromise
    }
  }

  pause(): void {
    if (!this.running || this.paused) return
    logger.warn('[Indexer] Pausing due to max failures. Manual intervention required.')
    this.paused = true
  }

  resume(): void {
    if (!this.running || !this.paused) return
    logger.info('[Indexer] Resuming from paused state')
    this.consecutiveFailures = 0
    this.currentBackoffMs = this.config.pollIntervalMs
    this.paused = false
  }

  getMetrics(): IndexerMetrics {
    return {
      receiptsIndexed: this.receiptsIndexed,
      checkpointLedger: this.lastLedger,
      lastPollDurationMs: this.lastPollDurationMs,
      lastPollTimestamp: this.lastPollTimestamp,
      consecutiveFailures: this.consecutiveFailures,
      totalFailures: this.totalFailures,
      isRunning: this.running,
      isPaused: this.paused,
    }
  }

  private async poll(): Promise<number> {
    const events = await this.adapter.getReceiptEvents(this.lastLedger)

    if (!events || !events.length) {
      return 0
    }

    // Track the maximum ledger seen for gap detection
    const maxEventLedger = Math.max(...events.map(e => e.ledger))

    // Ledger-gap safety: If we see a ledger significantly ahead of our last checkpoint,
    // it means ledgers were skipped. We still process what we got, but log a warning.
    if (this.latestSeenLedger !== null && maxEventLedger > this.latestSeenLedger + 1) {
      const gap = maxEventLedger - this.latestSeenLedger - 1
      logger.warn('[Indexer] Ledger gap detected', {
        fromLedger: this.latestSeenLedger,
        toLedger: maxEventLedger,
        gapSize: gap,
        eventsInRange: events.length,
      })
    }

    // Update the latest seen ledger for gap detection
    this.latestSeenLedger = Math.max(this.latestSeenLedger ?? 0, maxEventLedger)

    // Parse and store receipts
    const receipts = events.map(parseReceiptEvent)
    await this.repo.upsertMany(receipts)

    // Ledger-gap safety: Always advance checkpoint to the maximum ledger seen
    // This ensures we don't re-process events even if ledgers were skipped
    await this.repo.saveCheckpoint(maxEventLedger)
    this.lastLedger = maxEventLedger
    this.receiptsIndexed += events.length

    return events.length
  }

  private async handleMaxFailures(err: unknown): Promise<void> {
    const errorMessage = err instanceof Error ? err.message : String(err)

    switch (this.failureBehavior) {
      case 'exit':
        logger.error('[Indexer] Max consecutive failures reached, exiting', {
          consecutiveFailures: this.consecutiveFailures,
          lastError: errorMessage,
        })
        this.running = false
        throw new Error(`Indexer failed ${this.consecutiveFailures} consecutive times: ${errorMessage}`)

      case 'pause':
        logger.error('[Indexer] Max consecutive failures reached, pausing', {
          consecutiveFailures: this.consecutiveFailures,
          lastError: errorMessage,
        })
        this.pause()
        break

      case 'continue':
        logger.warn('[Indexer] Max consecutive failures reached, continuing (failureBehavior=continue)', {
          consecutiveFailures: this.consecutiveFailures,
          lastError: errorMessage,
        })
        // Reset counter to prevent log spam, but keep the backoff
        this.consecutiveFailures = Math.floor(this.maxConsecutiveFailures / 2)
        break
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms))
  }
}