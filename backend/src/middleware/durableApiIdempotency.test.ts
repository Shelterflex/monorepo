import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import express, { type Express } from 'express'
import request from 'supertest'
import { durableApiIdempotency } from './durableApiIdempotency.js'
import { _resetDurableIdempotencyMemory } from '../services/durableIdempotencyService.js'
import { ErrorCode } from '../errors/errorCodes.js'

const here = dirname(fileURLToPath(import.meta.url))

interface Counter {
  runs: number
}

/**
 * One "instance": its own express app and its own middleware, sharing nothing
 * with other instances except the durable idempotency record.
 */
function buildInstance(
  counter: Counter,
  opts: {
    status?: () => number
    delayMs?: number
    user?: string
    requireKey?: boolean
  } = {},
): Express {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    ;(req as { user?: { id: string } }).user = { id: opts.user ?? 'user-1' }
    next()
  })
  const router = express.Router()
  router.post(
    '/pay',
    durableApiIdempotency({ requireKey: opts.requireKey ?? true }),
    async (req, res) => {
      counter.runs += 1
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
      res.status(opts.status?.() ?? 201).json({ ok: true, run: counter.runs, amount: req.body?.amount })
    },
  )
  router.post('/refund', durableApiIdempotency({ requireKey: true }), (_req, res) => {
    counter.runs += 1
    res.status(201).json({ ok: true, run: counter.runs })
  })
  app.use('/api', router)
  return app
}

beforeEach(() => {
  _resetDurableIdempotencyMemory()
})

afterEach(() => {
  _resetDurableIdempotencyMemory()
})

