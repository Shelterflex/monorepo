import { logger } from '../../utils/logger.js'
import { JobStatus, JobRunStatus, type ScheduledJob, type JobHandler, type CreateJobInput } from './types.js'
import { getJobStore } from './store.js'
import { getNextCronTime } from './cron.js'

const BASE_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 60 * 60 * 1000 // 1 hour
const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const STALE_LEASE_RECOVERY_INTERVAL_MS = 60 * 1000 // 1 minute

function getBackoffMs(retryCount: number): number {
  return Math.min(Math.pow(2, retryCount) * BASE_BACKOFF_MS, MAX_BACKOFF_MS)
}

export class JobScheduler {
  private handlers = new Map<string, JobHandler>()
  private intervalId: NodeJS.Timeout | null = null
  private recoveryIntervalId: NodeJS.Timeout | null = null
  private running = false
  private processingPromise: Promise<void> | null = null
  private workerId: string

  constructor(
    private readonly pollIntervalMs: number = 5000,
    private readonly leaseTtlMs: number = DEFAULT_LEASE_TTL_MS,
  ) {
    this.workerId = `worker-${crypto.randomUUID()}`
  }

  /**
   * Register a handler function for a given handler key.
   * Handlers must be idempotent — they may be called more than once for the same job.
   */
  registerHandler(handlerKey: string, handler: JobHandler): void {
    this.handlers.set(handlerKey, handler)
  }

  /** Enqueue a new job. */
  async schedule(input: CreateJobInput): Promise<ScheduledJob> {
    return getJobStore().create(input)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.intervalId = setInterval(() => {
      this.processingPromise = this.tick().finally(() => {
        this.processingPromise = null
      })
    }, this.pollIntervalMs)

    // Start stale lease recovery
    this.recoveryIntervalId = setInterval(() => {
      this.recoverStaleLeases().catch(err => {
        logger.error('Failed to recover stale leases', { error: err instanceof Error ? err.message : String(err) })
      })
    }, STALE_LEASE_RECOVERY_INTERVAL_MS)

    logger.info('JobScheduler started', { pollIntervalMs: this.pollIntervalMs, workerId: this.workerId, leaseTtlMs: this.leaseTtlMs })
  }

  async stop(): Promise<void> {
    this.running = false
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    if (this.recoveryIntervalId) {
      clearInterval(this.recoveryIntervalId)
      this.recoveryIntervalId = null
    }
    if (this.processingPromise) {
      logger.info('JobScheduler waiting for in-progress tick to complete...')
      await this.processingPromise
    }
    logger.info('JobScheduler stopped')
  }

  private async recoverStaleLeases(): Promise<void> {
    const store = getJobStore()
    const recovered = await store.recoverStaleLeases()
    if (recovered > 0) {
      logger.info('Recovered stale leases', { count: recovered })
    }
  }

  async tick(): Promise<void> {
    const dueJobs = await getJobStore().listDue()
    for (const job of dueJobs) {
      await this.executeJob(job)
    }
  }

  private async executeJob(job: ScheduledJob): Promise<void> {
    const store = getJobStore()
    const handler = this.handlers.get(job.handler)

    if (!handler) {
      logger.warn('No handler registered for job', { jobId: job.id, handler: job.handler })
      await store.markDead(job.id, `No handler registered for "${job.handler}"`)
      return
    }

    // Try to acquire lease before executing
    const leaseAcquired = await store.tryAcquireLease(job.id, this.workerId, this.leaseTtlMs)
    if (!leaseAcquired) {
      logger.debug('Job lease already held by another worker, skipping', { jobId: job.id, workerId: this.workerId })
      return
    }

    logger.info('Job lease acquired', { jobId: job.id, workerId: this.workerId })

    // Record job run start
    let runId: string | null = null
    try {
      runId = await store.recordJobRun(job.id, job.name, job.handler, this.workerId, job.payload)
    } catch (err) {
      logger.error('Failed to record job run', { jobId: job.id, error: err instanceof Error ? err.message : String(err) })
    }

    await store.markRunning(job.id)
    logger.info('Executing job', {
      jobId: job.id,
      name: job.name,
      handler: job.handler,
      runCount: job.runCount,
      workerId: this.workerId,
    })

    try {
      await handler(job)

      // For recurring jobs, compute and set the next run time from the cron expression
      let nextRunAt: Date | undefined
      if (job.cronExpression) {
        nextRunAt = getNextCronTime(job.cronExpression)
      }

      await store.markCompleted(job.id, nextRunAt)
      await store.releaseLease(job.id, this.workerId)

      if (runId) {
        await store.completeJobRun(runId, JobRunStatus.COMPLETED)
      }

      logger.info('Job completed successfully', {
        jobId: job.id,
        name: job.name,
        recurring: !!nextRunAt,
        nextRunAt,
        workerId: this.workerId,
      })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      logger.error('Job execution failed', {
        jobId: job.id,
        name: job.name,
        error,
        retryCount: job.retryCount,
        maxRetries: job.maxRetries,
        workerId: this.workerId,
      })

      await store.releaseLease(job.id, this.workerId)

      if (runId) {
        await store.completeJobRun(runId, JobRunStatus.FAILED, error)
      }

      if (job.retryCount >= job.maxRetries) {
        await store.markDead(job.id, error)
        logger.warn('Job moved to dead state — max retries exceeded', {
          jobId: job.id,
          name: job.name,
          maxRetries: job.maxRetries,
        })
      } else {
        const nextRetryAt = new Date(Date.now() + getBackoffMs(job.retryCount))
        await store.markFailed(job.id, error, nextRetryAt)
        logger.info('Job scheduled for retry with exponential backoff', {
          jobId: job.id,
          name: job.name,
          nextRetryAt,
          attempt: job.retryCount + 1,
          maxRetries: job.maxRetries,
        })
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton
// ---------------------------------------------------------------------------

let scheduler: JobScheduler | null = null

export function getScheduler(): JobScheduler {
  if (!scheduler) scheduler = new JobScheduler()
  return scheduler
}

export function initScheduler(instance: JobScheduler): void {
  scheduler = instance
}
