import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { StakingService } from './stakingService.js'
import { conversionStore } from '../models/conversionStore.js'
import { outboxStore, TxType, initOutboxStore, InMemoryOutboxStore } from '../outbox/index.js'
import { OutboxStatus } from '../outbox/types.js'
import { SorobanAdapter } from '../soroban/adapter.js'
import { ErrorCode } from '../errors/errorCodes.js'

describe('StakingService - finalizeStaking', () => {
  let stakingService: StakingService
  let adapter: SorobanAdapter

  beforeEach(async () => {
    initOutboxStore(new InMemoryOutboxStore())
    await conversionStore.clear()
    await outboxStore.clear()
    vi.restoreAllMocks()

    adapter = {
      recordReceipt: vi.fn().mockResolvedValue({
        txHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        blockNumber: 12345,
      }),
    } as unknown as SorobanAdapter

    stakingService = new StakingService(adapter)
  })

  afterEach(async () => {
    initOutboxStore(new InMemoryOutboxStore())
    await conversionStore.clear()
    await outboxStore.clear()
  })

  it('finalizes staking successfully for a completed conversion', async () => {
    const conversion = await conversionStore.createPending({
      depositId: 'onramp:dep_001',
      userId: 'user_1',
      amountNgn: 160000,
      provider: 'onramp',
    })

    await conversionStore.markCompleted(conversion.conversionId, {
      amountUsdc: '100.000000',
      fxRateNgnPerUsdc: 1600,
      providerRef: 'prov_ref_001',
    })

    const result = await stakingService.finalizeStaking(conversion.conversionId)

    expect(result.sent).toBe(true)
    expect(result.outboxId).toBeDefined()
    expect(result.txId).toMatch(/^[a-f0-9]{64}$/)
    expect([OutboxStatus.CONFIRMING, OutboxStatus.SENT]).toContain(result.status)

    const storedItem = await outboxStore.getById(result.outboxId)
    expect(storedItem).not.toBeNull()
    expect(storedItem?.txType).toBe(TxType.STAKE)
    expect(storedItem?.canonicalExternalRefV1).toContain(conversion.conversionId)
    expect(storedItem?.payload).toMatchObject({
      txType: TxType.STAKE,
      amountUsdc: '100.000000',
      amountNgn: 160000,
      fxRateNgnPerUsdc: 1600,
      fxProvider: 'onramp',
      conversionId: conversion.conversionId,
      depositId: 'onramp:dep_001',
      conversionProviderRef: 'prov_ref_001',
      userId: 'user_1',
    })
  })

  it('throws NOT_FOUND (404) when conversion does not exist', async () => {
    await expect(stakingService.finalizeStaking('non-existent-conv-id')).rejects.toMatchObject({
      status: 404,
      code: ErrorCode.NOT_FOUND,
      message: 'Conversion not found',
    })
  })

  it('throws CONFLICT (409) when conversion is in pending status', async () => {
    const conversion = await conversionStore.createPending({
      depositId: 'onramp:dep_pending',
      userId: 'user_2',
      amountNgn: 50000,
      provider: 'onramp',
    })

    await expect(stakingService.finalizeStaking(conversion.conversionId)).rejects.toMatchObject({
      status: 409,
      code: ErrorCode.CONFLICT,
      message: 'Conversion not completed',
    })
  })

  it('throws CONFLICT (409) when conversion has failed status', async () => {
    const conversion = await conversionStore.createPending({
      depositId: 'onramp:dep_failed',
      userId: 'user_3',
      amountNgn: 25000,
      provider: 'onramp',
    })

    await conversionStore.markFailed(conversion.conversionId, 'Provider rejected transaction')

    await expect(stakingService.finalizeStaking(conversion.conversionId)).rejects.toMatchObject({
      status: 409,
      code: ErrorCode.CONFLICT,
      message: 'Conversion not completed',
    })
  })

  it('is idempotent when called multiple times for the same conversionId', async () => {
    const conversion = await conversionStore.createPending({
      depositId: 'onramp:dep_idemp',
      userId: 'user_idemp',
      amountNgn: 80000,
      provider: 'onramp',
    })

    await conversionStore.markCompleted(conversion.conversionId, {
      amountUsdc: '50.000000',
      fxRateNgnPerUsdc: 1600,
      providerRef: 'prov_ref_idemp',
    })

    const firstResult = await stakingService.finalizeStaking(conversion.conversionId)
    const secondResult = await stakingService.finalizeStaking(conversion.conversionId)

    expect(firstResult.outboxId).toBe(secondResult.outboxId)
    expect(firstResult.txId).toBe(secondResult.txId)

    const allOutboxItems = await outboxStore.listAll()
    const matchingItems = allOutboxItems.filter(
      (item) => item.payload.conversionId === conversion.conversionId,
    )
    expect(matchingItems).toHaveLength(1)
  })

  it('handles sender delivery failure gracefully with sent: false', async () => {
    ;(adapter.recordReceipt as any).mockRejectedValueOnce(new Error('RPC node connection timed out'))

    const conversion = await conversionStore.createPending({
      depositId: 'onramp:dep_send_fail',
      userId: 'user_retry',
      amountNgn: 32000,
      provider: 'onramp',
    })

    await conversionStore.markCompleted(conversion.conversionId, {
      amountUsdc: '20.000000',
      fxRateNgnPerUsdc: 1600,
      providerRef: 'prov_ref_send_fail',
    })

    const result = await stakingService.finalizeStaking(conversion.conversionId)

    expect(result.sent).toBe(false)
    expect(result.outboxId).toBeDefined()
    expect(result.status).toBe(OutboxStatus.FAILED)
  })

  it('throws INTERNAL_ERROR (500) if outbox item cannot be retrieved after send', async () => {
    const conversion = await conversionStore.createPending({
      depositId: 'onramp:dep_err',
      userId: 'user_err',
      amountNgn: 16000,
      provider: 'onramp',
    })

    await conversionStore.markCompleted(conversion.conversionId, {
      amountUsdc: '10.000000',
      fxRateNgnPerUsdc: 1600,
      providerRef: 'prov_ref_err',
    })

    const customStore = new InMemoryOutboxStore()
    customStore.getById = async () => null

    initOutboxStore(customStore)

    await expect(stakingService.finalizeStaking(conversion.conversionId)).rejects.toMatchObject({
      status: 500,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Failed to retrieve outbox item after send attempt',
    })
  })
})
