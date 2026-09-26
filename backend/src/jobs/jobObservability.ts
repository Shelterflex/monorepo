/**
 * Job & worker observability (#1449)
 *
 * The characteristic failure of background work is silence: a job that stops
 * being scheduled produces no error and no user-visible symptom until something
 * downstream is found to be stale. This module makes two things detectable:
 *
 *  1. A run that happened but did no work — every run records its
 *     `recordsProcessed`, not merely that it completed.
 *  2. A run that never happened — every job declares an expected interval, and
 *     `job_overdue` / `job_seconds_since_last_run` turn an *absence* into a
 *     positive signal an operator can alert on.
 *
 * Overrun policy: `observeJobRun` refuses to start a second in-process run of
 * the same job while one is still in flight (counted as `skipped_overrun`).
 * Scheduler-driven jobs are additionally serialised across processes by the
 * lease + fencing token in `scheduler/store.ts`.
 */

import client from 'prom-client'
import { metricsRegister } from '../metrics.js'
import { getRequestContext } from '../request-context.js'
import { logger } from '../utils/logger.js'

// ── Inventory ────────────────────────────────────────────────────────────────

export interface JobInventoryEntry {
  /** Stable job key used as the metric label and health-report id. */
  name: string
  /** Source module implementing the job. */
  module: string
  /** What the job does. */
  does: string
  /** How often it is expected to run, in milliseconds. */
  expectedIntervalMs: number
  /** Consequence of the job silently not running. */
  ifItDoesNotRun: string
  /** What a healthy run looks like, so an operator can tell normal from abnormal. */
  healthy: string
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

export const JOB_INVENTORY: readonly JobInventoryEntry[] = [
  {
    name: 'late-payment-escalation',
    module: 'src/jobs/latePaymentJob.ts',
    does: 'Walks active deals and applies the late-payment escalation matrix.',
    expectedIntervalMs: 6 * HOUR,
    ifItDoesNotRun: 'Late tenants are never escalated; arrears accrue with no notice sent.',
    healthy: 'Runs every 6h in seconds, records 0 processed on a day with no late deals — a rising count is the abnormal case.',
  },
  {
    name: 'staking-finalizer',
    module: 'src/jobs/stakingFinalizer.ts',
    does: 'Finalises staking for completed conversions (idempotent per conversion).',
    expectedIntervalMs: 10_000,
    ifItDoesNotRun: 'Completed conversions never finalise; staked balances stay invisible to the tenant.',
    healthy: 'Runs every 10s, usually 0 processed; sustained non-zero counts mean conversions are backing up.',
  },
  {
    name: 'data-retention',
    module: 'src/jobs/dataRetentionJob.ts',
    does: 'Deletes stale onboarding drafts, anonymises KYC rejections, expires erasure requests.',
    expectedIntervalMs: DAY,
    ifItDoesNotRun: 'Personal data is retained past its policy window — a compliance breach, not a bug.',
    healthy: 'One run per day; small non-zero counts are normal, a sudden spike means a retention window changed.',
  },
  {
    name: 'monthly-deduction-reminder',
    module: 'src/jobs/monthlyDeductionReminderJob.ts',
    does: 'Sends advance salary-deduction notices to employer webhooks for the coming pay cycle.',
    expectedIntervalMs: DAY,
    ifItDoesNotRun: 'Employers deduct without notice, or do not deduct at all — a missed rent cycle.',
    healthy: 'One run per day; non-zero only in the days before a pay cycle.',
  },
  {
    name: 'scheduler',
    module: 'src/jobs/scheduler/worker.ts',
    does: 'Leases and executes due rows in the scheduled_jobs table (notifications, webhooks, purges).',
    expectedIntervalMs: 5_000,
    ifItDoesNotRun: 'Nothing queued is ever executed: notifications, webhook deliveries and purges stall silently.',
    healthy: 'A tick every 5s, recordsProcessed = number of due rows claimed. Individual queued runs are in GET /api/admin/jobs/{id}/history.',
  },
] as const

const INVENTORY_BY_NAME = new Map(JOB_INVENTORY.map(entry => [entry.name, entry]))

// ── Metrics ──────────────────────────────────────────────────────────────────

export const jobRunsTotal = new client.Counter({
  name: 'job_runs_total',
  help: 'Job runs by outcome. status=skipped_overrun means a previous run was still in flight.',
  labelNames: ['job', 'status'] as const,
  registers: [metricsRegister],
})

export const jobRunDurationMs = new client.Histogram({
  name: 'job_run_duration_ms',
  help: 'Job run wall-clock duration in milliseconds.',
  labelNames: ['job'] as const,
  buckets: [10, 50, 250, 1000, 5000, 30_000, 120_000, 600_000],
  registers: [metricsRegister],
})

export const jobRecordsProcessedTotal = new client.Counter({
  name: 'job_records_processed_total',
  help: 'Records processed by a job. A completed run that processed nothing is not the same as a healthy run.',
  labelNames: ['job'] as const,
  registers: [metricsRegister],
})

export const jobLastSuccessTimestampSeconds = new client.Gauge({
  name: 'job_last_success_timestamp_seconds',
  help: 'Unix timestamp of the last successful run of each job.',
  labelNames: ['job'] as const,
  registers: [metricsRegister],
})

/**
 * Absence detection. Both gauges are computed at scrape time so a job that has
 * simply stopped being scheduled keeps drifting upward instead of freezing at
 * its last reported value.
 */
export const jobSecondsSinceLastRun = new client.Gauge({
  name: 'job_seconds_since_last_run',
  help: 'Seconds since the last run of each job. Grows without bound when a job stops running.',
  labelNames: ['job'] as const,
  registers: [metricsRegister],
  collect() {
    for (const entry of JOB_INVENTORY) {
      this.set({ job: entry.name }, secondsSinceLastRun(entry))
    }
  },
})

export const jobOverdue = new client.Gauge({
  name: 'job_overdue',
  help: '1 when a job has not run within twice its expected interval (includes never having run), else 0.',
  labelNames: ['job'] as const,
  registers: [metricsRegister],
  collect() {
    for (const entry of JOB_INVENTORY) {
      this.set({ job: entry.name }, isOverdue(entry) ? 1 : 0)
    }
  },
})

// ── Run state ────────────────────────────────────────────────────────────────

export type JobRunOutcome = 'completed' | 'failed' | 'skipped_overrun'

export interface JobRunRecord {
  job: string
  startedAt: string
  finishedAt: string
  durationMs: number
  outcome: JobRunOutcome
  recordsProcessed: number
  correlationId: string | null
  error?: string
}

interface JobState {
  inFlight: boolean
  lastRun: JobRunRecord | null
  lastSuccessAt: number | null
  consecutiveFailures: number
}

const state = new Map<string, JobState>()

function getState(job: string): JobState {
  let s = state.get(job)
  if (!s) {
    s = { inFlight: false, lastRun: null, lastSuccessAt: null, consecutiveFailures: 0 }
    state.set(job, s)
  }
  return s
}

/** Grace factor applied to the expected interval before a job is called overdue. */
const OVERDUE_INTERVAL_FACTOR = 2

function secondsSinceLastRun(entry: JobInventoryEntry): number {
  const last = state.get(entry.name)?.lastRun
  if (!last) return -1
  return Math.max(0, Math.round((Date.now() - Date.parse(last.startedAt)) / 1000))
}

function isOverdue(entry: JobInventoryEntry): boolean {
  const elapsed = secondsSinceLastRun(entry)
  if (elapsed < 0) return true // never ran — the absence this issue is about
  return elapsed * 1000 > entry.expectedIntervalMs * OVERDUE_INTERVAL_FACTOR
}

export interface JobRunResult {
  /** Number of records the run actually acted on. */
  recordsProcessed?: number
}

/**
 * Run `fn` as an observed job run.
 *
 * Never throws: a job's failure is recorded and swallowed so an interval loop
 * is not torn down by one bad run. The error is available in the health report
 * and in the structured log line, both carrying the correlation id.
 */
export async function observeJobRun(
  job: string,
  fn: () => Promise<JobRunResult | number | void>,
): Promise<JobRunRecord> {
  const s = getState(job)
  const correlationId = getRequestContext()?.requestId ?? null
  const startedAtMs = Date.now()
  const startedAt = new Date(startedAtMs).toISOString()

  if (s.inFlight) {
    // Deliberate overrun policy: skip rather than stack concurrent instances.
    jobRunsTotal.inc({ job, status: 'skipped_overrun' })
    logger.warn('Job run skipped — previous run still in flight', { job, correlationId })
    const record: JobRunRecord = {
      job,
      startedAt,
      finishedAt: startedAt,
      durationMs: 0,
      outcome: 'skipped_overrun',
      recordsProcessed: 0,
      correlationId,
    }
    return record
  }

  s.inFlight = true
  logger.info('Job run started', { job, startedAt, correlationId })

  let outcome: JobRunOutcome = 'completed'
  let recordsProcessed = 0
  let error: string | undefined

  try {
    const result = await fn()
    if (typeof result === 'number') recordsProcessed = result
    else if (result && typeof result.recordsProcessed === 'number') recordsProcessed = result.recordsProcessed
  } catch (err) {
    outcome = 'failed'
    error = err instanceof Error ? err.message : String(err)
  } finally {
    s.inFlight = false
  }

  const durationMs = Date.now() - startedAtMs
  const record: JobRunRecord = {
    job,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs,
    outcome,
    recordsProcessed,
    correlationId,
    ...(error ? { error } : {}),
  }

  s.lastRun = record
  jobRunsTotal.inc({ job, status: outcome })
  jobRunDurationMs.observe({ job }, durationMs)
  if (recordsProcessed > 0) jobRecordsProcessedTotal.inc({ job }, recordsProcessed)

  if (outcome === 'completed') {
    s.lastSuccessAt = Date.now()
    s.consecutiveFailures = 0
    jobLastSuccessTimestampSeconds.set({ job }, Math.floor(s.lastSuccessAt / 1000))
    logger.info('Job run completed', { job, durationMs, recordsProcessed, correlationId })
  } else {
    s.consecutiveFailures += 1
    logger.error('Job run failed', {
      job,
      durationMs,
      recordsProcessed,
      correlationId,
      consecutiveFailures: s.consecutiveFailures,
      error,
    })
  }

  return record
}

// ── Health report ────────────────────────────────────────────────────────────

export type JobHealthState = 'healthy' | 'failing' | 'overdue' | 'never_ran'

export interface JobHealth extends JobInventoryEntry {
  state: JobHealthState
  overdue: boolean
  secondsSinceLastRun: number | null
  lastRun: JobRunRecord | null
  lastSuccessAt: string | null
  consecutiveFailures: number
}

export interface JobHealthReport {
  capturedAt: string
  overdueCount: number
  failingCount: number
  jobs: JobHealth[]
}

export function getJobHealthReport(): JobHealthReport {
  const jobs: JobHealth[] = JOB_INVENTORY.map(entry => {
    const s = state.get(entry.name)
    const elapsed = secondsSinceLastRun(entry)
    const overdue = isOverdue(entry)
    const jobState: JobHealthState = !s?.lastRun
      ? 'never_ran'
      : s.lastRun.outcome === 'failed'
        ? 'failing'
        : overdue
          ? 'overdue'
          : 'healthy'

    return {
      ...entry,
      state: jobState,
      overdue,
      secondsSinceLastRun: elapsed < 0 ? null : elapsed,
      lastRun: s?.lastRun ?? null,
      lastSuccessAt: s?.lastSuccessAt ? new Date(s.lastSuccessAt).toISOString() : null,
      consecutiveFailures: s?.consecutiveFailures ?? 0,
    }
  })

  return {
    capturedAt: new Date().toISOString(),
    overdueCount: jobs.filter(j => j.overdue).length,
    failingCount: jobs.filter(j => j.state === 'failing').length,
    jobs,
  }
}

/**
 * Sums the numeric fields of a job's own result object into a single
 * records-processed figure, so each job reports work done without having to
 * hand-maintain a count.
 */
export function sumCounts(result: Record<string, unknown> | object): number {
  return Object.values(result as Record<string, unknown>).reduce<number>(
    (total, value) => (typeof value === 'number' && Number.isFinite(value) ? total + value : total),
    0,
  )
}

/** Test hook — clears recorded run state. */
export function resetJobObservability(): void {
  state.clear()
}

/** Inventory lookup, exported for the docs test that keeps the table honest. */
export function getJobInventoryEntry(name: string): JobInventoryEntry | undefined {
  return INVENTORY_BY_NAME.get(name)
}
