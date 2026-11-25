import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { getPool } from '../db.js'
import { sessionStore, userStore } from '../models/authStore.js'
import { RATE_LIMIT_BYPASS_TOKEN } from '../test-helpers.js'

// The ledger reads go through getPool(). The pool is replaced with an in-memory fake
// that records every query and returns rows from ledgerRows.
vi.mock('../db.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db.js')>()),
  getPool: vi.fn(async () => null),
}))

const ADMIN_TOKEN = 'test-token-ledger-admin'
const TENANT_TOKEN = 'test-token-ledger-tenant'

function authed(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

let ledgerRows: Record<string, unknown>[] = []
let ledgerError: Error | null = null
const poolQuery = vi.fn(async (sql: string, _params?: unknown[]) => {
  if (sql.includes('FROM transaction_ledger')) {
    if (ledgerError) throw ledgerError
    return { rows: ledgerRows }
  }
  // requirePermission queries role assignments; no RBAC rows means the legacy role fallback applies.
  return { rows: [] }
})
const fakePool = { query: poolQuery }

/** The ledger SQL and its parameters, skipping the RBAC lookup that runs first on every request. */
function ledgerCall(): [string, unknown[]] {
  const call = poolQuery.mock.calls.find(([sql]) => sql.includes('FROM transaction_ledger'))
  if (!call) throw new Error('no ledger query was issued')
  return call as [string, unknown[]]
}

/** True when every $n placeholder in the SQL maps to exactly one parameter, in order. */
function placeholdersMatchParams(sql: string, params: unknown[]): boolean {
  const used = new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))
  if (used.size !== params.length) return false
  return params.every((_, i) => used.has(i + 1))
}

function ledgerRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'tl-1',
    tx_type: 'deposit',
    internal_ref: 'int-1',
    external_ref: 'ext-1',
    amount_minor: '100',
    currency: 'NGN',
    status: 'confirmed',
    user_id: 'user-1',
    actor_email: 'ada@example.com',
    created_at: '2026-11-02T10:00:00.000Z',
    updated_at: '2026-11-02T10:00:00.000Z',
    ...overrides,
  }
}

