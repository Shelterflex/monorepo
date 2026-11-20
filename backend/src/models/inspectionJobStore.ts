import { getPool } from '../db.js'
import { InspectionJob, InspectionReport } from '../schemas/inspectionJob.js'

export interface IInspectionJobStore {
  createJob(listingId: string, offeredFeeNgn: number): Promise<InspectionJob>
  listAvailableJobs(status?: string, area?: string, page?: number, limit?: number): Promise<{ jobs: InspectionJob[]; total: number }>
  listInspectorJobs(inspectorId: string): Promise<InspectionJob[]>
  getJob(jobId: string): Promise<InspectionJob | null>
  claimJob(jobId: string, inspectorId: string): Promise<InspectionJob>
  submitReport(jobId: string, report: any): Promise<InspectionReport>
  getReport(jobId: string): Promise<InspectionReport | null>
  approveJob(jobId: string): Promise<InspectionJob>
  rejectJob(jobId: string, reason: string): Promise<InspectionJob>
  releaseExpiredClaims(): Promise<number>
  updateJobStatus(jobId: string, status: string): Promise<void>
}

export class InMemoryInspectionJobStore implements IInspectionJobStore {
  private jobs: Map<string, InspectionJob> = new Map()
  private reports: Map<string, InspectionReport> = new Map()

  async createJob(listingId: string, offeredFeeNgn: number): Promise<InspectionJob> {
    const id = Math.random().toString(36).substring(7)
    const job: InspectionJob = {
      id,
      listingId,
      inspectorId: null,
      status: 'available',
      offeredFeeNgn,
      claimDeadline: null,
      submittedAt: null,
      approvedAt: null,
      rejectionReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.jobs.set(id, job)
    return job
  }

  async listAvailableJobs(status?: string, area?: string, page = 1, limit = 20): Promise<{ jobs: InspectionJob[]; total: number }> {
    let jobs = Array.from(this.jobs.values())

    if (status) {
      jobs = jobs.filter((j) => j.status === status)
    }

    const total = jobs.length
    const start = (page - 1) * limit
    return {
      jobs: jobs.slice(start, start + limit),
      total,
    }
  }

  async listInspectorJobs(inspectorId: string): Promise<InspectionJob[]> {
    return Array.from(this.jobs.values()).filter((j) => j.inspectorId === inspectorId)
  }

  async getJob(jobId: string): Promise<InspectionJob | null> {
    return this.jobs.get(jobId) || null
  }

  async claimJob(jobId: string, inspectorId: string): Promise<InspectionJob> {
    const job = this.jobs.get(jobId)
    if (!job) throw new Error('Job not found')
    if (job.status !== 'available') throw new Error('Job is not available')

    job.inspectorId = inspectorId
    job.status = 'claimed'
    job.claimDeadline = new Date(Date.now() + 48 * 60 * 60 * 1000)
    job.updatedAt = new Date()
    this.jobs.set(jobId, job)

    return job
  }

  async submitReport(jobId: string, report: any): Promise<InspectionReport> {
    const job = this.jobs.get(jobId)
    if (!job) throw new Error('Job not found')

    const id = Math.random().toString(36).substring(7)
    const inspectionReport: InspectionReport = {
      id,
      jobId,
      overallGrade: report.overallGrade,
      roomChecklist: report.roomChecklist || {},
      photoKeys: report.photoKeys,
      notes: report.notes,
      submittedAt: new Date(),
    }

    this.reports.set(id, inspectionReport)

    job.status = 'submitted'
    job.submittedAt = new Date()
    job.updatedAt = new Date()
    this.jobs.set(jobId, job)

    return inspectionReport
  }

  async getReport(jobId: string): Promise<InspectionReport | null> {
    const reports = Array.from(this.reports.values())
    return reports.find((r) => r.jobId === jobId) || null
  }

  async approveJob(jobId: string): Promise<InspectionJob> {
    const job = this.jobs.get(jobId)
    if (!job) throw new Error('Job not found')

    job.status = 'approved'
    job.approvedAt = new Date()
    job.updatedAt = new Date()
    this.jobs.set(jobId, job)

    return job
  }

  async rejectJob(jobId: string, reason: string): Promise<InspectionJob> {
    const job = this.jobs.get(jobId)
    if (!job) throw new Error('Job not found')

    job.status = 'rejected'
    job.rejectionReason = reason
    job.updatedAt = new Date()
    this.jobs.set(jobId, job)

    return job
  }

  async releaseExpiredClaims(): Promise<number> {
    let released = 0
    const now = new Date()

    for (const job of this.jobs.values()) {
      if (
        job.status === 'claimed' &&
        job.claimDeadline &&
        job.claimDeadline < now
      ) {
        job.status = 'available'
        job.inspectorId = null
        job.claimDeadline = null
        job.updatedAt = new Date()
        released++
      }
    }

    return released
  }

  async updateJobStatus(jobId: string, status: string): Promise<void> {
    const job = this.jobs.get(jobId)
    if (job) {
      job.status = status
      job.updatedAt = new Date()
    }
  }
}

export class PostgresInspectionJobStore implements IInspectionJobStore {
  async createJob(listingId: string, offeredFeeNgn: number): Promise<InspectionJob> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    const result = await pool.query(
      `INSERT INTO inspection_jobs (listing_id, offered_fee_ngn)
       VALUES ($1, $2)
       RETURNING id, listing_id, inspector_id, status, offered_fee_ngn, claim_deadline, submitted_at, approved_at, rejection_reason, created_at, updated_at`,
      [listingId, offeredFeeNgn],
    )

