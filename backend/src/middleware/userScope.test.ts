import { describe, it, expect } from 'vitest'
import express, { Request, Response } from 'express'
import request from 'supertest'
import { userScope, ScopedRequest } from './userScope.js'
import { AuthenticatedRequest } from './auth.js'

type UserRole = 'tenant' | 'landlord' | 'agent'

function makeUser(id: string, role: UserRole = 'tenant') {
  return { id, email: `${id}@test.com`, name: id, role }
}

/** Injects a pre-built user onto req without real JWT verification. */
function injectUser(id: string, role: UserRole = 'tenant') {
  return (req: AuthenticatedRequest, _res: Response, next: () => void) => {
    req.user = makeUser(id, role)
    req.requestId = 'test-req-id'
    next()
  }
}

function buildApp(actorId: string, role: UserRole = 'tenant') {
  const app = express()
  app.use(express.json())
  app.use(injectUser(actorId, role))

  // Route-level: middleware applied after params are resolved
  app.get('/resource/:userId', userScope, (req: Request, res: Response) => {
    res.json({ scopedUserId: (req as ScopedRequest).scopedUserId })
  })

  // No route param — middleware applied globally for query-param scoping
  app.use(userScope)
  app.get('/resource', (req: Request, res: Response) => {
    res.json({ scopedUserId: (req as ScopedRequest).scopedUserId })
  })

  app.use((err: { status?: number; message?: string }, _req: Request, res: Response, _next: () => void) => {
    res.status(err.status ?? 500).json({ error: err.message })
  })

  return app
}

describe('userScope middleware', () => {
  it('sets scopedUserId to the authenticated user id by default', async () => {
    const app = buildApp('user-1')
    const res = await request(app).get('/resource').expect(200)
    expect(res.body.scopedUserId).toBe('user-1')
  })

  it('scopes to own id when query param matches actor', async () => {
    const app = buildApp('user-1')
    const res = await request(app).get('/resource?userId=user-1').expect(200)
    expect(res.body.scopedUserId).toBe('user-1')
  })

  it('blocks non-privileged user from accessing another user\'s data via query param', async () => {
    const app = buildApp('user-1', 'tenant')
    const res = await request(app).get('/resource?userId=user-2').expect(403)
    expect(res.body.error).toMatch(/not allowed/i)
  })

  it('blocks non-privileged user from accessing another user\'s data via route param', async () => {
    const app = buildApp('user-1', 'tenant')
    const res = await request(app).get('/resource/user-2').expect(403)
    expect(res.body.error).toMatch(/not allowed/i)
  })

  it('allows agent to access another user\'s data via route param', async () => {
    const app = buildApp('admin-1', 'agent')
    const res = await request(app).get('/resource/user-2').expect(200)
    expect(res.body.scopedUserId).toBe('user-2')
  })

  it('allows agent to access another user\'s data via query param', async () => {
    const app = buildApp('admin-1', 'agent')
    const res = await request(app).get('/resource?userId=user-99').expect(200)
    expect(res.body.scopedUserId).toBe('user-99')
  })

  it('returns 401 when req.user is not set', async () => {
    const app = express()
    app.use(userScope)
    app.use((err: { status?: number; message?: string }, _req: Request, res: Response, _next: () => void) => {
      res.status(err.status ?? 500).json({ error: err.message })
    })
    const res = await request(app).get('/resource').expect(401)
    expect(res.body.error).toMatch(/authentication required/i)
  })

  it('prefers route :userId over query ?userId', async () => {
    const app = buildApp('admin-1', 'agent')
    const res = await request(app).get('/resource/user-A?userId=user-B').expect(200)
    expect(res.body.scopedUserId).toBe('user-A')
  })
})
