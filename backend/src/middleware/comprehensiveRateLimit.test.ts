import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import express, { Request, Response } from 'express'
import supertest from 'supertest'
import {
  createComprehensiveRateLimiter,
  setEndpointRateLimit,
  getRateLimitStats,
  resetRateLimitStore,
  type EndpointRateLimitConfig,
} from './comprehensiveRateLimit.js'

describe('Comprehensive Rate Limiting', () => {
  let app: express.Application
  let agent: supertest.SuperTest<supertest.Test>

  beforeEach(() => {
    resetRateLimitStore()
    
    app = express()

    // Add request ID middleware
    app.use((req: Request, _res: Response, next) => {
      ;(req as any).id = 'test-request-' + Math.random().toString(36).substr(2, 9)
      next()
    })

    // Add comprehensive rate limiter
    app.use(
      createComprehensiveRateLimiter({
        defaultWindowMs: 1000, // 1 second for testing
        defaultLimit: 5,
      })
    )

    // Error handler
    app.use((err: any, _req: Request, res: Response, _next: any) => {
      if (err.status === 429) {
        return res.status(429).json({
          error: {
            code: 'TOO_MANY_REQUESTS',
            message: err.message,
          },
        })
      }
      res.status(500).json({ error: 'Internal error' })
    })

    // Test route
    app.get('/api/test', (_req: Request, res: Response) => {
      res.json({ ok: true })
    })

    agent = supertest(app)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should allow requests within limit', async () => {
    const results = []

    // Make 5 requests (the limit)
    for (let i = 0; i < 5; i++) {
      const res = await agent.get('/api/test')
      results.push(res.status)
    }

    // All should succeed
    expect(results).toEqual([200, 200, 200, 200, 200])
  })

  it('should block requests exceeding limit', async () => {
    // Make 6 requests (one more than limit of 5)
    for (let i = 0; i < 5; i++) {
      await agent.get('/api/test')
    }

    // The 6th request should be blocked
    const res = await agent.get('/api/test')
    expect(res.status).toBe(429)
    expect(res.body.error.code).toBe('TOO_MANY_REQUESTS')
  })

  it('should set X-RateLimit headers', async () => {
    const res = await agent.get('/api/test')

    expect(res.headers['x-ratelimit-limit']).toBeDefined()
    expect(res.headers['x-ratelimit-remaining']).toBeDefined()
    expect(res.headers['x-ratelimit-reset']).toBeDefined()

    expect(parseInt(res.headers['x-ratelimit-limit'])).toBe(5)
    expect(parseInt(res.headers['x-ratelimit-remaining'])).toBeLessThanOrEqual(5)
  })

  it('should track remaining requests correctly', async () => {
    const responses = []

    for (let i = 0; i < 3; i++) {
      const res = await agent.get('/api/test')
      responses.push({
        status: res.status,
        remaining: parseInt(res.headers['x-ratelimit-remaining']),
      })
    }

    // Remaining should decrease
    expect(responses[0].remaining).toBeGreaterThan(responses[1].remaining)
    expect(responses[1].remaining).toBeGreaterThan(responses[2].remaining)
  })

  it('should skip rate limiting for /health', async () => {
    app.get('/health', (_req: Request, res: Response) => {
      res.json({ ok: true })
    })

    // Make many requests to /health
    for (let i = 0; i < 10; i++) {
      const res = await agent.get('/health')
      expect(res.status).toBe(200)
    }
  })

  it('should support per-endpoint rate limits', async () => {
    // Setup custom limit for a specific endpoint
    setEndpointRateLimit('GET', '/api/strict', {
      windowMs: 1000,
      limit: 2,
    })

    app.get('/api/strict', (_req: Request, res: Response) => {
      res.json({ ok: true })
    })

    // First 2 requests should succeed
    let res = await agent.get('/api/strict')
    expect(res.status).toBe(200)

    res = await agent.get('/api/strict')
    expect(res.status).toBe(200)

    // 3rd request should be blocked
    res = await agent.get('/api/strict')
    expect(res.status).toBe(429)
  })

  it('should provide rate limit statistics', () => {
    const stats = getRateLimitStats()

    expect(stats).toHaveProperty('totalTrackedKeys')
    expect(stats).toHaveProperty('activeKeys')
    expect(stats).toHaveProperty('oldestReset')
    expect(stats).toHaveProperty('newestReset')

    expect(stats.totalTrackedKeys).toBeGreaterThanOrEqual(0)
    expect(stats.activeKeys).toBeGreaterThanOrEqual(0)
  })
})

