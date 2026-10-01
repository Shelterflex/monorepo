/**
 * Whistleblower Application Store
 * Handles persistence and retrieval of whistleblower signup applications
 */

import { randomUUID } from 'node:crypto'
import { getPool, type PgPoolLike } from '../db.js'
import {
  WhistleblowerApplication,
  WhistleblowerApplicationStatus,
  CreateWhistleblowerApplicationData,
  WhistleblowerApplicationFilters,
  WhistleblowerApplicationListResult,
} from "./whistleblowerApplication.js";

// In-memory store for development/testing
const inMemoryApplications = new Map<string, WhistleblowerApplication>();

export interface WhistleblowerApplicationStore {
  create(data: CreateWhistleblowerApplicationData): Promise<WhistleblowerApplication>;
  getById(applicationId: string): Promise<WhistleblowerApplication | null>;
  getByEmail(email: string): Promise<WhistleblowerApplication | null>;
  list(filters?: WhistleblowerApplicationFilters): Promise<WhistleblowerApplicationListResult>;
  updateStatus(
    applicationId: string,
    status: WhistleblowerApplicationStatus,
    reviewedBy: string,
    rejectionReason?: string
  ): Promise<WhistleblowerApplication | null>;
  clear(): Promise<void>;
}

export class InMemoryWhistleblowerApplicationStore implements WhistleblowerApplicationStore {
  async create(data: CreateWhistleblowerApplicationData): Promise<WhistleblowerApplication> {
    const now = new Date();
    const application: WhistleblowerApplication = {
      applicationId: randomUUID(),
      ...data,
      status: WhistleblowerApplicationStatus.PENDING,
      createdAt: now,
      updatedAt: now,
      // Initialize with default social verification values
      socialScore: 50, // Neutral score pending review
      greenFlags: [],
      redFlags: [],
    };
    inMemoryApplications.set(application.applicationId, application);
    return application;
  }

  async getById(applicationId: string): Promise<WhistleblowerApplication | null> {
    return inMemoryApplications.get(applicationId) || null;
  }

  async getByEmail(email: string): Promise<WhistleblowerApplication | null> {
    for (const app of inMemoryApplications.values()) {
      if (app.email.toLowerCase() === email.toLowerCase()) {
        return app;
      }
    }
    return null;
  }

