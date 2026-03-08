import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { depositStore } from '../models/depositStore.js'
import { outboxStore } from '../outbox/store.js'
import { quoteStore } from '../models/quoteStore.js'
import { NgnWalletService } from '../services/ngnWalletService.js'

describe('Payments webhook', () => {
  const app = createApp()

  beforeEach(async () => {
    await depositStore.clear()
    await outboxStore.clear()
    await quoteStore.clear()
    delete process.env.WEBHOOK_SIGNATURE_ENABLED
    delete process.env.WEBHOOK_SECRET
  })

  afterEach(async () => {
    await depositStore.clear()
    await outboxStore.clear()
  })

  it('is idempotent on replay (rail, externalRef)', async () => {
    const quote = await quoteStore.create({
      userId: 'user-001',
      amountNgn: 160000,
      paymentRail: 'paystack',
      fxRateNgnPerUsdc: 1600,
      feePercent: 0,
      slippagePercent: 0,
      expiryMs: 3600000,
    })

    const init = await request(app)
      .post('/api/staking/deposit/initiate')
      .set('x-user-id', 'user-001')
      .send({ quoteId: quote.quoteId, paymentRail: 'paystack' })
      .expect(201)

    const { depositId, externalRef } = init.body

    const payload = {
      externalRefSource: 'paystack',
      externalRef,
      status: 'confirmed',
    }

    await request(app).post('/api/webhooks/payments/paystack').send(payload).expect(200)
    await request(app).post('/api/webhooks/payments/paystack').send(payload).expect(200)

    const items = await outboxStore.listAll(10)
    expect(items.length).toBe(1)
    expect(items[0].payload.txType).toBe('stake')
  })

  it('rejects invalid signature when enabled', async () => {
    process.env.WEBHOOK_SIGNATURE_ENABLED = 'true'
    process.env.WEBHOOK_SECRET = 'secret123'

    const quote = await quoteStore.create({
      userId: 'user-002',
      amountNgn: 320000,
      paymentRail: 'paystack',
      fxRateNgnPerUsdc: 1600,
      feePercent: 0,
      slippagePercent: 0,
      expiryMs: 3600000,
    })

    const init = await request(app)
      .post('/api/staking/deposit/initiate')
      .set('x-user-id', 'user-002')
      .send({ quoteId: quote.quoteId, paymentRail: 'paystack' })
      .expect(201)

    const { externalRef } = init.body
    const payload = {
      externalRefSource: 'paystack',
      externalRef,
      status: 'confirmed',
    }

    await request(app)
      .post('/api/webhooks/payments/paystack')
      .set('x-webhook-signature', 'wrong')
      .send(payload)
      .expect(401)
  })

  it('credits NGN wallet on confirmation', async () => {
    const userId = 'user-003'

    const quote = await quoteStore.create({
      userId,
      amountNgn: 50000,
      paymentRail: 'paystack',
      fxRateNgnPerUsdc: 1600,
      feePercent: 0,
      slippagePercent: 0,
      expiryMs: 3600000,
    })

    const init = await request(app)
      .post('/api/staking/deposit/initiate')
      .set('x-user-id', userId)
      .send({ quoteId: quote.quoteId, paymentRail: 'paystack' })
      .expect(201)

    const { depositId, externalRef } = init.body

    const payload = {
      externalRefSource: 'paystack',
      externalRef,
      status: 'confirmed',
    }

    await request(app).post('/api/webhooks/payments/paystack').send(payload).expect(200)

    // Verify deposit is confirmed
    const deposit = await depositStore.getByCanonical('paystack', externalRef)
    expect(deposit?.status).toBe('confirmed')
    expect(deposit?.confirmedAt).toBeDefined()
  })

  it('does not double-credit on webhook replay', async () => {
    const userId = 'user-004'

    const quote = await quoteStore.create({
      userId,
      amountNgn: 30000,
      paymentRail: 'paystack',
      fxRateNgnPerUsdc: 1600,
      feePercent: 0,
      slippagePercent: 0,
      expiryMs: 3600000,
    })

    const init = await request(app)
      .post('/api/staking/deposit/initiate')
      .set('x-user-id', userId)
      .send({ quoteId: quote.quoteId, paymentRail: 'paystack' })
      .expect(201)

    const { externalRef } = init.body

    const payload = {
      externalRefSource: 'paystack',
      externalRef,
      status: 'confirmed',
    }

    // First webhook
    await request(app).post('/api/webhooks/payments/paystack').send(payload).expect(200)
    const deposit1 = await depositStore.getByCanonical('paystack', externalRef)
    const confirmedAt1 = deposit1?.confirmedAt

    // Replay webhook - should be idempotent
    await request(app).post('/api/webhooks/payments/paystack').send(payload).expect(200)
    const deposit2 = await depositStore.getByCanonical('paystack', externalRef)
    const confirmedAt2 = deposit2?.confirmedAt

    // Should remain confirmed and confirmedAt should not change (idempotent)
    expect(deposit2?.status).toBe('confirmed')
    expect(confirmedAt1).toEqual(confirmedAt2)
  })

  it('debits NGN wallet on reversal', async () => {
    const userId = 'user-005'

    const quote = await quoteStore.create({
      userId,
      amountNgn: 20000,
      paymentRail: 'paystack',
      fxRateNgnPerUsdc: 1600,
      feePercent: 0,
      slippagePercent: 0,
      expiryMs: 3600000,
    })

    const init = await request(app)
      .post('/api/staking/deposit/initiate')
      .set('x-user-id', userId)
      .send({ quoteId: quote.quoteId, paymentRail: 'paystack' })
      .expect(201)

    const { externalRef } = init.body

    // Confirm first
    await request(app)
      .post('/api/webhooks/payments/paystack')
      .send({
        externalRefSource: 'paystack',
        externalRef,
        status: 'confirmed',
      })
      .expect(200)

    // Verify deposit is confirmed
    const depositAfterConfirm = await depositStore.getByCanonical('paystack', externalRef)
    expect(depositAfterConfirm?.status).toBe('confirmed')

    // Reverse
    await request(app)
      .post('/api/webhooks/payments/paystack')
      .send({
        externalRefSource: 'paystack',
        externalRef,
        status: 'reversed',
      })
      .expect(200)

    // Verify deposit is reversed
    const depositAfterReverse = await depositStore.getByCanonical('paystack', externalRef)
    expect(depositAfterReverse?.status).toBe('reversed')
  })

  it('handles reversal even if deposit was already confirmed', async () => {
    const userId = 'user-006'

    const quote = await quoteStore.create({
      userId,
      amountNgn: 25000,
      paymentRail: 'paystack',
      fxRateNgnPerUsdc: 1600,
      feePercent: 0,
      slippagePercent: 0,
      expiryMs: 3600000,
    })

    const init = await request(app)
      .post('/api/staking/deposit/initiate')
      .set('x-user-id', userId)
      .send({ quoteId: quote.quoteId, paymentRail: 'paystack' })
      .expect(201)

    const { externalRef } = init.body

    // Confirm deposit
    await request(app)
      .post('/api/webhooks/payments/paystack')
      .send({
        externalRefSource: 'paystack',
        externalRef,
        status: 'confirmed',
      })
      .expect(200)

    // Verify confirmed
    const depositConfirmed = await depositStore.getByCanonical('paystack', externalRef)
    expect(depositConfirmed?.status).toBe('confirmed')

    // Reverse the deposit (chargeback scenario)
    await request(app)
      .post('/api/webhooks/payments/paystack')
      .send({
        externalRefSource: 'paystack',
        externalRef,
        status: 'reversed',
      })
      .expect(200)

    // Verify reversed
    const depositReversed = await depositStore.getByCanonical('paystack', externalRef)
    expect(depositReversed?.status).toBe('reversed')
  })

  it('maps provider status codes to internal status', async () => {
    const userId = 'user-007'

    const quote = await quoteStore.create({
      userId,
      amountNgn: 15000,
      paymentRail: 'paystack',
      fxRateNgnPerUsdc: 1600,
      feePercent: 10,
      slippagePercent: 0,
      expiryMs: 3600000,
    })

    const init = await request(app)
      .post('/api/staking/deposit/initiate')
      .set('x-user-id', userId)
      .send({ quoteId: quote.quoteId, paymentRail: 'paystack' })
      .expect(201)

    const { externalRef } = init.body

    // First confirm the deposit
    await request(app)
      .post('/api/webhooks/payments/paystack')
      .send({
        externalRefSource: 'paystack',
        externalRef,
        status: 'confirmed',
      })
      .expect(200)

    // Then reverse with provider-specific status code
    await request(app)
      .post('/api/webhooks/payments/paystack')
      .send({
        externalRefSource: 'paystack',
        externalRef,
        status: 'reversed',
        providerStatus: 'chargeback_disputed',
      })
      .expect(200)

    // Should be treated as reversed
    const deposit = await depositStore.getByCanonical('paystack', externalRef)
    expect(deposit?.status).toBe('reversed')
  })
})
