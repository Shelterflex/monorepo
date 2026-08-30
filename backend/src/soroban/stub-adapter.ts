import {
     SorobanAdapter,
     RecordReceiptParams,
     SyncDealStatusParams,
     TenantReputationRecord,
     RequestRentReleaseParams,
     ChallengeRentReleaseParams,
     ResolveRentDisputeParams,
     SettleRentReleaseTimeoutParams,
     SettleDisputeTimeoutParams,
     RegisterRentToOwnDealParams,
     RecordRentToOwnEquityPaymentParams,
     RentToOwnDealActionParams,
     OraclePriceReading,
     DelegationRecord,
     OnChainReceipt,
     CreateGovernanceProposalParams,
     GovernanceVoteParams,
     GovernanceProposal,
     UnsignedTransaction,
} from './adapter.js'
import { SorobanConfig } from './client.js'
import { RawReceiptEvent } from '../indexer/event-parser.js'
import { logger } from '../utils/logger.js'

/**
 * Governance constants mirrored from contracts/governance/src/lib.rs:8-14 so
 * the stub's create → vote → finalize → execute transitions line up with the
 * on-chain ones. This is a test double, not a reimplementation of the contract.
 */
const MIN_STAKE_TO_PROPOSE = 1n
const VOTING_PERIOD_SECS = 7 * 24 * 3600
const TIMELOCK_SECS = 48 * 3600
const QUORUM_BPS = 1_000n

/** Stub-only view of the on-chain state a proposal accumulates. */
interface StubGovernanceProposal extends GovernanceProposal {
     /** Addresses that have already voted, mirroring DataKey::Voted. */
     voters: Set<string>
}

export class StubSorobanAdapter implements SorobanAdapter {
     private static stubBalances = new Map<string, bigint>()
     private static stubBonds = new Map<string, bigint>()
     private static stubReputations = new Map<string, TenantReputationRecord>()
     private static stubProposals = new Map<number, StubGovernanceProposal>()
     private static stubProposalCount = 0
     /**
      * Stub stand-in for the contract's admin-mirrored DataKey::TotalStaked,
      * snapshotted into each proposal at creation time for quorum purposes.
      */
     private static stubTotalStaked = 1_000n
     private config: SorobanConfig

     constructor(config: SorobanConfig) {
          this.config = config
          logger.info('Soroban adapter: stub')
          logger.debug('Soroban stub config', { rpcUrl: config.rpcUrl })
          if (config.contractId) {
               logger.debug('Soroban stub config', { contractId: config.contractId })
          }
     }

     /**
      * Resets all stub state including balances for all instances.
      */
     public static _testOnlyReset(): void {
          this.stubBalances.clear()
          this.stubBonds.clear()
          this.stubReputations.clear()
          this.stubDelegationStakes.clear()
          this.stubDelegations.clear()
          this.stubPendingUndelegations.clear()
          this.stubDelegateeCommissionBps.clear()
          this.stubProposals.clear()
          this.stubProposalCount = 0
          this.clockOffsetSecs = 0
          logger.debug('Soroban stub: static reset complete (balances, bonds, reputations, delegations, and proposals cleared)')
     }

     /**
      * Resets instance-specific state and global stub balances.
      */
     public _testOnlyReset(): void {
          this._ledger = 1000
          StubSorobanAdapter._testOnlyReset()
          logger.debug('Soroban stub: instance reset complete')
     }

     async getBalance(account: string): Promise<bigint> {
          if (!StubSorobanAdapter.stubBalances.has(account)) {
               const hash = this.simpleHash(account)
               const balance = BigInt(1000 + (hash % 9000))
               StubSorobanAdapter.stubBalances.set(account, balance)
          }
          const balance = StubSorobanAdapter.stubBalances.get(account)!
          logger.debug('Soroban stub: getBalance', { account, balance: balance.toString() })
          return balance
     }

     async credit(account: string, amount: bigint): Promise<void> {
          const currentBalance = await this.getBalance(account)
          const newBalance = currentBalance + amount
          StubSorobanAdapter.stubBalances.set(account, newBalance)
          logger.debug('Soroban stub: credit', {
               account,
               amount: amount.toString(),
               newBalance: newBalance.toString(),
          })
     }

     async debit(account: string, amount: bigint): Promise<void> {
          const currentBalance = await this.getBalance(account)
          if (currentBalance < amount) {
               throw new Error(`Insufficient balance: ${currentBalance.toString()} < ${amount.toString()}`)
          }
          const newBalance = currentBalance - amount
          StubSorobanAdapter.stubBalances.set(account, newBalance)
          logger.debug('Soroban stub: debit', {
               account,
               amount: amount.toString(),
               newBalance: newBalance.toString(),
          })
     }

     async getStakedBalance(account: string): Promise<bigint> {
          const hash = this.simpleHash(`staked:${this.config.contractId ?? 'stub'}:${account}`)
          const staked = BigInt(hash % 5_000) * 1_000_000n
          logger.debug('Soroban stub: getStakedBalance', { account, staked: staked.toString() })
          return staked
     }

