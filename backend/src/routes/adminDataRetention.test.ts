import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { RATE_LIMIT_BYPASS_TOKEN, expectErrorShape } from '../test-helpers.js'
import { seedAdminSession } from '../test-fixtures/adminAuth.js'
import { sessionStore } from '../models/authStore.js'
import {
  getPendingPurgeCount,
  purgeExpiredRecords,
} from '../services/dataRetentionService.js'
import { logger } from '../utils/logger.js'

// The purge deletes rows in Postgres. The route's behaviour is what these tests cover, so the
// service is replaced with a fake. Everything else in the module keeps its real implementation.
vi.mock('../services/dataRetentionService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/dataRetentionService.js')>()),
  getPendingPurgeCount: vi.fn(),
  purgeExpiredRecords: vi.fn(),
}))

const PENDING = '/api/v1/admin/data-retention/pending-purge'
const PURGE = '/api/v1/admin/data-retention/purge'
const BYPASS = { 'x-ratelimit-bypass': RATE_LIMIT_BYPASS_TOKEN }

describe('admin data-retention routes', () => {
  let app: ReturnType<typeof createApp>
  let superAdminId: string
  let superAdminHeaders: Record<string, string>
  let adminHeaders: Record<string, string>
  let tenantHeaders: Record<string, string>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(getPendingPurgeCount).mockReset().mockResolvedValue({})
    vi.mocked(purgeExpiredRecords).mockReset().mockResolvedValue([])
    sessionStore.clear()
    const superAdmin = await seedAdminSession({
      email: 'retention-super@example.com',
      token: 'test-token-retention-super',
      role: 'super_admin',
    })
    const admin = await seedAdminSession({
      email: 'retention-admin@example.com',
      token: 'test-token-retention-admin',
      role: 'admin',
    })
    const tenant = await seedAdminSession({
      email: 'retention-tenant@example.com',
      token: 'test-token-retention-tenant',
      role: 'tenant',
    })
    superAdminId = superAdmin.id
    superAdminHeaders = { ...BYPASS, ...superAdmin.header }
    adminHeaders = { ...BYPASS, ...admin.header }
    tenantHeaders = { ...BYPASS, ...tenant.header }
    app = createApp()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe.each([
    ['GET', PENDING],
    ['POST', PURGE],
  ] as const)('%s %s', (method, url) => {
    const send = () => (method === 'GET' ? request(app).get(url) : request(app).post(url))

    it('rejects a request without a token with 401', async () => {
      const res = await send().set(BYPASS)
      expectErrorShape(res, 'UNAUTHORIZED', 401)
    })

    it('rejects a tenant with 403', async () => {
      const res = await send().set(tenantHeaders)
      expectErrorShape(res, 'FORBIDDEN', 403)
    })

    // These routes check the role directly, not the RBAC permissions, so only super_admin passes.
    it('rejects an admin who is not super_admin with 403', async () => {
      const res = await send().set(adminHeaders)
      expectErrorShape(res, 'FORBIDDEN', 403)
    })
  })

  describe('GET /api/v1/admin/data-retention/pending-purge', () => {
    it('returns per-table counts, their total and the retention period', async () => {
      vi.mocked(getPendingPurgeCount).mockResolvedValue({ users: 3, sessions: 0, wallets: 2 })

      const res = await request(app).get(PENDING).set(superAdminHeaders).expect(200)

      expect(res.body).toEqual({
        totalPending: 5,
        tables: { users: 3, sessions: 0, wallets: 2 },
        retentionPeriodYears: 7,
      })
      expect(getPendingPurgeCount).toHaveBeenCalledTimes(1)
    })

    it('does not purge anything', async () => {
      await request(app).get(PENDING).set(superAdminHeaders).expect(200)

      expect(purgeExpiredRecords).not.toHaveBeenCalled()
    })

    it('returns 500 with an error envelope when the count fails', async () => {
      vi.mocked(getPendingPurgeCount).mockRejectedValueOnce(new Error('database down'))

      const res = await request(app).get(PENDING).set(superAdminHeaders)

      expect(res.status).toBe(500)
      expect(res.body.error).toBeDefined()
    })
  })

  describe('POST /api/v1/admin/data-retention/purge', () => {
    it('purges expired records and reports each table it touched', async () => {
      vi.mocked(purgeExpiredRecords).mockResolvedValue([
        { table: 'users', recordsDeleted: 2 },
        { table: 'sessions', recordsDeleted: 3 },
      ])
      const infoSpy = vi.spyOn(logger, 'info')

      const res = await request(app).post(PURGE).set(superAdminHeaders).expect(200)

      expect(res.body).toEqual({
        success: true,
        totalDeleted: 5,
        tables: [
          { table: 'users', recordsDeleted: 2 },
          { table: 'sessions', recordsDeleted: 3 },
        ],
      })
      expect(purgeExpiredRecords).toHaveBeenCalledTimes(1)
      expect(infoSpy).toHaveBeenCalledWith(
        'Manual purge triggered by admin',
        expect.objectContaining({
          adminUserId: superAdminId,
          totalDeleted: 5,
          tablesPurged: 2,
        }),
      )
    })

    it('is idempotent: a second purge with nothing left to delete reports zero', async () => {
      vi.mocked(purgeExpiredRecords)
        .mockResolvedValueOnce([{ table: 'users', recordsDeleted: 2 }])
        .mockResolvedValueOnce([])

      const first = await request(app).post(PURGE).set(superAdminHeaders).expect(200)
      const second = await request(app).post(PURGE).set(superAdminHeaders).expect(200)

      expect(first.body.totalDeleted).toBe(2)
      expect(second.body).toEqual({ success: true, totalDeleted: 0, tables: [] })
      expect(purgeExpiredRecords).toHaveBeenCalledTimes(2)
    })

    it('returns 500 with an error envelope and reports no success when the purge fails', async () => {
      vi.mocked(purgeExpiredRecords).mockRejectedValueOnce(new Error('transaction aborted'))
      const infoSpy = vi.spyOn(logger, 'info')

      const res = await request(app).post(PURGE).set(superAdminHeaders)

      expect(res.status).toBe(500)
      expect(res.body.error).toBeDefined()
      expect(res.body.success).toBeUndefined()
      expect(infoSpy).not.toHaveBeenCalledWith(
        'Manual purge triggered by admin',
        expect.anything(),
      )
    })

    it('does not reach the purge for a refused caller', async () => {
      await request(app).post(PURGE).set(adminHeaders).expect(403)
      await request(app).post(PURGE).set(tenantHeaders).expect(403)

      expect(purgeExpiredRecords).not.toHaveBeenCalled()
    })
  })
})
