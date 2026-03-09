import { SorobanAdapter, RecordReceiptParams } from './adapter.js'
import { SorobanConfig } from './client.js'
import { RawReceiptEvent } from '../indexer/event-parser.js'

// In-memory store for stub balances
const stubBalances = new Map<string, bigint>()

export class StubSorobanAdapter implements SorobanAdapter {
     private config: SorobanConfig

     constructor(config: SorobanConfig) {
          this.config = config
          console.log('🔧 Using StubSorobanAdapter - no real Soroban calls will be made')
          console.log(`📝 Configured with RPC: ${config.rpcUrl}`)
          if (config.contractId) {
               console.log(`📝 Contract ID: ${config.contractId}`)
          }
     }

     async getBalance(account: string): Promise<bigint> {
          if (!stubBalances.has(account)) {
               const hash = this.simpleHash(account)
               const balance = BigInt(1000 + (hash % 9000))
               stubBalances.set(account, balance)
          }
          const balance = stubBalances.get(account)!
          console.log(`[Stub] getBalance(${account}) -> ${balance.toString()}`)
          return balance
     }

     async credit(account: string, amount: bigint): Promise<void> {
          const currentBalance = await this.getBalance(account)
          const newBalance = currentBalance + amount
          stubBalances.set(account, newBalance)
          console.log(`[Stub] credit(${account}, ${amount.toString()}) -> new balance: ${newBalance.toString()}`)
     }

     async debit(account: string, amount: bigint): Promise<void> {
          const currentBalance = await this.getBalance(account)
          if (currentBalance < amount) {
               throw new Error(`Insufficient balance: ${currentBalance.toString()} < ${amount.toString()}`)
          }
          const newBalance = currentBalance - amount
          stubBalances.set(account, newBalance)
          console.log(`[Stub] debit(${account}, ${amount.toString()}) -> new balance: ${newBalance.toString()}`)
     }

     async getStakedBalance(account: string): Promise<bigint> {
          const hash = this.simpleHash(`staked:${this.config.contractId ?? 'stub'}:${account}`)
          const staked = BigInt(hash % 5_000) * 1_000_000n
          console.log(`[Stub] getStakedBalance(${account}) -> ${staked.toString()}`)
          return staked
     }

     async getClaimableRewards(account: string): Promise<bigint> {
          const hash = this.simpleHash(`claimable:${this.config.contractId ?? 'stub'}:${account}`)
          const claimable = BigInt(hash % 250) * 1_000_000n
          console.log(`[Stub] getClaimableRewards(${account}) -> ${claimable.toString()}`)
          return claimable
     }

     async recordReceipt(params: RecordReceiptParams): Promise<void> {
          // Stub: log the receipt recording. In production, calls the Soroban contract.
          // TODO: Replace with: client.invoke('record_receipt', params)
          console.log(`[Stub] recordReceipt txId=${params.txId} txType=${params.txType} amountUsdc=${params.amountUsdc} dealId=${params.dealId}`)
     }

     getConfig(): SorobanConfig {
          return { ...this.config }
     }

     private simpleHash(str: string): number {
          let hash = 0
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
}
