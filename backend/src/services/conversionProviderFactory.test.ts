import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { envSchema } from '../schemas/env.js'
import { createConversionProviderFromEnv } from './conversionProviderFactory.js'
import {
  FallbackConversionProvider,
  HttpConversionProvider,
  OracleConversionProvider,
  StubConversionProvider,
} from './conversionProvider.js'
import { logger } from '../utils/logger.js'
import type { SorobanAdapter } from '../soroban/adapter.js'

const VALID_CONTRACT_ID = 'CAQGAQLQFJZ7PLOMCQN2I2NXHLQXF5DDD7T3IZQDTCZP3VYP7DVHLVSA'

function baseEnv(over: Record<string, unknown> = {}) {
  return {
    NODE_ENV: 'development',
    ENCRYPTION_KEY: 'a'.repeat(32),
    WEBHOOK_KEY: 'k',
    FX_RATE_NGN_PER_USDC: 1600,
    ...over,
  }
}

describe('createConversionProviderFromEnv', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('selects stub when CONVERSION_PROVIDER=stub', () => {
    const env = envSchema.parse(baseEnv({ CONVERSION_PROVIDER: 'stub' }))
    const p = createConversionProviderFromEnv(env)
    expect(p).toBeInstanceOf(StubConversionProvider)
  })

  it('selects HttpConversionProvider when CONVERSION_PROVIDER=http and URL set', () => {
    const env = envSchema.parse(
      baseEnv({
        CONVERSION_PROVIDER: 'http',
        CONVERSION_RATE_URL: 'https://fx.example.com/v1/ngn-usdc',
      }),
    )
    const p = createConversionProviderFromEnv(env)
    expect(p).toBeInstanceOf(HttpConversionProvider)
  })

  it('selects stub-only fallback when CONVERSION_PROVIDER=fallback without URL', () => {
    const env = envSchema.parse(
      baseEnv({
        CONVERSION_PROVIDER: 'fallback',
      }),
    )
    const p = createConversionProviderFromEnv(env)
    expect(p).toBeInstanceOf(StubConversionProvider)
    expect(logger.info).toHaveBeenCalled()
  })

  it('treats empty CONVERSION_RATE_URL as unset for fallback mode', () => {
    const env = envSchema.parse(
      baseEnv({
        CONVERSION_PROVIDER: 'fallback',
        CONVERSION_RATE_URL: '',
      }),
    )
    const p = createConversionProviderFromEnv(env)
    expect(p).toBeInstanceOf(StubConversionProvider)
  })

  it('selects FallbackConversionProvider when CONVERSION_PROVIDER=fallback with URL', () => {
    const env = envSchema.parse(
      baseEnv({
        CONVERSION_PROVIDER: 'fallback',
        CONVERSION_RATE_URL: 'https://fx.example.com/v1/ngn-usdc',
      }),
    )
    const p = createConversionProviderFromEnv(env)
    expect(p).toBeInstanceOf(FallbackConversionProvider)
  })

  it('selects stub when CONVERSION_PROVIDER=oracle but no adapter/contract id is supplied', () => {
    const env = envSchema.parse(baseEnv({ CONVERSION_PROVIDER: 'oracle' }))
    const p = createConversionProviderFromEnv(env)
    expect(p).toBeInstanceOf(StubConversionProvider)
    expect(logger.info).toHaveBeenCalled()
  })

  it('selects stub when CONVERSION_PROVIDER=oracle with an adapter but no contract id', () => {
    const env = envSchema.parse(baseEnv({ CONVERSION_PROVIDER: 'oracle' }))
    const p = createConversionProviderFromEnv(env, { sorobanAdapter: {} as SorobanAdapter })
    expect(p).toBeInstanceOf(StubConversionProvider)
  })

  it('wraps OracleConversionProvider in a FallbackConversionProvider when adapter + contract id are supplied', () => {
    const env = envSchema.parse(baseEnv({ CONVERSION_PROVIDER: 'oracle' }))
    const p = createConversionProviderFromEnv(env, {
      sorobanAdapter: {} as SorobanAdapter,
      oracleContractId: VALID_CONTRACT_ID,
    })
    expect(p).toBeInstanceOf(FallbackConversionProvider)
    expect((p as any).primary).toBeInstanceOf(OracleConversionProvider)
    expect((p as any).fallback).toBeInstanceOf(StubConversionProvider)
  })

  it('envSchema rejects http without CONVERSION_RATE_URL', () => {
    const r = envSchema.safeParse(
      baseEnv({
        CONVERSION_PROVIDER: 'http',
        NODE_ENV: 'production',
        SOROBAN_USDC_TOKEN_ID: VALID_CONTRACT_ID,
        CUSTODIAL_WALLET_MASTER_KEY_V1: 'b'.repeat(32),
        WEBHOOK_SECRET: 's',
        PAYSTACK_SECRET: 'p',
        FLUTTERWAVE_SECRET: 'f',
        MANUAL_ADMIN_SECRET: 'm',
      }),
    )
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join('.') === 'CONVERSION_RATE_URL')).toBe(true)
    }
  })
})
