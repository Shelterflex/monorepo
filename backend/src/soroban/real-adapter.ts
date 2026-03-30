import {
  rpc,
  Address,
  xdr,
  scValToNative,
  nativeToScVal,
  TransactionBuilder,
  Account,
  Operation,
  Keypair,
  StrKey,
  BASE_FEE,
} from '@stellar/stellar-sdk'
import { SorobanAdapter, RecordReceiptParams } from './adapter.js'
import { SorobanConfig } from './client.js'
import { RawReceiptEvent } from '../indexer/event-parser.js'
import { logger } from '../utils/logger.js'
import { TxType } from '../outbox/types.js'
import {
  SorobanError,
  ContractError,
  DuplicateReceiptError,
  RpcError,
  ConfigurationError,
  TransactionError,
  isDuplicateReceiptError,
  isTransientRpcError,
} from './errors.js'
import { AdminSigningService } from '../services/adminSigningService.js'
import { env } from '../schemas/env.js'
import { trace, SpanStatusCode, Span } from '@opentelemetry/api'

const tracer = trace.getTracer('soroban-adapter')

export class RealSorobanAdapter implements SorobanAdapter {
  private server: rpc.Server
  private adminSigningService: AdminSigningService

  constructor(private config: SorobanConfig) {
    this.server = new rpc.Server(config.rpcUrl)
    this.adminSigningService = new AdminSigningService({
      enabled: env.SOROBAN_ADMIN_SIGNING_ENABLED,
      adminSecret: config.adminSecret,
      networkPassphrase: config.networkPassphrase,
      server: this.server,
    })
  }

  async getBalance(account: string): Promise<bigint> {
    if (!this.config.usdcTokenId) {
      throw new ConfigurationError('SOROBAN_USDC_TOKEN_ID not configured for getBalance')
    }

    try {
      const result = await this.invokeReadOnly(
        this.config.usdcTokenId,
        'balance',
        [nativeToScVal(Address.fromString(account))]
      )
      return BigInt(scValToNative(result))
    } catch (err) {
      if (err instanceof SorobanError) throw err
      throw new ContractError(
        `Failed to get USDC balance for ${account}`,
        this.config.usdcTokenId,
        'balance',
        err
      )
    }
  }

  async credit(account: string, amount: bigint): Promise<void> {
    throw new TransactionError('Credit not supported in RealSorobanAdapter - use recordReceipt instead')
  }

  async debit(account: string, amount: bigint): Promise<void> {
    throw new TransactionError('Debit not supported in RealSorobanAdapter - payments handled via custody')
  }

  async getStakedBalance(account: string): Promise<bigint> {
    if (!this.config.stakingPoolId) {
      throw new ConfigurationError('SOROBAN_STAKING_POOL_ID not configured')
    }

    try {
      const result = await this.invokeReadOnly(
        this.config.stakingPoolId,
        'staked_balance',
        [nativeToScVal(Address.fromString(account))]
      )
      return BigInt(scValToNative(result))
    } catch (err) {
      if (err instanceof SorobanError) throw err
      throw new ContractError(
        `Failed to get staked balance for ${account}`,
        this.config.stakingPoolId,
        'staked_balance',
        err
      )
    }
  }

  async getClaimableRewards(account: string): Promise<bigint> {
    if (!this.config.stakingRewardsId) {
      throw new ConfigurationError('SOROBAN_STAKING_REWARDS_ID not configured')
    }

    try {
      const result = await this.invokeReadOnly(
        this.config.stakingRewardsId,
        'get_claimable',
        [nativeToScVal(Address.fromString(account))]
      )
      return BigInt(scValToNative(result))
    } catch (err) {
      if (err instanceof SorobanError) throw err
      throw new ContractError(
        `Failed to get claimable rewards for ${account}`,
        this.config.stakingRewardsId,
        'get_claimable',
        err
      )
    }
  }

