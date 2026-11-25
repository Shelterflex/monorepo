import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { sessionStore, userStore } from '../models/authStore.js'
import {
  listMismatches,
  getMismatchAgingReport,
  updateMismatchStatus,
  ingestLedgerEvent,
  ingestProviderEvent,
} from '../reconciliation/store.js'
import { runReconciliationPass } from '../reconciliation/engine.js'
import { runResolutionPass } from '../reconciliation/resolver.js'
import { auditLog } from '../utils/auditLogger.js'
import { RATE_LIMIT_BYPASS_TOKEN } from '../test-helpers.js'

// The reconciliation store, engine and resolver all talk to Postgres. They are
// replaced with stubs here so the routes can be exercised without a database.
vi.mock('../db.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db.js')>()),
  getPool: vi.fn(async () => null),
}))

vi.mock('../reconciliation/store.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../reconciliation/store.js')>()),
  listMismatches: vi.fn(),
  getMismatchAgingReport: vi.fn(),
  updateMismatchStatus: vi.fn(),
  ingestLedgerEvent: vi.fn(),
  ingestProviderEvent: vi.fn(),
}))

vi.mock('../reconciliation/engine.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../reconciliation/engine.js')>()),
  runReconciliationPass: vi.fn(),
}))

vi.mock('../reconciliation/resolver.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../reconciliation/resolver.js')>()),
  runResolutionPass: vi.fn(),
}))

vi.mock('../utils/auditLogger.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/auditLogger.js')>()),
  auditLog: vi.fn(),
}))

const ADMIN_TOKEN = 'test-token-ledger-recon-admin'
const TENANT_TOKEN = 'test-token-ledger-recon-tenant'
const BASE = '/api/admin/ledger-reconciliation'

function authed(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'x-ratelimit-bypass': RATE_LIMIT_BYPASS_TOKEN }
}

const validLedgerEvent = {
  eventType: 'credit',
  amountMinor: 5000,
  currency: 'NGN',
  internalRef: 'int-ref-1',
  rail: 'paystack',
  userId: 'user-ledger-1',
  occurredAt: '2026-11-02T10:00:00.000Z',
}

const validProviderEvent = {
  provider: 'paystack',
  providerEventId: 'evt_1',
  eventType: 'credit',
  amountMinor: 5000,
  currency: 'NGN',
  internalRef: 'int-ref-1',
  rawStatus: 'success',
  occurredAt: '2026-11-02T10:00:00.000Z',
}

