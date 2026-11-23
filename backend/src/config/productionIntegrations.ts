/**
 * Production integration guard — issue #1942.
 *
 * Several integrations default to a stub or mock when their env var is unset.
 * In production that means fake balances, fake KYC approvals and fake payment
 * confirmations with no error. This module works out which integrations resolve
 * to a stub, refuses to boot in production unless each one is named in
 * ALLOW_STUB_PROVIDERS, and lets /health report what is stubbed.
 *
 * ALLOW_STUB_PROVIDERS is a comma-separated list of check names, e.g.
 *   ALLOW_STUB_PROVIDERS=aiScoring
 * Opted-out stubs log a warning at boot and still appear in /health.
 */

import { logger } from '../utils/logger.js'

export type IntegrationEnv = Record<string, string | undefined>

export interface IntegrationCheck {
  /** Name used in ALLOW_STUB_PROVIDERS and in /health output. */
  name: string
  /** Env var that selects the provider; named in the boot error. */
  envVar: string
  /** Returns true when the env resolves this integration to its stub or mock. */
  isStub: (env: IntegrationEnv) => boolean
}

/** Reads a provider selector the way the consuming code does: blank or unset means the default. */
function selectorValue(env: IntegrationEnv, envVar: string, defaultValue: string): string {
  const raw = env[envVar]?.trim().toLowerCase()
  return raw ? raw : defaultValue
}

function stubWhenSelected(envVar: string, defaultValue: string, stubValue: string) {
  return (env: IntegrationEnv): boolean => selectorValue(env, envVar, defaultValue) === stubValue
}

/**
 * Every integration that can silently fall back to a stub or mock.
 * The defaults mirror the consuming code; keep them in sync when a default changes.
 */
export const INTEGRATION_CHECKS: readonly IntegrationCheck[] = [
  {
    name: 'soroban',
    envVar: 'SOROBAN_ADAPTER_MODE',
    // createSorobanAdapter() uses the real adapter only for mode=real or USE_REAL_SOROBAN=true.
    isStub: (env) =>
      selectorValue(env, 'SOROBAN_ADAPTER_MODE', 'stub') !== 'real' &&
      env.USE_REAL_SOROBAN?.trim().toLowerCase() !== 'true',
  },
  {
    name: 'paymentRail.psp',
    envVar: 'PSP_PROVIDER_PSP',
    isStub: (env) => !['paystack', 'flutterwave'].includes(selectorValue(env, 'PSP_PROVIDER_PSP', 'stub')),
  },
  {
    name: 'paymentRail.paystack',
    envVar: 'PSP_PROVIDER_PAYSTACK',
    isStub: (env) => !['paystack', 'flutterwave'].includes(selectorValue(env, 'PSP_PROVIDER_PAYSTACK', 'stub')),
  },
  {
    name: 'paymentRail.flutterwave',
    envVar: 'PSP_PROVIDER_FLUTTERWAVE',
    isStub: (env) => !['paystack', 'flutterwave'].includes(selectorValue(env, 'PSP_PROVIDER_FLUTTERWAVE', 'stub')),
  },
  {
    name: 'conversion',
    envVar: 'CONVERSION_PROVIDER',
    isStub: stubWhenSelected('CONVERSION_PROVIDER', 'stub', 'stub'),
  },
  {
    name: 'kyc',
    envVar: 'KYC_PROVIDER_TYPE',
    isStub: stubWhenSelected('KYC_PROVIDER_TYPE', 'stub', 'stub'),
  },
  {
    name: 'esign',
    envVar: 'ESIGN_PROVIDER',
    isStub: stubWhenSelected('ESIGN_PROVIDER', 'stub', 'stub'),
  },
  {
    name: 'creditBureau',
    envVar: 'CREDIT_BUREAU_PROVIDER',
    isStub: stubWhenSelected('CREDIT_BUREAU_PROVIDER', 'mock', 'mock'),
  },
  {
    name: 'aiScoring',
    envVar: 'AI_SCORING_PROVIDER',
    isStub: stubWhenSelected('AI_SCORING_PROVIDER', 'stub', 'stub'),
  },
]

export interface StubbedIntegration {
  name: string
  envVar: string
  /** True when the integration is named in ALLOW_STUB_PROVIDERS. */
  allowed: boolean
}

function allowedStubNames(env: IntegrationEnv): Set<string> {
  const raw = env.ALLOW_STUB_PROVIDERS ?? ''
  return new Set(
    raw
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  )
}

/** Lists every integration that resolves to a stub or mock, with whether it is opted out. */
export function getStubbedIntegrations(env: IntegrationEnv = process.env): StubbedIntegration[] {
  const allowed = allowedStubNames(env)
  return INTEGRATION_CHECKS.filter((check) => check.isStub(env)).map((check) => ({
    name: check.name,
    envVar: check.envVar,
    allowed: allowed.has(check.name.toLowerCase()),
  }))
}

/**
 * Boot-time guard. In production, throws when any integration resolves to a stub
 * that is not opted out, and logs a warning for each opted-out stub. Outside
 * production it never throws.
 */
export function assertProductionIntegrations(env: IntegrationEnv = process.env): StubbedIntegration[] {
  const stubbed = getStubbedIntegrations(env)
  if (env.NODE_ENV !== 'production') return stubbed

  const blocking = stubbed.filter((integration) => !integration.allowed)
  if (blocking.length > 0) {
    const details = blocking.map((integration) => `${integration.name} (set ${integration.envVar})`)
    throw new Error(
      `Refusing to start in production: integrations resolve to a stub or mock: ${details.join(', ')}. ` +
        'Configure a real provider for each, or name the integration in ALLOW_STUB_PROVIDERS to accept the stub explicitly.',
    )
  }

  for (const integration of stubbed) {
    logger.warn('production.stub_integration_allowed', {
      integration: integration.name,
      envVar: integration.envVar,
    })
  }
  return stubbed
}
