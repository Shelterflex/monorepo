import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { sessionStore, userStore } from '../models/authStore.js'
import { ngnDepositStore } from '../models/ngnDepositStore.js'
import { depositStore } from '../models/depositStore.js'
import { conversionStore } from '../models/conversionStore.js'
import { userRiskStateStore } from '../models/userRiskStateStore.js'
import { outboxStore } from '../outbox/store.js'
import { OutboxStatus, TxType } from '../outbox/types.js'
import { NgnWalletService } from '../services/ngnWalletService.js'
import { RATE_LIMIT_BYPASS_TOKEN } from '../test-helpers.js'

// Stores fall back to in-memory state when getPool() returns null. Stubbing it
// here guarantees these tests never reach a real database.
vi.mock('../db.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db.js')>()),
  getPool: vi.fn(async () => null),
}))

const ADMIN_TOKEN = 'test-token-recon-admin'
const TENANT_TOKEN = 'test-token-recon-tenant'

function authed(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'x-ratelimit-bypass': RATE_LIMIT_BYPASS_TOKEN }
}

const ROUTES = ['/api/admin/reconciliation/deposits', '/api/admin/reconciliation/wallets',
  '/api/admin/reconciliation/conversions', '/api/admin/reconciliation/outbox']

describe('Admin reconciliation routes', () => {
  let app: any

  beforeAll(() => {
    vi.stubEnv('DATABASE_URL', '')
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  beforeEach(async () => {
    await ngnDepositStore.clear()
    await depositStore.clear()
    await conversionStore.clear()
    await outboxStore.clear()
    sessionStore.clear()

    const admin = await userStore.getOrCreateByEmail('recon-admin@example.com')
    admin.role = 'admin'
    const tenant = await userStore.getOrCreateByEmail('recon-tenant@example.com')
    await sessionStore.create(admin.email, ADMIN_TOKEN)
    await sessionStore.create(tenant.email, TENANT_TOKEN)

    app = createApp()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('authentication and authorization', () => {
    it('rejects unauthenticated requests with 401 on every reconciliation route', async () => {
      for (const url of ROUTES) {
        const res = await request(app).get(url)
        expect(res.status, url).toBe(401)
        expect(res.body.error.code).toBe('UNAUTHORIZED')
      }
    })

    it('rejects a tenant token with 403 on every reconciliation route', async () => {
      for (const url of ROUTES) {
        const res = await request(app).get(url).set(authed(TENANT_TOKEN))
        expect(res.status, url).toBe(403)
        expect(res.body.error.code).toBe('FORBIDDEN')
      }
    })
  })

  describe('input validation', () => {
    it('returns 400 with the error envelope for invalid query parameters', async () => {
      const badQueries = [
        '/api/admin/reconciliation/deposits?status=paid',
        '/api/admin/reconciliation/deposits?limit=0',
        '/api/admin/reconciliation/conversions?status=paid',
        '/api/admin/reconciliation/outbox?status=unknown',
        '/api/admin/reconciliation/wallets?limit=5000',
      ]

      for (const url of badQueries) {
        const res = await request(app).get(url).set(authed(ADMIN_TOKEN))
        expect(res.status, url).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
        expect(res.body.error.message).toBe('Invalid request data')
        expect(typeof res.body.error.details).toBe('object')
      }
    })
  })

  describe('GET /api/admin/reconciliation/deposits', () => {
    it('merges NGN wallet and staking deposits into one list in the documented shape', async () => {
      const ngn = await ngnDepositStore.create({ userId: 'user-recon-1', amountNgn: 5000, rail: 'paystack' })
      const staking = await depositStore.create({
        quoteId: 'quote-recon-1',
        userId: 'user-recon-2',
        paymentRail: 'paystack',
        amountNgn: 7000,
      })

      const res = await request(app).get('/api/admin/reconciliation/deposits').set(authed(ADMIN_TOKEN)).expect(200)

      expect(res.body.nextCursor).toBeNull()
      expect(res.body.items).toHaveLength(2)
      expect(res.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            depositId: ngn.depositId,
            userId: 'user-recon-1',
            amountNgn: 5000,
            rail: 'paystack',
            status: 'pending',
            hasExternalRef: false,
            flow: 'ngn_wallet',
          }),
          expect.objectContaining({
            depositId: staking.depositId,
            userId: 'user-recon-2',
            amountNgn: 7000,
            status: 'pending',
            flow: 'staking',
          }),
        ]),
      )
    })

    it('returns a nextCursor when the page is full so the caller can continue', async () => {
      await ngnDepositStore.create({ userId: 'user-page-1', amountNgn: 100, rail: 'paystack' })
      await depositStore.create({ quoteId: 'quote-page-1', userId: 'user-page-2', paymentRail: 'paystack', amountNgn: 200 })

      const res = await request(app)
        .get('/api/admin/reconciliation/deposits?limit=1')
        .set(authed(ADMIN_TOKEN))
        .expect(200)

      expect(res.body.items).toHaveLength(1)
      expect(res.body.nextCursor).toBe(res.body.items[0].createdAt)
    })

    it('filters by status', async () => {
      await ngnDepositStore.create({ userId: 'user-status-1', amountNgn: 100, rail: 'paystack' })

      const res = await request(app)
        .get('/api/admin/reconciliation/deposits?status=confirmed')
        .set(authed(ADMIN_TOKEN))
        .expect(200)

      expect(res.body).toEqual({ items: [], nextCursor: null })
    })
  })

  describe('GET /api/admin/reconciliation/wallets', () => {
    const negativeWallet = {
      items: [
        {
          userId: 'user-negative-1',
          balance: { availableNgn: -1500, heldNgn: 0, totalNgn: -1500 },
        },
      ],
      nextCursor: 'cursor-next',
    }

    it('lists negative balances by default and reports frozen state from the risk store', async () => {
      await userRiskStateStore.create({
        userId: 'user-negative-1',
        isFrozen: true,
        freezeReason: 'NEGATIVE_BALANCE',
      })
      const spy = vi
        .spyOn(NgnWalletService.prototype, 'listNegativeBalances')
        .mockResolvedValue(negativeWallet as any)

      const res = await request(app).get('/api/admin/reconciliation/wallets').set(authed(ADMIN_TOKEN)).expect(200)

      expect(spy).toHaveBeenCalledWith({ limit: 50, cursor: undefined, includeNonNegative: false })
      expect(res.body).toEqual({
        items: [
          {
            userId: 'user-negative-1',
            availableNgn: -1500,
            heldNgn: 0,
            totalNgn: -1500,
            isFrozen: true,
          },
        ],
        nextCursor: 'cursor-next',
      })
    })

    it('passes limit and cursor through to the wallet service', async () => {
      const spy = vi
        .spyOn(NgnWalletService.prototype, 'listNegativeBalances')
        .mockResolvedValue({ items: [], nextCursor: null } as any)

      await request(app)
        .get('/api/admin/reconciliation/wallets?limit=5&cursor=user-abc')
        .set(authed(ADMIN_TOKEN))
        .expect(200)

      expect(spy).toHaveBeenCalledWith({ limit: 5, cursor: 'user-abc', includeNonNegative: false })
    })

    // Known defect: walletsQuerySchema uses z.coerce.boolean(), and Boolean('false') is true.
    // So ?negative=false is read as negative=true and non-negative balances are never listed.
    it.fails('includes non-negative balances when negative=false is requested', async () => {
      const spy = vi
        .spyOn(NgnWalletService.prototype, 'listNegativeBalances')
        .mockResolvedValue({ items: [], nextCursor: null } as any)

      await request(app)
        .get('/api/admin/reconciliation/wallets?negative=false')
        .set(authed(ADMIN_TOKEN))
        .expect(200)

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ includeNonNegative: true }))
    })
  })

  describe('GET /api/admin/reconciliation/conversions', () => {
    it('returns pending conversions with the documented fields', async () => {
      const record = await conversionStore.createPending({
        depositId: 'dep-conv-1',
        userId: 'user-conv-1',
        amountNgn: 12000,
        provider: 'onramp',
      })

      const res = await request(app).get('/api/admin/reconciliation/conversions').set(authed(ADMIN_TOKEN)).expect(200)

      expect(res.body.nextCursor).toBeNull()
      expect(res.body.items).toEqual([
        {
          conversionId: record.conversionId,
          depositId: 'dep-conv-1',
          userId: 'user-conv-1',
          amountNgn: 12000,
          amountUsdc: '0',
          fxRateNgnPerUsdc: 0,
          provider: 'onramp',
          status: 'pending',
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
          failedAt: null,
          completedAt: null,
          failureReason: null,
        },
      ])
    })

    it('filters by status', async () => {
      await conversionStore.createPending({ depositId: 'dep-conv-2', userId: 'user-conv-2', amountNgn: 900, provider: 'onramp' })

      const res = await request(app)
        .get('/api/admin/reconciliation/conversions?status=completed')
        .set(authed(ADMIN_TOKEN))
        .expect(200)

      expect(res.body.items).toEqual([])
    })
  })

  describe('GET /api/admin/reconciliation/outbox', () => {
    it('returns outbox items newest first with the documented fields', async () => {
      const older = await outboxStore.create({ txType: TxType.STAKE, source: 'recon-test', ref: 'ref-older', payload: {} })
      const newer = await outboxStore.create({ txType: TxType.CONVERSION, source: 'recon-test', ref: 'ref-newer', payload: {} })
      older.createdAt = new Date('2026-11-01T00:00:00.000Z')
      newer.createdAt = new Date('2026-11-03T00:00:00.000Z')

      const res = await request(app).get('/api/admin/reconciliation/outbox').set(authed(ADMIN_TOKEN)).expect(200)

      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([newer.id, older.id])
      expect(res.body.items[0]).toMatchObject({
        id: newer.id,
        txType: 'conversion',
        txId: newer.txId,
        status: OutboxStatus.PENDING,
        attempts: 0,
        createdAt: '2026-11-03T00:00:00.000Z',
      })
      expect(typeof res.body.items[0].externalRef).toBe('string')
      expect(res.body.items[0].externalRef.length).toBeGreaterThan(0)
    })

    it('applies the cursor as an exclusive upper bound on createdAt', async () => {
      const older = await outboxStore.create({ txType: TxType.STAKE, source: 'recon-test', ref: 'ref-cursor-old', payload: {} })
      const newer = await outboxStore.create({ txType: TxType.STAKE, source: 'recon-test', ref: 'ref-cursor-new', payload: {} })
      older.createdAt = new Date('2026-11-01T00:00:00.000Z')
      newer.createdAt = new Date('2026-11-03T00:00:00.000Z')

      const res = await request(app)
        .get('/api/admin/reconciliation/outbox?cursor=2026-11-02T00:00:00.000Z')
        .set(authed(ADMIN_TOKEN))
        .expect(200)

      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([older.id])
    })

    it('filters by status and returns a nextCursor when the page is full', async () => {
      const first = await outboxStore.create({ txType: TxType.STAKE, source: 'recon-test', ref: 'ref-dead-1', payload: {} })
      await outboxStore.create({ txType: TxType.STAKE, source: 'recon-test', ref: 'ref-dead-2', payload: {} })
      await outboxStore.markDead(first.id, 'rpc timeout')

      const dead = await request(app)
        .get('/api/admin/reconciliation/outbox?status=dead')
        .set(authed(ADMIN_TOKEN))
        .expect(200)
      expect(dead.body.items.map((i: { id: string }) => i.id)).toEqual([first.id])
      expect(dead.body.items[0].status).toBe(OutboxStatus.DEAD)
      expect(dead.body.items[0].lastError).toBe('rpc timeout')

      const page = await request(app)
        .get('/api/admin/reconciliation/outbox?limit=1')
        .set(authed(ADMIN_TOKEN))
        .expect(200)
      expect(page.body.items).toHaveLength(1)
      expect(page.body.nextCursor).toBe(page.body.items[0].createdAt)
    })
  })
})