     async getClaimableRewards(account: string): Promise<bigint> {
          const hash = this.simpleHash(`claimable:${this.config.contractId ?? 'stub'}:${account}`)
          const claimable = BigInt(hash % 250) * 1_000_000n
          logger.debug('Soroban stub: getClaimableRewards', { account, claimable: claimable.toString() })
          return claimable
     }

     async usedStake(account: string): Promise<bigint> {
          const staked = await this.getMvpStakedBalance(account)
          const hash = this.simpleHash(`used:${this.config.mvpStakingPoolId ?? 'stub'}:${account}`)
          return BigInt(hash % (Number(staked / 1_000_000n) + 1)) * 1_000_000n
     }

     async unusedStake(account: string): Promise<bigint> {
          const staked = await this.getMvpStakedBalance(account)
          const used = await this.usedStake(account)
          return staked - used
     }

     async claimable(account: string): Promise<bigint> {
          return this.getMvpClaimable(account)
     }

     async stake(account: string, amount: bigint): Promise<string> {
          logger.info('Soroban stub: mvp stake', { account, amount: amount.toString() })
          return 'stub_tx_hash_mvp_stake'
     }

     async unstake(account: string, amount: bigint): Promise<string> {
          logger.info('Soroban stub: mvp unstake', { account, amount: amount.toString() })
          return 'stub_tx_hash_mvp_unstake'
     }

     async utilizeStake(user: string, amount: bigint): Promise<string> {
          logger.info('Soroban stub: mvp utilizeStake', { user, amount: amount.toString() })
          return 'stub_tx_hash_mvp_utilize_stake'
     }

     async claim(account: string): Promise<string> {
          logger.info('Soroban stub: mvp claim', { account })
          return 'stub_tx_hash_mvp_claim'
     }

     private async getMvpStakedBalance(account: string): Promise<bigint> {
          const hash = this.simpleHash(`mvp-staked:${this.config.mvpStakingPoolId ?? 'stub'}:${account}`)
          return BigInt(hash % 5_000) * 1_000_000n
     }

     private async getMvpClaimable(account: string): Promise<bigint> {
          const hash = this.simpleHash(`mvp-claimable:${this.config.mvpStakingPoolId ?? 'stub'}:${account}`)
          return BigInt(hash % 250) * 1_000_000n
     }

     // ── stake_delegation (#1489) ─────────────────────────────────────────
     // In-memory delegation ledger so local dev and route tests exercise the
     // real delegate → request → complete flow (including the cooldown gate)
     // without a chain. Kept deliberately separate from the staking_pool stub
     // state above, mirroring the contract's own separate stake ledger.

     private static stubDelegationStakes = new Map<string, bigint>()
     private static stubDelegations = new Map<string, DelegationRecord[]>()
     private static stubPendingUndelegations = new Map<string, { amount: bigint; requestedAtMs: number }>()
     private static stubDelegateeCommissionBps = new Map<string, number>()
     private static stubEpoch = 1

     /** Cooldown the stub enforces, mirroring the contract's 7-day default. */
     public static readonly STUB_UNDELEGATION_COOLDOWN_MS = 604_800_000

     private delegationStakeOf(account: string): bigint {
          const existing = StubSorobanAdapter.stubDelegationStakes.get(account)
          if (existing !== undefined) return existing
          const hash = this.simpleHash(`delegation-staked:${this.config.stakeDelegationId ?? 'stub'}:${account}`)
          const seeded = BigInt(hash % 5_000) * 1_000_000n
          StubSorobanAdapter.stubDelegationStakes.set(account, seeded)
          return seeded
     }

     private totalDelegated(delegator: string): bigint {
          const rows = StubSorobanAdapter.stubDelegations.get(delegator) ?? []
          return rows.reduce((sum, row) => sum + row.amount, 0n)
     }

     async delegateStake(delegator: string, delegatee: string, amount: bigint): Promise<string> {
          if (amount <= 0n) throw new Error('InvalidAmount: delegation amount must be positive')
          const free = this.delegationStakeOf(delegator) - this.totalDelegated(delegator)
          if (free < amount) {
               throw new Error(`InsufficientStake: ${free.toString()} free < ${amount.toString()} requested`)
          }
          const rows = [...(StubSorobanAdapter.stubDelegations.get(delegator) ?? [])]
          const existing = rows.findIndex((row) => row.delegatee === delegatee)
          if (existing >= 0) {
               rows[existing] = { ...rows[existing], amount: rows[existing].amount + amount }
          } else {
               rows.push({ delegatee, amount, activatedEpoch: StubSorobanAdapter.stubEpoch })
          }
          StubSorobanAdapter.stubDelegations.set(delegator, rows)
          logger.info('Soroban stub: delegate', { delegator, delegatee, amount: amount.toString() })
          return 'stub_tx_hash_delegate'
     }

