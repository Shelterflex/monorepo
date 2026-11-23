import type { Express } from 'express'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { env } from '../schemas/env.js'

describe('Versioned routes mount and backward compatibility (#2086)', () => {
  const testApp = createApp()

  describe('Versioned /api/v1 endpoints response check', () => {
    it('GET /api/v1/listings/search is reachable and returns success', async () => {
      const res = await request(testApp).get('/api/v1/listings/search')
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('GET /api/v1/notifications responds (requires auth)', async () => {
      const res = await request(testApp).get('/api/v1/notifications')
      expect(res.status).toBe(401)
    })

    it('GET /api/v1/notifications/unread-count responds (requires auth)', async () => {
      const res = await request(testApp).get('/api/v1/notifications/unread-count')
      expect(res.status).toBe(401)
    })

    it('POST /api/v1/kyc responds (requires auth)', async () => {
      const res = await request(testApp).post('/api/v1/kyc')
      expect(res.status).toBe(401)
    })

    it('GET /api/v1/tenant/payments/wallet responds (requires auth)', async () => {
      const res = await request(testApp).get('/api/v1/tenant/payments/wallet')
      expect(res.status).toBe(401)
    })

    it('POST /api/v1/tenant/onboarding/submit responds (requires auth)', async () => {
      const res = await request(testApp).post('/api/v1/tenant/onboarding/submit')
      expect(res.status).toBe(401)
    })

    it('GET /api/v1/onboarding/status responds (requires auth)', async () => {
      const res = await request(testApp).get('/api/v1/onboarding/status')
      expect(res.status).toBe(401)
    })

    it('POST /api/v1/webhooks/kyc/:provider is reachable on versioned path', async () => {
      const res = await request(testApp).post('/api/v1/webhooks/kyc/testprovider').send({})
      expect(res.status).toBe(200)
      expect(res.body.received).toBe(true)
    })

    it('POST /api/webhooks/kyc/:provider remains directly reachable on unversioned path for providers', async () => {
      const res = await request(testApp).post('/api/webhooks/kyc/testprovider').send({})
      expect(res.status).toBe(200)
      expect(res.body.received).toBe(true)
    })
  })

  describe('307 Redirects in non-test environments', () => {
    let prodApp: Express

    beforeAll(() => {
      const prevEnv = env.NODE_ENV
      ;(env as any).NODE_ENV = 'development'
      try {
        prodApp = createApp()
      } finally {
        ;(env as any).NODE_ENV = prevEnv
      }
    })

    afterAll(async () => {
      ;(env as any).NODE_ENV = 'test'
      if (prodApp?.locals?.shutdownWorkers) {
        await prodApp.locals.shutdownWorkers()
      }
    })

    beforeEach(() => {
      ;(env as any).NODE_ENV = 'development'
    })

    afterEach(() => {
      ;(env as any).NODE_ENV = 'test'
    })

    it('redirects unversioned /api/listings/search to /api/v1/listings/search with 307 and deprecation headers', async () => {
      const res = await request(prodApp).get('/api/listings/search')
      expect(res.status).toBe(307)
      expect(res.headers.location).toBe('/api/v1/listings/search')
      expect(res.headers.deprecation).toBe('true')
      expect(res.headers.link).toBe('</api/v1>; rel="successor-version"')
      expect(res.headers.sunset).toBeDefined()
    })

    it('redirects unversioned /api/notifications to /api/v1/notifications with 307', async () => {
      const res = await request(prodApp).get('/api/notifications')
      expect(res.status).toBe(307)
      expect(res.headers.location).toBe('/api/v1/notifications')
      expect(res.headers.deprecation).toBe('true')
    })

    it('redirects unversioned /api/tenant/payments/wallet to /api/v1/tenant/payments/wallet with 307', async () => {
      const res = await request(prodApp).get('/api/tenant/payments/wallet')
      expect(res.status).toBe(307)
      expect(res.headers.location).toBe('/api/v1/tenant/payments/wallet')
    })

    it('redirects unversioned /api/onboarding/status to /api/v1/onboarding/status with 307', async () => {
      const res = await request(prodApp).get('/api/onboarding/status')
      expect(res.status).toBe(307)
      expect(res.headers.location).toBe('/api/v1/onboarding/status')
    })

    it('redirects unversioned /api/kyc/status to /api/v1/kyc/status with 307', async () => {
      const res = await request(prodApp).get('/api/kyc/status')
      expect(res.status).toBe(307)
      expect(res.headers.location).toBe('/api/v1/kyc/status')
    })

    it('redirects unversioned /api/tenant/onboarding/submit to /api/v1/tenant/onboarding/submit with 307', async () => {
      const res = await request(prodApp).post('/api/tenant/onboarding/submit').send({})
      expect(res.status).toBe(307)
      expect(res.headers.location).toBe('/api/v1/tenant/onboarding/submit')
    })
  })
})
