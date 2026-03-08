import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { depositStore } from '../models/depositStore.js'
import { walletStore } from '../models/walletStore.js'
import { conversionStore } from '../models/conversionStore.js'
import { outboxStore } from '../outbox/store.js'
import { TxType, OutboxStatus } from '../outbox/types.js'

describe('Admin Reconciliation API', () => {
  let app: any

  beforeEach(async () => {
    app = createApp()
    await depositStore.clear()
    await walletStore.clear()
    await conversionStore.clear()
    await outboxStore.clear()
  })

  it('lists unmatched deposits with pagination', async () => {
    for (let i = 0; i < 5; i++) {
      await depositStore.add({
        accountId: `acc-${i}`,
        externalRefSource: 'provider',
        externalRef: `dep-${i}`,
        amountNgn: 1000 + i,
        status: 'unmatched',
      })
    }
    for (let i = 0; i < 3; i++) {
      await depositStore.add({
        accountId: `acc-m-${i}`,
        externalRefSource: 'provider',
        externalRef: `dep-m-${i}`,
        amountNgn: 2000 + i,
        status: 'matched',
      })
    }

    const res = await request(app)
      .get('/api/admin/reconciliation/deposits')
      .query({ status: 'unmatched', page: 1, pageSize: 3 })
      .expect(200)

    expect(res.body.total).toBe(5)
    expect(res.body.items).toHaveLength(3)
    for (const item of res.body.items) {
      expect(item.status).toBe('unmatched')
      expect(item.externalRef).toMatch(/^provider:/)
      expect(item).not.toHaveProperty('payload')
    }
  })

  it('lists wallets with negative balances only when negative=true', async () => {
    await walletStore.setWallet('w-1', -500)
    await walletStore.setWallet('w-2', 0)
    await walletStore.setWallet('w-3', 1500)
    await walletStore.setWallet('w-4', -10)

    const resAll = await request(app)
      .get('/api/admin/reconciliation/wallets')
      .expect(200)
    expect(resAll.body.total).toBe(4)

    const resNeg = await request(app)
      .get('/api/admin/reconciliation/wallets')
      .query({ negative: 'true' })
      .expect(200)
    expect(resNeg.body.total).toBe(2)
    for (const w of resNeg.body.items) {
      expect(w.balanceNgn).toBeLessThan(0)
      expect(w).not.toHaveProperty('secret')
    }
  })

  it('lists conversions by status', async () => {
    for (let i = 0; i < 4; i++) {
      await conversionStore.add({
        from: 'NGN',
        to: 'USDC',
        amount: 100 + i,
        status: 'pending',
      })
    }
    await conversionStore.add({
      from: 'USDC',
      to: 'NGN',
      amount: 250,
      status: 'failed',
    })

    const res = await request(app)
      .get('/api/admin/reconciliation/conversions')
      .query({ status: 'pending' })
      .expect(200)
    expect(res.body.total).toBe(4)
    for (const c of res.body.items) {
      expect(c.status).toBe('pending')
      expect(c).not.toHaveProperty('payload')
    }
  })

  it('lists failed outbox items with limited fields', async () => {
    const ok = await outboxStore.create({
      txType: TxType.RECEIPT,
      canonicalExternalRefV1: 'test:ok',
      payload: { foo: 'bar' },
    })
    const fail = await outboxStore.create({
      txType: TxType.RECEIPT,
      canonicalExternalRefV1: 'test:fail',
      payload: { foo: 'baz' },
    })
    await outboxStore.updateStatus(ok.id, OutboxStatus.SENT)
    await outboxStore.updateStatus(fail.id, OutboxStatus.FAILED, 'network')

    const res = await request(app)
      .get('/api/admin/reconciliation/outbox')
      .query({ status: 'failed' })
      .expect(200)

    expect(res.body.total).toBe(1)
    const item = res.body.items[0]
    expect(item.status).toBe('failed')
    expect(item).not.toHaveProperty('payload')
    expect(item).toHaveProperty('txId')
  })
})

