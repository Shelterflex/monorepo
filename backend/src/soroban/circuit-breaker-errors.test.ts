import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  CircuitBreakerOpenError,
  classifyError,
  isTransientError,
  isPermanentError,
  logCircuitBreakerError,
  logStateTransition,
  logCircuitOpened,
  logCircuitRecovered,
  logPermanentError,
  type CircuitBreakerMetrics,
  type ErrorClassification,
} from './circuit-breaker-errors.js'
import { logger } from '../utils/logger.js'

// Mock logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

describe('CircuitBreakerOpenError', () => {
  let metrics: CircuitBreakerMetrics

  beforeEach(() => {
    metrics = {
      state: 'OPEN',
      consecutiveFailures: 5,
      totalAttempts: 10,
      totalSuccesses: 5,
      totalFailures: 5,
      lastStateTransitionTime: new Date(),
      openedAt: new Date(),
      halfOpenTestRequestsRemaining: 0,
    }
  })

  it('should create error with correct message', () => {
    const error = new CircuitBreakerOpenError(metrics, 'getBalance', 'Service unavailable')

    expect(error.name).toBe('CircuitBreakerOpenError')
    expect(error.message).toContain('Circuit breaker OPEN for getBalance')
    expect(error.message).toContain('Service unavailable')
    expect(error.message).toContain('State: OPEN')
    expect(error.message).toContain('Consecutive Failures: 5')
    expect(error.message).toContain('Total Attempts: 10')
  })

  it('should preserve metrics reference', () => {
    const error = new CircuitBreakerOpenError(metrics, 'credit', 'Timeout')

    expect(error.metrics).toBe(metrics)
    expect(error.methodName).toBe('credit')
    expect(error.reason).toBe('Timeout')
  })

  it('should be instanceof Error', () => {
    const error = new CircuitBreakerOpenError(metrics, 'debit', 'Test')

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(CircuitBreakerOpenError)
  })
})

describe('classifyError', () => {
  describe('HTTP status codes', () => {
    it('should classify 429 as transient', () => {
      const error = new Error('Too Many Requests')
      ;(error as any).status = 429

      const classification = classifyError(error)

      expect(classification.isTransient).toBe(true)
      expect(classification.isPermanent).toBe(false)
      expect(classification.shouldIncrement).toBe(true)
      expect(classification.reason).toContain('429')
      expect(classification.statusCode).toBe(429)
    })

    it('should classify 503 as transient', () => {
      const error = new Error('Service Unavailable')
      ;(error as any).status = 503

      const classification = classifyError(error)

      expect(classification.isTransient).toBe(true)
      expect(classification.isPermanent).toBe(false)
      expect(classification.shouldIncrement).toBe(true)
      expect(classification.reason).toContain('503')
      expect(classification.statusCode).toBe(503)
    })

    it('should classify 504 as transient', () => {
      const error = new Error('Gateway Timeout')
      ;(error as any).status = 504

      const classification = classifyError(error)

      expect(classification.isTransient).toBe(true)
      expect(classification.isPermanent).toBe(false)
      expect(classification.shouldIncrement).toBe(true)
      expect(classification.reason).toContain('504')
      expect(classification.statusCode).toBe(504)
    })

    it('should classify 400 as permanent', () => {
      const error = new Error('Bad Request')
      ;(error as any).status = 400

      const classification = classifyError(error)

      expect(classification.isTransient).toBe(false)
      expect(classification.isPermanent).toBe(true)
      expect(classification.shouldIncrement).toBe(false)
      expect(classification.reason).toContain('400')
      expect(classification.statusCode).toBe(400)
    })

    it('should classify 401 as permanent', () => {
      const error = new Error('Unauthorized')
      ;(error as any).status = 401

      const classification = classifyError(error)

      expect(classification.isTransient).toBe(false)
      expect(classification.isPermanent).toBe(true)
      expect(classification.shouldIncrement).toBe(false)
      expect(classification.reason).toContain('401')
      expect(classification.statusCode).toBe(401)
    })

    it('should classify 404 as permanent', () => {
      const error = new Error('Not Found')
      ;(error as any).status = 404

      const classification = classifyError(error)

      expect(classification.isTransient).toBe(false)
      expect(classification.isPermanent).toBe(true)
      expect(classification.shouldIncrement).toBe(false)
      expect(classification.reason).toContain('404')
      expect(classification.statusCode).toBe(404)
    })

    it('should handle status in response object', () => {
      const error = new Error('Service Unavailable')
      ;(error as any).response = { status: 503 }

      const classification = classifyError(error)

      expect(classification.isTransient).toBe(true)
      expect(classification.statusCode).toBe(503)
    })
  })

  describe('Network errors', () => {
    it('should classify timeout as transient', () => {
      const error = new Error('Request timeout')

      const classification = classifyError(error)

      expect(classification.isTransient).toBe(true)
      expect(classification.isPermanent).toBe(false)
      expect(classification.shouldIncrement).toBe(true)
      expect(classification.reason).toContain('timeout')
    })

    it('should classify ECONNREFUSED as transient', () => {
      const error = new Error('ECONNREFUSED: Connection refused')

      const classification = classifyError(error)

      expect(classification.isTransient).toBe(true)
      expect(classification.shouldIncrement).toBe(true)
      expect(classification.reason).toContain('ECONNREFUSED')
    })

    it('should classify ENOTFOUND as transient', () => {
      const error = new Error('ENOTFOUND: getaddrinfo ENOTFOUND')

      const classification = classifyError(error)

      expect(classification.isTransient).toBe(true)
      expect(classification.shouldIncrement).toBe(true)
    })

    it('should classify ECONNRESET as transient', () => {
      const error = new Error('ECONNRESET: Connection reset by peer')

      const classification = classifyError(error)

      expect(classification.isTransient).toBe(true)
      expect(classification.shouldIncrement).toBe(true)
    })

    it('should classify EHOSTUNREACH as transient', () => {
      const error = new Error('EHOSTUNREACH: No route to host')

      const classification = classifyError(error)

      expect(classification.isTransient).toBe(true)
      expect(classification.shouldIncrement).toBe(true)
    })

    it('should classify ENETUNREACH as transient', () => {
      const error = new Error('ENETUNREACH: Network is unreachable')

      const classification = classifyError(error)

      expect(classification.isTransient).toBe(true)
      expect(classification.shouldIncrement).toBe(true)
    })

    it('should be case-insensitive for network errors', () => {
      const error = new Error('TIMEOUT: Operation timed out')

      const classification = classifyError(error)

      expect(classification.isTransient).toBe(true)
    })
  })

  describe('Unknown errors', () => {
    it('should default unknown errors to transient', () => {
      const error = new Error('Some random error')

      const classification = classifyError(error)

      expect(classification.isTransient).toBe(true)
      expect(classification.isPermanent).toBe(false)
      expect(classification.shouldIncrement).toBe(true)
      expect(classification.reason).toContain('Unknown error')
    })

    it('should handle null error', () => {
      const classification = classifyError(null)

      expect(classification.isTransient).toBe(true)
      expect(classification.isPermanent).toBe(false)
      expect(classification.shouldIncrement).toBe(true)
    })

    it('should handle undefined error', () => {
      const classification = classifyError(undefined)

      expect(classification.isTransient).toBe(true)
      expect(classification.isPermanent).toBe(false)
      expect(classification.shouldIncrement).toBe(true)
    })

    it('should handle string error', () => {
      const classification = classifyError('Some error string')

      expect(classification.isTransient).toBe(true)
      expect(classification.isPermanent).toBe(false)
      expect(classification.shouldIncrement).toBe(true)
    })
  })
})

