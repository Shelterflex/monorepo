import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { RATE_LIMIT_BYPASS_TOKEN, expectErrorShape } from '../test-helpers.js'
import { seedAdminSession } from '../test-fixtures/adminAuth.js'
import { sessionStore } from '../models/authStore.js'
import { auditLog } from '../utils/auditLogger.js'
import { JOB_INVENTORY, resetJobObservability } from '../jobs/jobObservability.js'
import { InMemoryJobStore, getJobStore, initJobStore } from '../jobs/scheduler/store.js'
import { JobRunStatus, JobStatus, type CreateJobInput, type ScheduledJob } from '../jobs/scheduler/types.js'

vi.mock('../utils/auditLogger.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/auditLogger.js')>()),
  auditLog: vi.fn(),
}))

const BASE = '/api/v1/admin/jobs'
const MISSING = '550e8400-e29b-41d4-a716-446655440999'
const BYPASS = { 'x-ratelimit-bypass': RATE_LIMIT_BYPASS_TOKEN }
const FUTURE = new Date('2099-01-01T00:00:00.000Z')

type Method = 'GET' | 'POST'

/** Every route in adminJobs.ts, with an unknown job id where the route takes one. */
const ROUTES: Array<[Method, string]> = [
  ['GET', BASE],
  ['GET', `${BASE}/health`],
  ['GET', `${BASE}/${MISSING}`],
  ['POST', BASE],
  ['POST', `${BASE}/${MISSING}/reschedule`],
  ['POST', `${BASE}/${MISSING}/cancel`],
  ['GET', `${BASE}/${MISSING}/history`],
  ['POST', `${BASE}/${MISSING}/trigger`],
]

function send(app: ReturnType<typeof createApp>, method: Method, url: string) {
  return method === 'GET' ? request(app).get(url) : request(app).post(url)
}

async function makeJob(overrides: Partial<CreateJobInput> = {}): Promise<ScheduledJob> {
  return getJobStore().create({ name: 'nightly-report', handler: 'report', ...overrides })
}

