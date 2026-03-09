import { StubSorobanAdapter } from './stub-adapter.js'
import { RealSorobanAdapter } from './real-adapter.js'
import { SorobanAdapter } from './adapter.js'
import { SorobanConfig } from './client.js'

/**
 * Create a Soroban adapter based on environment configuration.
 *
 * Environment variable SOROBAN_ADAPTER_MODE controls adapter selection:
 * - 'stub': Use StubSorobanAdapter (fake data, no network calls)
 * - 'real': Use RealSorobanAdapter (actual Soroban contract calls)
 *
 * Default is 'stub' for safety.
 */
export function createSorobanAdapter(config: SorobanConfig): SorobanAdapter {
  const mode = process.env.SOROBAN_ADAPTER_MODE ?? 'stub'

  if (mode === 'real') {
    return new RealSorobanAdapter(config)
  }

  // Default to stub for safety
  return new StubSorobanAdapter(config)
}

// Re-export everything for convenience
export * from './adapter.js'
export * from './client.js'
export * from './errors.js'
export { StubSorobanAdapter } from './stub-adapter.js'
export { RealSorobanAdapter } from './real-adapter.js'