     async requestUndelegate(delegator: string, delegatee: string, amount: bigint): Promise<string> {
          if (amount <= 0n) throw new Error('InvalidAmount: undelegation amount must be positive')
          const rows = StubSorobanAdapter.stubDelegations.get(delegator) ?? []
          const row = rows.find((r) => r.delegatee === delegatee)
          if (!row) throw new Error(`DelegationNotFound: ${delegator} has no delegation to ${delegatee}`)
          if (row.amount < amount) {
               throw new Error(`InsufficientStake: delegated ${row.amount.toString()} < ${amount.toString()}`)
          }
          StubSorobanAdapter.stubPendingUndelegations.set(`${delegator}:${delegatee}`, {
               amount,
               requestedAtMs: Date.now(),
          })
          logger.info('Soroban stub: requestUndelegate', { delegator, delegatee, amount: amount.toString() })
          return 'stub_tx_hash_request_undelegate'
     }

     async completeUndelegate(delegator: string, delegatee: string): Promise<string> {
          const key = `${delegator}:${delegatee}`
          const pending = StubSorobanAdapter.stubPendingUndelegations.get(key)
          if (!pending) throw new Error(`NoPendingUndelegation: nothing pending for ${key}`)
          if (Date.now() - pending.requestedAtMs < StubSorobanAdapter.STUB_UNDELEGATION_COOLDOWN_MS) {
               throw new Error('CooldownNotElapsed: undelegation cooldown has not elapsed')
          }
          const rows = (StubSorobanAdapter.stubDelegations.get(delegator) ?? [])
               .map((row) =>
                    row.delegatee === delegatee ? { ...row, amount: row.amount - pending.amount } : row,
               )
               .filter((row) => row.amount > 0n)
          StubSorobanAdapter.stubDelegations.set(delegator, rows)
          StubSorobanAdapter.stubPendingUndelegations.delete(key)
          logger.info('Soroban stub: completeUndelegate', { delegator, delegatee })
          return 'stub_tx_hash_complete_undelegate'
     }

     /**
      * Back-dates every pending undelegation past the cooldown, standing in for
      * the ledger-timestamp advance the contract's own tests use.
      */
     public static _testOnlyElapseUndelegationCooldown(): void {
          for (const [key, pending] of this.stubPendingUndelegations) {
               this.stubPendingUndelegations.set(key, {
                    ...pending,
                    requestedAtMs: pending.requestedAtMs - this.STUB_UNDELEGATION_COOLDOWN_MS - 1_000,
               })
          }
     }

     async claimDelegateeRewards(delegatee: string): Promise<string> {
          logger.info('Soroban stub: claimDelegateeRewards', { delegatee })
          return 'stub_tx_hash_claim_delegatee_rewards'
     }

     async setDelegateeCommission(delegatee: string, rateBps: number): Promise<string> {
          if (rateBps > 10_000) throw new Error('CommissionTooHigh: rate must be <= 10000 bps')
          StubSorobanAdapter.stubDelegateeCommissionBps.set(delegatee, rateBps)
          logger.info('Soroban stub: setDelegateeCommission', { delegatee, rateBps })
          return 'stub_tx_hash_set_commission'
     }

     async claimDelegateeCommission(delegatee: string): Promise<string> {
          logger.info('Soroban stub: claimDelegateeCommission', { delegatee })
          return 'stub_tx_hash_claim_commission'
     }

     async getDelegations(delegator: string): Promise<DelegationRecord[]> {
          return [...(StubSorobanAdapter.stubDelegations.get(delegator) ?? [])]
     }

     async getDelegationStakedBalance(account: string): Promise<bigint> {
          return this.delegationStakeOf(account)
     }

     async getDelegationEpoch(): Promise<number> {
          return StubSorobanAdapter.stubEpoch
     }

     /** Gross rewards accrued to a delegatee before the commission split. */
     private grossDelegateeRewards(delegatee: string): bigint {
          const hash = this.simpleHash(`delegatee-gross:${this.config.stakeDelegationId ?? 'stub'}:${delegatee}`)
          return BigInt(hash % 250) * 1_000_000n
     }

     async getDelegateeClaimable(delegatee: string): Promise<bigint> {
          const gross = this.grossDelegateeRewards(delegatee)
          return gross - (await this.getDelegateeCommissionClaimable(delegatee))
     }

     async getDelegateeCommissionClaimable(delegatee: string): Promise<bigint> {
          const rateBps = BigInt(StubSorobanAdapter.stubDelegateeCommissionBps.get(delegatee) ?? 0)
          return (this.grossDelegateeRewards(delegatee) * rateBps) / 10_000n
     }

     /**
      * Stub recordReceipt: logs the call but performs no on-chain work.
      *
      * The real on-chain `record_receipt` invocation lives in
      * `RealSorobanAdapter.recordReceipt` (real-adapter.ts), which is selected
      * when SOROBAN_ADAPTER_MODE=real (see `createSorobanAdapter` in index.ts).
      *
      * This stub is intentionally inert so local development and unit tests
      * never make network calls or require admin signing keys.
      */
     async recordReceipt(params: RecordReceiptParams): Promise<void> {
          logger.info('Soroban stub: recordReceipt', {
               txId: params.txId,
               txType: params.txType,
               amountUsdc: params.amountUsdc,
               dealId: params.dealId,
          })
     }

