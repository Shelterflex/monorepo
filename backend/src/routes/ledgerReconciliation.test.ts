import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import express, { type Express } from 'express'
import { createLedgerReconciliationRouter } from './ledgerReconciliation.js'
import * as store from '../reconciliation/store.js'
import * as engine from '../reconciliation/engine.js'
import * as resolver from '../reconciliation/resolver.js'
import { errorHandler } from '../middleware/errorHandler.js'

describe('Ledger Reconciliation Routes', () => {
  let app: Express
  const adminSecret = 'test-admin-secret-456'

  beforeEach(() => {
    vi.stubEnv('MANUAL_ADMIN_SECRET', adminSecret)

    app = express()
    app.use(express.json())
    app.use('/api/admin/ledger-reconciliation', createLedgerReconciliationRouter())
    app.use(errorHandler)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  describe('Authentication & Authorization', () => {
    it('should reject request without x-admin-secret header with 403', async () => {
      const res = await request(app).get('/api/admin/ledger-reconciliation/mismatches')
      expect(res.status).toBe(403)
      expect(res.body.error).toBeDefined()
    })

    it('should reject request with invalid x-admin-secret header with 403', async () => {
      const res = await request(app)
        .get('/api/admin/ledger-reconciliation/mismatches')
        .set('x-admin-secret', 'wrong-secret')
      expect(res.status).toBe(403)
      expect(res.body.error).toBeDefined()
    })
  })

  describe('GET /api/admin/ledger-reconciliation/mismatches', () => {
    it('should return paginated list of mismatches', async () => {
      const mockMismatches = [
        {
          id: 'mis-1',
          mismatchClass: 'missing_credit',
          status: 'open',
          internalRef: 'ref-1',
          amountMinor: 50000n,
          currency: 'NGN',
          createdAt: new Date(),
        },
      ]
      vi.spyOn(store, 'listMismatches').mockResolvedValue(mockMismatches as any)

      const res = await request(app)
        .get('/api/admin/ledger-reconciliation/mismatches?status=open&mismatch_class=missing_credit&limit=10')
        .set('x-admin-secret', adminSecret)

      expect(res.status).toBe(200)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.count).toBe(1)
      expect(res.body.data[0].id).toBe('mis-1')
    })

    it('should validate query parameters and reject invalid status enum', async () => {
      const res = await request(app)
        .get('/api/admin/ledger-reconciliation/mismatches?status=invalid_status')
        .set('x-admin-secret', adminSecret)

      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/admin/ledger-reconciliation/aging', () => {
    it('should return SLA aging report grouped by class/status', async () => {
      const mockAging = [
        {
          mismatchClass: 'missing_credit',
          status: 'open',
          ageBucket: '0-24h',
          count: 5,
          totalAmountMinor: 250000n,
        },
      ]
      vi.spyOn(store, 'getMismatchAgingReport').mockResolvedValue(mockAging as any)

      const res = await request(app)
        .get('/api/admin/ledger-reconciliation/aging')
        .set('x-admin-secret', adminSecret)

      expect(res.status).toBe(200)
      expect(res.body.data).toEqual(mockAging)
    })
  })

  describe('POST /api/admin/ledger-reconciliation/mismatches/:id/close', () => {
    it('should manually close a mismatch and return ok', async () => {
      const updateSpy = vi.spyOn(store, 'updateMismatchStatus').mockResolvedValue(undefined as any)

      const res = await request(app)
        .post('/api/admin/ledger-reconciliation/mismatches/mis-123/close')
        .set('x-admin-secret', adminSecret)

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(updateSpy).toHaveBeenCalledWith(
        'mis-123',
        'closed',
        expect.objectContaining({
          resolutionWorkflow: 'manual_close',
        }),
      )
    })
  })

  describe('POST /api/admin/ledger-reconciliation/run', () => {
    it('should trigger reconciliation and resolution passes', async () => {
      const reconResult = { matchedCount: 10, mismatchCount: 1 }
      const resolveResult = { resolvedCount: 1, escalatedCount: 0 }
      vi.spyOn(engine, 'runReconciliationPass').mockResolvedValue(reconResult as any)
      vi.spyOn(resolver, 'runResolutionPass').mockResolvedValue(resolveResult as any)

      const res = await request(app)
        .post('/api/admin/ledger-reconciliation/run')
        .set('x-admin-secret', adminSecret)

      expect(res.status).toBe(200)
      expect(res.body.reconciliation).toEqual(reconResult)
      expect(res.body.resolution).toEqual(resolveResult)
    })
  })

  describe('POST /api/admin/ledger-reconciliation/ledger-events', () => {
    it('should ingest internal ledger event successfully', async () => {
      const mockEvent = {
        id: 'evt-1',
        eventType: 'credit',
        amountMinor: 50000n,
        currency: 'NGN',
        internalRef: 'ref-1',
        rail: 'bank_transfer',
        occurredAt: new Date(),
      }
      vi.spyOn(store, 'ingestLedgerEvent').mockResolvedValue(mockEvent as any)

      const payload = {
        eventType: 'credit',
        amountMinor: 50000,
        currency: 'NGN',
        internalRef: 'ref-1',
        rail: 'bank_transfer',
        occurredAt: new Date().toISOString(),
      }

      const res = await request(app)
        .post('/api/admin/ledger-reconciliation/ledger-events')
        .set('x-admin-secret', adminSecret)
        .send(payload)

      expect(res.status).toBe(201)
      expect(res.body.data.id).toBe('evt-1')
      expect(res.body.data.amountMinor).toBe('50000')
    })

    it('should reject invalid ledger event request body', async () => {
      const invalidPayload = {
        eventType: 'invalid_type',
        amountMinor: -100,
      }

      const res = await request(app)
        .post('/api/admin/ledger-reconciliation/ledger-events')
        .set('x-admin-secret', adminSecret)
        .send(invalidPayload)

      expect(res.status).toBe(400)
    })
  })

  describe('POST /api/admin/ledger-reconciliation/provider-events', () => {
    it('should ingest provider settlement event successfully', async () => {
      const mockEvent = {
        id: 'pevt-1',
        provider: 'flutterwave',
        providerEventId: 'p-123',
        eventType: 'credit',
        amountMinor: 100000n,
        currency: 'NGN',
        rawStatus: 'successful',
        occurredAt: new Date(),
      }
      vi.spyOn(store, 'ingestProviderEvent').mockResolvedValue(mockEvent as any)

      const payload = {
        provider: 'flutterwave',
        providerEventId: 'p-123',
        eventType: 'credit',
        amountMinor: 100000,
        currency: 'NGN',
        rawStatus: 'successful',
        occurredAt: new Date().toISOString(),
      }

      const res = await request(app)
        .post('/api/admin/ledger-reconciliation/provider-events')
        .set('x-admin-secret', adminSecret)
        .send(payload)

      expect(res.status).toBe(201)
      expect(res.body.data.id).toBe('pevt-1')
      expect(res.body.data.amountMinor).toBe('100000')
    })

    it('should reject invalid provider event request body', async () => {
      const invalidPayload = {
        provider: '',
        amountMinor: 0,
      }

      const res = await request(app)
        .post('/api/admin/ledger-reconciliation/provider-events')
        .set('x-admin-secret', adminSecret)
        .send(invalidPayload)

      expect(res.status).toBe(400)
    })
  })
})