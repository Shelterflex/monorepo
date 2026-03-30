import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CircuitBreaker, CircuitBreakerConfig } from './circuit-breaker.js'

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker
  let config: CircuitBreakerConfig

  beforeEach(() => {
    config = {
      failureThreshold: 3,
      timeoutPeriod: 100, // 100ms for testing
      halfOpenTestRequests: 1,
      enabled: true,
    }
    circuitBreaker = new CircuitBreaker(config)
  })

  describe('Initial State', () => {
    it('should start in CLOSED state', () => {
      expect(circuitBreaker.getState()).toBe('CLOSED')
    })

    it('should have zero failures initially', () => {
      const metrics = circuitBreaker.getMetrics()
      expect(metrics.consecutiveFailures).toBe(0)
      expect(metrics.totalAttempts).toBe(0)
      expect(metrics.totalSuccesses).toBe(0)
      expect(metrics.totalFailures).toBe(0)
    })

    it('should allow calls when CLOSED', async () => {
      const allowed = await circuitBreaker.shouldAllowCall()
      expect(allowed).toBe(true)
    })
  })

  describe('Failure Detection and Counter', () => {
    it('should increment failure counter on transient error', async () => {
      const error = new Error('timeout')
      await circuitBreaker.recordFailure(error)

      const metrics = circuitBreaker.getMetrics()
      expect(metrics.consecutiveFailures).toBe(1)
      expect(metrics.totalFailures).toBe(1)
    })

    it('should not increment counter on permanent error', async () => {
      const error = new Error('HTTP 400')
      Object.assign(error, { status: 400 })

      const incremented = await circuitBreaker.recordFailure(error)
      expect(incremented).toBe(false)

      const metrics = circuitBreaker.getMetrics()
      expect(metrics.consecutiveFailures).toBe(0)
      expect(metrics.totalFailures).toBe(1)
    })

    it('should reset failure counter on success in CLOSED state', async () => {
      // Record some failures
      await circuitBreaker.recordFailure(new Error('timeout'))
      await circuitBreaker.recordFailure(new Error('timeout'))

      let metrics = circuitBreaker.getMetrics()
      expect(metrics.consecutiveFailures).toBe(2)

      // Record success
      await circuitBreaker.recordSuccess()

      metrics = circuitBreaker.getMetrics()
      expect(metrics.consecutiveFailures).toBe(0)
      expect(metrics.totalSuccesses).toBe(1)
    })

    it('should track total attempts and successes', async () => {
      await circuitBreaker.recordSuccess()
      await circuitBreaker.recordSuccess()
      await circuitBreaker.recordFailure(new Error('timeout'))

      const metrics = circuitBreaker.getMetrics()
      expect(metrics.totalAttempts).toBe(3)
      expect(metrics.totalSuccesses).toBe(2)
      expect(metrics.totalFailures).toBe(1)
    })
  })

  describe('Circuit Opening', () => {
    it('should transition to OPEN when failure threshold is reached', async () => {
      expect(circuitBreaker.getState()).toBe('CLOSED')

      // Record failures up to threshold
      for (let i = 0; i < config.failureThreshold; i++) {
        await circuitBreaker.recordFailure(new Error('timeout'))
      }

      expect(circuitBreaker.getState()).toBe('OPEN')
    })

    it('should record openedAt timestamp when opening', async () => {
      const beforeOpen = new Date()

      for (let i = 0; i < config.failureThreshold; i++) {
        await circuitBreaker.recordFailure(new Error('timeout'))
      }

      const metrics = circuitBreaker.getMetrics()
      expect(metrics.openedAt).not.toBeNull()
      expect(metrics.openedAt!.getTime()).toBeGreaterThanOrEqual(beforeOpen.getTime())
    })

    it('should reject calls when OPEN', async () => {
      // Open the circuit
      for (let i = 0; i < config.failureThreshold; i++) {
        await circuitBreaker.recordFailure(new Error('timeout'))
      }

      const allowed = await circuitBreaker.shouldAllowCall()
      expect(allowed).toBe(false)
    })

    it('should not open if failures are below threshold', async () => {
      for (let i = 0; i < config.failureThreshold - 1; i++) {
        await circuitBreaker.recordFailure(new Error('timeout'))
      }

      expect(circuitBreaker.getState()).toBe('CLOSED')
    })
  })

  describe('Half-Open State', () => {
    beforeEach(async () => {
      // Open the circuit
      for (let i = 0; i < config.failureThreshold; i++) {
        await circuitBreaker.recordFailure(new Error('timeout'))
      }
      expect(circuitBreaker.getState()).toBe('OPEN')
    })

    it('should transition to HALF_OPEN after timeout', async () => {
      await new Promise(resolve => setTimeout(resolve, config.timeoutPeriod + 10))
      await circuitBreaker.checkState()

      expect(circuitBreaker.getState()).toBe('HALF_OPEN')
    })

    it('should allow limited test requests in HALF_OPEN', async () => {
      await new Promise(resolve => setTimeout(resolve, config.timeoutPeriod + 10))
      await circuitBreaker.checkState()

      const allowed1 = await circuitBreaker.shouldAllowCall()
      expect(allowed1).toBe(true)

      const allowed2 = await circuitBreaker.shouldAllowCall()
      expect(allowed2).toBe(false)
    })

    it('should reject calls after test request limit in HALF_OPEN', async () => {
      await new Promise(resolve => setTimeout(resolve, config.timeoutPeriod + 10))
      await circuitBreaker.checkState()

      // Use up the test request
      await circuitBreaker.shouldAllowCall()

      // Next call should be rejected
      const allowed = await circuitBreaker.shouldAllowCall()
      expect(allowed).toBe(false)
    })

    it('should remain OPEN if timeout has not elapsed', async () => {
      // Wait less than timeout
      await new Promise(resolve => setTimeout(resolve, 50))
      await circuitBreaker.checkState()

      expect(circuitBreaker.getState()).toBe('OPEN')
    })
  })

  describe('Recovery from Half-Open', () => {
    beforeEach(async () => {
      // Open the circuit
      for (let i = 0; i < config.failureThreshold; i++) {
        await circuitBreaker.recordFailure(new Error('timeout'))
      }
      // Wait for timeout and transition to Half-Open
      await new Promise(resolve => setTimeout(resolve, config.timeoutPeriod + 10))
      await circuitBreaker.checkState()
    })

    it('should transition to CLOSED on success in HALF_OPEN', async () => {
      expect(circuitBreaker.getState()).toBe('HALF_OPEN')

      await circuitBreaker.recordSuccess()

      expect(circuitBreaker.getState()).toBe('CLOSED')
    })

    it('should reset all counters on recovery', async () => {
      await circuitBreaker.recordSuccess()

      const metrics = circuitBreaker.getMetrics()
      expect(metrics.state).toBe('CLOSED')
      expect(metrics.consecutiveFailures).toBe(0)
      expect(metrics.openedAt).toBeNull()
    })

    it('should transition back to OPEN on failure in HALF_OPEN', async () => {
      expect(circuitBreaker.getState()).toBe('HALF_OPEN')

      await circuitBreaker.recordFailure(new Error('timeout'))

      expect(circuitBreaker.getState()).toBe('OPEN')
    })

    it('should reset timeout when reopening from HALF_OPEN', async () => {
      const firstOpenTime = circuitBreaker.getMetrics().openedAt!.getTime()

      // Fail in Half-Open
      await circuitBreaker.recordFailure(new Error('timeout'))

      const secondOpenTime = circuitBreaker.getMetrics().openedAt!.getTime()
      expect(secondOpenTime).toBeGreaterThan(firstOpenTime)
    })
  })

  describe('State Transitions', () => {
    it('should follow correct state machine: CLOSED -> OPEN -> HALF_OPEN -> CLOSED', async () => {
      // Start in CLOSED
      expect(circuitBreaker.getState()).toBe('CLOSED')

      // Transition to OPEN
      for (let i = 0; i < config.failureThreshold; i++) {
        await circuitBreaker.recordFailure(new Error('timeout'))
      }
      expect(circuitBreaker.getState()).toBe('OPEN')

      // Transition to HALF_OPEN
      await new Promise(resolve => setTimeout(resolve, config.timeoutPeriod + 10))
      await circuitBreaker.checkState()
      expect(circuitBreaker.getState()).toBe('HALF_OPEN')

      // Transition to CLOSED
      await circuitBreaker.recordSuccess()
      expect(circuitBreaker.getState()).toBe('CLOSED')
    })

    it('should track state transition timestamps', async () => {
      const beforeTransition = new Date()

      for (let i = 0; i < config.failureThreshold; i++) {
        await circuitBreaker.recordFailure(new Error('timeout'))
      }

      const metrics = circuitBreaker.getMetrics()
      expect(metrics.lastStateTransitionTime).not.toBeNull()
      expect(metrics.lastStateTransitionTime!.getTime()).toBeGreaterThanOrEqual(
        beforeTransition.getTime(),
      )
    })
  })

  describe('Reset State', () => {
    it('should reset to initial state', async () => {
      // Open the circuit
      for (let i = 0; i < config.failureThreshold; i++) {
        await circuitBreaker.recordFailure(new Error('timeout'))
      }

      expect(circuitBreaker.getState()).toBe('OPEN')

      // Reset
      await circuitBreaker.resetState()

      const metrics = circuitBreaker.getMetrics()
      expect(metrics.state).toBe('CLOSED')
      expect(metrics.consecutiveFailures).toBe(0)
      expect(metrics.totalAttempts).toBe(0)
      expect(metrics.totalSuccesses).toBe(0)
      expect(metrics.totalFailures).toBe(0)
      expect(metrics.openedAt).toBeNull()
    })
  })

  describe('Metrics', () => {
    it('should return consistent metrics snapshot', async () => {
      await circuitBreaker.recordSuccess()
      await circuitBreaker.recordFailure(new Error('timeout'))

      const metrics = circuitBreaker.getMetrics()
      expect(metrics.state).toBe('CLOSED')
      expect(metrics.totalAttempts).toBe(2)
      expect(metrics.totalSuccesses).toBe(1)
      expect(metrics.totalFailures).toBe(1)
      expect(metrics.consecutiveFailures).toBe(1)
    })

    it('should track half-open test requests remaining', async () => {
      // Open and transition to Half-Open
      for (let i = 0; i < config.failureThreshold; i++) {
        await circuitBreaker.recordFailure(new Error('timeout'))
      }
      await new Promise(resolve => setTimeout(resolve, config.timeoutPeriod + 10))
      await circuitBreaker.checkState()

      let metrics = circuitBreaker.getMetrics()
      expect(metrics.halfOpenTestRequestsRemaining).toBe(1)

      // Use a test request
      await circuitBreaker.shouldAllowCall()

      metrics = circuitBreaker.getMetrics()
      expect(metrics.halfOpenTestRequestsRemaining).toBe(0)
    })
  })

  describe('Error Classification', () => {
    it('should handle HTTP 429 as transient', async () => {
      const error = new Error('Too Many Requests')
      Object.assign(error, { status: 429 })

      const incremented = await circuitBreaker.recordFailure(error)
      expect(incremented).toBe(true)

      const metrics = circuitBreaker.getMetrics()
      expect(metrics.consecutiveFailures).toBe(1)
    })

    it('should handle HTTP 503 as transient', async () => {
      const error = new Error('Service Unavailable')
      Object.assign(error, { status: 503 })

      const incremented = await circuitBreaker.recordFailure(error)
      expect(incremented).toBe(true)

      const metrics = circuitBreaker.getMetrics()
      expect(metrics.consecutiveFailures).toBe(1)
    })

    it('should handle HTTP 504 as transient', async () => {
      const error = new Error('Gateway Timeout')
      Object.assign(error, { status: 504 })

      const incremented = await circuitBreaker.recordFailure(error)
      expect(incremented).toBe(true)

      const metrics = circuitBreaker.getMetrics()
      expect(metrics.consecutiveFailures).toBe(1)
    })

    it('should handle HTTP 400 as permanent', async () => {
      const error = new Error('Bad Request')
      Object.assign(error, { status: 400 })

      const incremented = await circuitBreaker.recordFailure(error)
      expect(incremented).toBe(false)

      const metrics = circuitBreaker.getMetrics()
      expect(metrics.consecutiveFailures).toBe(0)
    })

    it('should handle HTTP 401 as permanent', async () => {
      const error = new Error('Unauthorized')
      Object.assign(error, { status: 401 })

      const incremented = await circuitBreaker.recordFailure(error)
      expect(incremented).toBe(false)

      const metrics = circuitBreaker.getMetrics()
      expect(metrics.consecutiveFailures).toBe(0)
    })

    it('should handle HTTP 404 as permanent', async () => {
      const error = new Error('Not Found')
      Object.assign(error, { status: 404 })

      const incremented = await circuitBreaker.recordFailure(error)
      expect(incremented).toBe(false)

      const metrics = circuitBreaker.getMetrics()
      expect(metrics.consecutiveFailures).toBe(0)
    })

    it('should handle timeout as transient', async () => {
      const error = new Error('Request timeout')

      const incremented = await circuitBreaker.recordFailure(error)
      expect(incremented).toBe(true)

      const metrics = circuitBreaker.getMetrics()
      expect(metrics.consecutiveFailures).toBe(1)
    })

    it('should handle network errors as transient', async () => {
      const error = new Error('ECONNREFUSED')

      const incremented = await circuitBreaker.recordFailure(error)
      expect(incremented).toBe(true)

      const metrics = circuitBreaker.getMetrics()
      expect(metrics.consecutiveFailures).toBe(1)
    })

    it('should treat unknown errors as transient (fail-safe)', async () => {
      const error = new Error('Some unknown error')

      const incremented = await circuitBreaker.recordFailure(error)
      expect(incremented).toBe(true)

      const metrics = circuitBreaker.getMetrics()
      expect(metrics.consecutiveFailures).toBe(1)
    })
  })

  describe('Concurrent Operations', () => {
    it('should handle concurrent recordSuccess calls safely', async () => {
      const promises = Array(10)
        .fill(null)
        .map(() => circuitBreaker.recordSuccess())

      await Promise.all(promises)

      const metrics = circuitBreaker.getMetrics()
      expect(metrics.totalSuccesses).toBe(10)
      expect(metrics.totalAttempts).toBe(10)
    })

    it('should handle concurrent recordFailure calls safely', async () => {
      const promises = Array(5)
        .fill(null)
        .map(() => circuitBreaker.recordFailure(new Error('timeout')))

      await Promise.all(promises)

      const metrics = circuitBreaker.getMetrics()
      expect(metrics.totalFailures).toBe(5)
      expect(metrics.state).toBe('OPEN') // Should open after 3 failures (threshold)
    })

    it('should handle concurrent shouldAllowCall safely', async () => {
      const promises = Array(10)
        .fill(null)
        .map(() => circuitBreaker.shouldAllowCall())

      const results = await Promise.all(promises)

      // All should be allowed in CLOSED state
      expect(results.every(r => r === true)).toBe(true)
    })

    it('should handle mixed concurrent operations safely', async () => {
      const operations = [
        ...Array(3)
          .fill(null)
          .map(() => circuitBreaker.recordSuccess()),
        ...Array(2)
          .fill(null)
          .map(() => circuitBreaker.recordFailure(new Error('timeout'))),
        ...Array(5)
          .fill(null)
          .map(() => circuitBreaker.shouldAllowCall()),
      ]

      await Promise.all(operations)

      const metrics = circuitBreaker.getMetrics()
      expect(metrics.totalAttempts).toBeGreaterThan(0)
      expect(metrics.totalSuccesses).toBe(3)
      expect(metrics.totalFailures).toBe(2)
    })
  })
})
