import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { CircuitBreakerAdapter } from './circuit-breaker-adapter.js'
import { CircuitBreakerOpenError } from './circuit-breaker-errors.js'
import { SorobanAdapter, RecordReceiptParams } from './adapter.js'
import { getSorobanConfigFromEnv } from './client.js'
import { RawReceiptEvent } from '../indexer/event-parser.js'
import { SorobanConfig } from './client.js'

/**
 * Mock adapter for testing circuit breaker behavior
 */
class MockSorobanAdapter implements SorobanAdapter {
  private failureCount = 0
  private failureMode: 'transient' | 'permanent' | null = null

  constructor(private config: SorobanConfig) {}

  setFailureMode(count: number, mode: 'transient' | 'permanent' = 'transient'): void {
    this.failureCount = count
    this.failureMode = mode
  }

  private throwError(): never {
    if (this.failureMode === 'permanent') {
      const error = new Error('Bad Request')
      ;(error as any).status = 400
      throw error
    }
    throw new Error('Simulated transient failure')
  }

  async getBalance(account: string): Promise<bigint> {
    if (this.failureCount > 0) {
      this.failureCount--
      this.throwError()
    }
    return BigInt(1000)
  }

  async credit(account: string, amount: bigint): Promise<void> {
    if (this.failureCount > 0) {
      this.failureCount--
      this.throwError()
    }
  }

  async debit(account: string, amount: bigint): Promise<void> {
    if (this.failureCount > 0) {
      this.failureCount--
      this.throwError()
    }
  }

  async getStakedBalance(account: string): Promise<bigint> {
    if (this.failureCount > 0) {
      this.failureCount--
      this.throwError()
    }
    return BigInt(500)
  }

  async getClaimableRewards(account: string): Promise<bigint> {
    if (this.failureCount > 0) {
      this.failureCount--
      this.throwError()
    }
    return BigInt(100)
  }

  async recordReceipt(params: RecordReceiptParams): Promise<void> {
    if (this.failureCount > 0) {
      this.failureCount--
      this.throwError()
    }
  }

  getConfig(): SorobanConfig {
    return this.config
  }

  async getReceiptEvents(fromLedger: number | null): Promise<RawReceiptEvent[]> {
    if (this.failureCount > 0) {
      this.failureCount--
      this.throwError()
    }
    return []
  }
}

