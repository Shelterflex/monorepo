import { describe, it, expect, beforeEach } from 'vitest'
import supertest from 'supertest'
import express from 'express'
import { createReceiptsRouter } from './receiptsRoute.js'
import { StubReceiptRepository, IndexedReceipt } from '../indexer/receipt-repository.js'
import { TxType } from '../outbox/types.js'
import { errorHandler } from '../middleware/errorHandler.js'
import { requestIdMiddleware } from '../middleware/requestId.js'
import { sessionStore, userStore } from '../models/authStore.js'
import { generateToken } from '../utils/tokens.js'

function buildApp(repo: StubReceiptRepository) {
  const app = express()
  app.use(requestIdMiddleware)
  app.use(express.json())
  app.use('/api', createReceiptsRouter(repo))
  app.use(errorHandler)
  return app
}

function makeReceipt(overrides: Partial<IndexedReceipt> = {}): IndexedReceipt {
  return {
    txId: `tx-${Math.random().toString(36).slice(2)}`,
    txType: TxType.STAKE,
    dealId: 'deal-abc',
    amountUsdc: '50.00',
    externalRefHash: 'hashXYZ',
    ledger: 1000,
    indexedAt: new Date('2024-06-01T00:00:00Z'),
    ...overrides,
  }
}

describe('GET /api/admin/receipts', () => {
  let repo: StubReceiptRepository
  let token: string

  beforeEach(async () => {
    repo = new StubReceiptRepository()
    sessionStore.clear()
    userStore.clear()

    // Create a user + session for auth
    const user = await userStore.getOrCreateByEmail('admin@test.com')
    token = generateToken()
    await sessionStore.create(user.email, token)
  })

  it('returns 401 without a token', async () => {
    const app = buildApp(repo)
    const res = await supertest(app).get('/api/admin/receipts')
    expect(res.status).toBe(401)
  })

  it('returns paged receipts with valid token', async () => {
    await repo.upsertMany([makeReceipt(), makeReceipt()])
    const app = buildApp(repo)

    const res = await supertest(app)
      .get('/api/admin/receipts')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    expect(res.body.total).toBe(2)
    expect(res.body.data).toHaveLength(2)
    expect(res.body.page).toBe(1)
    expect(res.body.pageSize).toBe(20)
  })

  it('filters by dealId', async () => {
    await repo.upsertMany([
      makeReceipt({ dealId: 'deal-A' }),
      makeReceipt({ dealId: 'deal-B' }),
      makeReceipt({ dealId: 'deal-A' }),
    ])
    const app = buildApp(repo)

    const res = await supertest(app)
      .get('/api/admin/receipts?dealId=deal-A')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    expect(res.body.total).toBe(2)
    expect(res.body.data.every((r: IndexedReceipt) => r.dealId === 'deal-A')).toBe(true)
  })

  it('filters by txType', async () => {
    await repo.upsertMany([
      makeReceipt({ txType: TxType.STAKE }),
      makeReceipt({ txType: TxType.UNSTAKE }),
    ])
    const app = buildApp(repo)

    const res = await supertest(app)
      .get(`/api/admin/receipts?txType=${TxType.STAKE}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    expect(res.body.total).toBe(1)
    expect(res.body.data[0].txType).toBe(TxType.STAKE)
  })

  it('rejects invalid txType with 400', async () => {
    const app = buildApp(repo)
    const res = await supertest(app)
      .get('/api/admin/receipts?txType=NOT_VALID')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
    expect(res.body.error.message).toContain('Invalid txType')
  })

  it('filters by fromAddress', async () => {
    await repo.upsertMany([
      makeReceipt({ from: 'ADDR_A' }),
      makeReceipt({ from: 'ADDR_B' }),
      makeReceipt({ from: 'ADDR_A' }),
    ])
    const app = buildApp(repo)

    const res = await supertest(app)
      .get('/api/admin/receipts?fromAddress=ADDR_A')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    expect(res.body.total).toBe(2)
    expect(res.body.data.every((r: IndexedReceipt) => r.from === 'ADDR_A')).toBe(true)
  })

  it('filters by toAddress', async () => {
    await repo.upsertMany([
      makeReceipt({ to: 'RCVR_X' }),
      makeReceipt({ to: 'RCVR_Y' }),
    ])
    const app = buildApp(repo)

    const res = await supertest(app)
      .get('/api/admin/receipts?toAddress=RCVR_X')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    expect(res.body.total).toBe(1)
    expect(res.body.data[0].to).toBe('RCVR_X')
  })

  it('filters by fromDate and toDate', async () => {
    await repo.upsertMany([
      makeReceipt({ txId: 'tx-old', indexedAt: new Date('2024-01-01T00:00:00Z') }),
      makeReceipt({ txId: 'tx-mid', indexedAt: new Date('2024-06-15T00:00:00Z') }),
      makeReceipt({ txId: 'tx-new', indexedAt: new Date('2024-12-31T00:00:00Z') }),
    ])
    const app = buildApp(repo)

    const res = await supertest(app)
      .get('/api/admin/receipts?fromDate=2024-03-01T00:00:00Z&toDate=2024-09-01T00:00:00Z')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    expect(res.body.total).toBe(1)
    expect(res.body.data[0].txId).toBe('tx-mid')
  })

  it('rejects invalid fromDate with 400', async () => {
    const app = buildApp(repo)
    const res = await supertest(app)
      .get('/api/admin/receipts?fromDate=not-a-date')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
    expect(res.body.error.message).toContain('Invalid fromDate')
  })

  it('rejects invalid toDate with 400', async () => {
    const app = buildApp(repo)
    const res = await supertest(app)
      .get('/api/admin/receipts?toDate=not-a-date')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
    expect(res.body.error.message).toContain('Invalid toDate')
  })

  it('rejects fromDate after toDate with 400', async () => {
    const app = buildApp(repo)
    const res = await supertest(app)
      .get('/api/admin/receipts?fromDate=2024-12-01T00:00:00Z&toDate=2024-01-01T00:00:00Z')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
    expect(res.body.error.message).toContain('fromDate must not be after toDate')
  })

  it('clamps pageSize to max 100', async () => {
    const receipts = Array.from({ length: 5 }, () => makeReceipt())
    await repo.upsertMany(receipts)
    const app = buildApp(repo)

    const res = await supertest(app)
      .get('/api/admin/receipts?pageSize=999')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    expect(res.body.pageSize).toBe(100)
  })

  it('paginates correctly', async () => {
    const receipts = Array.from({ length: 5 }, (_, i) =>
      makeReceipt({ txId: `tx-${i}` }),
    )
    await repo.upsertMany(receipts)
    const app = buildApp(repo)

    const res = await supertest(app)
      .get('/api/admin/receipts?page=2&pageSize=2')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    expect(res.body.page).toBe(2)
    expect(res.body.pageSize).toBe(2)
    expect(res.body.total).toBe(5)
    expect(res.body.data).toHaveLength(2)
  })
})

describe('GET /api/deals/:dealId/receipts', () => {
  let repo: StubReceiptRepository

  beforeEach(() => {
    repo = new StubReceiptRepository()
  })

  it('returns receipts for a deal', async () => {
    await repo.upsertMany([
      makeReceipt({ dealId: 'deal-1' }),
      makeReceipt({ dealId: 'deal-1' }),
      makeReceipt({ dealId: 'deal-2' }),
    ])
    const app = buildApp(repo)

    const res = await supertest(app).get('/api/deals/deal-1/receipts').expect(200)
    expect(res.body.dealId).toBe('deal-1')
    expect(res.body.total).toBe(2)
    expect(res.body.receipts).toHaveLength(2)
  })

  it('returns empty list for unknown deal', async () => {
    const app = buildApp(repo)
    const res = await supertest(app).get('/api/deals/no-such-deal/receipts').expect(200)
    expect(res.body.total).toBe(0)
    expect(res.body.receipts).toHaveLength(0)
  })
})
