import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express, { type Express } from 'express'
import { createAdminWithdrawalsRouter } from './adminWithdrawals.js'
import { NgnWalletService } from '../services/ngnWalletService.js'
import { sessionStore, userStore } from '../models/authStore.js'
import { errorHandler } from '../middleware/errorHandler.js'

describe('Admin Withdrawals Routes', () => {
  let app: Express
  let ngnWalletService: NgnWalletService
  let authToken: string
  let userId: string

  beforeEach(async () => {
    ngnWalletService = new NgnWalletService()

    userStore.clear()
    sessionStore.clear()

    const adminUser = userStore.getOrCreateByEmail('admin@test.com')
    userId = adminUser.id

    const testToken = `test-token-${Date.now()}`
    const session = sessionStore.create('admin@test.com', testToken)
    authToken = session.token

    app = express()
    app.use(express.json())
    app.use('/api/admin', createAdminWithdrawalsRouter(ngnWalletService))
    app.use(errorHandler)
  })

  it('should approve a pending withdrawal idempotently', async () => {
    const user = userStore.getOrCreateByEmail('user1@test.com')

    const initiated = await ngnWalletService.initiateWithdrawal(user.id, {
      amountNgn: 1000,
      bankAccount: {
        accountNumber: '1234567890',
        accountName: 'Test User',
        bankName: 'Test Bank',
      },
    })

    const first = await request(app)
      .post(`/api/admin/withdrawals/${initiated.id}/approve`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)

    expect(first.body.success).toBe(true)
    expect(first.body.status).toBe('confirmed')

    const second = await request(app)
      .post(`/api/admin/withdrawals/${initiated.id}/approve`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)

    expect(second.body.status).toBe('confirmed')
  })

  it('should reject a pending withdrawal idempotently', async () => {
    const user = userStore.getOrCreateByEmail('user2@test.com')

    const initiated = await ngnWalletService.initiateWithdrawal(user.id, {
      amountNgn: 1000,
      bankAccount: {
        accountNumber: '1234567890',
        accountName: 'Test User',
        bankName: 'Test Bank',
      },
    })

    const first = await request(app)
      .post(`/api/admin/withdrawals/${initiated.id}/reject`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ reason: 'Risk' })
      .expect(200)

    expect(first.body.success).toBe(true)
    expect(first.body.status).toBe('rejected')

    const second = await request(app)
      .post(`/api/admin/withdrawals/${initiated.id}/reject`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ reason: 'Risk' })
      .expect(200)

    expect(second.body.status).toBe('rejected')
  })
})