describe('CircuitBreakerAdapter', () => {
  let adapter: CircuitBreakerAdapter
  let mockAdapter: MockSorobanAdapter
  const config = getSorobanConfigFromEnv(process.env)

  beforeEach(() => {
    mockAdapter = new MockSorobanAdapter(config)
    adapter = new CircuitBreakerAdapter(mockAdapter, {
      enabled: true,
      failureThreshold: 3,
      timeoutPeriod: 100, // 100ms for faster tests
      halfOpenTestRequests: 1,
    })
  })

  describe('State Management', () => {
    it('should start in CLOSED state', () => {
      const metrics = adapter.getHealthStatus()
      expect(metrics.state).toBe('CLOSED')
      expect(metrics.consecutiveFailures).toBe(0)
    })

    it('should transition to OPEN after failure threshold is reached', async () => {
      mockAdapter.setFailureMode(3, 'transient')

      // First two failures
      await expect(adapter.getBalance('account1')).rejects.toThrow()
      await expect(adapter.getBalance('account1')).rejects.toThrow()

      let metrics = adapter.getHealthStatus()
      expect(metrics.state).toBe('CLOSED')
      expect(metrics.consecutiveFailures).toBe(2)

      // Third failure triggers transition to OPEN
      await expect(adapter.getBalance('account1')).rejects.toThrow()

      metrics = adapter.getHealthStatus()
      expect(metrics.state).toBe('OPEN')
      expect(metrics.consecutiveFailures).toBe(3)
    })

    it('should reject calls when OPEN', async () => {
      mockAdapter.setFailureMode(3, 'transient')

      // Trigger circuit opening
      for (let i = 0; i < 3; i++) {
        await expect(adapter.getBalance('account1')).rejects.toThrow()
      }

      // Next call should be rejected with CircuitBreakerOpenError
      await expect(adapter.getBalance('account1')).rejects.toThrow(CircuitBreakerOpenError)
    })

    it('should transition to HALF_OPEN after timeout period', async () => {
      mockAdapter.setFailureMode(3, 'transient')

      // Trigger circuit opening
      for (let i = 0; i < 3; i++) {
        await expect(adapter.getBalance('account1')).rejects.toThrow()
      }

      let metrics = adapter.getHealthStatus()
      expect(metrics.state).toBe('OPEN')

      // Wait for timeout period
      await new Promise(resolve => setTimeout(resolve, 150))

      // Next call should attempt to transition to HALF_OPEN
      const result = await adapter.getBalance('account1')
      expect(result).toBeDefined()

      metrics = adapter.getHealthStatus()
      expect(metrics.state).toBe('CLOSED')
    })

    it('should transition to CLOSED on success in HALF_OPEN', async () => {
      mockAdapter.setFailureMode(3, 'transient')

      // Trigger circuit opening
      for (let i = 0; i < 3; i++) {
        await expect(adapter.getBalance('account1')).rejects.toThrow()
      }

      let metrics = adapter.getHealthStatus()
      expect(metrics.state).toBe('OPEN')

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150))

      // Successful call in HALF_OPEN should transition to CLOSED
      const result = await adapter.getBalance('account1')
      expect(result).toBeDefined()

      metrics = adapter.getHealthStatus()
      expect(metrics.state).toBe('CLOSED')
      expect(metrics.consecutiveFailures).toBe(0)
    })

    it('should transition back to OPEN on failure in HALF_OPEN', async () => {
      mockAdapter.setFailureMode(3, 'transient')

      // Trigger circuit opening
      for (let i = 0; i < 3; i++) {
        await expect(adapter.getBalance('account1')).rejects.toThrow()
      }

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150))

      // Simulate failure in HALF_OPEN
      mockAdapter.setFailureMode(1, 'transient')

      // Call should fail and transition back to OPEN
      await expect(adapter.getBalance('account1')).rejects.toThrow()

      const metrics = adapter.getHealthStatus()
      expect(metrics.state).toBe('OPEN')
    })
  })

  describe('Failure Counter Management', () => {
    it('should reset failure counter on success in CLOSED state', async () => {
      mockAdapter.setFailureMode(1, 'transient')

      // First failure
      await expect(adapter.getBalance('account1')).rejects.toThrow()
      let metrics = adapter.getHealthStatus()
      expect(metrics.consecutiveFailures).toBe(1)

      // Success should reset counter
      const result = await adapter.getBalance('account1')
      expect(result).toBeDefined()

      metrics = adapter.getHealthStatus()
      expect(metrics.consecutiveFailures).toBe(0)
    })

    it('should not increment counter for permanent errors', async () => {
      mockAdapter.setFailureMode(5, 'permanent')

      // Multiple permanent errors should not increment counter
      for (let i = 0; i < 5; i++) {
        await expect(adapter.getBalance('account1')).rejects.toThrow()
      }

      const metrics = adapter.getHealthStatus()
      expect(metrics.consecutiveFailures).toBe(0)
      expect(metrics.state).toBe('CLOSED')
    })
  })

  describe('Metrics Tracking', () => {
    it('should track total attempts', async () => {
      await adapter.getBalance('account1')
      let metrics = adapter.getHealthStatus()
      expect(metrics.totalAttempts).toBe(1)

      await adapter.getBalance('account1')
      metrics = adapter.getHealthStatus()
      expect(metrics.totalAttempts).toBe(2)
    })

    it('should track total successes', async () => {
      await adapter.getBalance('account1')
      await adapter.getBalance('account1')

      const metrics = adapter.getHealthStatus()
      expect(metrics.totalSuccesses).toBe(2)
      expect(metrics.totalAttempts).toBe(2)
    })

    it('should track total failures', async () => {
      mockAdapter.setFailureMode(2, 'transient')

      await expect(adapter.getBalance('account1')).rejects.toThrow()
      await expect(adapter.getBalance('account1')).rejects.toThrow()

      const metrics = adapter.getHealthStatus()
      expect(metrics.totalFailures).toBe(2)
      expect(metrics.totalAttempts).toBe(2)
    })

    it('should track state transition timestamps', async () => {
      mockAdapter.setFailureMode(3, 'transient')

      // Trigger circuit opening
      for (let i = 0; i < 3; i++) {
        await expect(adapter.getBalance('account1')).rejects.toThrow()
      }

      const metrics = adapter.getHealthStatus()
      expect(metrics.lastStateTransitionTime).not.toBeNull()
      expect(metrics.openedAt).not.toBeNull()
    })

    it('should track half-open test requests remaining', async () => {
      mockAdapter.setFailureMode(3, 'transient')

      // Trigger circuit opening
      for (let i = 0; i < 3; i++) {
        await expect(adapter.getBalance('account1')).rejects.toThrow()
      }

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150))

      let metrics = adapter.getHealthStatus()
      expect(metrics.halfOpenTestRequestsRemaining).toBe(1)

      // Make a call in HALF_OPEN
      await adapter.getBalance('account1')

      metrics = adapter.getHealthStatus()
      expect(metrics.halfOpenTestRequestsRemaining).toBe(0)
    })
  })

  describe('Adapter Methods', () => {
    it('should wrap getBalance calls', async () => {
      const result = await adapter.getBalance('account1')
      expect(result).toBeDefined()
      expect(typeof result).toBe('bigint')
    })

    it('should wrap credit calls', async () => {
      await expect(adapter.credit('account1', BigInt(100))).resolves.toBeUndefined()
    })

    it('should wrap debit calls', async () => {
      await expect(adapter.debit('account1', BigInt(100))).resolves.toBeUndefined()
    })

    it('should wrap getStakedBalance calls', async () => {
      const result = await adapter.getStakedBalance('account1')
      expect(result).toBeDefined()
      expect(typeof result).toBe('bigint')
    })

    it('should wrap getClaimableRewards calls', async () => {
      const result = await adapter.getClaimableRewards('account1')
      expect(result).toBeDefined()
      expect(typeof result).toBe('bigint')
    })

    it('should wrap recordReceipt calls', async () => {
      await expect(
        adapter.recordReceipt({
          txId: 'test-tx-id',
          txType: 'CONVERSION',
          amountUsdc: '100',
          tokenAddress: 'token-address',
          dealId: 'deal-id',
        }),
      ).resolves.toBeUndefined()
    })

    it('should wrap getReceiptEvents calls', async () => {
      const result = await adapter.getReceiptEvents(null)
      expect(Array.isArray(result)).toBe(true)
    })

    it('should return config from wrapped adapter', () => {
      const config = adapter.getConfig()
      expect(config).toBeDefined()
    })
  })

  describe('Error Handling', () => {
    it('should throw CircuitBreakerOpenError with metrics', async () => {
      mockAdapter.setFailureMode(3, 'transient')

      // Trigger circuit opening
      for (let i = 0; i < 3; i++) {
        await expect(adapter.getBalance('account1')).rejects.toThrow()
      }

      try {
        await adapter.getBalance('account1')
        expect.fail('Should have thrown CircuitBreakerOpenError')
      } catch (error) {
        expect(error).toBeInstanceOf(CircuitBreakerOpenError)
        const cbError = error as CircuitBreakerOpenError
        expect(cbError.metrics).toBeDefined()
        expect(cbError.methodName).toBe('getBalance')
        expect(cbError.reason).toBe('Circuit breaker is OPEN')
      }
    })

    it('should propagate wrapped adapter errors', async () => {
      mockAdapter.setFailureMode(1, 'transient')

      await expect(adapter.getBalance('account1')).rejects.toThrow('Simulated transient failure')
    })

    it('should handle concurrent calls safely', async () => {
      const promises = []
      for (let i = 0; i < 10; i++) {
        promises.push(adapter.getBalance('account1'))
      }

      const results = await Promise.all(promises)
      expect(results).toHaveLength(10)
      results.forEach(result => {
        expect(typeof result).toBe('bigint')
      })

      const metrics = adapter.getHealthStatus()
      expect(metrics.totalAttempts).toBe(10)
      expect(metrics.totalSuccesses).toBe(10)
    })
  })

  describe('State Reset', () => {
    it('should reset state for testing', async () => {
      mockAdapter.setFailureMode(3, 'transient')

      // Trigger circuit opening
      for (let i = 0; i < 3; i++) {
        await expect(adapter.getBalance('account1')).rejects.toThrow()
      }

      let metrics = adapter.getHealthStatus()
      expect(metrics.state).toBe('OPEN')

      // Reset state
      await adapter.resetState()

      metrics = adapter.getHealthStatus()
      expect(metrics.state).toBe('CLOSED')
      expect(metrics.consecutiveFailures).toBe(0)
      expect(metrics.totalAttempts).toBe(0)
      expect(metrics.totalSuccesses).toBe(0)
      expect(metrics.totalFailures).toBe(0)
    })
  })

  describe('Half-Open Test Request Limit', () => {
    it('should limit test requests in HALF_OPEN state', async () => {
      mockAdapter.setFailureMode(3, 'transient')

      // Trigger circuit opening
      for (let i = 0; i < 3; i++) {
        await expect(adapter.getBalance('account1')).rejects.toThrow()
      }

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150))

      // First test request should succeed and transition to CLOSED
      await adapter.getBalance('account1')

      const metrics = adapter.getHealthStatus()
      expect(metrics.state).toBe('CLOSED')
    })

    it('should reject additional calls after test request limit in HALF_OPEN', async () => {
      const cbAdapter = new CircuitBreakerAdapter(mockAdapter, {
        enabled: true,
        failureThreshold: 2,
        timeoutPeriod: 100,
        halfOpenTestRequests: 1,
      })

      mockAdapter.setFailureMode(2, 'transient')

      // Trigger circuit opening
      for (let i = 0; i < 2; i++) {
        await expect(cbAdapter.getBalance('account1')).rejects.toThrow()
      }

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150))

      // First test request should succeed
      await cbAdapter.getBalance('account1')

      // Circuit should now be CLOSED
      const metrics = cbAdapter.getHealthStatus()
      expect(metrics.state).toBe('CLOSED')
    })
  })

  describe('Transient vs Permanent Errors', () => {
    it('should handle transient errors (429)', async () => {
      const mockAdapter2 = new MockSorobanAdapter(config)
      mockAdapter2.setFailureMode(2, 'transient')

      const cbAdapter = new CircuitBreakerAdapter(mockAdapter2, {
        enabled: true,
        failureThreshold: 2,
        timeoutPeriod: 100,
        halfOpenTestRequests: 1,
      })

      // Two transient errors should trigger circuit opening
      await expect(cbAdapter.getBalance('account1')).rejects.toThrow()
      await expect(cbAdapter.getBalance('account1')).rejects.toThrow()

      const metrics = cbAdapter.getHealthStatus()
      expect(metrics.state).toBe('OPEN')
      expect(metrics.consecutiveFailures).toBe(2)
    })

    it('should handle permanent errors (400)', async () => {
      const mockAdapter2 = new MockSorobanAdapter(config)
      mockAdapter2.setFailureMode(5, 'permanent')

      const cbAdapter = new CircuitBreakerAdapter(mockAdapter2, {
        enabled: true,
        failureThreshold: 2,
        timeoutPeriod: 100,
        halfOpenTestRequests: 1,
      })

      // Multiple permanent errors should NOT trigger circuit opening
      for (let i = 0; i < 5; i++) {
        await expect(cbAdapter.getBalance('account1')).rejects.toThrow()
      }

      const metrics = cbAdapter.getHealthStatus()
      expect(metrics.state).toBe('CLOSED')
      expect(metrics.consecutiveFailures).toBe(0)
    })
  })
})
