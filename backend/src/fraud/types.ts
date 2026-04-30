export enum SignalType {
  RULE = 'rule',
  THRESHOLD = 'threshold',
  PATTERN = 'pattern',
}

export enum RiskLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum ActionType {
  NONE = 'none',
  HOLD = 'hold',
  BLOCK = 'block',
  REVIEW_QUEUE = 'review_queue',
}

export enum EntityType {
  ACCOUNT = 'account',
  PAYMENT = 'payment',
  TRANSACTION = 'transaction',
}

export interface FraudSignal {
  id: string
  name: string
  description: string | null
  signalType: SignalType
  config: Record<string, unknown>
  enabled: boolean
  scoreWeight: number
  createdAt: Date
  updatedAt: Date
}

export interface CreateSignalInput {
  name: string
  description?: string
  signalType: SignalType
  config: Record<string, unknown>
  enabled?: boolean
  scoreWeight?: number
}

export interface SignalMatch {
  signalId: string
  signalName: string
  score: number
  details: Record<string, unknown>
}

export interface FraudAssessment {
  id: string
  entityType: EntityType
  entityId: string
  totalScore: number
  riskLevel: RiskLevel
  actionTaken: ActionType | null
  signalMatches: SignalMatch[]
  context: Record<string, unknown>
  assessedAt: Date
  createdAt: Date
}

export interface AssessmentContext {
  entityType: EntityType
  entityId: string
  eventData: Record<string, unknown>
  metadata?: Record<string, unknown>
  context?: Record<string, unknown>
}

export interface AccountHold {
  id: string
  accountId: string
  assessmentId: string
  holdType: 'full' | 'partial' | 'transaction_limit'
  holdReason: string
  releasedAt: Date | null
  releasedBy: string | null
  createdAt: Date
}
