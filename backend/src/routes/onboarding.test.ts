import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { getPool } from '../db.js'
import { sessionStore, userStore } from '../models/authStore.js'
import { isEncryptedPii } from '../utils/piiEncryption.js'
import { RATE_LIMIT_BYPASS_TOKEN } from '../test-helpers.js'

const { createJob } = vi.hoisted(() => ({ createJob: vi.fn(async () => ({})) }))

// getPool() is stubbed so the draft routes run against the in-memory fake pool below.
vi.mock('../db.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db.js')>()),
  getPool: vi.fn(async () => null),
}))

vi.mock('../jobs/scheduler/store.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../jobs/scheduler/store.js')>()),
  getJobStore: vi.fn(() => ({ create: createJob })),
}))

const TENANT_TOKEN = 'test-token-onboarding-tenant'
const OTHER_TOKEN = 'test-token-onboarding-other'

function authed(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'x-ratelimit-bypass': RATE_LIMIT_BYPASS_TOKEN }
}

const personalInfo = {
  fullName: 'Ada Lovelace',
  dateOfBirth: '1990-01-02',
  phone: '+2348012345678',
  residentialAddress: '12 Marina Road, Lagos',
  nin: '12345678901',
}
const employmentInfo = { employmentStatus: 'employed', employerName: 'Acme Ltd', monthlyIncome: 450000 }
const documents = { governmentIdKey: 'kyc/id-front.pdf' }
const walletInfo = { skipped: true }

// In-memory stand-in for the onboarding_drafts table. It implements only the three
// statement shapes the routes issue, and stores JSON columns as parsed objects, as pg does.
const drafts = new Map<string, Record<string, unknown>>()

function fakePool() {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const normalized = sql.replace(/\s+/g, ' ').trim()

      if (normalized.startsWith('SELECT * FROM onboarding_drafts')) {
        const row = drafts.get(params[0] as string)
        return { rows: row ? [row] : [] }
      }

      if (normalized.startsWith('INSERT INTO onboarding_drafts')) {
        const [userId, personal, employment, docs, wallet, completedSteps, currentStep] = params as [
          string,
          string | null,
          string | null,
          string | null,
          string | null,
          string[],
          string,
        ]
        const existing = drafts.get(userId)
        const now = new Date().toISOString()
        const row: Record<string, unknown> = {
          id: existing?.id ?? `draft-${userId}`,
          user_id: userId,
          // COALESCE($n, column): a null parameter keeps the stored value.
          personal_info: personal !== null ? JSON.parse(personal) : (existing?.personal_info ?? null),
          employment_info: employment !== null ? JSON.parse(employment) : (existing?.employment_info ?? null),
          documents: docs !== null ? JSON.parse(docs) : (existing?.documents ?? null),
          wallet_info: wallet !== null ? JSON.parse(wallet) : (existing?.wallet_info ?? null),
          completed_steps: completedSteps,
          current_step: currentStep,
          submitted: existing?.submitted ?? false,
          submitted_at: existing?.submitted_at ?? null,
          created_at: existing?.created_at ?? now,
          updated_at: now,
        }
        drafts.set(userId, row)
        return { rows: [row] }
      }

      if (normalized.startsWith('UPDATE onboarding_drafts')) {
        const row = drafts.get(params[0] as string)
        if (row) {
          row.submitted = true
          row.submitted_at = new Date().toISOString()
        }
        return { rows: [] }
      }

      throw new Error(`fake pool: unexpected query: ${normalized}`)
    }),
  }
}

