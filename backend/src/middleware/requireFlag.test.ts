import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import supertest from 'supertest'
import { requireFlag } from './requireFlag.js'
import { errorHandler } from './errorHandler.js'

function buildApp(user?: { id: string; role: string }) {
  const app = express()
  app.use((req: any, _res, next) => {
    req.requestId = 'test-request-id'
    if (user) req.user = user
    next()
  })
  app.get('/staking', requireFlag('STAKING_ENABLED'), (_req, res) => {
    res.json({ ok: true })
  })
  app.get('/governance', requireFlag('GOVERNANCE_ENABLED'), (_req, res) => {
    res.json({ ok: true })
  })
  app.use(errorHandler)
  return app
}

describe('requireFlag middleware', () => {
  afterEach(() => {
    delete process.env.FEATURE_FLAG_STAKING_ENABLED
    delete process.env.FEATURE_FLAG_GOVERNANCE_ENABLED
  })

  it('allows the request when the flag is on by default', async () => {
    const res = await supertest(buildApp()).get('/staking')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('returns 403 when the flag is off by default', async () => {
    const res = await supertest(buildApp()).get('/governance')
    expect(res.status).toBe(403)
    expect(JSON.stringify(res.body)).toContain('GOVERNANCE_ENABLED')
  })

  it('lets an env override turn a default-off flag on', async () => {
    process.env.FEATURE_FLAG_GOVERNANCE_ENABLED = 'true'
    const res = await supertest(buildApp()).get('/governance')
    expect(res.status).toBe(200)
  })

  it('lets an env override turn a default-on flag off', async () => {
    process.env.FEATURE_FLAG_STAKING_ENABLED = 'false'
    const res = await supertest(buildApp()).get('/staking')
    expect(res.status).toBe(403)
  })

  it('passes for an authenticated user when the flag is on', async () => {
    const res = await supertest(buildApp({ id: 'u1', role: 'tenant' })).get('/staking')
    expect(res.status).toBe(200)
  })
})