describe('admin jobs routes', () => {
  let app: ReturnType<typeof createApp>
  let adminId: string
  let adminHeaders: Record<string, string>
  let tenantHeaders: Record<string, string>

  beforeEach(async () => {
    vi.clearAllMocks()
    initJobStore(new InMemoryJobStore())
    resetJobObservability()
    sessionStore.clear()
    const admin = await seedAdminSession({
      email: 'jobs-admin@example.com',
      token: 'test-token-jobs-admin',
      role: 'admin',
    })
    const tenant = await seedAdminSession({
      email: 'jobs-tenant@example.com',
      token: 'test-token-jobs-tenant',
      role: 'tenant',
    })
    adminId = admin.id
    adminHeaders = { ...BYPASS, ...admin.header }
    tenantHeaders = { ...BYPASS, ...tenant.header }
    app = createApp()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe.each(ROUTES)('%s %s', (method, url) => {
    it('rejects a request without a token with 401', async () => {
      const res = await send(app, method, url).set(BYPASS)
      expectErrorShape(res, 'UNAUTHORIZED', 401)
    })

    it('rejects a tenant that holds no jobs permission with 403', async () => {
      const res = await send(app, method, url).set(tenantHeaders)
      expectErrorShape(res, 'FORBIDDEN', 403)
    })
  })

  describe('GET /api/v1/admin/jobs', () => {
    it('returns the { jobs } envelope with each job in its stored shape', async () => {
      const job = await makeJob({ name: 'alpha' })

      const res = await request(app).get(BASE).set(adminHeaders).expect(200)

      expect(Object.keys(res.body)).toEqual(['jobs'])
      expect(res.body.jobs).toHaveLength(1)
      expect(res.body.jobs[0]).toMatchObject({
        id: job.id,
        name: 'alpha',
        handler: 'report',
        status: JobStatus.PENDING,
        priority: 5,
        maxRetries: 3,
      })
    })

    it('filters by status', async () => {
      const done = await makeJob({ name: 'done' })
      await getJobStore().markCompleted(done.id)
      await makeJob({ name: 'waiting' })

      const res = await request(app)
        .get(`${BASE}?status=${JobStatus.COMPLETED}`)
        .set(adminHeaders)
        .expect(200)

      expect(res.body.jobs.map((j: { name: string }) => j.name)).toEqual(['done'])
    })

    it('applies limit and offset', async () => {
      await makeJob({ name: 'a' })
      await makeJob({ name: 'b' })
      await makeJob({ name: 'c' })

      const firstPage = await request(app).get(`${BASE}?limit=2`).set(adminHeaders).expect(200)
      const secondPage = await request(app)
        .get(`${BASE}?limit=2&offset=2`)
        .set(adminHeaders)
        .expect(200)

      expect(firstPage.body.jobs.map((j: { name: string }) => j.name)).toEqual(['a', 'b'])
      expect(secondPage.body.jobs.map((j: { name: string }) => j.name)).toEqual(['c'])
    })

    it('rejects an unknown status with a 400 validation error', async () => {
      const res = await request(app).get(`${BASE}?status=bogus`).set(adminHeaders)
      expectErrorShape(res, 'VALIDATION_ERROR', 400)
    })

    it.each(['0', '201'])('rejects limit=%s with a 400 validation error', async (limit) => {
      const res = await request(app).get(`${BASE}?limit=${limit}`).set(adminHeaders)
      expectErrorShape(res, 'VALIDATION_ERROR', 400)
    })

    it('returns 500 with an error envelope when the store fails', async () => {
      vi.spyOn(getJobStore(), 'listAll').mockRejectedValueOnce(new Error('store down'))

      const res = await request(app).get(BASE).set(adminHeaders)

      expect(res.status).toBe(500)
      expect(res.body.error).toBeDefined()
    })
  })

  describe('GET /api/v1/admin/jobs/health', () => {
    it('reports every scheduled job as never_ran before any run is recorded', async () => {
      const res = await request(app).get(`${BASE}/health`).set(adminHeaders).expect(200)

      expect(res.body.jobs.map((j: { name: string }) => j.name)).toEqual(
        JOB_INVENTORY.map((entry) => entry.name),
      )
      expect(res.body.jobs.every((j: { state: string }) => j.state === 'never_ran')).toBe(true)
      expect(res.body.failingCount).toBe(0)
      expect(typeof res.body.capturedAt).toBe('string')
    })
  })

  describe('GET /api/v1/admin/jobs/:id', () => {
    it('returns the job by id', async () => {
      const job = await makeJob({ name: 'lookup' })

      const res = await request(app).get(`${BASE}/${job.id}`).set(adminHeaders).expect(200)

      expect(Object.keys(res.body)).toEqual(['job'])
      expect(res.body.job).toMatchObject({ id: job.id, name: 'lookup', status: JobStatus.PENDING })
    })

    it('returns 404 with the job id in the message when the job does not exist', async () => {
      const res = await request(app).get(`${BASE}/${MISSING}`).set(adminHeaders)

      expectErrorShape(res, 'NOT_FOUND', 404)
      expect(res.body.error.message).toContain(MISSING)
    })
  })

  describe('POST /api/v1/admin/jobs', () => {
    it('schedules a job with defaults and stores it', async () => {
      const res = await request(app)
        .post(BASE)
        .set(adminHeaders)
        .send({ name: 'nightly-report', handler: 'report' })
        .expect(201)

      const stored = await getJobStore().findById(res.body.job.id)
      expect(stored).not.toBeNull()
      expect(stored).toMatchObject({
        name: 'nightly-report',
        handler: 'report',
        payload: {},
        status: JobStatus.PENDING,
        priority: 5,
        maxRetries: 3,
        cronExpression: null,
      })
    })

    it('stores the explicit payload, priority, retries and run time', async () => {
      const res = await request(app)
        .post(BASE)
        .set(adminHeaders)
        .send({
          name: 'custom',
          handler: 'sync',
          payload: { region: 'lagos' },
          priority: 2,
          maxRetries: 7,
          nextRunAt: FUTURE.toISOString(),
        })
        .expect(201)

      const stored = await getJobStore().findById(res.body.job.id)
      expect(stored).toMatchObject({
        payload: { region: 'lagos' },
        priority: 2,
        maxRetries: 7,
      })
      expect(stored?.nextRunAt.toISOString()).toBe(FUTURE.toISOString())
    })

    it('writes an ADMIN_OPERATION audit entry once the job is created', async () => {
      const res = await request(app)
        .post(BASE)
        .set(adminHeaders)
        .send({ name: 'audited', handler: 'report' })
        .expect(201)

      await vi.waitFor(() =>
        expect(auditLog).toHaveBeenCalledWith(
          'ADMIN_OPERATION',
          expect.anything(),
          expect.objectContaining({
            resource: 'jobs',
            action: 'manage',
            method: 'POST',
            path: BASE,
            adminId,
            statusCode: 201,
          }),
        ),
      )
      expect(res.body.job.name).toBe('audited')
    })

    it.each([
      ['a missing name', { handler: 'report' }],
      ['an empty handler', { name: 'x', handler: '' }],
      ['priority above 10', { name: 'x', handler: 'report', priority: 11 }],
      ['maxRetries above 20', { name: 'x', handler: 'report', maxRetries: 21 }],
      ['an unparseable nextRunAt', { name: 'x', handler: 'report', nextRunAt: 'not-a-date' }],
    ])('rejects %s with a 400 and stores nothing', async (_label, body) => {
      const res = await request(app).post(BASE).set(adminHeaders).send(body)

      expectErrorShape(res, 'VALIDATION_ERROR', 400)
      expect(await getJobStore().listAll()).toHaveLength(0)
    })
  })

  describe('POST /api/v1/admin/jobs/:id/reschedule', () => {
    it('resets a failed job to pending at the requested time', async () => {
      const job = await makeJob()
      await getJobStore().markFailed(job.id, 'boom', new Date(0))
      const when = new Date('2099-06-01T12:00:00.000Z')

      const res = await request(app)
        .post(`${BASE}/${job.id}/reschedule`)
        .set(adminHeaders)
        .send({ nextRunAt: when.toISOString() })
        .expect(200)

      expect(res.body.job).toMatchObject({ id: job.id, status: JobStatus.PENDING, retryCount: 0 })
      expect(new Date(res.body.job.nextRunAt).getTime()).toBe(when.getTime())
      const stored = await getJobStore().findById(job.id)
      expect(stored?.status).toBe(JobStatus.PENDING)
      expect(stored?.nextRunAt.getTime()).toBe(when.getTime())
    })

    it('writes an ADMIN_OPERATION audit entry naming the job path', async () => {
      const job = await makeJob()

      await request(app)
        .post(`${BASE}/${job.id}/reschedule`)
        .set(adminHeaders)
        .send({ nextRunAt: FUTURE.toISOString() })
        .expect(200)

      await vi.waitFor(() =>
        expect(auditLog).toHaveBeenCalledWith(
          'ADMIN_OPERATION',
          expect.anything(),
          expect.objectContaining({
            resource: 'jobs',
            action: 'manage',
            path: `${BASE}/${job.id}/reschedule`,
            statusCode: 200,
          }),
        ),
      )
    })

    it('returns 404 when the job does not exist', async () => {
      const res = await request(app)
        .post(`${BASE}/${MISSING}/reschedule`)
        .set(adminHeaders)
        .send({ nextRunAt: FUTURE.toISOString() })

      expectErrorShape(res, 'NOT_FOUND', 404)
    })

    it.each([
      ['a missing nextRunAt', {}],
      ['an unparseable nextRunAt', { nextRunAt: 'not-a-date' }],
    ])('rejects %s with a 400 and leaves the job unchanged', async (_label, body) => {
      const job = await makeJob()

      const res = await request(app)
        .post(`${BASE}/${job.id}/reschedule`)
        .set(adminHeaders)
        .send(body)

      expectErrorShape(res, 'VALIDATION_ERROR', 400)
      expect((await getJobStore().findById(job.id))?.nextRunAt.getTime()).toBe(job.nextRunAt.getTime())
    })

    // BUG (documented, not fixed): the route does not check the job's status, so a job that a
    // worker is running is reset to pending while the worker still holds it. Expected: refused.
    it.fails('refuses to reschedule a job that is running', async () => {
      const job = await makeJob()
      await getJobStore().markRunning(job.id)

      const res = await request(app)
        .post(`${BASE}/${job.id}/reschedule`)
        .set(adminHeaders)
        .send({ nextRunAt: FUTURE.toISOString() })

      expect(res.status).toBe(409)
    })
  })

  describe('POST /api/v1/admin/jobs/:id/cancel', () => {
    it('cancels a pending job so it will not run again', async () => {
      const job = await makeJob()

      const res = await request(app).post(`${BASE}/${job.id}/cancel`).set(adminHeaders).expect(200)

      expect(res.body).toEqual({ success: true })
      expect((await getJobStore().findById(job.id))?.status).toBe(JobStatus.CANCELLED)
    })

    it('writes an audit entry for the cancel', async () => {
      const job = await makeJob()

      await request(app).post(`${BASE}/${job.id}/cancel`).set(adminHeaders).expect(200)

      await vi.waitFor(() =>
        expect(auditLog).toHaveBeenCalledWith(
          'ADMIN_OPERATION',
          expect.anything(),
          expect.objectContaining({ resource: 'jobs', action: 'manage', statusCode: 200 }),
        ),
      )
    })

    it('returns 404 and writes no audit entry when the job does not exist', async () => {
      const res = await request(app).post(`${BASE}/${MISSING}/cancel`).set(adminHeaders)

      expectErrorShape(res, 'NOT_FOUND', 404)
      await new Promise((resolve) => setImmediate(resolve))
      expect(auditLog).not.toHaveBeenCalled()
    })
  })

  describe('GET /api/v1/admin/jobs/:id/history', () => {
    it('returns an empty history for a job that has never run', async () => {
      const job = await makeJob()

      const res = await request(app).get(`${BASE}/${job.id}/history`).set(adminHeaders).expect(200)

      expect(res.body).toEqual({ history: [] })
    })

    it('returns every recorded run with its final status', async () => {
      const job = await makeJob()
      const store = getJobStore()
      const first = await store.recordJobRun(job.id, job.name, job.handler, 'worker-1', {}, 1)
      await store.completeJobRun(first, JobRunStatus.COMPLETED)
      const second = await store.recordJobRun(job.id, job.name, job.handler, 'worker-1', {}, 2)
      await store.completeJobRun(second, JobRunStatus.FAILED, 'boom')

      const res = await request(app).get(`${BASE}/${job.id}/history`).set(adminHeaders).expect(200)

      const byId = new Map(res.body.history.map((run: { id: string }) => [run.id, run]))
      expect(res.body.history).toHaveLength(2)
      expect(byId.get(first)).toMatchObject({ status: JobRunStatus.COMPLETED, fencingToken: 1 })
      expect(byId.get(second)).toMatchObject({
        status: JobRunStatus.FAILED,
        errorMessage: 'boom',
        fencingToken: 2,
      })
    })

    it('honours the limit query parameter', async () => {
      const job = await makeJob()
      const store = getJobStore()
      await store.recordJobRun(job.id, job.name, job.handler, 'worker-1', {}, 1)
      await store.recordJobRun(job.id, job.name, job.handler, 'worker-1', {}, 2)

      const res = await request(app)
        .get(`${BASE}/${job.id}/history?limit=1`)
        .set(adminHeaders)
        .expect(200)

      expect(res.body.history).toHaveLength(1)
    })

    it('returns 404 when the job does not exist', async () => {
      const res = await request(app).get(`${BASE}/${MISSING}/history`).set(adminHeaders)

      expectErrorShape(res, 'NOT_FOUND', 404)
    })

    // BUG (documented, not fixed): the limit is parsed with parseInt(...) || 50 and never
    // validated, so a non-numeric limit is silently replaced by 50 instead of being refused.
    it.fails('rejects a non-numeric limit with a 400', async () => {
      const job = await makeJob()

      const res = await request(app)
        .get(`${BASE}/${job.id}/history?limit=abc`)
        .set(adminHeaders)

      expect(res.status).toBe(400)
    })

    // BUG (documented, not fixed): a negative limit is passed through unvalidated. Postgres
    // rejects LIMIT -1, so the same request fails with a 500 in production instead of a 400.
    it.fails('rejects a negative limit with a 400', async () => {
      const job = await makeJob()

      const res = await request(app)
        .get(`${BASE}/${job.id}/history?limit=-1`)
        .set(adminHeaders)

      expect(res.status).toBe(400)
    })
  })

  describe('POST /api/v1/admin/jobs/:id/trigger', () => {
    it('makes a future job due now and leaves it pending', async () => {
      const job = await makeJob({ nextRunAt: FUTURE })

      const res = await request(app).post(`${BASE}/${job.id}/trigger`).set(adminHeaders).expect(200)

      expect(res.body.job).toMatchObject({ id: job.id, status: JobStatus.PENDING })
      expect(new Date(res.body.job.nextRunAt).getTime()).toBeLessThanOrEqual(Date.now())
      const stored = await getJobStore().findById(job.id)
      expect(stored?.nextRunAt.getTime()).toBeLessThanOrEqual(Date.now())
    })

    it('returns 404 when the job does not exist', async () => {
      const res = await request(app).post(`${BASE}/${MISSING}/trigger`).set(adminHeaders)

      expectErrorShape(res, 'NOT_FOUND', 404)
    })

    // BUG (documented, not fixed): the handler comment says trigger "respects lease semantics",
    // but it only resets nextRunAt. A job that a worker is running is set back to pending.
    it.fails('refuses to trigger a job that is running', async () => {
      const job = await makeJob()
      await getJobStore().markRunning(job.id)

      const res = await request(app).post(`${BASE}/${job.id}/trigger`).set(adminHeaders)

      expect(res.status).toBe(409)
    })
  })
})
