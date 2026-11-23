import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { getPool } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import { requestIdMiddleware } from '../middleware/requestId.js'
import { seedAdminSession, adminAuthHeader } from '../test-fixtures/adminAuth.js'
import { createSettlementAdminRouter } from './settlementAdmin.js'

vi.mock('../db.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db.js')>()),
  getPool: vi.fn(),
}))

vi.mock('../utils/auditLogger.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/auditLogger.js')>()),
  auditLog: vi.fn().mockResolvedValue(undefined),
}))

const TENANT_TOKEN = 'test-token-settlement-admin-tenant'
const DLQ_ID = 'dlq-entry-1'

const dlqRow = {
  deal_id: 'deal-1',
  period: 3,
  event_type: 'full_payment_incentive',
  idempotency_key: 'idem-1',
  payload: { amountNgn: 100 },
}

type QueryResult = { rows: unknown[] }
type QueryFn = (text: string, params?: unknown[]) => Promise<QueryResult>

/** Installs a fake pool whose `query` is driven by `impl`. Returns the spy so tests can inspect calls. */
function usePool(impl: QueryFn) {
  const query = vi.fn(impl)
  vi.mocked(getPool).mockResolvedValue({ query } as never)
  return query
}

function buildApp() {
  const app = express()
  app.use(requestIdMiddleware)
  app.use(express.json())
  app.use('/api/admin', createSettlementAdminRouter())
  app.use(errorHandler)
  return app
}

