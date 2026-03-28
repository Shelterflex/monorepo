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
  // Soroban contract IDs are StrKey-encoded, always starting with 'C' and 56 characters long (base32).
  USDC_TOKEN_ADDRESS: z.string().optional(),
  SOROBAN_USDC_TOKEN_ID: z.string().optional(),
  ENCRYPTION_KEY: z.string().min(32, 'Encryption key must be at least 32 characters'),
  CUSTODIAL_WALLET_MASTER_KEY_V1: z.string().optional(),
  CUSTODIAL_WALLET_MASTER_KEY_V2: z.string().optional(),
  CUSTODIAL_WALLET_MASTER_KEY_ACTIVE_VERSION: z.coerce.number().default(1),
  CUSTODIAL_MODE_ENABLED: z.coerce.boolean().default(true),
  CUSTODIAL_SIGNING_PAUSED: z.coerce.boolean().default(false),
  WEBHOOK_SIGNATURE_ENABLED: z.coerce.boolean().default(false),
  SOROBAN_ADMIN_SIGNING_ENABLED: z.coerce.boolean().default(false),
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
  // OTP delivery provider: 'console' for dev, 'email' for production
  OTP_DELIVERY_PROVIDER: z.enum(['console', 'email']).default('console'),
  // Resend configuration (required for email OTP delivery)
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().optional(),
}).refine((data) => {
  // Accept either field name; prefer SOROBAN_USDC_TOKEN_ID if provided
  const tokenId = data.SOROBAN_USDC_TOKEN_ID || data.USDC_TOKEN_ADDRESS
  // In non-dev/test environments, the token must be provided
  if (data.NODE_ENV !== 'development' && data.NODE_ENV !== 'test' && !tokenId) {
    return false
  }
  // Soroban/Stellar contract IDs are 56-character StrKey values starting with 'C'
  const SOROBAN_CONTRACT_ID_REGEX = /^C[A-Z2-7]{55}$/
  if (tokenId && !SOROBAN_CONTRACT_ID_REGEX.test(tokenId)) {
    return false
  }
  return true
}, {
  message:
    'SOROBAN_USDC_TOKEN_ID (or USDC_TOKEN_ADDRESS) is required outside development/test and must be a valid Soroban contract ID (a 56-character Stellar StrKey starting with "C")',
  path: ['SOROBAN_USDC_TOKEN_ID'],
})
  .refine((data) => {
    if (data.NODE_ENV !== 'production') {
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
  .refine((data) => {
    if (data.OTP_DELIVERY_PROVIDER !== 'email') return true
    return !!data.RESEND_API_KEY && !!data.RESEND_FROM_EMAIL
  }, {
    message: 'RESEND_API_KEY and RESEND_FROM_EMAIL are required when OTP_DELIVERY_PROVIDER is "email"',
    path: ['RESEND_API_KEY'],
  })

export type Env = z.infer<typeof envSchema>

export const env = envSchema.parse(process.env)
