import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      // Tests run against the in-memory auth store; a database error must never be
      // what selects it (see models/authStore.ts).
      AUTH_STORE: 'memory',
      ENCRYPTION_KEY: 'test-encryption-key-32-chars-long-123456',
      WEBHOOK_KEY: 'test-webhook-key-for-ci',
      USDC_TOKEN_ADDRESS: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
      SOROBAN_NETWORK: 'testnet',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.d.ts',
        '**/*.test.ts',
      ],
    },
  },
})
