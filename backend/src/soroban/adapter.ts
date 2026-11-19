import { SorobanConfig } from './client.js'
import { TxType } from '../outbox/types.js'
import { RawReceiptEvent } from '../indexer/event-parser.js'

export interface RecordReceiptParams {
  txId: string           // BytesN<32> as hex string - deterministic idempotency key (SHA-256 of canonical external ref)
  txType: TxType
  amountUsdc: string     // USDC amount (canonical); decimal string
  tokenAddress: string   // USDC token contract address
  dealId: string
  listingId?: string
  from?: string
  to?: string
  amountNgn?: number
  fxRate?: number
  fxProvider?: string
  metadataHash?: string
  // New fields for transaction-receipt-contract
  externalRefSource?: string  // e.g., "paystack", "stellar", "manual"
  externalRef?: string        // External payment reference string
}

export type DealSyncStatus = 'active' | 'completed' | 'defaulted'

export interface SyncDealStatusParams {
  dealId: string
  contractDealId: string
  newStatus: DealSyncStatus
  actor: string
}

/**
 * deal_escrow's rent-release dispute mechanism (request_rent_release /
 * challenge_rent_release / resolve_rent_dispute / settle_*_timeout).
 * `dealId` here is deal_escrow's own String-typed deal ID (unlike
 * rent_to_own, deal_escrow does not use BytesN<32>).
 */
export interface RequestRentReleaseParams {
  dealId: string
  to: string // Stellar Address of the release recipient (e.g. landlord)
  amountUsdc: string // decimal string, USDC (6 decimals)
  externalRefSource: string
  externalRef: string
}

export interface ChallengeRentReleaseParams {
  dealId: string
  challengeEvidenceRef: string
}

/** Mirrors the contract's `SettlementOutcome` enum discriminants (1/2). */
export type RentDisputeOutcome = 'release_to_recipient' | 'refund_to_depositor'

export interface ResolveRentDisputeParams {
  dealId: string
  outcome: RentDisputeOutcome
  resolutionEvidenceRef: string
}

export interface SettleRentReleaseTimeoutParams {
  dealId: string
}

export interface SettleDisputeTimeoutParams {
  dealId: string
}

/**
 * Params for rent_to_own's `register_deal`. `contractDealId` is a hex-encoded
 * BytesN<32> — distinct from deal_escrow's String-typed deal ID (see
 * `SyncDealStatusParams.contractDealId`); rent_to_own and deal_escrow do not
 * share a deal-ID encoding.
 */
export interface RegisterRentToOwnDealParams {
  dealId: string
  contractDealId: string // hex-encoded BytesN<32>
  tenantAddress: string // Stellar Address of the tenant
  propertyValueUsdc: string // decimal string, USDC (6 decimals)
  monthlyEquityUsdc: string // decimal string, USDC (6 decimals)
  totalPaymentsRequired: number
}

export interface RecordRentToOwnEquityPaymentParams {
  dealId: string
  contractDealId: string // hex-encoded BytesN<32>
  period: number
  rentAmountUsdc: string // decimal string, USDC (6 decimals)
  equityAmountUsdc: string // decimal string, USDC (6 decimals)
}

export interface RentToOwnDealActionParams {
  dealId: string
  contractDealId: string // hex-encoded BytesN<32>
  /** Only used by defaultRentToOwnDeal; a short symbol-safe reason code. */
  reason?: string
}

/**
 * Callback fired after a Stellar transaction is signed and hashed but *before*
 * it is broadcast to the network. Persisting the hash at this point allows a
 * worker that crashes between broadcast and result-recording to recover by
 * querying the chain for the known hash rather than blindly resubmitting.
 */
export interface TxBroadcastHooks {
  /** Called with the signed tx hash just before sendTransaction. */
  onTxBuilt?: (txHash: string) => Promise<void>
}

/** On-chain status of a previously submitted Stellar transaction. */
export interface TxOnChainStatus {
  status: 'success' | 'failed' | 'not_found' | 'pending'
  /** Ledger sequence in which the tx was applied (only set for 'success'). */
  ledger?: number
}

/**
 * On-chain receipt from transaction-receipt-contract.
 * Mirrors the contract's Receipt struct.
 */
export interface OnChainReceipt {
  tx_id: string           // BytesN<32> as hex string
  tx_type: string         // Symbol
  amount_usdc: string     // i128 as decimal string
  token: string           // Address
  deal_id: string
  listing_id?: string
  from?: string
  to?: string
  external_ref: string    // BytesN<32> as hex string
  amount_ngn?: string     // i128 as decimal string
  fx_rate_ngn_per_usdc?: string  // i128 as decimal string
  fx_provider?: string
  metadata_hash?: string  // BytesN<32> as hex string
  timestamp: number       // u64
}

