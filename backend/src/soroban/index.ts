import { StubSorobanAdapter } from './stub-adapter.js'
import { RealSorobanAdapter } from './real-adapter.js'
import { SorobanAdapter } from './adapter.js'
import { SorobanConfig } from './client.js'


export function createSorobanAdapter(config: SorobanConfig): SorobanAdapter {
     if (process.env.USE_REAL_SOROBAN === 'true') {
          return new RealSorobanAdapter(config)
     }
     return new StubSorobanAdapter(config)
}