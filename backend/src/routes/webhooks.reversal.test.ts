import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express, { type Express } from 'express'
import { createWebhooksRouter } from './webhooks.js'
import { NgnWalletService } from '../services/ngnWalletService.js'
import { depositStore } from '../models/depositStore.js'
import { userRiskStateStore } from '../models/userRiskStateStore.js'
import { errorHandler } from '../middleware/errorHandler.js'

describe('Webhooks - Deposit Reversal', () => {
  let app: Express
  let ngnWalletService: NgnWalletService
  const testUserId = 'test-user-webhook'
  const testDepositId = 'deposit-webhook-123'

  beforeEach(async () => {
    ngnWalletService = new NgnWalletService()
    await depositStore.clear()
    userRiskStateStore.clear()

    // Setup Express app
    app = express()
    app.use(express.json())
    app.use((req: any, _res, next) => {
      req.requestId = 'test-request-id'
      next()
    })
    app.use('/api/webhooks', createWebhooksRouter(ngnWalletService))
    app.use(errorHandler)

    // Disable webhook signature for tests and clear secrets
    process.env.WEBHOOK_SIGNATURE_ENABLED = 'false'
    delete process.env.PAYSTACK_SECRET
    delete process.env.FLUTTERWAVE_SECRET
    delete process.env.MANUAL_ADMIN_SECRET
    delete process.env.WEBHOOK_SECRET
  })

  describe('POST /api/webhooks/reversals/:provider', () => {
    it('should process deposit reversal and freeze user if balance goes negative', async () => {
      // Setup: Create a confirmed deposit
      await depositStore.confirm({
        depositId: testDepositId,
        userId: testUserId,
        amountNgn: 100000,
        provider: 'onramp',
        providerRef: 'ONRAMP-WEBHOOK-REF-1',
      })

      // Act: Send reversal webhook
      const response = await request(app)
        .post('/api/webhooks/reversals/onramp')
        .send({
          provider: 'onramp',
          providerRef: 'ONRAMP-WEBHOOK-REF-1',
          reversalRef: 'REVERSAL-WEBHOOK-1',
          eventType: 'deposit.reversed',
          timestamp: new Date().toISOString(),
        })
        .expect(200)

      expect(response.body.success).toBe(true)

      // Assert: Deposit should be marked as reversed
      const deposit = await depositStore.getById(testDepositId)
      expect(deposit?.reversedAt).toBeTruthy()
      expect(deposit?.reversalRef).toBe('REVERSAL-WEBHOOK-1')

      // Assert: User balance should be debited
      const balance = await ngnWalletService.getBalance(testUserId)
      expect(balance.totalNgn).toBeLessThan(0)

      // Assert: User should be frozen
      const riskState = await userRiskStateStore.getByUserId(testUserId)
      expect(riskState?.isFrozen).toBe(true)
      expect(riskState?.freezeReason).toBe('NEGATIVE_BALANCE')
    })

    it('should be idempotent - processing same reversal twice should not double-debit', async () => {
      // Setup: Create a confirmed deposit
      await depositStore.confirm({
        depositId: testDepositId,
        userId: testUserId,
        amountNgn: 10000,
        provider: 'onramp',
        providerRef: 'ONRAMP-WEBHOOK-REF-2',
      })

      const balanceBeforeFirst = await ngnWalletService.getBalance(testUserId)

      // Act: Send reversal webhook twice
      await request(app)
        .post('/api/webhooks/reversals/onramp')
        .send({
          provider: 'onramp',
          providerRef: 'ONRAMP-WEBHOOK-REF-2',
          reversalRef: 'REVERSAL-WEBHOOK-2',
          eventType: 'deposit.reversed',
          timestamp: new Date().toISOString(),
        })
        .expect(200)

      const balanceAfterFirst = await ngnWalletService.getBalance(testUserId)

      await request(app)
        .post('/api/webhooks/reversals/onramp')
        .send({
          provider: 'onramp',
          providerRef: 'ONRAMP-WEBHOOK-REF-2',
          reversalRef: 'REVERSAL-WEBHOOK-2',
          eventType: 'deposit.reversed',
          timestamp: new Date().toISOString(),
        })
        .expect(200)

      const balanceAfterSecond = await ngnWalletService.getBalance(testUserId)

      // Assert: Balance should only be debited once
      expect(balanceAfterFirst.totalNgn).toBe(balanceBeforeFirst.totalNgn - 10000)
      expect(balanceAfterSecond.totalNgn).toBe(balanceAfterFirst.totalNgn)
    })

    it('should return 200 even if deposit not found (prevent webhook retries)', async () => {
      const response = await request(app)
        .post('/api/webhooks/reversals/onramp')
        .send({
          provider: 'onramp',
          providerRef: 'NONEXISTENT-REF',
          reversalRef: 'REVERSAL-WEBHOOK-3',
          eventType: 'deposit.reversed',
          timestamp: new Date().toISOString(),
        })
        .expect(200)

      expect(response.body.success).toBe(true)
    })

    it('should reject mismatched provider', async () => {
      await request(app)
        .post('/api/webhooks/reversals/onramp')
        .send({
          provider: 'offramp', // Mismatch
          providerRef: 'TEST-REF',
          reversalRef: 'REVERSAL-WEBHOOK-4',
          eventType: 'deposit.reversed',
          timestamp: new Date().toISOString(),
        })
        .expect(400)
    })

    it('should reject invalid event type', async () => {
      await request(app)
        .post('/api/webhooks/reversals/onramp')
        .send({
          provider: 'onramp',
          providerRef: 'TEST-REF',
          reversalRef: 'REVERSAL-WEBHOOK-5',
          eventType: 'deposit.confirmed', // Wrong event type
          timestamp: new Date().toISOString(),
        })
        .expect(400)
    })

    it('should verify webhook signature when enabled', async () => {
      process.env.WEBHOOK_SIGNATURE_ENABLED = 'true'
      process.env.WEBHOOK_SECRET = 'test-secret-key'

      // Without signature
      await request(app)
        .post('/api/webhooks/reversals/onramp')
        .send({
          provider: 'onramp',
          providerRef: 'TEST-REF',
          reversalRef: 'REVERSAL-WEBHOOK-6',
          eventType: 'deposit.reversed',
          timestamp: new Date().toISOString(),
        })
        .expect(401)

      // With correct signature
      await depositStore.confirm({
        depositId: 'deposit-sig-test',
        userId: testUserId,
        amountNgn: 5000,
        provider: 'onramp',
        providerRef: 'TEST-REF-SIG',
      })

      await request(app)
        .post('/api/webhooks/reversals/onramp')
        .set('x-webhook-signature', 'test-secret-key')
        .send({
          provider: 'onramp',
          providerRef: 'TEST-REF-SIG',
          reversalRef: 'REVERSAL-WEBHOOK-7',
          eventType: 'deposit.reversed',
          timestamp: new Date().toISOString(),
        })
        .expect(200)

      process.env.WEBHOOK_SIGNATURE_ENABLED = 'false'
    })
  })
})
