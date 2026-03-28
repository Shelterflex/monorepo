import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { outboxStore } from '../outbox/index.js'
import { conversionStore } from '../models/conversionStore.js'
import { depositStore } from '../models/depositStore.js'
import { OutboxStatus } from '../outbox/types.js'

describe('POST /api/staking/finalize', () => {
  let app: any

  beforeEach(async () => {
    app = createApp()
    await outboxStore.clear()
    await conversionStore.clear()
    await depositStore.clear()
    vi.clearAllMocks()
  })

  it('returns 409 if conversion is not completed', async () => {
    const pending = await conversionStore.createPending({
      depositId: 'onramp:dep_pending',
      userId: 'user_1',
      amountNgn: 1000,
      provider: 'onramp',
    })

    const res = await request(app)
      .post('/api/staking/finalize')
      .send({ conversionId: pending.conversionId })
      .expect(409)

    expect(res.body.error.code).toBe('CONFLICT')
  })

  it('finalizes staking from a completed conversion (idempotent by conversionId)', async () => {
    const confirmRes = await request(app)
      .post('/api/deposits/confirm')
      .set('x-idempotency-key', 'test-finalize-010')
      .send({
        depositId: 'onramp:dep_010',
        userId: 'user_1',
        amountNgn: 160000,
        provider: 'onramp',
        providerRef: 'provider-ref-010',
      })
      .expect(200)

    const conversionId = confirmRes.body.conversion.conversionId

    const finalize1 = await request(app)
      .post('/api/staking/finalize')
      .send({ conversionId })
      .expect((r) => {
        expect([200, 202]).toContain(r.status)
      })

    const finalize2 = await request(app)
      .post('/api/staking/finalize')
      .send({ conversionId })
      .expect((r) => {
        expect([200, 202]).toContain(r.status)
      })

    expect(finalize1.body.outboxId).toBe(finalize2.body.outboxId)
    expect(finalize1.body.txId).toBe(finalize2.body.txId)
    expect([OutboxStatus.SENT, OutboxStatus.PENDING, OutboxStatus.FAILED]).toContain(finalize1.body.status)
  })
})
