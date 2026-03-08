import { StubSorobanAdapter } from './stub-adapter.js'
import { SorobanAdapter } from './adapter.js'
import { SorobanConfig } from './client.js'


export function createSorobanAdapter(config: SorobanConfig): SorobanAdapter {
     return new StubSorobanAdapter(config)
}