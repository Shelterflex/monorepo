import { SorobanConfig } from './client.js'
import { TxType } from '../outbox/types.js'

export interface RecordReceiptParams {
  txId: string           // BytesN<32> as hex string - deterministic idempotency key
  txType: TxType
  amountUsdc: string     // USDC amount (canonical); decimal string
  tokenAddress: string   // USDC token contract address
  dealId: string
  listingId?: string
  from?: string
  to?: string
  externalRefHash: string // SHA-256 of canonical external ref (privacy on-chain)
  amountNgn?: number
  fxRate?: number
  fxProvider?: string
  metadataHash?: string
}

export interface SorobanAdapter {
  getBalance(account: string): Promise<bigint>
  credit(account: string, amount: bigint): Promise<void>
  debit(account: string, amount: bigint): Promise<void>
  recordReceipt(params: RecordReceiptParams): Promise<void>
  getConfig(): SorobanConfig
}
