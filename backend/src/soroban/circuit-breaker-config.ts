import { logger } from '../utils/logger.js'

/**
 * Configuration for circuit breaker behavior
 */
export interface CircuitBreakerConfig {
  // Number of consecutive failures to trigger circuit opening
  failureThreshold: number // default: 5

  // Duration circuit remains open before attempting recovery (ms)
  timeoutPeriod: number // default: 30000 (30 seconds)

  // Number of test requests allowed in Half-Open state
  halfOpenTestRequests: number // default: 1

  // Enable/disable circuit breaker
  enabled: boolean // default: true
}

/**
 * Default configuration values
 */
const DEFAULTS: CircuitBreakerConfig = {
  failureThreshold: 5,
  timeoutPeriod: 30000, // 30 seconds
  halfOpenTestRequests: 1,
  enabled: true,
}

/**
 * Load circuit breaker configuration from environment variables
 *
 * Supported environment variables:
 * - SOROBAN_CIRCUIT_BREAKER_ENABLED: 'true' or 'false' (default: true)
 * - SOROBAN_CIRCUIT_BREAKER_FAILURE_THRESHOLD: number (default: 5)
 * - SOROBAN_CIRCUIT_BREAKER_TIMEOUT_PERIOD: number in milliseconds (default: 30000)
 * - SOROBAN_CIRCUIT_BREAKER_HALF_OPEN_REQUESTS: number (default: 1)
 *
 * @returns CircuitBreakerConfig with values from environment or defaults
 */
export function loadCircuitBreakerConfig(): CircuitBreakerConfig {
  const config: CircuitBreakerConfig = { ...DEFAULTS }

  // Load enabled flag
  const enabledEnv = process.env.SOROBAN_CIRCUIT_BREAKER_ENABLED
  if (enabledEnv !== undefined) {
    config.enabled = enabledEnv !== 'false'
  }

  // Load failure threshold
  const thresholdEnv = process.env.SOROBAN_CIRCUIT_BREAKER_FAILURE_THRESHOLD
  if (thresholdEnv !== undefined) {
    const parsed = parseInt(thresholdEnv, 10)
    if (!isNaN(parsed) && parsed > 0) {
      config.failureThreshold = parsed
    } else {
      logger.warn('Invalid SOROBAN_CIRCUIT_BREAKER_FAILURE_THRESHOLD, using default', {
        value: thresholdEnv,
        default: DEFAULTS.failureThreshold,
      })
    }
  }

  // Load timeout period
  const timeoutEnv = process.env.SOROBAN_CIRCUIT_BREAKER_TIMEOUT_PERIOD
  if (timeoutEnv !== undefined) {
    const parsed = parseInt(timeoutEnv, 10)
    if (!isNaN(parsed) && parsed > 0) {
      config.timeoutPeriod = parsed
    } else {
      logger.warn('Invalid SOROBAN_CIRCUIT_BREAKER_TIMEOUT_PERIOD, using default', {
        value: timeoutEnv,
        default: DEFAULTS.timeoutPeriod,
      })
    }
  }

  // Load half-open test requests
  const halfOpenEnv = process.env.SOROBAN_CIRCUIT_BREAKER_HALF_OPEN_REQUESTS
  if (halfOpenEnv !== undefined) {
    const parsed = parseInt(halfOpenEnv, 10)
    if (!isNaN(parsed) && parsed > 0) {
      config.halfOpenTestRequests = parsed
    } else {
      logger.warn('Invalid SOROBAN_CIRCUIT_BREAKER_HALF_OPEN_REQUESTS, using default', {
        value: halfOpenEnv,
        default: DEFAULTS.halfOpenTestRequests,
      })
    }
  }

  logger.info('Circuit breaker configuration loaded', {
    enabled: config.enabled,
    failureThreshold: config.failureThreshold,
    timeoutPeriod: config.timeoutPeriod,
    halfOpenTestRequests: config.halfOpenTestRequests,
  })

  return config
}
