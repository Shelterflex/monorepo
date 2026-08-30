import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import { errorHandler } from '../middleware/errorHandler.js'
import { createAdminAuditLogsRouter } from './adminAuditLogs.js'
import { auditLogRepository } from '../repositories/AuditLogRepository.js'

vi.mock('../repositories/AuditLogRepository.js', () => ({
  auditLogRepository: {
    list: vi.fn(),
  },
}))

vi.mock('../schemas/env.js', () => ({
  env: {
    MANUAL_ADMIN_SECRET: 'test-secret',
  },
}))

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use((req: any, _res: any, next: any) => {
    req.requestId = 'test-request-id'
    next()
  })
  app.use('/api/v1/admin/audit-logs', createAdminAuditLogsRouter())
  app.use(errorHandler)
  return app
}

describe('Admin Audit Logs Routes', () => {
  describe('GET /api/v1/admin/audit-logs', () => {
    it('should list audit logs with valid admin secret', async () => {
      vi.mocked(auditLogRepository.list).mockResolvedValue({
        entries: [
          {
            id: 'log-1',
            action: 'USER_LOGIN',
            actorId: 'user-123',
            actorType: 'user',
            resourceType: 'user',
            resourceId: 'user-123',
            ipAddress: '192.168.1.1',
            result: 'success',
            metadata: {},
            createdAt: new Date('2024-01-01T00:00:00Z'),
          },
        ],
        total: 1,
        page: 1,
        limit: 50,
        totalPages: 1,
      })

      const res = await request(buildApp())
        .get('/api/v1/admin/audit-logs')
        .set('x-admin-secret', 'test-secret')

      expect(res.status).toBe(200)
      expect(res.body.entries).toBeInstanceOf(Array)
      expect(res.body.entries.length).toBeGreaterThan(0)
      expect(res.body.entries[0]).toMatchObject({
        id: 'log-1',
        action: 'USER_LOGIN',
        actorId: 'user-123',
        result: 'success',
      })
      expect(res.body.pagination).toMatchObject({
        total: 1,
        page: 1,
        limit: 50,
        totalPages: 1,
      })
    })

    it('should filter by actorId', async () => {
      vi.mocked(auditLogRepository.list).mockResolvedValue({
        entries: [
          {
            id: 'log-2',
            action: 'DEAL_CREATED',
            actorId: 'user-456',
            actorType: 'user',
            resourceType: 'deal',
            resourceId: 'deal-123',
            ipAddress: null,
            result: 'success',
            metadata: {},
            createdAt: new Date('2024-01-02T00:00:00Z'),
          },
        ],
        total: 1,
        page: 1,
        limit: 50,
        totalPages: 1,
      })

      const res = await request(buildApp())
        .get('/api/v1/admin/audit-logs?actorId=user-456')
        .set('x-admin-secret', 'test-secret')

      expect(res.status).toBe(200)
      expect(vi.mocked(auditLogRepository.list)).toHaveBeenCalledWith(
        { actorId: 'user-456' },
        { page: 1, limit: 50 }
      )
    })

    it('should filter by action', async () => {
      vi.mocked(auditLogRepository.list).mockResolvedValue({
        entries: [],
        total: 0,
        page: 1,
        limit: 50,
        totalPages: 0,
      })

      const res = await request(buildApp())
        .get('/api/v1/admin/audit-logs?action=USER_LOGIN')
        .set('x-admin-secret', 'test-secret')

      expect(res.status).toBe(200)
      expect(vi.mocked(auditLogRepository.list)).toHaveBeenCalledWith(
        { action: 'USER_LOGIN' },
        { page: 1, limit: 50 }
      )
    })

    it('should filter by resourceType and resourceId', async () => {
      vi.mocked(auditLogRepository.list).mockResolvedValue({
        entries: [],
        total: 0,
        page: 1,
        limit: 50,
        totalPages: 0,
      })

      const res = await request(buildApp())
        .get('/api/v1/admin/audit-logs?resourceType=deal&resourceId=deal-123')
        .set('x-admin-secret', 'test-secret')

      expect(res.status).toBe(200)
      expect(vi.mocked(auditLogRepository.list)).toHaveBeenCalledWith(
        { resourceType: 'deal', resourceId: 'deal-123' },
        { page: 1, limit: 50 }
      )
    })

    it('should filter by date range', async () => {
      vi.mocked(auditLogRepository.list).mockResolvedValue({
        entries: [],
        total: 0,
        page: 1,
        limit: 50,
        totalPages: 0,
      })

      const startDate = '2024-01-01T00:00:00Z'
      const endDate = '2024-01-31T23:59:59Z'

      const res = await request(buildApp())
        .get(`/api/v1/admin/audit-logs?startDate=${startDate}&endDate=${endDate}`)
        .set('x-admin-secret', 'test-secret')

      expect(res.status).toBe(200)
      expect(vi.mocked(auditLogRepository.list)).toHaveBeenCalledWith(
        {
          startDate: new Date(startDate),
          endDate: new Date(endDate),
        },
        { page: 1, limit: 50 }
      )
    })

    it('should support pagination', async () => {
      vi.mocked(auditLogRepository.list).mockResolvedValue({
        entries: [],
        total: 100,
        page: 2,
        limit: 25,
        totalPages: 4,
      })

      const res = await request(buildApp())
        .get('/api/v1/admin/audit-logs?page=2&limit=25')
        .set('x-admin-secret', 'test-secret')

      expect(res.status).toBe(200)
      expect(vi.mocked(auditLogRepository.list)).toHaveBeenCalledWith(
        {},
        { page: 2, limit: 25 }
      )
      expect(res.body.pagination).toMatchObject({
        total: 100,
        page: 2,
        limit: 25,
        totalPages: 4,
      })
    })

    it('should validate limit parameter (max 200)', async () => {
      const res = await request(buildApp())
        .get('/api/v1/admin/audit-logs?limit=300')
        .set('x-admin-secret', 'test-secret')

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('should validate page parameter (must be positive)', async () => {
      const res = await request(buildApp())
        .get('/api/v1/admin/audit-logs?page=0')
        .set('x-admin-secret', 'test-secret')

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('should validate startDate format', async () => {
      const res = await request(buildApp())
        .get('/api/v1/admin/audit-logs?startDate=invalid-date')
        .set('x-admin-secret', 'test-secret')

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('should reject request without admin secret', async () => {
      vi.mocked(auditLogRepository.list).mockResolvedValue({
        entries: [],
        total: 0,
        page: 1,
        limit: 50,
        totalPages: 0,
      })

      const res = await request(buildApp()).get('/api/v1/admin/audit-logs')

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('FORBIDDEN')
      expect(res.body.error.message).toBe('Invalid admin secret')
    })

    it('should reject request with invalid admin secret', async () => {
      vi.mocked(auditLogRepository.list).mockResolvedValue({
        entries: [],
        total: 0,
        page: 1,
        limit: 50,
        totalPages: 0,
      })

      const res = await request(buildApp())
        .get('/api/v1/admin/audit-logs')
        .set('x-admin-secret', 'wrong-secret')

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('FORBIDDEN')
    })

    it('should return empty results when no logs match filters', async () => {
      vi.mocked(auditLogRepository.list).mockResolvedValue({
        entries: [],
        total: 0,
        page: 1,
        limit: 50,
        totalPages: 0,
      })

      const res = await request(buildApp())
        .get('/api/v1/admin/audit-logs?action=NONEXISTENT_ACTION')
        .set('x-admin-secret', 'test-secret')

      expect(res.status).toBe(200)
      expect(res.body.entries).toEqual([])
      expect(res.body.pagination.total).toBe(0)
    })

    it('should include all entry fields in response', async () => {
      vi.mocked(auditLogRepository.list).mockResolvedValue({
        entries: [
          {
            id: 'log-3',
            action: 'PAYMENT_APPROVED',
            actorId: 'admin-1',
            actorType: 'admin',
            resourceType: 'payment',
            resourceId: 'payment-123',
            ipAddress: '10.0.0.1',
            result: 'success',
            metadata: { amount: 5000 },
            createdAt: new Date('2024-01-03T00:00:00Z'),
          },
        ],
        total: 1,
        page: 1,
        limit: 50,
        totalPages: 1,
      })

      const res = await request(buildApp())
        .get('/api/v1/admin/audit-logs')
        .set('x-admin-secret', 'test-secret')

      expect(res.status).toBe(200)
      expect(res.body.entries[0]).toMatchObject({
        id: 'log-3',
        action: 'PAYMENT_APPROVED',
        actorId: 'admin-1',
        actorType: 'admin',
        resourceType: 'payment',
        resourceId: 'payment-123',
        ipAddress: '10.0.0.1',
        result: 'success',
        metadata: { amount: 5000 },
        createdAt: '2024-01-03T00:00:00.000Z',
      })
    })
  })
})