describe('Admin ledger reconciliation routes', () => {
  let app: any
  let adminId: string

  beforeAll(() => {
    vi.stubEnv('DATABASE_URL', '')
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  beforeEach(async () => {
    vi.mocked(listMismatches).mockReset().mockResolvedValue([])
    vi.mocked(getMismatchAgingReport).mockReset().mockResolvedValue({} as any)
    vi.mocked(updateMismatchStatus).mockReset().mockResolvedValue(undefined as any)
    vi.mocked(ingestLedgerEvent).mockReset()
    vi.mocked(ingestProviderEvent).mockReset()
    vi.mocked(runReconciliationPass).mockReset().mockResolvedValue({ checked: 0 } as any)
    vi.mocked(runResolutionPass).mockReset().mockResolvedValue({ resolved: 0, escalated: 0 })
    vi.mocked(auditLog).mockReset()

    sessionStore.clear()
    const admin = await userStore.getOrCreateByEmail('ledger-recon-admin@example.com')
    admin.role = 'admin'
    adminId = admin.id
    const tenant = await userStore.getOrCreateByEmail('ledger-recon-tenant@example.com')
    await sessionStore.create(admin.email, ADMIN_TOKEN)
    await sessionStore.create(tenant.email, TENANT_TOKEN)

    app = createApp()
  })

  describe('authentication and authorization', () => {
    const endpoints: Array<[string, string]> = [
      ['get', `${BASE}/mismatches`],
      ['get', `${BASE}/aging`],
      ['post', `${BASE}/mismatches/mm-1/close`],
      ['post', `${BASE}/run`],
      ['post', `${BASE}/ledger-events`],
      ['post', `${BASE}/provider-events`],
    ]

    it('rejects unauthenticated requests with 401 on every route', async () => {
      for (const [method, url] of endpoints) {
        const res = await (request(app) as any)[method](url)
        expect(res.status, `${method.toUpperCase()} ${url}`).toBe(401)
        expect(res.body.error.code).toBe('UNAUTHORIZED')
      }
    })

    it('rejects a tenant token with 403 on every route', async () => {
      for (const [method, url] of endpoints) {
        const res = await (request(app) as any)[method](url).set(authed(TENANT_TOKEN))
        expect(res.status, `${method.toUpperCase()} ${url}`).toBe(403)
        expect(res.body.error.code).toBe('FORBIDDEN')
      }
    })
  })

  describe('GET /api/admin/ledger-reconciliation/mismatches', () => {
    it('returns 400 for invalid filters or cursor', async () => {
      const badQueries = [
        `${BASE}/mismatches?status=bogus`,
        `${BASE}/mismatches?mismatch_class=bogus`,
        `${BASE}/mismatches?limit=501`,
        `${BASE}/mismatches?cursor=not-a-date`,
      ]

      for (const url of badQueries) {
        const res = await request(app).get(url).set(authed(ADMIN_TOKEN))
        expect(res.status, url).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
        expect(listMismatches).not.toHaveBeenCalled()
      }
    })

    it('applies defaults when no filters are given', async () => {
      await request(app).get(`${BASE}/mismatches`).set(authed(ADMIN_TOKEN)).expect(200)

      expect(listMismatches).toHaveBeenCalledWith({
        status: undefined,
        mismatchClass: undefined,
        limit: 50,
        cursorCreatedAt: undefined,
      })
    })

    it('maps query filters to the store arguments and returns the list with a count', async () => {
      const row = { id: 'mm-1', mismatchClass: 'missing_credit', status: 'open' }
      vi.mocked(listMismatches).mockResolvedValue([row] as any)

      const res = await request(app)
        .get(`${BASE}/mismatches?status=open&mismatch_class=missing_credit&limit=10&cursor=2026-11-02T00:00:00.000Z`)
        .set(authed(ADMIN_TOKEN))
        .expect(200)

      expect(listMismatches).toHaveBeenCalledWith({
        status: 'open',
        mismatchClass: 'missing_credit',
        limit: 10,
        cursorCreatedAt: new Date('2026-11-02T00:00:00.000Z'),
      })
      expect(res.body).toEqual({ data: [row], count: 1 })
    })
  })

  describe('GET /api/admin/ledger-reconciliation/aging', () => {
    it('wraps the aging report in data', async () => {
      const report = { missing_credit: { open: 2, escalated: 0 } }
      vi.mocked(getMismatchAgingReport).mockResolvedValue(report as any)

      const res = await request(app).get(`${BASE}/aging`).set(authed(ADMIN_TOKEN)).expect(200)

      expect(res.body).toEqual({ data: report })
    })

    it('returns 500 with the error envelope when the store fails', async () => {
      vi.mocked(getMismatchAgingReport).mockRejectedValueOnce(new Error('store unavailable'))

      const res = await request(app).get(`${BASE}/aging`).set(authed(ADMIN_TOKEN)).expect(500)

      expect(res.body.error.code).toBe('INTERNAL_ERROR')
    })
  })

  describe('POST /api/admin/ledger-reconciliation/mismatches/:id/close', () => {
    it('closes the mismatch as a manual close and reports ok', async () => {
      const res = await request(app)
        .post(`${BASE}/mismatches/mm-1/close`)
        .set(authed(ADMIN_TOKEN))
        .expect(200)

      expect(res.body).toEqual({ ok: true })
      expect(updateMismatchStatus).toHaveBeenCalledWith('mm-1', 'closed', {
        resolutionWorkflow: 'manual_close',
        lastResolutionAt: expect.any(Date),
      })
    })

    it('records an ADMIN_OPERATION audit entry naming the acting admin', async () => {
      await request(app).post(`${BASE}/mismatches/mm-1/close`).set(authed(ADMIN_TOKEN)).expect(200)

      await vi.waitFor(() =>
        expect(auditLog).toHaveBeenCalledWith(
          'ADMIN_OPERATION',
          expect.anything(),
          expect.objectContaining({
            resource: 'reconciliation',
            action: 'manage',
            method: 'POST',
            path: `${BASE}/mismatches/mm-1/close`,
            adminId,
            authVia: 'jwt',
            statusCode: 200,
          }),
        ),
      )
    })

    it('returns 500 and writes no audit entry when the update fails', async () => {
      vi.mocked(updateMismatchStatus).mockRejectedValueOnce(new Error('write failed'))

      const res = await request(app)
        .post(`${BASE}/mismatches/mm-1/close`)
        .set(authed(ADMIN_TOKEN))
        .expect(500)

      expect(res.body.error.code).toBe('INTERNAL_ERROR')
      expect(auditLog).not.toHaveBeenCalled()
    })
  })

  describe('POST /api/admin/ledger-reconciliation/run', () => {
    it('runs a reconciliation pass and a resolution pass and returns both results', async () => {
      vi.mocked(runReconciliationPass).mockResolvedValue({ checked: 3 } as any)
      vi.mocked(runResolutionPass).mockResolvedValue({ resolved: 1, escalated: 2 })

      const res = await request(app).post(`${BASE}/run`).set(authed(ADMIN_TOKEN)).expect(200)

      expect(res.body).toEqual({
        reconciliation: { checked: 3 },
        resolution: { resolved: 1, escalated: 2 },
      })
      expect(runReconciliationPass).toHaveBeenCalledTimes(1)
      expect(runResolutionPass).toHaveBeenCalledTimes(1)
    })

    it('returns 500 when the resolution pass fails', async () => {
      vi.mocked(runResolutionPass).mockRejectedValueOnce(new Error('resolver crashed'))

      const res = await request(app).post(`${BASE}/run`).set(authed(ADMIN_TOKEN)).expect(500)

      expect(res.body.error.code).toBe('INTERNAL_ERROR')
    })
  })

  describe('POST /api/admin/ledger-reconciliation/ledger-events', () => {
    it('returns 400 for an invalid payload and does not ingest', async () => {
      const invalid = [
        { ...validLedgerEvent, eventType: 'refund' },
        { ...validLedgerEvent, amountMinor: 0 },
        { ...validLedgerEvent, amountMinor: 12.5 },
        { ...validLedgerEvent, internalRef: '' },
        { ...validLedgerEvent, occurredAt: 'yesterday' },
      ]

      for (const body of invalid) {
        const res = await request(app).post(`${BASE}/ledger-events`).set(authed(ADMIN_TOKEN)).send(body)
        expect(res.status, JSON.stringify(body)).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
      }
      expect(ingestLedgerEvent).not.toHaveBeenCalled()
    })

    it('ingests the event with a BigInt amount and returns it as a string', async () => {
      vi.mocked(ingestLedgerEvent).mockResolvedValue({
        id: 'le-1',
        eventType: 'credit',
        amountMinor: 5000n,
        internalRef: 'int-ref-1',
      } as any)

      const res = await request(app)
        .post(`${BASE}/ledger-events`)
        .set(authed(ADMIN_TOKEN))
        .send(validLedgerEvent)
        .expect(201)

      expect(ingestLedgerEvent).toHaveBeenCalledWith({
        eventType: 'credit',
        amountMinor: 5000n,
        currency: 'NGN',
        internalRef: 'int-ref-1',
        rail: 'paystack',
        userId: 'user-ledger-1',
        occurredAt: new Date('2026-11-02T10:00:00.000Z'),
      })
      expect(res.body.data).toEqual({ id: 'le-1', eventType: 'credit', amountMinor: '5000', internalRef: 'int-ref-1' })
    })

    it('returns 500 when ingestion fails', async () => {
      vi.mocked(ingestLedgerEvent).mockRejectedValueOnce(new Error('insert failed'))

      const res = await request(app)
        .post(`${BASE}/ledger-events`)
        .set(authed(ADMIN_TOKEN))
        .send(validLedgerEvent)
        .expect(500)

      expect(res.body.error.code).toBe('INTERNAL_ERROR')
    })
  })

  describe('POST /api/admin/ledger-reconciliation/provider-events', () => {
    it('returns 400 when the payload is invalid and does not ingest', async () => {
      const res = await request(app)
        .post(`${BASE}/provider-events`)
        .set(authed(ADMIN_TOKEN))
        .send({ ...validProviderEvent, rawStatus: '' })
        .expect(400)

      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(ingestProviderEvent).not.toHaveBeenCalled()
    })

    it('ingests the provider event with a BigInt amount and returns 201', async () => {
      vi.mocked(ingestProviderEvent).mockResolvedValue({
        id: 'pe-1',
        provider: 'paystack',
        providerEventId: 'evt_1',
        amountMinor: 5000n,
      } as any)

      const res = await request(app)
        .post(`${BASE}/provider-events`)
        .set(authed(ADMIN_TOKEN))
        .send(validProviderEvent)
        .expect(201)

      expect(ingestProviderEvent).toHaveBeenCalledWith({
        provider: 'paystack',
        providerEventId: 'evt_1',
        eventType: 'credit',
        amountMinor: 5000n,
        currency: 'NGN',
        internalRef: 'int-ref-1',
        rawStatus: 'success',
        occurredAt: new Date('2026-11-02T10:00:00.000Z'),
      })
      expect(res.body.data).toEqual({ id: 'pe-1', provider: 'paystack', providerEventId: 'evt_1', amountMinor: '5000' })
    })
  })
})