  async list(filters?: WhistleblowerApplicationFilters): Promise<WhistleblowerApplicationListResult> {
    const page = filters?.page ?? 1;
    const pageSize = Math.min(filters?.pageSize ?? 20, 100);
    
    let applications = Array.from(inMemoryApplications.values());
    
    // Apply status filter
    if (filters?.status) {
      applications = applications.filter(app => app.status === filters.status);
    }
    
    // Sort by creation date (newest first)
    applications.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    
    const total = applications.length;
    const totalPages = Math.ceil(total / pageSize);
    
    // Apply pagination
    const start = (page - 1) * pageSize;
    const paginatedApplications = applications.slice(start, start + pageSize);
    
    return {
      applications: paginatedApplications,
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  async updateStatus(
    applicationId: string,
    status: WhistleblowerApplicationStatus,
    reviewedBy: string,
    rejectionReason?: string
  ): Promise<WhistleblowerApplication | null> {
    const application = inMemoryApplications.get(applicationId);
    if (!application) {
      return null;
    }

    // Validate transition
    if (application.status !== WhistleblowerApplicationStatus.PENDING) {
      throw new Error(`Cannot transition from ${application.status} to ${status}`);
    }

    // Rejection requires a reason
    if (status === WhistleblowerApplicationStatus.REJECTED && !rejectionReason) {
      throw new Error("Rejection reason is required");
    }

    const updatedApplication: WhistleblowerApplication = {
      ...application,
      status,
      reviewedBy,
      reviewedAt: new Date(),
      updatedAt: new Date(),
      ...(rejectionReason && { rejectionReason }),
    };

    inMemoryApplications.set(applicationId, updatedApplication);
    return updatedApplication;
  }

  async clear(): Promise<void> {
    inMemoryApplications.clear();
  }
}

type WhistleblowerApplicationRow = {
  application_id: string
  full_name: string
  email: string
  phone: string
  address: string
  linkedin_profile: string
  facebook_profile: string
  instagram_profile: string
  status: WhistleblowerApplicationStatus
  created_at: Date
  updated_at: Date
  reviewed_at: Date | null
  reviewed_by: string | null
  rejection_reason: string | null
  social_score: number | null
  green_flags: unknown
  red_flags: unknown
}

class PostgresWhistleblowerApplicationStore implements WhistleblowerApplicationStore {
  private async pool(): Promise<PgPoolLike> {
    const pool = await getPool()
    if (!pool) {
      throw new Error('Database pool is not available (DATABASE_URL/pg not configured)')
    }
    return pool
  }

  async isAvailable(): Promise<boolean> {
    return (await getPool()) !== null
  }

  async create(data: CreateWhistleblowerApplicationData): Promise<WhistleblowerApplication> {
    const pool = await this.pool()
    const applicationId = randomUUID()
    const { rows } = await pool.query(
      `INSERT INTO whistleblower_applications (
        application_id,
        full_name,
        email,
        phone,
        address,
        linkedin_profile,
        facebook_profile,
        instagram_profile,
        status,
        social_score,
        green_flags,
        red_flags
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        applicationId,
        data.fullName,
        data.email,
        data.phone,
        data.address,
        data.linkedinProfile,
        data.facebookProfile,
        data.instagramProfile,
        WhistleblowerApplicationStatus.PENDING,
        50,
        '[]',
        '[]',
      ],
    )

    return this.mapRow(rows[0] as WhistleblowerApplicationRow)
  }

  async getById(applicationId: string): Promise<WhistleblowerApplication | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      'SELECT * FROM whistleblower_applications WHERE application_id = $1',
      [applicationId],
    )

    if (rows.length === 0) return null
    return this.mapRow(rows[0] as WhistleblowerApplicationRow)
  }

  async getByEmail(email: string): Promise<WhistleblowerApplication | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      'SELECT * FROM whistleblower_applications WHERE LOWER(email) = LOWER($1)',
      [email],
    )

    if (rows.length === 0) return null
    return this.mapRow(rows[0] as WhistleblowerApplicationRow)
  }

  async list(filters?: WhistleblowerApplicationFilters): Promise<WhistleblowerApplicationListResult> {
    const pool = await this.pool()
    const page = filters?.page ?? 1
    const pageSize = Math.min(filters?.pageSize ?? 20, 100)
    const offset = (page - 1) * pageSize

    let query = 'SELECT * FROM whistleblower_applications'
    const params: any[] = []
    let paramCount = 0

    if (filters?.status) {
      paramCount++
      query += ` WHERE status = $${paramCount}`
      params.push(filters.status)
    }

    query += ' ORDER BY created_at DESC'
    query += ` LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`
    params.push(pageSize, offset)

    const { rows } = await pool.query(query, params)

    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM whistleblower_applications'
    const countParams: any[] = []
    if (filters?.status) {
      countQuery += ' WHERE status = $1'
      countParams.push(filters.status)
    }
    const countResult = await pool.query(countQuery, countParams)
    const total = parseInt(countResult.rows[0].count, 10)
    const totalPages = Math.ceil(total / pageSize)

    return {
      applications: rows.map((row) => this.mapRow(row as WhistleblowerApplicationRow)),
      total,
      page,
      pageSize,
      totalPages,
    }
  }

  async updateStatus(
    applicationId: string,
    status: WhistleblowerApplicationStatus,
    reviewedBy: string,
    rejectionReason?: string
  ): Promise<WhistleblowerApplication | null> {
    const pool = await this.pool()

    // First check current status
    const { rows: currentRows } = await pool.query(
      'SELECT status FROM whistleblower_applications WHERE application_id = $1',
      [applicationId],
    )

    if (currentRows.length === 0) return null
    const currentStatus = currentRows[0].status

    // Validate transition
    if (currentStatus !== WhistleblowerApplicationStatus.PENDING) {
      throw new Error(`Cannot transition from ${currentStatus} to ${status}`)
    }

    // Rejection requires a reason
    if (status === WhistleblowerApplicationStatus.REJECTED && !rejectionReason) {
      throw new Error('Rejection reason is required')
    }

    const { rows } = await pool.query(
      `UPDATE whistleblower_applications
       SET status = $2,
           reviewed_by = $3,
           reviewed_at = NOW(),
           updated_at = NOW(),
           rejection_reason = $4
       WHERE application_id = $1
       RETURNING *`,
      [applicationId, status, reviewedBy, rejectionReason ?? null],
    )

    if (rows.length === 0) return null
    return this.mapRow(rows[0] as WhistleblowerApplicationRow)
  }

  async clear(): Promise<void> {
    const pool = await this.pool()
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('whistleblowerApplicationStore.clear() is only supported in test env when using Postgres')
    }
    await pool.query('TRUNCATE whistleblower_applications RESTART IDENTITY CASCADE')
  }

  private mapRow(row: WhistleblowerApplicationRow): WhistleblowerApplication {
    const greenFlagsValue = row.green_flags
    let greenFlags: string[]
    if (greenFlagsValue && typeof greenFlagsValue === 'string') {
      greenFlags = JSON.parse(greenFlagsValue)
    } else if (greenFlagsValue && Array.isArray(greenFlagsValue)) {
      greenFlags = greenFlagsValue as string[]
    } else {
      greenFlags = []
    }

    const redFlagsValue = row.red_flags
    let redFlags: string[]
    if (redFlagsValue && typeof redFlagsValue === 'string') {
      redFlags = JSON.parse(redFlagsValue)
    } else if (redFlagsValue && Array.isArray(redFlagsValue)) {
      redFlags = redFlagsValue as string[]
    } else {
      redFlags = []
    }

    return {
      applicationId: row.application_id,
      fullName: row.full_name,
      email: row.email,
      phone: row.phone,
      address: row.address,
      linkedinProfile: row.linkedin_profile,
      facebookProfile: row.facebook_profile,
      instagramProfile: row.instagram_profile,
      status: row.status,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : undefined,
      reviewedBy: row.reviewed_by ?? undefined,
      rejectionReason: row.rejection_reason ?? undefined,
      socialScore: row.social_score ?? 50,
      greenFlags,
      redFlags,
    }
  }
}

class HybridWhistleblowerApplicationStore implements WhistleblowerApplicationStore {
  private memory = new InMemoryWhistleblowerApplicationStore()
  private postgres = new PostgresWhistleblowerApplicationStore()

  private async adapter(): Promise<WhistleblowerApplicationStore> {
    if (await this.postgres.isAvailable()) {
      return this.postgres
    }
    return this.memory
  }

  async create(data: CreateWhistleblowerApplicationData): Promise<WhistleblowerApplication> {
    const adapter = await this.adapter()
    return adapter.create(data)
  }

  async getById(applicationId: string): Promise<WhistleblowerApplication | null> {
    const adapter = await this.adapter()
    return adapter.getById(applicationId)
  }

  async getByEmail(email: string): Promise<WhistleblowerApplication | null> {
    const adapter = await this.adapter()
    return adapter.getByEmail(email)
  }

  async list(filters?: WhistleblowerApplicationFilters): Promise<WhistleblowerApplicationListResult> {
    const adapter = await this.adapter()
    return adapter.list(filters)
  }

  async updateStatus(
    applicationId: string,
    status: WhistleblowerApplicationStatus,
    reviewedBy: string,
    rejectionReason?: string
  ): Promise<WhistleblowerApplication | null> {
    const adapter = await this.adapter()
    return adapter.updateStatus(applicationId, status, reviewedBy, rejectionReason)
  }

  async clear(): Promise<void> {
    const adapter = await this.adapter()
    return adapter.clear()
  }
}

// Singleton instance for use across the application
export const whistleblowerApplicationStore = new HybridWhistleblowerApplicationStore()
