import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import supertest from 'supertest'
import { whistleblowerApplicationStore } from '../models/whistleblowerApplicationStore.js'
import { requestIdMiddleware } from '../middleware/requestId.js'
import { errorHandler } from '../middleware/errorHandler.js'
import { createWhistleblowerApplicationsRouter } from './whistleblowerApplications.js'

// Mock the env module with hardcoded value
vi.mock('../schemas/env.js', () => ({
  env: {
    MANUAL_ADMIN_SECRET: 'test-admin-secret',
  },
}))

import { createAdminWhistleblowerApplicationsRouter } from './adminWhistleblowerApplications.js'

const ADMIN_SECRET = 'test-admin-secret'

describe('Admin whistleblower applications API', () => {
  let uuidSequence = 0
  const app = express()
  app.use(express.json())
  app.use(requestIdMiddleware)
  app.use('/api/whistleblower-applications', createWhistleblowerApplicationsRouter())
  app.use('/api/admin/whistleblower-applications', createAdminWhistleblowerApplicationsRouter())
  app.use(errorHandler)
  const request = supertest(app)

  function createTestUuid() {
    uuidSequence += 1
    return `00000000-0000-4000-8000-${uuidSequence.toString().padStart(12, '0')}`
  }

  beforeEach(async () => {
    uuidSequence = 0
    await whistleblowerApplicationStore.clear()
  })

  async function createApplication(overrides: Partial<Record<string, string>> = {}) {
    const response = await request
      .post('/api/whistleblower-applications')
      .send({
        fullName: 'Test Applicant',
        email: `applicant-${createTestUuid()}@example.com`,
        phone: '+2348123456789',
        address: '123 Test Street, Lagos',
        linkedinProfile: 'https://linkedin.com/in/test-applicant',
        facebookProfile: 'https://facebook.com/test-applicant',
        instagramProfile: 'https://instagram.com/test-applicant',
        ...overrides,
      })

    expect(response.status).toBe(201)
    return response.body.application as {
      applicationId: string
      status: string
      reviewedAt?: string
      reviewedBy?: string
      rejectionReason?: string
    }
  }

  it('lists pending and historical applications with status filtering', async () => {
    const pending = await createApplication({ fullName: 'Pending Person' })
    const approved = await createApplication({ fullName: 'Approved Person' })
    const rejected = await createApplication({ fullName: 'Rejected Person' })

    await request
      .post(`/api/admin/whistleblower-applications/${approved.applicationId}/approve`)
      .set('x-admin-secret', ADMIN_SECRET)
      .send({ reviewedBy: 'admin@example.com' })
      .expect(200)

    await request
      .post(`/api/admin/whistleblower-applications/${rejected.applicationId}/reject`)
      .set('x-admin-secret', ADMIN_SECRET)
      .send({
        reviewedBy: 'admin@example.com',
        reason: 'Identity signals did not match the application.',
      })
      .expect(200)

    const allResponse = await request
      .get('/api/admin/whistleblower-applications')
      .set('x-admin-secret', ADMIN_SECRET)
      .expect(200)

    expect(allResponse.body.success).toBe(true)
    expect(allResponse.body.pagination.total).toBe(3)
    expect(allResponse.body.applications).toHaveLength(3)

    const pendingResponse = await request
      .get('/api/admin/whistleblower-applications')
      .set('x-admin-secret', ADMIN_SECRET)
      .query({ status: 'pending' })
      .expect(200)

    expect(pendingResponse.body.applications).toHaveLength(1)
    expect(pendingResponse.body.applications[0].applicationId).toBe(pending.applicationId)

    const approvedResponse = await request
      .get('/api/admin/whistleblower-applications')
      .set('x-admin-secret', ADMIN_SECRET)
      .query({ status: 'approved' })
      .expect(200)

    expect(approvedResponse.body.applications).toHaveLength(1)
    expect(approvedResponse.body.applications[0].applicationId).toBe(approved.applicationId)

    const rejectedResponse = await request
      .get('/api/admin/whistleblower-applications')
      .set('x-admin-secret', ADMIN_SECRET)
      .query({ status: 'rejected' })
      .expect(200)

    expect(rejectedResponse.body.applications).toHaveLength(1)
    expect(rejectedResponse.body.applications[0].applicationId).toBe(rejected.applicationId)
  })

  it('returns application details for an existing application', async () => {
    const application = await createApplication()

    const response = await request
      .get(`/api/admin/whistleblower-applications/${application.applicationId}`)
      .set('x-admin-secret', ADMIN_SECRET)
      .expect(200)

    expect(response.body.success).toBe(true)
    expect(response.body.application.applicationId).toBe(application.applicationId)
    expect(response.body.application.status).toBe('pending')
    expect(response.body.application.socialScore).toBeTypeOf('number')
  })

  it('approves a pending application and preserves review metadata', async () => {
    const application = await createApplication()

    const response = await request
      .post(`/api/admin/whistleblower-applications/${application.applicationId}/approve`)
      .set('x-admin-secret', ADMIN_SECRET)
      .send({ reviewedBy: 'admin@example.com' })
      .expect(200)

    expect(response.body.success).toBe(true)
    expect(response.body.application.status).toBe('approved')
    expect(response.body.application.reviewedBy).toBe('admin@example.com')
    expect(response.body.application.reviewedAt).toEqual(expect.any(String))
  })

  it('rejects a pending application and preserves rejection metadata', async () => {
    const application = await createApplication()

    const response = await request
      .post(`/api/admin/whistleblower-applications/${application.applicationId}/reject`)
      .set('x-admin-secret', ADMIN_SECRET)
      .send({
        reviewedBy: 'admin@example.com',
        reason: 'Identity signals did not match the application.',
      })
      .expect(200)

    expect(response.body.success).toBe(true)
    expect(response.body.application.status).toBe('rejected')
    expect(response.body.application.reviewedBy).toBe('admin@example.com')
    expect(response.body.application.reviewedAt).toEqual(expect.any(String))
    expect(response.body.application.rejectionReason).toBe(
      'Identity signals did not match the application.'
    )
  })

  it('returns explicit conflicts for invalid moderation transitions', async () => {
    const application = await createApplication()

    await request
      .post(`/api/admin/whistleblower-applications/${application.applicationId}/approve`)
      .set('x-admin-secret', ADMIN_SECRET)
      .send({ reviewedBy: 'admin@example.com' })
      .expect(200)

    const response = await request
      .post(`/api/admin/whistleblower-applications/${application.applicationId}/reject`)
      .set('x-admin-secret', ADMIN_SECRET)
      .send({
        reviewedBy: 'admin@example.com',
        reason: 'Should not be accepted after approval.',
      })
      .expect(409)

    expect(response.body.error.code).toBe('CONFLICT')
    expect(response.body.error.message).toContain('Current status: approved')
    expect(response.body.error.details.currentStatus).toBe('approved')
  })

  it('returns not found for unknown application ids on detail and moderation routes', async () => {
    const missingId = createTestUuid()

    const detailResponse = await request
      .get(`/api/admin/whistleblower-applications/${missingId}`)
      .set('x-admin-secret', ADMIN_SECRET)
      .expect(404)

    expect(detailResponse.body.error.code).toBe('NOT_FOUND')

    const approveResponse = await request
      .post(`/api/admin/whistleblower-applications/${missingId}/approve`)
      .set('x-admin-secret', ADMIN_SECRET)
      .send({ reviewedBy: 'admin@example.com' })
      .expect(404)

    expect(approveResponse.body.error.code).toBe('NOT_FOUND')

    const rejectResponse = await request
      .post(`/api/admin/whistleblower-applications/${missingId}/reject`)
      .set('x-admin-secret', ADMIN_SECRET)
      .send({
        reviewedBy: 'admin@example.com',
        reason: 'Identity signals did not match the application.',
      })
      .expect(404)

    expect(rejectResponse.body.error.code).toBe('NOT_FOUND')
  })

  it('rejects requests without admin secret on list endpoint', async () => {
    const response = await request
      .get('/api/admin/whistleblower-applications')
      .expect(403)

    expect(response.body.error.code).toBe('FORBIDDEN')
  })

  it('rejects requests without admin secret on detail endpoint', async () => {
    const application = await createApplication()

    const response = await request
      .get(`/api/admin/whistleblower-applications/${application.applicationId}`)
      .expect(403)

    expect(response.body.error.code).toBe('FORBIDDEN')
  })

  it('rejects requests without admin secret on approve endpoint', async () => {
    const application = await createApplication()

    const response = await request
      .post(`/api/admin/whistleblower-applications/${application.applicationId}/approve`)
      .send({ reviewedBy: 'admin@example.com' })
      .expect(403)

    expect(response.body.error.code).toBe('FORBIDDEN')
  })

  it('rejects requests without admin secret on reject endpoint', async () => {
    const application = await createApplication()

    const response = await request
      .post(`/api/admin/whistleblower-applications/${application.applicationId}/reject`)
      .send({
        reviewedBy: 'admin@example.com',
        reason: 'Identity signals did not match the application.',
      })
      .expect(403)

    expect(response.body.error.code).toBe('FORBIDDEN')
  })

  it('accepts requests with valid admin secret', async () => {
    const application = await createApplication()

    await request
      .get('/api/admin/whistleblower-applications')
      .set('x-admin-secret', ADMIN_SECRET)
      .expect(200)

    await request
      .get(`/api/admin/whistleblower-applications/${application.applicationId}`)
      .set('x-admin-secret', ADMIN_SECRET)
      .expect(200)

    await request
      .post(`/api/admin/whistleblower-applications/${application.applicationId}/approve`)
      .set('x-admin-secret', ADMIN_SECRET)
      .send({ reviewedBy: 'admin@example.com' })
      .expect(200)
  })
})
