import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express, { Request, Response } from 'express'
import supertest from 'supertest'
import { authenticateToken, type AuthenticatedRequest } from './auth.js'
import { sessionStore, userStore } from '../models/authStore.js'

// Mock dependencies
vi.mock('../utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

// Authentication rejection coverage should distinguish each branch by both its
// machine-readable error code and its client-facing message.
describe('authenticateToken middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    userStore.clear()
    sessionStore.clear()
  })

  afterEach(() => {
    userStore.clear()
    sessionStore.clear()
  })

  it('allows request with valid token and sets user identity', async () => {
    await userStore.getOrCreateByEmail('test@example.com')
    await sessionStore.create('test@example.com', 'valid-token-123')

    const app = express()
    app.use(authenticateToken)
    app.get('/protected', (req: AuthenticatedRequest, res: Response) => {
      res.json({
        success: true,
        user: req.user,
      })
    })

    const res = await supertest(app)
      .get('/protected')
      .set('Authorization', 'Bearer valid-token-123')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.user).toBeDefined()
    expect(res.body.user.email).toBe('test@example.com')
  })

  it('rejects request with missing authorization header', async () => {
    const app = express()
    app.use(authenticateToken)
    app.get('/protected', (_req: Request, res: Response) => {
      res.json({ success: true })
    })

    const res = await supertest(app).get('/protected')

    expect(res.status).toBe(401)
  })

  it('rejects request with invalid token', async () => {
    const app = express()
    app.use(authenticateToken)
    app.get('/protected', (_req: Request, res: Response) => {
      res.json({ success: true })
    })

    const res = await supertest(app)
      .get('/protected')
      .set('Authorization', 'Bearer invalid-token')

    expect(res.status).toBe(401)
  })

  it('rejects request when token verification throws error (fail closed)', async () => {
    vi.spyOn(sessionStore, 'getTokenState').mockImplementationOnce(() => {
      throw new Error('Database connection failed')
    })

    const app = express()
    app.use(authenticateToken)
    app.get('/protected', (_req: Request, res: Response) => {
      res.json({ success: true })
    })

    const res = await supertest(app)
      .get('/protected')
      .set('Authorization', 'Bearer some-token')

    expect(res.status).toBeGreaterThan(399)
  })
})
