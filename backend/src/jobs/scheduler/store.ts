import { getPool } from '../../db.js'
import { JobStatus, type ScheduledJob, type CreateJobInput } from './types.js'

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
}

// ---------------------------------------------------------------------------
// In-memory implementation (used in tests / no DATABASE_URL)
// ---------------------------------------------------------------------------

export class InMemoryJobStore implements JobStore {
  private jobs = new Map<string, ScheduledJob>()

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
