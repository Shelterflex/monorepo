import { StubSorobanAdapter } from './stub-adapter.js'
import { RealSorobanAdapter } from './real-adapter.js'
import { CircuitBreakerAdapter } from './circuit-breaker-adapter.js'
import { SorobanAdapter } from './adapter.js'
import { SorobanConfig } from './client.js'
import { loadCircuitBreakerConfig } from './circuit-breaker-config.js'

/**
 * Create a Soroban adapter based on environment configuration.
 *
 * Environment variable SOROBAN_ADAPTER_MODE controls adapter selection:
 * - 'stub': Use StubSorobanAdapter (fake data, no network calls)
 * - 'real': Use RealSorobanAdapter (actual Soroban contract calls)
 *
 * The adapter is wrapped with CircuitBreakerAdapter if circuit breaker is enabled
 * via SOROBAN_CIRCUIT_BREAKER_ENABLED environment variable (default: true).
 *
 * Default adapter mode is 'stub' for safety.
 */
export function createSorobanAdapter(config: SorobanConfig): SorobanAdapter {
  const mode = process.env.SOROBAN_ADAPTER_MODE ?? 'stub'

  let adapter: SorobanAdapter
  if (mode === 'real') {
    adapter = new RealSorobanAdapter(config)
  } else {
    // Default to stub for safety
    adapter = new StubSorobanAdapter(config)
  }

  // Wrap with circuit breaker if enabled
  const cbConfig = loadCircuitBreakerConfig()
  if (cbConfig.enabled) {
    adapter = new CircuitBreakerAdapter(adapter, cbConfig)
  }

  return adapter
}

// Re-export everything for convenience
export * from './adapter.js'
export * from './client.js'
export * from './errors.js'
export * from './circuit-breaker-errors.js'
export * from './circuit-breaker-config.js'
export { StubSorobanAdapter } from './stub-adapter.js'
export { RealSorobanAdapter } from './real-adapter.js'
export { CircuitBreakerAdapter } from './circuit-breaker-adapter.js'