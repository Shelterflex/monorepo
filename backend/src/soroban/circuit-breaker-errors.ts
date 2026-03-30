import { logger } from '../utils/logger.js'

/**
 * Metrics snapshot for circuit breaker state
 */
export interface CircuitBreakerMetrics {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'
  consecutiveFailures: number
  totalAttempts: number
  totalSuccesses: number
  totalFailures: number
  lastStateTransitionTime: Date | null
  openedAt: Date | null
  halfOpenTestRequestsRemaining: number
}

/**
 * Error thrown when circuit breaker is open and rejects a call
 */
export class CircuitBreakerOpenError extends Error {
  public readonly name = 'CircuitBreakerOpenError'

  constructor(
    public readonly metrics: CircuitBreakerMetrics,
    public readonly methodName: string,
    public readonly reason: string,
  ) {
    const message =
      `Circuit breaker OPEN for ${methodName}: ${reason}. ` +
      `State: ${metrics.state}, Consecutive Failures: ${metrics.consecutiveFailures}, ` +
      `Total Attempts: ${metrics.totalAttempts}`

    super(message)

    // Maintain proper V8 stack trace pointing to the call site
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CircuitBreakerOpenError)
    }
  }
}

/**
 * Classification of an error for circuit breaker purposes
 */
export interface ErrorClassification {
  isTransient: boolean
  isPermanent: boolean
  shouldIncrement: boolean
  reason: string
  statusCode?: number
}

/**
 * Classify an error as transient or permanent
 *
 * Transient errors (should increment failure counter):
 * - HTTP 429 (Too Many Requests)
 * - HTTP 503 (Service Unavailable)
 * - HTTP 504 (Gateway Timeout)
 * - Timeout errors
 * - Network errors (ECONNREFUSED, ENOTFOUND, etc.)
 *
 * Permanent errors (should NOT increment counter):
 * - HTTP 400 (Bad Request)
 * - HTTP 401 (Unauthorized)
 * - HTTP 404 (Not Found)
 *
 * Unknown errors default to transient (fail-safe approach)
 */
export function classifyError(error: unknown): ErrorClassification {
  if (!error) {
    return {
      isTransient: true,
      isPermanent: false,
      shouldIncrement: true,
      reason: 'Unknown error (treating as transient)',
    }
  }

  const errorObj = error as any
  const message = errorObj?.message || String(error)
  const status = errorObj?.status || errorObj?.response?.status

  // Check for HTTP status codes
  if (typeof status === 'number') {
    // Transient HTTP errors
    if (status === 429) {
      return {
        isTransient: true,
        isPermanent: false,
        shouldIncrement: true,
        reason: 'HTTP 429 (Too Many Requests)',
        statusCode: status,
      }
    }

    if (status === 503) {
      return {
        isTransient: true,
        isPermanent: false,
        shouldIncrement: true,
        reason: 'HTTP 503 (Service Unavailable)',
        statusCode: status,
      }
    }

    if (status === 504) {
      return {
        isTransient: true,
        isPermanent: false,
        shouldIncrement: true,
        reason: 'HTTP 504 (Gateway Timeout)',
        statusCode: status,
      }
    }

    // Permanent HTTP errors
    if (status === 400) {
      return {
        isTransient: false,
        isPermanent: true,
        shouldIncrement: false,
        reason: 'HTTP 400 (Bad Request)',
        statusCode: status,
      }
    }

    if (status === 401) {
      return {
        isTransient: false,
        isPermanent: true,
        shouldIncrement: false,
        reason: 'HTTP 401 (Unauthorized)',
        statusCode: status,
      }
    }

    if (status === 404) {
      return {
        isTransient: false,
        isPermanent: true,
        shouldIncrement: false,
        reason: 'HTTP 404 (Not Found)',
        statusCode: status,
      }
    }
  }

  // Check for timeout/network errors
  const lowerMessage = message.toLowerCase()
  const networkErrors = [
    'timeout',
    'econnrefused',
    'enotfound',
    'eai_again',
    'econnreset',
    'ehostunreach',
    'enetunreach',
  ]

  if (networkErrors.some(err => lowerMessage.includes(err))) {
    return {
      isTransient: true,
      isPermanent: false,
      shouldIncrement: true,
      reason: `Network error: ${message}`,
    }
  }

  // Default: treat as transient (fail-safe approach)
  return {
    isTransient: true,
    isPermanent: false,
    shouldIncrement: true,
    reason: `Unknown error (treating as transient): ${message}`,
  }
}

