import { describe, it, expect, beforeEach } from 'vitest'
import { ConversionService } from './conversionService.js'
import { StubConversionProvider } from './conversionProvider.js'
import { conversionStore } from '../models/conversionStore.js'
import { outboxStore, TxType, OutboxSender, OutboxStatus } from '../outbox/index.js'
import { TestSorobanAdapter } from '../soroban/test-adapter.js'
import { SorobanConfig } from '../soroban/client.js'

/**
 * Integration tests for conversion receipt recording system.
 * Tests the complete flow from conversion to on-chain receipt recording.
 * 
 * Test Infrastructure:
 * - Real ConversionService with StubConversionProvider
 * - Real outboxStore for database operations
 * - Real OutboxSender for processing outbox items
 * - TestSorobanAdapter for simulating Soroban interactions
 */
describe('Conversion Receipt Integration Tests', () => {
  let conversionService: ConversionService
  let outboxSender: OutboxSender
  let testAdapter: TestSorobanAdapter
  let stubProvider: StubConversionProvider

  beforeEach(async () => {
    // Clear test database
    await conversionStore.clear()
    await outboxStore.clear()

    // Configure TestSorobanAdapter
    const sorobanConfig: SorobanConfig = {
      rpcUrl: 'http://localhost:8000/soroban/rpc',
      networkPassphrase: 'Test SDF Network ; September 2015',
      contractId: 'test-contract-id',
      adminSecret: 'test-admin-secret',
    }
    testAdapter = new TestSorobanAdapter(sorobanConfig)
    testAdapter.reset()

    // Configure OutboxSender with TestSorobanAdapter
    outboxSender = new OutboxSender(testAdapter)

    // Configure ConversionService with StubConversionProvider
    // Using FX rate of 1600 NGN per USDC
    stubProvider = new StubConversionProvider(1600)
    conversionService = new ConversionService(stubProvider, 'onramp')
  })

  /**
   * Helper function to process all pending outbox items
   * Simulates the OutboxWorker processing loop
   */
  async function processAllPendingOutboxItems(): Promise<void> {
    const pendingItems = await outboxStore.listByStatus(OutboxStatus.PENDING)
    for (const item of pendingItems) {
      await outboxSender.send(item)
    }
  }

  /**
   * Helper function to get all CONVERSION outbox items
   */
  async function getConversionOutboxItems() {
    return await outboxStore.listByDealId('conversion', TxType.CONVERSION)
  }

  // Placeholder for integration tests
  // Tests will be implemented in subsequent tasks
  it('should have test infrastructure set up', () => {
    expect(conversionService).toBeDefined()
    expect(outboxSender).toBeDefined()
    expect(testAdapter).toBeDefined()
    expect(stubProvider).toBeDefined()
  })

  // Feature: conversion-receipt-testing-and-docs, Property 1: End-to-end conversion receipt flow
  // **Validates: Requirements 1.1, 1.2, 1.3**
  it('should propagate metadata through complete end-to-end flow', async () => {
    // Step 1: Complete a conversion with metadata
    const depositId = 'test-deposit-123'
    const userId = 'test-user-456'
    const amountNgn = 160000 // 160,000 NGN
    
    const conversion = await conversionService.convertDeposit({
      depositId,
      userId,
      amountNgn,
    })

    // Verify conversion was created
    expect(conversion).toBeDefined()
    expect(conversion.status).toBe('completed')
    expect(conversion.amountNgn).toBe(amountNgn)
    expect(conversion.fxRateNgnPerUsdc).toBe(1600) // From StubConversionProvider
    expect(conversion.provider).toBe('onramp')

    // Step 2: Verify outbox entry was created
    const outboxItems = await getConversionOutboxItems()
    expect(outboxItems).toHaveLength(1)
    expect(outboxItems[0].txType).toBe(TxType.CONVERSION)
    expect(outboxItems[0].status).toBe(OutboxStatus.PENDING)

    // Step 3: Process the outbox entry through OutboxWorker simulation
    await processAllPendingOutboxItems()

    // Step 4: Verify adapter.recordReceipt was called
    const recordedReceipts = testAdapter.getRecordedReceipts()
    expect(recordedReceipts).toHaveLength(1)

    // Step 5: Verify all metadata fields are correctly propagated
    const receipt = recordedReceipts[0]
    expect(receipt.txType).toBe(TxType.CONVERSION)
    expect(receipt.amountUsdc).toBeDefined()
    expect(receipt.tokenAddress).toBeDefined()
    expect(receipt.dealId).toBe('conversion')
    
    // Verify metadata fields
    expect(receipt.amountNgn).toBe(amountNgn)
    expect(receipt.fxRate).toBe(1600)
    expect(receipt.fxProvider).toBe('onramp')

    // Step 6: Verify outbox status is SENT
    const updatedOutboxItems = await getConversionOutboxItems()
    expect(updatedOutboxItems[0].status).toBe(OutboxStatus.SENT)
  })

  // Feature: conversion-receipt-testing-and-docs, Property 2: Service-layer idempotency
  // **Validates: Requirements 1.4**
  it('should ensure service-layer idempotency when calling convertDeposit multiple times', async () => {
    // Step 1: Call convertDeposit 3 times with the same depositId
    const depositId = 'test-deposit-idempotency'
    const userId = 'test-user-789'
    const amountNgn = 320000 // 320,000 NGN

    const conversion1 = await conversionService.convertDeposit({
      depositId,
      userId,
      amountNgn,
    })

    const conversion2 = await conversionService.convertDeposit({
      depositId,
      userId,
      amountNgn,
    })

    const conversion3 = await conversionService.convertDeposit({
      depositId,
      userId,
      amountNgn,
    })

    // Step 2: Verify all calls return the same conversion object
    expect(conversion1.conversionId).toBe(conversion2.conversionId)
    expect(conversion2.conversionId).toBe(conversion3.conversionId)
    expect(conversion1.providerRef).toBe(conversion2.providerRef)
    expect(conversion2.providerRef).toBe(conversion3.providerRef)

    // Step 3: Verify only 1 outbox entry exists
    const outboxItems = await getConversionOutboxItems()
    expect(outboxItems).toHaveLength(1)
    expect(outboxItems[0].txType).toBe(TxType.CONVERSION)
    expect(outboxItems[0].status).toBe(OutboxStatus.PENDING)

    // Verify the outbox entry corresponds to the conversion
    const payload = outboxItems[0].payload as any
    expect(payload.conversionId).toBe(conversion1.conversionId)
    expect(payload.depositId).toBe(depositId)
  })

  // Feature: conversion-receipt-testing-and-docs, Property 3: Outbox-layer duplicate prevention
  // **Validates: Requirements 1.5**
  it('should prevent duplicate outbox entries at the outbox layer', async () => {
    // Step 1: Create a conversion and its outbox entry
    const depositId = 'test-deposit-duplicate-prevention'
    const userId = 'test-user-duplicate'
    const amountNgn = 480000 // 480,000 NGN

    const conversion = await conversionService.convertDeposit({
      depositId,
      userId,
      amountNgn,
    })

    // Verify conversion and outbox entry were created
    expect(conversion).toBeDefined()
    expect(conversion.status).toBe('completed')
    expect(conversion.providerRef).toBeDefined()

    const outboxItemsAfterFirst = await getConversionOutboxItems()
    expect(outboxItemsAfterFirst).toHaveLength(1)
    expect(outboxItemsAfterFirst[0].txType).toBe(TxType.CONVERSION)

    // Step 2: Attempt to create another outbox entry with the same source/ref
    // The outbox store should return the existing entry (idempotent behavior)
    const duplicateOutboxItem = await outboxStore.create({
      txType: TxType.CONVERSION,
      source: 'onramp', // Same source as conversionService
      ref: conversion.providerRef!, // Same ref as the conversion
      payload: {
        txType: TxType.CONVERSION,
        amountUsdc: '200.00', // Different payload values
        tokenAddress: 'different-token-address',
        dealId: 'conversion',
        amountNgn: 999999, // Different amount
        fxRateNgnPerUsdc: 9999,
        fxProvider: 'onramp',
        conversionId: 'different-conversion-id',
        depositId: 'different-deposit-id',
        conversionProviderRef: conversion.providerRef!,
        userId: 'different-user',
      },
    })

    // Step 3: Verify only 1 entry exists in the database
    const outboxItemsAfterDuplicate = await getConversionOutboxItems()
    expect(outboxItemsAfterDuplicate).toHaveLength(1)

    // Verify the returned item is the same as the original (by ID)
    expect(duplicateOutboxItem.id).toBe(outboxItemsAfterFirst[0].id)

    // Verify the original payload is preserved (not overwritten by duplicate attempt)
    const originalPayload = outboxItemsAfterFirst[0].payload as any
    const returnedPayload = duplicateOutboxItem.payload as any
    expect(returnedPayload.conversionId).toBe(originalPayload.conversionId)
    expect(returnedPayload.depositId).toBe(depositId)
    expect(returnedPayload.amountNgn).toBe(amountNgn)
  })

  // Feature: conversion-receipt-testing-and-docs, Property 4: Adapter-layer idempotency handling
  // **Validates: Requirements 1.6**
  it('should handle duplicate receipt errors as idempotent success', async () => {
    // Step 1: Create a conversion and outbox entry
    const depositId = 'test-deposit-adapter-idempotency'
    const userId = 'test-user-adapter'
    const amountNgn = 640000 // 640,000 NGN

    const conversion = await conversionService.convertDeposit({
      depositId,
      userId,
      amountNgn,
    })

    // Verify conversion and outbox entry were created
    expect(conversion).toBeDefined()
    expect(conversion.status).toBe('completed')

    const outboxItems = await getConversionOutboxItems()
    expect(outboxItems).toHaveLength(1)
    expect(outboxItems[0].status).toBe(OutboxStatus.PENDING)

    // Step 2: Configure TestSorobanAdapter to simulate duplicate receipt error
    testAdapter.simulateDuplicateError()

    // Step 3: Process the outbox entry - should not throw an error
    await expect(processAllPendingOutboxItems()).resolves.not.toThrow()

    // Step 4: Verify the adapter was called (receipt was attempted)
    const recordedReceipts = testAdapter.getRecordedReceipts()
    expect(recordedReceipts).toHaveLength(1)
    expect(recordedReceipts[0].txType).toBe(TxType.CONVERSION)

    // Step 5: Verify outbox status is SENT (idempotent success)
    const updatedOutboxItems = await getConversionOutboxItems()
    expect(updatedOutboxItems[0].status).toBe(OutboxStatus.SENT)
    // Note: retryCount is 1 because the item was processed once (even though duplicate was handled gracefully)
    expect(updatedOutboxItems[0].retryCount).toBe(1)
  })

  // Feature: conversion-receipt-testing-and-docs, Property 5: Retry with exponential backoff
  // **Validates: Requirements 1.7**
  it('should retry with exponential backoff until success', async () => {
    // Step 1: Create a conversion and outbox entry
    const depositId = 'test-deposit-retry-backoff'
    const userId = 'test-user-retry'
    const amountNgn = 800000 // 800,000 NGN

    const conversion = await conversionService.convertDeposit({
      depositId,
      userId,
      amountNgn,
    })

    // Verify conversion and outbox entry were created
    expect(conversion).toBeDefined()
    expect(conversion.status).toBe('completed')

    const outboxItems = await getConversionOutboxItems()
    expect(outboxItems).toHaveLength(1)
    expect(outboxItems[0].status).toBe(OutboxStatus.PENDING)
    expect(outboxItems[0].retryCount).toBe(0)

    // Step 2: Configure TestSorobanAdapter to fail twice then succeed
    testAdapter.simulateFailures(2)

    // Step 3: Process the outbox entry (first attempt - should fail)
    await processAllPendingOutboxItems()

    // Verify first failure
    let updatedItems = await getConversionOutboxItems()
    expect(updatedItems[0].status).toBe(OutboxStatus.FAILED)
    expect(updatedItems[0].retryCount).toBe(1)
    expect(updatedItems[0].lastError).toContain('Simulated transient failure')
    
    // Verify nextRetryAt uses exponential backoff formula: 2^0 * 1000ms = 1000ms
    const firstRetryAt = updatedItems[0].nextRetryAt
    expect(firstRetryAt).toBeDefined()
    const firstBackoffMs = firstRetryAt!.getTime() - updatedItems[0].updatedAt.getTime()
    // Allow some tolerance for timing (within 100ms)
    expect(firstBackoffMs).toBeGreaterThanOrEqual(900)
    expect(firstBackoffMs).toBeLessThanOrEqual(1100)

    // Step 4: Process again (second attempt - should fail again)
    // Manually call sender.send since processAllPendingOutboxItems only processes PENDING items
    await outboxSender.send(updatedItems[0])

    // Verify second failure
    updatedItems = await getConversionOutboxItems()
    expect(updatedItems[0].status).toBe(OutboxStatus.FAILED)
    expect(updatedItems[0].retryCount).toBe(2)
    expect(updatedItems[0].lastError).toContain('Simulated transient failure')
    
    // Verify nextRetryAt uses exponential backoff formula: 2^1 * 1000ms = 2000ms
    const secondRetryAt = updatedItems[0].nextRetryAt
    expect(secondRetryAt).toBeDefined()
    const secondBackoffMs = secondRetryAt!.getTime() - updatedItems[0].updatedAt.getTime()
    // Allow some tolerance for timing (within 100ms)
    expect(secondBackoffMs).toBeGreaterThanOrEqual(1900)
    expect(secondBackoffMs).toBeLessThanOrEqual(2100)

    // Step 5: Process again (third attempt - should succeed)
    await outboxSender.send(updatedItems[0])

    // Verify eventual success
    updatedItems = await getConversionOutboxItems()
    expect(updatedItems[0].status).toBe(OutboxStatus.SENT)
    expect(updatedItems[0].retryCount).toBe(3)
    expect(updatedItems[0].nextRetryAt).toBeNull()

    // Verify the adapter was called 3 times total (2 failures + 1 success)
    const recordedReceipts = testAdapter.getRecordedReceipts()
    expect(recordedReceipts).toHaveLength(3)
    expect(recordedReceipts[0].txType).toBe(TxType.CONVERSION)
    expect(recordedReceipts[1].txType).toBe(TxType.CONVERSION)
    expect(recordedReceipts[2].txType).toBe(TxType.CONVERSION)
  })

  // Feature: conversion-receipt-testing-and-docs, Property 6: Staking conversion synthetic depositId
  // **Validates: Requirements 1.8**
  it('should use synthetic depositId format for staking conversions', async () => {
    // Step 1: Call convertForStaking with externalRefSource and externalRef
    const externalRefSource = 'staking-provider'
    const externalRef = 'stake-ref-12345'
    const userId = 'test-user-staking'
    const amountNgn = 960000 // 960,000 NGN

    const conversion = await conversionService.convertForStaking({
      externalRefSource,
      externalRef,
      userId,
      amountNgn,
    })

    // Step 2: Verify conversion was created
    expect(conversion).toBeDefined()
    expect(conversion.status).toBe('completed')

    // Step 3: Verify depositId format is "stake:{source}:{ref}"
    const expectedDepositId = `stake:${externalRefSource}:${externalRef}`
    expect(conversion.depositId).toBe(expectedDepositId)

    // Step 4: Verify CONVERSION outbox entry is created
    const outboxItems = await getConversionOutboxItems()
    expect(outboxItems).toHaveLength(1)
    expect(outboxItems[0].txType).toBe(TxType.CONVERSION)
    expect(outboxItems[0].status).toBe(OutboxStatus.PENDING)

    // Step 5: Verify all metadata is included in the outbox payload
    const payload = outboxItems[0].payload as any
    expect(payload.txType).toBe(TxType.CONVERSION)
    expect(payload.depositId).toBe(expectedDepositId)
    expect(payload.amountNgn).toBe(amountNgn)
    expect(payload.fxRateNgnPerUsdc).toBe(1600) // From StubConversionProvider
    expect(payload.fxProvider).toBe('onramp')
    expect(payload.conversionId).toBe(conversion.conversionId)
    expect(payload.userId).toBe(userId)
    expect(payload.amountUsdc).toBeDefined()
    expect(payload.tokenAddress).toBeDefined()
    expect(payload.dealId).toBe('conversion')
    expect(payload.conversionProviderRef).toBe(conversion.providerRef)

    // Step 6: Process the outbox entry to verify end-to-end flow
    await processAllPendingOutboxItems()

    // Step 7: Verify adapter.recordReceipt was called with correct parameters
    const recordedReceipts = testAdapter.getRecordedReceipts()
    expect(recordedReceipts).toHaveLength(1)
    
    const receipt = recordedReceipts[0]
    expect(receipt.txType).toBe(TxType.CONVERSION)
    expect(receipt.amountNgn).toBe(amountNgn)
    expect(receipt.fxRate).toBe(1600)
    expect(receipt.fxProvider).toBe('onramp')
    expect(receipt.dealId).toBe('conversion')

    // Step 8: Verify outbox status is SENT
    const updatedOutboxItems = await getConversionOutboxItems()
    expect(updatedOutboxItems[0].status).toBe(OutboxStatus.SENT)
  })
})

