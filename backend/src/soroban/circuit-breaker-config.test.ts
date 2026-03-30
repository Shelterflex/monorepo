import { describe, it, expect, beforeEach } from 'vitest'
import { loadCircuitBreakerConfig } from './circuit-breaker-config.js'

describe('CircuitBreakerConfig', () => {
  beforeEach(() => {
    // Clear all circuit breaker environment variables
    delete process.env.SOROBAN_CIRCUIT_BREAKER_ENABLED
    delete process.env.SOROBAN_CIRCUIT_BREAKER_FAILURE_THRESHOLD
    delete process.env.SOROBAN_CIRCUIT_BREAKER_TIMEOUT_PERIOD
    delete process.env.SOROBAN_CIRCUIT_BREAKER_HALF_OPEN_REQUESTS
  })

  describe('loadCircuitBreakerConfig', () => {
    it('should return default configuration when no environment variables are set', () => {
      const config = loadCircuitBreakerConfig()

      expect(config).toEqual({
        enabled: true,
        failureThreshold: 5,
        timeoutPeriod: 30000,
        halfOpenTestRequests: 1,
      })
    })

    it('should load enabled flag from environment variable', () => {
      process.env.SOROBAN_CIRCUIT_BREAKER_ENABLED = 'false'
      const config = loadCircuitBreakerConfig()

      expect(config.enabled).toBe(false)
    })

    it('should treat any non-false value as enabled', () => {
      process.env.SOROBAN_CIRCUIT_BREAKER_ENABLED = 'true'
      const config = loadCircuitBreakerConfig()

      expect(config.enabled).toBe(true)
    })

    it('should load failure threshold from environment variable', () => {
      process.env.SOROBAN_CIRCUIT_BREAKER_FAILURE_THRESHOLD = '10'
      const config = loadCircuitBreakerConfig()

      expect(config.failureThreshold).toBe(10)
    })

    it('should use default failure threshold for invalid value', () => {
      process.env.SOROBAN_CIRCUIT_BREAKER_FAILURE_THRESHOLD = 'invalid'
      const config = loadCircuitBreakerConfig()

      expect(config.failureThreshold).toBe(5)
    })

    it('should use default failure threshold for zero value', () => {
      process.env.SOROBAN_CIRCUIT_BREAKER_FAILURE_THRESHOLD = '0'
      const config = loadCircuitBreakerConfig()

      expect(config.failureThreshold).toBe(5)
    })

    it('should load timeout period from environment variable', () => {
      process.env.SOROBAN_CIRCUIT_BREAKER_TIMEOUT_PERIOD = '60000'
      const config = loadCircuitBreakerConfig()

      expect(config.timeoutPeriod).toBe(60000)
    })

    it('should use default timeout period for invalid value', () => {
      process.env.SOROBAN_CIRCUIT_BREAKER_TIMEOUT_PERIOD = 'invalid'
      const config = loadCircuitBreakerConfig()

      expect(config.timeoutPeriod).toBe(30000)
    })

    it('should load half-open test requests from environment variable', () => {
      process.env.SOROBAN_CIRCUIT_BREAKER_HALF_OPEN_REQUESTS = '3'
      const config = loadCircuitBreakerConfig()

      expect(config.halfOpenTestRequests).toBe(3)
    })

    it('should use default half-open test requests for invalid value', () => {
      process.env.SOROBAN_CIRCUIT_BREAKER_HALF_OPEN_REQUESTS = 'invalid'
      const config = loadCircuitBreakerConfig()

      expect(config.halfOpenTestRequests).toBe(1)
    })

    it('should load all configuration values from environment variables', () => {
      process.env.SOROBAN_CIRCUIT_BREAKER_ENABLED = 'false'
      process.env.SOROBAN_CIRCUIT_BREAKER_FAILURE_THRESHOLD = '8'
      process.env.SOROBAN_CIRCUIT_BREAKER_TIMEOUT_PERIOD = '45000'
      process.env.SOROBAN_CIRCUIT_BREAKER_HALF_OPEN_REQUESTS = '2'

      const config = loadCircuitBreakerConfig()

      expect(config).toEqual({
        enabled: false,
        failureThreshold: 8,
        timeoutPeriod: 45000,
        halfOpenTestRequests: 2,
      })
    })

    it('should handle partial environment variable configuration', () => {
      process.env.SOROBAN_CIRCUIT_BREAKER_ENABLED = 'false'
      process.env.SOROBAN_CIRCUIT_BREAKER_FAILURE_THRESHOLD = '7'

      const config = loadCircuitBreakerConfig()

      expect(config).toEqual({
        enabled: false,
        failureThreshold: 7,
        timeoutPeriod: 30000, // default
        halfOpenTestRequests: 1, // default
      })
    })

    it('should handle large threshold values', () => {
      process.env.SOROBAN_CIRCUIT_BREAKER_FAILURE_THRESHOLD = '1000'
      const config = loadCircuitBreakerConfig()

      expect(config.failureThreshold).toBe(1000)
    })

    it('should handle large timeout values', () => {
      process.env.SOROBAN_CIRCUIT_BREAKER_TIMEOUT_PERIOD = '300000'
      const config = loadCircuitBreakerConfig()

      expect(config.timeoutPeriod).toBe(300000)
    })

    it('should return a valid CircuitBreakerConfig interface', () => {
      const config = loadCircuitBreakerConfig()

      // Verify all required properties exist
      expect(config).toHaveProperty('enabled')
      expect(config).toHaveProperty('failureThreshold')
      expect(config).toHaveProperty('timeoutPeriod')
      expect(config).toHaveProperty('halfOpenTestRequests')

      // Verify types
      expect(typeof config.enabled).toBe('boolean')
      expect(typeof config.failureThreshold).toBe('number')
      expect(typeof config.timeoutPeriod).toBe('number')
      expect(typeof config.halfOpenTestRequests).toBe('number')
    })
  })
})
