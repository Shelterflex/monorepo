/**
 * Underwriting Rule Engine
 * Configurable rule-based decision system for tenant application underwriting
 */

export type UnderwritingDecision = 'APPROVE' | 'REVIEW' | 'REJECT'

export interface RuleEvaluation {
  ruleId: string
  ruleName: string
  passed: boolean
  score: number
  weight: number
  reason: string
  details?: Record<string, any>
}

export interface UnderwritingContext {
  userId: string
  applicationId: string
  annualRent: number
  deposit: number
  depositRatio: number
  duration: number
  monthlyPayment: number
  totalAmount: number
  userRiskState?: {
    isFrozen: boolean
    freezeReason: string | null
  }
  paymentHistory?: {
    onTimePaymentRate: number
    missedPayments: number
    totalPayments: number
  }
  metadata?: Record<string, any>
}

export interface UnderwritingResult {
  decision: UnderwritingDecision
  totalScore: number
  maxScore: number
  triggeredRules: RuleEvaluation[]
  decisionReason: string
  evaluatedAt: string
}

export interface RuleConfig {
  ruleId: string
  ruleName: string
  weight: number
  enabled: boolean
  threshold?: number
  severity: 'critical' | 'warning' | 'info'
}

export interface RuleEngineConfig {
  version: string
  rules: RuleConfig[]
  approveThreshold: number
  reviewThreshold: number
}

/**
 * Default rule configuration for tenant underwriting
 */
export const DEFAULT_RULE_CONFIG: RuleEngineConfig = {
  version: '1.0.0',
  approveThreshold: 80,
  reviewThreshold: 50,
  rules: [
    {
      ruleId: 'deposit_minimum',
      ruleName: 'Minimum Deposit Ratio',
      weight: 20,
      enabled: true,
      threshold: 0.2,
      severity: 'critical',
    },
    {
      ruleId: 'deposit_adequate',
      ruleName: 'Adequate Deposit Ratio',
      weight: 15,
      enabled: true,
      threshold: 0.3,
      severity: 'warning',
    },
    {
      ruleId: 'duration_reasonable',
      ruleName: 'Reasonable Duration',
      weight: 10,
      enabled: true,
      threshold: 12,
      severity: 'warning',
    },
    {
      ruleId: 'monthly_payment_affordable',
      ruleName: 'Monthly Payment Affordability',
      weight: 20,
      enabled: true,
      threshold: 0.4,
      severity: 'critical',
    },
    {
      ruleId: 'user_not_frozen',
      ruleName: 'User Account Not Frozen',
      weight: 25,
      enabled: true,
      severity: 'critical',
    },
    {
      ruleId: 'payment_history_good',
      ruleName: 'Good Payment History',
      weight: 20,
      enabled: true,
      threshold: 0.9,
      severity: 'warning',
    },
    {
      ruleId: 'no_missed_payments',
      ruleName: 'No Missed Payments',
      weight: 15,
      enabled: true,
      severity: 'warning',
    },
  ],
}

/**
 * Underwriting Rule Engine
 * Evaluates tenant applications against configurable rules
 */
export class UnderwritingRuleEngine {
  private config: RuleEngineConfig

  constructor(config: RuleEngineConfig = DEFAULT_RULE_CONFIG) {
    this.config = config
  }

