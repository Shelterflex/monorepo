import { logger } from '../utils/logger.js'
import { conversionStore } from '../models/conversionStore.js'
import { type ConversionRecord } from '../models/conversion.js'
import { type ConversionProvider } from './conversionProvider.js'

export class ConversionService {
  constructor(
    private provider: ConversionProvider,
    private fxProviderName: 'onramp' | 'offramp' | 'manual_admin',
  ) {}

  /**
   * Execute conversion once per deposit.
   * Idempotent: if already completed, returns existing completed conversion.
   */
  async convertDeposit(params: {
    depositId: string
    userId: string
    amountNgn: number
  }): Promise<ConversionRecord> {
    const existing = await conversionStore.getByDepositId(params.depositId)
    if (existing?.status === 'completed') {
      return existing
    }

    const pending = await conversionStore.createPending({
      depositId: params.depositId,
      userId: params.userId,
      amountNgn: params.amountNgn,
      provider: this.fxProviderName,
    })

    if (pending.status === 'completed') {
      return pending
    }

    try {
      const result = await this.provider.convertNgnToUsdc({
        amountNgn: params.amountNgn,
        userId: params.userId,
        depositId: params.depositId,
      })

      const completed = await conversionStore.markCompleted(pending.conversionId, {
        amountUsdc: result.amountUsdc,
        fxRateNgnPerUsdc: result.fxRateNgnPerUsdc,
        providerRef: result.providerRef,
      })

      if (!completed) {
        throw new Error('Failed to mark conversion completed')
      }

      return completed
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.error('Conversion failed', {
        depositId: params.depositId,
        error: msg,
      })
      await conversionStore.markFailed(pending.conversionId, msg)
      throw e
    }
  }

  /**
   * Execute conversion for staking operation.
   * Uses synthetic depositId format: stake:{externalRefSource}:{externalRef}
   * Idempotent: if already completed, returns existing completed conversion.
   */
  async convertForStaking(params: {
    externalRefSource: string
    externalRef: string
    userId: string
    amountNgn: number
  }): Promise<ConversionRecord> {
    // Use synthetic depositId for staking conversions
    const syntheticDepositId = `stake:${params.externalRefSource}:${params.externalRef}`
    
    const existing = await conversionStore.getByDepositId(syntheticDepositId)
    if (existing?.status === 'completed') {
      return existing
    }

    const pending = await conversionStore.createPending({
      depositId: syntheticDepositId,
      userId: params.userId,
      amountNgn: params.amountNgn,
      provider: this.fxProviderName,
    })

    if (pending.status === 'completed') {
      return pending
    }

    try {
      const result = await this.provider.convertNgnToUsdc({
        amountNgn: params.amountNgn,
        userId: params.userId,
        depositId: syntheticDepositId,
      })

      const completed = await conversionStore.markCompleted(pending.conversionId, {
        amountUsdc: result.amountUsdc,
        fxRateNgnPerUsdc: result.fxRateNgnPerUsdc,
        providerRef: result.providerRef,
      })

      if (!completed) {
        throw new Error('Failed to mark conversion completed')
      }

      return completed
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.error('Staking conversion failed', {
        syntheticDepositId,
        externalRefSource: params.externalRefSource,
        externalRef: params.externalRef,
        error: msg,
      })
      await conversionStore.markFailed(pending.conversionId, msg)
      throw e
    }
  }
}
