export enum JobStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  DEAD = 'dead',
  CANCELLED = 'cancelled',
}

export interface ScheduledJob {
  id: string
  name: string
  handler: string
  payload: Record<string, unknown>
  status: JobStatus
  /** 1 = highest priority, 10 = lowest priority */
  priority: number
  cronExpression: string | null
  nextRunAt: Date
  lastRunAt: Date | null
  runCount: number
  retryCount: number
  maxRetries: number
  lastError: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateJobInput {
  name: string
  handler: string
  payload?: Record<string, unknown>
  /** 1 = highest, 10 = lowest. Defaults to 5. */
  priority?: number
  cronExpression?: string
  nextRunAt?: Date
  maxRetries?: number
}

export type JobHandler = (job: ScheduledJob) => Promise<void>
