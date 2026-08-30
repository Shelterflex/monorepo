import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { errorHandler } from '../middleware/errorHandler.js'
import { createAdminAuditRouter } from './adminAudit.js'

/**
 * Tests for GET /api/admin/audit and GET /api/admin/audit/verify.
 *
 * Mounts the router directly on a minimal Express app, with MANUAL_ADMIN_SECRET
 * mocked so the admin-secret guard (backend/src/middleware/adminSecret.ts) is
 * exercised the same way it is in production — every request below sends the
 * matching x-admin-secret header. Focuses on the business logic: search,
 * filter forwarding, pagination, and chain verification responses.
 */

const { mockSearch, mockVerifyChain, mockAppend, ADMIN_SECRET } = vi.hoisted(() => ({
  mockSearch: vi.fn(),
  mockVerifyChain: vi.fn(),
  mockAppend: vi.fn(),
  ADMIN_SECRET: 'test-admin-secret',
}))

vi.mock('../schemas/env.js', () => ({
  env: {
    MANUAL_ADMIN_SECRET: ADMIN_SECRET,
  },
}))

vi.mock('../repositories/AuditRepository.js', () => ({
  AuditRepository: vi.fn().mockImplementation(() => ({
    search: mockSearch,
    verifyChain: mockVerifyChain,
    append: mockAppend,
  })),
  auditRepository: {
    search: mockSearch,
    verifyChain: mockVerifyChain,
    append: mockAppend,
  },
}))

vi.mock('../db.js', () => ({
  getPool: vi.fn(async () => null),
  setPool: vi.fn(),
  getPoolMetrics: vi.fn(() => null),
}))

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use((req: any, _res: any, next: any) => {
    req.requestId = 'test-request-id'
    next()
  })
  app.use('/api/admin', createAdminAuditRouter())
  app.use(errorHandler)
  return app
}

