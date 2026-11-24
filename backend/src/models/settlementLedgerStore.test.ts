import { describe, it, expect, beforeEach } from 'vitest'
import { settlementLedgerStore } from './settlementLedgerStore.js'
import type { CreateSettlementLedgerEntryInput } from './settlementLedger.js'

function entry(overrides: Partial<CreateSettlementLedgerEntryInput> = {}): CreateSettlementLedgerEntryInput {
  return {
    dealId: 'deal-1',
    eventType: 'full_payment_incentive',
    beneficiaryType: 'platform',
    amountNgn: 1000,
    currency: 'NGN',
    rationale: 'platform share',
    splitConfigVersion: 'v1',
    splitConfigSnapshot: { platformShare: 0.5, reporterShare: 0.5, reporterApplied: true },
    ...overrides,
  }
}

describe('settlementLedgerStore (in-memory)', () => {
  beforeEach(async () => {
    await settlementLedgerStore.clear()
  })

  it('inserts entries and assigns ids and timestamps', async () => {
    const inserted = await settlementLedgerStore.insertMany([
      entry(),
      entry({ beneficiaryType: 'reporter', beneficiaryId: 'r1', amountNgn: 500 }),
    ])
    expect(inserted).toHaveLength(2)
    expect(inserted[0].entryId).toBeTruthy()
    expect(inserted[0].entryId).not.toBe(inserted[1].entryId)
    expect(inserted[0].createdAt).toBeInstanceOf(Date)
  })

  it('returns an empty list when inserting nothing', async () => {
    expect(await settlementLedgerStore.insertMany([])).toEqual([])
  })

  it('lists entries by deal id only', async () => {
    await settlementLedgerStore.insertMany([entry({ dealId: 'a' }), entry({ dealId: 'b' })])
    const a = await settlementLedgerStore.listByDealId('a')
    expect(a).toHaveLength(1)
    expect(a[0].dealId).toBe('a')
  })

  it('returns an empty list for an unknown deal', async () => {
    expect(await settlementLedgerStore.listByDealId('missing')).toEqual([])
  })

  it('filters by event type', async () => {
    await settlementLedgerStore.insertMany([entry()])
    expect(await settlementLedgerStore.listByDealId('deal-1', 'full_payment_incentive')).toHaveLength(1)
  })

  it('appends rather than replaces on repeated inserts', async () => {
    await settlementLedgerStore.insertMany([entry()])
    await settlementLedgerStore.insertMany([entry({ beneficiaryType: 'landlord', beneficiaryId: 'l1' })])
    expect(await settlementLedgerStore.listByDealId('deal-1')).toHaveLength(2)
  })

  it('clear removes every entry', async () => {
    await settlementLedgerStore.insertMany([entry()])
    await settlementLedgerStore.clear()
    expect(await settlementLedgerStore.listByDealId('deal-1')).toEqual([])
  })
})
