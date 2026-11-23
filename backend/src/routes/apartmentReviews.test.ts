import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import { randomUUID } from 'node:crypto'
import { createApartmentReviewsRouter, createAdminApartmentReviewsRouter } from './apartmentReviews.js'
import { errorHandler } from '../middleware/errorHandler.js'
import { DealStatus } from '../models/deal.js'
import { ListingApplicationStatus } from '../models/listingApplication.js'

// Authenticates from x-test-user; x-test-admin grants listings:moderate. Mirrors authenticateToken and requirePermission.
vi.mock('../middleware/auth.js', () => ({
  authenticateToken: (req: any, res: any, next: any) => {
    const id = req.headers['x-test-user']
    if (!id) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } })
      return
    }
    req.user = { id: String(id), email: 'tenant@example.test', name: 'Tenant', role: 'tenant' }
    next()
  },
}))

vi.mock('../middleware/rbac.js', () => ({
  requirePermission: () => (req: any, res: any, next: any) => {
    if (!req.headers['x-test-admin']) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } })
      return
    }
    next()
  },
}))

vi.mock('../utils/auditLogger.js', () => ({
  auditLog: vi.fn(),
  extractAuditContext: vi.fn(() => ({ userId: 'admin', requestId: 'r', ip: '127.0.0.1', actorType: 'admin' })),
}))

const deals: Array<{ tenantId: string; listingId: string; status: DealStatus }> = []
const applications: Array<{ tenantId: string; listingId: string; status: ListingApplicationStatus }> = []

vi.mock('../models/dealStore.js', () => ({
  dealStore: {
    findMany: async (filters: { tenantId?: string; page?: number; pageSize?: number }) => {
      const matches = deals.filter((d) => d.tenantId === filters.tenantId)
      return { deals: matches, total: matches.length, page: filters.page ?? 1, pageSize: filters.pageSize ?? 100 }
    },
  },
}))

vi.mock('../repositories/ListingApplicationRepository.js', () => ({
  listingApplicationRepository: {
    findByTenantId: async (tenantId: string) => applications.filter((a) => a.tenantId === tenantId),
  },
}))

function buildApp(): express.Application {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/apartment-reviews', createApartmentReviewsRouter())
  app.use('/api/v1/admin/apartment-reviews', createAdminApartmentReviewsRouter())
  app.use(errorHandler)
  return app
}

function tenantWithStay(listingId: string): string {
  const tenantId = randomUUID()
  deals.push({ tenantId, listingId, status: DealStatus.COMPLETED })
  return tenantId
}

