import { describe, it, expect, beforeEach, vi } from 'vitest'

// `env` is parsed once at import time, so swap in a mutable stand-in per test.
const mockEnv = vi.hoisted(() => ({
  USDC_TOKEN_ADDRESS: undefined as string | undefined,
  NODE_ENV: 'test',
  SOROBAN_NETWORK: 'testnet' as 'local' | 'testnet' | 'mainnet',
}))
vi.mock('../schemas/env.js', () => ({ env: mockEnv }))

import { getUsdcTokenAddress, getSorobanNetwork } from './token.js'

const CONTRACT_ID = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

describe('getUsdcTokenAddress', () => {
  beforeEach(() => {
    mockEnv.USDC_TOKEN_ADDRESS = undefined
    mockEnv.NODE_ENV = 'test'
    mockEnv.SOROBAN_NETWORK = 'testnet'
  })

  it.each(['development', 'test', 'staging', 'production'])(
    'returns the configured address in %s',
    (nodeEnv) => {
      mockEnv.NODE_ENV = nodeEnv
      mockEnv.USDC_TOKEN_ADDRESS = CONTRACT_ID
      expect(getUsdcTokenAddress()).toBe(CONTRACT_ID)
    },
  )

  it('falls back to the zero address in development when unset', () => {
    mockEnv.NODE_ENV = 'development'
    expect(getUsdcTokenAddress()).toBe(ZERO_ADDRESS)
  })

  it('treats an empty string as unset', () => {
    mockEnv.NODE_ENV = 'development'
    mockEnv.USDC_TOKEN_ADDRESS = ''
    expect(getUsdcTokenAddress()).toBe(ZERO_ADDRESS)
  })

  it.each([
    ['production', 'mainnet'],
    ['staging', 'testnet'],
    ['test', 'local'],
  ] as const)('throws in %s (%s) when unset, naming the environment and network', (nodeEnv, network) => {
    mockEnv.NODE_ENV = nodeEnv
    mockEnv.SOROBAN_NETWORK = network
    expect(() => getUsdcTokenAddress()).toThrow(
      `USDC_TOKEN_ADDRESS is required in ${nodeEnv} environment. ` +
        `Please set the USDC_TOKEN_ADDRESS environment variable for the ${network} network.`,
    )
  })

  it('does not apply the dev fallback to a differently-cased NODE_ENV', () => {
    mockEnv.NODE_ENV = 'Development'
    expect(() => getUsdcTokenAddress()).toThrow(/USDC_TOKEN_ADDRESS is required/)
  })
})

describe('getSorobanNetwork', () => {
  it.each(['local', 'testnet', 'mainnet'] as const)('returns %s', (network) => {
    mockEnv.SOROBAN_NETWORK = network
    expect(getSorobanNetwork()).toBe(network)
  })

  it('passes through whatever the env schema produced (no extra validation here)', () => {
    mockEnv.SOROBAN_NETWORK = 'futurenet' as never
    expect(getSorobanNetwork()).toBe('futurenet')
  })
})