describe('Onboarding draft and submit routes', () => {
  let app: any
  let userId: string

  beforeAll(() => {
    vi.stubEnv('DATABASE_URL', '')
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  beforeEach(async () => {
    drafts.clear()
    createJob.mockClear()
    vi.mocked(getPool).mockResolvedValue(fakePool() as any)

    sessionStore.clear()
    const tenant = await userStore.getOrCreateByEmail('onboarding-tenant@example.com')
    const other = await userStore.getOrCreateByEmail('onboarding-other@example.com')
    userId = tenant.id
    await sessionStore.create(tenant.email, TENANT_TOKEN)
    await sessionStore.create(other.email, OTHER_TOKEN)

    app = createApp()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('authentication', () => {
    it('rejects unauthenticated requests with 401 on every onboarding route', async () => {
      const responses = [
        await request(app).post('/api/onboarding/draft').send({}),
        await request(app).get('/api/onboarding/status'),
        await request(app).post('/api/onboarding/submit'),
      ]

      for (const res of responses) {
        expect(res.status).toBe(401)
        expect(res.body.error.code).toBe('UNAUTHORIZED')
      }
    })
  })

  describe('POST /api/onboarding/draft', () => {
    it('returns 400 for an invalid section and stores nothing', async () => {
      const res = await request(app)
        .post('/api/onboarding/draft')
        .set(authed(TENANT_TOKEN))
        .send({ personalInfo: { fullName: 'A', dateOfBirth: '1990/01/01', phone: '1', residentialAddress: 'x' } })
        .expect(400)

      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(res.body.error.message).toBe('Invalid onboarding data')
      expect(drafts.size).toBe(0)
    })

    it('returns 500 when the database is not available', async () => {
      vi.mocked(getPool).mockResolvedValueOnce(null)

      const res = await request(app)
        .post('/api/onboarding/draft')
        .set(authed(TENANT_TOKEN))
        .send({ personalInfo })
        .expect(500)

      expect(res.body.error.code).toBe('INTERNAL_ERROR')
    })

    it('saves the personal section, encrypts the NIN at rest, and reports the next step', async () => {
      const res = await request(app)
        .post('/api/onboarding/draft')
        .set(authed(TENANT_TOKEN))
        .send({ personalInfo })
        .expect(200)

      expect(res.body).toEqual({
        success: true,
        completedSteps: ['personal_info'],
        currentStep: 'employment_info',
      })

      const stored = drafts.get(userId)!.personal_info as Record<string, string>
      expect(stored.fullName).toBe('Ada Lovelace')
      expect(stored.nin).not.toBe('12345678901')
      expect(isEncryptedPii(stored.nin)).toBe(true)
    })

    it('merges sections across requests and advances the current step', async () => {
      await request(app).post('/api/onboarding/draft').set(authed(TENANT_TOKEN)).send({ personalInfo }).expect(200)

      const res = await request(app)
        .post('/api/onboarding/draft')
        .set(authed(TENANT_TOKEN))
        .send({ employmentInfo })
        .expect(200)

      expect(res.body.completedSteps).toEqual(['personal_info', 'employment_info'])
      expect(res.body.currentStep).toBe('documents')
      // The earlier personal section is still stored after the second write.
      expect((drafts.get(userId)!.personal_info as Record<string, string>).fullName).toBe('Ada Lovelace')
    })

    it('reaches the summary step once every section is present', async () => {
      const res = await request(app)
        .post('/api/onboarding/draft')
        .set(authed(TENANT_TOKEN))
        .send({ personalInfo, employmentInfo, documents, walletInfo })
        .expect(200)

      expect(res.body.completedSteps).toEqual(['personal_info', 'employment_info', 'documents', 'wallet'])
      expect(res.body.currentStep).toBe('summary')
    })

    it('accepts an empty payload and reports the first step', async () => {
      const res = await request(app).post('/api/onboarding/draft').set(authed(TENANT_TOKEN)).send({}).expect(200)

      expect(res.body).toEqual({ success: true, completedSteps: [], currentStep: 'personal_info' })
    })
  })

  describe('GET /api/onboarding/status', () => {
    it('returns the empty state when no draft exists', async () => {
      const res = await request(app).get('/api/onboarding/status').set(authed(TENANT_TOKEN)).expect(200)

      expect(res.body).toEqual({ completedSteps: [], currentStep: 'personal_info', submitted: false })
    })

    it('reflects the saved draft', async () => {
      await request(app).post('/api/onboarding/draft').set(authed(TENANT_TOKEN)).send({ personalInfo }).expect(200)

      const res = await request(app).get('/api/onboarding/status').set(authed(TENANT_TOKEN)).expect(200)

      expect(res.body).toEqual({
        completedSteps: ['personal_info'],
        currentStep: 'employment_info',
        submitted: false,
        submittedAt: null,
      })
    })

    it('never shows one user\'s draft to another user', async () => {
      await request(app).post('/api/onboarding/draft').set(authed(TENANT_TOKEN)).send({ personalInfo }).expect(200)

      const res = await request(app).get('/api/onboarding/status').set(authed(OTHER_TOKEN)).expect(200)

      expect(res.body).toEqual({ completedSteps: [], currentStep: 'personal_info', submitted: false })
    })

    it('returns 500 when the database is not available', async () => {
      vi.mocked(getPool).mockResolvedValueOnce(null)

      const res = await request(app).get('/api/onboarding/status').set(authed(TENANT_TOKEN)).expect(500)

      expect(res.body.error.code).toBe('INTERNAL_ERROR')
    })
  })

  describe('POST /api/onboarding/submit', () => {
    it('returns 404 when there is no draft to submit', async () => {
      const res = await request(app).post('/api/onboarding/submit').set(authed(TENANT_TOKEN)).expect(404)

      expect(res.body.error.code).toBe('NOT_FOUND')
      expect(res.body.error.message).toBe('No onboarding draft found')
      expect(createJob).not.toHaveBeenCalled()
    })

    it('returns 400 until both personal and employment info are saved', async () => {
      await request(app).post('/api/onboarding/draft').set(authed(TENANT_TOKEN)).send({ personalInfo }).expect(200)

      const res = await request(app).post('/api/onboarding/submit').set(authed(TENANT_TOKEN)).expect(400)

      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(drafts.get(userId)!.submitted).toBe(false)
      expect(createJob).not.toHaveBeenCalled()
    })

    it('marks the draft submitted and enqueues the onboarding review job', async () => {
      await request(app)
        .post('/api/onboarding/draft')
        .set(authed(TENANT_TOKEN))
        .send({ personalInfo, employmentInfo })
        .expect(200)

      const res = await request(app).post('/api/onboarding/submit').set(authed(TENANT_TOKEN)).expect(200)

      expect(res.body).toEqual({ success: true, message: 'Assessment in progress' })
      expect(drafts.get(userId)!.submitted).toBe(true)
      expect(createJob).toHaveBeenCalledTimes(1)
      expect(createJob).toHaveBeenCalledWith({
        name: 'onboarding_review',
        handler: 'onboardingReview',
        payload: { userId },
        priority: 5,
        maxRetries: 3,
      })
    })

    it('rejects a second submission with 409 and does not enqueue again', async () => {
      await request(app)
        .post('/api/onboarding/draft')
        .set(authed(TENANT_TOKEN))
        .send({ personalInfo, employmentInfo })
        .expect(200)
      await request(app).post('/api/onboarding/submit').set(authed(TENANT_TOKEN)).expect(200)

      const res = await request(app).post('/api/onboarding/submit').set(authed(TENANT_TOKEN)).expect(409)

      expect(res.body.error.code).toBe('CONFLICT')
      expect(createJob).toHaveBeenCalledTimes(1)
    })

    it('still accepts the submission when the review job cannot be enqueued', async () => {
      createJob.mockRejectedValueOnce(new Error('queue unavailable'))
      await request(app)
        .post('/api/onboarding/draft')
        .set(authed(TENANT_TOKEN))
        .send({ personalInfo, employmentInfo })
        .expect(200)

      const res = await request(app).post('/api/onboarding/submit').set(authed(TENANT_TOKEN)).expect(200)

      expect(res.body.success).toBe(true)
      expect(drafts.get(userId)!.submitted).toBe(true)
    })
  })
})
