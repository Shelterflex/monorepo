import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { sessionStore, userStore } from '../models/authStore.js'
import { tenantApplicationStore } from '../models/tenantApplicationStore.js'
import { tenantOnboardingDataStore } from '../models/tenantOnboardingDataStore.js'
import { tenantCreditScoringService } from '../services/tenantCreditScoringService.js'
import { underwritingService } from '../services/underwritingService.js'
import { RATE_LIMIT_BYPASS_TOKEN } from '../test-helpers.js'

// The application and onboarding stores are in-memory here. getPool() is stubbed to
// null so nothing can reach a real database.
vi.mock('../db.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db.js')>()),
  getPool: vi.fn(async () => null),
}))

const TENANT_TOKEN = 'test-token-tenant-onboarding'
const OTHER_TOKEN = 'test-token-tenant-onboarding-other'

function authed(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'x-ratelimit-bypass': RATE_LIMIT_BYPASS_TOKEN }
}

function submission(applicationId: string, overrides: Record<string, unknown> = {}) {
  return {
    applicationId,
    statedMonthlyIncome: 450000,
    monthlyRent: 180000,
    employmentStatus: 'employed',
    employerName: 'Acme Ltd',
    employmentProofText: 'Offer letter attached',
    bankStatementLines: [{ date: '2026-10-01', description: 'Salary credit', amount: 450000 }],
    mobileMoneyTransactions: [{ date: '2026-10-02', amount: 5000, type: 'debit' }],
    ...overrides,
  }
}

async function createApplication(ownerId: string, propertyId: number) {
  return tenantApplicationStore.create({
    userId: ownerId,
    propertyId,
    annualRent: 1200000,
    deposit: 240000,
    duration: 12,
    hasAgreedToTerms: true,
  })
}