     getConfig(): SorobanConfig {
          return { ...this.config }
     }

     private simpleHash(str: string): number {
          let hash = 0
          if (this.config.seed !== undefined) {
               const seedStr = typeof this.config.seed === 'number' ? this.config.seed.toString() : this.config.seed
               for (let i = 0; i < seedStr.length; i++) {
                    const char = seedStr.charCodeAt(i)
                    hash = ((hash << 5) - hash) + char
                    hash = hash & hash
               }
          }
          for (let i = 0; i < str.length; i++) {
               const char = str.charCodeAt(i)
               hash = ((hash << 5) - hash) + char
               hash = hash & hash
          }
          return Math.abs(hash)
     }

     private _ledger = 1000
     async getReceiptEvents(fromLedger: number | null): Promise<RawReceiptEvent[]> {
          const ledger = (fromLedger ?? this._ledger) + 1
          this._ledger = ledger
          return [{
               ledger, txHash: `stub_${ledger}`, contractId: this.config.contractId ?? 'stub',
               data: {
                    tx_id: `txid_${ledger}`, tx_type: 'PAYMENT', deal_id: `deal_${ledger % 5}`,
                    amount_usdc: '10000000', external_ref: `txid_${ledger}` // Contract stores as 'external_ref' (same as tx_id)
               }
          }]
     }

     async getTimelockEvents(fromLedger: number | null): Promise<any[]> {
          const ledger = (fromLedger ?? this._ledger) + 1
          this._ledger = ledger
          // Only emit an event occasionally to simulate a realistic queue
          if (ledger % 10 !== 0) return []
          
          return [{
               ledger, 
               txHash: `tx_${ledger}`, 
               contractId: this.config.contractId ?? 'stub_timelock',
               topic: ['governance', 'queued'],
               data: [
                    `hash_${ledger}`, // tx_hash_n
                    'StakingPool',
                    'pause',
                    [],
                    Math.floor(Date.now() / 1000) + 3600 // eta
               ]
          }]
     }

     async executeTimelock(txHash: string, target: string, functionName: string, args: any[], eta: number): Promise<string> {
    logger.info('Soroban stub: executeTimelock', { txHash, target, functionName, args, eta })
    return `stub_stellar_tx_hash_execute_${txHash}`
  }

  async cancelTimelock(txHash: string): Promise<string> {
    logger.info('Soroban stub: cancelTimelock', { txHash })
    return `stub_stellar_tx_hash_cancel_${txHash}`
  }

  async stakeBond(inspectorId: string, amount: bigint): Promise<void> {
       StubSorobanAdapter.stubBonds.set(inspectorId, amount)
       logger.debug('Soroban stub: stakeBond', { inspectorId, amount: amount.toString() })
  }

  async unstakeBond(inspectorId: string): Promise<void> {
       StubSorobanAdapter.stubBonds.delete(inspectorId)
       logger.debug('Soroban stub: unstakeBond', { inspectorId })
  }

  async isBonded(inspectorId: string): Promise<boolean> {
       const bonded = StubSorobanAdapter.stubBonds.has(inspectorId)
       logger.debug('Soroban stub: isBonded', { inspectorId, bonded })
       return bonded
  }

  async getBond(inspectorId: string): Promise<{ isBonded: boolean; amount: bigint }> {
       const amount = StubSorobanAdapter.stubBonds.get(inspectorId) ?? 0n
       const bonded = StubSorobanAdapter.stubBonds.has(inspectorId)
       logger.debug('Soroban stub: getBond', { inspectorId, bonded, amount: amount.toString() })
       return { isBonded: bonded, amount }
  }

  // Admin operations (stub implementations)
     async pause(contractId: string): Promise<string> {
          logger.info('Soroban stub: pause', { contractId })
          return 'stub_tx_hash_pause'
     }

     async unpause(contractId: string): Promise<string> {
          logger.info('Soroban stub: unpause', { contractId })
          return 'stub_tx_hash_unpause'
     }

     async setOperator(contractId: string, operatorAddress: string | null): Promise<string> {
          logger.info('Soroban stub: setOperator', { contractId, operatorAddress })
          return 'stub_tx_hash_set_operator'
     }

     async init(contractId: string, adminAddress: string, operatorAddress?: string): Promise<string> {
          logger.info('Soroban stub: init', { contractId, adminAddress, operatorAddress })
          return 'stub_tx_hash_init'
     }

     async syncDealStatus(params: SyncDealStatusParams): Promise<void> {
          logger.info('Soroban stub: syncDealStatus', { ...params })
     }

async requestRentRelease(params: RequestRentReleaseParams): Promise<void> {
          logger.info('Soroban stub: requestRentRelease', { ...params })
     }

     async challengeRentRelease(params: ChallengeRentReleaseParams): Promise<void> {
          logger.info('Soroban stub: challengeRentRelease', { ...params })
     }

