import { logger } from '../utils/logger.js'
import {
  CircuitBreakerMetrics,
  CircuitBreakerOpenError,
  classifyError,
  logStateTransition,
  logCircuitOpened,
  logCircuitRecovered,
  logPermanentError,
} from './circuit-breaker-errors.js'
import { CircuitBreakerConfig } from './circuit-breaker-config.js'

/**
 * Simple async mutex implementation for thread-safe state management
 */
class SimpleMutex {
  private locked = false
  private waitQueue: Array<() => void> = []

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true
      return
    }

    return new Promise(resolve => {
      this.waitQueue.push(resolve)
    })
  }

  release(): void {
    const next = this.waitQueue.shift()
    if (next) {
      next()
    } else {
      this.locked = false
    }
  }
}

/**
 * CircuitBreaker state machine core
 *
 * Manages three states:
 * - CLOSED: Normal operation, failures are counted
 * - OPEN: Failing fast, all calls rejected
 * - HALF_OPEN: Testing recovery, limited calls allowed
 */
export class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED'
  private consecutiveFailures: number = 0
  private openedAt: Date | null = null
  private halfOpenTestRequestsRemaining: number
  private lastStateTransitionTime: Date | null = null

  // Metrics tracking
  private totalAttempts: number = 0
  private totalSuccesses: number = 0
  private totalFailures: number = 0

  // Thread safety
  private stateLock: SimpleMutex = new SimpleMutex()

  constructor(private config: CircuitBreakerConfig) {
    this.halfOpenTestRequestsRemaining = config.halfOpenTestRequests
  }

  /**
   * Get current state
   */
  getState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
    return this.state
  }

  /**
   * Get current metrics snapshot
   */
  getMetrics(): CircuitBreakerMetrics {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      totalAttempts: this.totalAttempts,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
      lastStateTransitionTime: this.lastStateTransitionTime,
      openedAt: this.openedAt,
      halfOpenTestRequestsRemaining: this.halfOpenTestRequestsRemaining,
    }
  }

  /**
   * Check if circuit is open and potentially transition to Half-Open
   * Should be called before each RPC call
   */
  async checkState(): Promise<void> {
    await this.stateLock.acquire()
    try {
      if (this.state === 'OPEN') {
        const elapsedTime = Date.now() - this.openedAt!.getTime()
        if (elapsedTime >= this.config.timeoutPeriod) {
          await this.transitionToHalfOpenLocked()
        }
      }
    } finally {
      this.stateLock.release()
    }
  }

  /**
   * Check if a call should be allowed to proceed
   * Returns true if call should proceed, false if circuit is open
   */
  async shouldAllowCall(): Promise<boolean> {
    await this.checkState()

    await this.stateLock.acquire()
    try {
      if (this.state === 'OPEN') {
        return false
      }

      if (this.state === 'HALF_OPEN') {
        if (this.halfOpenTestRequestsRemaining <= 0) {
          return false
        }
        this.halfOpenTestRequestsRemaining--
      }

      return true
    } finally {
      this.stateLock.release()
    }
  }

  /**
   * Record a successful call
   */
  async recordSuccess(): Promise<void> {
    await this.stateLock.acquire()
    try {
      this.totalAttempts++
      this.totalSuccesses++

      if (this.state === 'CLOSED') {
        // Reset failure counter on success in Closed state
        this.consecutiveFailures = 0
      }

      if (this.state === 'HALF_OPEN') {
        // Success in Half-Open triggers transition to Closed
        await this.transitionToClosedLocked()
      }
    } finally {
      this.stateLock.release()
    }
  }

  /**
   * Record a failed call
   * Returns true if failure counter was incremented, false if permanent error
   */
  async recordFailure(error: unknown): Promise<boolean> {
    const classification = classifyError(error)

    await this.stateLock.acquire()
    try {
      this.totalAttempts++
      this.totalFailures++

      // Permanent errors don't increment counter
      if (classification.isPermanent) {
        logPermanentError(
          'recordFailure',
          error instanceof Error ? error : new Error(String(error)),
          classification,
        )
        return false
      }

      // Transient errors increment counter
      if (this.state === 'CLOSED') {
        this.consecutiveFailures++

        if (this.consecutiveFailures >= this.config.failureThreshold) {
          await this.transitionToOpenLocked()
        }
      }

      if (this.state === 'HALF_OPEN') {
        // Failure in Half-Open triggers transition back to Open
        await this.transitionToOpenLocked()
      }

      return true
    } finally {
      this.stateLock.release()
    }
  }

  /**
   * Transition to Open state (circuit opens)
   * Must be called with lock held
   */
  private async transitionToOpenLocked(): Promise<void> {
    const previousState = this.state
    this.state = 'OPEN'
    this.openedAt = new Date()
    this.lastStateTransitionTime = this.openedAt
    this.halfOpenTestRequestsRemaining = this.config.halfOpenTestRequests

    logStateTransition(previousState, 'OPEN', 'Failure threshold reached', this.getMetrics())
    logCircuitOpened(this.consecutiveFailures, this.config.failureThreshold, this.getMetrics())
  }

  /**
   * Transition to Half-Open state (testing recovery)
   * Must be called with lock held
   */
  private async transitionToHalfOpenLocked(): Promise<void> {
    const previousState = this.state
    this.state = 'HALF_OPEN'
    this.lastStateTransitionTime = new Date()
    this.halfOpenTestRequestsRemaining = this.config.halfOpenTestRequests

    logStateTransition(
      previousState,
      'HALF_OPEN',
      'Timeout period elapsed, attempting recovery',
      this.getMetrics(),
    )
  }

  /**
   * Transition to Closed state (circuit closes, recovered)
   * Must be called with lock held
   */
  private async transitionToClosedLocked(): Promise<void> {
    const previousState = this.state
    const wasOpen = this.openedAt !== null

    this.state = 'CLOSED'
    this.consecutiveFailures = 0
    this.lastStateTransitionTime = new Date()
    const openedAtTime = this.openedAt
    this.openedAt = null

    logStateTransition(previousState, 'CLOSED', 'Recovery successful', this.getMetrics())

    if (wasOpen && openedAtTime) {
      logCircuitRecovered(openedAtTime, this.getMetrics())
    }
  }

  /**
   * Reset state for testing purposes
   */
  async resetState(): Promise<void> {
    await this.stateLock.acquire()
    try {
      this.state = 'CLOSED'
      this.consecutiveFailures = 0
      this.openedAt = null
      this.halfOpenTestRequestsRemaining = this.config.halfOpenTestRequests
      this.lastStateTransitionTime = null
      this.totalAttempts = 0
      this.totalSuccesses = 0
      this.totalFailures = 0
    } finally {
      this.stateLock.release()
    }
  }
}