/**
 * Check if an error is transient (should trigger circuit breaker counter)
 */
export function isTransientError(error: unknown): boolean {
  return classifyError(error).isTransient
}

/**
 * Check if an error is permanent (should NOT trigger circuit breaker counter)
 */
export function isPermanentError(error: unknown): boolean {
  return classifyError(error).isPermanent
}

/**
 * Error context for logging and debugging
 */
export interface ErrorContext {
  methodName: string
  error: Error
  classification: ErrorClassification
  consecutiveFailures: number
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'
  metrics?: CircuitBreakerMetrics
}

/**
 * Log a circuit breaker error with full context
 */
export function logCircuitBreakerError(context: ErrorContext): void {
  const { methodName, error, classification, consecutiveFailures, state, metrics } = context

  logger.warn('Circuit breaker error', {
    method: methodName,
    errorMessage: error.message,
    errorName: error.name,
    classification: {
      isTransient: classification.isTransient,
      isPermanent: classification.isPermanent,
      shouldIncrement: classification.shouldIncrement,
      reason: classification.reason,
    },
    consecutiveFailures,
    state,
    metrics: metrics && {
      totalAttempts: metrics.totalAttempts,
      totalSuccesses: metrics.totalSuccesses,
      totalFailures: metrics.totalFailures,
      halfOpenTestRequestsRemaining: metrics.halfOpenTestRequestsRemaining,
    },
  })
}

/**
 * Log a circuit breaker state transition
 */
export function logStateTransition(
  from: 'CLOSED' | 'OPEN' | 'HALF_OPEN',
  to: 'CLOSED' | 'OPEN' | 'HALF_OPEN',
  reason: string,
  metrics: CircuitBreakerMetrics,
): void {
  logger.info('Circuit breaker state transition', {
    from,
    to,
    reason,
    timestamp: new Date().toISOString(),
    metrics: {
      consecutiveFailures: metrics.consecutiveFailures,
      totalAttempts: metrics.totalAttempts,
      totalSuccesses: metrics.totalSuccesses,
      totalFailures: metrics.totalFailures,
    },
  })
}

/**
 * Log when circuit breaker opens (enters OPEN state)
 */
export function logCircuitOpened(
  consecutiveFailures: number,
  failureThreshold: number,
  metrics: CircuitBreakerMetrics,
): void {
  logger.error('Circuit breaker opened', {
    timestamp: new Date().toISOString(),
    consecutiveFailures,
    failureThreshold,
    reason: `Consecutive failures (${consecutiveFailures}) reached threshold (${failureThreshold})`,
    metrics: {
      totalAttempts: metrics.totalAttempts,
      totalSuccesses: metrics.totalSuccesses,
      totalFailures: metrics.totalFailures,
    },
  })
}

/**
 * Log when circuit breaker recovers (enters CLOSED state from HALF_OPEN)
 */
export function logCircuitRecovered(
  openedAt: Date,
  metrics: CircuitBreakerMetrics,
): void {
  const downtime = Date.now() - openedAt.getTime()

  logger.info('Circuit breaker recovered', {
    timestamp: new Date().toISOString(),
    downtime: `${downtime}ms`,
    metrics: {
      totalAttempts: metrics.totalAttempts,
      totalSuccesses: metrics.totalSuccesses,
      totalFailures: metrics.totalFailures,
    },
  })
}

/**
 * Log a permanent error that won't trigger circuit opening
 */
export function logPermanentError(
  methodName: string,
  error: Error,
  classification: ErrorClassification,
): void {
  logger.warn('Permanent error (circuit breaker not triggered)', {
    method: methodName,
    errorMessage: error.message,
    errorName: error.name,
    reason: classification.reason,
    statusCode: classification.statusCode,
  })
}
