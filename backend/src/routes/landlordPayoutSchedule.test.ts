import { describe, it, expect, beforeEach } from 'vitest'
import { listPayoutScheduleSchema, DELAY_REASON_LABELS, DEDUCTION_TYPE_LABELS, PAYOUT_STATUS_LABELS, PAYOUT_CHANNEL_LABELS } from '../schemas/landlordPayoutSchedule.js'
import { InMemoryLandlordPayoutScheduleStore, groupPayouts, computeSummary } from '../models/landlordPayoutScheduleStore.js'
import type { LandlordPayout } from '../schemas/landlordPayoutSchedule.js'

function makePayout(overrides: Partial<LandlordPayout> = {}): LandlordPayout {
  return {
    id: `PAY-${Math.random().toString(36).slice(2, 8)}`,
    landlordId: 'landlord-1',
    propertyId: 'prop-1',
    propertyName: 'Lagos Apartment',
    scheduledDate: '2025-04-15T00:00:00Z',
    completedDate: null,
    grossAmount: 500000,
    deductions: [{ type: 'platform_fee', label: 'Platform Fee', amount: 25000 }],
    netAmount: 475000,
    currency: 'NGN',
    status: 'scheduled',
    channel: 'bank_transfer',
    delayReasons: [],
    periodStart: '2025-04-01T00:00:00Z',
    periodEnd: '2025-04-30T00:00:00Z',
    createdAt: '2025-03-28T00:00:00Z',
    updatedAt: '2025-03-28T00:00:00Z',
    ...overrides,
  }
}

describe('Landlord Payout Schedule - Schema', () => {
  it('validates list schedule query with defaults', () => {
    const result = listPayoutScheduleSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.grouping).toBe('monthly')
      expect(result.data.page).toBe(1)
      expect(result.data.pageSize).toBe(20)
    }
  })

  it('parses status and channel filters', () => {
    const result = listPayoutScheduleSchema.safeParse({ status: 'delayed', channel: 'mobile_money' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.status).toBe('delayed')
      expect(result.data.channel).toBe('mobile_money')
    }
  })

  it('parses weekly grouping', () => {
    const result = listPayoutScheduleSchema.safeParse({ grouping: 'weekly' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.grouping).toBe('weekly')
  })

  it('rejects invalid status', () => {
    const result = listPayoutScheduleSchema.safeParse({ status: 'invalid' })
    expect(result.success).toBe(false)
  })

  it('provides label maps for all enum values', () => {
    expect(Object.keys(DELAY_REASON_LABELS).length).toBeGreaterThan(0)
    expect(Object.keys(DEDUCTION_TYPE_LABELS).length).toBeGreaterThan(0)
    expect(Object.keys(PAYOUT_STATUS_LABELS).length).toBeGreaterThan(0)
    expect(Object.keys(PAYOUT_CHANNEL_LABELS).length).toBeGreaterThan(0)
  })
})

describe('groupPayouts', () => {
  it('groups payouts by month', () => {
    const payouts = [
      makePayout({ scheduledDate: '2025-04-10T00:00:00Z', periodStart: '2025-04-01T00:00:00Z', periodEnd: '2025-04-30T00:00:00Z' }),
      makePayout({ scheduledDate: '2025-04-20T00:00:00Z', periodStart: '2025-04-01T00:00:00Z', periodEnd: '2025-04-30T00:00:00Z' }),
      makePayout({ scheduledDate: '2025-05-15T00:00:00Z', periodStart: '2025-05-01T00:00:00Z', periodEnd: '2025-05-31T00:00:00Z' }),
    ]
    const periods = groupPayouts(payouts, 'monthly')
    expect(periods).toHaveLength(2)
    expect(periods[0].periodLabel).toBe('2025-04')
    expect(periods[0].payoutCount).toBe(2)
    expect(periods[1].periodLabel).toBe('2025-05')
    expect(periods[1].payoutCount).toBe(1)
  })

  it('groups payouts by week', () => {
    const payouts = [
      makePayout({ scheduledDate: '2025-04-07T00:00:00Z' }),
      makePayout({ scheduledDate: '2025-04-14T00:00:00Z' }),
    ]
    const periods = groupPayouts(payouts, 'weekly')
    expect(periods.length).toBeGreaterThanOrEqual(2)
  })

  it('computes period totals correctly', () => {
    const payouts = [
      makePayout({ grossAmount: 300000, deductions: [{ type: 'platform_fee', label: 'Fee', amount: 15000 }], netAmount: 285000 }),
      makePayout({ grossAmount: 200000, deductions: [{ type: 'tax_withholding', label: 'Tax', amount: 10000 }], netAmount: 190000 }),
    ]
    const periods = groupPayouts(payouts, 'monthly')
    expect(periods[0].grossTotal).toBe(500000)
    expect(periods[0].deductionsTotal).toBe(25000)
    expect(periods[0].netTotal).toBe(475000)
  })

  it('counts delayed payouts in period', () => {
    const payouts = [
      makePayout({ status: 'delayed', delayReasons: ['bank_processing'] }),
      makePayout({ status: 'scheduled' }),
    ]
    const periods = groupPayouts(payouts, 'monthly')
    expect(periods[0].delayedCount).toBe(1)
  })
})