    const row = result.rows[0]
    return this.mapRowToJob(row)
  }

  async listAvailableJobs(status?: string, area?: string, page = 1, limit = 20): Promise<{ jobs: InspectionJob[]; total: number }> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    let query = `SELECT id, listing_id, inspector_id, status, offered_fee_ngn, claim_deadline, submitted_at, approved_at, rejection_reason, created_at, updated_at FROM inspection_jobs WHERE status = $1`
    const params: any[] = [status || 'available']

    if (area) {
      query += ` AND listing_id IN (SELECT listing_id FROM whistleblower_listings WHERE area = $${params.length + 1})`
      params.push(area)
    }

    const countResult = await pool.query(`SELECT COUNT(*) as count FROM (${query}) t`, params)
    const total = parseInt(countResult.rows[0].count, 10)

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
    params.push(limit)
    params.push((page - 1) * limit)

    const result = await pool.query(query, params)
    return {
      jobs: result.rows.map((row) => this.mapRowToJob(row)),
      total,
    }
  }

  async listInspectorJobs(inspectorId: string): Promise<InspectionJob[]> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    const result = await pool.query(
      `SELECT id, listing_id, inspector_id, status, offered_fee_ngn, claim_deadline, submitted_at, approved_at, rejection_reason, created_at, updated_at
       FROM inspection_jobs
       WHERE inspector_id = $1
       ORDER BY updated_at DESC`,
      [inspectorId],
    )

    return result.rows.map((row) => this.mapRowToJob(row))
  }

  async getJob(jobId: string): Promise<InspectionJob | null> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    const result = await pool.query(
      `SELECT id, listing_id, inspector_id, status, offered_fee_ngn, claim_deadline, submitted_at, approved_at, rejection_reason, created_at, updated_at
       FROM inspection_jobs
       WHERE id = $1`,
      [jobId],
    )

    return result.rows.length > 0 ? this.mapRowToJob(result.rows[0]) : null
  }

  async claimJob(jobId: string, inspectorId: string): Promise<InspectionJob> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    const claimDeadline = new Date(Date.now() + 48 * 60 * 60 * 1000)

    const result = await pool.query(
      `UPDATE inspection_jobs
       SET inspector_id = $2, status = 'claimed', claim_deadline = $3, updated_at = NOW()
       WHERE id = $1 AND status = 'available'
       RETURNING id, listing_id, inspector_id, status, offered_fee_ngn, claim_deadline, submitted_at, approved_at, rejection_reason, created_at, updated_at`,
      [jobId, inspectorId, claimDeadline],
    )

    if (result.rows.length === 0) {
      throw new Error('Job not found or already claimed')
    }

    return this.mapRowToJob(result.rows[0])
  }

  async submitReport(jobId: string, report: any): Promise<InspectionReport> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    const result = await pool.query(
      `INSERT INTO inspection_reports (job_id, overall_grade, room_checklist, photo_keys, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, job_id, overall_grade, room_checklist, photo_keys, notes, submitted_at`,
      [
        jobId,
        report.overallGrade,
        JSON.stringify(report.roomChecklist || {}),
        report.photoKeys,
        report.notes,
      ],
    )

    const row = result.rows[0]

    await pool.query(
      `UPDATE inspection_jobs SET status = 'submitted', submitted_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [jobId],
    )

    return {
      id: row.id,
      jobId: row.job_id,
      overallGrade: row.overall_grade,
      roomChecklist: row.room_checklist,
      photoKeys: row.photo_keys,
      notes: row.notes,
      submittedAt: row.submitted_at,
    }
  }

  async getReport(jobId: string): Promise<InspectionReport | null> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    const result = await pool.query(
      `SELECT id, job_id, overall_grade, room_checklist, photo_keys, notes, submitted_at FROM inspection_reports WHERE job_id = $1`,
      [jobId],
    )

    if (result.rows.length === 0) return null

    const row = result.rows[0]
    return {
      id: row.id,
      jobId: row.job_id,
      overallGrade: row.overall_grade,
      roomChecklist: row.room_checklist,
      photoKeys: row.photo_keys,
      notes: row.notes,
      submittedAt: row.submitted_at,
    }
  }

  async approveJob(jobId: string): Promise<InspectionJob> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    const result = await pool.query(
      `UPDATE inspection_jobs
       SET status = 'approved', approved_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING id, listing_id, inspector_id, status, offered_fee_ngn, claim_deadline, submitted_at, approved_at, rejection_reason, created_at, updated_at`,
      [jobId],
    )

    return this.mapRowToJob(result.rows[0])
  }

  async rejectJob(jobId: string, reason: string): Promise<InspectionJob> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    const result = await pool.query(
      `UPDATE inspection_jobs
       SET status = 'rejected', rejection_reason = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING id, listing_id, inspector_id, status, offered_fee_ngn, claim_deadline, submitted_at, approved_at, rejection_reason, created_at, updated_at`,
      [jobId, reason],
    )

    return this.mapRowToJob(result.rows[0])
  }

  async releaseExpiredClaims(): Promise<number> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    const result = await pool.query(
      `UPDATE inspection_jobs
       SET status = 'available', inspector_id = NULL, claim_deadline = NULL, updated_at = NOW()
       WHERE status = 'claimed' AND claim_deadline < NOW()
       RETURNING id`,
    )

    return result.rows.length
  }

  async updateJobStatus(jobId: string, status: string): Promise<void> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    await pool.query(
      `UPDATE inspection_jobs SET status = $2, updated_at = NOW() WHERE id = $1`,
      [jobId, status],
    )
  }

  private mapRowToJob(row: any): InspectionJob {
    return {
      id: row.id,
      listingId: row.listing_id,
      inspectorId: row.inspector_id,
      status: row.status,
      offeredFeeNgn: row.offered_fee_ngn,
      claimDeadline: row.claim_deadline ? new Date(row.claim_deadline) : null,
      submittedAt: row.submitted_at ? new Date(row.submitted_at) : null,
      approvedAt: row.approved_at ? new Date(row.approved_at) : null,
      rejectionReason: row.rejection_reason,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }
  }
}

let inspectionJobStore: IInspectionJobStore

export function initInspectionJobStore(store: IInspectionJobStore) {
  inspectionJobStore = store
}

export function getInspectionJobStore(): IInspectionJobStore {
  if (!inspectionJobStore) {
    inspectionJobStore = process.env.DATABASE_URL
      ? new PostgresInspectionJobStore()
      : new InMemoryInspectionJobStore()
  }
  return inspectionJobStore
}

export const inMemoryInspectionJobStore = new InMemoryInspectionJobStore()
