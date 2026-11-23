import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NgnWalletService } from '../services/ngnWalletService.js'
import { createNgnWalletRouter } from '../routes/ngnWallet.js'
import request from 'supertest'
import express from 'express'
import { sessionStore, userStore } from '../models/authStore.js'
import { ngnDepositStore } from '../models/ngnDepositStore.js'
import { ngnWalletStore } from '../models/ngnWalletStore.js'
import { ngnWithdrawalStore } from '../models/ngnWithdrawalStore.js'
import { seedNgnWalletFixture } from '../test-fixtures/ngnWalletFixtures.js'

describe('NGN Wallet Routes', () => {
  let ngnWalletService: NgnWalletService
  let app: express.Application
  let token: string
  let userId: string

  beforeEach(async () => {
    ngnWalletService = new NgnWalletService()

    // Seed an authenticated user session for tests
    const user = await userStore.getOrCreateByEmail('test-user@example.com')
    userId = user.id
    token = 'test-session-token'
    await sessionStore.create(user.email, token)

    app = express()
    app.use(express.json())

    // Mock authentication middleware - this needs to be set up before the routes
    const mockAuth = (req: any, res: any, next: any) => {
      req.user = { id: userId }
      next()
    }

    // Apply auth middleware before routes
    app.use('/api/wallet/ngn', mockAuth)
    app.use('/api/wallet/ngn', createNgnWalletRouter(ngnWalletService))

    await ngnWalletStore.clear()
    await ngnWithdrawalStore.clear()
    await seedNgnWalletFixture(userId)
    return ngnDepositStore.clear()
  })

  describe('GET /api/wallet/ngn/balance', () => {
    it('should return user balance', async () => {
      const response = await request(app)
        .get('/api/wallet/ngn/balance')
        .set('Authorization', `Bearer ${token}`)

      if (response.status !== 200) {
        console.log('Balance status:', response.status)
        console.log('Balance body:', JSON.stringify(response.body, null, 2))
      }
      expect(response.status).toBe(200)

      expect(response.body.success).toBe(true)
      expect(response.body.availableNgn).toBe(50000)
      expect(response.body.heldNgn).toBe(5000)
      expect(response.body.totalNgn).toBe(55000)
    })
  })

  describe('POST /api/wallet/ngn/withdraw/initiate', () => {
    it('should initiate withdrawal successfully', async () => {
      const withdrawalRequest = {
        amountNgn: 1000,
        bankAccount: {
          accountNumber: '1234567890',
          accountName: 'Test User',
          bankName: 'Test Bank'
        }
      }

      const response = await request(app)
        .post('/api/wallet/ngn/withdraw/initiate')
        .set('Authorization', `Bearer ${token}`)
        .set('x-idempotency-key', 'wd-key-initiate-1')
        .send(withdrawalRequest)
        .expect(201)

      expect(response.body.success).toBe(true)
      expect(response.body.amountNgn).toBe(1000)
      expect(response.body.status).toBe('pending')
      expect(response.body.bankAccount.accountNumber).toBe('1234567890')
      expect(response.body.bankAccount.accountName).toBe('Test User')
      expect(response.body.bankAccount.bankName).toBe('Test Bank')
      expect(response.body.reference).toBeDefined()
      expect(response.body.createdAt).toBeDefined()
    })

    it('should reject withdrawal with insufficient balance', async () => {
      const balanceBefore = await ngnWalletService.getBalance(userId)
      const ledgerBefore = await ngnWalletService.getLedger(userId)

      const withdrawalRequest = {
        amountNgn: 100000, // More than available balance
        bankAccount: {
          accountNumber: '1234567890',
          accountName: 'Test User',
          bankName: 'Test Bank'
        }
      }

      const response = await request(app)
        .post('/api/wallet/ngn/withdraw/initiate')
        .set('Authorization', `Bearer ${token}`)
        .set('x-idempotency-key', 'wd-key-insufficient-1')
        .send(withdrawalRequest)
        .expect(400)

      expect(response.body.error.code).toBe('VALIDATION_ERROR')
      expect(response.body.error.message).toContain('Insufficient balance')

      // Assert balance and ledger are unchanged after rejected withdrawal
      const balanceAfter = await ngnWalletService.getBalance(userId)
      expect(balanceAfter).toEqual(balanceBefore)
      const ledgerAfter = await ngnWalletService.getLedger(userId)
      expect(ledgerAfter.entries.length).toBe(ledgerBefore.entries.length)
      expect(ledgerAfter.entries.some((e) => e.referenceType === 'withdrawal')).toBe(false)
    })
  })

  describe('GET /api/wallet/ngn/withdraw/history', () => {
    it('should return withdrawal history', async () => {
      // Seed two withdrawals for the current user
      await ngnWalletService.initiateWithdrawal(userId, {
        amountNgn: 1000,
        bankAccount: {
          accountNumber: '1234567890',
          accountName: 'Test User',
          bankName: 'Test Bank',
        },
      })
      await ngnWalletService.initiateWithdrawal(userId, {
        amountNgn: 2000,
        bankAccount: {
          accountNumber: '1234567890',
          accountName: 'Test User',
          bankName: 'Test Bank',
        },
      })

      // Seed a withdrawal for a different user to verify history is scoped to caller
      const otherUser = await userStore.getOrCreateByEmail('other-user@example.com')
      await seedNgnWalletFixture(otherUser.id)
      await ngnWalletService.initiateWithdrawal(otherUser.id, {
        amountNgn: 500,
        bankAccount: {
          accountNumber: '9876543210',
          accountName: 'Other User',
          bankName: 'Other Bank',
        },
      })

      // Fetch all history for caller
      const response = await request(app)
        .get('/api/wallet/ngn/withdraw/history')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(Array.isArray(response.body.entries)).toBe(true)
      expect(response.body.entries.length).toBe(2)
      expect(response.body.entries.every((e: any) => e.amountNgn === 1000 || e.amountNgn === 2000)).toBe(true)

      // Test pagination (limit=1)
      const page1 = await request(app)
        .get('/api/wallet/ngn/withdraw/history?limit=1')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)

      expect(page1.body.entries.length).toBe(1)
      expect(page1.body.nextCursor).toBeDefined()
      expect(page1.body.nextCursor).not.toBeNull()

      // Fetch page 2 using cursor
      const page2 = await request(app)
        .get(`/api/wallet/ngn/withdraw/history?limit=1&cursor=${encodeURIComponent(page1.body.nextCursor)}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)

      expect(page2.body.entries.length).toBe(1)
      expect(page2.body.entries[0].id).not.toBe(page1.body.entries[0].id)
    })
  })

  describe('GET /api/wallet/ngn/withdrawals', () => {
    it('should return withdrawals', async () => {
      await ngnWalletService.initiateWithdrawal(userId, {
        amountNgn: 1000,
        bankAccount: {
          accountNumber: '1234567890',
          accountName: 'Test User',
          bankName: 'Test Bank',
        },
      })

      const response = await request(app)
        .get('/api/wallet/ngn/withdrawals')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(Array.isArray(response.body.entries)).toBe(true)
      expect(response.body.entries.length).toBeGreaterThan(0)
    })
  })

  describe('POST /api/wallet/ngn/topup/initiate', () => {
    it('should initiate topup successfully', async () => {
      const response = await request(app)
        .post('/api/wallet/ngn/topup/initiate')
        .set('Authorization', `Bearer ${token}`)
        .set('x-idempotency-key', '9a1b2c3d-4e5f-6789-abcd-ef0123456789')
        .send({ amountNgn: 1500, rail: 'paystack' })
        .expect(201)

      expect(response.body.success).toBe(true)
      expect(response.body.depositId).toBeDefined()
      expect(response.body.externalRefSource).toBeDefined()
      expect(response.body.externalRef).toBeDefined()
      expect(response.body.redirectUrl).toBeDefined()
    })

    it('should be idempotent with Idempotency-Key', async () => {
      const key = '3d6f0b7e-9d8c-4a6a-9c2c-2c4f3fb4e7b1'

      const first = await request(app)
        .post('/api/wallet/ngn/topup/initiate')
        .set('Authorization', `Bearer ${token}`)
        .set('x-idempotency-key', key)
        .send({ amountNgn: 1500, rail: 'paystack' })
        .expect(201)

      const second = await request(app)
        .post('/api/wallet/ngn/topup/initiate')
        .set('Authorization', `Bearer ${token}`)
        .set('x-idempotency-key', key)
        .send({ amountNgn: 1500, rail: 'paystack' })
        .expect(201)
      expect(second.headers['x-idempotent-replay']).toBe('true')

      expect(second.body.depositId).toBe(first.body.depositId)
      expect(second.body.externalRef).toBe(first.body.externalRef)
      expect(second.body.externalRefSource).toBe(first.body.externalRefSource)
    })
  })
})
