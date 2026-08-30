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
 * A read from the `oracle_price_feeds` contract's `PriceFeed` struct.
 * `price` is scaled by `10^decimals` (decimals is always 7 in the contract).
 */
export interface OraclePriceReading {
  price: bigint
  decimals: number
  updatedAt: number
  sequence: number
}

/**
 * Mirrors `ProposalStatus` in contracts/governance/src/lib.rs.
 */
export type GovernanceProposalStatus =
  | 'Active'
  | 'Passed'
  | 'Rejected'
  | 'Executed'
  | 'Cancelled'

/**
 * Mirrors the `Proposal` struct in contracts/governance/src/lib.rs.
 *
 * All i128 fields are carried as decimal *strings* rather than numbers so that
 * values larger than Number.MAX_SAFE_INTEGER survive the trip through JSON
 * without silent precision loss.
 *
 * `paramKey` is an arbitrary Soroban `Symbol` chosen by the proposer — the
 * contract neither validates nor enumerates it, so it is opaque to the backend
 * too (see the PR description's contract findings).
 */
export interface GovernanceProposal {
  id: number
  proposer: string
  paramKey: string
  currentValue: string
  proposedValue: string
  votesFor: string
  votesAgainst: string
  status: GovernanceProposalStatus
  createdAt: number
  votingEndsAt: number
  snapshottedTotalStaked: string
}

export interface CreateGovernanceProposalParams {
  /** Stellar address of the proposer; also the transaction's source account. */
  proposer: string
  paramKey: string
  currentValue: bigint
  proposedValue: bigint
}

export interface GovernanceVoteParams {
  /** Stellar address of the voter; also the transaction's source account. */
  voter: string
  proposalId: number
  support: boolean
}

/** An unsigned transaction envelope awaiting a signature from the end user's wallet. */
export interface UnsignedTransaction {
  xdr: string
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
 * On-chain representation of a tenant's aggregated reputation.
 * Scores are on a 0–1000 scale (off-chain 1–5 avg × 200).
 */
export interface TenantReputationRecord {
  compositeScore: number
  paymentScore: number
  propertyCareScore: number
  communicationScore: number
  totalRatings: number
  lastUpdated: bigint
}

/**
 * A single delegation row from stake_delegation's `get_delegations`, mirroring
 * the contract's `Delegation` struct.
 *
 * `amount` is in stake_delegation's own units (USDC, 6 decimals). Note that
 * stake_delegation keeps a *separate* stake ledger from staking_pool — see
 * `DelegationPosition` — so this amount is never a slice of the staking_pool
 * position surfaced by `getStakedBalance`.
 */
export interface DelegationRecord {
  delegatee: string
  amount: bigint
  activatedEpoch: number
}

/**
 * A delegator's full position inside stake_delegation. `staked` is the balance
 * held by stake_delegation itself (`staked_balance`), NOT the staking_pool
 * position; `delegated` is the part of it currently routed to delegatees and
 * `free` is the remainder the contract will let the user delegate or unstake.
 */
export interface DelegationPosition {
  staked: bigint
  delegated: bigint
  free: bigint
  currentEpoch: number
  delegations: DelegationRecord[]
}

/**
 * What a delegatee has earned: net rewards after their commission split, plus
 * the commission itself. The contract exposes no getter for the configured
 * commission *rate*, so only the two balances are readable off-chain.
 */
export interface DelegateeEarnings {
  claimable: bigint
  commissionClaimable: bigint
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

/**
 * Allowlist entry from allowlist_registry contract.
 * Mirrors the contract's Entry struct.
 */
export interface AllowlistEntry {
  label: string           // Human-readable label (role, tier, etc.)
  expires_at: number      // Unix timestamp (seconds) after which entry is expired. 0 means no expiry.
  added_at: number        // Ledger sequence number when entry was added
}

/**
 * Epoch info from epoch_rewards contract.
 * Mirrors the contract's EpochInfo struct.
 */
export interface EpochInfo {
  epoch_number: number
  start_ts: number
  duration_secs: number
  end_ts: number
  seal_ts: number
  sealed: boolean
  total_rewards: bigint
  carried_forward: bigint
  reward_index_at_seal: bigint
  dust: bigint
  total_claimable_at_seal: bigint
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

  // Inspector bond operations (inspector_bond contract)
  stakeBond(inspectorId: string, amount: bigint): Promise<void>
  unstakeBond(inspectorId: string): Promise<void>
  isBonded(inspectorId: string): Promise<boolean>
  getBond(inspectorId: string): Promise<{ isBonded: boolean; amount: bigint }>

  /**
   * Query the current on-chain status of a previously submitted transaction.
   * Used for crash recovery: if a worker persisted a txHash but crashed before
   * recording the result, the next worker queries this instead of resubmitting.
   *
   * Optional: adapters that do not support status queries (e.g. simple stubs)
   * may omit this method; the sender will fall back to blind resubmission.
   */
  getTransactionStatus?(txHash: string): Promise<TxOnChainStatus>

  // Tenant reputation contract (tenant_reputation)
  updateTenantReputation?(tenantId: string, record: TenantReputationRecord): Promise<void>
  getTenantReputation?(tenantId: string): Promise<TenantReputationRecord | null>

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

