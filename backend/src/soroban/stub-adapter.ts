import { SorobanAdapter, RecordReceiptParams } from './adapter.js'
import { SorobanConfig } from './client.js'
import { RawReceiptEvent } from '../indexer/event-parser.js'
import { logger } from '../utils/logger.js'


export class StubSorobanAdapter implements SorobanAdapter {
     private static stubBalances = new Map<string, bigint>()
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

     async recordReceipt(params: RecordReceiptParams): Promise<void> {
          // Stub: log the receipt recording. In production, calls the Soroban contract.
          // TODO: Replace with: client.invoke('record_receipt', params)
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
}
