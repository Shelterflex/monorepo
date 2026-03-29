import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { conversionStore } from '../models/conversionStore.js'
import { depositStore } from '../models/depositStore.js'

describe('POST /api/deposits/confirm', () => {
  const app = createApp()

  beforeEach(async () => {
    await conversionStore.clear()
    await depositStore.clear()
  })

  it('confirms a deposit and returns a completed conversion', async () => {
    const res = await request(app)
      .post('/api/deposits/confirm')
      .set('x-idempotency-key', 'test-dep-001')
      .send({
        depositId: 'onramp:dep_001',
        userId: 'user_1',
        amountNgn: 160000,
        provider: 'onramp',
        providerRef: 'provider-ref-001',
      })
      .expect(200)

    expect(res.body.success).toBe(true)
    expect(res.body.deposit.depositId).toBe('onramp:dep_001')
    expect(res.body.conversion.depositId).toBe('onramp:dep_001')
    expect(res.body.conversion.amountUsdc).toMatch(/^\d+\.\d{6}$/)
    expect(res.body.conversion.fxRateNgnPerUsdc).toBeGreaterThan(0)
    expect(res.body.conversion.providerRef).toMatch(/^stub:/)
    expect(res.body.conversion.status).toBe('completed')
  })

  it('is idempotent by depositId (returns same conversion on retry)', async () => {
    const payload = {
      depositId: 'onramp:dep_002',
      userId: 'user_1',
      amountNgn: 80000,
      provider: 'onramp',
      providerRef: 'provider-ref-002',
    }

    const res1 = await request(app).post('/api/deposits/confirm').set('x-idempotency-key', 'test-dep-002-a').send(payload).expect(200)
    const res2 = await request(app).post('/api/deposits/confirm').set('x-idempotency-key', 'test-dep-002-b').send(payload).expect(200)

    expect(res1.body.conversion.conversionId).toBe(res2.body.conversion.conversionId)
    expect(res1.body.conversion.amountUsdc).toBe(res2.body.conversion.amountUsdc)
  })
})
