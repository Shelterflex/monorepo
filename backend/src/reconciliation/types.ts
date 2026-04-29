export type EventType = 'credit' | 'debit'
export type LedgerEventStatus = 'pending' | 'matched' | 'unmatched'
export type MismatchClass =
  | 'missing_credit'
  | 'duplicate_debit'
  | 'amount_mismatch'
  | 'delayed_settlement'
export type MismatchStatus = 'open' | 'auto_resolved' | 'escalated' | 'closed'

export interface LedgerEvent {
  id: string
  eventType: EventType
  amountMinor: bigint
  currency: string
  internalRef: string
  rail: string
  userId?: string
  status: LedgerEventStatus
  occurredAt: Date
  createdAt: Date
}

export interface ProviderEvent {
  id: string
  provider: string
  providerEventId: string
  eventType: EventType
  amountMinor: bigint
  currency: string
  internalRef?: string
  rawStatus: string
  occurredAt: Date
  createdAt: Date
}

export interface Mismatch {
  id: string
  mismatchClass: MismatchClass
  ledgerEventId?: string
  providerEventId?: string
  expectedAmountMinor?: bigint
  actualAmountMinor?: bigint
  toleranceMinor: bigint
  status: MismatchStatus
  resolutionWorkflow?: string
  resolutionAttempts: number
  lastResolutionAt?: Date
  escalatedAt?: Date
  slaDeadline?: Date
  traceContext: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface IngestLedgerEventInput {
  eventType: EventType
  amountMinor: bigint
  currency?: string
  internalRef: string
  rail: string
  userId?: string
  occurredAt: Date
}

export interface IngestProviderEventInput {
  provider: string
  providerEventId: string
  eventType: EventType
  amountMinor: bigint
  currency?: string
  internalRef?: string
  rawStatus: string
  occurredAt: Date
}

export interface ToleranceRule {
  rail: string
  toleranceMinor: bigint
  /** Max seconds before a settlement is considered delayed */
  maxDelaySeconds: number
  /** Max auto-resolution attempts before escalation */
  maxResolutionAttempts: number
}

export const DEFAULT_TOLERANCE_RULES: ToleranceRule[] = [
  { rail: 'paystack',    toleranceMinor: 100n,  maxDelaySeconds: 3600,  maxResolutionAttempts: 3 },
  { rail: 'flutterwave', toleranceMinor: 100n,  maxDelaySeconds: 3600,  maxResolutionAttempts: 3 },
  { rail: 'manual',      toleranceMinor: 0n,    maxDelaySeconds: 86400, maxResolutionAttempts: 1 },
]

export const SLA_HOURS_BY_CLASS: Record<MismatchClass, number> = {
  missing_credit:    24,
  duplicate_debit:   4,
  amount_mismatch:   12,
  delayed_settlement: 48,
}