  /**
   * Record a receipt on-chain.
   * 
   * NOTE: This is NOT an admin operation. It's a regular operation that records transaction receipts.
   * Currently uses admin secret for signing, but this may be refactored to use a different key
   * in the future (e.g., operator key or dedicated receipt-signing key).
   * 
   * Idempotency: The txId serves as a deterministic idempotency key (SHA-256 of canonical external ref).
   * If a receipt with the same txId already exists, the contract returns an error that we catch
   * and treat as success (idempotent behavior).
   * 
   * This ensures duplicate calls don't break confirm/finalize flows.
   */
  async recordReceipt(params: RecordReceiptParams): Promise<void> {
    return tracer.startActiveSpan('RealSorobanAdapter.recordReceipt', async (span) => {
      span.setAttribute('soroban.tx_id', params.txId)
      span.setAttribute('soroban.deal_id', params.dealId)
      span.setAttribute('soroban.tx_type', params.txType)

      if (!this.config.contractId) {
        throw new ConfigurationError('SOROBAN_CONTRACT_ID not configured for recordReceipt')
      }

      if (!this.config.adminSecret) {
        throw new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for recordReceipt')
      }

      try {
        // Convert txId hex string to bytes
        const txIdBytes = Buffer.from(params.txId, 'hex')

        // Build the receipt parameters for the contract call
        const receiptArgs = this.buildReceiptArgs(params, txIdBytes)

        // Submit the transaction
        await this.invokeTransaction(
          this.config.contractId,
          'record_receipt',
          receiptArgs
        )

        logger.info('Receipt recorded on-chain', {
          txId: params.txId,
          txType: params.txType,
          dealId: params.dealId,
          amountUsdc: params.amountUsdc,
        })
        span.setStatus({ code: SpanStatusCode.OK })
      } catch (err) {
        // Check if this is a duplicate receipt error (idempotent success)
        if (isDuplicateReceiptError(err, params.txId)) {
          logger.info('Receipt already recorded (idempotent success)', {
            txId: params.txId,
            txType: params.txType,
            dealId: params.dealId,
          })
          span.setStatus({ code: SpanStatusCode.OK, message: 'Duplicate receipt (idempotent success)' })
          return
        }

        // Re-throw SorobanError types
        if (err instanceof SorobanError) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err.message,
          })
          if (err instanceof Error) span.recordException(err)
          throw err
        }

        // Wrap other errors
        const wrappedError = new TransactionError(
          `Failed to record receipt for tx ${params.txId}`,
          undefined,
          'record_receipt',
          err
        )

        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: wrappedError.message,
        })
        if (err instanceof Error) span.recordException(err)
        throw wrappedError
      } finally {
        span.end()
      }
    })
  }

  /**
   * Build receipt arguments for the contract call.
   * Maps TypeScript params to Soroban SCVal types.
   */
  private buildReceiptArgs(params: RecordReceiptParams, txIdBytes: Buffer): xdr.ScVal[] {
    // Build the receipt struct/map for the contract
    const receiptMap = new Map<string, xdr.ScVal>()

    // Required fields
    receiptMap.set('tx_id', this.bytesToScVal(txIdBytes))
    receiptMap.set('tx_type', nativeToScVal(params.txType))
    receiptMap.set('amount_usdc', this.decimalToI128(params.amountUsdc))
    receiptMap.set('token_address', nativeToScVal(new Address(params.tokenAddress)))
    receiptMap.set('deal_id', nativeToScVal(params.dealId))

    // Optional fields - only include if present
    if (params.listingId) {
      receiptMap.set('listing_id', nativeToScVal(params.listingId))
    }
    if (params.from) {
      receiptMap.set('from', nativeToScVal(new Address(params.from)))
    }
    if (params.to) {
      receiptMap.set('to', nativeToScVal(new Address(params.to)))
    }
    if (params.amountNgn !== undefined) {
      receiptMap.set('amount_ngn', nativeToScVal(params.amountNgn, { type: 'i128' }))
    }
    if (params.fxRate !== undefined) {
      // Store fx rate as scaled integer (e.g., 1500.50 -> 1500500000 for 6 decimal precision)
      const fxRateScaled = Math.round(params.fxRate * 1_000_000)
      receiptMap.set('fx_rate_ngn_per_usdc', nativeToScVal(fxRateScaled, { type: 'i128' }))
    }
    if (params.fxProvider) {
      receiptMap.set('fx_provider', nativeToScVal(params.fxProvider))
    }
    if (params.metadataHash) {
      receiptMap.set('metadata_hash', this.bytesToScVal(Buffer.from(params.metadataHash, 'hex')))
    }

    // Return as a single map argument
    return [nativeToScVal(receiptMap, { type: 'map' })]
  }

  /**
   * Convert bytes to ScVal
   */
  private bytesToScVal(bytes: Buffer): xdr.ScVal {
    return xdr.ScVal.scvBytes(bytes)
  }

  /**
   * Convert decimal string (USDC amount) to i128 ScVal
   * USDC has 6 decimals, so we scale accordingly
   */
  private decimalToI128(decimal: string): xdr.ScVal {
    // Parse decimal string and convert to scaled integer
    const parts = decimal.split('.')
    const whole = parts[0] || '0'
    const fraction = (parts[1] || '').padEnd(6, '0').slice(0, 6)
    const scaled = BigInt(whole) * BigInt(1_000_000) + BigInt(fraction)
    return nativeToScVal(scaled, { type: 'i128' })
  }

  getConfig(): SorobanConfig {
    return { ...this.config }
  }

  async getReceiptEvents(fromLedger: number | null): Promise<RawReceiptEvent[]> {
    if (!this.config.contractId) {
      throw new ConfigurationError('SOROBAN_CONTRACT_ID not configured for getReceiptEvents')
    }

    try {
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

      for (; ;) {
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
    } catch (err) {
      if (err instanceof SorobanError) throw err
      throw new RpcError('Failed to get receipt events', undefined, err)
    }
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
    for (; ;) {
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
    args: xdr.ScVal[],
  ): Promise<xdr.ScVal> {
    return tracer.startActiveSpan(`Soroban.invokeReadOnly:${method}`, async (span: Span) => {
      span.setAttribute('soroban.contract_id', contractId)
      span.setAttribute('soroban.method', method)
      span.setAttribute('soroban.rpc_url', this.config.rpcUrl)

      try {
        const sourceAccount = Address.fromString(this.config.rpcUrl.includes('testnet')
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
            throw new ContractError(
              `No return value from ${method}`,
              contractId,
              method
            )
          }
          span.setStatus({ code: SpanStatusCode.OK })
          return simulation.result.retval
        } else if (rpc.Api.isSimulationRestore(simulation)) {
          throw new ContractError(
            `Contract ${contractId} is archived. Needs restoration.`,
            contractId,
            method
          )
        } else {
          throw new ContractError(
            `Simulation failed: ${simulation.error}`,
            contractId,
            method
          )
        }
      } catch (err) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        })
        if (err instanceof Error) span.recordException(err)
        throw err
      } finally {
        span.end()
      }
    })
  }

  /**
   * Submit a transaction to the Soroban network.
   * This involves building, signing, and submitting the actual transaction.
   */
  private async invokeTransaction(
    contractId: string,
    method: string,
    args: xdr.ScVal[],
  ): Promise<xdr.ScVal> {
    return tracer.startActiveSpan(`Soroban.invokeTransaction:${method}`, async (span: Span) => {
      span.setAttribute('soroban.contract_id', contractId)
      span.setAttribute('soroban.method', method)
      span.setAttribute('soroban.rpc_url', this.config.rpcUrl)

      try {
        if (!this.config.adminSecret) {
          throw new ConfigurationError('Admin secret key not configured for transaction submission')
        }

        // Load admin keypair
        let adminKeypair: Keypair
        try {
          adminKeypair = Keypair.fromSecret(this.config.adminSecret)
        } catch (err) {
          throw new ConfigurationError('Invalid admin secret key configured')
        }

        const adminPublicKey = adminKeypair.publicKey()

        // Get the admin's account info from the network
        const accountResponse = await this.withBackoff(
          () => this.server.getAccount(adminPublicKey),
          { op: 'getAccount' }
        )

        // Build the transaction using account from RPC
        const tx = new TransactionBuilder(
          accountResponse,
          {
            fee: BASE_FEE,
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
              auth: [], // Auth handled by the transaction signature
            })
          )
          .setTimeout(30)
          .build()

        // Sign the transaction
        tx.sign(adminKeypair)

        // Submit the transaction
        const response = await this.withBackoff(
          () => this.server.sendTransaction(tx),
          { op: 'sendTransaction' }
        )

        span.setAttribute('soroban.tx_hash', response.hash)

        if (response.status !== 'PENDING') {
          // Transaction failed immediately - check for duplicate or other errors
          const errorResult = response as any
          const resultXdr = errorResult.errorResultXdr

          if (resultXdr) {
            try {
              const result = xdr.TransactionResult.fromXDR(resultXdr, 'base64')
              // Check if contract trapped (often indicates duplicate or contract error)
              const errorStr = result.toXDR('base64')
              if (errorStr.includes('trapped') || errorStr.includes('duplicate') || errorStr.includes('already')) {
                throw new ContractError(
                  `Contract error during ${method}. May indicate duplicate receipt.`,
                  contractId,
                  method
                )
              }
            } catch (decodeErr) {
              // If we can't decode, fall through to generic error
            }
          }

          throw new TransactionError(
            `Transaction failed with status: ${response.status}`,
            response.hash,
            method
          )
        }

        // Wait for transaction confirmation if pending
        if (response.status === 'PENDING') {
          const confirmedTx = await this.waitForTransaction(response.hash)
          if (!confirmedTx) {
            throw new TransactionError(
              'Transaction not confirmed within timeout',
              response.hash,
              method
            )
          }

          // Check if transaction was successful
          if (confirmedTx.status === 'SUCCESS') {
            span.setStatus({ code: SpanStatusCode.OK })
            // Return success - no specific return value for write operations
            return xdr.ScVal.scvVoid()
          } else {
            throw new TransactionError(
              `Transaction failed: ${confirmedTx.status}`,
              response.hash,
              method
            )
          }
        }

        span.setStatus({ code: SpanStatusCode.OK })
        return xdr.ScVal.scvVoid()
      } catch (err) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        })
        if (err instanceof Error) span.recordException(err)
        throw err
      } finally {
        span.end()
      }
    })
  }
  /**
   * Wait for a transaction to be confirmed by polling getTransaction
   */
  private async waitForTransaction(
    txHash: string,
    maxAttempts: number = 30,
    pollIntervalMs: number = 1000
  ): Promise<{ status: string; result?: xdr.ScVal } | null> {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, pollIntervalMs))

      try {
        const result = await this.server.getTransaction(txHash)

        if (result.status === 'SUCCESS') {
          // Parse return value from meta if available
          let returnValue: xdr.ScVal | undefined
          if (result.resultMetaXdr) {
            try {
              // resultMetaXdr can be either a string or already parsed
              let meta: xdr.TransactionMeta
              if (typeof result.resultMetaXdr === 'string') {
                meta = xdr.TransactionMeta.fromXDR(result.resultMetaXdr, 'base64')
              } else {
                meta = result.resultMetaXdr as xdr.TransactionMeta
              }
              const sorobanMeta = meta.v3()?.sorobanMeta()
              if (sorobanMeta) {
                returnValue = sorobanMeta.returnValue()
              }
            } catch {
              // Ignore parsing errors
            }
          }
          return {
            status: result.status,
            result: returnValue,
          }
        } else if (result.status === 'FAILED') {
          return { status: result.status }
        }
        // Status is still PENDING, continue polling
      } catch (err) {
        // If transient error, continue polling
        if (isTransientRpcError(err)) {
          continue
        }
        throw err
      }
    }

    return null // Timeout
  }

  /**
   * Admin operation: Pause a contract
   * Requires SOROBAN_ADMIN_SIGNING_ENABLED=true
   */
  async pause(contractId: string): Promise<string> {
    if (!contractId) {
      contractId = this.config.contractId || ''
    }
    if (!contractId) {
      throw new ConfigurationError('Contract ID required for pause operation')
    }

    // Load admin keypair to get public key for args
    if (!this.config.adminSecret) {
      throw new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for pause operation')
    }
    const adminKeypair = Keypair.fromSecret(this.config.adminSecret)
    const adminAddress = adminKeypair.publicKey()

    return this.adminSigningService.executeAdminOperation({
      contractId,
      operation: 'pause',
      args: [nativeToScVal(new Address(adminAddress))],
      networkPassphrase: this.config.networkPassphrase,
      adminSecret: this.config.adminSecret,
      server: this.server,
    })
  }

  /**
   * Admin operation: Unpause a contract
   * Requires SOROBAN_ADMIN_SIGNING_ENABLED=true
   */
  async unpause(contractId: string): Promise<string> {
    if (!contractId) {
      contractId = this.config.contractId || ''
    }
    if (!contractId) {
      throw new ConfigurationError('Contract ID required for unpause operation')
    }

    // Load admin keypair to get public key for args
    if (!this.config.adminSecret) {
      throw new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for unpause operation')
    }
    const adminKeypair = Keypair.fromSecret(this.config.adminSecret)
    const adminAddress = adminKeypair.publicKey()

    return this.adminSigningService.executeAdminOperation({
      contractId,
      operation: 'unpause',
      args: [nativeToScVal(new Address(adminAddress))],
      networkPassphrase: this.config.networkPassphrase,
      adminSecret: this.config.adminSecret,
      server: this.server,
    })
  }

  /**
   * Admin operation: Set operator for a contract
   * Requires SOROBAN_ADMIN_SIGNING_ENABLED=true
   */
  async setOperator(contractId: string, operatorAddress: string | null): Promise<string> {
    if (!contractId) {
      contractId = this.config.contractId || ''
    }
    if (!contractId) {
      throw new ConfigurationError('Contract ID required for setOperator operation')
    }

    // Load admin keypair to get public key for args
    if (!this.config.adminSecret) {
      throw new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for setOperator operation')
    }
    const adminKeypair = Keypair.fromSecret(this.config.adminSecret)
    const adminAddress = adminKeypair.publicKey()

    // Create Option<Address> - Some(Address) or None
    // nativeToScVal should handle undefined/null as None for Option types
    const operatorOption = operatorAddress
      ? nativeToScVal(new Address(operatorAddress))
      : nativeToScVal(undefined)

    return this.adminSigningService.executeAdminOperation({
      contractId,
      operation: 'set_operator',
      args: [
        nativeToScVal(new Address(adminAddress)),
        operatorOption,
      ],
      networkPassphrase: this.config.networkPassphrase,
      adminSecret: this.config.adminSecret,
      server: this.server,
    })
  }

  /**
   * Admin operation: Initialize a contract
   * Requires SOROBAN_ADMIN_SIGNING_ENABLED=true
   */
  async init(contractId: string, adminAddress: string, operatorAddress?: string): Promise<string> {
    if (!contractId) {
      contractId = this.config.contractId || ''
    }
    if (!contractId) {
      throw new ConfigurationError('Contract ID required for init operation')
    }

    const args: xdr.ScVal[] = [
      nativeToScVal(new Address(adminAddress)),
    ]

    if (operatorAddress) {
      args.push(nativeToScVal(new Address(operatorAddress)))
    }

    if (!this.config.adminSecret) {
      throw new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for init operation')
    }

    return this.adminSigningService.executeAdminOperation({
      contractId,
      operation: 'init',
      args,
      networkPassphrase: this.config.networkPassphrase,
      adminSecret: this.config.adminSecret,
      server: this.server,
    })
  }

  async getTimelockEvents(fromLedger: number | null): Promise<any[]> {
    if (!this.config.timelockId) {
      return []
    }

    try {
      const latest = await this.withBackoff(
        () => this.server.getLatestLedger(),
        { op: 'getLatestLedger' }
      )

      const startLedger = fromLedger == null ? latest.sequence : fromLedger + 1
      if (startLedger > latest.sequence) return []

      const limit = 200
      let cursor: string | undefined
      const out: any[] = []

      for (; ;) {
        const params: any = cursor
          ? {
            cursor,
            limit,
            filters: [
              {
                type: 'contract',
                contractIds: [this.config.timelockId],
              },
            ],
          }
          : {
            startLedger,
            limit,
            filters: [
              {
                type: 'contract',
                contractIds: [this.config.timelockId],
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
          
          out.push({
            ledger: evAny.ledger,
            txHash: evAny.txHash,
            contractId: evAny.contractId,
            topic: evAny.topic.map((t: string) => scValToNative(xdr.ScVal.fromXDR(t, 'base64'))),
            data: scValToNative(xdr.ScVal.fromXDR(evAny.value, 'base64')),
          })
        }

        const nextCursor: string | undefined = resAny?.cursor
        if (!nextCursor || nextCursor === cursor) break
        cursor = nextCursor

        if (events.length < limit) break
      }

      return out
    } catch (err) {
      if (err instanceof SorobanError) throw err
      throw new RpcError('Failed to get timelock events', undefined, err)
    }
  }

   async executeTimelock(txHash: string, target: string, functionName: string, args: any[], eta: number): Promise<string> {
    if (!this.config.timelockId) {
      throw new ConfigurationError('SOROBAN_TIMELOCK_ID not configured')
    }

    const scArgs: xdr.ScVal[] = [
      nativeToScVal(Address.fromString(target)),
      nativeToScVal(functionName, { type: 'symbol' }),
      nativeToScVal(args), 
      nativeToScVal(eta, { type: 'u64' })
    ]

    return this.adminSigningService.executeAdminOperation({
      contractId: this.config.timelockId,
      operation: 'execute',
      args: scArgs,
      networkPassphrase: this.config.networkPassphrase,
      adminSecret: this.config.adminSecret!,
      server: this.server,
    })
  }

  async cancelTimelock(txHash: string): Promise<string> {
    if (!this.config.timelockId) {
      throw new ConfigurationError('SOROBAN_TIMELOCK_ID not configured')
    }

    // Convert hex txHash (string) to Uint8Array for BytesN<32>
    const hashBytes = new Uint8Array(txHash.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));

    const scArgs: xdr.ScVal[] = [
      nativeToScVal(this.config.adminSecret ? Keypair.fromSecret(this.config.adminSecret).publicKey() : '', { type: 'address' }),
      xdr.ScVal.scvBytes(hashBytes)
    ]

    return this.adminSigningService.executeAdminOperation({
      contractId: this.config.timelockId,
      operation: 'cancel',
      args: scArgs,
      networkPassphrase: this.config.networkPassphrase,
      adminSecret: this.config.adminSecret!,
      server: this.server,
    })
  }
}