     async resolveRentDispute(params: ResolveRentDisputeParams): Promise<void> {
          logger.info('Soroban stub: resolveRentDispute', { ...params })
     }

     async settleRentReleaseTimeout(params: SettleRentReleaseTimeoutParams): Promise<void> {
          logger.info('Soroban stub: settleRentReleaseTimeout', { ...params })
     }

     async settleDisputeTimeout(params: SettleDisputeTimeoutParams): Promise<void> {
          logger.info('Soroban stub: settleDisputeTimeout', { ...params })
     }

     async registerRentToOwnDeal(params: RegisterRentToOwnDealParams): Promise<void> {
          logger.info('Soroban stub: registerRentToOwnDeal', { ...params })
     }

     async recordRentToOwnEquityPayment(params: RecordRentToOwnEquityPaymentParams): Promise<void> {
          logger.info('Soroban stub: recordRentToOwnEquityPayment', { ...params })
     }

     async completeRentToOwnDeal(params: RentToOwnDealActionParams): Promise<void> {
          logger.info('Soroban stub: completeRentToOwnDeal', { ...params })
     }

     async defaultRentToOwnDeal(params: RentToOwnDealActionParams): Promise<void> {
          logger.info('Soroban stub: defaultRentToOwnDeal', { ...params })
     }

     async updateTenantReputation(tenantId: string, record: TenantReputationRecord): Promise<void> {
          const updated: TenantReputationRecord = {
               ...record,
               lastUpdated: BigInt(Math.floor(Date.now() / 1000)),
          }
          StubSorobanAdapter.stubReputations.set(tenantId, updated)
          logger.info('Soroban stub: updateTenantReputation', { tenantId, compositeScore: record.compositeScore })
     }

     async getTenantReputation(tenantId: string): Promise<TenantReputationRecord | null> {
          const record = StubSorobanAdapter.stubReputations.get(tenantId) ?? null
          logger.debug('Soroban stub: getTenantReputation', { tenantId, found: record !== null })
          return record
     }

     /**
      * Deterministic stub price: matches the default FX_RATE_NGN_PER_USDC
      * (1600) scaled to the contract's 7-decimal precision, always fresh.
      */
     async getOraclePrice(pair: string): Promise<OraclePriceReading> {
          const decimals = 7
          const price = 1600n * 10n ** BigInt(decimals)
          logger.debug('Soroban stub: getOraclePrice', { pair, price: price.toString() })
          return { price, decimals, updatedAt: Math.floor(Date.now() / 1000), sequence: 1 }
     }

     async isOraclePriceStale(pair: string): Promise<boolean> {
          logger.debug('Soroban stub: isOraclePriceStale', { pair })
          return false
     }

     // Direct query methods for transaction-receipt-contract (stub implementations)
     async getReceiptById(txId: string): Promise<OnChainReceipt | null> {
          logger.debug('Soroban stub: getReceiptById', { txId })
          // Return null for non-existent receipts in stub mode
          return null
     }

     async listReceiptsByDeal(dealId: string, limit: number, cursor?: number): Promise<OnChainReceipt[]> {
          logger.debug('Soroban stub: listReceiptsByDeal', { dealId, limit, cursor })
          // Return empty array in stub mode
          return []
     }

     async listReceiptsByUser(userAddress: string, limit: number, cursor?: number): Promise<OnChainReceipt[]> {
          logger.debug('Soroban stub: listReceiptsByUser', { userAddress, limit, cursor })
          // Return empty array in stub mode
          return []
     }

     // Allowlist registry methods (stub implementations)
     async addToAllowlist(address: string, label: string, expiresAt?: number): Promise<string> {
          logger.debug('Soroban stub: addToAllowlist', { address, label, expiresAt })
          // Return stub transaction hash
          return `stub_allowlist_add_${address}`
     }

     async removeFromAllowlist(address: string): Promise<string> {
          logger.debug('Soroban stub: removeFromAllowlist', { address })
          // Return stub transaction hash
          return `stub_allowlist_remove_${address}`
     }

     async isAllowlisted(address: string): Promise<boolean> {
          logger.debug('Soroban stub: isAllowlisted', { address })
          // Return false in stub mode (no actual allowlist)
          return false
     }

     async getAllowlistEntry(address: string): Promise<import('./adapter.js').AllowlistEntry | null> {
          logger.debug('Soroban stub: getAllowlistEntry', { address })
          // Return null in stub mode
          return null
     }

     // epoch_rewards contract methods (stub implementations)
     async epochStake(user: string, amount: bigint): Promise<string> {
          logger.debug('Soroban stub: epochStake', { user, amount: amount.toString() })
          return `stub_epoch_stake_${user}_${amount}`
     }

     async epochUnstake(user: string, amount: bigint): Promise<string> {
          logger.debug('Soroban stub: epochUnstake', { user, amount: amount.toString() })
          return `stub_epoch_unstake_${user}_${amount}`
     }

