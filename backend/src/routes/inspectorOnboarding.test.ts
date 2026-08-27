import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { inspectorProfileStore } from '../models/inspectorProfileStore.js'
import { sessionStore, userStore } from '../models/authStore.js'

describe('Inspector Onboarding Route', () => {
  let app: any

  beforeEach(async () => {
    app = createApp()
    await inspectorProfileStore.clear()
    await sessionStore.clear()
    await userStore.clear()
  })

  it('successfully creates an onboarding profile and returns unique inspectorId', async () => {
    const payload = {
      personalInfo: {
        fullName: 'Jane Inspector',
        email: 'jane@example.com',
        phone: '+2348012345678',
        yearsExperience: 5,
      },
      kyc: {
        idType: 'national_id',
        idNumber: '12345678901',
      },
      serviceAreas: ['Lagos Mainland', 'Ikeja'],
      bankDetails: {
        bankName: 'Access Bank',
        accountNumber: '0123456789',
        accountName: 'JANE INSPECTOR',
        isVerified: true,
      },
    }

    const res = await request(app)
      .post('/api/inspector/onboarding')
      .send(payload)

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.inspectorId).toMatch(/^INS-[A-Z0-9]+$/)
    expect(res.body.userId).toBeDefined()

    // Verify stored profile
    const profile = await inspectorProfileStore.getByUserId(res.body.userId)
    expect(profile).not.toBeNull()
    expect(profile?.serviceAreas).toEqual(['Lagos Mainland', 'Ikeja'])
  })

  it('rejects onboarding if required fields are missing', async () => {
    const payload = {
      personalInfo: {
        fullName: '',
        email: 'invalid-email',
        phone: '',
      },
      serviceAreas: [],
      bankDetails: {
        bankName: '',
        accountNumber: '123',
        accountName: '',
      },
    }

    const res = await request(app)
      .post('/api/inspector/onboarding')
      .send(payload)

    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })

  it('retrieves onboarding profile status by userId', async () => {
    const created = await inspectorProfileStore.create({
      userId: 'test_user_ins_1',
      serviceAreas: ['Victoria Island'],
      bio: 'Expert inspector',
    })

    const res = await request(app).get(`/api/inspector/onboarding/${created.userId}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.profile.userId).toBe(created.userId)
    expect(res.body.profile.serviceAreas).toEqual(['Victoria Island'])
  })

  it('returns 404 for unknown userId', async () => {
    const res = await request(app).get('/api/inspector/onboarding/unknown_id')
    expect(res.status).toBe(404)
  })
})