/** An argument for a call proposed through the multisig contract, in a form that survives JSON. */
export type MultisigArg =
  | { type: 'address'; value: string }
  | { type: 'symbol'; value: string }
  | { type: 'string'; value: string }
  | { type: 'bool'; value: boolean }
  /** A BytesN<32>, as 64 hex characters. */
  | { type: 'bytes32'; value: string }
  | { type: 'u32' | 'i32'; value: number }
  | { type: 'u64' | 'i64' | 'u128' | 'i128'; value: string }

export type MultisigProposalStatus = 'pending' | 'executed' | 'cancelled' | 'expired'

/** Mirrors the multisig_admin contract's `Proposal`. Times are unix seconds. */
export interface MultisigProposal {
  id: number
  proposer: string
  target: string
  function: string
  /** Arguments decoded to JSON-safe values (large integers as decimal strings). */
  args: unknown[]
  approvals: string[]
  status: MultisigProposalStatus
  createdAt: number
  expiresAt: number
}

/** The multisig contract's signer set and approval threshold. */
export interface MultisigConfig {
  signers: string[]
  threshold: number
}

/** The user-signed calls on the multisig_admin contract (#1972). */
export type MultisigCall = 'propose' | 'approve' | 'revoke_approval' | 'execute'

/** What a prepare/submit pair of a multisig call acts on. */
export interface MultisigCallParams {
  /** The signer's wallet (G...), who must sign the transaction. */
  signer: string
  /** Required for approve, revoke_approval and execute. */
  proposalId?: number
  /** Required for propose. */
  target?: string
  functionName?: string
  args?: MultisigArg[]
}

/**
 * Allowlist entry from allowlist_registry contract.
 * Mirrors the contract's Entry struct.
 */
export interface AllowlistEntry {
  label: string           // Human-readable label (role, tier, etc.)
  expires_at: number      // Unix timestamp (seconds) after which entry is expired. 0 means no expiry.
  added_at: number        // Ledger sequence number when entry was added
}

export interface SorobanAdapter {
  getBalance(account: string): Promise<bigint>
  credit(account: string, amount: bigint): Promise<void>
  debit(account: string, amount: bigint): Promise<void>
  getStakedBalance(account: string): Promise<bigint>
  getClaimableRewards(account: string): Promise<bigint>
  // MVP staking pool (#1493), additive to the legacy staking pair.
  stake?(account: string, amount: bigint): Promise<string>
  unstake?(account: string, amount: bigint): Promise<string>
  mvpStakedBalance?(account: string): Promise<bigint>
  usedStake?(account: string): Promise<bigint>
  unusedStake?(account: string): Promise<bigint>
  utilizeStake?(user: string, amount: bigint): Promise<string>
  claimable?(account: string): Promise<bigint>
  claim?(account: string): Promise<string>
  recordReceipt(params: RecordReceiptParams, hooks?: TxBroadcastHooks): Promise<void>
  getConfig(): SorobanConfig
  getReceiptEvents(fromLedger: number | null): Promise<RawReceiptEvent[]>
  getTimelockEvents(fromLedger: number | null): Promise<any[]>
  // Direct query methods for transaction-receipt-contract
  getReceiptById?(txId: string): Promise<OnChainReceipt | null>
  listReceiptsByDeal?(dealId: string, limit: number, cursor?: number): Promise<OnChainReceipt[]>
  listReceiptsByUser?(userAddress: string, limit: number, cursor?: number): Promise<OnChainReceipt[]>
  // Allowlist registry methods
  addToAllowlist?(address: string, label: string, expiresAt?: number): Promise<string>
  removeFromAllowlist?(address: string): Promise<string>
  isAllowlisted?(address: string): Promise<boolean>
  getAllowlistEntry?(address: string): Promise<AllowlistEntry | null>
  executeTimelock(txHash: string, target: string, functionName: string, args: any[], eta: number): Promise<string>
  cancelTimelock(txHash: string): Promise<string>

  /**
   * Query the current on-chain status of a previously submitted transaction.
   * Used for crash recovery: if a worker persisted a txHash but crashed before
   * recording the result, the next worker queries this instead of resubmitting.
   *
   * Optional: adapters that do not support status queries (e.g. simple stubs)
   * may omit this method; the sender will fall back to blind resubmission.
   */
  getTransactionStatus?(txHash: string): Promise<TxOnChainStatus>