describe('Admin transaction ledger routes', () => {
  let app: any

  beforeAll(() => {
    vi.stubEnv('DATABASE_URL', '')
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  beforeEach(async () => {
    ledgerRows = []
    ledgerError = null
    poolQuery.mockClear()
    vi.mocked(getPool).mockResolvedValue(fakePool as any)

    sessionStore.clear()
    const admin = await userStore.getOrCreateByEmail('ledger-admin@example.com')
    admin.role = 'admin'
    const tenant = await userStore.getOrCreateByEmail('ledger-tenant@example.com')
    await sessionStore.create(admin.email, ADMIN_TOKEN)
    await sessionStore.create(tenant.email, TENANT_TOKEN)

    app = createApp()
  })

  describe('authentication and authorization', () => {
    it('rejects unauthenticated requests with 401 on both routes', async () => {
      for (const url of ['/api/admin/transaction-ledger', '/api/admin/transaction-ledger/export']) {
        const res = await request(app).get(url)
        expect(res.status, url).toBe(401)
        expect(res.body.error.code).toBe('UNAUTHORIZED')
      }
    })

    it('rejects a tenant token with 403 on both routes', async () => {
      for (const url of ['/api/admin/transaction-ledger', '/api/admin/transaction-ledger/export']) {
        const res = await request(app).get(url).set(authed(TENANT_TOKEN))
        expect(res.status, url).toBe(403)
        expect(res.body.error.code).toBe('FORBIDDEN')
      }
    })
  })

  describe('GET /api/admin/transaction-ledger', () => {
    it('returns 400 for invalid query parameters', async () => {
      const badQueries = [
        '/api/admin/transaction-ledger?limit=0',
        '/api/admin/transaction-ledger?limit=501',
        '/api/admin/transaction-ledger?dateFrom=yesterday',
        '/api/admin/transaction-ledger?sortBy=bogus',
        '/api/admin/transaction-ledger?sortDir=sideways',
      ]

      for (const url of badQueries) {
        const res = await request(app).get(url).set(authed(ADMIN_TOKEN))
        expect(res.status, url).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
      }
      expect(poolQuery.mock.calls.some(([sql]) => sql.includes('FROM transaction_ledger'))).toBe(false)
    })

    it('returns the rows newest first with no next page when they fit within the limit', async () => {
      ledgerRows = [
        ledgerRow({ id: 'tl-3', created_at: '2026-11-03T00:00:00.000Z' }),
        ledgerRow({ id: 'tl-2', created_at: '2026-11-02T00:00:00.000Z' }),
        ledgerRow({ id: 'tl-1', created_at: '2026-11-01T00:00:00.000Z' }),
      ]

      const res = await request(app).get('/api/admin/transaction-ledger').set(authed(ADMIN_TOKEN)).expect(200)

      expect(res.body).toEqual({
        data: ledgerRows,
        count: 3,
        hasNextPage: false,
        nextCursor: null,
      })

      const [sql, params] = ledgerCall()
      expect(sql).toContain('ORDER BY tl.created_at DESC, tl.id DESC')
      // The default limit is 50; one extra row is fetched to detect a next page.
      expect(params).toEqual([51])
    })

    it('signals a next page and uses the last returned created_at as the cursor', async () => {
      ledgerRows = [
        ledgerRow({ id: 'tl-3', created_at: '2026-11-03T00:00:00.000Z' }),
        ledgerRow({ id: 'tl-2', created_at: '2026-11-02T00:00:00.000Z' }),
        ledgerRow({ id: 'tl-1', created_at: '2026-11-01T00:00:00.000Z' }),
      ]

      const res = await request(app).get('/api/admin/transaction-ledger?limit=2').set(authed(ADMIN_TOKEN)).expect(200)

      expect(res.body.data.map((r: { id: string }) => r.id)).toEqual(['tl-3', 'tl-2'])
      expect(res.body.hasNextPage).toBe(true)
      expect(res.body.nextCursor).toBe('2026-11-02T00:00:00.000Z')
    })

    it('binds every filter to its own parameter, with the cursor first', async () => {
      await request(app)
        .get(
          '/api/admin/transaction-ledger?cursor=2026-11-20T00:00:00.000Z&dateFrom=2026-11-01T00:00:00.000Z' +
            '&dateTo=2026-11-30T23:59:59.000Z&type=deposit&currency=NGN&status=confirmed',
        )
        .set(authed(ADMIN_TOKEN))
        .expect(200)

      const [sql, params] = ledgerCall()
      expect(sql).toContain('tl.created_at < $1')
      expect(sql).toContain('tl.created_at >= $2')
      expect(sql).toContain('tl.created_at <= $3')
      expect(sql).toContain('tl.tx_type = $4')
      expect(sql).toContain('tl.currency = $5')
      expect(sql).toContain('tl.status = $6')
      expect(params).toEqual([
        '2026-11-20T00:00:00.000Z',
        '2026-11-01T00:00:00.000Z',
        '2026-11-30T23:59:59.000Z',
        'deposit',
        'NGN',
        'confirmed',
        51,
      ])
    })

    it('matches the actor against user id or email with a partial pattern', async () => {
      await request(app).get('/api/admin/transaction-ledger?actor=ada').set(authed(ADMIN_TOKEN)).expect(200)

      const [sql, params] = ledgerCall()
      expect(sql).toContain('tl.user_id::text ILIKE $1 OR u.email ILIKE $2')
      expect(params).toEqual(['%ada%', '%ada%', 51])
      expect(placeholdersMatchParams(sql, params)).toBe(true)
    })

    it('converts amount bounds to strings and keeps placeholders aligned', async () => {
      await request(app)
        .get('/api/admin/transaction-ledger?amountMin=100&amountMax=900')
        .set(authed(ADMIN_TOKEN))
        .expect(200)

      const [sql, params] = ledgerCall()
      expect(sql).toContain('tl.amount_minor >= $1')
      expect(sql).toContain('tl.amount_minor <= $2')
      expect(params).toEqual(['100', '900', 51])
      expect(placeholdersMatchParams(sql, params)).toBe(true)
    })

    // Known defect: buildWhereClause advances the placeholder index three times in the actor
    // branch but pushes only two parameters. Any amount filter after actor then refers to the
    // wrong placeholder, so the query binds the wrong values or fails.
    it.fails('keeps placeholders aligned when actor and an amount bound are combined', async () => {
      await request(app)
        .get('/api/admin/transaction-ledger?actor=ada&amountMin=100')
        .set(authed(ADMIN_TOKEN))
        .expect(200)

      const [sql, params] = ledgerCall()
      expect(placeholdersMatchParams(sql, params)).toBe(true)
    })

    it('orders by the requested column and direction', async () => {
      await request(app)
        .get('/api/admin/transaction-ledger?sortBy=amount&sortDir=asc')
        .set(authed(ADMIN_TOKEN))
        .expect(200)

      const [sql] = ledgerCall()
      expect(sql).toContain('ORDER BY tl.amount_minor ASC, tl.id ASC')
    })

    it('returns 500 with the error envelope when the query fails', async () => {
      ledgerError = new Error('relation does not exist')

      const res = await request(app).get('/api/admin/transaction-ledger').set(authed(ADMIN_TOKEN)).expect(500)

      expect(res.body.error.code).toBe('INTERNAL_ERROR')
    })
  })

  describe('GET /api/admin/transaction-ledger/export', () => {
    it('returns the header row only when nothing matches', async () => {
      const res = await request(app).get('/api/admin/transaction-ledger/export').set(authed(ADMIN_TOKEN)).expect(200)

      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8')
      expect(res.text).toBe(
        'id,tx_type,internal_ref,external_ref,amount_minor,currency,status,actor_email,created_at\n',
      )
    })

    it('writes the header, quotes every value, doubles embedded quotes and blanks nulls', async () => {
      ledgerRows = [
        ledgerRow({
          id: 'tl-1',
          internal_ref: 'ref "quoted", x',
          external_ref: null,
          created_at: '2026-11-02T10:00:00.000Z',
        }),
      ]

      const res = await request(app).get('/api/admin/transaction-ledger/export').set(authed(ADMIN_TOKEN)).expect(200)

      expect(res.text).toBe(
        'id,tx_type,internal_ref,external_ref,amount_minor,currency,status,actor_email,created_at\n' +
          '"tl-1","deposit","ref ""quoted"", x","","100","NGN","confirmed","ada@example.com","2026-11-02T10:00:00.000Z"\n',
      )
    })

    it('serves the file as an attachment named by the export date', async () => {
      const res = await request(app).get('/api/admin/transaction-ledger/export').set(authed(ADMIN_TOKEN)).expect(200)

      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="transaction-ledger-\d{4}-\d{2}-\d{2}\.csv"$/,
      )
    })

    it('caps the export at 100,000 rows and ignores a caller-supplied limit', async () => {
      await request(app).get('/api/admin/transaction-ledger/export?limit=5').set(authed(ADMIN_TOKEN)).expect(200)

      const [, params] = ledgerCall()
      // The export fetches limit + 1 = 100,001 rows so it can detect truncation.
      expect(params[params.length - 1]).toBe(100_001)
    })

    it('applies the same filters as the list route', async () => {
      await request(app)
        .get('/api/admin/transaction-ledger/export?currency=USDC&status=failed')
        .set(authed(ADMIN_TOKEN))
        .expect(200)

      const [sql, params] = ledgerCall()
      expect(sql).toContain('tl.currency = $1')
      expect(sql).toContain('tl.status = $2')
      expect(params).toEqual(['USDC', 'failed', 100_001])
    })

    it('returns 400 for an invalid date filter', async () => {
      const res = await request(app)
        .get('/api/admin/transaction-ledger/export?dateTo=nope')
        .set(authed(ADMIN_TOKEN))
        .expect(400)

      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })
  })
})
