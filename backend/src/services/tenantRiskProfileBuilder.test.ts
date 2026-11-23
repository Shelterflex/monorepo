import { beforeEach, describe, expect, it } from 'vitest'
import {
  tenantOnboardingDataStore,
  type BankStatementLine,
} from '../models/tenantOnboardingDataStore.js'
import { buildTenantRiskProfile } from './tenantRiskProfileBuilder.js'

const TENANT_ID = 'tenant-1'

type OnboardingInput = Parameters<typeof tenantOnboardingDataStore.upsert>[1]

function seed(overrides: Partial<OnboardingInput> = {}) {
  return tenantOnboardingDataStore.upsert(TENANT_ID, {
    statedMonthlyIncome: 300_000,
    monthlyRent: 100_000,
    employmentStatus: 'employed',
    employerName: 'Acme Ltd',
    bankStatementLines: [],
    ...overrides,
  })
}

describe('buildTenantRiskProfile (#2121)', () => {
  beforeEach(() => {
    tenantOnboardingDataStore.clear()
  })

  describe('missing data', () => {
    it('returns undefined when the tenant has no onboarding data', () => {
      expect(buildTenantRiskProfile('no-such-tenant')).toBeUndefined()
    })

    it('returns undefined again after the onboarding data is cleared', () => {
      seed()
      tenantOnboardingDataStore.clear()

      expect(buildTenantRiskProfile(TENANT_ID)).toBeUndefined()
    })
  })

  describe('partial data', () => {
    it('builds a profile from income and employment alone when there are no bank lines', () => {
      seed({ bankStatementLines: [] })

      expect(buildTenantRiskProfile(TENANT_ID)).toEqual({
        tenantId: TENANT_ID,
        dataVersion: 1,
        monthlyIncome: 300_000,
        incomeToRentRatio: 3,
        employmentTenureMonths: 24,
        bankMetrics: { averageBalance: 0, nsfCount: 0, incomeRegularity: 0 },
        existingDebtObligations: 0,
      })
    })
  })

  describe('extreme values', () => {
    it('returns a zero ratio rather than dividing by a zero rent', () => {
      seed({ monthlyRent: 0 })

      expect(buildTenantRiskProfile(TENANT_ID)?.incomeToRentRatio).toBe(0)
    })

    it('returns a zero ratio when the stated income is zero', () => {
      seed({ statedMonthlyIncome: 0 })

      const profile = buildTenantRiskProfile(TENANT_ID)
      expect(profile?.monthlyIncome).toBe(0)
      expect(profile?.incomeToRentRatio).toBe(0)
    })

    it('keeps a very large income-to-rent ratio finite', () => {
      seed({ statedMonthlyIncome: 1e12, monthlyRent: 1 })

      expect(buildTenantRiskProfile(TENANT_ID)?.incomeToRentRatio).toBe(1e12)
    })
  })

  describe('employment tenure', () => {
    it.each([
      ['employed', 24],
      ['EMPLOYED', 24],
      ['self_employed', 12],
      ['Self_Employed', 12],
      ['unemployed', 0],
      ['none', 0],
      ['retired', 6],
      ['', 6],
    ])('maps employment status %j to %i months', (status, months) => {
      seed({ employmentStatus: status })

      expect(buildTenantRiskProfile(TENANT_ID)?.employmentTenureMonths).toBe(months)
    })
  })

  describe('existing debt obligations', () => {
    it('estimates 5% of the average balance per recurring debit', () => {
      seed({
        bankStatementLines: [
          { date: '2026-01-05', description: 'Salary ACME', amount: 500_000 },
          { date: '2026-01-10', description: 'LOAN REPAYMENT', amount: -20_000 },
          { date: '2026-01-12', description: 'EMI bank', amount: -10_000 },
          { date: '2026-01-15', description: 'Groceries', amount: -5_000 },
        ],
      })

      const profile = buildTenantRiskProfile(TENANT_ID)

      // Running balance ends at 465,000 for January; two recurring debits at 5% each.
      expect(profile?.bankMetrics.averageBalance).toBe(465_000)
      expect(profile?.bankMetrics.incomeRegularity).toBe(70)
      expect(profile?.existingDebtObligations).toBe(46_500)
    })

    it('falls back to 15,000 per recurring debit when the average balance is not positive', () => {
      seed({
        bankStatementLines: [
          { date: '2026-01-01', description: 'Loan', amount: -100 },
          { date: '2026-01-02', description: 'Repayment', amount: -100 },
        ],
      })

      const profile = buildTenantRiskProfile(TENANT_ID)

      expect(profile?.bankMetrics.averageBalance).toBe(-200)
      expect(profile?.existingDebtObligations).toBe(30_000)
    })

    it('does not count a recurring-looking credit as a debt', () => {
      seed({
        bankStatementLines: [{ date: '2026-01-01', description: 'Loan disbursement', amount: 5_000 }],
      })

      expect(buildTenantRiskProfile(TENANT_ID)?.existingDebtObligations).toBe(0)
    })
  })

  describe('bank metrics', () => {
    it('counts NSF and returned-item lines', () => {
      seed({
        bankStatementLines: [
          { date: '2026-01-03', description: 'NSF FEE', amount: -2_500 },
          { date: '2026-01-09', description: 'Returned item', amount: -1_000 },
        ],
      })

      expect(buildTenantRiskProfile(TENANT_ID)?.bankMetrics.nsfCount).toBe(2)
    })
  })

  describe('determinism', () => {
    const lines: BankStatementLine[] = [
      { date: '2026-01-05', description: 'Salary ACME', amount: 500_000 },
      { date: '2026-02-05', description: 'Salary ACME', amount: 480_000 },
      { date: '2026-02-12', description: 'EMI bank', amount: -15_000 },
    ]

    it('returns the same profile for the same input', () => {
      seed({ bankStatementLines: lines })

      const first = buildTenantRiskProfile(TENANT_ID)
      const second = buildTenantRiskProfile(TENANT_ID)

      expect(second).toEqual(first)
    })

    it('reports the data version of the onboarding record it was built from', () => {
      seed({ bankStatementLines: lines })
      seed({ bankStatementLines: lines })

      expect(buildTenantRiskProfile(TENANT_ID)?.dataVersion).toBe(2)
    })

    it.fails('gives the same average balance whatever order the bank lines were submitted in', () => {
      // Known gap for #2121: lines are not sorted by date before the running balance
      // is taken, so the average balance depends on submission order. Submitted
      // statements are not sorted upstream (see routes/tenantOnboarding.ts), so this can
      // differ for the same statement. it.fails until the builder sorts or the store does.
      const chronological: BankStatementLine[] = [
        { date: '2026-01-10', description: 'Salary', amount: 100 },
        { date: '2026-02-10', description: 'Transfer out', amount: -300 },
      ]
      seed({ bankStatementLines: chronological })
      const inOrder = buildTenantRiskProfile(TENANT_ID)?.bankMetrics.averageBalance

      seed({ bankStatementLines: [...chronological].reverse() })
      const reversed = buildTenantRiskProfile(TENANT_ID)?.bankMetrics.averageBalance

      expect(reversed).toBe(inOrder)
    })
  })
})
