import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { sessionStore, userStore } from '../models/authStore.js'
import { outboxStore } from '../outbox/store.js'
import { OutboxStatus, TxType } from '../outbox/types.js'
import { RATE_LIMIT_BYPASS_TOKEN } from '../test-helpers.js'

// The in-memory outbox store is used only when no database is configured.
// getPool() is stubbed to null so nothing here can reach a real database.
vi.mock('../db.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db.js')>()),
  getPool: vi.fn(async () => null),
}))

const ADMIN_TOKEN = 'test-token-outbox-admin'
const TENANT_TOKEN = 'test-token-outbox-tenant'
const UNKNOWN_ID = '550e8400-e29b-41d4-a716-446655440999'

function authed(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'x-ratelimit-bypass': RATE_LIMIT_BYPASS_TOKEN }
}

async function seed(
  ref: string,
  options: { createdAt: string; txType?: TxType; dead?: boolean; payload?: Record<string, unknown> },
) {
  const item = await outboxStore.create({
    txType: options.txType ?? TxType.STAKE,
    source: 'admin-outbox-test',
    ref,
    payload: options.payload ?? { ref },
  })
  // Pin createdAt so ordering assertions do not depend on clock resolution.
  item.createdAt = new Date(options.createdAt)
  if (options.dead) {
    await outboxStore.markDead(item.id, 'rpc timeout')
  }
  return item
}

