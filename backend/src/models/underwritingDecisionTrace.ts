/**
 * Underwriting Decision Trace Model
 * Stores audit trail of underwriting decisions for transparency and recalibration
 */

import { UnderwritingDecision, RuleEvaluation } from '../services/underwritingRuleEngine.js'

export interface UnderwritingDecisionTrace {
  id: string
  applicationId: string
  userId: string
  decision: UnderwritingDecision
  totalScore: number
  maxScore: number
  triggeredRules: RuleEvaluation[]
  decisionReason: string
  ruleConfigVersion: string
  evaluatedAt: string
  createdAt: string
}

export interface CreateUnderwritingDecisionTraceInput {
  applicationId: string
  userId: string
  decision: UnderwritingDecision
  totalScore: number
  maxScore: number
  triggeredRules: RuleEvaluation[]
  decisionReason: string
  ruleConfigVersion: string
  evaluatedAt: string
}

export interface UnderwritingDecisionTraceStore {
  create(input: CreateUnderwritingDecisionTraceInput): Promise<UnderwritingDecisionTrace>
  findById(id: string): Promise<UnderwritingDecisionTrace | null>
  findByApplicationId(applicationId: string): Promise<UnderwritingDecisionTrace[]>
  findByUserId(userId: string): Promise<UnderwritingDecisionTrace[]>
  list(filters?: {
    decision?: UnderwritingDecision
    limit?: number
    offset?: number
  }): Promise<{ traces: UnderwritingDecisionTrace[]; total: number }>
}
