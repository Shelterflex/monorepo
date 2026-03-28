import { describe, it, expect } from 'vitest'
import express, { type Request, type Response } from 'express'
import supertest from 'supertest'
import { apiVersioning, CURRENT_VERSION, SUPPORTED_VERSIONS } from './apiVersioning.js'

function buildApp() {
  const app = express()

  // Mount under /api so the versioning middleware can detect /api/v1/...
  const apiRouter = express.Router()
  apiRouter.use(apiVersioning)
  apiRouter.get('/v1/test', (req: Request, res: Response) => {
    res.json({ version: req.apiVersion, ok: true })
  })
  apiRouter.get('/test', (req: Request, res: Response) => {
    res.json({ version: req.apiVersion, ok: true })
  })
  app.use('/api', apiRouter)

  return app
}

describe('apiVersioning middleware', () => {
  it('defaults to current version when no version specified', async () => {
    const app = buildApp()
    const res = await supertest(app).get('/api/test')
    expect(res.status).toBe(200)
    expect(res.body.version).toBe(CURRENT_VERSION)
    expect(res.headers['x-api-version']).toBe(CURRENT_VERSION)
  })

  it('extracts version from URL path /api/v1/...', async () => {
    const app = buildApp()
    const res = await supertest(app).get('/api/v1/test')
    expect(res.status).toBe(200)
    expect(res.body.version).toBe('v1')
    expect(res.headers['x-api-version']).toBe('v1')
  })

  it('extracts version from Accept-Version header', async () => {
    const app = buildApp()
    const res = await supertest(app)
      .get('/api/test')
      .set('Accept-Version', 'v1')
    expect(res.status).toBe(200)
    expect(res.body.version).toBe('v1')
  })

  it('rejects unsupported versions', async () => {
    const app = buildApp()
    const res = await supertest(app)
      .get('/api/test')
      .set('Accept-Version', 'v99')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.message).toContain('v99')
  })

  it('SUPPORTED_VERSIONS includes v1', () => {
    expect(SUPPORTED_VERSIONS).toContain('v1')
  })

  it('CURRENT_VERSION is v1', () => {
    expect(CURRENT_VERSION).toBe('v1')
  })
})
