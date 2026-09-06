import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LatePaymentEscalationService } from './latePaymentEscalationService.js'
import type { LatePaymentConfig } from '../config/latePayment.js'
import { DealStatus, ScheduleItemStatus, type DealWithSchedule } from '../models/deal.js'
import { dealStore } from '../models/dealStore.js'
import { latePaymentEscalationStore } from '../models/latePaymentEscalationStore.js'
import { adminTaskStore } from '../models/adminTaskStore.js'
import { lateFeeService } from './lateFeeService.js'
import * as latePaymentNotifier from './latePaymentNotifier.js'

vi.mock('./latePaymentNotifier.js')
vi.mock('./lateFeeService.js', () => ({
  lateFeeService: {
    ensurePaymentRecord: vi.fn((dealId, period) => `pmt-${dealId}-${period}`),
    applyLateFee: vi.fn().mockReturnValue({ applied: true, lateFeeAmountNgn: 2000 }),
    getEffectiveAmount: vi.fn(() => 102000),
  }
}))

describe('LatePaymentEscalationService', () => {
  const mockConfig: LatePaymentConfig = {
    gracePeriodDays: 3,
    lateFeeDay: 4,
    atRiskDay: 7,
    adminEscalationDay: 14,
    defaultDay: 30,
    lateFeeRate: 0.02,
    jobPollIntervalMs: 6 * 60 * 60 * 1000,
  }

  let service: LatePaymentEscalationService

  beforeEach(async () => {
    service = new LatePaymentEscalationService(mockConfig)
    await dealStore.clear()
    latePaymentEscalationStore.clear()
    adminTaskStore.clear()
    vi.clearAllMocks()
  })

  it('sends due-today reminder at dpd=0', async () => {
    const dueDate = new Date('2024-01-01')
    const now = new Date('2024-01-01')
    const deal = await createTestDeal([{ dueDate, status: ScheduleItemStatus.PENDING }])

    await service.processAllActiveDeals(now)

    expect(latePaymentNotifier.sendLatePaymentNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Payment due today' }),
    )
  })

  it('sends grace reminder within grace period (1 ≤ dpd < gracePeriodDays)', async () => {
    const dueDate = new Date('2024-01-01')
    const now = new Date('2024-01-02')

    const deal = await createTestDeal([{ dueDate, status: ScheduleItemStatus.PENDING }])

    await service.processAllActiveDeals(now)

    expect(latePaymentNotifier.sendLatePaymentNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Payment reminder' }),
    )
  })

  it('applies late fee exactly once at lateFeeDay', async () => {
    const dueDate = new Date('2024-01-01')
    const feeDay = new Date('2024-01-05')

    const deal = await createTestDeal([{ dueDate, status: ScheduleItemStatus.PENDING }])

    await service.processAllActiveDeals(feeDay)
    expect(lateFeeService.applyLateFee).toHaveBeenCalledOnce()

    vi.clearAllMocks()

    await service.processAllActiveDeals(new Date('2024-01-06'))
    expect(lateFeeService.applyLateFee).not.toHaveBeenCalled()
  })

  it('transitions deal to AT_RISK at atRiskDay', async () => {
    const dueDate = new Date('2024-01-01')
    const atRiskDate = new Date('2024-01-08')

    const deal = await createTestDeal([{ dueDate, status: ScheduleItemStatus.PENDING }])
    expect(deal.status).toBe(DealStatus.ACTIVE)

    await service.processAllActiveDeals(atRiskDate)

    const updated = await dealStore.findById(deal.dealId)
    expect(updated?.status).toBe(DealStatus.AT_RISK)
  })

  it('creates admin escalation task exactly once', async () => {
    const dueDate = new Date('2024-01-01')
    const escalationDate = new Date('2024-01-15')

    const deal = await createTestDeal([{ dueDate, status: ScheduleItemStatus.PENDING }])
    const initialTaskCount = adminTaskStore.listOpen().length

    await service.processAllActiveDeals(escalationDate)

    const taskCount = adminTaskStore.listOpen().length
    expect(taskCount).toBeGreaterThan(initialTaskCount)

    vi.clearAllMocks()
    await service.processAllActiveDeals(new Date('2024-01-16'))

    expect(adminTaskStore.listOpen().length).toBe(taskCount)
  })

  it('skips COMPLETED and DEFAULTED deals', async () => {
    const now = new Date('2024-01-15')
    const dueDate = new Date('2024-01-01')

    const completedDeal = await createTestDeal([{ dueDate, status: ScheduleItemStatus.PAID }])
    await dealStore.updateStatus(completedDeal.dealId, DealStatus.COMPLETED)

    const defaultedDeal = await createTestDeal([{ dueDate, status: ScheduleItemStatus.PENDING }])
    await dealStore.updateStatus(defaultedDeal.dealId, DealStatus.DEFAULTED)

    await service.processAllActiveDeals(now)

    expect(latePaymentNotifier.sendLatePaymentNotification).not.toHaveBeenCalled()
  })

  it('de-duplicates notifications on same calendar day', async () => {
    const dueDate = new Date('2024-01-01')
    const atRiskDate = new Date('2024-01-08T10:00:00Z')

    const deal = await createTestDeal([{ dueDate, status: ScheduleItemStatus.PENDING }])

    await service.processAllActiveDeals(atRiskDate)
    const firstCallCount = vi.mocked(latePaymentNotifier.sendLatePaymentNotification).mock.calls.length

    vi.clearAllMocks()

    await service.processAllActiveDeals(new Date('2024-01-08T18:00:00Z'))
    const secondCallCount = vi.mocked(latePaymentNotifier.sendLatePaymentNotification).mock.calls.length

    expect(secondCallCount).toBe(0)
  })

  it('isolates a per-deal failure and continues processing remaining deals', async () => {
    const dueDate = new Date('2024-01-01')
    const now = new Date('2024-01-08')

    const deal1 = await createTestDeal([{ dueDate, status: ScheduleItemStatus.PENDING }])
    const deal2 = await createTestDeal([{ dueDate, status: ScheduleItemStatus.PENDING }])

    // Fail deterministically for deal1 regardless of processing order.
    vi.mocked(lateFeeService.ensurePaymentRecord).mockImplementation(
      (dealId: string, period: number) => {
        if (dealId === deal1.dealId) {
          throw new Error('Database error on deal 1')
        }
        return `pmt-${dealId}-${period}`
      },
    )

    const result = await service.processAllActiveDeals(now)

    expect(result.dealsProcessed).toBe(2)
    expect(result.failedDeals).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.dealId).toBe(deal1.dealId)

    // deal2 was still processed despite deal1 throwing.
    expect(latePaymentNotifier.sendLatePaymentNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dealId: deal2.dealId }),
      }),
    )
  })
})

async function createTestDeal(
  scheduleItems: Array<{ dueDate: Date; status: ScheduleItemStatus }>,
): Promise<DealWithSchedule> {
  const deal = await dealStore.create({
    tenantId: 'tenant-1',
    landlordId: 'landlord-1',
    listingId: `listing-${Math.random()}`,
    annualRentNgn: 1_200_000,
    depositNgn: 240_000,
    termMonths: 12,
  })

  await dealStore.updateStatus(deal.dealId, DealStatus.ACTIVE)

  for (let i = 0; i < scheduleItems.length; i++) {
    const item = scheduleItems[i]
    const period = i + 1
    await dealStore.updateScheduleItemStatus(deal.dealId, period, item.status)
    await dealStore.setScheduleDueDateForTest(deal.dealId, period, item.dueDate.toISOString())
  }

  const updated = await dealStore.findById(deal.dealId)
  if (!updated) throw new Error('Failed to find created deal')
  return updated
}
