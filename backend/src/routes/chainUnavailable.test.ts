import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import supertest, { type Response } from 'supertest'
import { createBalanceRouter } from './balance.js'
import { createAdminTimelockRouter } from './admin-timelock.js'
import { errorHandler } from '../middleware/errorHandler.js'
import { requestIdMiddleware } from '../middleware/requestId.js'
import { CircuitBreakerAdapter } from '../soroban/circuit-breaker-adapter.js'
import { TestSorobanAdapter } from '../soroban/test-adapter.js'
import { StubSorobanAdapter } from '../soroban/stub-adapter.js'
import { getSorobanConfigFromEnv } from '../soroban/client.js'
import { SorobanAdapter } from '../soroban/adapter.js'
import { StubTimelockRepository } from '../indexer/timelock-repository.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { RawReceiptEvent } from '../indexer/event-parser.js'
import { SorobanConfig } from '../soroban/client.js'
import { RecordReceiptParams } from '../soroban/adapter.js'

// Mock auth middleware for balance routes
vi.mock('../middleware/auth.js', () => ({
  authenticateToken: (req: any, res: any, next: any) => {
    req.user = {
      id: 'test-user',
      email: 'test@example.com',
      name: 'Test User',
      role: 'tenant',
    }
    next()
  },
  requirePermission: (resource: string, action: string) => (req: any, res: any, next: any) => {
    next()
  },
}))

const SAFE_MESSAGE =
  'The blockchain is temporarily unavailable. Please try again shortly.'

function expectChainUnavailableResponse(res: Response) {
  expect(res.status).toBe(503)
  expect(res.body.error.code).toBe(ErrorCode.CHAIN_UNAVAILABLE)
  expect(res.body.error.message).toBe(SAFE_MESSAGE)
  expect(res.body.error.classification).toBe('transient')
  expect(res.body.error.retryable).toBe(true)
  expect(res.headers['retry-after']).toBe('5')
  expect(JSON.stringify(res.body)).not.toMatch(/circuit breaker|timeout|stack/i)
}

class TimeoutSorobanAdapter implements SorobanAdapter {
  constructor(private readonly config: SorobanConfig) {}

  private fail(): never {
    throw new Error('RPC request timed out after 30000ms')
  }

  async getBalance(): Promise<bigint> {
    this.fail()
  }

  async credit(): Promise<void> {
    this.fail()
  }

  async debit(): Promise<void> {
    this.fail()
  }

  async getStakedBalance(): Promise<bigint> {
    this.fail()
  }

  async getClaimableRewards(): Promise<bigint> {
    this.fail()
  }

  async recordReceipt(): Promise<void> {
    this.fail()
  }

  getConfig(): SorobanConfig {
    return this.config
  }

  async getReceiptEvents(): Promise<RawReceiptEvent[]> {
    this.fail()
  }

  async getTimelockEvents(): Promise<any[]> {
    this.fail()
  }

  async executeTimelock(): Promise<string> {
    this.fail()
  }

  async cancelTimelock(): Promise<string> {
    this.fail()
  }

  async stakeBond(): Promise<void> {
    this.fail()
  }

  async unstakeBond(): Promise<void> {
    this.fail()
  }

  async isBonded(): Promise<boolean> {
    this.fail()
  }

  async getBond(): Promise<{ isBonded: boolean; amount: bigint }> {
    this.fail()
  }
}

function buildBalanceApp(adapter: SorobanAdapter) {
  const app = express()
  app.use(requestIdMiddleware)
  app.use('/api', createBalanceRouter(adapter))
  app.use(errorHandler)
  return app
}

function buildTimelockApp(adapter: SorobanAdapter, repo: StubTimelockRepository) {
  const app = express()
  app.use(express.json())
  app.use(requestIdMiddleware)
  app.use('/api/v1/admin/timelock', createAdminTimelockRouter(adapter, repo))
  app.use(errorHandler)
  return app
}

describe('chain-dependent routes when Soroban RPC is unavailable', () => {
  const config = getSorobanConfigFromEnv(process.env)

  beforeEach(() => {
    StubSorobanAdapter._testOnlyReset()
    process.env.MANUAL_ADMIN_SECRET = 'test_secret'
  })

  afterEach(() => {
    delete process.env.MANUAL_ADMIN_SECRET
  })

  describe('GET /api/balance/:account', () => {
    it('returns canonical 503 when the circuit breaker is open', async () => {
      const failingAdapter = new TimeoutSorobanAdapter(config)
      const adapter = new CircuitBreakerAdapter(failingAdapter, {
        enabled: true,
        failureThreshold: 1,
        timeoutPeriod: 60_000,
        halfOpenTestRequests: 1,
      })

      await expect(adapter.getBalance('test-user')).rejects.toThrow()
      const app = buildBalanceApp(adapter)

      const res = await supertest(app).get('/api/balance/test-user')
      expectChainUnavailableResponse(res)
    })

    it('returns canonical 503 on RPC timeout', async () => {
      const adapter = new TestSorobanAdapter(config)
      adapter.simulateRpcTimeout()
      const app = buildBalanceApp(adapter)

      const res = await supertest(app).get('/api/balance/test-user')
      expectChainUnavailableResponse(res)
    })
  })
})
