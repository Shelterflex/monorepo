import { getPool } from '../../db.js'
import { JobStatus, type ScheduledJob, type CreateJobInput, JobRunStatus, type JobRunHistory } from './types.js'

export interface JobStore {
  create(input: CreateJobInput): Promise<ScheduledJob>
  findById(id: string): Promise<ScheduledJob | null>
  /** Returns due jobs (pending/failed with next_run_at <= now), ordered by priority then time. */
  listDue(): Promise<ScheduledJob[]>
  listAll(filters?: { status?: JobStatus; limit?: number; offset?: number }): Promise<ScheduledJob[]>
  markRunning(id: string): Promise<void>
  markCompleted(id: string, nextRunAt?: Date): Promise<void>
  markFailed(id: string, error: string, nextRetryAt: Date): Promise<void>
  markDead(id: string, error: string): Promise<void>
  reschedule(id: string, nextRunAt: Date): Promise<void>
  cancel(id: string): Promise<void>
  // Lease-based deduplication
  tryAcquireLease(id: string, workerId: string, leaseTtlMs: number): Promise<boolean>
  releaseLease(id: string, workerId: string): Promise<void>
  recoverStaleLeases(): Promise<number>
  // Job run history
  recordJobRun(jobId: string, jobName: string, handler: string, workerId: string, payload: Record<string, unknown>): Promise<string>
  completeJobRun(runId: string, status: JobRunStatus, errorMessage?: string): Promise<void>
  getJobRunHistory(jobId: string, limit?: number): Promise<JobRunHistory[]>
}

// ---------------------------------------------------------------------------
// In-memory implementation (used in tests / no DATABASE_URL)
// ---------------------------------------------------------------------------

export class InMemoryJobStore implements JobStore {
  private jobs = new Map<string, ScheduledJob>()
  private runHistory = new Map<string, JobRunHistory>()

  async create(input: CreateJobInput): Promise<ScheduledJob> {
    const job: ScheduledJob = {
      id: crypto.randomUUID(),
      name: input.name,
      handler: input.handler,
      payload: input.payload ?? {},
      status: JobStatus.PENDING,
      priority: input.priority ?? 5,
      cronExpression: input.cronExpression ?? null,
      nextRunAt: input.nextRunAt ?? new Date(),
      lastRunAt: null,
      runCount: 0,
      retryCount: 0,
      maxRetries: input.maxRetries ?? 3,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      leaseHolder: null,
      leaseAcquiredAt: null,
      leaseExpiresAt: null,
    }
    this.jobs.set(job.id, job)
    return { ...job }
  }

  async findById(id: string): Promise<ScheduledJob | null> {
    const job = this.jobs.get(id)
    return job ? { ...job } : null
  }

  async listDue(): Promise<ScheduledJob[]> {
    const now = new Date()
    return Array.from(this.jobs.values())
      .filter(
        j =>
          (j.status === JobStatus.PENDING || j.status === JobStatus.FAILED) &&
          j.nextRunAt <= now,
      )
      .sort((a, b) => a.priority - b.priority || a.nextRunAt.getTime() - b.nextRunAt.getTime())
      .map(j => ({ ...j }))
  }

  async listAll(filters?: { status?: JobStatus; limit?: number; offset?: number }): Promise<ScheduledJob[]> {
    let results = Array.from(this.jobs.values())
    if (filters?.status) results = results.filter(j => j.status === filters.status)
    const offset = filters?.offset ?? 0
    const limit = filters?.limit ?? 50
    return results.slice(offset, offset + limit).map(j => ({ ...j }))
  }

  async markRunning(id: string): Promise<void> {
    const job = this.jobs.get(id)
    if (!job) return
    job.status = JobStatus.RUNNING
    job.lastRunAt = new Date()
    job.updatedAt = new Date()
  }

  async markCompleted(id: string, nextRunAt?: Date): Promise<void> {
    const job = this.jobs.get(id)
    if (!job) return
    job.status = nextRunAt ? JobStatus.PENDING : JobStatus.COMPLETED
    job.runCount++
    job.retryCount = 0
    job.lastError = null
    if (nextRunAt) job.nextRunAt = nextRunAt
    job.updatedAt = new Date()
  }