describe('Admin Audit Routes', () => {
  beforeEach(() => {
    mockSearch.mockReset()
    mockVerifyChain.mockReset()
    mockAppend.mockReset()
  })

  describe('GET /api/admin/audit', () => {
    it('returns paginated audit entries', async () => {
      const fakeEntry = {
        id: 'entry-1',
        eventType: 'AUTH_LOGIN_SUCCESS',
        actorType: 'user',
        userId: 'user-1',
        requestId: 'req-1',
        ipAddress: '127.0.0.1',
        httpMethod: 'POST',
        httpPath: '/api/auth/verify-otp',
        metadata: {},
        createdAt: new Date('2026-01-01T00:00:00Z'),
      }

      mockSearch.mockResolvedValue({
        entries: [fakeEntry],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      })

      const res = await request(buildApp())
        .get('/api/admin/audit')
        .set('x-admin-secret', ADMIN_SECRET)

      expect(res.status).toBe(200)
      expect(res.body.entries).toHaveLength(1)
      expect(res.body.entries[0].eventType).toBe('AUTH_LOGIN_SUCCESS')
      expect(res.body.entries[0].createdAt).toBe('2026-01-01T00:00:00.000Z')
      expect(res.body.pagination).toMatchObject({ total: 1, page: 1, pageSize: 50, totalPages: 1 })
    })

    it('passes filters to the repository', async () => {
      mockSearch.mockResolvedValue({ entries: [], total: 0, page: 1, pageSize: 50, totalPages: 0 })

      await request(buildApp())
        .get('/api/admin/audit?eventType=AUTH_LOGOUT&userId=user-42&page=2&pageSize=10')
        .set('x-admin-secret', ADMIN_SECRET)
        .expect(200)

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'AUTH_LOGOUT', userId: 'user-42', page: 2, pageSize: 10 }),
      )
    })

    it('passes date filters to the repository', async () => {
      mockSearch.mockResolvedValue({ entries: [], total: 0, page: 1, pageSize: 50, totalPages: 0 })

      await request(buildApp())
        .get('/api/admin/audit?dateFrom=2026-01-01T00:00:00.000Z&dateTo=2026-01-31T23:59:59.999Z')
        .set('x-admin-secret', ADMIN_SECRET)
        .expect(200)

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          dateFrom: new Date('2026-01-01T00:00:00.000Z'),
          dateTo: new Date('2026-01-31T23:59:59.999Z'),
        }),
      )
    })

    it('returns 400 for invalid pageSize', async () => {
      const res = await request(buildApp())
        .get('/api/admin/audit?pageSize=9999')
        .set('x-admin-secret', ADMIN_SECRET)
      expect(res.status).toBe(400)
    })

    it('returns empty list when no entries match', async () => {
      mockSearch.mockResolvedValue({ entries: [], total: 0, page: 1, pageSize: 50, totalPages: 0 })

      const res = await request(buildApp())
        .get('/api/admin/audit')
        .set('x-admin-secret', ADMIN_SECRET)
      expect(res.status).toBe(200)
      expect(res.body.entries).toHaveLength(0)
      expect(res.body.pagination.total).toBe(0)
    })

    it('rejects the request when no x-admin-secret header is sent', async () => {
      const res = await request(buildApp()).get('/api/admin/audit')
      expect(res.status).toBe(403)
      expect(mockSearch).not.toHaveBeenCalled()
    })
  })

  describe('GET /api/admin/audit/verify', () => {
    it('returns 200 when chain is valid', async () => {
      mockVerifyChain.mockResolvedValue({ valid: true, checkedCount: 42, firstBrokenId: null, error: null })

      const res = await request(buildApp())
        .get('/api/admin/audit/verify')
        .set('x-admin-secret', ADMIN_SECRET)

      expect(res.status).toBe(200)
      expect(res.body.valid).toBe(true)
      expect(res.body.checkedCount).toBe(42)
      expect(res.body.firstBrokenId).toBeNull()
    })

    it('returns 409 when chain is broken', async () => {
      mockVerifyChain.mockResolvedValue({
        valid: false,
        checkedCount: 5,
        firstBrokenId: 'broken-row-id',
        error: 'event_hash mismatch for row broken-row-id',
      })

      const res = await request(buildApp())
        .get('/api/admin/audit/verify')
        .set('x-admin-secret', ADMIN_SECRET)

      expect(res.status).toBe(409)
      expect(res.body.valid).toBe(false)
      expect(res.body.firstBrokenId).toBe('broken-row-id')
      expect(res.body.error).toMatch(/event_hash mismatch/)
    })

    it('uses default limit of 1000 when not specified', async () => {
      mockVerifyChain.mockResolvedValue({ valid: true, checkedCount: 100, firstBrokenId: null, error: null })

      await request(buildApp())
        .get('/api/admin/audit/verify')
        .set('x-admin-secret', ADMIN_SECRET)
        .expect(200)

      expect(mockVerifyChain).toHaveBeenCalledWith(1000)
    })

    it('respects the limit query param', async () => {
      mockVerifyChain.mockResolvedValue({ valid: true, checkedCount: 500, firstBrokenId: null, error: null })

      await request(buildApp())
        .get('/api/admin/audit/verify?limit=500')
        .set('x-admin-secret', ADMIN_SECRET)
        .expect(200)

      expect(mockVerifyChain).toHaveBeenCalledWith(500)
    })

    it('returns 400 for limit exceeding max', async () => {
      const res = await request(buildApp())
        .get('/api/admin/audit/verify?limit=99999')
        .set('x-admin-secret', ADMIN_SECRET)
      expect(res.status).toBe(400)
    })

    it('rejects the request when no x-admin-secret header is sent', async () => {
      const res = await request(buildApp()).get('/api/admin/audit/verify')
      expect(res.status).toBe(403)
      expect(mockVerifyChain).not.toHaveBeenCalled()
    })
  })
})