  /**
   * Update the rule engine configuration
   */
  updateConfig(config: Partial<RuleEngineConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Get current configuration
   */
  getConfig(): RuleEngineConfig {
    return { ...this.config }
  }

  /**
   * Evaluate a tenant application against all enabled rules
   */
  evaluate(context: UnderwritingContext): UnderwritingResult {
    const evaluations: RuleEvaluation[] = []
    let totalScore = 0
    let maxScore = 0

    for (const rule of this.config.rules) {
      if (!rule.enabled) continue

      const evaluation = this.evaluateRule(rule, context)
      evaluations.push(evaluation)

      maxScore += rule.weight
      if (evaluation.passed) {
        totalScore += evaluation.score
      }
    }

    const decision = this.makeDecision(totalScore, maxScore, evaluations)
    const decisionReason = this.generateDecisionReason(decision, evaluations)

    return {
      decision,
      totalScore,
      maxScore,
      triggeredRules: evaluations,
      decisionReason,
      evaluatedAt: new Date().toISOString(),
    }
  }

  /**
   * Evaluate a single rule
   */
  private evaluateRule(rule: RuleConfig, context: UnderwritingContext): RuleEvaluation {
    const result: RuleEvaluation = {
      ruleId: rule.ruleId,
      ruleName: rule.ruleName,
      passed: false,
      score: 0,
      weight: rule.weight,
      reason: '',
      details: {},
    }

    switch (rule.ruleId) {
      case 'deposit_minimum':
        result.passed = context.depositRatio >= (rule.threshold || 0.2)
        result.score = result.passed ? rule.weight : 0
        result.reason = result.passed
          ? `Deposit ratio ${context.depositRatio.toFixed(2)} meets minimum ${rule.threshold}`
          : `Deposit ratio ${context.depositRatio.toFixed(2)} below minimum ${rule.threshold}`
        result.details = { depositRatio: context.depositRatio, threshold: rule.threshold }
        break

      case 'deposit_adequate':
        result.passed = context.depositRatio >= (rule.threshold || 0.3)
        result.score = result.passed ? rule.weight : rule.weight * 0.5
        result.reason = result.passed
          ? `Deposit ratio ${context.depositRatio.toFixed(2)} meets adequate threshold ${rule.threshold}`
          : `Deposit ratio ${context.depositRatio.toFixed(2)} below adequate threshold ${rule.threshold}`
        result.details = { depositRatio: context.depositRatio, threshold: rule.threshold }
        break

      case 'duration_reasonable':
        result.passed = context.duration <= (rule.threshold || 12)
        result.score = result.passed ? rule.weight : rule.weight * 0.5
        result.reason = result.passed
          ? `Duration ${context.duration} months is reasonable`
          : `Duration ${context.duration} months exceeds reasonable threshold ${rule.threshold}`
        result.details = { duration: context.duration, threshold: rule.threshold }
        break

      case 'monthly_payment_affordable': {
        // Assume monthly payment should not exceed 40% of annual rent
        const paymentRatio = context.monthlyPayment / context.annualRent
        result.passed = paymentRatio <= (rule.threshold || 0.4)
        result.score = result.passed ? rule.weight : 0
        result.reason = result.passed
          ? `Monthly payment ratio ${paymentRatio.toFixed(2)} is affordable`
          : `Monthly payment ratio ${paymentRatio.toFixed(2)} exceeds affordability threshold ${rule.threshold}`
        result.details = { paymentRatio, threshold: rule.threshold }
        break
      }

      case 'user_not_frozen':
        result.passed = !context.userRiskState?.isFrozen
        result.score = result.passed ? rule.weight : 0
        result.reason = result.passed
          ? 'User account is not frozen'
          : `User account is frozen: ${context.userRiskState?.freezeReason}`
        result.details = { isFrozen: context.userRiskState?.isFrozen, freezeReason: context.userRiskState?.freezeReason }
        break

      case 'payment_history_good':
        if (context.paymentHistory) {
          result.passed = context.paymentHistory.onTimePaymentRate >= (rule.threshold || 0.9)
          result.score = result.passed ? rule.weight : rule.weight * 0.5
          result.reason = result.passed
            ? `On-time payment rate ${context.paymentHistory.onTimePaymentRate.toFixed(2)} is good`
            : `On-time payment rate ${context.paymentHistory.onTimePaymentRate.toFixed(2)} below threshold ${rule.threshold}`
          result.details = { onTimePaymentRate: context.paymentHistory.onTimePaymentRate, threshold: rule.threshold }
        } else {
          // No payment history - treat as neutral
          result.passed = true
          result.score = rule.weight * 0.5
          result.reason = 'No payment history available - treated as neutral'
          result.details = { hasPaymentHistory: false }
        }
        break

      case 'no_missed_payments':
        if (context.paymentHistory) {
          result.passed = context.paymentHistory.missedPayments === 0
          result.score = result.passed ? rule.weight : rule.weight * 0.3
          result.reason = result.passed
            ? 'No missed payments'
            : `${context.paymentHistory.missedPayments} missed payments detected`
          result.details = { missedPayments: context.paymentHistory.missedPayments }
        } else {
          // No payment history - treat as neutral
          result.passed = true
          result.score = rule.weight * 0.5
          result.reason = 'No payment history available - treated as neutral'
          result.details = { hasPaymentHistory: false }
        }
        break

      default:
        result.passed = true
        result.score = rule.weight
        result.reason = 'Unknown rule - treated as passed'
    }

    return result
  }

  /**
   * Make final decision based on total score and rule evaluations
   */
  private makeDecision(
    totalScore: number,
    maxScore: number,
    evaluations: RuleEvaluation[]
  ): UnderwritingDecision {
    const scorePercentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0

    // Check for critical failures
    const criticalFailures = evaluations.filter(
      (e) => !e.passed && this.getRuleSeverity(e.ruleId) === 'critical'
    )

    if (criticalFailures.length > 0) {
      return 'REJECT'
    }

    // Score-based decision
    if (scorePercentage >= this.config.approveThreshold) {
      return 'APPROVE'
    } else if (scorePercentage >= this.config.reviewThreshold) {
      return 'REVIEW'
    } else {
      return 'REJECT'
    }
  }

  /**
   * Get severity of a rule
   */
  private getRuleSeverity(ruleId: string): string {
    const rule = this.config.rules.find((r) => r.ruleId === ruleId)
    return rule?.severity || 'info'
  }

  /**
   * Generate human-readable decision reason
   */
  private generateDecisionReason(
    decision: UnderwritingDecision,
    evaluations: RuleEvaluation[]
  ): string {
    const failedRules = evaluations.filter((e) => !e.passed)
    const criticalFailures = failedRules.filter(
      (e) => this.getRuleSeverity(e.ruleId) === 'critical'
    )

    if (decision === 'REJECT') {
      if (criticalFailures.length > 0) {
        return `Rejected due to critical failures: ${criticalFailures.map((f) => f.ruleName).join(', ')}`
      }
      return `Rejected due to low score and failed rules: ${failedRules.map((f) => f.ruleName).join(', ')}`
    }

    if (decision === 'REVIEW') {
      return `Requires manual review due to: ${failedRules.map((f) => f.ruleName).join(', ')}`
    }

    return 'Approved - all critical rules passed and score meets threshold'
  }
}
