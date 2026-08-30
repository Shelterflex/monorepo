/**
 * Outbox pattern for reliable chain writes
 * Ensures exactly-once delivery of receipts to the blockchain
 */

export enum OutboxStatus {
  PENDING = 'pending',
  SENT = 'sent',
  FAILED = 'failed',
  DEAD = 'dead',
  /** Broadcast succeeded; waiting for confirmation_depth ledger closes. */
  CONFIRMING = 'confirming',
  /** Previously confirmed tx not found on chain after reorg; re-queued. */
  REOPENED = 'reopened',
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
  DEAL_STATUS_CHANGED = 'deal_status_changed',
  TENANT_REPUTATION_UPDATE = 'tenant_reputation_update',
  RENT_RELEASE_DISPUTE_CHALLENGE = 'rent_release_dispute_challenge',
  RENT_RELEASE_DISPUTE_RESOLVE = 'rent_release_dispute_resolve',
  RENT_TO_OWN_DEAL_REGISTERED = 'rent_to_own_deal_registered',
  RENT_TO_OWN_EQUITY_PAYMENT = 'rent_to_own_equity_payment',
  ALLOWLIST_ADD = 'allowlist_add',
  ALLOWLIST_REMOVE = 'allowlist_remove',
  RENT_WALLET_CREDIT = 'rent_wallet_credit',
  RENT_WALLET_DEBIT = 'rent_wallet_debit',
  SLASHING_SUBMIT_EVIDENCE = 'slashing_submit_evidence',
  SLASHING_REVEAL_EVIDENCE = 'slashing_reveal_evidence',
  SLASHING_PROPOSE_SLASH = 'slashing_propose_slash',
  SLASHING_FINALIZE_SLASH = 'slashing_finalize_slash',
  SLASHING_CANCEL_SLASH = 'slashing_cancel_slash',
  BOND_DEPOSIT = 'bond_deposit',
  BOND_WITHDRAW = 'bond_withdraw',
  WHISTLEBLOWER_REWARD_ALLOCATE = 'whistleblower_reward_allocate',
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

  // Exactly-once settlement fields (migration 041)
  /** Stellar tx hash set before broadcast so a crash can be recovered without double-submit. */
  submittedTxHash?: string
  /** Ledger sequence where the tx was confirmed; used with confirmationDepth. */
  submittedLedger?: number
  /** Ledger closes required after submittedLedger before marking SENT. */
  confirmationDepth: number
  /** Worker instance UUID holding an advisory claim on this row. */
  claimedBy?: string

  /** Correlation ID linking this item to the originating HTTP request. */
  requestId?: string

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

  /** Correlation ID from the originating HTTP request. */
  requestId?: string
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