describe('Tenant onboarding submit route', () => {
  let app: any
  let tenantId: string

  beforeAll(() => {
    vi.stubEnv('DATABASE_URL', '')
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  beforeEach(async () => {
    sessionStore.clear()
    const tenant = await userStore.getOrCreateByEmail('tenant-onboarding@example.com')
    const other = await userStore.getOrCreateByEmail('tenant-onboarding-other@example.com')
    tenantId = tenant.id
    await sessionStore.create(tenant.email, TENANT_TOKEN)
    await sessionStore.create(other.email, OTHER_TOKEN)

    vi.spyOn(tenantCreditScoringService, 'computeCompositeScore').mockReturnValue({
      id: 'score-1',
      tenantId: tenant.id,
      score: 712,
      band: 'B',
      incomeScore: 80,
      employmentScore: 75,
      bankStatementScore: 70,
      alternativeDataScore: 60,
      computedAt: new Date('2026-11-20T09:00:00.000Z'),
      version: 3,
    } as any)
    vi.spyOn(underwritingService, 'evaluateApplication').mockResolvedValue({
      decision: 'approve',
      creditBandDecision: 'band_b',
    } as any)

    app = createApp()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('authentication', () => {
    it('rejects an unauthenticated submission with 401', async () => {
      const res = await request(app).post('/api/tenant/onboarding/submit').send({})

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('UNAUTHORIZED')
    })
  })

  describe('input validation', () => {
    it('returns 400 when applicationId is missing and runs no scoring', async () => {
      const body: Record<string, unknown> = submission('unused')
      delete body.applicationId

      const res = await request(app)
        .post('/api/tenant/onboarding/submit')
        .set(authed(TENANT_TOKEN))
        .send(body)
        .expect(400)

      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(tenantCreditScoringService.computeCompositeScore).not.toHaveBeenCalled()
      expect(underwritingService.evaluateApplication).not.toHaveBeenCalled()
    })

    it('returns 400 when no bank statement lines are supplied', async () => {
      const application = await createApplication(tenantId, 101)

      const res = await request(app)
        .post('/api/tenant/onboarding/submit')
        .set(authed(TENANT_TOKEN))
        .send(submission(application.applicationId, { bankStatementLines: [] }))
        .expect(400)

      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 when the stated income is not positive', async () => {
      const application = await createApplication(tenantId, 102)

      const res = await request(app)
        .post('/api/tenant/onboarding/submit')
        .set(authed(TENANT_TOKEN))
        .send(submission(application.applicationId, { statedMonthlyIncome: -5 }))
        .expect(400)

      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('ownership', () => {
    it('returns 404 for an application that does not exist', async () => {
      const res = await request(app)
        .post('/api/tenant/onboarding/submit')
        .set(authed(TENANT_TOKEN))
        .send(submission('APP-does-not-exist'))
        .expect(404)

      expect(res.body.error.code).toBe('NOT_FOUND')
      expect(res.body.error.message).toBe('Application not found')
    })

    it('returns 403 for another user\'s application and stores nothing', async () => {
      const other = await userStore.getOrCreateByEmail('tenant-onboarding-other@example.com')
      const foreign = await createApplication(other.id, 103)
      const before = tenantOnboardingDataStore.findByTenantId(tenantId)?.dataVersion

      const res = await request(app)
        .post('/api/tenant/onboarding/submit')
        .set(authed(TENANT_TOKEN))
        .send(submission(foreign.applicationId))
        .expect(403)

      expect(res.body.error.code).toBe('FORBIDDEN')
      expect(res.body.error.message).toBe('Access denied')
      expect(tenantCreditScoringService.computeCompositeScore).not.toHaveBeenCalled()
      expect(underwritingService.evaluateApplication).not.toHaveBeenCalled()
      expect(tenantOnboardingDataStore.findByTenantId(tenantId)?.dataVersion).toBe(before)
    })
  })

  describe('successful submission', () => {
    it('scores the tenant, runs underwriting and returns both results', async () => {
      const application = await createApplication(tenantId, 104)

      const res = await request(app)
        .post('/api/tenant/onboarding/submit')
        .set(authed(TENANT_TOKEN))
        .send(submission(application.applicationId))
        .expect(201)

      expect(res.body).toEqual({
        success: true,
        data: {
          creditScore: {
            id: 'score-1',
            tenantId,
            score: 712,
            band: 'B',
            incomeScore: 80,
            employmentScore: 75,
            bankStatementScore: 70,
            alternativeDataScore: 60,
            computedAt: '2026-11-20T09:00:00.000Z',
            version: 3,
          },
          underwriting: {
            decision: 'approve',
            creditBandDecision: 'band_b',
          },
        },
      })
      expect(tenantCreditScoringService.computeCompositeScore).toHaveBeenCalledWith(tenantId)
      expect(underwritingService.evaluateApplication).toHaveBeenCalledWith({
        applicationId: application.applicationId,
        metadata: { creditScoreId: 'score-1', creditBand: 'B' },
      })
    })

    it('persists the submitted onboarding data for the tenant', async () => {
      const application = await createApplication(tenantId, 105)

      await request(app)
        .post('/api/tenant/onboarding/submit')
        .set(authed(TENANT_TOKEN))
        .send(submission(application.applicationId))
        .expect(201)

      expect(tenantOnboardingDataStore.findByTenantId(tenantId)).toMatchObject({
        tenantId,
        statedMonthlyIncome: 450000,
        monthlyRent: 180000,
        employmentStatus: 'employed',
        employerName: 'Acme Ltd',
        employmentProofText: 'Offer letter attached',
        bankStatementLines: [{ date: '2026-10-01', description: 'Salary credit', amount: 450000 }],
        mobileMoneyTransactions: [{ date: '2026-10-02', amount: 5000, type: 'debit' }],
      })
    })

    it('increments the stored data version on each resubmission', async () => {
      const application = await createApplication(tenantId, 106)

      await request(app)
        .post('/api/tenant/onboarding/submit')
        .set(authed(TENANT_TOKEN))
        .send(submission(application.applicationId))
        .expect(201)
      const first = tenantOnboardingDataStore.findByTenantId(tenantId)!.dataVersion

      await request(app)
        .post('/api/tenant/onboarding/submit')
        .set(authed(TENANT_TOKEN))
        .send(submission(application.applicationId, { statedMonthlyIncome: 460000 }))
        .expect(201)

      const after = tenantOnboardingDataStore.findByTenantId(tenantId)!
      expect(after.dataVersion).toBe(first + 1)
      expect(after.statedMonthlyIncome).toBe(460000)
    })

    it('returns 500 when underwriting fails', async () => {
      vi.mocked(underwritingService.evaluateApplication).mockRejectedValueOnce(new Error('rules engine down'))
      const application = await createApplication(tenantId, 107)

      const res = await request(app)
        .post('/api/tenant/onboarding/submit')
        .set(authed(TENANT_TOKEN))
        .send(submission(application.applicationId))
        .expect(500)

      expect(res.body.error.code).toBe('INTERNAL_ERROR')
    })
  })
})
