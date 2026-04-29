/**
 * Underwriting Service
 * Orchestrates the underwriting evaluation process for tenant applications
 */

import { UnderwritingRuleEngine, UnderwritingContext, UnderwritingResult, UnderwritingDecision, DEFAULT_RULE_CONFIG } from './underwritingRuleEngine.js'
import { tenantApplicationStore } from '../models/tenantApplicationStore.js'
import { TenantApplication } from '../models/tenantApplication.js'
import { userRiskStateStore } from '../models/userRiskStateStore.js'
import { underwritingDecisionTraceStore } from '../models/underwritingDecisionTraceStore.js'

export interface UnderwritingEvaluationInput {
  applicationId: string
  paymentHistory?: {
    onTimePaymentRate: number
    missedPayments: number
    totalPayments: number
  }
  metadata?: Record<string, any>
}

export interface UnderwritingEvaluationOutput {
  applicationId: string
  userId: string
  decision: UnderwritingDecision
  result: UnderwritingResult
  evaluatedAt: string
}

/**
 * Underwriting Service
 * Evaluates tenant applications using the rule engine
 */
export class UnderwritingService {
  private ruleEngine: UnderwritingRuleEngine

  constructor(ruleEngine?: UnderwritingRuleEngine) {
    this.ruleEngine = ruleEngine || new UnderwritingRuleEngine(DEFAULT_RULE_CONFIG)
  }

  /**
   * Evaluate a tenant application for underwriting
   */
  async evaluateApplication(input: UnderwritingEvaluationInput): Promise<UnderwritingEvaluationOutput> {
    // Fetch the application
    const application = await tenantApplicationStore.findById(input.applicationId)
    if (!application) {
      throw new Error(`Application ${input.applicationId} not found`)
    }

    // Fetch user risk state
    const riskState = await userRiskStateStore.getByUserId(application.userId)

    // Build underwriting context
    const context: UnderwritingContext = {
      userId: application.userId,
      applicationId: application.applicationId,
      annualRent: application.annualRent,
      deposit: application.deposit,
      depositRatio: application.deposit / application.annualRent,
      duration: application.duration,
      monthlyPayment: application.monthlyPayment,
      totalAmount: application.totalAmount,
      userRiskState: riskState
        ? {
            isFrozen: riskState.isFrozen,
            freezeReason: riskState.freezeReason,
          }
        : undefined,
      paymentHistory: input.paymentHistory,
      metadata: input.metadata,
    }

    // Evaluate using rule engine
    const result = this.ruleEngine.evaluate(context)

    // Store decision trace for audit
    await underwritingDecisionTraceStore.create({
      applicationId: application.applicationId,
      userId: application.userId,
      decision: result.decision,
      totalScore: result.totalScore,
      maxScore: result.maxScore,
      triggeredRules: result.triggeredRules,
      decisionReason: result.decisionReason,
      ruleConfigVersion: this.ruleEngine.getConfig().version,
      evaluatedAt: result.evaluatedAt,
    })

    return {
      applicationId: application.applicationId,
      userId: application.userId,
      decision: result.decision,
      result,
      evaluatedAt: result.evaluatedAt,
    }
  }

  /**
   * Update the rule engine configuration
   */
  updateRuleConfig(config: Partial<typeof DEFAULT_RULE_CONFIG>): void {
    this.ruleEngine.updateConfig(config)
  }

  /**
   * Get current rule engine configuration
   */
  getRuleConfig() {
    return this.ruleEngine.getConfig()
  }

  /**
   * Get rule engine instance (for testing)
   */
  getRuleEngine(): UnderwritingRuleEngine {
    return this.ruleEngine
  }
}

// Singleton instance
export const underwritingService = new UnderwritingService()
