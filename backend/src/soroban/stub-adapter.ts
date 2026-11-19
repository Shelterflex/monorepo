import {
     SorobanAdapter,
     RecordReceiptParams,
     SyncDealStatusParams,
     RequestRentReleaseParams,
     ChallengeRentReleaseParams,
     ResolveRentDisputeParams,
     SettleRentReleaseTimeoutParams,
     SettleDisputeTimeoutParams,
     RegisterRentToOwnDealParams,
     RecordRentToOwnEquityPaymentParams,
     RentToOwnDealActionParams,
     OnChainReceipt,
     MultisigArg,
     MultisigCall,
     MultisigCallParams,
     MultisigConfig,
     MultisigProposal,
     MultisigProposalStatus,
} from './adapter.js'
import { SorobanConfig } from './client.js'
import { RawReceiptEvent } from '../indexer/event-parser.js'
import { logger } from '../utils/logger.js'
import { Account, Keypair, TransactionBuilder, nativeToScVal, Address, xdr } from '@stellar/stellar-sdk'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { assertSignedInvocation, buildInvokeOperation } from './userSignedTx.js'
import { encodeMultisigArg } from './multisigArgs.js'
import { StubMultisig } from './stub-multisig.js'

export class StubSorobanAdapter implements SorobanAdapter {
     private static stubBalances = new Map<string, bigint>()
     private static stubMultisig = new StubMultisig()
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
          this.stubMultisig = new StubMultisig()
          logger.debug('Soroban stub: static reset complete (balances cleared)')
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


     // multisig_admin contract (#1972), in memory.
     multisigTargetFor(contract: 'dealEscrow' | 'contractAccess'): string | undefined {
          return contract === 'dealEscrow' ? this.config.dealEscrowId : this.config.contractAccessId
     }

     multisigEnabled(): boolean {
          return !!this.config.multisigAdminId
     }

     multisigContractId(): string | undefined {
          return this.config.multisigAdminId
     }

     /** The stub's platform key: the configured admin secret's account, or a fixed test key. */
     private stubAdminAddress(): string {
          return this.config.adminSecret
               ? Keypair.fromSecret(this.config.adminSecret).publicKey()
               : Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)).publicKey()
     }

     /** Test helper: restarts the epoch_rewards stub with epochs of `durationSecs`. */
     public static _testOnlyConfigureEpochs(durationSecs: number): void {
     }

     /** Test helper: sets the multisig's signers and threshold. */
     public static _testOnlyConfigureMultisig(config: MultisigConfig): void {
          this.stubMultisig.configure(config)
     }

     /** Test helper: the calls proposals have executed so far. */
     public static _testOnlyExecutedMultisigCalls() {
          return [...this.stubMultisig.executedCalls]
     }

     async multisigGetConfig(): Promise<MultisigConfig> {
          this.requireMultisigId()
          return StubSorobanAdapter.stubMultisig.getConfig()
     }

     async multisigListProposals(status?: MultisigProposalStatus): Promise<MultisigProposal[]> {
          this.requireMultisigId()
          return StubSorobanAdapter.stubMultisig.list(status)
     }

     async multisigGetProposal(proposalId: number): Promise<MultisigProposal | null> {
          this.requireMultisigId()
          return StubSorobanAdapter.stubMultisig.get(proposalId)
     }

     async multisigPropose(
          target: string,
          functionName: string,
          args: MultisigArg[],
     ): Promise<{ txHash: string; proposalId?: number }> {
          this.requireMultisigId()
          const proposalId = StubSorobanAdapter.stubMultisig.propose(
               this.stubAdminAddress(),
               target,
               functionName,
               args,
          )
          return { txHash: `stub_tx_hash_multisig_propose_${proposalId}`, proposalId }
     }

     private multisigArgs(call: MultisigCall, params: MultisigCallParams): xdr.ScVal[] {
          const signer = nativeToScVal(new Address(params.signer))
          if (call === 'propose') {
               if (!params.target || !params.functionName) {
                    throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'propose needs a target and function')
               }
               return [
                    signer,
                    nativeToScVal(new Address(params.target)),
                    nativeToScVal(params.functionName, { type: 'symbol' }),
                    xdr.ScVal.scvVec((params.args ?? []).map(encodeMultisigArg)),
               ]
          }
          if (params.proposalId === undefined) {
               throw new AppError(ErrorCode.VALIDATION_ERROR, 400, `${call} needs a proposal id`)
          }
          return [signer, nativeToScVal(BigInt(params.proposalId), { type: 'u64' })]
     }

     async prepareMultisigCall(call: MultisigCall, params: MultisigCallParams): Promise<string> {
          const contractId = this.requireMultisigId()
          return this.buildUnsigned(contractId, params.signer, call, this.multisigArgs(call, params))
     }

     async submitMultisigCall(
          signedXdr: string,
          call: MultisigCall,
          params: MultisigCallParams,
     ): Promise<string> {
          const contractId = this.requireMultisigId()
          assertSignedInvocation(signedXdr, {
               contractId,
               functionName: call,
               args: this.multisigArgs(call, params),
               signer: params.signer,
               networkPassphrase: this.config.networkPassphrase,
               label: `multisig ${call}`,
          })
          const book = StubSorobanAdapter.stubMultisig
          let suffix = ''
          if (call === 'propose') {
               suffix = String(book.propose(params.signer, params.target!, params.functionName!, params.args ?? []))
          } else if (call === 'approve') {
               book.approve(params.signer, params.proposalId!)
               suffix = String(params.proposalId)
          } else if (call === 'revoke_approval') {
               book.revokeApproval(params.signer, params.proposalId!)
               suffix = String(params.proposalId)
          } else {
               book.execute(params.signer, params.proposalId!)
               suffix = String(params.proposalId)
          }
          return `stub_tx_hash_multisig_${call}_${suffix}`
     }

     private buildUnsigned(contractId: string, signer: string, fn: string, args: xdr.ScVal[]): string {
          return new TransactionBuilder(new Account(signer, '0'), {
               fee: '100',
               networkPassphrase: this.config.networkPassphrase,
          })
               .addOperation(buildInvokeOperation(contractId, fn, args))
               .setTimeout(300)
               .build()
               .toXDR()
     }

     private requireMultisigId(): string {
          if (!this.config.multisigAdminId) {
               throw new Error('MULTISIG_ADMIN_ID not configured')
          }
          return this.config.multisigAdminId
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
