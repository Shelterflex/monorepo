import { logger } from '../utils/logger.js'
import { runReconciliationPass } from './engine.js'
import { runResolutionPass } from './resolver.js'
import type { ToleranceRule } from './types.js'

const RECON_INTERVAL_MS = parseInt(process.env.RECONCILIATION_INTERVAL_MS ?? '60000', 10)
const RECON_BATCH_SIZE  = parseInt(process.env.RECONCILIATION_BATCH_SIZE  ?? '200',   10)

export class ReconciliationWorker {
  private interval: NodeJS.Timeout | null = null
  private processingPromise: Promise<void> | null = null

  constructor(private readonly toleranceRules?: ToleranceRule[]) {}

  start(intervalMs = RECON_INTERVAL_MS) {
    if (this.interval) return
    logger.info('[ReconciliationWorker] Starting', { intervalMs, batchSize: RECON_BATCH_SIZE })
    this.interval = setInterval(() => {
      this.processingPromise = this.poll().finally(() => {
        this.processingPromise = null
      })
    }, intervalMs)
  }

  async stop() {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    if (this.processingPromise) {
      logger.info('[ReconciliationWorker] Waiting for in-progress pass to complete...')
      await this.processingPromise
    }
    logger.info('[ReconciliationWorker] Stopped')
  }

  async poll() {
    try {
      const reconResult = await runReconciliationPass(this.toleranceRules, RECON_BATCH_SIZE)
      logger.info('[ReconciliationWorker] Reconciliation pass done', reconResult)

      const resolveResult = await runResolutionPass()
      logger.info('[ReconciliationWorker] Resolution pass done', resolveResult)
    } catch (err) {
      logger.error('[ReconciliationWorker] Poll failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}
