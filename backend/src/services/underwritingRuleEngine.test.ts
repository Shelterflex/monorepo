import { describe, it, expect, beforeEach } from 'vitest'
import { UnderwritingRuleEngine, DEFAULT_RULE_CONFIG, UnderwritingContext } from './underwritingRuleEngine.js'

describe('UnderwritingRuleEngine', () => {
  let engine: UnderwritingRuleEngine

  beforeEach(() => {
    engine = new UnderwritingRuleEngine(DEFAULT_RULE_CONFIG)
  })

  describe('evaluate', () => {
    it('should approve application with good metrics', () => {
      const context: UnderwritingContext = {
        userId: 'user-1',
        applicationId: 'app-1',
        annualRent: 120000,
        deposit: 36000, // 30% deposit
        depositRatio: 0.3,
        duration: 12,
        monthlyPayment: 7000,
        totalAmount: 84000,
        paymentHistory: {
          onTimePaymentRate: 0.95,
          missedPayments: 0,
          totalPayments: 20,
        },
      }

      const result = engine.evaluate(context)

      expect(result.decision).toBe('APPROVE')
      expect(result.totalScore).toBeGreaterThan(result.maxScore * 0.8)
      expect(result.triggeredRules).toBeDefined()
      expect(result.triggeredRules.length).toBeGreaterThan(0)
    })

    it('should reject application with frozen user', () => {
      const context: UnderwritingContext = {
        userId: 'user-1',
        applicationId: 'app-1',
        annualRent: 120000,
        deposit: 36000,
        depositRatio: 0.3,
        duration: 12,
        monthlyPayment: 7000,
        totalAmount: 84000,
        userRiskState: {
          isFrozen: true,
          freezeReason: 'NEGATIVE_BALANCE',
        },
      }

      const result = engine.evaluate(context)

      expect(result.decision).toBe('REJECT')
      expect(result.decisionReason).toContain('Frozen')
    })

    it('should reject application with insufficient deposit', () => {
      const context: UnderwritingContext = {
        userId: 'user-1',
        applicationId: 'app-1',
        annualRent: 120000,
        deposit: 15000, // 12.5% deposit (below 20% minimum)
        depositRatio: 0.125,
        duration: 12,
        monthlyPayment: 8750,
        totalAmount: 105000,
      }

      const result = engine.evaluate(context)

      expect(result.decision).toBe('REJECT')
      expect(result.decisionReason).toContain('Deposit')
    })

    it('should review application with borderline metrics', () => {
      const context: UnderwritingContext = {
        userId: 'user-1',
        applicationId: 'app-1',
        annualRent: 120000,
        deposit: 24000, // 20% deposit (minimum)
        depositRatio: 0.2,
        duration: 18, // Long duration
        monthlyPayment: 5333,
        totalAmount: 96000,
        paymentHistory: {
          onTimePaymentRate: 0.85,
          missedPayments: 2,
          totalPayments: 20,
        },
      }

      const result = engine.evaluate(context)

      expect(result.decision).toBe('REVIEW')
    })

    it('should handle missing payment history gracefully', () => {
      const context: UnderwritingContext = {
        userId: 'user-1',
        applicationId: 'app-1',
        annualRent: 120000,
        deposit: 36000,
        depositRatio: 0.3,
        duration: 12,
        monthlyPayment: 7000,
        totalAmount: 84000,
      }

      const result = engine.evaluate(context)

      expect(result.decision).toBe('APPROVE')
      // When payment history is missing, payment history rules should still be evaluated
      // but should not cause rejection
      expect(result.totalScore).toBeGreaterThan(0)
    })
  })

  describe('updateConfig', () => {
    it('should update rule configuration', () => {
      engine.updateConfig({
        approveThreshold: 90,
        reviewThreshold: 60,
      })

      const config = engine.getConfig()
      expect(config.approveThreshold).toBe(90)
      expect(config.reviewThreshold).toBe(60)
    })

    it('should preserve existing config when updating partially', () => {
      engine.updateConfig({ approveThreshold: 90 })

      const config = engine.getConfig()
      expect(config.approveThreshold).toBe(90)
      expect(config.reviewThreshold).toBe(DEFAULT_RULE_CONFIG.reviewThreshold)
      expect(config.version).toBe(DEFAULT_RULE_CONFIG.version)
    })
  })

  describe('rule evaluation', () => {
    it('should evaluate deposit minimum rule correctly', () => {
      const context: UnderwritingContext = {
        userId: 'user-1',
        applicationId: 'app-1',
        annualRent: 100000,
        deposit: 20000,
        depositRatio: 0.2,
        duration: 12,
        monthlyPayment: 6667,
        totalAmount: 80000,
      }

      const result = engine.evaluate(context)
      const depositRule = result.triggeredRules.find((r) => r.ruleId === 'deposit_minimum')

      expect(depositRule).toBeDefined()
      expect(depositRule?.passed).toBe(true)
    })

    it('should evaluate user not frozen rule correctly', () => {
      const context: UnderwritingContext = {
        userId: 'user-1',
        applicationId: 'app-1',
        annualRent: 100000,
        deposit: 20000,
        depositRatio: 0.2,
        duration: 12,
        monthlyPayment: 6667,
        totalAmount: 80000,
        userRiskState: {
          isFrozen: false,
          freezeReason: null,
        },
      }

      const result = engine.evaluate(context)
      const frozenRule = result.triggeredRules.find((r) => r.ruleId === 'user_not_frozen')

      expect(frozenRule).toBeDefined()
      expect(frozenRule?.passed).toBe(true)
    })

    it('should evaluate payment history rules correctly', () => {
      const context: UnderwritingContext = {
        userId: 'user-1',
        applicationId: 'app-1',
        annualRent: 100000,
        deposit: 20000,
        depositRatio: 0.2,
        duration: 12,
        monthlyPayment: 6667,
        totalAmount: 80000,
        paymentHistory: {
          onTimePaymentRate: 0.92,
          missedPayments: 1,
          totalPayments: 25,
        },
      }

      const result = engine.evaluate(context)
      const paymentHistoryRule = result.triggeredRules.find(
        (r) => r.ruleId === 'payment_history_good'
      )
      const missedPaymentsRule = result.triggeredRules.find(
        (r) => r.ruleId === 'no_missed_payments'
      )

      expect(paymentHistoryRule).toBeDefined()
      expect(missedPaymentsRule).toBeDefined()
    })
  })

  describe('decision reason generation', () => {
    it('should generate clear rejection reason for critical failures', () => {
      const context: UnderwritingContext = {
        userId: 'user-1',
        applicationId: 'app-1',
        annualRent: 100000,
        deposit: 15000,
        depositRatio: 0.15,
        duration: 12,
        monthlyPayment: 7083,
        totalAmount: 85000,
        userRiskState: {
          isFrozen: true,
          freezeReason: 'COMPLIANCE',
        },
      }

      const result = engine.evaluate(context)

      expect(result.decision).toBe('REJECT')
      expect(result.decisionReason).toContain('critical')
      expect(result.decisionReason).toContain('Frozen')
    })

    it('should generate clear review reason for borderline cases', () => {
      const context: UnderwritingContext = {
        userId: 'user-1',
        applicationId: 'app-1',
        annualRent: 100000,
        deposit: 20000,
        depositRatio: 0.2,
        duration: 12,
        monthlyPayment: 6667,
        totalAmount: 80000,
        paymentHistory: {
          onTimePaymentRate: 0.85,
          missedPayments: 3,
          totalPayments: 20,
        },
      }

      const result = engine.evaluate(context)

      expect(result.decision).toBe('REVIEW')
      expect(result.decisionReason).toContain('manual review')
    })
  })
})
