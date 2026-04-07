import { describe, it, expect, beforeEach } from 'vitest'
import { outboxStore } from './store.js'
import { computeTxId } from './canonicalization.js'
import { TxType, OutboxStatus } from './types.js'

describe('Outbox Store', () => {
  beforeEach(async () => {
    await outboxStore.clear()
  })

  it('should create a new outbox item', async () => {
    const item = await outboxStore.create({
      txType: TxType.RECEIPT,
      source: 'stripe',
      ref: 'pi_test123',
      payload: {
        dealId: 'deal-001',
        amount: '1000',
        payer: 'GABC123',
      },
    })

    expect(item.id).toBeDefined()
    expect(item.txId).toBeDefined()
    expect(item.status).toBe(OutboxStatus.PENDING)
    expect(item.attempts).toBe(0)
    expect(item.canonicalExternalRefV1).toBe('v1|source=stripe|ref=pi_test123')
  })

  it('should return existing item for duplicate external reference (idempotent)', async () => {
    const item1 = await outboxStore.create({
      txType: TxType.RECEIPT,
      source: 'stripe',
      ref: 'pi_test123',
      payload: {
        dealId: 'deal-001',
        amount: '1000',
        payer: 'GABC123',
      },
    })

    const item2 = await outboxStore.create({
      txType: TxType.RECEIPT,
      source: 'stripe',
      ref: 'pi_test123',
      payload: {
        dealId: 'deal-001',
        amount: '1000',
        payer: 'GABC123',
      },
    })

    expect(item1.id).toBe(item2.id)
    expect(item1.txId).toBe(item2.txId)
  })

  it('should return existing item even with different payload (idempotent by source+ref)', async () => {
    const item1 = await outboxStore.create({
      txType: TxType.RECEIPT,
      source: 'stripe',
      ref: 'pi_test123',
      payload: {
        dealId: 'deal-001',
        amount: '1000',
        payer: 'GABC123',
      },
    })

    const item2 = await outboxStore.create({
      txType: TxType.RECEIPT,
      source: 'stripe',
      ref: 'pi_test123',
      payload: {
        dealId: 'deal-002',
        amount: '2000',
        payer: 'GXYZ789',
      },
    })

    expect(item1.id).toBe(item2.id)
    expect(item1.txId).toBe(item2.txId)
  })

  it('should normalize source case for idempotency', async () => {
    const item1 = await outboxStore.create({
      txType: TxType.RECEIPT,
      source: 'STRIPE',
      ref: 'pi_test123',
      payload: { dealId: 'deal-001', amount: '1000', payer: 'GABC123' },
    })

    const item2 = await outboxStore.create({
      txType: TxType.RECEIPT,
      source: 'stripe',
      ref: 'pi_test123',
      payload: { dealId: 'deal-001', amount: '1000', payer: 'GABC123' },
    })

    expect(item1.id).toBe(item2.id)
    expect(item1.txId).toBe(item2.txId)
  })

  it('should list items by status', async () => {
    await outboxStore.create({
      txType: TxType.RECEIPT,
      source: 'stripe',
      ref: 'pi_1',
      payload: { dealId: 'deal-001', amount: '1000', payer: 'GABC123' },
    })

    const item2 = await outboxStore.create({
      txType: TxType.RECEIPT,
      source: 'stripe',
      ref: 'pi_2',
      payload: { dealId: 'deal-002', amount: '2000', payer: 'GDEF456' },
    })

    await outboxStore.updateStatus(item2.id, OutboxStatus.FAILED, { error: 'Network error' })

    const pending = await outboxStore.listByStatus(OutboxStatus.PENDING)
    const failed = await outboxStore.listByStatus(OutboxStatus.FAILED)

    expect(pending).toHaveLength(1)
    expect(failed).toHaveLength(1)
    expect(failed[0].lastError).toBe('Network error')
  })

  it('should update item status and increment attempts', async () => {
    const item = await outboxStore.create({
      txType: TxType.RECEIPT,
      source: 'stripe',
      ref: 'pi_test',
      payload: { dealId: 'deal-001', amount: '1000', payer: 'GABC123' },
    })

    const updated = await outboxStore.updateStatus(
      item.id,
      OutboxStatus.FAILED,
      { error: 'Connection timeout' },
    )

    expect(updated?.status).toBe(OutboxStatus.FAILED)
    expect(updated?.attempts).toBe(1)
    expect(updated?.lastError).toBe('Connection timeout')
  })
})