describe('Admin outbox dead-letter routes', () => {
  let app: any

  beforeAll(() => {
    vi.stubEnv('DATABASE_URL', '')
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  beforeEach(async () => {
    await outboxStore.clear()
    sessionStore.clear()

    const admin = await userStore.getOrCreateByEmail('outbox-admin@example.com')
    admin.role = 'admin'
    const tenant = await userStore.getOrCreateByEmail('outbox-tenant@example.com')
    await sessionStore.create(admin.email, ADMIN_TOKEN)
    await sessionStore.create(tenant.email, TENANT_TOKEN)

    app = createApp()
  })

  describe('authentication and authorization', () => {
    const dismissUrl = `/api/admin/outbox/dead-letter/${UNKNOWN_ID}`

    it('rejects unauthenticated requests on every dead-letter route with 401', async () => {
      const responses = [
        await request(app).get('/api/admin/outbox/dead-letter'),
        await request(app).post(`${dismissUrl}/retry`),
        await request(app).post('/api/admin/outbox/dead-letter/bulk-retry').send({ eventType: 'stake' }),
        await request(app).delete(dismissUrl),
      ]

      for (const response of responses) {
        expect(response.status).toBe(401)
        expect(response.body.error.code).toBe('UNAUTHORIZED')
      }
    })

    it('rejects a tenant token with 403 on every dead-letter route', async () => {
      const responses = [
        await request(app).get('/api/admin/outbox/dead-letter').set(authed(TENANT_TOKEN)),
        await request(app).post(`${dismissUrl}/retry`).set(authed(TENANT_TOKEN)),
        await request(app)
          .post('/api/admin/outbox/dead-letter/bulk-retry')
          .set(authed(TENANT_TOKEN))
          .send({ eventType: 'stake' }),
        await request(app).delete(dismissUrl).set(authed(TENANT_TOKEN)),
      ]

      for (const response of responses) {
        expect(response.status).toBe(403)
        expect(response.body.error.code).toBe('FORBIDDEN')
      }
    })
  })

  describe('GET /api/admin/outbox/dead-letter', () => {
    it('lists only dead-lettered items, newest first, in the documented shape', async () => {
      const older = await seed('ref-old', { createdAt: '2026-11-01T00:00:00.000Z', dead: true })
      const newer = await seed('ref-new', {
        createdAt: '2026-11-03T00:00:00.000Z',
        dead: true,
        txType: TxType.CONVERSION,
        payload: { amount: 500 },
      })
      await seed('ref-pending', { createdAt: '2026-11-02T00:00:00.000Z' })

      const res = await request(app).get('/api/admin/outbox/dead-letter').set(authed(ADMIN_TOKEN)).expect(200)

      expect(res.body.pagination).toEqual({ page: 1, pageSize: 20, total: 2, totalPages: 1 })
      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([newer.id, older.id])
      expect(res.body.items[0]).toMatchObject({
        id: newer.id,
        eventType: 'conversion',
        txType: 'conversion',
        payload: { amount: 500 },
        failureReason: 'rpc timeout',
        retryCount: 0,
        createdAt: '2026-11-03T00:00:00.000Z',
      })
      expect(typeof res.body.items[0].lastAttemptedAt).toBe('string')
    })

    it('paginates and filters by eventType', async () => {
      await seed('stake-1', { createdAt: '2026-11-01T00:00:00.000Z', dead: true })
      await seed('stake-2', { createdAt: '2026-11-02T00:00:00.000Z', dead: true })
      await seed('stake-3', { createdAt: '2026-11-03T00:00:00.000Z', dead: true })
      await seed('conv-1', { createdAt: '2026-11-04T00:00:00.000Z', dead: true, txType: TxType.CONVERSION })

      const res = await request(app)
        .get('/api/admin/outbox/dead-letter?eventType=stake&page=2&pageSize=2')
        .set(authed(ADMIN_TOKEN))
        .expect(200)

      // Three stake items, newest first: stake-3, stake-2, stake-1. Page 2 holds stake-1.
      expect(res.body.items).toHaveLength(1)
      expect(res.body.items[0].payload).toEqual({ ref: 'stake-1' })
      expect(res.body.pagination).toEqual({ page: 2, pageSize: 2, total: 3, totalPages: 2 })
    })
  })

  describe('POST /api/admin/outbox/dead-letter/:id/retry', () => {
    it('returns 404 for an unknown id', async () => {
      const res = await request(app)
        .post(`/api/admin/outbox/dead-letter/${UNKNOWN_ID}/retry`)
        .set(authed(ADMIN_TOKEN))
        .expect(404)

      expect(res.body.error.code).toBe('NOT_FOUND')
      expect(res.body.error.message).toContain(UNKNOWN_ID)
    })

    it('returns 409 for an item that is not dead-lettered and leaves it unchanged', async () => {
      const pending = await seed('ref-pending', { createdAt: '2026-11-01T00:00:00.000Z' })

      const res = await request(app)
        .post(`/api/admin/outbox/dead-letter/${pending.id}/retry`)
        .set(authed(ADMIN_TOKEN))
        .expect(409)

      expect(res.body.error.code).toBe('CONFLICT')
      expect(res.body.error.message).toContain('status: pending')
      expect((await outboxStore.getById(pending.id))?.status).toBe(OutboxStatus.PENDING)
    })

    it('re-queues a dead-lettered item and clears its error', async () => {
      const dead = await seed('ref-dead', { createdAt: '2026-11-01T00:00:00.000Z', dead: true })

      const res = await request(app)
        .post(`/api/admin/outbox/dead-letter/${dead.id}/retry`)
        .set(authed(ADMIN_TOKEN))
        .expect(200)

      expect(res.body).toMatchObject({
        success: true,
        message: 'Record re-queued for processing',
        item: { id: dead.id, status: 'pending' },
      })

      const stored = await outboxStore.getById(dead.id)
      expect(stored?.status).toBe(OutboxStatus.PENDING)
      expect(stored?.lastError).toBe('')
      expect(stored?.nextRetryAt).toBeInstanceOf(Date)
    })

    // Known defect: the handler's doc comment says the retry count is reset to 0,
    // but the handler calls outboxStore.updateStatus, which increments retryCount.
    it.fails('resets the retry count to 0 as the route documentation states', async () => {
      const dead = await seed('ref-count', { createdAt: '2026-11-01T00:00:00.000Z', dead: true })

      const res = await request(app)
        .post(`/api/admin/outbox/dead-letter/${dead.id}/retry`)
        .set(authed(ADMIN_TOKEN))
        .expect(200)

      expect(res.body.item.retryCount).toBe(0)
    })
  })

  describe('POST /api/admin/outbox/dead-letter/bulk-retry', () => {
    it('returns 400 when eventType is missing', async () => {
      const res = await request(app)
        .post('/api/admin/outbox/dead-letter/bulk-retry')
        .set(authed(ADMIN_TOKEN))
        .send({})
        .expect(400)

      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(res.body.error.message).toBe('eventType is required')
    })

    it('returns 400 when eventType is not a string', async () => {
      const res = await request(app)
        .post('/api/admin/outbox/dead-letter/bulk-retry')
        .set(authed(ADMIN_TOKEN))
        .send({ eventType: 42 })
        .expect(400)

      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('only re-queues dead items of the requested type and leaves every other item alone', async () => {
      const deadStake1 = await seed('stake-dead-1', { createdAt: '2026-11-01T00:00:00.000Z', dead: true })
      const deadStake2 = await seed('stake-dead-2', { createdAt: '2026-11-02T00:00:00.000Z', dead: true })
      const deadConversion = await seed('conv-dead', {
        createdAt: '2026-11-03T00:00:00.000Z',
        dead: true,
        txType: TxType.CONVERSION,
      })
      const pendingStake = await seed('stake-pending', { createdAt: '2026-11-04T00:00:00.000Z' })

      const res = await request(app)
        .post('/api/admin/outbox/dead-letter/bulk-retry')
        .set(authed(ADMIN_TOKEN))
        .send({ eventType: 'stake' })
        .expect(200)

      expect(res.body).toEqual({
        success: true,
        reQueued: 2,
        message: '2 record(s) re-queued for processing',
      })

      expect((await outboxStore.getById(deadStake1.id))?.status).toBe(OutboxStatus.PENDING)
      expect((await outboxStore.getById(deadStake2.id))?.status).toBe(OutboxStatus.PENDING)
      expect((await outboxStore.getById(deadConversion.id))?.status).toBe(OutboxStatus.DEAD)

      const untouched = await outboxStore.getById(pendingStake.id)
      expect(untouched?.status).toBe(OutboxStatus.PENDING)
      expect(untouched?.attempts).toBe(0)
    })

    it('reports zero when no dead item matches', async () => {
      await seed('stake-live', { createdAt: '2026-11-01T00:00:00.000Z' })

      const res = await request(app)
        .post('/api/admin/outbox/dead-letter/bulk-retry')
        .set(authed(ADMIN_TOKEN))
        .send({ eventType: 'stake' })
        .expect(200)

      expect(res.body.reQueued).toBe(0)
    })
  })

  describe('DELETE /api/admin/outbox/dead-letter/:id', () => {
    it('returns 404 for an unknown id', async () => {
      const res = await request(app)
        .delete(`/api/admin/outbox/dead-letter/${UNKNOWN_ID}`)
        .set(authed(ADMIN_TOKEN))
        .expect(404)

      expect(res.body.error.code).toBe('NOT_FOUND')
    })

    it('acknowledges the dismissal of a dead-letter item', async () => {
      const dead = await seed('ref-dismiss', { createdAt: '2026-11-01T00:00:00.000Z', dead: true })

      const res = await request(app)
        .delete(`/api/admin/outbox/dead-letter/${dead.id}`)
        .set(authed(ADMIN_TOKEN))
        .expect(200)

      expect(res.body).toEqual({ success: true, message: 'Record permanently dismissed' })
    })

    // Known defect: the route is documented as a hard delete, but the handler only logs
    // and returns success. It never removes the record from outboxStore.
    it.fails('removes the dead-letter record from the store', async () => {
      const dead = await seed('ref-hard-delete', { createdAt: '2026-11-01T00:00:00.000Z', dead: true })

      await request(app).delete(`/api/admin/outbox/dead-letter/${dead.id}`).set(authed(ADMIN_TOKEN)).expect(200)

      expect(await outboxStore.getById(dead.id)).toBeNull()
    })
  })
})
