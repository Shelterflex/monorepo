import { describe, expect, it } from 'vitest'
import {
  assertProductionIntegrations,
  getStubbedIntegrations,
  type IntegrationEnv,
} from './productionIntegrations.js'

// Every selector set to its real value, so no integration resolves to a stub.
const REAL_ENV: IntegrationEnv = {
  NODE_ENV: 'production',
  SOROBAN_ADAPTER_MODE: 'real',
  PSP_PROVIDER_PSP: 'paystack',
  PSP_PROVIDER_PAYSTACK: 'paystack',
  PSP_PROVIDER_FLUTTERWAVE: 'flutterwave',
  CONVERSION_PROVIDER: 'http',
  KYC_PROVIDER_TYPE: 'persona',
  ESIGN_PROVIDER: 'docusign',
  CREDIT_BUREAU_PROVIDER: 'experian',
  AI_SCORING_PROVIDER: 'claude',
}

describe('getStubbedIntegrations', () => {
  it('reports nothing when every integration is configured for real', () => {
    expect(getStubbedIntegrations(REAL_ENV)).toEqual([])
  })

  it('treats unset selectors as their stub or mock defaults', () => {
    const names = getStubbedIntegrations({ NODE_ENV: 'production' }).map((i) => i.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'soroban',
        'paymentRail.psp',
        'paymentRail.paystack',
        'paymentRail.flutterwave',
        'conversion',
        'kyc',
        'esign',
        'creditBureau',
        'aiScoring',
      ]),
    )
  })

  it('treats a blank selector as the default', () => {
    const stubbed = getStubbedIntegrations({ ...REAL_ENV, KYC_PROVIDER_TYPE: '   ' })
    expect(stubbed.map((i) => i.name)).toEqual(['kyc'])
  })

  it('lets USE_REAL_SOROBAN=true switch soroban off the stub', () => {
    const env = { ...REAL_ENV, SOROBAN_ADAPTER_MODE: 'stub', USE_REAL_SOROBAN: 'true' }
    expect(getStubbedIntegrations(env).map((i) => i.name)).not.toContain('soroban')
  })

  it('marks opted-out integrations as allowed, case-insensitively', () => {
    const env = { ...REAL_ENV, AI_SCORING_PROVIDER: 'stub', ALLOW_STUB_PROVIDERS: ' AiScoring ' }
    const stubbed = getStubbedIntegrations(env)
    expect(stubbed).toEqual([
      { name: 'aiScoring', envVar: 'AI_SCORING_PROVIDER', allowed: true },
    ])
  })
})

describe('assertProductionIntegrations', () => {
  it('passes when every integration is configured for real', () => {
    expect(() => assertProductionIntegrations(REAL_ENV)).not.toThrow()
  })

  it('throws in production when a stub is not opted out, naming each one', () => {
    const env = { ...REAL_ENV, SOROBAN_ADAPTER_MODE: 'stub', KYC_PROVIDER_TYPE: 'stub' }
    expect(() => assertProductionIntegrations(env)).toThrowError(/soroban \(set SOROBAN_ADAPTER_MODE\)/)
    expect(() => assertProductionIntegrations(env)).toThrowError(/kyc \(set KYC_PROVIDER_TYPE\)/)
  })

  it('boots in production when every stub is listed in ALLOW_STUB_PROVIDERS', () => {
    const env = {
      ...REAL_ENV,
      KYC_PROVIDER_TYPE: 'stub',
      ALLOW_STUB_PROVIDERS: 'kyc',
    }
    const stubbed = assertProductionIntegrations(env)
    expect(stubbed).toEqual([{ name: 'kyc', envVar: 'KYC_PROVIDER_TYPE', allowed: true }])
  })

  it('never throws outside production, even with stubs everywhere', () => {
    expect(() => assertProductionIntegrations({ NODE_ENV: 'development' })).not.toThrow()
    expect(() => assertProductionIntegrations({ NODE_ENV: 'test' })).not.toThrow()
  })
})
