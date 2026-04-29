import { describe, it, expect, beforeEach, vi } from 'vitest'
import { UnderwritingService } from './underwritingService.js'
import { UnderwritingRuleEngine, DEFAULT_RULE_CONFIG } from './underwritingRuleEngine.js'
import { tenantApplicationStore } from '../models/tenantApplicationStore.js'
import { userRiskStateStore } from '../models/userRiskStateStore.js'
import { underwritingDecisionTraceStore } from '../models/underwritingDecisionTraceStore.js'

describe('UnderwritingService', () => {
  let service: UnderwritingService

  beforeEach(async () => {
    const ruleEngine = new UnderwritingRuleEngine(DEFAULT_RULE_CONFIG)
    service = new UnderwritingService(ruleEngine)
    
    // Clear stores
    await (tenantApplicationStore as any).clear?.()
    await (userRiskStateStore as any).clear?.()
    await (underwritingDecisionTraceStore as any).clear?.()
  })

  describe('evaluateApplication', () => {
    it('should evaluate application and store decision trace', async () => {
      // Create test application
      const application = await tenantApplicationStore.create({
        userId: 'user-1',
        propertyId: 1,
        propertyTitle: 'Test Property',
        propertyLocation: 'Lagos',
        annualRent: 120000,
        deposit: 36000,
        duration: 12,
        hasAgreedToTerms: true,
      })

      const result = await service.evaluateApplication({
        applicationId: application.applicationId,
        paymentHistory: {
          onTimePaymentRate: 0.95,
          missedPayments: 0,
          totalPayments: 20,
        },
      })

      expect(result.applicationId).toBe(application.applicationId)
      expect(result.userId).toBe(application.userId)
      expect(result.decision).toBeDefined()
      expect(result.result).toBeDefined()
      expect(result.evaluatedAt).toBeDefined()

      // Verify decision trace was stored
      const traces = await underwritingDecisionTraceStore.findByApplicationId(
        application.applicationId
      )
      expect(traces).toHaveLength(1)
      expect(traces[0].decision).toBe(result.decision)
    })

    it('should throw error for non-existent application', async () => {
      await expect(
        service.evaluateApplication({
          applicationId: 'non-existent-app',
        })
      ).rejects.toThrow('not found')
    })

    it('should include user risk state in evaluation', async () => {
      // Create user with frozen state
      await userRiskStateStore.freeze('user-1', 'COMPLIANCE', 'Test freeze')

      // Create application
      const application = await tenantApplicationStore.create({
        userId: 'user-1',
        propertyId: 1,
        annualRent: 120000,
        deposit: 36000,
        duration: 12,
        hasAgreedToTerms: true,
      })

      const result = await service.evaluateApplication({
        applicationId: application.applicationId,
      })

      expect(result.decision).toBe('REJECT')
      expect(result.result.decisionReason).toContain('Frozen')
    })

    it('should handle applications without risk state', async () => {
      const application = await tenantApplicationStore.create({
        userId: 'user-1',
        propertyId: 1,
        annualRent: 120000,
        deposit: 36000,
        duration: 12,
        hasAgreedToTerms: true,
      })

      const result = await service.evaluateApplication({
        applicationId: application.applicationId,
      })

      expect(result.decision).toBeDefined()
      expect(result.result).toBeDefined()
    })
  })

  describe('updateRuleConfig', () => {
    it('should update rule engine configuration', () => {
      service.updateRuleConfig({
        approveThreshold: 90,
        reviewThreshold: 60,
      })

      const config = service.getRuleConfig()
      expect(config.approveThreshold).toBe(90)
      expect(config.reviewThreshold).toBe(60)
    })
  })

  describe('getRuleConfig', () => {
    it('should return current rule configuration', () => {
      const config = service.getRuleConfig()
      expect(config).toBeDefined()
      expect(config.version).toBe(DEFAULT_RULE_CONFIG.version)
      expect(config.approveThreshold).toBe(DEFAULT_RULE_CONFIG.approveThreshold)
    })
  })
})
