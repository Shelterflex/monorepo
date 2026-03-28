import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Unit tests for `envSchema` rules.
 *
 * Implementation guideline: call `envSchema.parse()` with controlled objects.
 *
 * Note: `env.ts` also exports `env = envSchema.parse(process.env)` at module load.
 * To safely import `envSchema` in tests, we seed `process.env` with a minimal valid
 * development configuration before importing the module.
 */

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

async function loadEnvSchema() {
  // Ensure module-level parse(process.env) succeeds during import.
  process.env.NODE_ENV = 'development'
  process.env.ENCRYPTION_KEY = 'a'.repeat(32)
  vi.resetModules()
  const mod = await import('./env.js')
  return mod.envSchema
}

describe('envSchema — USDC token id requirements', () => {
  // Valid Soroban contract ID: starts with 'C' + 55 chars from [A-Z2-7]
  const VALID_CONTRACT_ID = 'CAQGAQLQFJZ7PLOMCQN2I2NXHLQXF5DDD7T3IZQDTCZP3VYP7DVHLVSA'

  it('dev allows missing token id', async () => {
    const envSchema = await loadEnvSchema()
    expect(() => envSchema.parse({ NODE_ENV: 'development', ENCRYPTION_KEY: 'a'.repeat(32) })).not.toThrow()
  })

  it('test allows missing token id', async () => {
    const envSchema = await loadEnvSchema()
    expect(() => envSchema.parse({ NODE_ENV: 'test', ENCRYPTION_KEY: 'a'.repeat(32) })).not.toThrow()
  })

  it('production rejects missing token id', async () => {
    const envSchema = await loadEnvSchema()

    // Provide all other production-required fields so the failure is specifically about the token id.
    const baseProd = {
      NODE_ENV: 'production',
      ENCRYPTION_KEY: 'a'.repeat(32),
      CUSTODIAL_WALLET_MASTER_KEY_V1: 'b'.repeat(32),
      WEBHOOK_SECRET: 'secret',
      PAYSTACK_SECRET: 'paystack',
      FLUTTERWAVE_SECRET: 'flutter',
      MANUAL_ADMIN_SECRET: 'admin',
    }

    const result = envSchema.safeParse(baseProd)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('SOROBAN_USDC_TOKEN_ID'))).toBe(true)
    }
  })

  it('invalid contract ID formats are rejected', async () => {
    const envSchema = await loadEnvSchema()

    const badValues = [
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // ethereum-style
      'CABC', // too short
      'GAQGAQLQFJZ7PLOMCQN2I2NXHLQXF5DDD7T3IZQDTCZP3VYP7DVHLVS', // wrong prefix
      'caqgaqlqfjz7plomcqn2i2nxhlqxf5ddd7t3izqdtczp3vyp7dvhlvs', // lowercase invalid
    ]

    for (const token of badValues) {
      const res = envSchema.safeParse({
        NODE_ENV: 'development',
        ENCRYPTION_KEY: 'a'.repeat(32),
        SOROBAN_USDC_TOKEN_ID: token,
      })
      expect(res.success).toBe(false)
    }
  })

  it('accepts a valid contract id in production', async () => {
    const envSchema = await loadEnvSchema()

    const result = envSchema.safeParse({
      NODE_ENV: 'production',
      ENCRYPTION_KEY: 'a'.repeat(32),
      CUSTODIAL_WALLET_MASTER_KEY_V1: 'b'.repeat(32),
      WEBHOOK_SECRET: 'secret',
      PAYSTACK_SECRET: 'paystack',
      FLUTTERWAVE_SECRET: 'flutter',
      MANUAL_ADMIN_SECRET: 'admin',
      SOROBAN_USDC_TOKEN_ID: VALID_CONTRACT_ID,
    })

    expect(result.success).toBe(true)
  })

  it('accepts a valid contract id via USDC_TOKEN_ADDRESS alias in production', async () => {
    const envSchema = await loadEnvSchema()

    const result = envSchema.safeParse({
      NODE_ENV: 'production',
      ENCRYPTION_KEY: 'a'.repeat(32),
      CUSTODIAL_WALLET_MASTER_KEY_V1: 'b'.repeat(32),
      WEBHOOK_SECRET: 'secret',
      PAYSTACK_SECRET: 'paystack',
      FLUTTERWAVE_SECRET: 'flutter',
      MANUAL_ADMIN_SECRET: 'admin',
      USDC_TOKEN_ADDRESS: VALID_CONTRACT_ID,
    })

    expect(result.success).toBe(true)
  })
})