     async epochClaim(user: string): Promise<bigint> {
          logger.debug('Soroban stub: epochClaim', { user })
          return BigInt(0)
     }

     async epochGetClaimable(user: string): Promise<bigint> {
          logger.debug('Soroban stub: epochGetClaimable', { user })
          return BigInt(0)
     }

     async epochGetEpoch(epochNumber: number): Promise<import('./adapter.js').EpochInfo | null> {
          logger.debug('Soroban stub: epochGetEpoch', { epochNumber })
          return null
     }

     async epochGetCurrentEpoch(): Promise<number> {
          logger.debug('Soroban stub: epochGetCurrentEpoch')
          return 1
     }

     async epochGetTotalStaked(): Promise<bigint> {
          logger.debug('Soroban stub: epochGetTotalStaked')
          return BigInt(0)
     }

     async epochFundRewards(caller: string, amount: bigint): Promise<string> {
          logger.debug('Soroban stub: epochFundRewards', { caller, amount: amount.toString() })
          return `stub_epoch_fund_${caller}_${amount}`
     }

     async epochSeal(caller: string, targetEpoch: number, nextEpochDurationSecs: number): Promise<string> {
          logger.debug('Soroban stub: epochSeal', { caller, targetEpoch, nextEpochDurationSecs })
          return `stub_epoch_seal_${targetEpoch}`
     }

     // rent_wallet contract methods (stub implementations)
     async rentWalletCredit(account: string, amount: bigint): Promise<string> {
          logger.debug('Soroban stub: rentWalletCredit', { account, amount: amount.toString() })
          return `stub_rent_wallet_credit_${account}_${amount}`
     }

     async rentWalletDebit(account: string, amount: bigint): Promise<string> {
          logger.debug('Soroban stub: rentWalletDebit', { account, amount: amount.toString() })
          return `stub_rent_wallet_debit_${account}_${amount}`
     }

     async rentWalletBalance(account: string): Promise<bigint> {
          logger.debug('Soroban stub: rentWalletBalance', { account })
          return BigInt(0)
     }

     // slashing_module contract methods (stub implementations)
     async submitEvidence(submitter: string, commitment: string, actor: string, offence: string): Promise<number> {
          logger.debug('Soroban stub: submitEvidence', { submitter, actor, offence })
          return 1 // Return stub slash ID
     }

     async revealEvidence(submitter: string, slashId: number, evidence: string, salt: string): Promise<void> {
          logger.debug('Soroban stub: revealEvidence', { submitter, slashId })
     }

     async proposeSlash(submitter: string, actor: string, penaltyBps: number): Promise<number> {
          logger.debug('Soroban stub: proposeSlash', { submitter, actor, penaltyBps })
          return 1 // Return stub slash ID
     }

     async finalizeSlash(caller: string, slashId: number): Promise<void> {
          logger.debug('Soroban stub: finalizeSlash', { caller, slashId })
     }

     async cancelSlash(admin: string, slashId: number): Promise<void> {
          logger.debug('Soroban stub: cancelSlash', { admin, slashId })
     }

     // bond_collateral contract methods (stub implementations)
     async depositBond(inspector: string, amount: bigint): Promise<void> {
          logger.debug('Soroban stub: depositBond', { inspector, amount: amount.toString() })
     }

     async withdrawBond(inspector: string, amount: bigint): Promise<void> {
          logger.debug('Soroban stub: withdrawBond', { inspector, amount: amount.toString() })
     }

     async getBondBalance(inspector: string): Promise<bigint> {
          logger.debug('Soroban stub: getBondBalance', { inspector })
          return BigInt(0)
     }

     // ── governance contract (issue #1494) ─────────────────────────────────────
     //
     // The real flow is prepare (unsigned XDR) → wallet signs → submit. The stub
     // has no network and no wallet, so `xdr` here is a base64 JSON intent that
     // `submitGovernanceTransaction` decodes and applies. Signing is a no-op, so
     // tests can post the prepared string straight back to submit.

     /** Test-only clock offset (seconds) so tests can cross voting/timelock boundaries. */
     private static clockOffsetSecs = 0

     public static _testOnlyAdvanceTime(seconds: number): void {
          this.clockOffsetSecs += seconds
     }

     private static now(): number {
          return Math.floor(Date.now() / 1000) + this.clockOffsetSecs
     }

     private static encodeIntent(intent: Record<string, unknown>): string {
          return Buffer.from(JSON.stringify(intent), 'utf8').toString('base64')
     }

     async createProposal(params: CreateGovernanceProposalParams): Promise<UnsignedTransaction> {
          logger.debug('Soroban stub: createProposal (prepare)', {
               proposer: params.proposer,
               paramKey: params.paramKey,
          })
          return {
               xdr: StubSorobanAdapter.encodeIntent({
                    kind: 'create_proposal',
                    proposer: params.proposer,
                    paramKey: params.paramKey,
                    currentValue: params.currentValue.toString(),
                    proposedValue: params.proposedValue.toString(),
               }),
          }
     }

