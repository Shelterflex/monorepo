import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NgnWalletService } from '../services/ngnWalletService.js'
import { createNgnWalletRouter } from '../routes/ngnWallet.js'
import request from 'supertest'
import express from 'express'
import { sessionStore, userStore } from '../models/authStore.js'
import { ngnDepositStore } from '../models/ngnDepositStore.js'

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

    return ngnDepositStore.clear()
  })

  describe('GET /api/wallet/ngn/balance', () => {
    it('should return user balance', async () => {
      const response = await request(app)
        .get('/api/wallet/ngn/balance')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)

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
        .send(withdrawalRequest)
        .expect(400)

      expect(response.body.error.code).toBe('VALIDATION_ERROR')
      expect(response.body.error.message).toContain('Insufficient balance')
    })
  })

  describe('GET /api/wallet/ngn/withdraw/history', () => {
    it('should return withdrawal history', async () => {
      const response = await request(app)
        .get('/api/wallet/ngn/withdraw/history')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)

      console.log('Response body:', JSON.stringify(response.body, null, 2))

      expect(response.body.success).toBe(true)
      expect(Array.isArray(response.body.entries)).toBe(true)
      expect(response.body.entries.length).toBeGreaterThan(0)
    })
  })

  describe('GET /api/wallet/ngn/withdrawals', () => {
    it('should return withdrawals', async () => {
      const response = await request(app)
        .get('/api/wallet/ngn/withdrawals')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(Array.isArray(response.body.entries)).toBe(true)
    })
  })

  describe('POST /api/wallet/ngn/topup/initiate', () => {
    it('should initiate topup successfully', async () => {
      const response = await request(app)
        .post('/api/wallet/ngn/topup/initiate')
        .set('Authorization', `Bearer ${token}`)
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
        .expect(200)

      expect(second.body.depositId).toBe(first.body.depositId)
      expect(second.body.externalRef).toBe(first.body.externalRef)
      expect(second.body.externalRefSource).toBe(first.body.externalRefSource)
    })
  })
})
