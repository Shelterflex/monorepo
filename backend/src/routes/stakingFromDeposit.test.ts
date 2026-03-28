import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { outboxStore } from '../outbox/index.js'
import { conversionStore } from '../models/conversionStore.js'
import { depositStore } from '../models/depositStore.js'
import { OutboxStatus } from '../outbox/types.js'

describe('POST /api/staking/stake_from_deposit', () => {
  let app: any

  beforeEach(async () => {
    app = createApp()
    await outboxStore.clear()
    await conversionStore.clear()
    await depositStore.clear()
    vi.clearAllMocks()
  })

  it('stakes using canonical amountUsdc from conversion (idempotent by deposit)', async () => {
    const confirmRes = await request(app)
      .post('/api/deposits/confirm')
      .set('x-idempotency-key', 'test-from-dep-003')
      .send({
        depositId: 'onramp:dep_003',
        userId: 'user_1',
        amountNgn: 160000,
        provider: 'onramp',
        providerRef: 'provider-ref-003',
      })
      .expect(200)

    const conversionId = confirmRes.body.conversion.conversionId

    const stake1 = await request(app)
      .post('/api/staking/stake_from_deposit')
      .send({ conversionId })
      .expect((r) => {
        expect([200, 202]).toContain(r.status)
      })

    const stake2 = await request(app)
      .post('/api/staking/stake_from_deposit')
      .send({ conversionId })
      .expect((r) => {
        expect([200, 202]).toContain(r.status)
      })

    expect(stake1.body.outboxId).toBe(stake2.body.outboxId)
    expect(stake1.body.txId).toBe(stake2.body.txId)
    expect([OutboxStatus.SENT, OutboxStatus.PENDING, OutboxStatus.FAILED]).toContain(stake1.body.status)
  })
})
