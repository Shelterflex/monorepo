import { logger } from '../utils/logger.js'
import {
  CircuitBreakerOpenError,
  logCircuitBreakerError,
  ErrorContext,
  classifyError,
} from './circuit-breaker-errors.js'
import { CircuitBreaker } from './circuit-breaker.js'
import { CircuitBreakerConfig } from './circuit-breaker-config.js'
import { SorobanAdapter, RecordReceiptParams } from './adapter.js'
import { SorobanConfig } from './client.js'
import { RawReceiptEvent } from '../indexer/event-parser.js'

/**
 * CircuitBreakerAdapter wraps a SorobanAdapter with circuit breaker protection.
 *
 * This adapter implements the SorobanAdapter interface and wraps an existing
 * adapter (typically RealSorobanAdapter) with circuit breaker state management.
 * It checks the circuit breaker state before delegating calls and throws
 * CircuitBreakerOpenError when the circuit is open.
 *
 * Thread-safe: Uses mutex protection for state transitions and concurrent calls.
 */
export class CircuitBreakerAdapter implements SorobanAdapter {
  private circuitBreaker: CircuitBreaker

  constructor(
    private wrappedAdapter: SorobanAdapter,
    config: CircuitBreakerConfig,
  ) {
    this.circuitBreaker = new CircuitBreaker(config)
  }

  /**
   * Get health status and metrics
   */
  getHealthStatus() {
    return this.circuitBreaker.getMetrics()
  }

  /**
   * Reset circuit breaker state (for testing)
   */
  async resetState(): Promise<void> {
    await this.circuitBreaker.resetState()
  }

  /**
   * Execute a wrapped adapter call with circuit breaker protection
   */
  private async executeWithCircuitBreaker<T>(
    methodName: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    // Check state and potentially transition to Half-Open
    await this.circuitBreaker.checkState()

    // Check if call should be allowed
    const shouldAllow = await this.circuitBreaker.shouldAllowCall()
    if (!shouldAllow) {
      const metrics = this.circuitBreaker.getMetrics()
      throw new CircuitBreakerOpenError(
        metrics,
        methodName,
        'Circuit breaker is OPEN',
      )
    }

    // Execute the wrapped call
    try {
      const result = await fn()
      await this.circuitBreaker.recordSuccess()
      return result
    } catch (error) {
      const wasIncremented = await this.circuitBreaker.recordFailure(error)

      // Log the error with context
      const classification = classifyError(error)
      const context: ErrorContext = {
        methodName,
        error: error instanceof Error ? error : new Error(String(error)),
        classification,
        consecutiveFailures: this.circuitBreaker.getMetrics().consecutiveFailures,
        state: this.circuitBreaker.getMetrics().state,
        metrics: this.circuitBreaker.getMetrics(),
      }
      logCircuitBreakerError(context)

      // Re-throw the original error
      throw error
    }
  }

  /**
   * Get account balance
   */
  async getBalance(account: string): Promise<bigint> {
    return this.executeWithCircuitBreaker('getBalance', () =>
      this.wrappedAdapter.getBalance(account),
    )
  }

  /**
   * Credit an account
   */
  async credit(account: string, amount: bigint): Promise<void> {
    return this.executeWithCircuitBreaker('credit', () =>
      this.wrappedAdapter.credit(account, amount),
    )
  }

  /**
   * Debit an account
   */
  async debit(account: string, amount: bigint): Promise<void> {
    return this.executeWithCircuitBreaker('debit', () =>
      this.wrappedAdapter.debit(account, amount),
    )
  }

  /**
   * Get staked balance
   */
  async getStakedBalance(account: string): Promise<bigint> {
    return this.executeWithCircuitBreaker('getStakedBalance', () =>
      this.wrappedAdapter.getStakedBalance(account),
    )
  }

  /**
   * Get claimable rewards
   */
  async getClaimableRewards(account: string): Promise<bigint> {
    return this.executeWithCircuitBreaker('getClaimableRewards', () =>
      this.wrappedAdapter.getClaimableRewards(account),
    )
  }

  /**
   * Record a receipt
   */
  async recordReceipt(params: RecordReceiptParams): Promise<void> {
    return this.executeWithCircuitBreaker('recordReceipt', () =>
      this.wrappedAdapter.recordReceipt(params),
    )
  }

  /**
   * Get configuration
   */
  getConfig(): SorobanConfig {
    return this.wrappedAdapter.getConfig()
  }

  /**
   * Get receipt events
   */
  async getReceiptEvents(fromLedger: number | null): Promise<RawReceiptEvent[]> {
    return this.executeWithCircuitBreaker('getReceiptEvents', () =>
      this.wrappedAdapter.getReceiptEvents(fromLedger),
    )
  }

  /**
   * Get timelock events
   */
  async getTimelockEvents(fromLedger: number | null): Promise<any[]> {
    return this.executeWithCircuitBreaker('getTimelockEvents', () =>
      this.wrappedAdapter.getTimelockEvents(fromLedger),
    )
  }

  /**
   * Execute timelock transaction (admin operation)
   */
  async executeTimelock(txHash: string, target: string, functionName: string, args: any[], eta: number): Promise<string> {
    return this.executeWithCircuitBreaker('executeTimelock', () =>
      this.wrappedAdapter.executeTimelock(txHash, target, functionName, args, eta),
    )
  }

  /**
   * Cancel timelock transaction (admin operation)
   */
  async cancelTimelock(txHash: string): Promise<string> {
    return this.executeWithCircuitBreaker('cancelTimelock', () =>
      this.wrappedAdapter.cancelTimelock(txHash),
    )
  }

  /**
   * Pause contract (admin operation)
   */
  async pause?(contractId: string): Promise<string> {
    if (!this.wrappedAdapter.pause) {
      throw new Error('pause method not supported by wrapped adapter')
    }
    return this.executeWithCircuitBreaker('pause', () =>
      this.wrappedAdapter.pause!(contractId),
    )
  }

  /**
   * Unpause contract (admin operation)
   */
  async unpause?(contractId: string): Promise<string> {
    if (!this.wrappedAdapter.unpause) {
      throw new Error('unpause method not supported by wrapped adapter')
    }
    return this.executeWithCircuitBreaker('unpause', () =>
      this.wrappedAdapter.unpause!(contractId),
    )
  }

  /**
   * Set operator (admin operation)
   */
  async setOperator?(contractId: string, operatorAddress: string | null): Promise<string> {
    if (!this.wrappedAdapter.setOperator) {
      throw new Error('setOperator method not supported by wrapped adapter')
    }
    return this.executeWithCircuitBreaker('setOperator', () =>
      this.wrappedAdapter.setOperator!(contractId, operatorAddress),
    )
  }

  /**
   * Initialize contract (admin operation)
   */
  async init?(contractId: string, adminAddress: string, operatorAddress?: string): Promise<string> {
    if (!this.wrappedAdapter.init) {
      throw new Error('init method not supported by wrapped adapter')
    }
    return this.executeWithCircuitBreaker('init', () =>
      this.wrappedAdapter.init!(contractId, adminAddress, operatorAddress),
    )
  }
}