  async markFailed(id: string, error: string, nextRetryAt: Date): Promise<void> {
    const job = this.jobs.get(id)
    if (!job) return
    job.status = JobStatus.FAILED
    job.retryCount++
    job.lastError = error
    job.nextRunAt = nextRetryAt
    job.updatedAt = new Date()
  }

  async markDead(id: string, error: string): Promise<void> {
    const job = this.jobs.get(id)
    if (!job) return
    job.status = JobStatus.DEAD
    job.lastError = error
    job.updatedAt = new Date()
  }

  async reschedule(id: string, nextRunAt: Date): Promise<void> {
    const job = this.jobs.get(id)
    if (!job) return
    job.status = JobStatus.PENDING
    job.retryCount = 0
    job.nextRunAt = nextRunAt
    job.updatedAt = new Date()
  }

  async cancel(id: string): Promise<void> {
    const job = this.jobs.get(id)
    if (!job) return
    job.status = JobStatus.CANCELLED
    job.updatedAt = new Date()
  }

  async tryAcquireLease(id: string, workerId: string, leaseTtlMs: number): Promise<boolean> {
    const job = this.jobs.get(id)
    if (!job) return false

    const now = new Date()
    // Check if lease is already held by another worker and not expired
    if (job.leaseHolder && job.leaseExpiresAt && job.leaseExpiresAt > now) {
      if (job.leaseHolder !== workerId) {
        return false
      }
    }

    // Acquire or renew lease
    job.leaseHolder = workerId
    job.leaseAcquiredAt = now
    job.leaseExpiresAt = new Date(now.getTime() + leaseTtlMs)
    job.updatedAt = now
    return true
  }

  async releaseLease(id: string, workerId: string): Promise<void> {
    const job = this.jobs.get(id)
    if (!job) return
    if (job.leaseHolder === workerId) {
      job.leaseHolder = null
      job.leaseAcquiredAt = null
      job.leaseExpiresAt = null
      job.updatedAt = new Date()
    }
  }

  async recoverStaleLeases(): Promise<number> {
    const now = new Date()
    let recovered = 0
    for (const job of this.jobs.values()) {
      if (job.leaseHolder && job.leaseExpiresAt && job.leaseExpiresAt <= now) {
        job.leaseHolder = null
        job.leaseAcquiredAt = null
        job.leaseExpiresAt = null
        job.updatedAt = now
        recovered++
      }
    }
    return recovered
  }

  async recordJobRun(jobId: string, jobName: string, handler: string, workerId: string, payload: Record<string, unknown>): Promise<string> {
    const runId = crypto.randomUUID()
    const run: JobRunHistory = {
      id: runId,
      jobId,
      jobName,
      handler,
      workerId,
      status: JobRunStatus.STARTED,
      startedAt: new Date(),
      completedAt: null,
      durationMs: null,
      errorMessage: null,
      payload,
      createdAt: new Date(),
    }
    this.runHistory.set(runId, run)
    return runId
  }

  async completeJobRun(runId: string, status: JobRunStatus, errorMessage?: string): Promise<void> {
    const run = this.runHistory.get(runId)
    if (!run) return
    run.status = status
    run.completedAt = new Date()
    run.durationMs = run.completedAt.getTime() - run.startedAt.getTime()
    if (errorMessage) run.errorMessage = errorMessage
  }

  async getJobRunHistory(jobId: string, limit: number = 50): Promise<JobRunHistory[]> {
    const runs = Array.from(this.runHistory.values())
      .filter(r => r.jobId === jobId)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit)
    return runs.map(r => ({ ...r }))
  }
}

// ---------------------------------------------------------------------------
// Postgres implementation
// ---------------------------------------------------------------------------

