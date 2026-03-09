import { outboxStore, TxType } from '../outbox/index.js'
import { SorobanAdapter } from '../soroban/adapter.js'
import { OutboxSender } from '../outbox/index.js'
import { conversionStore } from '../models/conversionStore.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { logger } from '../utils/logger.js'

export class StakingService {
  private sender: OutboxSender

  constructor(private adapter: SorobanAdapter) {
    this.sender = new OutboxSender(adapter)
  }

  /**
   * Finalizes staking using the canonical USDC amount produced by a conversion.
   * - If conversion not completed -> throws 409
   * - Idempotent by conversionId
   */
  async finalizeStaking(conversionId: string) {
    const conversion = await conversionStore.getByConversionId(conversionId)
    if (!conversion) {
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'Conversion not found')
    }
    if (conversion.status !== 'completed') {
      throw new AppError(ErrorCode.CONFLICT, 409, 'Conversion not completed')
    }

    // Create outbox item idempotent by conversionId
    const outboxItem = await outboxStore.create({
      txType: TxType.STAKE,
      source: 'conversion',
      ref: conversion.conversionId,
      payload: {
        txType: TxType.STAKE,
        amountUsdc: conversion.amountUsdc,

        // Include FX metadata so receipt is deterministic.
        amountNgn: conversion.amountNgn,
        fxRateNgnPerUsdc: conversion.fxRateNgnPerUsdc,
        fxProvider: conversion.provider,

        conversionId: conversion.conversionId,
        depositId: conversion.depositId,
        conversionProviderRef: conversion.providerRef,
        userId: conversion.userId,
      },
    })

    const sent = await this.sender.send(outboxItem)

    const updatedItem = await outboxStore.getById(outboxItem.id)
    if (!updatedItem) {
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        500,
        'Failed to retrieve outbox item after send attempt',
      )
    }

    return {
      sent,
      outboxId: updatedItem.id,
      txId: updatedItem.txId,
      status: updatedItem.status,
    }
  }
}
