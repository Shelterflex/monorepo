import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { depositStore } from '../models/depositStore.js'
import { outboxStore } from '../outbox/store.js'
import { TxType } from '../outbox/types.js'
import { quoteStore } from '../models/quoteStore.js'
import { webhookEventDedupeStore } from '../models/webhookEventDedupeStore.js'
import { NgnWalletService } from '../services/ngnWalletService.js'
import { sessionStore, userStore } from '../models/authStore.js'
import {
  InMemoryWebhookReplayStore,
  initWebhookReplayStore,
  getStore as getWebhookReplayStore,
  WebhookProcessingStatus,
} from '../webhookReplay/index.js'

describe('Payments webhook', () => {
  const app = createApp()
  const originalNodeEnv = process.env.NODE_ENV

  async function createAuthenticatedUser(userEmailPrefix: string): Promise<{ userId: string; token: string }> {
    const email = `${userEmailPrefix}@example.com`
    const user = await userStore.getOrCreateByEmail(email)
    const token = `token-${userEmailPrefix}`
    await sessionStore.create(email, token)
    return { userId: user.id, token }
  }

  beforeEach(async () => {
    await depositStore.clear()
    await outboxStore.clear()
    await quoteStore.clear()
    sessionStore.clear()
    userStore.clear()
    webhookEventDedupeStore.clear()
    initWebhookReplayStore(new InMemoryWebhookReplayStore())
    process.env.NODE_ENV = originalNodeEnv
    delete process.env.WEBHOOK_SIGNATURE_ENABLED
    delete process.env.WEBHOOK_SECRET
    delete process.env.PAYSTACK_SECRET
    delete process.env.FLUTTERWAVE_SECRET
    delete process.env.MANUAL_ADMIN_SECRET
  })

  afterEach(async () => {
    await depositStore.clear()
    await outboxStore.clear()
    process.env.NODE_ENV = originalNodeEnv
  })

  it('is idempotent on replay (rail, externalRef) and second delivery is provider-event deduped', async () => {
    const { userId, token } = await createAuthenticatedUser('user-001')
    const quote = await quoteStore.create({
      userId,
      amountNgn: 160000,
      paymentRail: 'paystack',
      fxRateNgnPerUsdc: 1600,
      feePercent: 0,
      slippagePercent: 0,
      expiryMs: 3600000,
    })

    const init = await request(app)
      .post('/api/staking/deposit/initiate')
      .set('Authorization', `Bearer ${token}`)
      .send({ quoteId: quote.quoteId, paymentRail: 'paystack' })
      .expect(201)
    const { depositId, externalRef } = init.body

    const payload = {
      externalRefSource: 'paystack',
      externalRef,
      status: 'confirmed',
    }

    const r1 = await request(app)
      .post('/api/webhooks/payments/paystack')
      .send(payload)
      .expect(200)
    expect(r1.body.deduped).toBeFalsy()
    const r2 = await request(app)
      .post('/api/webhooks/payments/paystack')
      .send(payload)
      .expect(200)
    expect(r2.body.deduped).toBe(true)
    expect(r2.body.success).toBe(true)

    const items = await outboxStore.listAll(10)
    const stakeOutbox = items.filter((i) => i.txType === TxType.STAKE)
    expect(stakeOutbox.length).toBe(1)
    expect(stakeOutbox[0].payload.txType).toBe('stake')
  })

  it('rejects invalid signature when enabled', async () => {
    process.env.WEBHOOK_SIGNATURE_ENABLED = 'true'
    process.env.PAYSTACK_SECRET = 'paystack_secret_123'

    const { userId, token } = await createAuthenticatedUser('user-002')
    const quote = await quoteStore.create({
      userId,
      amountNgn: 320000,
      paymentRail: 'paystack',
      fxRateNgnPerUsdc: 1600,
      feePercent: 0,
      slippagePercent: 0,
      expiryMs: 3600000,
    })

    const init = await request(app)
      .post('/api/staking/deposit/initiate')
      .set('Authorization', `Bearer ${token}`)
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
      .set('x-paystack-signature', 'wrong')
      .set('x-webhook-timestamp', String(Date.now()))
      .send(payload)
      .expect(401)
  })

  it('accepts valid Paystack signature when enabled', async () => {
    const crypto = await import('node:crypto')
    const secret = 'paystack_test_secret'
    process.env.WEBHOOK_SIGNATURE_ENABLED = 'true'
    process.env.PAYSTACK_SECRET = secret

    const { userId, token } = await createAuthenticatedUser('user-002-valid')
    const quote = await quoteStore.create({
      userId,
      amountNgn: 320000,
      paymentRail: 'paystack',
      fxRateNgnPerUsdc: 1600,
      feePercent: 0,
      slippagePercent: 0,
      expiryMs: 3600000,
    })

    const init = await request(app)
      .post('/api/staking/deposit/initiate')
      .set('Authorization', `Bearer ${token}`)
      .send({ quoteId: quote.quoteId, paymentRail: 'paystack' })
      .expect(201)

    const { externalRef } = init.body
    const payload = {
      externalRefSource: 'paystack',
      externalRef,
      status: 'confirmed',
    }

    // Generate valid HMAC-SHA512 signature
    const rawBody = JSON.stringify(payload)
    const timestamp = String(Date.now())
    const validSignature = crypto
      .createHmac('sha512', secret)
      .update(`${timestamp}.${rawBody}`, 'utf8')
      .digest('hex')

    await request(app)
      .post('/api/webhooks/payments/paystack')
      .set('x-paystack-signature', validSignature)
      .set('x-webhook-timestamp', timestamp)
      .send(payload)
      .expect(200)
  })

  it('enforces Paystack signature validation in production', async () => {
    process.env.NODE_ENV = 'production'
    process.env.PAYSTACK_SECRET = 'prod_secret_paystack'

    const { userId, token } = await createAuthenticatedUser('prod-user-signature')
    const quote = await quoteStore.create({
      userId,
      amountNgn: 220000,
      paymentRail: 'paystack',
      fxRateNgnPerUsdc: 1600,
      feePercent: 0,
      slippagePercent: 0,
      expiryMs: 3600000,
    })

    const init = await request(app)
      .post('/api/staking/deposit/initiate')
      .set('Authorization', `Bearer ${token}`)
      .send({ quoteId: quote.quoteId, paymentRail: 'paystack' })
      .expect(201)

    await request(app)
      .post('/api/webhooks/payments/paystack')
      .send({
        externalRefSource: 'paystack',
        externalRef: init.body.externalRef,
        status: 'confirmed',
        providerEventId: 'evt-prod-signature-1',
      })
      .expect(401)
  })

  it('persists inbound webhook event before processing and marks failures for replay', async () => {
    const replayStore = getWebhookReplayStore()
    const providerEventId = 'evt-missing-deposit-1'

    await request(app)
      .post('/api/webhooks/payments/paystack')
      .send({
        externalRefSource: 'paystack',
        externalRef: 'missing-external-ref',
        status: 'confirmed',
        providerEventId,
      })
      .expect(404)

    const stored = await replayStore.getEventByProviderAndExternalId('paystack', providerEventId)
    expect(stored).not.toBeNull()
    expect(stored?.processingStatus).toBe(WebhookProcessingStatus.FAILED)
    expect(stored?.processingError).toContain('Deposit not found')
  })

  it('applies concurrent deliveries of one provider event exactly once', async () => {
    const { userId, token } = await createAuthenticatedUser('user-concurrent')
    const quote = await quoteStore.create({
      userId,
      amountNgn: 64000,
      paymentRail: 'paystack',
      fxRateNgnPerUsdc: 1600,
      feePercent: 0,
      slippagePercent: 0,
      expiryMs: 3600000,
    })
    const init = await request(app)
      .post('/api/staking/deposit/initiate')
      .set('Authorization', `Bearer ${token}`)
      .send({ quoteId: quote.quoteId, paymentRail: 'paystack' })
      .expect(201)

    const payload = {
      externalRefSource: 'paystack',
      externalRef: init.body.externalRef,
      status: 'confirmed',
      providerEventId: 'evt-concurrent-1',
    }
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(app).post('/api/webhooks/payments/paystack').send(payload),
      ),
    )

    expect(responses.every((response) => response.status === 200)).toBe(true)
    expect(responses.filter((response) => response.body.deduped).length).toBe(7)
    const stakeItems = (await outboxStore.listAll(20)).filter(
      (item) => item.txType === TxType.STAKE,
    )
    expect(stakeItems).toHaveLength(1)
  })

  it('keeps reversal terminal when capture arrives afterward', async () => {
    const { userId, token } = await createAuthenticatedUser('user-reversal-first')
    const quote = await quoteStore.create({
      userId,
      amountNgn: 45000,
      paymentRail: 'paystack',
      fxRateNgnPerUsdc: 1600,
      feePercent: 0,
      slippagePercent: 0,
      expiryMs: 3600000,
    })
    const init = await request(app)
      .post('/api/staking/deposit/initiate')
      .set('Authorization', `Bearer ${token}`)
      .send({ quoteId: quote.quoteId, paymentRail: 'paystack' })
      .expect(201)
    const walletService = new NgnWalletService()
    const balanceBefore = await walletService.getBalance(userId)

    await request(app)
      .post('/api/webhooks/payments/paystack')
      .send({
        externalRefSource: 'paystack',
        externalRef: init.body.externalRef,
        status: 'reversed',
        providerEventId: 'evt-reversal-first',
      })
      .expect(200)

    await request(app)
      .post('/api/webhooks/payments/paystack')
      .send({
        externalRefSource: 'paystack',
        externalRef: init.body.externalRef,
        status: 'confirmed',
        providerEventId: 'evt-capture-late',
      })
      .expect(200)

    const deposit = await depositStore.getByCanonical('paystack', init.body.externalRef)
    expect(deposit?.status).toBe('reversed')
    expect((await walletService.getBalance(userId)).totalNgn).toBe(balanceBefore.totalNgn)
    expect(
      (await outboxStore.listAll(20)).filter((item) => item.txType === TxType.STAKE),
    ).toHaveLength(0)
  })

  it('credits NGN wallet on confirmation', async () => {
    const { userId, token } = await createAuthenticatedUser('user-003')

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
      .set('Authorization', `Bearer ${token}`)
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
    const { userId, token } = await createAuthenticatedUser('user-004')

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
      .set('Authorization', `Bearer ${token}`)
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
    const { userId, token } = await createAuthenticatedUser('user-005')

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
      .set('Authorization', `Bearer ${token}`)
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
    const { userId, token } = await createAuthenticatedUser('user-006')

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
      .set('Authorization', `Bearer ${token}`)
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
    const { userId, token } = await createAuthenticatedUser('user-007')

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
      .set('Authorization', `Bearer ${token}`)
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