describe('tx_id computation', () => {
  it('should compute deterministic tx_id from source and ref only', () => {
    const txId1 = computeTxId('stripe', 'pi_test123')
    const txId2 = computeTxId('stripe', 'pi_test123')

    expect(txId1).toBe(txId2)
    expect(txId1).toHaveLength(64) // 32 bytes as hex
  })

  it('should normalize source case in tx_id computation', () => {
    const txId1 = computeTxId('STRIPE', 'pi_test123')
    const txId2 = computeTxId('stripe', 'pi_test123')

    expect(txId1).toBe(txId2)
  })

  it('should produce same tx_id regardless of payload', () => {
    // tx_id should only depend on (source, ref), not on payload
    const txId1 = computeTxId('stripe', 'pi_test123')
    const txId2 = computeTxId('stripe', 'pi_test123')

    expect(txId1).toBe(txId2)
  })

  it('should produce different tx_id for different refs', () => {
    const txId1 = computeTxId('stripe', 'pi_test123')
    const txId2 = computeTxId('stripe', 'pi_test456')

    expect(txId1).not.toBe(txId2)
  })

  it('should produce different tx_id for different sources', () => {
    const txId1 = computeTxId('stripe', 'pi_test123')
    const txId2 = computeTxId('paystack', 'pi_test123')

    expect(txId1).not.toBe(txId2)
  })
})

describe('Outbox Health Summary', () => {
  beforeEach(async () => {
    await outboxStore.clear()
  })

  it('returns zero counts when outbox is empty', async () => {
    const summary = await outboxStore.getHealthSummary()
    expect(summary).toEqual({
      pending: 0,
      sent: 0,
      failed: 0,
      dead: 0,
      total: 0,
      oldestPending: null,
      oldestFailed: null,
    })
  })

  it('correctly counts items by status', async () => {
    const item1 = await outboxStore.create({
      txType: TxType.RECEIPT,
      source: 'health',
      ref: 'h-1',
      payload: { dealId: 'd1' },
    })
    const item2 = await outboxStore.create({
      txType: TxType.RECEIPT,
      source: 'health',
      ref: 'h-2',
      payload: { dealId: 'd2' },
    })
    await outboxStore.create({
      txType: TxType.RECEIPT,
      source: 'health',
      ref: 'h-3',
      payload: { dealId: 'd3' },
    })

    // Mark item1 as sent, item2 as failed
    await outboxStore.updateStatus(item1.id, OutboxStatus.SENT)
    await outboxStore.updateStatus(item2.id, OutboxStatus.FAILED, { error: 'timeout' })

    const summary = await outboxStore.getHealthSummary()
    expect(summary.pending).toBe(1)
    expect(summary.sent).toBe(1)
    expect(summary.failed).toBe(1)
    expect(summary.dead).toBe(0)
    expect(summary.total).toBe(3)
    expect(summary.oldestPending).toBeDefined()
    expect(summary.oldestFailed).toBeDefined()
  })

  it('tracks dead-lettered items', async () => {
    const item = await outboxStore.create({
      txType: TxType.RECEIPT,
      source: 'health',
      ref: 'h-dead',
      payload: { dealId: 'dx' },
    })
    await outboxStore.markDead(item.id, 'Exhausted retries')

    const summary = await outboxStore.getHealthSummary()
    expect(summary.dead).toBe(1)
    expect(summary.pending).toBe(0)
  })
})
