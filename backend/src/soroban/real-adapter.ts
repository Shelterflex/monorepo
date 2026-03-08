import { 
  rpc, 
  Address, 
  xdr, 
  scValToNative, 
  nativeToScVal,
  TransactionBuilder,
  Account,
  Operation
} from '@stellar/stellar-sdk'
import { SorobanAdapter, RecordReceiptParams } from './adapter.js'
import { SorobanConfig } from './client.js'
import { RawReceiptEvent } from '../indexer/event-parser.js'
import { logger } from '../utils/logger.js'
import { TxType } from '../outbox/types.js'

export class RealSorobanAdapter implements SorobanAdapter {
  private server: rpc.Server

  constructor(private config: SorobanConfig) {
    this.server = new rpc.Server(config.rpcUrl)
  }

  async getBalance(account: string): Promise<bigint> {
    // Basic implementation for USDC balance if needed
    // In this context, we focus on staking
    return 0n
  }

  async credit(account: string, amount: bigint): Promise<void> {
    throw new Error('Credit not supported in RealSorobanAdapter')
  }

  async debit(account: string, amount: bigint): Promise<void> {
    throw new Error('Debit not supported in RealSorobanAdapter')
  }

  async getStakedBalance(account: string): Promise<bigint> {
    if (!this.config.stakingPoolId) {
      throw new Error('STAKING_POOL_ID not configured')
    }

    const result = await this.invokeReadOnly(
      this.config.stakingPoolId,
      'staked_balance',
      [nativeToScVal(new Address(account))]
    )
    return BigInt(scValToNative(result))
  }

  async getClaimableRewards(account: string): Promise<bigint> {
    if (!this.config.stakingRewardsId) {
      throw new Error('STAKING_REWARDS_ID not configured')
    }

    const result = await this.invokeReadOnly(
      this.config.stakingRewardsId,
      'get_claimable',
      [nativeToScVal(new Address(account))]
    )
    return BigInt(scValToNative(result))
  }

  async recordReceipt(params: RecordReceiptParams): Promise<void> {
    // This would involve building a transaction and sending it
    // For this task, we focus on reading positions
    logger.info('recordReceipt called on RealSorobanAdapter (not implemented for write yet)', params as any)
  }

  getConfig(): SorobanConfig {
    return { ...this.config }
  }

  async getReceiptEvents(fromLedger: number | null): Promise<RawReceiptEvent[]> {
    if (!this.config.contractId) {
      throw new Error('SOROBAN_CONTRACT_ID not configured')
    }

    const latest = await this.withBackoff(
      () => this.server.getLatestLedger(),
      { op: 'getLatestLedger' }
    )

    const startLedger = fromLedger == null ? latest.sequence : fromLedger + 1
    if (startLedger > latest.sequence) return []

    const topic0 = this.scValTopicBase64(xdr.ScVal.scvSymbol('transaction_receipt'))
    const topic1 = this.scValTopicBase64(xdr.ScVal.scvSymbol('receipt_recorded'))

    const limit = 200
    let cursor: string | undefined
    const out: RawReceiptEvent[] = []

    for (;;) {
      const params: any = cursor
        ? {
            cursor,
            limit,
            filters: [
              {
                type: 'contract',
                contractIds: [this.config.contractId],
                topics: [[topic0, topic1, '*']],
              },
            ],
          }
        : {
            startLedger,
            limit,
            filters: [
              {
                type: 'contract',
                contractIds: [this.config.contractId],
                topics: [[topic0, topic1, '*']],
              },
            ],
          }

      const res = await this.withBackoff(
        () => this.server.getEvents(params),
        { op: 'getEvents' }
      )

      const resAny = res as any

      const events = resAny?.events ?? []
      for (const ev of events) {
        const evAny = ev as any
        if (!evAny?.inSuccessfulContractCall) continue
        if (evAny.type !== 'contract') continue

        const contractId =
          typeof evAny.contractId === 'string'
            ? evAny.contractId
            : typeof evAny.contractId?.toString === 'function'
              ? evAny.contractId.toString()
              : undefined
        if (!contractId || contractId !== this.config.contractId) continue

        if (typeof evAny.value !== 'string') continue
        if (typeof evAny.txHash !== 'string') continue
        if (typeof evAny.ledger !== 'number') continue

        const receipt = this.decodeReceiptValue(evAny.value)
        if (!receipt) continue

        const normalized = this.normalizeReceipt(receipt)
        out.push({
          ledger: evAny.ledger,
          txHash: evAny.txHash,
          contractId,
          data: normalized,
        })
      }

      const nextCursor: string | undefined = resAny?.cursor
      if (!nextCursor || nextCursor === cursor) break
      cursor = nextCursor

      if (events.length < limit) break
    }

    return out
  }

  private scValTopicBase64(v: xdr.ScVal): string {
    return v.toXDR('base64')
  }

  private decodeReceiptValue(valueBase64: string): any | null {
    try {
      const scv = xdr.ScVal.fromXDR(valueBase64, 'base64')
      return scValToNative(scv)
    } catch (err) {
      logger.warn('Failed to decode receipt event value', { valueBase64 })
      return null
    }
  }

