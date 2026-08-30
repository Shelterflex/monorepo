import { describe, it, expect, vi, beforeEach } from 'vitest'
import express, { Request, Response } from 'express'
import supertest from 'supertest'
import { errorHandler } from './errorHandler.js'

// `env` is mutated between tests to simulate MANUAL_ADMIN_SECRET being
// configured vs. left unset (the fail-open scenario from issue #1608).
const mockEnv: { MANUAL_ADMIN_SECRET: string | undefined } = {
  MANUAL_ADMIN_SECRET: undefined,
}

vi.mock('../schemas/env.js', () => ({
  get env() {
    return mockEnv
  },
}))

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use((req: any, _res: any, next: any) => {
    req.requestId = 'test-request-id'
    next()
  })
  return app
}

describe('adminSecret middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.MANUAL_ADMIN_SECRET = undefined
  })

  describe('requireAdminSecret (Express middleware form)', () => {
    it('fails closed: rejects a request with no x-admin-secret header when MANUAL_ADMIN_SECRET is unset', async () => {
      const { requireAdminSecret } = await import('./adminSecret.js')
      const app = buildApp()
      app.get('/protected', requireAdminSecret, (_req: Request, res: Response) => {
        res.json({ ok: true })
      })
      app.use(errorHandler)

      const res = await supertest(app).get('/protected')

      expect(res.status).toBe(403)
      expect(res.body?.error?.message ?? res.body?.message).toMatch(/invalid admin secret/i)
    })

    it('rejects a request with a mismatched secret when MANUAL_ADMIN_SECRET is configured', async () => {
      mockEnv.MANUAL_ADMIN_SECRET = 'correct-secret'
      const { requireAdminSecret } = await import('./adminSecret.js')
      const app = buildApp()
      app.get('/protected', requireAdminSecret, (_req: Request, res: Response) => {
        res.json({ ok: true })
      })
      app.use(errorHandler)

      const res = await supertest(app)
        .get('/protected')
        .set('x-admin-secret', 'wrong-secret')

      expect(res.status).toBe(403)
    })

    it('allows the request through when the secret matches', async () => {
      mockEnv.MANUAL_ADMIN_SECRET = 'correct-secret'
      const { requireAdminSecret } = await import('./adminSecret.js')
      const app = buildApp()
      app.get('/protected', requireAdminSecret, (_req: Request, res: Response) => {
        res.json({ ok: true })
      })
      app.use(errorHandler)

      const res = await supertest(app)
        .get('/protected')
        .set('x-admin-secret', 'correct-secret')

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ ok: true })
    })
  })

  describe('assertAdminSecret (throwing helper form)', () => {
    it('fails closed: throws for a request with no x-admin-secret header when MANUAL_ADMIN_SECRET is unset', async () => {
      const { assertAdminSecret } = await import('./adminSecret.js')
      const app = buildApp()
      app.get('/protected', (req: Request, res: Response, next) => {
        try {
          assertAdminSecret(req)
          res.json({ ok: true })
        } catch (error) {
          next(error)
        }
      })
      app.use(errorHandler)

      const res = await supertest(app).get('/protected')

      expect(res.status).toBe(403)
    })
  })
})
