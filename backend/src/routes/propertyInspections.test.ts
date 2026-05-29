import { beforeEach, describe, expect, it } from 'vitest'
import { createTestAgent } from '../test-helpers.js'
import { sessionStore, userStore } from '../models/authStore.js'
import { propertyInspectionStore } from '../models/propertyInspectionStore.js'
import { InspectorVerificationStatus } from '../models/propertyInspection.js'

describe('Property inspections API', () => {
  const request = createTestAgent()
  const token = 'inspector-token'
  const email = 'inspector@test.com'

  beforeEach(async () => {
    await propertyInspectionStore.clear()
    userStore.clear()
    sessionStore.clear()

    // @ts-ignore - tests seed fallback auth cache directly.
    userStore.fallbackCache.set(email, {
      id: 'inspector-1',
      email,
      name: 'Inspector One',
      role: 'inspector',
      createdAt: new Date(),
      tier: 'free',
      planQuota: 100,
    })
    // @ts-ignore - tests seed fallback auth cache directly.
    sessionStore.fallbackCache.set(token, { token, email, createdAt: new Date() })
  })

  it('allows an inspector to apply', async () => {
    const response = await request
      .post('/api/inspector/apply')
      .set('Authorization', `Bearer ${token}`)
      .send({ bio: 'I inspect apartments.', serviceAreas: ['lekki', 'yaba'] })
      .expect(201)

    expect(response.body.success).toBe(true)
    expect(response.body.data.verificationStatus).toBe('pending')
  })

  it('rejects accepting a job before verification', async () => {
    await propertyInspectionStore.upsertInspectorProfile({
      userId: 'inspector-1',
      serviceAreas: ['lekki'],
    })
    const inspection = await propertyInspectionStore.createInspection({
      listingId: 'lekki-listing',
      scheduledAt: new Date(),
    })

    const response = await request
      .post(`/api/inspector/jobs/${inspection.id}/accept`)
      .set('Authorization', `Bearer ${token}`)

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('FORBIDDEN')
  })

  it('accepts and submits a valid report', async () => {
    await propertyInspectionStore.upsertInspectorProfile({
      userId: 'inspector-1',
      serviceAreas: ['lekki'],
    })
    await propertyInspectionStore.updateInspectorVerification(
      'inspector-1',
      InspectorVerificationStatus.VERIFIED,
    )
    const inspection = await propertyInspectionStore.createInspection({
      listingId: 'lekki-listing',
      scheduledAt: new Date(),
    })

    await request
      .post(`/api/inspector/jobs/${inspection.id}/accept`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    const response = await request
      .post(`/api/inspector/jobs/${inspection.id}/report`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        inspectorNotes: 'Looks good',
        checklistItems: [{ category: 'safety', item: 'Railings', result: 'pass' }],
        photos: [{ url: 'https://example.com/railing.jpg' }],
      })
      .expect(200)

    expect(response.body.data.inspection.status).toBe('submitted')
  })

  it('rejects reports without checklist items and photos', async () => {
    await propertyInspectionStore.upsertInspectorProfile({
      userId: 'inspector-1',
      serviceAreas: ['lekki'],
    })
    await propertyInspectionStore.updateInspectorVerification(
      'inspector-1',
      InspectorVerificationStatus.VERIFIED,
    )
    const inspection = await propertyInspectionStore.createInspection({
      listingId: 'lekki-listing',
      scheduledAt: new Date(),
    })
    await request
      .post(`/api/inspector/jobs/${inspection.id}/accept`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    const response = await request
      .post(`/api/inspector/jobs/${inspection.id}/report`)
      .set('Authorization', `Bearer ${token}`)
      .send({ checklistItems: [], photos: [] })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })
})