  private normalizeReceipt(receipt: any): Record<string, unknown> {
    const out: Record<string, unknown> = {}

    out.tx_id = this.bytesLikeToHex(receipt?.tx_id)
    out.external_ref = this.bytesLikeToHex(receipt?.external_ref) ?? (out.tx_id as string | undefined)

    out.tx_type = this.normalizeTxType(receipt?.tx_type)

    out.deal_id = typeof receipt?.deal_id === 'string' ? receipt.deal_id : ''
    if (typeof receipt?.listing_id === 'string') out.listing_id = receipt.listing_id

    out.amount_usdc = this.i128ToDecimalString(receipt?.amount_usdc)

    const amountNgn = this.i128ToNumber(receipt?.amount_ngn)
    if (amountNgn != null) out.amount_ngn = amountNgn

    const fxRate = this.i128ToNumber(receipt?.fx_rate_ngn_per_usdc)
    if (fxRate != null) out.fx_rate = fxRate

    if (typeof receipt?.fx_provider === 'string') out.fx_provider = receipt.fx_provider
    if (receipt?.from) out.from = String(receipt.from)
    if (receipt?.to) out.to = String(receipt.to)

    const metadataHash = this.bytesLikeToHex(receipt?.metadata_hash)
    if (metadataHash) out.metadata_hash = metadataHash

    return out
  }

  private bytesLikeToHex(v: unknown): string | undefined {
    if (!v) return undefined
    if (typeof v === 'string') {
      return v
    }
    try {
      if (v instanceof Uint8Array) return Buffer.from(v).toString('hex')
      const maybe = v as any
      if (typeof maybe?.toString === 'function') {
        const hex = maybe.toString('hex')
        if (typeof hex === 'string' && hex.length) return hex
      }
    } catch {
      // ignore
    }
    return undefined
  }

  private i128ToDecimalString(v: unknown): string {
    if (typeof v === 'bigint') return v.toString(10)
    if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v))
    if (typeof v === 'string' && v.length) return v
    return '0'
  }

  private i128ToNumber(v: unknown): number | undefined {
    if (v == null) return undefined
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'bigint') {
      const n = Number(v)
      return Number.isFinite(n) ? n : undefined
    }
    if (typeof v === 'string' && v.length) {
      const n = Number(v)
      return Number.isFinite(n) ? n : undefined
    }
    return undefined
  }

  private normalizeTxType(v: unknown): TxType | string {
    if (typeof v !== 'string' || !v) return ''
    const upper = v.toUpperCase()
    const snakeLower = upper.toLowerCase()

    switch (upper) {
      case 'TENANT_REPAYMENT': return TxType.TENANT_REPAYMENT
      case 'LANDLORD_PAYOUT': return TxType.LANDLORD_PAYOUT
      case 'WHISTLEBLOWER_REWARD': return TxType.WHISTLEBLOWER_REWARD
      case 'STAKE': return TxType.STAKE
      case 'UNSTAKE': return TxType.UNSTAKE
      case 'STAKE_REWARD_CLAIM': return TxType.STAKE_REWARD_CLAIM
      case 'CONVERSION': return TxType.CONVERSION
      default: return snakeLower
    }
  }

  private async withBackoff<T>(
    fn: () => Promise<T>,
    ctx: { op: string },
  ): Promise<T> {
    const maxAttempts = 5
    let attempt = 0
    for (;;) {
      attempt += 1
      try {
        return await fn()
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err)
        const status = typeof err?.response?.status === 'number' ? err.response.status : undefined
        const retryable = status === 429 || status === 503 || status === 504 || /timeout|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(msg)

        if (!retryable || attempt >= maxAttempts) {
          logger.error(`Soroban RPC ${ctx.op} failed`, { attempt, status }, err)
          throw err
        }

        const baseMs = 300
        const backoffMs = Math.min(10_000, baseMs * Math.pow(2, attempt - 1))
        const jitterMs = Math.floor(Math.random() * 250)
        const waitMs = backoffMs + jitterMs

        logger.warn(`Soroban RPC ${ctx.op} transient failure; backing off`, { attempt, status, waitMs })
        await new Promise(r => setTimeout(r, waitMs))
      }
    }
  }

  private async invokeReadOnly(
    contractId: string,
    method: string,
    args: xdr.ScVal[]
  ): Promise<xdr.ScVal> {
    const sourceAccount = new Address(this.config.rpcUrl.includes('testnet') 
      ? 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
      : 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF')
    
    // Build a dummy transaction for simulation
    const tx = new TransactionBuilder(
      new Account(sourceAccount.toString(), '-1'),
      {
        fee: '100',
        networkPassphrase: this.config.networkPassphrase,
      }
    )
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(contractId).toScAddress(),
            functionName: method,
            args: args,
          })
        ),
        auth: [],
      })
    )
    .setTimeout(30)
    .build()

    const simulation = await this.server.simulateTransaction(tx)
    
    if (rpc.Api.isSimulationSuccess(simulation)) {
      if (!simulation.result?.retval) {
        throw new Error(`No return value from ${method} on ${contractId}`)
      }
      return simulation.result.retval
    } else if (rpc.Api.isSimulationRestore(simulation)) {
      throw new Error(`Contract ${contractId} is archived. Needs restoration.`)
    } else {
      throw new Error(`Simulation failed for ${method} on ${contractId}: ${simulation.error}`)
    }
  }
}