describe('computeSummary', () => {
  it('computes summary from empty list', () => {
    const summary = computeSummary([])
    expect(summary.totalGross).toBe(0)
    expect(summary.totalDeductions).toBe(0)
    expect(summary.totalNet).toBe(0)
    expect(summary.totalPayouts).toBe(0)
    expect(summary.delayedPayouts).toBe(0)
    expect(summary.onHoldPayouts).toBe(0)
    expect(summary.currency).toBe('NGN')
  })

  it('computes summary with delayed and on-hold counts', () => {
    const payouts = [
      makePayout({ status: 'delayed' }),
      makePayout({ status: 'on_hold' }),
      makePayout({ status: 'completed' }),
    ]
    const summary = computeSummary(payouts)
    expect(summary.totalPayouts).toBe(3)
    expect(summary.delayedPayouts).toBe(1)
    expect(summary.onHoldPayouts).toBe(1)
  })
})

describe('InMemoryLandlordPayoutScheduleStore', () => {
  let store: InMemoryLandlordPayoutScheduleStore

  beforeEach(() => {
    store = new InMemoryLandlordPayoutScheduleStore()
  })

  it('lists payouts scoped to landlord', async () => {
    store.seed(makePayout({ landlordId: 'l1' }))
    store.seed(makePayout({ landlordId: 'l2' }))
    const result = await store.listPayouts('l1')
    expect(result.payouts).toHaveLength(1)
    expect(result.total).toBe(1)
  })

  it('filters by status', async () => {
    store.seed(makePayout({ landlordId: 'l1', status: 'delayed' }))
    store.seed(makePayout({ landlordId: 'l1', status: 'completed' }))
    const result = await store.listPayouts('l1', { status: 'delayed' })
    expect(result.payouts).toHaveLength(1)
    expect(result.payouts[0].status).toBe('delayed')
  })

  it('filters by channel', async () => {
    store.seed(makePayout({ landlordId: 'l1', channel: 'bank_transfer' }))
    store.seed(makePayout({ landlordId: 'l1', channel: 'mobile_money' }))
    const result = await store.listPayouts('l1', { channel: 'mobile_money' })
    expect(result.payouts).toHaveLength(1)
  })

  it('filters by date range', async () => {
    store.seed(makePayout({ landlordId: 'l1', scheduledDate: '2025-04-15T00:00:00Z' }))
    store.seed(makePayout({ landlordId: 'l1', scheduledDate: '2025-05-15T00:00:00Z' }))
    const result = await store.listPayouts('l1', { from: '2025-05-01T00:00:00Z', to: '2025-05-31T00:00:00Z' })
    expect(result.payouts).toHaveLength(1)
  })

  it('paginates results', async () => {
    for (let i = 0; i < 5; i++) store.seed(makePayout({ landlordId: 'l1' }))
    const page1 = await store.listPayouts('l1', { page: 1, pageSize: 2 })
    expect(page1.payouts).toHaveLength(2)
    expect(page1.total).toBe(5)
    const page3 = await store.listPayouts('l1', { page: 3, pageSize: 2 })
    expect(page3.payouts).toHaveLength(1)
  })

  it('finds payout by id with ownership check', async () => {
    const p = makePayout({ landlordId: 'l1' })
    store.seed(p)
    const found = await store.getPayoutById(p.id, 'l1')
    expect(found).toBeTruthy()
    const notFound = await store.getPayoutById(p.id, 'l2')
    expect(notFound).toBeNull()
  })

  it('returns schedule with grouped periods and summary', async () => {
    store.seed(makePayout({ landlordId: 'l1', scheduledDate: '2025-04-10T00:00:00Z', grossAmount: 300000, netAmount: 285000, deductions: [{ type: 'platform_fee', label: 'Fee', amount: 15000 }] }))
    store.seed(makePayout({ landlordId: 'l1', scheduledDate: '2025-04-20T00:00:00Z', grossAmount: 200000, netAmount: 190000, deductions: [{ type: 'tax_withholding', label: 'Tax', amount: 10000 }], status: 'delayed', delayReasons: ['bank_processing'] }))
    const result = await store.getSchedule('l1', { grouping: 'monthly' })
    expect(result.periods).toHaveLength(1)
    expect(result.periods[0].grossTotal).toBe(500000)
    expect(result.periods[0].delayedCount).toBe(1)
    expect(result.summary.totalGross).toBe(500000)
    expect(result.summary.delayedPayouts).toBe(1)
  })

  it('schedule filters apply before grouping', async () => {
    store.seed(makePayout({ landlordId: 'l1', status: 'completed' }))
    store.seed(makePayout({ landlordId: 'l1', status: 'delayed' }))
    const result = await store.getSchedule('l1', { status: 'delayed' })
    expect(result.summary.totalPayouts).toBe(1)
    expect(result.periods[0].payoutCount).toBe(1)
  })
})
