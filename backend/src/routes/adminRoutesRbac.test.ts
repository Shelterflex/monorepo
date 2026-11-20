import { beforeEach, describe, expect, it, vi } from 'vitest'
import express, { type Router } from 'express'
import request from 'supertest'
import { errorHandler } from '../middleware/errorHandler.js'
import { requestIdMiddleware } from '../middleware/requestId.js'
import { seedAdminSession, adminAuthHeader } from '../test-fixtures/adminAuth.js'
import { NgnWalletService } from '../services/ngnWalletService.js'
import { createAdminRouter } from './admin.js'
import { createAdminContractAccessRouter } from './adminContractAccess.js'
import { createCircuitBreakerRouter } from './circuitBreaker.js'
import { createAdminTimelockRouter } from './admin-timelock.js'
import { createAdminReconciliationRouter } from './adminReconciliation.js'
import { createLedgerReconciliationRouter } from './ledgerReconciliation.js'
import { createAdminTransactionLedgerRouter } from './adminTransactionLedger.js'
import { createSettlementAdminRouter } from './settlementAdmin.js'
import { createAdminFraudRouter } from './adminFraud.js'
import { createAdminWhistleblowerApplicationsRouter } from './adminWhistleblowerApplications.js'
import { createAdminJobsRouter } from './adminJobs.js'
import { slidingWindowLimiter } from '../services/SlidingWindowLimiter.js'
import { userStore, sessionStore, otpChallengeStore, walletChallengeStore, refreshTokenStore } from '../models/authStore.js'

vi.mock('../utils/auditLogger.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/auditLogger.js')>()),
  auditLog: vi.fn().mockResolvedValue(undefined),
}))

interface RouteInfo {
  method: string
  path: string
}

/** Every method + path registered on a router (one level of nesting is enough for these routers). */
function routesOf(router: Router): RouteInfo[] {
  const out: RouteInfo[] = []
  for (const layer of (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }).stack) {
    if (!layer.route) continue
    for (const method of Object.keys(layer.route.methods)) out.push({ method, path: layer.route.path })
  }
  return out
}

const concrete = (path: string) => path.replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000000')

const routers: Array<[string, string, () => Router]> = [
  ['admin (chain_admin)', '/a', () => createAdminRouter({} as never)],
  ['contract-access', '/b', () => createAdminContractAccessRouter({} as never)],
  ['circuit-breaker', '/c', () => createCircuitBreakerRouter({} as never)],
  ['timelock', '/d', () => createAdminTimelockRouter({} as never, {} as never)],
  ['reconciliation', '/e', () => createAdminReconciliationRouter(new NgnWalletService())],
  ['ledger-reconciliation', '/f', () => createLedgerReconciliationRouter()],
  ['transaction-ledger', '/g', () => createAdminTransactionLedgerRouter()],
  ['settlement', '/h', () => createSettlementAdminRouter()],
  ['fraud', '/i', () => createAdminFraudRouter()],
  ['whistleblower-applications', '/j', () => createAdminWhistleblowerApplicationsRouter()],
  ['jobs', '/k', () => createAdminJobsRouter()],
]

describe('admin routes need an identified admin with the permission (#1937, #1938, #1939)', { timeout: 30_000 }, () => {
  let app: express.Express
  let tenantHeader: { Authorization: string }

  beforeEach(async () => {
    delete process.env.ALLOW_LEGACY_ADMIN_SECRET
    await seedAdminSession()
    const tenant = await seedAdminSession({ email: 'rbac-tenant@example.com', token: 'rbac-tenant-token', role: 'tenant' })
    tenantHeader = tenant.header

    // Clear rate limiter memory store between tests to prevent flakiness
    slidingWindowLimiter.memoryStore.clear()

    app = express()
    app.use(requestIdMiddleware)
    app.use(express.json())
    for (const [, prefix, make] of routers) app.use(prefix, make())
    app.use(errorHandler)
  })

  for (const [name, prefix, make] of routers) {
    const routes = routesOf(make())

    it(`${name}: registers routes`, () => {
      expect(routes.length).toBeGreaterThan(0)
    })

    for (const { method, path } of routes) {
      const url = `${prefix}${concrete(path)}`
      const label = `${method.toUpperCase()} ${prefix}${path}`

      it(`${label} rejects no token (401), a non-admin (403) and the shared secret (401); an admin passes the guard`, async () => {
        const call = (h?: Record<string, string>) => {
          const r = (request(app) as unknown as Record<string, (u: string) => request.Test>)[method](url)
          return h ? r.set(h) : r
        }

        expect((await call()).status).toBe(401)
        expect((await call(tenantHeader)).status).toBe(403)
        expect((await call({ 'x-admin-secret': 'anything' })).status).toBe(401)

        const asAdmin = await call(adminAuthHeader)
        expect([401, 403]).not.toContain(asAdmin.status)
      })
    }
  }
})
