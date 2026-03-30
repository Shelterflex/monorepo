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
}

export interface SorobanAdapter {
  getBalance(account: string): Promise<bigint>
  credit(account: string, amount: bigint): Promise<void>
  debit(account: string, amount: bigint): Promise<void>
  getStakedBalance(account: string): Promise<bigint>
  getClaimableRewards(account: string): Promise<bigint>
  recordReceipt(params: RecordReceiptParams): Promise<void>
  getConfig(): SorobanConfig
  getReceiptEvents(fromLedger: number | null): Promise<RawReceiptEvent[]>
  getTimelockEvents(fromLedger: number | null): Promise<any[]>
  executeTimelock(txHash: string, target: string, functionName: string, args: any[], eta: number): Promise<string>
  cancelTimelock(txHash: string): Promise<string>

  // Admin operations (require SOROBAN_ADMIN_SIGNING_ENABLED=true)
  pause?(contractId: string): Promise<string>
  unpause?(contractId: string): Promise<string>
  setOperator?(contractId: string, operatorAddress: string | null): Promise<string>
  init?(contractId: string, adminAddress: string, operatorAddress?: string): Promise<string>
}