describe('isTransientError', () => {
  it('should return true for transient errors', () => {
    const error = new Error('timeout')

    expect(isTransientError(error)).toBe(true)
  })

  it('should return false for permanent errors', () => {
    const error = new Error('Bad Request')
    ;(error as any).status = 400

    expect(isTransientError(error)).toBe(false)
  })

  it('should return true for unknown errors', () => {
    const error = new Error('Unknown')

    expect(isTransientError(error)).toBe(true)
  })
})

describe('isPermanentError', () => {
  it('should return true for permanent errors', () => {
    const error = new Error('Not Found')
    ;(error as any).status = 404

    expect(isPermanentError(error)).toBe(true)
  })

  it('should return false for transient errors', () => {
    const error = new Error('timeout')

    expect(isPermanentError(error)).toBe(false)
  })

  it('should return false for unknown errors', () => {
    const error = new Error('Unknown')

    expect(isPermanentError(error)).toBe(false)
  })
})

describe('Logging functions', () => {
  let metrics: CircuitBreakerMetrics

  beforeEach(() => {
    vi.clearAllMocks()
    metrics = {
      state: 'CLOSED',
      consecutiveFailures: 2,
      totalAttempts: 10,
      totalSuccesses: 8,
      totalFailures: 2,
      lastStateTransitionTime: new Date(),
      openedAt: null,
      halfOpenTestRequestsRemaining: 1,
    }
  })

  it('should log circuit breaker error with context', () => {
    const error = new Error('Service unavailable')
    const classification = classifyError(error)

    logCircuitBreakerError({
      methodName: 'getBalance',
      error,
      classification,
      consecutiveFailures: 2,
      state: 'CLOSED',
      metrics,
    })

    expect(logger.warn).toHaveBeenCalledWith(
      'Circuit breaker error',
      expect.objectContaining({
        method: 'getBalance',
        errorMessage: 'Service unavailable',
        consecutiveFailures: 2,
        state: 'CLOSED',
      })
    )
  })

  it('should log state transition', () => {
    logStateTransition('CLOSED', 'OPEN', 'Failure threshold reached', metrics)

    expect(logger.info).toHaveBeenCalledWith(
      'Circuit breaker state transition',
      expect.objectContaining({
        from: 'CLOSED',
        to: 'OPEN',
        reason: 'Failure threshold reached',
      })
    )
  })

  it('should log circuit opened', () => {
    logCircuitOpened(5, 5, metrics)

    expect(logger.error).toHaveBeenCalledWith(
      'Circuit breaker opened',
      expect.objectContaining({
        consecutiveFailures: 5,
        failureThreshold: 5,
      })
    )
  })

  it('should log circuit recovered', () => {
    const openedAt = new Date(Date.now() - 5000) // 5 seconds ago

    logCircuitRecovered(openedAt, metrics)

    expect(logger.info).toHaveBeenCalledWith(
      'Circuit breaker recovered',
      expect.objectContaining({
        downtime: expect.stringContaining('ms'),
      })
    )
  })

  it('should log permanent error', () => {
    const error = new Error('Not Found')
    ;(error as any).status = 404
    const classification = classifyError(error)

    logPermanentError('recordReceipt', error, classification)

    expect(logger.warn).toHaveBeenCalledWith(
      'Permanent error (circuit breaker not triggered)',
      expect.objectContaining({
        method: 'recordReceipt',
        errorMessage: 'Not Found',
        statusCode: 404,
      })
    )
  })
})