describe('durableApiIdempotency (#1946)', () => {
  it('executes a retried request once, even when the retry reaches another instance', async () => {
    const counter: Counter = { runs: 0 }
    const instanceA = buildInstance(counter)
    const instanceB = buildInstance(counter)
    const key = randomUUID()

    const first = await request(instanceA).post('/api/pay').set('Idempotency-Key', key).send({ amount: 100 })
    const retry = await request(instanceB).post('/api/pay').set('Idempotency-Key', key).send({ amount: 100 })

    expect(first.status).toBe(201)
    expect(first.headers['x-idempotent-replay']).toBeUndefined()
    expect(retry.status).toBe(201)
    expect(retry.headers['x-idempotent-replay']).toBe('true')
    expect(retry.body).toEqual(first.body)
    expect(counter.runs).toBe(1)
  })

  it('runs a concurrent duplicate once across instances and rejects the other with 409', async () => {
    const counter: Counter = { runs: 0 }
    const instanceA = buildInstance(counter, { delayMs: 150 })
    const instanceB = buildInstance(counter, { delayMs: 150 })
    const key = randomUUID()

    const [a, b] = await Promise.all([
      request(instanceA).post('/api/pay').set('Idempotency-Key', key).send({ amount: 5 }),
      request(instanceB).post('/api/pay').set('Idempotency-Key', key).send({ amount: 5 }),
    ])

    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([201, 409])
    const rejected = a.status === 409 ? a : b
    expect(rejected.body.error.code).toBe(ErrorCode.REQUEST_IN_FLIGHT)
    expect(counter.runs).toBe(1)

    // Once the first finishes, a retry replays its response.
    const retry = await request(instanceB).post('/api/pay').set('Idempotency-Key', key).send({ amount: 5 })
    expect(retry.status).toBe(201)
    expect(retry.headers['x-idempotent-replay']).toBe('true')
    expect(counter.runs).toBe(1)
  })

  it('rejects the same key with a different body (409 CONFLICT) without executing', async () => {
    const counter: Counter = { runs: 0 }
    const instanceA = buildInstance(counter)
    const instanceB = buildInstance(counter)
    const key = randomUUID()

    await request(instanceA).post('/api/pay').set('Idempotency-Key', key).send({ amount: 100 })
    const reused = await request(instanceB).post('/api/pay').set('Idempotency-Key', key).send({ amount: 999 })

    expect(reused.status).toBe(409)
    expect(reused.body.error.code).toBe(ErrorCode.CONFLICT)
    expect(counter.runs).toBe(1)
  })

  it('scopes keys per user and per route', async () => {
    const counter: Counter = { runs: 0 }
    const alice = buildInstance(counter, { user: 'alice' })
    const bob = buildInstance(counter, { user: 'bob' })
    const key = randomUUID()

    await request(alice).post('/api/pay').set('Idempotency-Key', key).send({ amount: 1 })
    const otherUser = await request(bob).post('/api/pay').set('Idempotency-Key', key).send({ amount: 1 })
    const otherRoute = await request(alice).post('/api/refund').set('Idempotency-Key', key).send({})

    expect(otherUser.headers['x-idempotent-replay']).toBeUndefined()
    expect(otherRoute.headers['x-idempotent-replay']).toBeUndefined()
    expect(counter.runs).toBe(3)
  })

  it('does not cache a 5xx, so the client can retry and succeed', async () => {
    const counter: Counter = { runs: 0 }
    let status = 503
    const instance = buildInstance(counter, { status: () => status })
    const key = randomUUID()

    const failed = await request(instance).post('/api/pay').set('Idempotency-Key', key).send({ amount: 1 })
    status = 201
    const retried = await request(instance).post('/api/pay').set('Idempotency-Key', key).send({ amount: 1 })

    expect(failed.status).toBe(503)
    expect(retried.status).toBe(201)
    expect(retried.headers['x-idempotent-replay']).toBeUndefined()
    expect(counter.runs).toBe(2)
  })

  it('replays a 4xx response, as the in-memory middleware did', async () => {
    const counter: Counter = { runs: 0 }
    const instance = buildInstance(counter, { status: () => 422 })
    const key = randomUUID()

    await request(instance).post('/api/pay').set('Idempotency-Key', key).send({ amount: 1 })
    const retry = await request(instance).post('/api/pay').set('Idempotency-Key', key).send({ amount: 1 })

    expect(retry.status).toBe(422)
    expect(retry.headers['x-idempotent-replay']).toBe('true')
    expect(counter.runs).toBe(1)
  })

  it('requires a UUID Idempotency-Key when a key is required', async () => {
    const counter: Counter = { runs: 0 }
    const instance = buildInstance(counter)

    const missing = await request(instance).post('/api/pay').send({ amount: 1 })
    const malformed = await request(instance).post('/api/pay').set('Idempotency-Key', 'not-a-uuid').send({ amount: 1 })

    expect(missing.status).toBe(400)
    expect(missing.body.error.code).toBe(ErrorCode.VALIDATION_ERROR)
    expect(malformed.status).toBe(400)
    expect(counter.runs).toBe(0)
  })

  it('accepts the legacy x-idempotency-key header without UUID validation', async () => {
    const counter: Counter = { runs: 0 }
    const instance = buildInstance(counter)

    await request(instance).post('/api/pay').set('x-idempotency-key', 'legacy-key-1').send({ amount: 1 })
    const retry = await request(instance).post('/api/pay').set('x-idempotency-key', 'legacy-key-1').send({ amount: 1 })

    expect(retry.headers['x-idempotent-replay']).toBe('true')
    expect(counter.runs).toBe(1)
  })

  it('lets requests through without a key when it is not required', async () => {
    const counter: Counter = { runs: 0 }
    const instance = buildInstance(counter, { requireKey: false })

    await request(instance).post('/api/pay').send({ amount: 1 })
    await request(instance).post('/api/pay').send({ amount: 1 })

    expect(counter.runs).toBe(2)
  })
})

describe('money-moving routes do not use the in-memory idempotency store (#1946)', () => {
  const routes = ['payments', 'deposits', 'staking', 'deals']

  it.each(routes)('%s uses durable idempotency', (name) => {
    const source = readFileSync(join(here, '..', 'routes', `${name}.ts`), 'utf8')

    expect(source).not.toMatch(/middleware\/idempotency\.js/)
    expect(source).not.toMatch(/InMemoryIdempotencyStore/)
    expect(source).toMatch(/durableApiIdempotency\(\)/)
  })
})