  // Admin operations (require SOROBAN_ADMIN_SIGNING_ENABLED=true)
  pause?(contractId: string): Promise<string>
  unpause?(contractId: string): Promise<string>
  setOperator?(contractId: string, operatorAddress: string | null): Promise<string>
  init?(contractId: string, adminAddress: string, operatorAddress?: string): Promise<string>
  syncDealStatus?(params: SyncDealStatusParams): Promise<void>

  // Contract access role management (contract_access contract)
  proposeAssignRole?(subject: string, role: number): Promise<string>
  confirmAssignRole?(subject: string): Promise<string>
  delegatePermission?(delegatee: string, permission: number): Promise<string>
  getRole?(address: string): Promise<number | null>
  hasPermission?(address: string, permission: number): Promise<boolean>
  listRoles?(): Promise<Array<{ address: string; role: number }>>

  // deal_escrow rent-release dispute mechanism
  requestRentRelease?(params: RequestRentReleaseParams): Promise<void>
  challengeRentRelease?(params: ChallengeRentReleaseParams): Promise<void>
  resolveRentDispute?(params: ResolveRentDisputeParams): Promise<void>
  settleRentReleaseTimeout?(params: SettleRentReleaseTimeoutParams): Promise<void>
  settleDisputeTimeout?(params: SettleDisputeTimeoutParams): Promise<void>

  // rent_to_own contract — equity-tracking deal lifecycle
  registerRentToOwnDeal?(params: RegisterRentToOwnDealParams): Promise<void>
  recordRentToOwnEquityPayment?(params: RecordRentToOwnEquityPaymentParams): Promise<void>
  completeRentToOwnDeal?(params: RentToOwnDealActionParams): Promise<void>
  defaultRentToOwnDeal?(params: RentToOwnDealActionParams): Promise<void>

  // rent_wallet contract — custodial ledger for tenant rent balances
  rentWalletCredit?(account: string, amount: bigint): Promise<string>
  rentWalletDebit?(account: string, amount: bigint): Promise<string>
  rentWalletBalance?(account: string): Promise<bigint>

  // whistleblower_rewards contract — on-chain reward allocation and claiming
  allocateReward?(whistleblower: string, amount: bigint): Promise<string>
  claimReward?(whistleblower: string): Promise<bigint>
  getClaimableReward?(whistleblower: string): Promise<bigint>

  // rent_payments contract — deal-scoped rent payment receipts
  createRentPaymentReceipt?(dealId: string, amount: bigint, payer: string, recipient: string, timestamp: number): Promise<string>
  listRentPaymentReceiptsByDeal?(dealId: string, limit: number): Promise<any[]>
  rentPaymentReceiptCount?(dealId: string): Promise<number>

  // deal_escrow circuit-breaker — emergency controls
  freeze?(): Promise<string>
  isFrozen?(): Promise<boolean>
  proposeDrain?(destination: string): Promise<string>
  executeDrain?(): Promise<string>
  setRecoveryDelay?(delaySeconds: number): Promise<string>
  getCircuitBreakerState?(): Promise<{ frozen: boolean; drainProposed: boolean; drainDestination?: string; recoveryDelay: number }>

  // multisig_admin contract — M-of-N approval for privileged on-chain actions (#1972).
  // Signers approve with their own wallets (prepare/submit). When the multisig is
  // configured, selected admin operations are proposed through `multisigPropose`,
  // signed by the platform key (which must be a registered signer).
  /** Contract ids the multisig gate needs to name as the target of a covered admin operation. */
  multisigTargetFor?(contract: 'dealEscrow' | 'contractAccess'): string | undefined
  multisigEnabled?(): boolean
  multisigContractId?(): string | undefined
  multisigGetConfig?(): Promise<MultisigConfig>
  multisigListProposals?(status?: MultisigProposalStatus): Promise<MultisigProposal[]>
  multisigGetProposal?(proposalId: number): Promise<MultisigProposal | null>
  multisigPropose?(
    target: string,
    functionName: string,
    args: MultisigArg[],
  ): Promise<{ txHash: string; proposalId?: number }>
  prepareMultisigCall?(call: MultisigCall, params: MultisigCallParams): Promise<string>
  submitMultisigCall?(
    signedXdr: string,
    call: MultisigCall,
    params: MultisigCallParams,
  ): Promise<string>
}