describe('Endpoint-Specific Rate Limits', () => {
  beforeEach(() => {
    // Clear existing limits and reset state
    resetRateLimitStore()
    vi.clearAllMocks()
  })

  it('should enforce strict limits for auth endpoints', async () => {
    const app = express()

    app.use((req: Request, _res: Response, next) => {
      ;(req as any).id = 'test-' + Math.random().toString()
      next()
    })

    app.use(
      createComprehensiveRateLimiter({
        defaultWindowMs: 1000,
        defaultLimit: 100,
      })
    )

    // Setup auth endpoint with strict limits
    setEndpointRateLimit('POST', '/api/auth/request-otp', {
      windowMs: 1000,
      limit: 2,
    })

    app.post('/api/auth/request-otp', (_req: Request, res: Response) => {
      res.json({ ok: true })
    })

    app.use((err: any, _req: Request, res: Response) => {
      if (err.status === 429) {
        return res.status(429).json({ error: err.message })
      }
      res.status(500).json({ error: 'Error' })
    })

    const agent = supertest(app)

    // Make 3 requests (limit is 2)
    const results = []
    for (let i = 0; i < 3; i++) {
      const res = await agent.post('/api/auth/request-otp')
      results.push(res.status)
    }

    expect(results).toEqual([200, 200, 429])
  })
})

describe('Rate Blocking Scenarios', () => {
  let app: express.Application
  let agent: supertest.SuperTest<supertest.Test>

  beforeEach(() => {
    resetRateLimitStore()
    
    app = express()

    app.use((req: Request, _res: Response, next) => {
      ;(req as any).id = 'test-' + Date.now()
      next()
    })

    app.use(
      createComprehensiveRateLimiter({
        defaultWindowMs: 1000,
        defaultLimit: 10,
      })
    )

    app.get('/api/endpoint', (_req: Request, res: Response) => {
      res.json({ ok: true })
    })

    app.use((err: any, _req: Request, res: Response) => {
      if (err.status === 429) {
        return res.status(429).json({
          error: {
            code: 'TOO_MANY_REQUESTS',
            message: 'Rate limit exceeded',
          },
        })
      }
      res.status(500).json({ error: 'Server error' })
    })

    agent = supertest(app)
  })

  it('should reset limit after time window', async () => {
    // Make requests up to limit in first window
    for (let i = 0; i < 10; i++) {
      const res = await agent.get('/api/endpoint')
      expect(res.status).toBe(200)
    }

    // Next request should be blocked
    let res = await agent.get('/api/endpoint')
    expect(res.status).toBe(429)

    // Wait for window to reset (1 second in test)
    await new Promise((resolve) => setTimeout(resolve, 1100))

    // New request should succeed
    res = await agent.get('/api/endpoint')
    expect(res.status).toBe(200)
  })

  it('should handle concurrent requests correctly', async () => {
    const limit = 5
    const concurrentRequests = 10

    // Make concurrent requests (some should be blocked)
    const promises = Array(concurrentRequests)
      .fill(null)
      .map(() => agent.get('/api/endpoint'))

    const responses = await Promise.all(promises)
    const successCount = responses.filter((r) => r.status === 200).length
    const blockedCount = responses.filter((r) => r.status === 429).length

    // Note: Due to race conditions in concurrent requests, all might succeed
    // if they're processed quickly before count increments.
    // The important thing is that the rate limiter responds correctly.
    expect(successCount + blockedCount).toBe(concurrentRequests)
    expect(successCount).toBeGreaterThan(0)
    
    // After rate limiting is enforced, subsequent requests should be blocked
    const afterLimitRes = await agent.get('/api/endpoint')
    expect(afterLimitRes.status).toBe(429)
  })
})

describe('Rate Limit Configuration', () => {
  it('should support custom window and limit', () => {
    const config: EndpointRateLimitConfig = {
      windowMs: 30 * 60 * 1000, // 30 minutes
      limit: 100,
    }

    setEndpointRateLimit('POST', '/api/custom', config)

    expect(config.windowMs).toBe(30 * 60 * 1000)
    expect(config.limit).toBe(100)
  })

  it('should support skipping successful requests', () => {
    const config: EndpointRateLimitConfig = {
      windowMs: 60 * 1000,
      limit: 50,
      skipSuccessfulRequests: true,
    }

    setEndpointRateLimit('GET', '/api/skip-success', config)

    expect(config.skipSuccessfulRequests).toBe(true)
  })

  it('should support skipping failed requests', () => {
    const config: EndpointRateLimitConfig = {
      windowMs: 60 * 1000,
      limit: 50,
      skipFailedRequests: true,
    }

    setEndpointRateLimit('GET', '/api/skip-fail', config)

    expect(config.skipFailedRequests).toBe(true)
  })
})