     async vote(params: GovernanceVoteParams): Promise<UnsignedTransaction> {
          logger.debug('Soroban stub: vote (prepare)', {
               voter: params.voter,
               proposalId: params.proposalId,
               support: params.support,
          })
          return {
               xdr: StubSorobanAdapter.encodeIntent({
                    kind: 'vote',
                    voter: params.voter,
                    proposalId: params.proposalId,
                    support: params.support,
               }),
          }
     }

     async submitGovernanceTransaction(signedXdr: string): Promise<{ txHash: string }> {
          let intent: any
          try {
               intent = JSON.parse(Buffer.from(signedXdr, 'base64').toString('utf8'))
          } catch {
               throw new Error('Signed transaction envelope could not be parsed')
          }

          if (intent?.kind === 'create_proposal') {
               const stake = await this.getStakedBalance(intent.proposer)
               if (stake < MIN_STAKE_TO_PROPOSE) {
                    throw new Error('InsufficientStake: proposer stake is below MIN_STAKE_TO_PROPOSE')
               }
               const id = ++StubSorobanAdapter.stubProposalCount
               const now = StubSorobanAdapter.now()
               StubSorobanAdapter.stubProposals.set(id, {
                    id,
                    proposer: intent.proposer,
                    paramKey: intent.paramKey,
                    currentValue: String(intent.currentValue),
                    proposedValue: String(intent.proposedValue),
                    votesFor: '0',
                    votesAgainst: '0',
                    status: 'Active',
                    createdAt: now,
                    votingEndsAt: now + VOTING_PERIOD_SECS,
                    snapshottedTotalStaked: StubSorobanAdapter.stubTotalStaked.toString(),
                    voters: new Set<string>(),
               })
               logger.debug('Soroban stub: createProposal (submitted)', { proposalId: id })
               return { txHash: `stub_tx_create_proposal_${id}` }
          }

          if (intent?.kind === 'vote') {
               const proposal = StubSorobanAdapter.stubProposals.get(Number(intent.proposalId))
               if (!proposal) throw new Error('ProposalNotFound')
               if (proposal.status !== 'Active') throw new Error('ProposalNotActive')
               if (StubSorobanAdapter.now() > proposal.votingEndsAt) {
                    throw new Error('VotingNotEnded: the voting period has already closed')
               }
               if (proposal.voters.has(intent.voter)) throw new Error('AlreadyVoted')

               // Weight = the voter's stake, snapshotted on their first vote —
               // matching contracts/governance/src/lib.rs:250-256.
               const weight = await this.getStakedBalance(intent.voter)
               proposal.voters.add(intent.voter)
               if (intent.support) {
                    proposal.votesFor = (BigInt(proposal.votesFor) + weight).toString()
               } else {
                    proposal.votesAgainst = (BigInt(proposal.votesAgainst) + weight).toString()
               }
               logger.debug('Soroban stub: vote (submitted)', {
                    proposalId: proposal.id,
                    support: intent.support,
                    weight: weight.toString(),
               })
               return { txHash: `stub_tx_vote_${proposal.id}` }
          }

          throw new Error(`Unsupported governance intent: ${String(intent?.kind)}`)
     }

     async finalizeProposal(proposalId: number): Promise<string> {
          const proposal = StubSorobanAdapter.stubProposals.get(proposalId)
          if (!proposal) throw new Error('ProposalNotFound')
          if (proposal.status !== 'Active') throw new Error('ProposalNotActive')
          if (StubSorobanAdapter.now() <= proposal.votingEndsAt) {
               throw new Error('VotingNotEnded: the voting period has not ended yet')
          }

          const totalVotes = BigInt(proposal.votesFor) + BigInt(proposal.votesAgainst)
          const quorumRequired =
               (BigInt(proposal.snapshottedTotalStaked) * QUORUM_BPS) / 10_000n
          proposal.status =
               totalVotes < quorumRequired
                    ? 'Rejected'
                    : BigInt(proposal.votesFor) > BigInt(proposal.votesAgainst)
                      ? 'Passed'
                      : 'Rejected'

          logger.debug('Soroban stub: finalizeProposal', {
               proposalId,
               status: proposal.status,
          })
          return `stub_tx_finalize_proposal_${proposalId}`
     }

     async executeProposal(proposalId: number): Promise<string> {
          const proposal = StubSorobanAdapter.stubProposals.get(proposalId)
          if (!proposal) throw new Error('ProposalNotFound')
          if (proposal.status === 'Executed') throw new Error('ProposalAlreadyExecuted')
          if (proposal.status !== 'Passed') throw new Error('ProposalNotPassed')
          if (StubSorobanAdapter.now() < proposal.votingEndsAt + TIMELOCK_SECS) {
               throw new Error('TimelockNotElapsed: the execution timelock has not elapsed yet')
          }
          proposal.status = 'Executed'
          logger.debug('Soroban stub: executeProposal', { proposalId })
          return `stub_tx_execute_proposal_${proposalId}`
     }

