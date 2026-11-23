import { getPool } from '../db.js'
import { logger } from '../utils/logger.js'
import { observeJobRun, sumCounts } from './jobObservability.js'
import { expireReadyExports } from '../services/tenantDataExportService.js'
import { processDueErasures } from '../services/erasureService.js'

export interface DataRetentionResult {
  onboardingDraftsDeleted: number
  kycRejectionsAnonymised: number
  supportMessagesDeleted: number
  /** Tenant data-export archives deleted after their 7-day window (#2052). */
  dataExportsExpired: number
  /** Account erasures whose grace window ended and whose identity fields were anonymized (#2053). */
  erasuresCompleted: number
}

/** Runs one retention step. A failure is logged and counted as zero, so the other steps still run. */
async function runStep<T>(name: string, step: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await step()
  } catch (error) {
    logger.error(`DataRetentionJob step failed: ${name}`, {
      error: error instanceof Error ? error.message : String(error),
    })
    return fallback
  }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Enforces data retention policy:
 * - Onboarding drafts (unsubmitted) older than 6 months → deleted
 * - KYC rejection records older than 2 years → anonymised
 * - Support messages older than 3 years → deleted
 * - Compliance reports → kept (7-year retention handled separately)
 */
export class DataRetentionJob {
  private interval: NodeJS.Timeout | null = null
  private processingPromise: Promise<void> | null = null

  constructor(private pollIntervalMs: number = 24 * 60 * 60 * 1000) {}

  start(): void {
    if (this.interval) return
    logger.info('Starting DataRetentionJob', { pollIntervalMs: this.pollIntervalMs })
    void this.poll()
    this.interval = setInterval(() => {
      this.processingPromise = this.poll().finally(() => {
        this.processingPromise = null
      })
    }, this.pollIntervalMs)
    if (this.interval.unref) this.interval.unref()
  }

  async stop(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    if (this.processingPromise) {
      await this.processingPromise
    }
    logger.info('Stopped DataRetentionJob')
  }

  async poll(now = new Date()): Promise<void> {
    await observeJobRun('data-retention', async () => {
      const result = await this.runRetention(now)
      return { recordsProcessed: sumCounts(result) }
    })
  }

  async runRetention(now = new Date()): Promise<DataRetentionResult> {
    const result: DataRetentionResult = {
      onboardingDraftsDeleted: 0,
      kycRejectionsAnonymised: 0,
      supportMessagesDeleted: 0,
      dataExportsExpired: 0,
      erasuresCompleted: 0,
    }

    try {
      const started = Date.now()
      const pool = await getPool()
      if (!pool) {
        logger.warn('DataRetentionJob skipped: no database configured')
        return result
      }

      const sixMonthsAgo = new Date(now.getTime() - 180 * MS_PER_DAY)
      const twoYearsAgo = new Date(now.getTime() - 730 * MS_PER_DAY)
      const threeYearsAgo = new Date(now.getTime() - 1095 * MS_PER_DAY)

      const drafts = await pool.query(
        `DELETE FROM onboarding_drafts
         WHERE submitted = FALSE AND updated_at < $1
         RETURNING id`,
        [sixMonthsAgo],
      )
      result.onboardingDraftsDeleted = drafts.rowCount ?? 0

      const kyc = await pool.query(
        `UPDATE kyc_documents SET
           front_image_key = '[RETENTION_PURGED]',
           back_image_key = '[RETENTION_PURGED]',
           liveness_signal = NULL,
           rejection_reason = NULL,
           updated_at = NOW()
         WHERE status = 'rejected' AND updated_at < $1
         RETURNING id`,
        [twoYearsAgo],
      )
      result.kycRejectionsAnonymised = kyc.rowCount ?? 0

      const support = await pool.query(
        `DELETE FROM support_messages WHERE created_at < $1 RETURNING message_id`,
        [threeYearsAgo],
      )
      result.supportMessagesDeleted = support.rowCount ?? 0

      result.dataExportsExpired = await runStep('expire data exports', () => expireReadyExports(now), 0)
      result.erasuresCompleted = await runStep(
        'process erasures',
        async () => (await processDueErasures(now)).completed,
        0,
      )


      logger.info('DataRetentionJob completed', { ...result, durationMs: Date.now() - started })
    } catch (error) {
      logger.error('DataRetentionJob poll failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }

    return result
  }
}

/** Run retention logic with a custom reference date (for tests). */
export async function runDataRetention(now: Date): Promise<DataRetentionResult> {
  const job = new DataRetentionJob()
  return job.runRetention(now)
}
