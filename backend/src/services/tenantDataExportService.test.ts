import { describe, it, expect, beforeEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  buildExportBundle,
  expireReadyExports,
  generateExport,
  getExport,
  requestExport,
  TENANT_DATA_EXPORT_DAILY_LIMIT,
  TENANT_DATA_EXPORT_JOB,
} from './tenantDataExportService.js'
import { tenantDataExportStore } from '../models/tenantDataExportStore.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

const scheduleMock = vi.fn(async () => ({}))

vi.mock('../jobs/scheduler/index.js', () => ({
  getScheduler: () => ({ schedule: scheduleMock }),
}))

const storage = {
  uploadFile: vi.fn(async (key: string) => ({ key, url: `s3://${key}` })),
  deleteFile: vi.fn(async () => undefined),
  generatePresignedDownload: vi.fn(async (key: string) => ({ downloadUrl: `https://signed.example/${key}` })),
}

vi.mock('./storageService.js', () => ({
  getStorageProvider: () => storage,
}))

const knownUsers = new Map<string, { id: string; name: string; email: string; role: string; createdAt: Date }>()

vi.mock('../models/authStore.js', () => ({
  userStore: {
    getById: async (id: string) => knownUsers.get(id),
  },
}))

vi.mock('../models/notificationPreferenceStore.js', () => ({
  notificationPreferenceStore: {
    get: async () => ({ channels: { email: true } }),
  },
}))

vi.mock('../repositories/ListingApplicationRepository.js', () => ({
  listingApplicationRepository: {
    findByTenantId: async () => [],
  },
}))

vi.mock('../models/dealStore.js', () => ({
  dealStore: {
    findMany: async () => ({ deals: [], total: 0, page: 1, pageSize: 100 }),
    findById: async () => null,
  },
}))

describe('tenant data export (#2052)', () => {
  beforeEach(() => {
    scheduleMock.mockClear()
    storage.uploadFile.mockClear()
    storage.deleteFile.mockClear()
    storage.generatePresignedDownload.mockClear()
  })

  it('builds a bundle with the tenant\'s own data and none of the secrets or other people\'s fields', () => {
    const bundle = buildExportBundle({
      user: {
        id: 'tenant-1',
        name: 'Ada',
        email: 'ada@example.test',
        role: 'tenant',
        walletAddress: 'GADA',
        displayCurrency: 'NGN',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        // Fields the bundle must never copy.
        passwordHash: 'pbkdf2$secret-hash',
        sessionToken: 'session-secret',
      } as any,
      notificationPreferences: { channels: { email: true } } as any,
      applications: [
        {
          id: 'app-1',
          listingId: 'listing-1',
          tenantId: 'tenant-1',
          landlordId: 'landlord-secret-id',
          status: 'approved',
          coverNote: 'Hello',
          preferredStartDate: new Date('2026-02-01T00:00:00Z'),
          paymentPlan: 'monthly',
          appliedAt: new Date('2026-01-10T00:00:00Z'),
          reviewedBy: 'reviewer-secret-id',
          reviewerNotes: 'internal note',
          rtiAssessment: { score: 42, riskBand: 'high' },
          createdAt: new Date('2026-01-10T00:00:00Z'),
          updatedAt: new Date('2026-01-10T00:00:00Z'),
        } as any,
      ],
      deals: [
        {
          dealId: 'deal-1',
          tenantId: 'tenant-1',
          landlordId: 'landlord-secret-id',
          listingId: 'listing-1',
          status: 'active',
          annualRentNgn: 1200000,
          depositNgn: 100000,
          financedAmountNgn: 1100000,
          termMonths: 12,
          createdAt: new Date('2026-02-01T00:00:00Z'),
          schedule: [{ period: 1, dueDate: '2026-03-01', amountNgn: 100000, status: 'paid' }],
        } as any,
      ],
      generatedAt: new Date('2026-11-23T10:00:00Z'),
    })

    const serialised = JSON.stringify(bundle)
    expect(serialised).not.toContain('pbkdf2')
    expect(serialised).not.toContain('session-secret')
    expect(serialised).not.toContain('landlord-secret-id')
    expect(serialised).not.toContain('reviewer-secret-id')
    expect(serialised).not.toContain('internal note')
    expect(serialised).not.toContain('riskBand')
    expect(serialised).not.toContain('rtiAssessment')

    expect(bundle.profile.email).toBe('ada@example.test')
    expect(bundle.deals[0].payments).toEqual([{ period: 1, dueDate: '2026-03-01', amountNgn: 100000, status: 'paid' }])
  })

  it('queues one job per request and allows only one active export at a time', async () => {
    const userId = randomUUID()
    const view = await requestExport(userId)

    expect(view.status).toBe('pending')
    expect(scheduleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: TENANT_DATA_EXPORT_JOB,
        handler: TENANT_DATA_EXPORT_JOB,
        payload: { exportId: view.id },
      }),
    )

    await expect(requestExport(userId)).rejects.toMatchObject({ status: 409 })
  })

  it('limits how many exports one user can request in 24 hours', async () => {
    const userId = randomUUID()
    const now = new Date('2026-11-23T10:00:00Z')

    for (let i = 0; i < TENANT_DATA_EXPORT_DAILY_LIMIT; i++) {
      const view = await requestExport(userId, now)
      await tenantDataExportStore.markFailed(view.id, 'test', now)
    }

    await expect(requestExport(userId, now)).rejects.toMatchObject({ status: 429 })
  })

  it('returns 404 when another tenant asks for an export id', async () => {
    const owner = randomUUID()
    const view = await requestExport(owner)

    await expect(getExport(randomUUID(), view.id)).rejects.toMatchObject({ status: 404 })
    await expect(getExport(owner, view.id)).resolves.toMatchObject({ id: view.id, downloadUrl: null })
  })

  it('generates the archive, returns a short-lived download URL, and deletes it after the window', async () => {
    const userId = randomUUID()
    knownUsers.set(userId, {
      id: userId,
      name: 'Tenant',
      email: `${userId}@example.test`,
      role: 'tenant',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    })
    const now = new Date('2026-11-23T10:00:00Z')
    const view = await requestExport(userId, now)

    await generateExport(view.id, now)
    expect(storage.uploadFile).toHaveBeenCalledWith(
      `tenant-exports/${userId}/${view.id}.json`,
      expect.any(Buffer),
      'application/json',
    )

    const ready = await getExport(userId, view.id, now)
    expect(ready.status).toBe('ready')
    expect(ready.downloadUrl).toContain(`tenant-exports/${userId}/${view.id}.json`)
    expect(storage.generatePresignedDownload).toHaveBeenCalledWith(expect.any(String), 300)

    const later = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000)
    const removed = await expireReadyExports(later)
    expect(removed).toBeGreaterThanOrEqual(1)
    expect(storage.deleteFile).toHaveBeenCalledWith(`tenant-exports/${userId}/${view.id}.json`)

    const expired = await getExport(userId, view.id, later)
    expect(expired.status).toBe('expired')
    expect(expired.downloadUrl).toBeNull()
  })

  it('marks the export failed when the bundle cannot be built', async () => {
    const userId = randomUUID()
    const view = await requestExport(userId)

    await generateExport(view.id)
    const after = await getExport(userId, view.id)
    expect(after.status).toBe('failed')
    expect(after.downloadUrl).toBeNull()
    expect(storage.uploadFile).not.toHaveBeenCalled()
  })

  it('throws a typed not-found error for an unknown export', async () => {
    await expect(getExport(randomUUID(), randomUUID())).rejects.toBeInstanceOf(AppError)
    await expect(getExport(randomUUID(), randomUUID())).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
  })
})