describe('apartment reviews (#2050)', () => {
  let app: express.Application

  beforeEach(() => {
    app = buildApp()
    deals.length = 0
    applications.length = 0
  })

  it('requires authentication to create a review', async () => {
    const res = await request(app)
      .post('/api/v1/apartment-reviews')
      .send({ listingId: randomUUID(), rating: 4, text: 'Fine' })
    expect(res.status).toBe(401)
  })

  it('lets a tenant with a completed deal review the listing and hides the reviewer id', async () => {
    const listingId = randomUUID()
    const tenantId = tenantWithStay(listingId)

    const res = await request(app)
      .post('/api/v1/apartment-reviews')
      .set('x-test-user', tenantId)
      .send({ listingId, rating: 5, text: 'Quiet street and a responsive landlord.' })

    expect(res.status).toBe(201)
    expect(res.body.data.verifiedStay).toBe(true)
    expect(res.body.data.userId).toBeUndefined()
  })

  it('accepts a live application without marking the review as a verified stay', async () => {
    const listingId = randomUUID()
    const tenantId = randomUUID()
    applications.push({ tenantId, listingId, status: ListingApplicationStatus.UNDER_REVIEW })

    const res = await request(app)
      .post('/api/v1/apartment-reviews')
      .set('x-test-user', tenantId)
      .send({ listingId, rating: 3, text: 'Applied, not yet moved in.' })

    expect(res.status).toBe(201)
    expect(res.body.data.verifiedStay).toBe(false)
  })

  it('refuses a review from someone with no relationship to the listing', async () => {
    const res = await request(app)
      .post('/api/v1/apartment-reviews')
      .set('x-test-user', randomUUID())
      .send({ listingId: randomUUID(), rating: 2, text: 'Never lived here.' })
    expect(res.status).toBe(403)
  })

  it('allows only one review per user per listing', async () => {
    const listingId = randomUUID()
    const tenantId = tenantWithStay(listingId)
    const body = { listingId, rating: 4, text: 'First review.' }

    const first = await request(app).post('/api/v1/apartment-reviews').set('x-test-user', tenantId).send(body)
    const second = await request(app).post('/api/v1/apartment-reviews').set('x-test-user', tenantId).send(body)

    expect(first.status).toBe(201)
    expect(second.status).toBe(409)
  })

  it('rejects HTML in review text and ratings outside 1 to 5', async () => {
    const listingId = randomUUID()
    const tenantId = tenantWithStay(listingId)

    const html = await request(app)
      .post('/api/v1/apartment-reviews')
      .set('x-test-user', tenantId)
      .send({ listingId, rating: 4, text: '<img src=x onerror=alert(1)>' })
    const badRating = await request(app)
      .post('/api/v1/apartment-reviews')
      .set('x-test-user', tenantId)
      .send({ listingId, rating: 6, text: 'Fine.' })

    expect(html.status).toBe(400)
    expect(badRating.status).toBe(400)
  })

  it('enforces the maximum text length', async () => {
    const listingId = randomUUID()
    const tenantId = tenantWithStay(listingId)
    const res = await request(app)
      .post('/api/v1/apartment-reviews')
      .set('x-test-user', tenantId)
      .send({ listingId, rating: 4, text: 'a'.repeat(2001) })
    expect(res.status).toBe(400)
  })

  it('bounds pagination and returns the average over visible reviews only', async () => {
    const listingId = randomUUID()
    const tenantA = tenantWithStay(listingId)
    const tenantB = tenantWithStay(listingId)
    await request(app).post('/api/v1/apartment-reviews').set('x-test-user', tenantA).send({ listingId, rating: 5, text: 'Great' })
    await request(app).post('/api/v1/apartment-reviews').set('x-test-user', tenantB).send({ listingId, rating: 3, text: 'Okay' })

    const list = await request(app).get('/api/v1/apartment-reviews').query({ listingId, pageSize: 1, page: 1 })
    expect(list.status).toBe(200)
    expect(list.body.data.total).toBe(2)
    expect(list.body.data.reviews).toHaveLength(1)
    expect(list.body.data.averageRating).toBe(4)

    const tooLarge = await request(app).get('/api/v1/apartment-reviews').query({ pageSize: 500 })
    expect(tooLarge.status).toBe(400)
  })

  it('hides a review once it reaches the report threshold, and removes it from listings and the average', async () => {
    const listingId = randomUUID()
    const author = tenantWithStay(listingId)
    const created = await request(app)
      .post('/api/v1/apartment-reviews')
      .set('x-test-user', author)
      .send({ listingId, rating: 1, text: 'Disputed claim.' })
    const reviewId = created.body.data.id as string

    // Each reporter needs a deal or application to matter for the review itself; reports only need a user id.
    for (let i = 0; i < 3; i++) {
      const res = await request(app).post(`/api/v1/apartment-reviews/${reviewId}/report`).set('x-test-user', randomUUID())
      expect(res.status).toBe(200)
    }

    const list = await request(app).get('/api/v1/apartment-reviews').query({ listingId })
    expect(list.body.data.total).toBe(0)
    expect(list.body.data.averageRating).toBeNull()
  })

  it('counts a repeat report from the same user once', async () => {
    const listingId = randomUUID()
    const author = tenantWithStay(listingId)
    const created = await request(app)
      .post('/api/v1/apartment-reviews')
      .set('x-test-user', author)
      .send({ listingId, rating: 2, text: 'Could be better.' })
    const reviewId = created.body.data.id as string
    const reporter = randomUUID()

    const first = await request(app).post(`/api/v1/apartment-reviews/${reviewId}/report`).set('x-test-user', reporter)
    const again = await request(app).post(`/api/v1/apartment-reviews/${reviewId}/report`).set('x-test-user', reporter)

    expect(first.body.data.alreadyReported).toBe(false)
    expect(again.body.data.alreadyReported).toBe(true)

    const list = await request(app).get('/api/v1/apartment-reviews').query({ listingId })
    expect(list.body.data.total).toBe(1)
  })

  it('does not let an author report their own review', async () => {
    const listingId = randomUUID()
    const author = tenantWithStay(listingId)
    const created = await request(app)
      .post('/api/v1/apartment-reviews')
      .set('x-test-user', author)
      .send({ listingId, rating: 4, text: 'Mine.' })

    const res = await request(app)
      .post(`/api/v1/apartment-reviews/${created.body.data.id}/report`)
      .set('x-test-user', author)
    expect(res.status).toBe(403)
  })

  it('lets only a moderator change visibility', async () => {
    const listingId = randomUUID()
    const author = tenantWithStay(listingId)
    const created = await request(app)
      .post('/api/v1/apartment-reviews')
      .set('x-test-user', author)
      .send({ listingId, rating: 4, text: 'Visible until moderated.' })
    const path = `/api/v1/admin/apartment-reviews/${created.body.data.id}`

    const moderator = randomUUID()
    const denied = await request(app).patch(path).set('x-test-user', moderator).send({ isHidden: true })
    expect(denied.status).toBe(403)

    const allowed = await request(app)
      .patch(path)
      .set('x-test-user', moderator)
      .set('x-test-admin', '1')
      .send({ isHidden: true })
    expect(allowed.status).toBe(200)
    expect(allowed.body.data.isHidden).toBe(true)

    const list = await request(app).get('/api/v1/apartment-reviews').query({ listingId })
    expect(list.body.data.total).toBe(0)
  })
})
