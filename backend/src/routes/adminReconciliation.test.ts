import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import express, { type Express } from 'express'
import { createAdminReconciliationRouter } from './adminReconciliation.js'
import { NgnWalletService } from '../services/ngnWalletService.js'
import { ngnDepositStore } from '../models/ngnDepositStore.js'
import { depositStore } from '../models/depositStore.js'
import { conversionStore } from '../models/conversionStore.js'
import { outboxStore, OutboxStatus } from '../outbox/index.js'
import { userRiskStateStore } from '../models/userRiskStateStore.js'
import { errorHandler } from '../middleware/errorHandler.js'

describe('Admin Reconciliation Routes', () => {
  let app: Express
  let ngnWalletService: NgnWalletService
  const adminSecret = 'test-admin-secret-123'

  beforeEach(() => {
    vi.stubEnv('MANUAL_ADMIN_SECRET', adminSecret)
    ngnWalletService = new NgnWalletService()

    app = express()
    app.use(express.json())
    app.use('/api/admin/reconciliation', createAdminReconciliationRouter(ngnWalletService))
    app.use(errorHandler)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  describe('Authentication & Authorization', () => {
    it('should reject request without x-admin-secret header with 403', async () => {
      const res = await request(app).get('/api/admin/reconciliation/deposits')
      expect(res.status).toBe(403)
      expect(res.body.error).toBeDefined()
    })

    it('should reject request with invalid x-admin-secret header with 403', async () => {
      const res = await request(app)
        .get('/api/admin/reconciliation/deposits')
        .set('x-admin-secret', 'wrong-secret')
      expect(res.status).toBe(403)
      expect(res.body.error).toBeDefined()
    })
  })

  describe('GET /api/admin/reconciliation/deposits', () => {
    it('should return merged and sorted deposits matching schema enum', async () => {
      const now = new Date()
      vi.spyOn(ngnDepositStore, 'listByStatus').mockResolvedValue([
        {
          depositId: 'ngn-1',
          userId: 'user-1',
          amountNgn: 50000,
          rail: 'bank_transfer',
          status: 'confirmed',
          externalRefSource: 'paystack',
          externalRef: 'ref-1',
          createdAt: new Date(now.getTime() - 1000),
          updatedAt: now,
        } as any,
      ])

      vi.spyOn(depositStore, 'listInitiations').mockResolvedValue([
        {
          depositId: 'stk-1',
          userId: 'user-2',
          amountNgn: 100000,
          paymentRail: 'card',
          status: 'pending',
          externalRefSource: 'flutterwave',
          externalRef: 'ref-2',
          createdAt: now,
          updatedAt: now,
        } as any,
      ])

      const res = await request(app)
        .get('/api/admin/reconciliation/deposits?limit=10')
        .set('x-admin-secret', adminSecret)

      expect(res.status).toBe(200)
      expect(res.body.items).toHaveLength(2)
      expect(res.body.items[0].depositId).toBe('stk-1')
      expect(res.body.items[0].flow).toBe('staking')
      expect(res.body.items[0].status).toBe('pending')
      expect(res.body.items[1].depositId).toBe('ngn-1')
      expect(res.body.items[1].flow).toBe('ngn_wallet')
      expect(res.body.items[1].status).toBe('confirmed')
    })
  })

  describe('GET /api/admin/reconciliation/wallets', () => {
    it('should return wallets with risk freeze status', async () => {
      vi.spyOn(ngnWalletService, 'listNegativeBalances').mockResolvedValue({
        items: [
          {
            userId: 'user-neg-1',
            balance: {
              availableNgn: -5000,
              heldNgn: 0,
              totalNgn: -5000,
            },
          } as any,
        ],
        nextCursor: null,
      })

      vi.spyOn(userRiskStateStore, 'getByUserId').mockResolvedValue({
        userId: 'user-neg-1',
        isFrozen: true,
      } as any)

      const res = await request(app)
        .get('/api/admin/reconciliation/wallets')
        .set('x-admin-secret', adminSecret)

      expect(res.status).toBe(200)
      expect(res.body.items).toHaveLength(1)
      expect(res.body.items[0].userId).toBe('user-neg-1')
      expect(res.body.items[0].isFrozen).toBe(true)
    })
  })

  describe('GET /api/admin/reconciliation/conversions', () => {
    it('should return conversions list formatted with string amounts', async () => {
      const now = new Date()
      vi.spyOn(conversionStore, 'listByStatus').mockResolvedValue([
        {
          conversionId: 'conv-1',
          depositId: 'dep-1',
          userId: 'user-1',
          amountNgn: 100000,
          amountUsdc: '65',
          fxRateNgnPerUsdc: 1538.46,
          provider: 'yellowcard',
          status: 'completed',
          createdAt: now,
          updatedAt: now,
        } as any,
      ])

      const res = await request(app)
        .get('/api/admin/reconciliation/conversions')
        .set('x-admin-secret', adminSecret)

      expect(res.status).toBe(200)
      expect(res.body.items).toHaveLength(1)
      expect(res.body.items[0].conversionId).toBe('conv-1')
      expect(res.body.items[0].status).toBe('completed')
    })
  })

  describe('GET /api/admin/reconciliation/outbox', () => {
    it('should return outbox items', async () => {
      const now = new Date()
      vi.spyOn(outboxStore, 'listAll').mockResolvedValue([
        {
          id: 'out-1',
          txType: 'DISBURSEMENT',
          txId: 'tx-1',
          canonicalExternalRefV1: 'ext-ref-1',
          status: OutboxStatus.PENDING,
          attempts: 1,
          lastError: null,
          createdAt: now,
          updatedAt: now,
        } as any,
      ])

      const res = await request(app)
        .get('/api/admin/reconciliation/outbox')
        .set('x-admin-secret', adminSecret)

      expect(res.status).toBe(200)
      expect(res.body.items).toHaveLength(1)
      expect(res.body.items[0].id).toBe('out-1')
    })
  })
})