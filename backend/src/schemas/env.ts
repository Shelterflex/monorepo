import { z } from 'zod'

const sorobanNetworkEnum = z.enum(['local', 'testnet', 'mainnet'])

export const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.string().default('development'),
  VERSION: z.string().default('0.1.0'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
  SOROBAN_RPC_URL: z.string().url().default('https://soroban-testnet.stellar.org'),
  SOROBAN_NETWORK_PASSPHRASE: z.string().default('Test SDF Network ; September 2015'),
  SOROBAN_CONTRACT_ID: z.string().optional(),
  SOROBAN_NETWORK: sorobanNetworkEnum.default('testnet'),
  USDC_TOKEN_ADDRESS: z.string().optional(),
  ENCRYPTION_KEY: z.string().min(32, 'Encryption key must be at least 32 characters'),
  CUSTODIAL_WALLET_MASTER_KEY_V1: z.string().optional(),
  CUSTODIAL_WALLET_MASTER_KEY_V2: z.string().optional(),
  CUSTODIAL_WALLET_MASTER_KEY_ACTIVE_VERSION: z.coerce.number().default(1),
  CUSTODIAL_MODE_ENABLED: z.coerce.boolean().default(true),
  CUSTODIAL_SIGNING_PAUSED: z.coerce.boolean().default(false),
  WEBHOOK_SIGNATURE_ENABLED: z.coerce.boolean().default(false),
  WEBHOOK_SECRET: z.string().optional(),
  // Provider-specific webhook secrets for signature validation
  PAYSTACK_SECRET: z.string().optional(),
  FLUTTERWAVE_SECRET: z.string().optional(),
  MANUAL_ADMIN_SECRET: z.string().optional(),
  FX_RATE_NGN_PER_USDC: z.coerce.number().positive().default(1600),
  QUOTE_MAX_AMOUNT_NGN: z.coerce.number().positive().default(5_000_000),
  QUOTE_EXPIRY_MS: z.coerce.number().positive().default(5 * 60_000),
  QUOTE_FEE_PERCENT: z.coerce.number().min(0).max(1).default(0.015),
  QUOTE_SLIPPAGE_PERCENT: z.coerce.number().min(0).max(1).default(0.005),
}).refine((data) => {
  if (data.NODE_ENV !== 'development' && data.NODE_ENV !== 'test' && !data.USDC_TOKEN_ADDRESS) {
    return false
  }
  if (data.USDC_TOKEN_ADDRESS && !/^0x[a-fA-F0-9]{40}$/.test(data.USDC_TOKEN_ADDRESS)) {
    return false
  }
  return true
}, {
  message: 'USDC_TOKEN_ADDRESS is required outside development/test and must be a valid Ethereum address (0x followed by 40 hex characters)',
  path: ['USDC_TOKEN_ADDRESS'],
})
  .refine((data) => {
    if (data.NODE_ENV === 'development' || data.NODE_ENV === 'test') {
      return true
    }
    if (!data.CUSTODIAL_WALLET_MASTER_KEY_V1) {
      return false
    }
    const active = data.CUSTODIAL_WALLET_MASTER_KEY_ACTIVE_VERSION
    if (active === 2 && !data.CUSTODIAL_WALLET_MASTER_KEY_V2) {
      return false
    }
    if (active !== 1 && active !== 2) {
      return false
    }
    return true
  }, {
    message: 'Custodial wallet master keys must be configured for active encryption version',
    path: ['CUSTODIAL_WALLET_MASTER_KEY_ACTIVE_VERSION'],
  })
  .refine((data) => {
    if (data.NODE_ENV !== 'production') return true
    return !!data.WEBHOOK_SECRET
  }, {
    message: 'WEBHOOK_SECRET is required in production to validate webhook signatures',
    path: ['WEBHOOK_SECRET'],
  })
  .refine((data) => {
    if (!data.WEBHOOK_SIGNATURE_ENABLED) return true
    return !!data.WEBHOOK_SECRET
  }, {
    message: 'WEBHOOK_SECRET is required when WEBHOOK_SIGNATURE_ENABLED is true',
    path: ['WEBHOOK_SECRET'],
  })
  .refine((data) => {
    if (data.NODE_ENV !== 'production') return true
    return !!data.PAYSTACK_SECRET
  }, {
    message: 'PAYSTACK_SECRET is required in production for webhook signature validation',
    path: ['PAYSTACK_SECRET'],
  })
  .refine((data) => {
    if (data.NODE_ENV !== 'production') return true
    return !!data.FLUTTERWAVE_SECRET
  }, {
    message: 'FLUTTERWAVE_SECRET is required in production for webhook signature validation',
    path: ['FLUTTERWAVE_SECRET'],
  })
  .refine((data) => {
    if (data.NODE_ENV !== 'production') return true
    return !!data.MANUAL_ADMIN_SECRET
  }, {
    message: 'MANUAL_ADMIN_SECRET is required in production for webhook signature validation',
    path: ['MANUAL_ADMIN_SECRET'],
  })

export type Env = z.infer<typeof envSchema>

export const env = envSchema.parse(process.env)