function rowToJob(row: Record<string, unknown>): ScheduledJob {
  return {
    id: row.id as string,
    name: row.name as string,
    handler: row.handler as string,
    payload: (row.payload as Record<string, unknown>) ?? {},
    status: row.status as JobStatus,
    priority: row.priority as number,
    cronExpression: (row.cron_expression as string | null) ?? null,
    nextRunAt: new Date(row.next_run_at as string),
    lastRunAt: row.last_run_at ? new Date(row.last_run_at as string) : null,
    runCount: row.run_count as number,
    retryCount: row.retry_count as number,
    maxRetries: row.max_retries as number,
    lastError: (row.last_error as string | null) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    leaseHolder: (row.lease_holder as string | null) ?? null,
    leaseAcquiredAt: row.lease_acquired_at ? new Date(row.lease_acquired_at as string) : null,
    leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at as string) : null,
  }
}

export class PostgresJobStore implements JobStore {
  async create(input: CreateJobInput): Promise<ScheduledJob> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')
    const result = await pool.query(
      `INSERT INTO scheduled_jobs (name, handler, payload, priority, cron_expression, next_run_at, max_retries)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        input.name,
        input.handler,
        JSON.stringify(input.payload ?? {}),
        input.priority ?? 5,
        input.cronExpression ?? null,
        input.nextRunAt ?? new Date(),
        input.maxRetries ?? 3,
      ],
    )
    return rowToJob(result.rows[0])
  }

  async findById(id: string): Promise<ScheduledJob | null> {
    const pool = await getPool()
    if (!pool) return null
    const result = await pool.query('SELECT * FROM scheduled_jobs WHERE id = $1', [id])
    return result.rows[0] ? rowToJob(result.rows[0]) : null
  }

  async listDue(): Promise<ScheduledJob[]> {
    const pool = await getPool()
    if (!pool) return []
    const result = await pool.query(
      `SELECT * FROM scheduled_jobs
       WHERE status IN ('pending', 'failed') AND next_run_at <= NOW()
       ORDER BY priority ASC, next_run_at ASC
       LIMIT 100`,
    )
    return result.rows.map(rowToJob)
  }

  async listAll(filters?: { status?: JobStatus; limit?: number; offset?: number }): Promise<ScheduledJob[]> {
    const pool = await getPool()
    if (!pool) return []
    const params: unknown[] = []
    let where = ''
    if (filters?.status) {
      params.push(filters.status)
      where = `WHERE status = $${params.length}`
    }
    params.push(filters?.limit ?? 50)
    params.push(filters?.offset ?? 0)
    const result = await pool.query(
      `SELECT * FROM scheduled_jobs ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )
    return result.rows.map(rowToJob)
  }

  async markRunning(id: string): Promise<void> {
    const pool = await getPool()
    if (!pool) return
    await pool.query(
      `UPDATE scheduled_jobs
       SET status = 'running', last_run_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [id],
    )
  }

  async markCompleted(id: string, nextRunAt?: Date): Promise<void> {
    const pool = await getPool()
    if (!pool) return
    await pool.query(
      `UPDATE scheduled_jobs
       SET status = $2,
           run_count = run_count + 1,
           retry_count = 0,
           last_error = NULL,
           next_run_at = COALESCE($3, next_run_at),
           updated_at = NOW()
       WHERE id = $1`,
      [id, nextRunAt ? 'pending' : 'completed', nextRunAt ?? null],
    )
  }

  async markFailed(id: string, error: string, nextRetryAt: Date): Promise<void> {
    const pool = await getPool()
    if (!pool) return
    await pool.query(
      `UPDATE scheduled_jobs
       SET status = 'failed',
           retry_count = retry_count + 1,
           last_error = $2,
           next_run_at = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [id, error, nextRetryAt],
    )
  }

  async markDead(id: string, error: string): Promise<void> {
    const pool = await getPool()
    if (!pool) return
    await pool.query(
      `UPDATE scheduled_jobs
       SET status = 'dead', last_error = $2, updated_at = NOW()
       WHERE id = $1`,
      [id, error],
    )
  }

  async reschedule(id: string, nextRunAt: Date): Promise<void> {
    const pool = await getPool()
    if (!pool) return
    await pool.query(
      `UPDATE scheduled_jobs
       SET status = 'pending', retry_count = 0, next_run_at = $2, updated_at = NOW()
       WHERE id = $1`,
      [id, nextRunAt],
    )
  }

  async cancel(id: string): Promise<void> {
    const pool = await getPool()
    if (!pool) return
    await pool.query(
      `UPDATE scheduled_jobs SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [id],
    )
  }

  async tryAcquireLease(id: string, workerId: string, leaseTtlMs: number): Promise<boolean> {
    const pool = await getPool()
    if (!pool) return false

    const result = await pool.query(
      `UPDATE scheduled_jobs
       SET lease_holder = $2,
           lease_acquired_at = NOW(),
           lease_expires_at = NOW() + ($3 * INTERVAL '1 millisecond'),
           updated_at = NOW()
       WHERE id = $1
         AND (lease_holder IS NULL
              OR lease_holder = $2
              OR lease_expires_at <= NOW())
       RETURNING id`,
      [id, workerId, leaseTtlMs],
    )
    return result.rows.length > 0
  }

  async releaseLease(id: string, workerId: string): Promise<void> {
    const pool = await getPool()
    if (!pool) return
    await pool.query(
      `UPDATE scheduled_jobs
       SET lease_holder = NULL,
           lease_acquired_at = NULL,
           lease_expires_at = NULL,
           updated_at = NOW()
       WHERE id = $1 AND lease_holder = $2`,
      [id, workerId],
    )
  }

  async recoverStaleLeases(): Promise<number> {
    const pool = await getPool()
    if (!pool) return 0

    const result = await pool.query(
      `UPDATE scheduled_jobs
       SET lease_holder = NULL,
           lease_acquired_at = NULL,
           lease_expires_at = NULL,
           updated_at = NOW()
       WHERE lease_holder IS NOT NULL
         AND lease_expires_at <= NOW()
       RETURNING id`,
    )
    return result.rowCount ?? 0
  }

  async recordJobRun(jobId: string, jobName: string, handler: string, workerId: string, payload: Record<string, unknown>): Promise<string> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    const result = await pool.query(
      `INSERT INTO job_run_history (job_id, job_name, handler, worker_id, status, payload)
       VALUES ($1, $2, $3, $4, 'started', $5)
       RETURNING id`,
      [jobId, jobName, handler, workerId, JSON.stringify(payload)],
    )
    return result.rows[0].id as string
  }

  async completeJobRun(runId: string, status: JobRunStatus, errorMessage?: string): Promise<void> {
    const pool = await getPool()
    if (!pool) return

    await pool.query(
      `UPDATE job_run_history
       SET status = $2,
           completed_at = NOW(),
           duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000,
           error_message = $3
       WHERE id = $1`,
      [runId, status, errorMessage ?? null],
    )
  }

  async getJobRunHistory(jobId: string, limit: number = 50): Promise<JobRunHistory[]> {
    const pool = await getPool()
    if (!pool) return []

    const result = await pool.query(
      `SELECT * FROM job_run_history
       WHERE job_id = $1
       ORDER BY started_at DESC
       LIMIT $2`,
      [jobId, limit],
    )

    return result.rows.map(row => ({
      id: row.id as string,
      jobId: row.job_id as string,
      jobName: row.job_name as string,
      handler: row.handler as string,
      workerId: row.worker_id as string,
      status: row.status as JobRunStatus,
      startedAt: new Date(row.started_at as string),
      completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
      durationMs: row.duration_ms as number | null,
      errorMessage: (row.error_message as string | null) ?? null,
      payload: (row.payload as Record<string, unknown>) ?? {},
      createdAt: new Date(row.created_at as string),
    }))
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton (swappable for tests)
// ---------------------------------------------------------------------------

let store: JobStore = new InMemoryJobStore()

export function initJobStore(newStore: JobStore): void {
  store = newStore
}

export function getJobStore(): JobStore {
  return store
}
