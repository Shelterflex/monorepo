import { describe, it, expect, beforeEach } from 'vitest'
import { NgnWalletService } from '../services/ngnWalletService.js'
import { LedgerEntryType } from '../models/ngnWallet.js'
import { createNgnWalletRouter } from '../routes/ngnWallet.js'
import { sessionStore, userStore } from '../models/authStore.js'
import request from 'supertest'
import express from 'express'

describe('NGN Wallet Routes', () => {
  let ngnWalletService: NgnWalletService
  let app: express.Application
  let token: string
  let userId: string

  beforeEach(() => {
    ngnWalletService = new NgnWalletService()

    const user = userStore.getOrCreateByEmail('ngn-test@example.com')
    userId = user.id
    token = 'ngn-test-session-token'
    sessionStore.create(user.email, token)

    app = express()
    app.use(express.json())
    app.use('/api/wallet/ngn', createNgnWalletRouter(ngnWalletService))
  })

  describe('GET /api/wallet/ngn/balance', () => {
    it('returns zero balance for a new wallet', async () => {
      const response = await request(app)
        .get('/api/wallet/ngn/balance')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.availableBalanceNgn).toBe(0)
      expect(response.body.heldBalanceNgn).toBe(0)
      expect(response.body.totalBalanceNgn).toBe(0)
    })

    it('reflects ledger entries in the balance', async () => {
      await ngnWalletService.addEntry(userId, LedgerEntryType.TOPUP_CONFIRMED, 50000)
      await ngnWalletService.addEntry(userId, LedgerEntryType.STAKE_RESERVE, 5000)

      const response = await request(app)
        .get('/api/wallet/ngn/balance')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)

      expect(response.body.availableBalanceNgn).toBe(45000)
      expect(response.body.heldBalanceNgn).toBe(5000)
      expect(response.body.totalBalanceNgn).toBe(50000)
    })
  })

  describe('POST /api/wallet/ngn/withdraw/initiate', () => {
    beforeEach(async () => {
      await ngnWalletService.addEntry(userId, LedgerEntryType.TOPUP_CONFIRMED, 50000)
    })

    it('initiates withdrawal and reduces available balance', async () => {
      const response = await request(app)
        .post('/api/wallet/ngn/withdraw/initiate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          amountNgn: 1000,
          bankAccount: {
            accountNumber: '1234567890',
            accountName: 'Test User',
            bankName: 'Test Bank',
          },
        })
        .expect(201)

      expect(response.body.success).toBe(true)
      expect(response.body.amountNgn).toBe(1000)
      expect(response.body.status).toBe('pending')
      expect(response.body.bankAccount.accountNumber).toBe('1234567890')
      expect(response.body.reference).toBeDefined()
      expect(response.body.createdAt).toBeDefined()
    })

    it('rejects withdrawal when amount exceeds available balance', async () => {
      const response = await request(app)
        .post('/api/wallet/ngn/withdraw/initiate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          amountNgn: 100000,
          bankAccount: {
            accountNumber: '1234567890',
            accountName: 'Test User',
            bankName: 'Test Bank',
          },
        })
        .expect(400)

      expect(response.body.error.code).toBe('VALIDATION_ERROR')
      expect(response.body.error.message).toContain('Insufficient balance')
    })
  })

  describe('GET /api/wallet/ngn/withdraw/history', () => {
    it('returns empty history for a new wallet', async () => {
      const response = await request(app)
        .get('/api/wallet/ngn/withdraw/history')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(Array.isArray(response.body.entries)).toBe(true)
      expect(response.body.entries.length).toBe(0)
    })

    it('returns initiated withdrawals in history', async () => {
      await ngnWalletService.addEntry(userId, LedgerEntryType.TOPUP_CONFIRMED, 50000)
      await ngnWalletService.initiateWithdrawal(userId, {
        amountNgn: 5000,
        bankAccount: { accountNumber: '1234567890', accountName: 'Test User', bankName: 'Test Bank' },
      })

      const response = await request(app)
        .get('/api/wallet/ngn/withdraw/history')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)

      expect(response.body.entries.length).toBeGreaterThan(0)
      expect(response.body.entries[0].amountNgn).toBe(5000)
      expect(response.body.entries[0].status).toBe('pending')
    })
  })
})