  // Upgradeable proxy governance (upgradeable_proxy contract)
  proposeUpgrade?(newWasmHash: string): Promise<string>
  confirmUpgrade?(newWasmHash: string): Promise<string>
  cancelUpgrade?(): Promise<string>
  transferAdmin?(newAdminAddress: string): Promise<string>
  hasPendingUpgrade?(): Promise<boolean>
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

  // stake_delegation contract (#1489) — a standalone delegated-staking ledger,
  // disjoint from staking_pool/staking_rewards. See real-adapter.ts for the
  // signer-model caveat on the write methods.
  delegateStake?(delegator: string, delegatee: string, amount: bigint): Promise<string>
  requestUndelegate?(delegator: string, delegatee: string, amount: bigint): Promise<string>
  completeUndelegate?(delegator: string, delegatee: string): Promise<string>
  claimDelegateeRewards?(delegatee: string): Promise<string>
  setDelegateeCommission?(delegatee: string, rateBps: number): Promise<string>
  claimDelegateeCommission?(delegatee: string): Promise<string>
  getDelegations?(delegator: string): Promise<DelegationRecord[]>
  getDelegationStakedBalance?(account: string): Promise<bigint>
  getDelegationEpoch?(): Promise<number>
  getDelegateeClaimable?(delegatee: string): Promise<bigint>
  getDelegateeCommissionClaimable?(delegatee: string): Promise<bigint>

  // oracle_price_feeds contract — read-only price queries (issue #1488)
  getOraclePrice?(pair: string): Promise<OraclePriceReading>
  isOraclePriceStale?(pair: string): Promise<boolean>

  // epoch_rewards contract — epoch-based staking rewards
  epochStake?(user: string, amount: bigint): Promise<string>
  epochUnstake?(user: string, amount: bigint): Promise<string>
  epochClaim?(user: string): Promise<bigint>
  epochGetClaimable?(user: string): Promise<bigint>
  epochGetEpoch?(epochNumber: number): Promise<EpochInfo | null>
  epochGetCurrentEpoch?(): Promise<number>
  epochGetTotalStaked?(): Promise<bigint>
  epochFundRewards?(caller: string, amount: bigint): Promise<string>
  epochSeal?(caller: string, targetEpoch: number, nextEpochDurationSecs: number): Promise<string>

  // rent_wallet contract — custodial ledger for tenant rent balances
  rentWalletCredit?(account: string, amount: bigint): Promise<string>
  rentWalletDebit?(account: string, amount: bigint): Promise<string>
  rentWalletBalance?(account: string): Promise<bigint>

  // slashing_module contract — evidence-based slashing system
  submitEvidence?(submitter: string, commitment: string, actor: string, offence: string): Promise<number>
  revealEvidence?(submitter: string, slashId: number, evidence: string, salt: string): Promise<void>
  proposeSlash?(submitter: string, actor: string, penaltyBps: number): Promise<number>
  finalizeSlash?(caller: string, slashId: number): Promise<void>
  cancelSlash?(admin: string, slashId: number): Promise<void>

  // bond_collateral contract — inspector bond management
  depositBond?(inspector: string, amount: bigint): Promise<void>
  withdrawBond?(inspector: string, amount: bigint): Promise<void>
  getBondBalance?(inspector: string): Promise<bigint>

  // ── governance contract — stake-weighted parameter voting (issue #1494) ────
  //
  // `create_proposal` and `vote` call `require_auth()` on the proposer/voter,
  // so they cannot be signed with SOROBAN_ADMIN_SECRET on a user's behalf.
  // These two methods therefore return an *unsigned* envelope for the user's
  // own wallet to sign, which is then broadcast via submitGovernanceTransaction.
  createProposal?(params: CreateGovernanceProposalParams): Promise<UnsignedTransaction>
  vote?(params: GovernanceVoteParams): Promise<UnsignedTransaction>
  /**
   * Broadcast a transaction envelope that was signed client-side (by the
   * connected wallet) and wait for confirmation. Needed to complete the
   * user-signed half of the flow above; it authorizes nothing itself.
   */
  submitGovernanceTransaction?(signedXdr: string): Promise<{ txHash: string }>
  /**
   * `finalize_proposal` and `execute_proposal` take no Address argument and
   * call no `require_auth()` on-chain — they are permissionless once their
   * time conditions are met. The admin key here only pays the fee and submits.
   */
  finalizeProposal?(proposalId: number): Promise<string>
  executeProposal?(proposalId: number): Promise<string>
  getProposal?(proposalId: number): Promise<GovernanceProposal | null>
  getProposalCount?(): Promise<number>

  // vesting_schedule contract — linear vesting with cliff
  createVestingSchedule?(beneficiary: string, totalAmount: bigint, startTime: number, endTime: number, cliffTime: number, revocable: boolean): Promise<string>
  claimVested?(beneficiary: string): Promise<bigint>
  revokeVesting?(beneficiary: string): Promise<bigint>
  getClaimableVested?(beneficiary: string): Promise<bigint>

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
}
