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
import {
  SorobanAdapter,
  RecordReceiptParams,
  SyncDealStatusParams,
  RequestRentReleaseParams,
  ChallengeRentReleaseParams,
  ResolveRentDisputeParams,
  SettleRentReleaseTimeoutParams,
  SettleDisputeTimeoutParams,
  RentDisputeOutcome,
  RegisterRentToOwnDealParams,
  RecordRentToOwnEquityPaymentParams,
  RentToOwnDealActionParams,
  MultisigArg,
  MultisigCall,
  MultisigCallParams,
  MultisigConfig,
  MultisigProposal,
  MultisigProposalStatus,
} from './adapter.js'
import { assertSignedInvocation, buildInvokeOperation } from './userSignedTx.js'
import { decodeProposalArgs, encodeMultisigArg } from './multisigArgs.js'
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
import { toSorobanReasonSymbol } from '../services/deals/rentToOwnConversion.js'
import { getStellarSequenceAllocator, type AllocationResult } from '../services/stellarSequenceAllocator.js'
import { env } from '../schemas/env.js'
import { trace, SpanStatusCode, Span } from '@opentelemetry/api'
import type { TxBroadcastHooks, TxOnChainStatus } from './adapter.js'

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
    return tracer.startActiveSpan('RealSorobanAdapter.getBalance', async (span) => {
      span.setAttribute('soroban.account', account)
      
      if (!this.config.usdcTokenId) {
        const err = new ConfigurationError('SOROBAN_USDC_TOKEN_ID not configured for getBalance')
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
        span.recordException(err)
        span.end()
        throw err
      }

      try {
        const result = await this.invokeReadOnly(
          this.config.usdcTokenId,
          'balance',
          [nativeToScVal(Address.fromString(account))]
        )
        const balance = BigInt(scValToNative(result))
        span.setAttribute('soroban.balance', balance.toString())
        span.setStatus({ code: SpanStatusCode.OK })
        return balance
      } catch (err: any) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message || String(err) })
        if (err instanceof Error) span.recordException(err)
        if (err instanceof SorobanError) throw err
        throw new ContractError(
          `Failed to get USDC balance for ${account}`,
          this.config.usdcTokenId,
          'balance',
          err
        )
      } finally {
        span.end()
      }
    })
  }

  async credit(account: string, amount: bigint): Promise<void> {
    throw new TransactionError('Credit not supported in RealSorobanAdapter - use recordReceipt instead')
  }

  async debit(account: string, amount: bigint): Promise<void> {
    throw new TransactionError('Debit not supported in RealSorobanAdapter - payments handled via custody')
  }

  async getStakedBalance(account: string): Promise<bigint> {
    return tracer.startActiveSpan('RealSorobanAdapter.getStakedBalance', async (span) => {
      span.setAttribute('soroban.account', account)
      
      if (!this.config.stakingPoolId) {
        const err = new ConfigurationError('SOROBAN_STAKING_POOL_ID not configured')
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
        span.recordException(err)
        span.end()
        throw err
      }

      try {
        const result = await this.invokeReadOnly(
          this.config.stakingPoolId,
          'staked_balance',
          [nativeToScVal(Address.fromString(account))]
        )
        const balance = BigInt(scValToNative(result))
        span.setAttribute('soroban.staked_balance', balance.toString())
        span.setStatus({ code: SpanStatusCode.OK })
        return balance
      } catch (err: any) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message || String(err) })
        if (err instanceof Error) span.recordException(err)
        if (err instanceof SorobanError) throw err
        throw new ContractError(
          `Failed to get staked balance for ${account}`,
          this.config.stakingPoolId,
          'staked_balance',
          err
        )
      } finally {
        span.end()
      }
    })
  }

  async getTransactionStatus(txHash: string): Promise<TxOnChainStatus> {
    const inner = async (span: Span): Promise<TxOnChainStatus> => {
      span.setAttribute('soroban.tx_hash', txHash)
      try {
        const result = await this.withBackoff(
          () => this.server.getTransaction(txHash),
          { op: 'getTransaction' }
        )
        const status = result.status as string
        if (status === 'SUCCESS') {
          const ledger = typeof (result as any).ledger === 'number' ? (result as any).ledger as number : undefined
          span.setStatus({ code: SpanStatusCode.OK })
          return { status: 'success', ledger }
        }
        if (status === 'FAILED') {
          span.setStatus({ code: SpanStatusCode.OK })
          return { status: 'failed' }
        }
        span.setStatus({ code: SpanStatusCode.OK })
        return { status: status === 'NOT_FOUND' ? 'not_found' : 'pending' }
      } catch (err: any) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message || String(err) })
        if (err instanceof Error) span.recordException(err)
        if (isTransientRpcError(err)) return { status: 'pending' }
        return { status: 'not_found' }
      } finally {
        span.end()
      }
    }
    return tracer.startActiveSpan('RealSorobanAdapter.getTransactionStatus', inner)
  }

  async getClaimableRewards(account: string): Promise<bigint> {
    return tracer.startActiveSpan('RealSorobanAdapter.getClaimableRewards', async (span) => {
      span.setAttribute('soroban.account', account)
      
      if (!this.config.stakingRewardsId) {
        const err = new ConfigurationError('SOROBAN_STAKING_REWARDS_ID not configured')
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
        span.recordException(err)
        span.end()
        throw err
      }

      try {
        const result = await this.invokeReadOnly(
          this.config.stakingRewardsId,
          'get_claimable',
          [nativeToScVal(Address.fromString(account))]
        )
        const rewards = BigInt(scValToNative(result))
        span.setAttribute('soroban.claimable_rewards', rewards.toString())
        span.setStatus({ code: SpanStatusCode.OK })
        return rewards
      } catch (err: any) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message || String(err) })
        if (err instanceof Error) span.recordException(err)
        if (err instanceof SorobanError) throw err
        throw new ContractError(
          `Failed to get claimable rewards for ${account}`,
          this.config.stakingRewardsId,
          'get_claimable',
          err
        )
      } finally {
        span.end()
      }
    })
  }

  private getMvpPoolId(): string {
    if (!this.config.mvpStakingPoolId) {
      throw new ConfigurationError('SOROBAN_MVP_STAKING_POOL_ID not configured')
    }
    return this.config.mvpStakingPoolId
  }

  private async getMvpValue(method: string, account: string): Promise<bigint> {
    const contractId = this.getMvpPoolId()
    const result = await this.invokeReadOnly(contractId, method, [
      nativeToScVal(new Address(account)),
    ])
    return BigInt(scValToNative(result))
  }

  async mvpStakedBalance(account: string): Promise<bigint> {
    return this.getMvpValue('staked_balance', account)
  }

  async usedStake(account: string): Promise<bigint> {
    return this.getMvpValue('used_stake', account)
  }

  async unusedStake(account: string): Promise<bigint> {
    return this.getMvpValue('unused_stake', account)
  }

  async claimable(account: string): Promise<bigint> {
    return this.getMvpValue('claimable', account)
  }

  private async executeMvpAdminOperation(
    operation: 'stake' | 'unstake' | 'claim' | 'utilize_stake',
    args: xdr.ScVal[],
  ): Promise<string> {
    const contractId = this.getMvpPoolId()
    if (!this.config.adminSecret) {
      throw new ConfigurationError(`SOROBAN_ADMIN_SECRET not configured for MVP ${operation}`)
    }
    return this.adminSigningService.executeAdminOperation({
      contractId,
      operation,
      args,
      networkPassphrase: this.config.networkPassphrase,
      adminSecret: this.config.adminSecret,
      server: this.server,
    })
  }

  async stake(account: string, amount: bigint): Promise<string> {
    return this.executeMvpAdminOperation('stake', [
      nativeToScVal(new Address(account)),
      nativeToScVal(amount, { type: 'i128' }),
    ])
  }

  async unstake(account: string, amount: bigint): Promise<string> {
    return this.executeMvpAdminOperation('unstake', [
      nativeToScVal(new Address(account)),
      nativeToScVal(amount, { type: 'i128' }),
    ])
  }

  async utilizeStake(user: string, amount: bigint): Promise<string> {
    if (!this.config.adminSecret) {
      throw new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for MVP utilize_stake')
    }
    const adminAddress = Keypair.fromSecret(this.config.adminSecret).publicKey()
    return this.executeMvpAdminOperation('utilize_stake', [
      nativeToScVal(new Address(adminAddress)),
      nativeToScVal(new Address(user)),
      nativeToScVal(amount, { type: 'i128' }),
    ])
  }

  async claim(account: string): Promise<string> {
    return this.executeMvpAdminOperation('claim', [nativeToScVal(new Address(account))])
  }

  // ── stake_delegation (#1489) ───────────────────────────────────────────────
  //
  // stake_delegation is a standalone delegated-staking ledger: it keeps its own
  // StakedBalance/TotalStaked/RewardIndex and never calls staking_pool, so none
  // of these reads or writes touch the staking_pool position exposed by
  // getStakedBalance/getClaimableRewards.
  //
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
   * 
   * Migration: If SOROBAN_TRANSACTION_RECEIPT_ID is configured, uses the dedicated transaction-receipt-contract.
   * Otherwise, falls back to the legacy core contract for backward compatibility.
   */
  async recordReceipt(params: RecordReceiptParams, hooks?: TxBroadcastHooks): Promise<void> {
    return tracer.startActiveSpan('RealSorobanAdapter.recordReceipt', async (span) => {
      span.setAttribute('soroban.tx_id', params.txId)
      span.setAttribute('soroban.deal_id', params.dealId)
      span.setAttribute('soroban.tx_type', params.txType)

      // Determine which contract to use
      const useTransactionReceiptContract = !!this.config.transactionReceiptId
      const contractId = useTransactionReceiptContract
        ? this.config.transactionReceiptId!
        : this.config.contractId

      if (!contractId) {
        const contractName = useTransactionReceiptContract
          ? 'SOROBAN_TRANSACTION_RECEIPT_ID'
          : 'SOROBAN_CONTRACT_ID'
        throw new ConfigurationError(`${contractName} not configured for recordReceipt`)
      }

      if (!this.config.adminSecret) {
        throw new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for recordReceipt')
      }

      try {
        // Convert txId hex string to bytes
        const txIdBytes = Buffer.from(params.txId, 'hex')

        // Build the receipt parameters for the contract call
        const receiptArgs = useTransactionReceiptContract
          ? this.buildReceiptArgs(params, txIdBytes)
          : this.buildLegacyReceiptArgs(params, txIdBytes)

        // Submit the transaction (onTxBuilt fires before broadcast for durable intent)
        await this.invokeTransaction(
          contractId,
          'record_receipt',
          receiptArgs,
          hooks,
        )

        logger.info('Receipt recorded on-chain', {
          txId: params.txId,
          txType: params.txType,
          dealId: params.dealId,
          amountUsdc: params.amountUsdc,
          contractType: useTransactionReceiptContract ? 'transaction-receipt-contract' : 'legacy-core',
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
   * Build receipt arguments for the transaction-receipt-contract call.
   * Maps TypeScript params to Soroban SCVal types matching ReceiptInput struct.
   */
  private buildReceiptArgs(params: RecordReceiptParams, txIdBytes: Buffer): xdr.ScVal[] {
    // Build the ReceiptInput struct/map for the transaction-receipt-contract
    const receiptMap = new Map<string, xdr.ScVal>()

    // Required fields for transaction-receipt-contract
    // The contract generates tx_id internally from external_ref_source and external_ref
    if (params.externalRefSource) {
      receiptMap.set('external_ref_source', nativeToScVal(params.externalRefSource))
    }
    if (params.externalRef) {
      receiptMap.set('external_ref', nativeToScVal(params.externalRef))
    }
    receiptMap.set('tx_type', nativeToScVal(params.txType))
    receiptMap.set('amount_usdc', this.decimalToI128(params.amountUsdc))
    receiptMap.set('token', nativeToScVal(new Address(params.tokenAddress)))
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
   * Build receipt arguments for the legacy core contract call.
   * Used during migration when transactionReceiptId is not configured.
   */
  private buildLegacyReceiptArgs(params: RecordReceiptParams, txIdBytes: Buffer): xdr.ScVal[] {
    // Build the receipt struct/map for the legacy core contract
    const receiptMap = new Map<string, xdr.ScVal>()

    // Required fields for legacy contract
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
      const fxRateScaled = Math.round(params.fxRate * 1_000_000)
      receiptMap.set('fx_rate_ngn_per_usdc', nativeToScVal(fxRateScaled, { type: 'i128' }))
    }
    if (params.fxProvider) {
      receiptMap.set('fx_provider', nativeToScVal(params.fxProvider))
    }
    if (params.metadataHash) {
      receiptMap.set('metadata_hash', this.bytesToScVal(Buffer.from(params.metadataHash, 'hex')))
    }

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
    return tracer.startActiveSpan('RealSorobanAdapter.getReceiptEvents', async (span) => {
      span.setAttribute('soroban.from_ledger', fromLedger ?? 'latest')

      // Determine which contract(s) to query
      const useTransactionReceiptContract = !!this.config.transactionReceiptId
      const contractIds = useTransactionReceiptContract
        ? [this.config.transactionReceiptId!]
        : this.config.contractId
          ? [this.config.contractId]
          : []

      if (contractIds.length === 0) {
        const err = new ConfigurationError('Neither SOROBAN_TRANSACTION_RECEIPT_ID nor SOROBAN_CONTRACT_ID configured for getReceiptEvents')
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
        span.recordException(err)
        span.end()
        throw err
      }

      try {
        const latest = await this.withBackoff(
          () => this.server.getLatestLedger(),
          { op: 'getLatestLedger' }
        )

        const startLedger = fromLedger == null ? latest.sequence : fromLedger + 1
        if (startLedger > latest.sequence) {
          span.setStatus({ code: SpanStatusCode.OK })
          return []
        }

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
                  contractIds,
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
                  contractIds,
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
            if (!contractId || !contractIds.includes(contractId)) continue

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

        span.setAttribute('soroban.events_count', out.length)
        span.setStatus({ code: SpanStatusCode.OK })
        return out
      } catch (err: any) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message || String(err) })
        if (err instanceof Error) span.recordException(err)
        if (err instanceof SorobanError) throw err
        throw new RpcError('Failed to get receipt events', undefined, err)
      } finally {
        span.end()
      }
    })
  }

  /**
   * Get a receipt by transaction ID from the transaction-receipt-contract.
   * Direct query method for reliable on-chain receipt lookup.
   */
  async getReceiptById(txId: string): Promise<import('./adapter.js').OnChainReceipt | null> {
    return tracer.startActiveSpan('RealSorobanAdapter.getReceiptById', async (span) => {
      span.setAttribute('soroban.tx_id', txId)

      if (!this.config.transactionReceiptId) {
        const err = new ConfigurationError('SOROBAN_TRANSACTION_RECEIPT_ID not configured for getReceiptById')
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
        span.recordException(err)
        span.end()
        throw err
      }

      try {
        const txIdBytes = Buffer.from(txId, 'hex')
        const result = await this.invokeReadOnly(
          this.config.transactionReceiptId,
          'get_receipt',
          [nativeToScVal(txIdBytes)]
        )

        if (!result) {
          span.setStatus({ code: SpanStatusCode.OK })
          return null
        }

        const receipt = this.normalizeOnChainReceipt(scValToNative(result))
        span.setStatus({ code: SpanStatusCode.OK })
        return receipt
      } catch (err: any) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message || String(err) })
        if (err instanceof Error) span.recordException(err)
        if (err instanceof SorobanError) throw err
        throw new ContractError(
          `Failed to get receipt by ID ${txId}`,
          this.config.transactionReceiptId,
          'get_receipt',
          err
        )
      } finally {
        span.end()
      }
    })
  }

  /**
   * List receipts for a specific deal from the transaction-receipt-contract.
   * Direct query method with pagination support.
   */
  async listReceiptsByDeal(
    dealId: string,
    limit: number,
    cursor?: number
  ): Promise<import('./adapter.js').OnChainReceipt[]> {
    return tracer.startActiveSpan('RealSorobanAdapter.listReceiptsByDeal', async (span) => {
      span.setAttribute('soroban.deal_id', dealId)
      span.setAttribute('soroban.limit', limit)
      span.setAttribute('soroban.cursor', cursor ?? 0)

      if (!this.config.transactionReceiptId) {
        const err = new ConfigurationError('SOROBAN_TRANSACTION_RECEIPT_ID not configured for listReceiptsByDeal')
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
        span.recordException(err)
        span.end()
        throw err
      }

      try {
        const result = await this.invokeReadOnly(
          this.config.transactionReceiptId,
          'list_receipts_by_deal',
          [
            nativeToScVal(dealId),
            nativeToScVal(limit, { type: 'u32' }),
            cursor !== undefined ? nativeToScVal(cursor, { type: 'u32' }) : nativeToScVal(null),
          ]
        )

        const receiptsVec = scValToNative(result) as any[]
        const receipts = receiptsVec.map(r => this.normalizeOnChainReceipt(r))

        span.setAttribute('soroban.receipts_count', receipts.length)
        span.setStatus({ code: SpanStatusCode.OK })
        return receipts
      } catch (err: any) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message || String(err) })
        if (err instanceof Error) span.recordException(err)
        if (err instanceof SorobanError) throw err
        throw new ContractError(
          `Failed to list receipts for deal ${dealId}`,
          this.config.transactionReceiptId,
          'list_receipts_by_deal',
          err
        )
      } finally {
        span.end()
      }
    })
  }

  /**
   * List receipts for a specific user from the transaction-receipt-contract.
   * Direct query method with pagination support.
   */
  async listReceiptsByUser(
    userAddress: string,
    limit: number,
    cursor?: number
  ): Promise<import('./adapter.js').OnChainReceipt[]> {
    return tracer.startActiveSpan('RealSorobanAdapter.listReceiptsByUser', async (span) => {
      span.setAttribute('soroban.user_address', userAddress)
      span.setAttribute('soroban.limit', limit)
      span.setAttribute('soroban.cursor', cursor ?? 0)

      if (!this.config.transactionReceiptId) {
        const err = new ConfigurationError('SOROBAN_TRANSACTION_RECEIPT_ID not configured for listReceiptsByUser')
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
        span.recordException(err)
        span.end()
        throw err
      }

      try {
        const result = await this.invokeReadOnly(
          this.config.transactionReceiptId,
          'list_receipts_by_user',
          [
            nativeToScVal(new Address(userAddress)),
            nativeToScVal(limit, { type: 'u32' }),
            cursor !== undefined ? nativeToScVal(cursor, { type: 'u32' }) : nativeToScVal(null),
          ]
        )

        const receiptsVec = scValToNative(result) as any[]
        const receipts = receiptsVec.map(r => this.normalizeOnChainReceipt(r))

        span.setAttribute('soroban.receipts_count', receipts.length)
        span.setStatus({ code: SpanStatusCode.OK })
        return receipts
      } catch (err: any) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message || String(err) })
        if (err instanceof Error) span.recordException(err)
        if (err instanceof SorobanError) throw err
        throw new ContractError(
          `Failed to list receipts for user ${userAddress}`,
          this.config.transactionReceiptId,
          'list_receipts_by_user',
          err
        )
      } finally {
        span.end()
      }
    })
  }

  /**
   * Normalize on-chain receipt to TypeScript interface.
   * Converts Soroban types to plain JavaScript types.
   */
  private normalizeOnChainReceipt(receipt: any): import('./adapter.js').OnChainReceipt {
    return {
      tx_id: this.bytesLikeToHex(receipt?.tx_id) ?? '',
      tx_type: typeof receipt?.tx_type === 'string' ? receipt.tx_type : '',
      amount_usdc: this.i128ToDecimalString(receipt?.amount_usdc),
      token: String(receipt?.token ?? ''),
      deal_id: typeof receipt?.deal_id === 'string' ? receipt.deal_id : '',
      listing_id: typeof receipt?.listing_id === 'string' ? receipt.listing_id : undefined,
      from: receipt?.from ? String(receipt.from) : undefined,
      to: receipt?.to ? String(receipt.to) : undefined,
      external_ref: this.bytesLikeToHex(receipt?.external_ref) ?? '',
      amount_ngn: this.i128ToDecimalString(receipt?.amount_ngn),
      fx_rate_ngn_per_usdc: this.i128ToDecimalString(receipt?.fx_rate_ngn_per_usdc),
      fx_provider: typeof receipt?.fx_provider === 'string' ? receipt.fx_provider : undefined,
      metadata_hash: this.bytesLikeToHex(receipt?.metadata_hash),
      timestamp: typeof receipt?.timestamp === 'number' ? receipt.timestamp : 0,
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
    if (typeof v === 'string') return v
    if (Buffer.isBuffer(v)) return v.toString('hex')
    if (v instanceof Uint8Array) return Buffer.from(v).toString('hex')
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
    const maxAttempts = 4
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await tracer.startActiveSpan(`Soroban.rpc:${ctx.op}`, async (span) => {
          span.setAttribute('soroban.rpc.op', ctx.op)
          span.setAttribute('soroban.rpc.attempt', attempt)
          span.setAttribute('soroban.rpc.max_attempts', maxAttempts)

          try {
            const result = await fn()
            span.setStatus({ code: SpanStatusCode.OK })
            return result
          } catch (err: any) {
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
      } catch (err: any) {
        if (!isTransientRpcError(err) || attempt === maxAttempts) {
          throw err
        }
        const status = typeof err?.response?.status === 'number' ? err.response.status : undefined
        const retryable = status === 429 || status === 503 || status === 504 || /timeout|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(err.message)

        if (!retryable || attempt >= maxAttempts) {
          logger.error(`Soroban RPC ${ctx.op} failed`, { attempt, status }, err)
          throw err
        }

        const baseMs = 300
        const backoffMs = Math.min(10_000, baseMs * Math.pow(2, attempt - 1))
        const jitterMs = Math.floor(Math.random() * 250)
        const waitMs = backoffMs + jitterMs

        const activeSpan = trace.getActiveSpan()
        if (activeSpan) {
          activeSpan.addEvent('soroban.rpc.backoff', {
            op: ctx.op,
            attempt,
            waitMs,
          })
        }

        logger.warn(`Soroban RPC ${ctx.op} transient failure; backing off`, { attempt, status, waitMs })
        await new Promise(r => setTimeout(r, waitMs))
      }
    }

    throw new Error(`Soroban RPC ${ctx.op} failed after ${maxAttempts} attempts`)
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
   *
   * Marked `protected` so that adapter-level tests can subclass and replace
   * the network-bound transaction submission while still exercising the real
   * `recordReceipt` argument-mapping and error-handling code paths.
   */
  protected async invokeTransaction(
    contractId: string,
    method: string,
    args: xdr.ScVal[],
    hooks?: TxBroadcastHooks,
  ): Promise<xdr.ScVal> {
    return tracer.startActiveSpan(`Soroban.invokeTransaction:${method}`, async (span: Span) => {
      span.setAttribute('soroban.contract_id', contractId)
      span.setAttribute('soroban.method', method)
      span.setAttribute('soroban.rpc_url', this.config.rpcUrl)

      let allocation: AllocationResult | null = null

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

        // Allocate sequence number using the sequence allocator
        const allocator = getStellarSequenceAllocator()
        
        // Extract allocationId from hooks if provided (for idempotent retries)
        const allocationId = (hooks as any)?.allocationId
        allocation = await allocator.allocateSequence(adminPublicKey, allocationId)

        // Build the transaction with the allocated sequence number
        const account = new Account(adminPublicKey, allocation.sequence.toString())
        const tx = new TransactionBuilder(
          account,
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

        // Persist intent: fire onTxBuilt with the signed tx hash BEFORE
        // calling sendTransaction so a crash between broadcast and result-recording
        // can be recovered by querying the chain for this known hash.
        if (hooks?.onTxBuilt) {
          const txHashHex = Buffer.from(tx.hash()).toString('hex')
          span.setAttribute('soroban.tx_hash_pre_broadcast', txHashHex)
          await hooks.onTxBuilt(txHashHex)
        }

        // Submit the transaction
        const response = await this.withBackoff(
          () => this.server.sendTransaction(tx),
          { op: 'sendTransaction' }
        )

        span.setAttribute('soroban.tx_hash', response.hash)

        if (response.status !== 'PENDING') {
          // Mark allocation as failed
          if (allocation) {
            await allocator.markFailed(allocation.allocationId)
          }

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
            // Mark allocation as failed
            if (allocation) {
              await allocator.markFailed(allocation.allocationId)
            }

            throw new TransactionError(
              'Transaction not confirmed within timeout',
              response.hash,
              method
            )
          }

          // Check if transaction was successful
          if (confirmedTx.status === 'SUCCESS') {
            // Mark allocation as confirmed
            if (allocation) {
              await allocator.markConfirmed(allocation.allocationId, response.hash)
            }

            span.setStatus({ code: SpanStatusCode.OK })
            // Return success - no specific return value for write operations
            return xdr.ScVal.scvVoid()
          } else {
            // Mark allocation as failed
            if (allocation) {
              await allocator.markFailed(allocation.allocationId)
            }

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
        // Mark allocation as failed on error
        if (allocation) {
          try {
            const allocator = getStellarSequenceAllocator()
            await allocator.markFailed(allocation.allocationId)
          } catch (markErr) {
            // Log but don't throw - the original error is more important
            logger.error('Failed to mark allocation as failed', {
              allocationId: allocation.allocationId,
              error: markErr instanceof Error ? markErr.message : String(markErr),
            })
          }
        }

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
    return tracer.startActiveSpan('Soroban.waitForTransaction', async (span: Span) => {
      span.setAttribute('soroban.tx_hash', txHash)
      span.setAttribute('soroban.poll.max_attempts', maxAttempts)
      span.setAttribute('soroban.poll.interval_ms', pollIntervalMs)

      try {
        for (let i = 0; i < maxAttempts; i++) {
          span.setAttribute('soroban.poll.attempt', i + 1)
          await new Promise(r => setTimeout(r, pollIntervalMs))

          try {
            const result = await this.withBackoff(
              () => this.server.getTransaction(txHash),
              { op: 'getTransaction' }
            )

            span.setAttribute('soroban.tx_status', result.status)

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
              span.setStatus({ code: SpanStatusCode.OK })
              return {
                status: result.status,
                result: returnValue,
              }
            } else if (result.status === 'FAILED') {
              span.setStatus({ code: SpanStatusCode.ERROR, message: 'Transaction FAILED' })
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

        span.setStatus({ code: SpanStatusCode.ERROR, message: 'Transaction confirmation timed out' })
        return null // Timeout
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

  async syncDealStatus(params: SyncDealStatusParams): Promise<void> {
    const contractId = this.config.dealEscrowId
    if (!contractId) {
      throw new ConfigurationError('SOROBAN_DEAL_ESCROW_ID not configured for deal status sync')
    }
    if (!this.config.adminSecret) {
      throw new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for deal status sync')
    }

    const methodMap = {
      active: 'activate_deal',
      completed: 'complete_deal',
      defaulted: 'default_deal',
    } as const

    const method = methodMap[params.newStatus]
    const adminAddress = Keypair.fromSecret(this.config.adminSecret).publicKey()
    const args: xdr.ScVal[] = [
      nativeToScVal(new Address(adminAddress)),
      nativeToScVal(params.contractDealId, { type: 'string' }),
    ]

    await this.adminSigningService.executeAdminOperation({
      contractId,
      operation: method,
      args,
      networkPassphrase: this.config.networkPassphrase,
      adminSecret: this.config.adminSecret,
      server: this.server,
    })

    logger.info('Deal status synced on-chain', {
      dealId: params.dealId,
      contractDealId: params.contractDealId,
      newStatus: params.newStatus,
      actor: params.actor,
    })
  }

  /**
   * Admin/operator operation: deal_escrow `request_rent_release`.
   * Nothing in the backend currently triggers this call — see PR description
   * for the out-of-scope note on wiring up the actual trigger.
   */
  async requestRentRelease(params: RequestRentReleaseParams): Promise<void> {
    const contractId = this.config.dealEscrowId
    if (!contractId) {
      throw new ConfigurationError('SOROBAN_DEAL_ESCROW_ID not configured for request_rent_release')
    }
    if (!this.config.adminSecret) {
      throw new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for request_rent_release')
    }
    const adminAddress = Keypair.fromSecret(this.config.adminSecret).publicKey()
    const args: xdr.ScVal[] = [
      nativeToScVal(new Address(adminAddress)),
      nativeToScVal(params.dealId, { type: 'string' }),
      nativeToScVal(new Address(params.to)),
      this.decimalToI128(params.amountUsdc),
      xdr.ScVal.scvSymbol(params.externalRefSource),
      nativeToScVal(params.externalRef, { type: 'string' }),
    ]
    await this.adminSigningService.executeAdminOperation({
      contractId,
      operation: 'request_rent_release',
      args,
      networkPassphrase: this.config.networkPassphrase,
      adminSecret: this.config.adminSecret,
      server: this.server,
    })
    logger.info('Rent release requested on-chain', { dealId: params.dealId, to: params.to })
  }

  /**
   * Admin operation: rent_to_own `register_deal`.
   * `contractDealId` is a hex-encoded BytesN<32> — see RegisterRentToOwnDealParams.
   */
  async registerRentToOwnDeal(params: RegisterRentToOwnDealParams): Promise<void> {
    const contractId = this.config.rentToOwnId
    if (!contractId) {
      throw new ConfigurationError('SOROBAN_RENT_TO_OWN_ID not configured for rent_to_own registration')
    }
    if (!this.config.adminSecret) {
      throw new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for rent_to_own registration')
    }

    const adminAddress = Keypair.fromSecret(this.config.adminSecret).publicKey()
    const args: xdr.ScVal[] = [
      nativeToScVal(new Address(adminAddress)),
      this.bytesToScVal(Buffer.from(params.contractDealId, 'hex')),
      nativeToScVal(new Address(params.tenantAddress)),
      this.decimalToI128(params.propertyValueUsdc),
      this.decimalToI128(params.monthlyEquityUsdc),
      nativeToScVal(params.totalPaymentsRequired, { type: 'u32' }),
    ]

    await this.adminSigningService.executeAdminOperation({
      contractId,
      operation: 'register_deal',
      args,
      networkPassphrase: this.config.networkPassphrase,
      adminSecret: this.config.adminSecret,
      server: this.server,
    })

    logger.info('rent_to_own deal registered on-chain', {
      dealId: params.dealId,
      contractDealId: params.contractDealId,
      totalPaymentsRequired: params.totalPaymentsRequired,
    })
  }

  /** Admin operation: rent_to_own `record_equity_payment`. */
  async recordRentToOwnEquityPayment(params: RecordRentToOwnEquityPaymentParams): Promise<void> {
    const contractId = this.config.rentToOwnId
    if (!contractId) {
      throw new ConfigurationError('SOROBAN_RENT_TO_OWN_ID not configured for rent_to_own equity payment')
    }
    if (!this.config.adminSecret) {
      throw new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for rent_to_own equity payment')
    }

    const adminAddress = Keypair.fromSecret(this.config.adminSecret).publicKey()
    const args: xdr.ScVal[] = [
      nativeToScVal(new Address(adminAddress)),
      this.bytesToScVal(Buffer.from(params.contractDealId, 'hex')),
      this.decimalToI128(params.rentAmountUsdc),
      this.decimalToI128(params.equityAmountUsdc),
    ]

    await this.adminSigningService.executeAdminOperation({
      contractId,
      operation: 'record_equity_payment',
      args,
      networkPassphrase: this.config.networkPassphrase,
      adminSecret: this.config.adminSecret,
      server: this.server,
    })

    logger.info('rent_to_own equity payment recorded on-chain', {
      dealId: params.dealId,
      contractDealId: params.contractDealId,
      period: params.period,
    })
  }

  /** Admin operation: rent_to_own `complete_deal`. */
  async completeRentToOwnDeal(params: RentToOwnDealActionParams): Promise<void> {
    await this.callRentToOwnDealAction('complete_deal', params)
  }

  /** Admin operation: rent_to_own `default_deal`. */
  async defaultRentToOwnDeal(params: RentToOwnDealActionParams): Promise<void> {
    await this.callRentToOwnDealAction('default_deal', params)
  }

  private async callRentToOwnDealAction(
    operation: 'complete_deal' | 'default_deal',
    params: RentToOwnDealActionParams,
  ): Promise<void> {
    const contractId = this.config.rentToOwnId
    if (!contractId) {
      throw new ConfigurationError(`SOROBAN_RENT_TO_OWN_ID not configured for rent_to_own ${operation}`)
    }
    if (!this.config.adminSecret) {
      throw new ConfigurationError(`SOROBAN_ADMIN_SECRET not configured for rent_to_own ${operation}`)
    }

    const adminAddress = Keypair.fromSecret(this.config.adminSecret).publicKey()
    const args: xdr.ScVal[] = [
      nativeToScVal(new Address(adminAddress)),
      this.bytesToScVal(Buffer.from(params.contractDealId, 'hex')),
    ]
    if (operation === 'default_deal') {
      args.push(xdr.ScVal.scvSymbol(toSorobanReasonSymbol(params.reason)))
    }

    await this.adminSigningService.executeAdminOperation({
      contractId,
      operation,
      args,
      networkPassphrase: this.config.networkPassphrase,
      adminSecret: this.config.adminSecret,
      server: this.server,
    })

    logger.info(`rent_to_own ${operation} synced on-chain`, {
      dealId: params.dealId,
      contractDealId: params.contractDealId,
    })
  }

  /**
   * Admin operation: deal_escrow `challenge_rent_release`.
   *
   * KNOWN LIMITATION (see PR description): the contract requires `caller` to
   * equal the deal's on-chain depositor or the pending release's recipient
   * (`caller.require_auth()` against that specific identity) — not the
   * platform admin. This passes the admin's own address as `caller`, which
   * only satisfies that check if the admin's address happens to equal the
   * depositor/recipient. Until request_rent_release/deposit are wired up with
   * real per-user identities (and per-user custodial signing via
   * CustodialWalletServiceImpl is threaded through here), this call fails
   * closed with NotAuthorized rather than silently misrepresenting who
   * challenged the release — it does not bypass tenant/landlord consent.
   */
  async challengeRentRelease(params: ChallengeRentReleaseParams): Promise<void> {
    const contractId = this.config.dealEscrowId
    if (!contractId) {
      throw new ConfigurationError('SOROBAN_DEAL_ESCROW_ID not configured for challenge_rent_release')
    }
    if (!this.config.adminSecret) {
      throw new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for challenge_rent_release')
    }
    const adminAddress = Keypair.fromSecret(this.config.adminSecret).publicKey()
    const args: xdr.ScVal[] = [
      nativeToScVal(new Address(adminAddress)),
      nativeToScVal(params.dealId, { type: 'string' }),
      nativeToScVal(params.challengeEvidenceRef, { type: 'string' }),
    ]
    await this.adminSigningService.executeAdminOperation({
      contractId,
      operation: 'challenge_rent_release',
      args,
      networkPassphrase: this.config.networkPassphrase,
      adminSecret: this.config.adminSecret,
      server: this.server,
    })
    logger.info('Rent release challenged on-chain', { dealId: params.dealId })
  }

  /**
   * Admin operation: deal_escrow `resolve_rent_dispute`.
   *
   * KNOWN LIMITATION (see PR description): the contract requires `caller` to
   * equal the contract's configured resolver (`get_resolver`), which may be a
   * different signer from the general admin key used elsewhere. This assumes
   * `set_resolver` has granted the admin's own address the resolver role at
   * deploy time; if a distinct resolver key is provisioned, this call fails
   * with NotAuthorized until that key is wired in here instead.
   */
  async resolveRentDispute(params: ResolveRentDisputeParams): Promise<void> {
    const contractId = this.config.dealEscrowId
    if (!contractId) {
      throw new ConfigurationError('SOROBAN_DEAL_ESCROW_ID not configured for resolve_rent_dispute')
    }
    if (!this.config.adminSecret) {
      throw new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for resolve_rent_dispute')
    }
    const adminAddress = Keypair.fromSecret(this.config.adminSecret).publicKey()
    const args: xdr.ScVal[] = [
      nativeToScVal(new Address(adminAddress)),
      nativeToScVal(params.dealId, { type: 'string' }),
      this.settlementOutcomeToScVal(params.outcome),
      nativeToScVal(params.resolutionEvidenceRef, { type: 'string' }),
    ]
    await this.adminSigningService.executeAdminOperation({
      contractId,
      operation: 'resolve_rent_dispute',
      args,
      networkPassphrase: this.config.networkPassphrase,
      adminSecret: this.config.adminSecret,
      server: this.server,
    })
    logger.info('Rent dispute resolved on-chain', { dealId: params.dealId, outcome: params.outcome })
  }

  /** Permissionless operation: deal_escrow `settle_rent_release_timeout(deal_id)` — no caller/admin arg in the contract signature. */
  async settleRentReleaseTimeout(params: SettleRentReleaseTimeoutParams): Promise<void> {
    const contractId = this.config.dealEscrowId
    if (!contractId) {
      throw new ConfigurationError('SOROBAN_DEAL_ESCROW_ID not configured for settle_rent_release_timeout')
    }
    if (!this.config.adminSecret) {
      throw new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for settle_rent_release_timeout')
    }
    const args: xdr.ScVal[] = [nativeToScVal(params.dealId, { type: 'string' })]
    await this.adminSigningService.executeAdminOperation({
      contractId,
      operation: 'settle_rent_release_timeout',
      args,
      networkPassphrase: this.config.networkPassphrase,
      adminSecret: this.config.adminSecret,
      server: this.server,
    })
    logger.info('Rent release timeout settled on-chain', { dealId: params.dealId })
  }

  /** Permissionless operation: deal_escrow `settle_dispute_timeout(deal_id)` — no caller/admin arg in the contract signature. */
  async settleDisputeTimeout(params: SettleDisputeTimeoutParams): Promise<void> {
    const contractId = this.config.dealEscrowId
    if (!contractId) {
      throw new ConfigurationError('SOROBAN_DEAL_ESCROW_ID not configured for settle_dispute_timeout')
    }
    if (!this.config.adminSecret) {
      throw new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for settle_dispute_timeout')
    }
    const args: xdr.ScVal[] = [nativeToScVal(params.dealId, { type: 'string' })]
    await this.adminSigningService.executeAdminOperation({
      contractId,
      operation: 'settle_dispute_timeout',
      args,
      networkPassphrase: this.config.networkPassphrase,
      adminSecret: this.config.adminSecret,
      server: this.server,
    })
    logger.info('Dispute timeout settled on-chain', { dealId: params.dealId })
  }

  /** Encodes deal_escrow's `SettlementOutcome` #[repr(u32)] enum discriminant (ReleaseToRecipient=1, RefundToDepositor=2). */
  private settlementOutcomeToScVal(outcome: RentDisputeOutcome): xdr.ScVal {
    const discriminant = outcome === 'release_to_recipient' ? 1 : 2
    return nativeToScVal(discriminant, { type: 'u32' })
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
    const hashBuffer = Buffer.from(hashBytes)

    const scArgs: xdr.ScVal[] = [
      nativeToScVal(this.config.adminSecret ? Keypair.fromSecret(this.config.adminSecret).publicKey() : '', { type: 'address' }),
      xdr.ScVal.scvBytes(hashBuffer)
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

  // Contract access role management methods

  async proposeAssignRole(subject: string, role: number): Promise<string> {
    const contractId = this.config.contractAccessId
    if (!contractId) {
      throw new ConfigurationError('SOROBAN_CONTRACT_ACCESS_ID not configured for role assignment')
    }
    if (!this.config.adminSecret) {
      throw new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for role assignment')
    }

    const adminAddress = Keypair.fromSecret(this.config.adminSecret).publicKey()
    const args: xdr.ScVal[] = [
      nativeToScVal(new Address(adminAddress)),
      nativeToScVal(new Address(subject)),
      nativeToScVal(role),
    ]

    const txHash = await this.adminSigningService.executeAdminOperation({
      contractId,
      operation: 'propose_assign_role',
      args,
      networkPassphrase: this.config.networkPassphrase,
      adminSecret: this.config.adminSecret,
      server: this.server,
    })

    logger.info('Role assignment proposed on-chain', { subject, role })
    return txHash
  }

  async confirmAssignRole(subject: string): Promise<string> {
    const contractId = this.config.contractAccessId
    if (!contractId) {
      throw new ConfigurationError('SOROBAN_CONTRACT_ACCESS_ID not configured for role confirmation')
    }
    if (!this.config.adminSecret) {
      throw new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for role confirmation')
    }

    const approverAddress = Keypair.fromSecret(this.config.adminSecret).publicKey()
    const args: xdr.ScVal[] = [
      nativeToScVal(new Address(approverAddress)),
      nativeToScVal(new Address(subject)),
    ]

    const txHash = await this.adminSigningService.executeAdminOperation({
      contractId,
      operation: 'confirm_assign_role',
      args,
      networkPassphrase: this.config.networkPassphrase,
      adminSecret: this.config.adminSecret,
      server: this.server,
    })

    logger.info('Role assignment confirmed on-chain', { subject })
    return txHash
  }

  async delegatePermission(delegatee: string, permission: number): Promise<string> {
    const contractId = this.config.contractAccessId
    if (!contractId) {
      throw new ConfigurationError('SOROBAN_CONTRACT_ACCESS_ID not configured for permission delegation')
    }
    if (!this.config.adminSecret) {
      throw new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for permission delegation')
    }

    const delegatorAddress = Keypair.fromSecret(this.config.adminSecret).publicKey()
    const args: xdr.ScVal[] = [
      nativeToScVal(new Address(delegatorAddress)),
      nativeToScVal(new Address(delegatee)),
      nativeToScVal(permission),
    ]

    const txHash = await this.adminSigningService.executeAdminOperation({
      contractId,
      operation: 'delegate_permission',
      args,
      networkPassphrase: this.config.networkPassphrase,
      adminSecret: this.config.adminSecret,
      server: this.server,
    })

    logger.info('Permission delegated on-chain', { delegatee, permission })
    return txHash
  }

  async getRole(address: string): Promise<number | null> {
    const contractId = this.config.contractAccessId
    if (!contractId) {
      throw new ConfigurationError('SOROBAN_CONTRACT_ACCESS_ID not configured for role query')
    }

    try {
      const result = await this.invokeReadOnly(
        contractId,
        'get_role',
        [nativeToScVal(new Address(address))]
      )
      const role = scValToNative(result)
      return role !== null ? Number(role) : null
    } catch (err: any) {
      if (err instanceof SorobanError) throw err
      throw new ContractError(
        `Failed to get role for ${address}`,
        contractId,
        'get_role',
        err
      )
    }
  }

  async hasPermission(address: string, permission: number): Promise<boolean> {
    const contractId = this.config.contractAccessId
    if (!contractId) {
      throw new ConfigurationError('SOROBAN_CONTRACT_ACCESS_ID not configured for permission query')
    }

    try {
      const result = await this.invokeReadOnly(
        contractId,
        'has_permission',
        [nativeToScVal(new Address(address)), nativeToScVal(permission)]
      )
      return Boolean(scValToNative(result))
    } catch (err: any) {
      if (err instanceof SorobanError) throw err
      throw new ContractError(
        `Failed to check permission for ${address}`,
        contractId,
        'has_permission',
        err
      )
    }
  }

  async listRoles(): Promise<Array<{ address: string; role: number }>> {
    const contractId = this.config.contractAccessId
    if (!contractId) {
      throw new ConfigurationError('SOROBAN_CONTRACT_ACCESS_ID not configured for role listing')
    }

    try {
      const result = await this.invokeReadOnly(contractId, 'list_roles', [])
      const roles = scValToNative(result) as Array<{ address: string; role: number }>
      return roles.map(({ address, role }) => ({
        address: address.toString(),
        role: Number(role),
      }))
    } catch (err: any) {
      if (err instanceof SorobanError) throw err
      throw new ContractError(
        'Failed to list roles',
        contractId,
        'list_roles',
        err
      )
    }
  }

  // Upgradeable proxy governance methods

  /**
   * Add an address to the allowlist registry.
   * Requires admin authentication via admin signing service.
   */
  async addToAllowlist(address: string, label: string, expiresAt?: number): Promise<string> {
    return tracer.startActiveSpan('RealSorobanAdapter.addToAllowlist', async (span) => {
      span.setAttribute('soroban.address', address)
      span.setAttribute('soroban.label', label)
      span.setAttribute('soroban.expires_at', expiresAt ?? 0)

      if (!this.config.allowlistRegistryId) {
        const err = new ConfigurationError('SOROBAN_ALLOWLIST_REGISTRY_ID not configured for addToAllowlist')
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
        span.recordException(err)
        span.end()
        throw err
      }

      if (!this.config.adminSecret) {
        const err = new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for addToAllowlist')
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
        span.recordException(err)
        span.end()
        throw err
      }

      try {
        const args = [
          nativeToScVal(new Address(address)),
          nativeToScVal(label),
          nativeToScVal(expiresAt ?? 0, { type: 'u64' }),
        ]

        await this.invokeTransaction(
          this.config.allowlistRegistryId,
          'add',
          args,
        )

        logger.info('Address added to allowlist', { address, label, expiresAt })
        span.setStatus({ code: SpanStatusCode.OK })
        return `allowlist_add_${address}`
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) })
        if (err instanceof Error) span.recordException(err)
        if (err instanceof SorobanError) throw err
        throw new ContractError(
          `Failed to add address ${address} to allowlist`,
          this.config.allowlistRegistryId,
          'add',
          err
        )
      } finally {
        span.end()
      }
    })
  }

  /**
   * Remove an address from the allowlist registry.
   * Requires admin authentication via admin signing service.
   */
  async removeFromAllowlist(address: string): Promise<string> {
    return tracer.startActiveSpan('RealSorobanAdapter.removeFromAllowlist', async (span) => {
      span.setAttribute('soroban.address', address)

      if (!this.config.allowlistRegistryId) {
        const err = new ConfigurationError('SOROBAN_ALLOWLIST_REGISTRY_ID not configured for removeFromAllowlist')
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
        span.recordException(err)
        span.end()
        throw err
      }

      if (!this.config.adminSecret) {
        const err = new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for removeFromAllowlist')
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
        span.recordException(err)
        span.end()
        throw err
      }

      try {
        const args = [nativeToScVal(new Address(address))]

        await this.invokeTransaction(
          this.config.allowlistRegistryId,
          'remove',
          args,
        )

        logger.info('Address removed from allowlist', { address })
        span.setStatus({ code: SpanStatusCode.OK })
        return `allowlist_remove_${address}`
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) })
        if (err instanceof Error) span.recordException(err)
        if (err instanceof SorobanError) throw err
        throw new ContractError(
          `Failed to remove address ${address} from allowlist`,
          this.config.allowlistRegistryId,
          'remove',
          err
        )
      } finally {
        span.end()
      }
    })
  }

  /**
   * Check if an address is on the allowlist.
   * Read-only query, no authentication required.
   */
  async isAllowlisted(address: string): Promise<boolean> {
    return tracer.startActiveSpan('RealSorobanAdapter.isAllowlisted', async (span) => {
      span.setAttribute('soroban.address', address)

      if (!this.config.allowlistRegistryId) {
        span.setStatus({ code: SpanStatusCode.OK })
        return false // Not configured means no allowlist check
      }

      try {
        const result = await this.invokeReadOnly(
          this.config.allowlistRegistryId,
          'is_member',
          [nativeToScVal(new Address(address))]
        )

        const isMember = scValToNative(result) as boolean
        span.setAttribute('soroban.is_member', isMember)
        span.setStatus({ code: SpanStatusCode.OK })
        return isMember
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) })
        if (err instanceof Error) span.recordException(err)
        if (err instanceof SorobanError) throw err
        throw new ContractError(
          `Failed to check allowlist status for ${address}`,
          this.config.allowlistRegistryId,
          'is_member',
          err
        )
      } finally {
        span.end()
      }
    })
  }

  /**
   * Get the allowlist entry for an address.
   * Read-only query, no authentication required.
   */
  async getAllowlistEntry(address: string): Promise<import('./adapter.js').AllowlistEntry | null> {
    return tracer.startActiveSpan('RealSorobanAdapter.getAllowlistEntry', async (span) => {
      span.setAttribute('soroban.address', address)

      if (!this.config.allowlistRegistryId) {
        span.setStatus({ code: SpanStatusCode.OK })
        return null
      }

      try {
        const result = await this.invokeReadOnly(
          this.config.allowlistRegistryId,
          'get_entry',
          [nativeToScVal(new Address(address))]
        )

        if (!result) {
          span.setStatus({ code: SpanStatusCode.OK })
          return null
        }

        const entry = scValToNative(result) as any
        const normalized: import('./adapter.js').AllowlistEntry = {
          label: typeof entry?.label === 'string' ? entry.label : '',
          expires_at: typeof entry?.expires_at === 'number' ? entry.expires_at : 0,
          added_at: typeof entry?.added_at === 'number' ? entry.added_at : 0,
        }

        span.setStatus({ code: SpanStatusCode.OK })
        return normalized
      } catch (err) {
        // EntryNotFound is expected if address is not on allowlist
        if (err instanceof ContractError && err.message.includes('EntryNotFound')) {
          span.setStatus({ code: SpanStatusCode.OK })
          return null
        }

        span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) })
        if (err instanceof Error) span.recordException(err)
        if (err instanceof SorobanError) throw err
        throw new ContractError(
          `Failed to get allowlist entry for ${address}`,
          this.config.allowlistRegistryId,
          'get_entry',
          err
        )
      } finally {
        span.end()
      }
    })
  }

  // ── epoch_rewards contract methods ────────────────────────────────────────

  // ── rent_wallet contract ─────────────────────────────────────────────────────

  async rentWalletCredit(account: string, amount: bigint): Promise<string> {
    if (!this.config.rentWalletId) {
      throw new ConfigurationError('SOROBAN_RENT_WALLET_ID not configured')
    }
    if (!this.config.adminSecret) {
      throw new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for rent_wallet credit')
    }

    const contractId = this.config.rentWalletId
    const adminKeypair = Keypair.fromSecret(this.config.adminSecret)
    const adminAddress = adminKeypair.publicKey()

    return tracer.startActiveSpan('soroban.rent_wallet_credit', async (span) => {
      span.setAttributes({
        'soroban.contract_id': contractId,
        'soroban.account': account,
        'soroban.amount': amount.toString(),
      })

      try {
        const txHash = await this.adminSigningService.executeAdminOperation({
          contractId,
          operation: 'rent_wallet_credit',
          args: [
            nativeToScVal(new Address(adminAddress)),
            nativeToScVal(new Address(account)),
            nativeToScVal(amount, { type: 'i128' }),
          ],
          networkPassphrase: this.config.networkPassphrase,
          adminSecret: adminKeypair.secret(),
          server: this.server,
        })

        span.setAttributes({ 'soroban.tx_hash': txHash })
        logger.info('Rent wallet credit submitted', {
          account,
          amount: amount.toString(),
          txHash,
        })

        return txHash
      } catch (err) {
        span.recordException(err as Error)
        if (err instanceof SorobanError) throw err
        throw new ContractError(
          `Failed to credit rent wallet for ${account}`,
          contractId,
          'rent_wallet_credit',
          err
        )
      } finally {
        span.end()
      }
    })
  }

  async rentWalletDebit(account: string, amount: bigint): Promise<string> {
    if (!this.config.rentWalletId) {
      throw new ConfigurationError('SOROBAN_RENT_WALLET_ID not configured')
    }
    if (!this.config.adminSecret) {
      throw new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for rent_wallet debit')
    }

    const contractId = this.config.rentWalletId
    const adminKeypair = Keypair.fromSecret(this.config.adminSecret)
    const adminAddress = adminKeypair.publicKey()

    return tracer.startActiveSpan('soroban.rent_wallet_debit', async (span) => {
      span.setAttributes({
        'soroban.contract_id': contractId,
        'soroban.account': account,
        'soroban.amount': amount.toString(),
      })

      try {
        const txHash = await this.adminSigningService.executeAdminOperation({
          contractId,
          operation: 'rent_wallet_debit',
          args: [
            nativeToScVal(new Address(adminAddress)),
            nativeToScVal(new Address(account)),
            nativeToScVal(amount, { type: 'i128' }),
          ],
          networkPassphrase: this.config.networkPassphrase,
          adminSecret: adminKeypair.secret(),
          server: this.server,
        })

        span.setAttributes({ 'soroban.tx_hash': txHash })
        logger.info('Rent wallet debit submitted', {
          account,
          amount: amount.toString(),
          txHash,
        })

        return txHash
      } catch (err) {
        span.recordException(err as Error)
        if (err instanceof SorobanError) throw err
        throw new ContractError(
          `Failed to debit rent wallet for ${account}`,
          contractId,
          'rent_wallet_debit',
          err
        )
      } finally {
        span.end()
      }
    })
  }

  async rentWalletBalance(account: string): Promise<bigint> {
    if (!this.config.rentWalletId) {
      throw new ConfigurationError('SOROBAN_RENT_WALLET_ID not configured')
    }

    const contractId = this.config.rentWalletId

    return tracer.startActiveSpan('soroban.rent_wallet_balance', async (span) => {
      span.setAttributes({
        'soroban.contract_id': contractId,
        'soroban.account': account,
      })

      try {
        const result = await this.invokeReadOnly(contractId, 'balance', [
          nativeToScVal(new Address(account)),
        ])

        const balance = scValToNative(result) as bigint
        span.setAttributes({ 'soroban.balance': balance.toString() })

        return balance
      } catch (err) {
        span.recordException(err as Error)
        if (err instanceof SorobanError) throw err
        throw new ContractError(
          `Failed to query rent wallet balance for ${account}`,
          contractId,
          'balance',
          err
        )
      } finally {
        span.end()
      }
    })
  }

  // ── slashing_module contract methods ─────────────────────────────────────

  // ── bond_collateral contract methods ──────────────────────────────────────

  // ── whistleblower_rewards contract ───────────────────────────────────────────
  
  private getWhistleblowerRewardsId(): string {
    if (!this.config.whistleblowerRewardsId) {
      throw new ConfigurationError('SOROBAN_WHISTLEBLOWER_REWARDS_ID not configured')
    }
    return this.config.whistleblowerRewardsId
  }

  async allocateReward(whistleblower: string, amount: bigint): Promise<string> {
    const contractId = this.getWhistleblowerRewardsId()
    if (!this.config.adminSecret) {
      throw new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for reward allocation')
    }

    const args = [
      nativeToScVal(new Address(whistleblower)),
      nativeToScVal(amount),
    ]

    return this.adminSigningService.executeAdminOperation({
      contractId,
      operation: 'allocate',
      args,
      networkPassphrase: this.config.networkPassphrase,
      adminSecret: this.config.adminSecret,
      server: this.server,
    })
  }

  async claimReward(whistleblower: string): Promise<bigint> {
    this.getWhistleblowerRewardsId()
    // claim() requires the whistleblower's own signature, which the admin key cannot provide.
    throw new ConfigurationError(
      `Whistleblower reward claims for ${whistleblower} must be signed by the whistleblower's wallet`,
    )
  }

  async getClaimableReward(whistleblower: string): Promise<bigint> {
    const contractId = this.getWhistleblowerRewardsId()
    try {
      const result = await this.invokeReadOnly(contractId, 'claimable', [
        nativeToScVal(new Address(whistleblower)),
      ])
      return BigInt(scValToNative(result) as number)
    } catch (err) {
      if (err instanceof SorobanError) throw err
      throw new ContractError(
        `Failed to get claimable reward for ${whistleblower}`,
        contractId,
        'claimable',
        err,
      )
    }
  }

  // ── vesting_schedule contract ───────────────────────────────────────────────

  // ── user-signed calls (shared by epoch_rewards and multisig_admin) ───────────

  /**
   * Build an unsigned, simulated transaction for `signer` to sign: one call to
   * `functionName` on `contractId`. Soroban sets the fee and footprint.
   */
  private async prepareUserInvocation(
    contractId: string,
    signer: string,
    functionName: string,
    args: xdr.ScVal[],
  ): Promise<string> {
    let account: Account
    try {
      account = await this.server.getAccount(signer)
    } catch (err) {
      throw new ContractError(`Could not load account ${signer}`, contractId, functionName, err)
    }

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(buildInvokeOperation(contractId, functionName, args))
      .setTimeout(300)
      .build()

    try {
      const prepared = await this.server.prepareTransaction(tx)
      return prepared.toXDR()
    } catch (err) {
      throw new ContractError(
        `Failed to prepare ${functionName} for ${signer}`,
        contractId,
        functionName,
        err,
      )
    }
  }

  /** Broadcast a transaction that `assertSignedInvocation` has already accepted. */
  private async broadcastSigned(
    tx: Parameters<rpc.Server['sendTransaction']>[0],
    functionName: string,
  ): Promise<string> {
    const response = await this.withBackoff(() => this.server.sendTransaction(tx), {
      op: 'sendTransaction',
    })
    if (response.status !== 'PENDING') {
      throw new TransactionError(
        `${functionName} rejected with status ${response.status}`,
        response.hash,
        functionName,
      )
    }
    return response.hash
  }

  // ── epoch_rewards contract (#1965) ──────────────────────────────────────────

  // ── stake_delegation contract (#1885) ────────────────────────────────────────

  // ── multisig_admin contract (#1972) ─────────────────────────────────────────

  multisigTargetFor(contract: 'dealEscrow' | 'contractAccess'): string | undefined {
    return contract === 'dealEscrow' ? this.config.dealEscrowId : this.config.contractAccessId
  }

  multisigEnabled(): boolean {
    return !!this.config.multisigAdminId
  }

  multisigContractId(): string | undefined {
    return this.config.multisigAdminId
  }

  private getMultisigId(): string {
    if (!this.config.multisigAdminId) {
      throw new ConfigurationError('MULTISIG_ADMIN_ID not configured')
    }
    return this.config.multisigAdminId
  }

  async multisigGetConfig(): Promise<MultisigConfig> {
    const contractId = this.getMultisigId()
    try {
      const [signers, threshold] = await Promise.all([
        this.invokeReadOnly(contractId, 'get_signers', []),
        this.invokeReadOnly(contractId, 'get_threshold', []),
      ])
      return {
        signers: (scValToNative(signers) as unknown[]).map(String),
        threshold: Number(scValToNative(threshold)),
      }
    } catch (err) {
      if (err instanceof SorobanError) throw err
      throw new ContractError('Failed to read multisig config', contractId, 'get_signers', err)
    }
  }

  private static readonly MULTISIG_STATUS: Record<number, MultisigProposalStatus> = {
    1: 'pending',
    2: 'executed',
    3: 'cancelled',
    4: 'expired',
  }

  private static readonly MULTISIG_STATUS_CODE: Record<MultisigProposalStatus, number> = {
    pending: 1,
    executed: 2,
    cancelled: 3,
    expired: 4,
  }

  private decodeMultisigProposal(result: xdr.ScVal): MultisigProposal | null {
    const native = scValToNative(result) as Record<string, unknown> | null | undefined
    if (!native) return null
    const rawArgs = (native.args ?? []) as unknown[]
    const status = RealSorobanAdapter.MULTISIG_STATUS[Number(native.status)]
    return {
      id: Number(native.id),
      proposer: String(native.proposer),
      target: String(native.target),
      function: String(native.function),
      // Arguments were already decoded by scValToNative; make them JSON-safe.
      args: decodeProposalArgs(rawArgs.map((arg) => nativeToScVal(arg as never))),
      approvals: ((native.approvals ?? []) as unknown[]).map(String),
      status: status ?? 'pending',
      createdAt: Number(native.created_at),
      expiresAt: Number(native.expires_at),
    }
  }

  async multisigGetProposal(proposalId: number): Promise<MultisigProposal | null> {
    const contractId = this.getMultisigId()
    try {
      const result = await this.invokeReadOnly(contractId, 'get_proposal', [
        nativeToScVal(BigInt(proposalId), { type: 'u64' }),
      ])
      return this.decodeMultisigProposal(result)
    } catch (err) {
      if (err instanceof SorobanError) throw err
      // get_proposal fails with ProposalNotFound for an unknown id.
      logger.debug('multisig get_proposal failed', { proposalId, error: String(err) })
      return null
    }
  }

  async multisigListProposals(status?: MultisigProposalStatus): Promise<MultisigProposal[]> {
    const contractId = this.getMultisigId()
    try {
      // Option<ProposalStatus>: a C-style enum is a u32 on the wire, and `Some(x)` is just `x`.
      const filter = status
        ? xdr.ScVal.scvU32(RealSorobanAdapter.MULTISIG_STATUS_CODE[status])
        : xdr.ScVal.scvVoid()
      const ids = scValToNative(await this.invokeReadOnly(contractId, 'list_proposals', [filter])) as unknown[]
      const proposals = await Promise.all(ids.map((id) => this.multisigGetProposal(Number(id))))
      return proposals.filter((p): p is MultisigProposal => p !== null)
    } catch (err) {
      if (err instanceof SorobanError) throw err
      throw new ContractError('Failed to list multisig proposals', contractId, 'list_proposals', err)
    }
  }

  async multisigPropose(
    target: string,
    functionName: string,
    args: MultisigArg[],
  ): Promise<{ txHash: string; proposalId?: number }> {
    const contractId = this.getMultisigId()
    if (!this.config.adminSecret) {
      throw new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for multisig proposals')
    }
    const adminAddress = Keypair.fromSecret(this.config.adminSecret).publicKey()
    const argVec = xdr.ScVal.scvVec(args.map(encodeMultisigArg))

    const txHash = await this.adminSigningService.executeAdminOperation({
      contractId,
      operation: 'propose',
      args: [
        nativeToScVal(new Address(adminAddress)),
        nativeToScVal(new Address(target)),
        nativeToScVal(functionName, { type: 'symbol' }),
        argVec,
      ],
      networkPassphrase: this.config.networkPassphrase,
      adminSecret: this.config.adminSecret,
      server: this.server,
    })

    // The call returns only a hash; the new proposal is the highest id.
    let proposalId: number | undefined
    try {
      const all = await this.multisigListProposals()
      proposalId = all.reduce<number | undefined>((max, p) => (max === undefined || p.id > max ? p.id : max), undefined)
    } catch {
      proposalId = undefined
    }
    logger.info('Multisig proposal filed', { target, functionName, proposalId, txHash })
    return { txHash, proposalId }
  }

  /** Arguments of a user-signed multisig call. */
  private multisigCallArgs(call: MultisigCall, params: MultisigCallParams): xdr.ScVal[] {
    const contractId = this.getMultisigId()
    const signer = nativeToScVal(new Address(params.signer))
    if (call === 'propose') {
      if (!params.target || !params.functionName) {
        throw new ContractError('propose needs a target and function', contractId, call)
      }
      return [
        signer,
        nativeToScVal(new Address(params.target)),
        nativeToScVal(params.functionName, { type: 'symbol' }),
        xdr.ScVal.scvVec((params.args ?? []).map(encodeMultisigArg)),
      ]
    }
    if (params.proposalId === undefined) {
      throw new ContractError(`${call} needs a proposal id`, contractId, call)
    }
    return [signer, nativeToScVal(BigInt(params.proposalId), { type: 'u64' })]
  }

  async prepareMultisigCall(call: MultisigCall, params: MultisigCallParams): Promise<string> {
    return this.prepareUserInvocation(
      this.getMultisigId(),
      params.signer,
      call,
      this.multisigCallArgs(call, params),
    )
  }

  async submitMultisigCall(
    signedXdr: string,
    call: MultisigCall,
    params: MultisigCallParams,
  ): Promise<string> {
    const tx = assertSignedInvocation(signedXdr, {
      contractId: this.getMultisigId(),
      functionName: call,
      args: this.multisigCallArgs(call, params),
      signer: params.signer,
      networkPassphrase: this.config.networkPassphrase,
      label: `multisig ${call}`,
    })
    const txHash = await this.broadcastSigned(tx, call)
    logger.info('Multisig call submitted', { call, signer: params.signer, txHash })
    return txHash
  }

  // ── rent_payments contract ──────────────────────────────────────────────────
  
  private getRentPaymentsId(): string {
    if (!this.config.rentPaymentsId) {
      throw new ConfigurationError('SOROBAN_RENT_PAYMENTS_ID not configured')
    }
    return this.config.rentPaymentsId
  }

  async createRentPaymentReceipt(
    dealId: string,
    amount: bigint,
    payer: string,
    recipient: string,
    timestamp: number
  ): Promise<string> {
    const contractId = this.getRentPaymentsId()
    if (!this.config.adminSecret) {
      throw new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for rent payment receipt creation')
    }

    const adminAddress = Keypair.fromSecret(this.config.adminSecret).publicKey()

    const args = [
      nativeToScVal(dealId),
      nativeToScVal(amount),
      nativeToScVal(new Address(payer)),
      nativeToScVal(new Address(recipient)),
      nativeToScVal(timestamp),
    ]

    return this.adminSigningService.executeAdminOperation({
      contractId,
      operation: 'create_receipt',
      args,
      networkPassphrase: this.config.networkPassphrase,
      adminSecret: this.config.adminSecret,
      server: this.server,
    })
  }

  async listRentPaymentReceiptsByDeal(dealId: string, limit: number): Promise<any[]> {
    const contractId = this.getRentPaymentsId()
    try {
      const result = await this.invokeReadOnly(contractId, 'list_receipts_by_deal', [
        nativeToScVal(dealId),
        nativeToScVal(limit),
      ])
      return scValToNative(result) as any[]
    } catch (err) {
      if (err instanceof SorobanError) throw err
      throw new ContractError(
        `Failed to list rent payment receipts for deal ${dealId}`,
        contractId,
        'list_receipts_by_deal',
        err,
      )
    }
  }

  async rentPaymentReceiptCount(dealId: string): Promise<number> {
    const contractId = this.getRentPaymentsId()
    try {
      const result = await this.invokeReadOnly(contractId, 'receipt_count', [
        nativeToScVal(dealId),
      ])
      return Number(scValToNative(result))
    } catch (err) {
      if (err instanceof SorobanError) throw err
      throw new ContractError(
        `Failed to get rent payment receipt count for deal ${dealId}`,
        contractId,
        'receipt_count',
        err,
      )
    }
  }

  // ── deal_escrow circuit-breaker ─────────────────────────────────────────────
  
  async freeze(): Promise<string> {
    const contractId = this.config.dealEscrowId
    if (!contractId) {
      throw new ConfigurationError('SOROBAN_DEAL_ESCROW_ID not configured')
    }
    if (!this.config.adminSecret) {
      throw new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for circuit-breaker operations')
    }

    const adminAddress = Keypair.fromSecret(this.config.adminSecret).publicKey()

    return this.adminSigningService.executeAdminOperation({
      contractId,
      operation: 'freeze',
      args: [],
      networkPassphrase: this.config.networkPassphrase,
      adminSecret: this.config.adminSecret,
      server: this.server,
    })
  }

  async isFrozen(): Promise<boolean> {
    const contractId = this.config.dealEscrowId
    if (!contractId) {
      throw new ConfigurationError('SOROBAN_DEAL_ESCROW_ID not configured')
    }
    try {
      const result = await this.invokeReadOnly(contractId, 'is_frozen', [])
      return scValToNative(result) as boolean
    } catch (err) {
      if (err instanceof SorobanError) throw err
      throw new ContractError(
        'Failed to check frozen status',
        contractId,
        'is_frozen',
        err,
      )
    }
  }

  async proposeDrain(destination: string): Promise<string> {
    const contractId = this.config.dealEscrowId
    if (!contractId) {
      throw new ConfigurationError('SOROBAN_DEAL_ESCROW_ID not configured')
    }
    if (!this.config.adminSecret) {
      throw new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for circuit-breaker operations')
    }

    const adminAddress = Keypair.fromSecret(this.config.adminSecret).publicKey()

    return this.adminSigningService.executeAdminOperation({
      contractId,
      operation: 'propose_drain',
      args: [nativeToScVal(new Address(destination))],
      networkPassphrase: this.config.networkPassphrase,
      adminSecret: this.config.adminSecret,
      server: this.server,
    })
  }

  async executeDrain(): Promise<string> {
    const contractId = this.config.dealEscrowId
    if (!contractId) {
      throw new ConfigurationError('SOROBAN_DEAL_ESCROW_ID not configured')
    }
    if (!this.config.adminSecret) {
      throw new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for circuit-breaker operations')
    }

    const adminAddress = Keypair.fromSecret(this.config.adminSecret).publicKey()

    return this.adminSigningService.executeAdminOperation({
      contractId,
      operation: 'execute_drain',
      args: [],
      networkPassphrase: this.config.networkPassphrase,
      adminSecret: this.config.adminSecret,
      server: this.server,
    })
  }

  async setRecoveryDelay(delaySeconds: number): Promise<string> {
    const contractId = this.config.dealEscrowId
    if (!contractId) {
      throw new ConfigurationError('SOROBAN_DEAL_ESCROW_ID not configured')
    }
    if (!this.config.adminSecret) {
      throw new ConfigurationError('SOROBAN_ADMIN_SECRET not configured for circuit-breaker operations')
    }

    const adminAddress = Keypair.fromSecret(this.config.adminSecret).publicKey()

    return this.adminSigningService.executeAdminOperation({
      contractId,
      operation: 'set_recovery_delay',
      args: [nativeToScVal(delaySeconds)],
      networkPassphrase: this.config.networkPassphrase,
      adminSecret: this.config.adminSecret,
      server: this.server,
    })
  }

  async getCircuitBreakerState(): Promise<{ frozen: boolean; drainProposed: boolean; drainDestination?: string; recoveryDelay: number }> {
    const contractId = this.config.dealEscrowId
    if (!contractId) {
      throw new ConfigurationError('SOROBAN_DEAL_ESCROW_ID not configured')
    }
    try {
      const result = await this.invokeReadOnly(contractId, 'get_circuit_breaker_state', [])
      const native = scValToNative(result)
      return {
        frozen: native?.frozen ?? false,
        drainProposed: native?.drain_proposed ?? false,
        drainDestination: native?.drain_destination,
        recoveryDelay: Number(native?.recovery_delay ?? 0),
      }
    } catch (err) {
      if (err instanceof SorobanError) throw err
      throw new ContractError(
        'Failed to get circuit breaker state',
        contractId,
        'get_circuit_breaker_state',
        err,
      )
    }
  }
}

