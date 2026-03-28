import { StubSorobanAdapter } from './stub-adapter.js'
import { RecordReceiptParams } from './adapter.js'
import { SorobanConfig } from './client.js'
import { logger } from '../utils/logger.js'
import { isDuplicateReceiptError } from './errors.js'

/**
 * TestSorobanAdapter extends StubSorobanAdapter with test-specific capabilities
 * for integration testing. It tracks all recordReceipt() calls, simulates failures,
 * and provides inspection methods to verify receipt parameters.
 */
export class TestSorobanAdapter extends StubSorobanAdapter {
  private recordedReceipts: RecordReceiptParams[] = []
  private shouldFailCount: number = 0
  private shouldSimulateDuplicate: boolean = false

  constructor(config: SorobanConfig) {
    super(config)
    logger.info('Soroban adapter: test mode')
  }

  /**
   * Records a receipt and tracks the call for test inspection.
   * Can simulate transient failures or duplicate receipt errors based on configuration.
   * Handles duplicate receipt errors as idempotent success, matching RealSorobanAdapter behavior.
   */
  async recordReceipt(params: RecordReceiptParams): Promise<void> {
    // Track the call before any failure simulation
    this.recordedReceipts.push({ ...params })

    try {
      // Simulate transient failures (e.g., network issues, temporary contract errors)
      if (this.shouldFailCount > 0) {
        this.shouldFailCount--
        logger.debug('TestSorobanAdapter: simulating transient failure', {
          remainingFailures: this.shouldFailCount,
        })
        throw new Error('Simulated transient failure')
      }

      // Simulate duplicate receipt error (contract rejection)
      if (this.shouldSimulateDuplicate) {
        logger.debug('TestSorobanAdapter: simulating duplicate receipt error')
        throw new Error('Receipt already exists for tx_id')
      }

      // Call parent implementation for normal logging
      return super.recordReceipt(params)
    } catch (err) {
      // Check if this is a duplicate receipt error (idempotent success)
      // This matches the behavior in RealSorobanAdapter
      if (isDuplicateReceiptError(err, params.txId)) {
        logger.info('Receipt already recorded (idempotent success)', {
          txId: params.txId,
          txType: params.txType,
        })
        return
      }

      // Re-throw other errors
      throw err
    }
  }

  /**
   * Returns all recorded receipt calls for test verification.
   */
  getRecordedReceipts(): RecordReceiptParams[] {
    return [...this.recordedReceipts]
  }

  /**
   * Configures the adapter to fail the next N recordReceipt() calls.
   * Used to test retry logic and error recovery.
   */
  simulateFailures(count: number): void {
    this.shouldFailCount = count
    logger.debug('TestSorobanAdapter: configured to fail next N calls', { count })
  }

  /**
   * Configures the adapter to simulate a duplicate receipt error on the next call.
   * Used to test idempotency handling at the adapter layer.
   */
  simulateDuplicateError(): void {
    this.shouldSimulateDuplicate = true
    logger.debug('TestSorobanAdapter: configured to simulate duplicate error')
  }

  /**
   * Resets all test state for cleanup between test cases.
   */
  reset(): void {
    this.recordedReceipts = []
    this.shouldFailCount = 0
    this.shouldSimulateDuplicate = false
    logger.debug('TestSorobanAdapter: reset complete')
  }
}
