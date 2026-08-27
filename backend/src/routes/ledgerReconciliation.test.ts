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
    })

    it('should reject request with invalid x-admin-secret header with 403', async () => {
      const res = await request(app)
        .get('/api/admin/ledger-reconciliation/mismatches')
        .set('x-admin-secret', 'wrong-secret')
      expect(res.status).toBe(403)
    })
  })

  describe('GET /api/admin/ledger-reconciliation/mismatches', () => {
    it('should return paginated list of mismatches', async () => {
      vi.spyOn(store, 'listMismatches').mockResolvedValue([
        {
          id: 'mis-1',
          mismatchClass: 'missing_credit',
          status: 'open',
          internalRef: 'ref-1',
          amountMinor: 50000n,
          currency: 'NGN',
          createdAt: new Date(),
        } as any,
      ])

      const res = await request(app)
        .get('/api/admin/ledger-reconciliation/mismatches?status=open&mismatch_class=missing_credit&limit=10')
        .set('x-admin-secret', adminSecret)

      expect(res.status).toBe(200)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.count).toBe(1)
    })
  })

  describe('GET /api/admin/ledger-reconciliation/aging', () => {
    it('should return aging report', async () => {
      vi.spyOn(store, 'getMismatchAgingReport').mockResolvedValue([] as any)

      const res = await request(app)
        .get('/api/admin/ledger-reconciliation/aging')
        .set('x-admin-secret', adminSecret)

      expect(res.status).toBe(200)
      expect(res.body.data).toEqual([])
    })
  })

  describe('POST /api/admin/ledger-reconciliation/mismatches/:id/close', () => {
    it('should close a mismatch and return ok', async () => {
      vi.spyOn(store, 'updateMismatchStatus').mockResolvedValue(undefined as any)

      const res = await request(app)
        .post('/api/admin/ledger-reconciliation/mismatches/mis-1/close')
        .set('x-admin-secret', adminSecret)

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
    })
  })

  describe('POST /api/admin/ledger-reconciliation/run', () => {
    it('should run passes', async () => {
      vi.spyOn(engine, 'runReconciliationPass').mockResolvedValue({} as any)
      vi.spyOn(resolver, 'runResolutionPass').mockResolvedValue({} as any)

      const res = await request(app)
        .post('/api/admin/ledger-reconciliation/run')
        .set('x-admin-secret', adminSecret)

      expect(res.status).toBe(200)
      expect(res.body.reconciliation).toBeDefined()
    })
  })

  describe('POST /api/admin/ledger-reconciliation/ledger-events', () => {
    it('should ingest ledger event', async () => {
      vi.spyOn(store, 'ingestLedgerEvent').mockResolvedValue({
        id: 'evt-1',
        amountMinor: 50000n,
      } as any)

      const res = await request(app)
        .post('/api/admin/ledger-reconciliation/ledger-events')
        .set('x-admin-secret', adminSecret)
        .send({
          eventType: 'credit',
          amountMinor: 50000,
          currency: 'NGN',
          internalRef: 'ref-1',
          rail: 'bank_transfer',
          occurredAt: new Date().toISOString(),
        })

      expect(res.status).toBe(201)
      expect(res.body.data.id).toBe('evt-1')
    })
  })

  describe('POST /api/admin/ledger-reconciliation/provider-events', () => {
    it('should ingest provider event', async () => {
      vi.spyOn(store, 'ingestProviderEvent').mockResolvedValue({
        id: 'pevt-1',
        amountMinor: 100000n,
      } as any)

      const res = await request(app)
        .post('/api/admin/ledger-reconciliation/provider-events')
        .set('x-admin-secret', adminSecret)
        .send({
          provider: 'flutterwave',
          providerEventId: 'p-123',
          eventType: 'credit',
          amountMinor: 100000,
          currency: 'NGN',
          rawStatus: 'successful',
          occurredAt: new Date().toISOString(),
        })

      expect(res.status).toBe(201)
      expect(res.body.data.id).toBe('pevt-1')
    })
  })
})