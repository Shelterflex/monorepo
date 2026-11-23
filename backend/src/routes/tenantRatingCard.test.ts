import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import { createTenantRatingCardRouter } from './tenantRatingCard.js'
import { errorHandler } from '../middleware/errorHandler.js'
import { DealStatus } from '../models/deal.js'

vi.mock('../middleware/auth.js', () => ({
  authenticateToken: (req: any, res: any, next: any) => {
    const id = req.headers['x-test-user']
    if (!id) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } })
      return
    }
    req.user = { id: String(id), email: 'user@example.test', name: 'User', role: 'landlord' }
    next()
  },
}))

interface FakeDeal {
  dealId: string
  tenantId: string
  landlordId: string
  status: DealStatus
}

const dealsById = new Map<string, FakeDeal>()

vi.mock('../models/dealStore.js', () => ({
  dealStore: {
    findById: async (dealId: string) => dealsById.get(dealId) ?? null,
  },
}))

function addDeal(status: DealStatus): FakeDeal {
  const deal: FakeDeal = { dealId: globalThis.crypto.randomUUID(), tenantId: globalThis.crypto.randomUUID(), landlordId: globalThis.crypto.randomUUID(), status }
  dealsById.set(deal.dealId, deal)
  return deal
}

function buildApp(): express.Application {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', createTenantRatingCardRouter())
  app.use(errorHandler)
  return app
}

const ratingBody = (dealId: string, comment?: string) => ({
  dealId,
  paymentTimeliness: 5,
  propertyCare: 4,
  communication: 3,
  overall: 4,
  ...(comment ? { comment } : {}),
})

describe('tenant rating card (#2051)', () => {
  let app: express.Application

  beforeEach(() => {
    app = buildApp()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lets only the deal landlord rate the tenant, and takes the tenant from the deal', async () => {
    const deal = addDeal(DealStatus.ACTIVE)

    const stranger = await request(app)
      .post(`/api/v1/deals/${deal.dealId}/tenant-rating`)
      .set('x-test-user', globalThis.crypto.randomUUID())
      .send(ratingBody(deal.dealId))
    expect(stranger.status).toBe(403)

    const landlord = await request(app)
      .post(`/api/v1/deals/${deal.dealId}/tenant-rating`)
      .set('x-test-user', deal.landlordId)
      .send({ ...ratingBody(deal.dealId), tenantId: globalThis.crypto.randomUUID() })
    expect(landlord.status).toBe(201)

    const card = await request(app).get('/api/v1/tenant/rating-card').set('x-test-user', deal.tenantId)
    expect(card.body.data.ratingCount).toBe(1)
  })

  it('refuses to rate a deal that is not yet active or completed', async () => {
    const draft = addDeal(DealStatus.DRAFT)
    const res = await request(app)
      .post(`/api/v1/deals/${draft.dealId}/tenant-rating`)
      .set('x-test-user', draft.landlordId)
      .send(ratingBody(draft.dealId))
    expect(res.status).toBe(409)
  })

  it('allows one rating per deal', async () => {
    const deal = addDeal(DealStatus.COMPLETED)
    const first = await request(app)
      .post(`/api/v1/deals/${deal.dealId}/tenant-rating`)
      .set('x-test-user', deal.landlordId)
      .send(ratingBody(deal.dealId))
    const second = await request(app)
      .post(`/api/v1/deals/${deal.dealId}/tenant-rating`)
      .set('x-test-user', deal.landlordId)
      .send(ratingBody(deal.dealId))
    expect(first.status).toBe(201)
    expect(second.status).toBe(409)
  })

  it('returns a share link id and reveals no personal data on the public card', async () => {
    const deal = addDeal(DealStatus.COMPLETED)
    await request(app)
      .post(`/api/v1/deals/${deal.dealId}/tenant-rating`)
      .set('x-test-user', deal.landlordId)
      .send(ratingBody(deal.dealId, 'Pays on time'))

    const share = await request(app)
      .post('/api/v1/tenant/rating-card/share')
      .set('x-test-user', deal.tenantId)
      .send({ ttlDays: 7 })
    expect(share.status).toBe(201)
    expect(share.body.data.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(share.body.data.token).toMatch(/^[a-f0-9]{64}$/)

    const pub = await request(app).get(`/api/v1/public/rating-card/${share.body.data.token}`)
    expect(pub.status).toBe(200)
    expect(pub.headers['cache-control']).toBe('no-store')
    expect(pub.body.data.ratingCount).toBe(1)
    expect(pub.body.data.recentComments).toEqual(['Pays on time'])

    const serialised = JSON.stringify(pub.body)
    expect(serialised).not.toContain(deal.landlordId)
    expect(serialised).not.toContain(deal.tenantId)
    expect(serialised).not.toContain('@')
  })

  it('lets a tenant revoke only their own share link, and a revoked link returns 404', async () => {
    const deal = addDeal(DealStatus.COMPLETED)
    const share = await request(app)
      .post('/api/v1/tenant/rating-card/share')
      .set('x-test-user', deal.tenantId)
      .send({ ttlDays: 7 })

    const otherTenant = await request(app)
      .delete(`/api/v1/tenant/rating-card/share/${share.body.data.id}`)
      .set('x-test-user', globalThis.crypto.randomUUID())
    expect(otherTenant.status).toBe(404)

    const owner = await request(app)
      .delete(`/api/v1/tenant/rating-card/share/${share.body.data.id}`)
      .set('x-test-user', deal.tenantId)
    expect(owner.status).toBe(200)

    const revoked = await request(app).get(`/api/v1/public/rating-card/${share.body.data.token}`)
    expect(revoked.status).toBe(404)
  })

  it('returns the same 404 for expired, unknown and malformed tokens', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-23T10:00:00Z'))
    const deal = addDeal(DealStatus.COMPLETED)
    const share = await request(app)
      .post('/api/v1/tenant/rating-card/share')
      .set('x-test-user', deal.tenantId)
      .send({ ttlDays: 1 })

    clock.mockReturnValue(Date.parse('2026-11-25T10:00:00Z'))

    const expired = await request(app).get(`/api/v1/public/rating-card/${share.body.data.token}`)
    const unknown = await request(app).get(`/api/v1/public/rating-card/${'a'.repeat(64)}`)
    const malformed = await request(app).get('/api/v1/public/rating-card/not-a-token')

    expect(expired.status).toBe(404)
    expect(unknown.status).toBe(404)
    expect(malformed.status).toBe(404)
    expect(expired.body.error.message).toBe(unknown.body.error.message)
  })

  it('rejects a share lifetime outside 1 to 30 days', async () => {
    const res = await request(app)
      .post('/api/v1/tenant/rating-card/share')
      .set('x-test-user', globalThis.crypto.randomUUID())
      .send({ ttlDays: 31 })
    expect(res.status).toBe(400)
  })
})