describe('settlement admin routes (#2118)', () => {
  let app: express.Express
  let tenantHeader: { Authorization: string }

  beforeEach(async () => {
    delete process.env.ALLOW_LEGACY_ADMIN_SECRET
    vi.mocked(getPool).mockReset()
    vi.mocked(getPool).mockResolvedValue(null)
    await seedAdminSession()
    const tenant = await seedAdminSession({ email: 'settlement-tenant@example.com', token: TENANT_TOKEN, role: 'tenant' })
    tenantHeader = tenant.header
    app = buildApp()
  })

  describe('authentication and authorization', () => {
    it('POST replay rejects a request without a token before touching the database', async () => {
      const res = await request(app).post(`/api/admin/settlement-dlq/${DLQ_ID}/replay`)

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('UNAUTHORIZED')
      expect(getPool).not.toHaveBeenCalled()
    })

    it('GET list rejects a request without a token before touching the database', async () => {
      const res = await request(app).get('/api/admin/settlement-dlq')

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('UNAUTHORIZED')
      expect(getPool).not.toHaveBeenCalled()
    })

    it('POST replay rejects a non-admin tenant with 403', async () => {
      const res = await request(app)
        .post(`/api/admin/settlement-dlq/${DLQ_ID}/replay`)
        .set(tenantHeader)

      expect(res.status).toBe(403)
      expect(getPool).not.toHaveBeenCalled()
    })

    it('GET list rejects a non-admin tenant with 403', async () => {
      const res = await request(app).get('/api/admin/settlement-dlq').set(tenantHeader)

      expect(res.status).toBe(403)
      expect(getPool).not.toHaveBeenCalled()
    })

    it('ignores the legacy x-admin-secret header when the shared secret is disabled', async () => {
      const res = await request(app)
        .get('/api/admin/settlement-dlq')
        .set({ 'x-admin-secret': 'anything' })

      expect(res.status).toBe(401)
    })

    it('lets an admin through to the handler', async () => {
      const res = await request(app).get('/api/admin/settlement-dlq').set(adminAuthHeader)

      expect(res.status).toBe(200)
    })
  })

  describe('POST /settlement-dlq/:id/replay', () => {
    it('returns 501 when no database is configured', async () => {
      const res = await request(app)
        .post(`/api/admin/settlement-dlq/${DLQ_ID}/replay`)
        .set(adminAuthHeader)

      expect(res.status).toBe(501)
      expect(res.body.error.code).toBe('INTERNAL_ERROR')
    })

    it('returns 404 and writes nothing when the DLQ entry does not exist', async () => {
      const query = usePool(async () => ({ rows: [] }))

      const res = await request(app)
        .post(`/api/admin/settlement-dlq/${DLQ_ID}/replay`)
        .set(adminAuthHeader)

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
      expect(query).toHaveBeenCalledTimes(1)
      expect(query.mock.calls[0][0]).toContain('FROM settlement_outbox_dlq')
    })

    it('requeues the DLQ row into the outbox as pending and marks the DLQ row replayed', async () => {
      const query = usePool(async (text) => {
        if (text.includes('SELECT')) return { rows: [dlqRow] }
        return { rows: [] }
      })

      const res = await request(app)
        .post(`/api/admin/settlement-dlq/${DLQ_ID}/replay`)
        .set(adminAuthHeader)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(typeof res.body.newOutboxId).toBe('string')
      expect(res.body.newOutboxId.length).toBeGreaterThan(0)

      const insert = query.mock.calls.find(([text]) => text.includes('INSERT INTO settlement_outbox'))
      expect(insert).toBeDefined()
      const [, params] = insert as [string, unknown[]]
      expect(params[0]).toBe(res.body.newOutboxId)
      expect(params.slice(1, 5)).toEqual(['deal-1', 3, 'full_payment_incentive', 'idem-1'])
      expect(params[5]).toBe(JSON.stringify(dlqRow.payload))

      const markReplayed = query.mock.calls.find(([text]) => text.includes('SET replayed_at = NOW()'))
      expect(markReplayed?.[1]).toEqual([DLQ_ID])
    })

    it('passes a string payload through without encoding it twice', async () => {
      const query = usePool(async (text) => {
        if (text.includes('SELECT')) return { rows: [{ ...dlqRow, payload: '{"a":1}' }] }
        return { rows: [] }
      })

      await request(app).post(`/api/admin/settlement-dlq/${DLQ_ID}/replay`).set(adminAuthHeader).expect(200)

      const insert = query.mock.calls.find(([text]) => text.includes('INSERT INTO settlement_outbox'))
      expect((insert as [string, unknown[]])[1][5]).toBe('{"a":1}')
    })

    it('on an idempotency-key conflict, resets the existing outbox row to pending and still marks the DLQ row replayed', async () => {
      const query = usePool(async (text) => {
        if (text.includes('SELECT')) return { rows: [dlqRow] }
        if (text.includes('INSERT INTO settlement_outbox')) {
          throw Object.assign(new Error('duplicate key'), { code: '23505' })
        }
        return { rows: [] }
      })

      const res = await request(app)
        .post(`/api/admin/settlement-dlq/${DLQ_ID}/replay`)
        .set(adminAuthHeader)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      const reset = query.mock.calls.find(([text]) => text.includes("SET status = 'pending'"))
      expect(reset?.[0]).toContain('WHERE idempotency_key = $1')
      expect(reset?.[1]).toEqual(['idem-1'])

      const markReplayed = query.mock.calls.find(([text]) => text.includes('SET replayed_at = NOW()'))
      expect(markReplayed).toBeDefined()
    })

    it('rethrows a non-conflict insert failure as a 500 and leaves the DLQ row unmarked', async () => {
      const query = usePool(async (text) => {
        if (text.includes('SELECT')) return { rows: [dlqRow] }
        if (text.includes('INSERT INTO settlement_outbox')) throw new Error('connection reset')
        return { rows: [] }
      })

      const res = await request(app)
        .post(`/api/admin/settlement-dlq/${DLQ_ID}/replay`)
        .set(adminAuthHeader)

      expect(res.status).toBe(500)
      expect(query.mock.calls.some(([text]) => text.includes('SET replayed_at = NOW()'))).toBe(false)
    })

    it.fails('rejects a malformed id with 400 (no input validation today)', async () => {
      // Documented gap for #2118: the route does no input validation, so a
      // non-UUID id reaches the database. it.fails keeps CI green until a validator exists.
      usePool(async () => ({ rows: [] }))

      const res = await request(app)
        .post('/api/admin/settlement-dlq/not-a-uuid/replay')
        .set(adminAuthHeader)

      expect(res.status).toBe(400)
    })

    it.fails('returns the id of the existing outbox row after a conflict, not a fresh id', async () => {
      // Known bug: after a 23505 conflict the outbox row keeps its original id,
      // but the response reports a newly generated id that does not exist in
      // settlement_outbox. This test asserts the intended behaviour; it.fails
      // keeps CI green while the bug stands. Flip to `it` once the handler
      // returns the existing row's id (e.g. UPDATE ... RETURNING id).
      usePool(async (text) => {
        if (text.includes('SELECT')) return { rows: [dlqRow] }
        if (text.includes('INSERT INTO settlement_outbox')) {
          throw Object.assign(new Error('duplicate key'), { code: '23505' })
        }
        if (text.includes('UPDATE settlement_outbox')) return { rows: [{ id: 'existing-outbox-7' }] }
        return { rows: [] }
      })

      const res = await request(app)
        .post(`/api/admin/settlement-dlq/${DLQ_ID}/replay`)
        .set(adminAuthHeader)

      expect(res.body.newOutboxId).toBe('existing-outbox-7')
    })
  })

  describe('GET /settlement-dlq', () => {
    it('returns the list wrapped in the success envelope when the database is available', async () => {
      const summary = {
        id: DLQ_ID,
        deal_id: 'deal-1',
        period: 3,
        event_type: 'full_payment_incentive',
        idempotency_key: 'idem-1',
        last_error: 'timeout',
        failed_at: '2026-11-01T00:00:00.000Z',
        replayed_at: null,
      }
      const query = usePool(async () => ({ rows: [summary] }))

      const res = await request(app).get('/api/admin/settlement-dlq').set(adminAuthHeader)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.items).toEqual([summary])
      expect(query.mock.calls[0][0]).toContain('ORDER BY failed_at DESC LIMIT 100')
    })

    it('returns an empty list when no database is configured', async () => {
      const res = await request(app).get('/api/admin/settlement-dlq').set(adminAuthHeader)

      expect(res.status).toBe(200)
      expect(res.body.items).toEqual([])
    })

    it.fails('wraps the no-database empty list in the same { success, data } envelope as the database path', async () => {
      // Known inconsistency for #2118: the no-database branch returns { items: [] }
      // while the database branch returns { success: true, data: { items } }.
      // Clients that read data.items break when the database is absent.
      const res = await request(app).get('/api/admin/settlement-dlq').set(adminAuthHeader)

      expect(res.body.success).toBe(true)
      expect(res.body.data.items).toEqual([])
    })

    it('passes a database failure to the error handler as a 500', async () => {
      usePool(async () => {
        throw new Error('relation does not exist')
      })

      const res = await request(app).get('/api/admin/settlement-dlq').set(adminAuthHeader)

      expect(res.status).toBe(500)
    })
  })
})
