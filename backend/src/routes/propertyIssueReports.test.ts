import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { propertyIssueReportStore } from '../models/propertyIssueReportStore.js'
import { expectRequestId } from '../test-helpers.js'

describe('Property issue reports API', () => {
  let app: any

  beforeEach(async () => {
    await propertyIssueReportStore.clear()
    app = createApp()
  })

  it('accepts a valid report payload matching the frontend dialog shape', async () => {
    const res = await request(app)
      .post('/api/property-issue-reports')
      .send({
        propertyId: '123',
        reportCategory: 'scam',
        reportDetails: 'The photos appear stolen from another listing.',
      })
      .expect(201)

    expect(res.body.success).toBe(true)
    expect(res.body.reportId).toBeTruthy()

    const all = await propertyIssueReportStore.listAll()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({
      propertyId: '123',
      category: 'scam',
      details: 'The photos appear stolen from another listing.',
    })
  })

  it('returns structured validation errors for invalid payloads', async () => {
    const res = await request(app)
      .post('/api/property-issue-reports')
      .send({ propertyId: '', reportCategory: '', reportDetails: '' })
      .expect(400)

    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.message).toBe('Invalid request data')
    expect(res.body.error.details).toBeTruthy()
    expect(res.body.error.classification).toBe('permanent')
    expect(res.body.error.retryable).toBe(false)
    expectRequestId(res)
  })

  it('returns a validation error for malformed JSON', async () => {
    const res = await request(app)
      .post('/api/property-issue-reports')
      .set('Content-Type', 'application/json')
      .send('{"propertyId":"123",') // malformed
      .expect(400)

    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.message).toContain('Malformed JSON')
  })
})