     async getProposal(proposalId: number): Promise<GovernanceProposal | null> {
          const proposal = StubSorobanAdapter.stubProposals.get(proposalId)
          if (!proposal) return null
          const { voters: _voters, ...view } = proposal
          return { ...view }
     }

     async getProposalCount(): Promise<number> {
          return StubSorobanAdapter.stubProposalCount
     }

     // ── vesting_schedule contract ─────────────────────────────────────────────
     
     async createVestingSchedule(
          beneficiary: string,
          totalAmount: bigint,
          startTime: number,
          endTime: number,
          cliffTime: number,
          revocable: boolean
     ): Promise<string> {
          logger.info('Soroban stub: createVestingSchedule', {
               beneficiary,
               totalAmount: totalAmount.toString(),
               startTime,
               endTime,
               cliffTime,
               revocable,
          })
          return 'stub_tx_hash_create_vesting_schedule'
     }

     async claimVested(beneficiary: string): Promise<bigint> {
          logger.info('Soroban stub: claimVested', { beneficiary })
          // Return a deterministic stub amount
          const hash = this.simpleHash(`claimable:${this.config.vestingScheduleId ?? 'stub'}:${beneficiary}`)
          return BigInt(hash % 100) * 1_000_000n
     }

     async revokeVesting(beneficiary: string): Promise<bigint> {
          logger.info('Soroban stub: revokeVesting', { beneficiary })
          // Return a deterministic stub amount for unclaimed
          const hash = this.simpleHash(`unclaimed:${this.config.vestingScheduleId ?? 'stub'}:${beneficiary}`)
          return BigInt(hash % 50) * 1_000_000n
     }

     async getClaimableVested(beneficiary: string): Promise<bigint> {
          logger.debug('Soroban stub: getClaimableVested', { beneficiary })
          // Return a deterministic stub amount
          const hash = this.simpleHash(`claimable:${this.config.vestingScheduleId ?? 'stub'}:${beneficiary}`)
          return BigInt(hash % 100) * 1_000_000n
     }

     // ── whistleblower_rewards contract ───────────────────────────────────────────
     
     async allocateReward(whistleblower: string, amount: bigint): Promise<string> {
          logger.info('Soroban stub: allocateReward', { whistleblower, amount: amount.toString() })
          return 'stub_tx_hash_allocate_reward'
     }

     async claimReward(whistleblower: string): Promise<bigint> {
          logger.info('Soroban stub: claimReward', { whistleblower })
          const hash = this.simpleHash(`claimable:${this.config.whistleblowerRewardsId ?? 'stub'}:${whistleblower}`)
          return BigInt(hash % 100) * 1_000_000n
     }

     async getClaimableReward(whistleblower: string): Promise<bigint> {
          logger.debug('Soroban stub: getClaimableReward', { whistleblower })
          const hash = this.simpleHash(`claimable:${this.config.whistleblowerRewardsId ?? 'stub'}:${whistleblower}`)
          return BigInt(hash % 100) * 1_000_000n
     }

     // ── rent_payments contract ──────────────────────────────────────────────────
     
     async createRentPaymentReceipt(
          dealId: string,
          amount: bigint,
          payer: string,
          recipient: string,
          timestamp: number
     ): Promise<string> {
          logger.info('Soroban stub: createRentPaymentReceipt', {
               dealId,
               amount: amount.toString(),
               payer,
               recipient,
               timestamp,
          })
          return 'stub_tx_hash_create_rent_payment_receipt'
     }

     async listRentPaymentReceiptsByDeal(dealId: string, limit: number): Promise<any[]> {
          logger.debug('Soroban stub: listRentPaymentReceiptsByDeal', { dealId, limit })
          return []
     }

     async rentPaymentReceiptCount(dealId: string): Promise<number> {
          logger.debug('Soroban stub: rentPaymentReceiptCount', { dealId })
          return 0
     }

     // ── deal_escrow circuit-breaker ─────────────────────────────────────────────
     
     async freeze(): Promise<string> {
          logger.info('Soroban stub: freeze')
          return 'stub_tx_hash_freeze'
     }

     async isFrozen(): Promise<boolean> {
          logger.debug('Soroban stub: isFrozen')
          return false
     }

     async proposeDrain(destination: string): Promise<string> {
          logger.info('Soroban stub: proposeDrain', { destination })
          return 'stub_tx_hash_propose_drain'
     }

     async executeDrain(): Promise<string> {
          logger.info('Soroban stub: executeDrain')
          return 'stub_tx_hash_execute_drain'
     }

     async setRecoveryDelay(delaySeconds: number): Promise<string> {
          logger.info('Soroban stub: setRecoveryDelay', { delaySeconds })
          return 'stub_tx_hash_set_recovery_delay'
     }

     async getCircuitBreakerState(): Promise<{ frozen: boolean; drainProposed: boolean; drainDestination?: string; recoveryDelay: number }> {
          logger.debug('Soroban stub: getCircuitBreakerState')
          return {
               frozen: false,
               drainProposed: false,
               drainDestination: undefined,
               recoveryDelay: 0,
          }
     }
}
