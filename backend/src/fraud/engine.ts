import { logger } from '../utils/logger.js'
import { getFraudStore } from './store.js'
import {
  type FraudSignal,
  type FraudAssessment,
  type AssessmentContext,
  type SignalMatch,
  SignalType,
  RiskLevel,
  ActionType,
  EntityType,
} from './types.js'

interface ThresholdConfig {
  field: string
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte'
  value: number
}

interface RuleConfig {
  conditions: Array<{
    field: string
    operator: 'eq' | 'neq' | 'contains' | 'regex'
    value: string | number
  }>
  logic?: 'AND' | 'OR'
}

interface PatternConfig {
  field: string
  pattern: string
  flags?: string
}

interface FraudThresholds {
  medium: number
  high: number
  critical: number
}

const DEFAULT_THRESHOLDS: FraudThresholds = {
  medium: 30,
  high: 60,
  critical: 90,
}

export class FraudDetectionEngine {
  private thresholds: FraudThresholds

  constructor(thresholds?: Partial<FraudThresholds>) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds }
  }

  /**
   * Evaluate an event against all active fraud signals
   */
  async evaluate(context: AssessmentContext): Promise<FraudAssessment> {
    const store = getFraudStore()
    const signals = await store.listSignals({ enabled: true })

    const matches: SignalMatch[] = []
    let totalScore = 0

    for (const signal of signals) {
      const match = await this.evaluateSignal(signal, context)
      if (match) {
        matches.push(match)
        totalScore += match.score
      }
    }

    const riskLevel = this.calculateRiskLevel(totalScore)
    const actionTaken = this.determineAction(riskLevel, context)

    const assessment = await store.createAssessment(
      context.entityType,
      context.entityId,
      totalScore,
      riskLevel,
      actionTaken,
      matches,
      context.context || {},
    )

    logger.info('Fraud assessment completed', {
      entityType: context.entityType,
      entityId: context.entityId,
      totalScore,
      riskLevel,
      actionTaken,
      signalCount: matches.length,
    })

    // Execute action if needed
    if (actionTaken === ActionType.HOLD && context.entityType === EntityType.ACCOUNT) {
      await this.applyAccountHold(context.entityId, assessment.id, riskLevel)
    }

    return assessment
  }

  private async evaluateSignal(signal: FraudSignal, context: AssessmentContext): Promise<SignalMatch | null> {
    try {
      switch (signal.signalType) {
        case SignalType.THRESHOLD:
          return this.evaluateThreshold(signal, context)
        case SignalType.RULE:
          return this.evaluateRule(signal, context)
        case SignalType.PATTERN:
          return this.evaluatePattern(signal, context)
        default:
          logger.warn('Unknown signal type', { signalType: signal.signalType, signalId: signal.id })
          return null
      }
    } catch (err) {
      logger.error('Error evaluating fraud signal', {
        signalId: signal.id,
        signalName: signal.name,
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  }

  private evaluateThreshold(signal: FraudSignal, context: AssessmentContext): SignalMatch | null {
    const config = signal.config as unknown as ThresholdConfig
    const fieldValue = this.getFieldValue(config.field, context.eventData)

    if (typeof fieldValue !== 'number') {
      return null
    }

    let matched = false
    switch (config.operator) {
      case 'gt':
        matched = fieldValue > config.value
        break
      case 'lt':
        matched = fieldValue < config.value
        break
      case 'eq':
        matched = fieldValue === config.value
        break
      case 'gte':
        matched = fieldValue >= config.value
        break
      case 'lte':
        matched = fieldValue <= config.value
        break
    }

    if (matched) {
      return {
        signalId: signal.id,
        signalName: signal.name,
        score: signal.scoreWeight,
        details: {
          field: config.field,
          operator: config.operator,
          threshold: config.value,
          actualValue: fieldValue,
        },
      }
    }

    return null
  }

  private evaluateRule(signal: FraudSignal, context: AssessmentContext): SignalMatch | null {
    const config = signal.config as unknown as RuleConfig
    const logic = config.logic || 'AND'

    const results = config.conditions.map(condition => {
      const fieldValue = this.getFieldValue(condition.field, context.eventData)
      return this.evaluateCondition(fieldValue, condition.operator, condition.value)
    })

    let matched = false
    if (logic === 'AND') {
      matched = results.every(r => r)
    } else {
      matched = results.some(r => r)
    }

    if (matched) {
      return {
        signalId: signal.id,
        signalName: signal.name,
        score: signal.scoreWeight,
        details: {
          conditions: config.conditions,
          logic,
          results,
        },
      }
    }

    return null
  }

  private evaluatePattern(signal: FraudSignal, context: AssessmentContext): SignalMatch | null {
    const config = signal.config as unknown as PatternConfig
    const fieldValue = this.getFieldValue(config.field, context.eventData)

    if (typeof fieldValue !== 'string') {
      return null
    }

    const regex = new RegExp(config.pattern, config.flags || '')
    const matched = regex.test(fieldValue)

    if (matched) {
      return {
        signalId: signal.id,
        signalName: signal.name,
        score: signal.scoreWeight,
        details: {
          field: config.field,
          pattern: config.pattern,
          matchedValue: fieldValue,
        },
      }
    }

    return null
  }

  private evaluateCondition(
    fieldValue: unknown,
    operator: string,
    expectedValue: string | number,
  ): boolean {
    switch (operator) {
      case 'eq':
        return fieldValue === expectedValue
      case 'neq':
        return fieldValue !== expectedValue
      case 'contains':
        return typeof fieldValue === 'string' && fieldValue.includes(String(expectedValue))
      case 'regex':
        return typeof fieldValue === 'string' && new RegExp(String(expectedValue)).test(fieldValue)
      default:
        return false
    }
  }

  private getFieldValue(field: string, data: Record<string, unknown>): unknown {
    const parts = field.split('.')
    let value: unknown = data

    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = (value as Record<string, unknown>)[part]
      } else {
        return null
      }
    }

    return value
  }

  private calculateRiskLevel(score: number): RiskLevel {
    if (score >= this.thresholds.critical) return RiskLevel.CRITICAL
    if (score >= this.thresholds.high) return RiskLevel.HIGH
    if (score >= this.thresholds.medium) return RiskLevel.MEDIUM
    return RiskLevel.LOW
  }

  private determineAction(riskLevel: RiskLevel, context: AssessmentContext): ActionType {
    // Critical: always block
    if (riskLevel === RiskLevel.CRITICAL) {
      return ActionType.BLOCK
    }

    // High: hold for review
    if (riskLevel === RiskLevel.HIGH) {
      return ActionType.HOLD
    }

    // Medium: add to review queue
    if (riskLevel === RiskLevel.MEDIUM) {
      return ActionType.REVIEW_QUEUE
    }

    // Low: no action
    return ActionType.NONE
  }

  private async applyAccountHold(accountId: string, assessmentId: string, riskLevel: RiskLevel): Promise<void> {
    const store = getFraudStore()

    const holdType = riskLevel === RiskLevel.CRITICAL ? 'full' : 'partial'
    const holdReason = `Fraud detection: ${riskLevel} risk level`

    await store.createAccountHold(accountId, assessmentId, holdType, holdReason)

    logger.info('Account hold applied', { accountId, assessmentId, holdType, riskLevel })
  }

  /**
   * Update risk thresholds
   */
  updateThresholds(thresholds: Partial<FraudThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds }
  }

  /**
   * Get current thresholds
   */
  getThresholds(): FraudThresholds {
    return { ...this.thresholds }
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton
// ---------------------------------------------------------------------------

let engine: FraudDetectionEngine | null = null

export function getFraudEngine(): FraudDetectionEngine {
  if (!engine) engine = new FraudDetectionEngine()
  return engine
}

export function initFraudEngine(instance: FraudDetectionEngine): void {
  engine = instance
}
