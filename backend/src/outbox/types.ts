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
  STAKE = 'stake',
  UNSTAKE = 'unstake',
  STAKE_REWARD_CLAIM = 'stake_reward_claim',
  CONVERSION = 'conversion',
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

  // Fields from OutboxItemInsert
  aggregateType: string
  aggregateId: string
  eventType: string

  // Retry / processing fields
  retryCount: number
  nextRetryAt: Date | null
  processedAt: Date | null

  createdAt: Date
  updatedAt: Date
}

export interface CreateOutboxItemInput {
  txType: TxType
  source: string  // Payment source (e.g., "paystack", "stellar")
  ref: string     // External payment reference ID
  payload: Record<string, unknown>


  aggregateId?: string
  aggregateType?: string
  eventType?: string
}



export interface Deal {
  id: string;
  canonicalRef: string;
  status: string;
  payload: object;
}



export interface OutboxItemInsert {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
}


