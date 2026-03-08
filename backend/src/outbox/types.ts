/**
 * Outbox pattern for reliable chain writes
 * Ensures exactly-once delivery of receipts to the blockchain
 */

export enum OutboxStatus {
  PENDING = 'pending',
  SENT = 'sent',
  FAILED = 'failed',
}

export enum TxType {
  RECEIPT = 'receipt',
  TENANT_REPAYMENT = 'tenant_repayment',
  LANDLORD_PAYOUT = 'landlord_payout',
  WHISTLEBLOWER_REWARD = 'whistleblower_reward',
}

/**
 * Canonical external reference for idempotency
 * Format: {source}:{id}
 * Example: "stripe:pi_abc123", "manual:2024-01-15-tenant-001"
 */
export type CanonicalExternalRefV1 = string

export interface OutboxItem {
  id: string
  txType: TxType
  canonicalExternalRefV1: CanonicalExternalRefV1
  txId: string // BytesN<32> as hex string
  payload: Record<string, unknown>
  status: OutboxStatus
  attempts: number
  lastError?: string
  createdAt: Date
  updatedAt: Date
}

export interface CreateOutboxItemInput {
  txType: TxType
  canonicalExternalRefV1: CanonicalExternalRefV1
  payload: Record<string, unknown>
}
