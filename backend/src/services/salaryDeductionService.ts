import { dealStore } from '../models/dealStore.js'
import { employerStore } from '../models/employerStore.js'
import { DealStatus, ScheduleItemStatus } from '../models/deal.js'
import type { RepaymentMethod } from '../models/deal.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { logger } from '../utils/logger.js'

export interface DeductionNotifyInput {
  employerId: string
  employeeId: string
  amount: number
  periodMonth: number
  periodYear: number
  referenceId: string
}

export interface DeductionNotifyResult {
  matched: boolean
  dealId?: string
  instalmentNumber?: number
}

export interface UpcomingDeduction {
  employeeId: string
  dealId: string
  deductionAmount: number
  deductionDay: number
  periodMonth: number
  periodYear: number
  dueDate: string
}

function findInstalmentForPeriod(
  schedule: { period: number; dueDate: string; amountNgn: number; status: string }[],
  periodMonth: number,
  periodYear: number,
): { period: number } | null {
  const unpaid = schedule.filter((s) => s.status !== ScheduleItemStatus.PAID)
  for (const item of unpaid) {
    const due = new Date(item.dueDate)
    if (due.getUTCMonth() + 1 === periodMonth && due.getUTCFullYear() === periodYear) {
      return { period: item.period }
    }
  }
  const nextUnpaid = unpaid.sort((a, b) => a.period - b.period)[0]
  return nextUnpaid ? { period: nextUnpaid.period } : null
}

export async function processEmployerDeductionNotification(
  input: DeductionNotifyInput,
): Promise<DeductionNotifyResult> {
  const instruction = employerStore.findInstruction(input.employerId, input.employeeId)
  if (!instruction) {
    return { matched: false }
  }

  const deal = await dealStore.findById(instruction.dealId)
  if (!deal || (deal.status !== DealStatus.ACTIVE && deal.status !== DealStatus.AT_RISK)) {
    return { matched: false }
  }

  const instalment = findInstalmentForPeriod(deal.schedule, input.periodMonth, input.periodYear)
  if (!instalment) {
    return { matched: false }
  }

  const scheduleItem = deal.schedule.find((s) => s.period === instalment.period)
  if (!scheduleItem || scheduleItem.status === ScheduleItemStatus.PAID) {
    return { matched: false }
  }

  if (Math.abs(scheduleItem.amountNgn - input.amount) > 1) {
    logger.warn('Deduction amount mismatch', {
      dealId: deal.dealId,
      expected: scheduleItem.amountNgn,
      received: input.amount,
      referenceId: input.referenceId,
    })
  }

  await dealStore.updateScheduleItemStatus(
    deal.dealId,
    instalment.period,
    ScheduleItemStatus.PAID,
  )

  return {
    matched: true,
    dealId: deal.dealId,
    instalmentNumber: instalment.period,
  }
}

export async function applyDealRepaymentMethod(
  dealId: string,
  repaymentMethod: RepaymentMethod,
  options?: { employerId?: string; employeeId?: string; deductionDay?: number },
): Promise<void> {
  const deal = await dealStore.findById(dealId)
  if (!deal) {
    throw new AppError(ErrorCode.NOT_FOUND, 404, `Deal with ID ${dealId} not found`)
  }

  await dealStore.updateRepaymentMethod(dealId, repaymentMethod, options)

  employerStore.deleteInstructionForDeal(dealId)

  if (repaymentMethod === 'self_pay') {
    return
  }

  const employerId = options?.employerId
  const employeeId = options?.employeeId
  const deductionDay = options?.deductionDay

  if (!employerId || !employeeId || !deductionDay) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Employer, employee ID, and deduction day are required')
  }

  const employer = employerStore.findById(employerId)
  if (!employer || employer.status !== 'active') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Employer must be active')
  }

  const nextUnpaid = deal.schedule.find((s) => s.status !== ScheduleItemStatus.PAID)
  const deductionAmount = nextUnpaid?.amountNgn ?? deal.schedule[0]?.amountNgn ?? 0

  employerStore.createInstruction({
    dealId,
    employerId,
    employeeId,
    deductionAmount,
    deductionDay,
  })
}

export async function collectUpcomingDeductions(
  referenceDate: Date = new Date(),
): Promise<Map<string, UpcomingDeduction[]>> {
  const nextMonth = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() + 1, 1))
  const periodMonth = nextMonth.getUTCMonth() + 1
  const periodYear = nextMonth.getUTCFullYear()

  const byEmployer = new Map<string, UpcomingDeduction[]>()

  const instructions = employerStore.listActiveInstructions()
  const deals = await dealStore.findByIds(instructions.map((instruction) => instruction.dealId))
  const dealsById = new Map(deals.map((deal) => [deal.dealId, deal]))

  for (const instruction of instructions) {
    const employer = employerStore.findById(instruction.employerId)
    if (!employer || employer.status !== 'active' || !employer.monthlyDeductionWebhookUrl) {
      continue
    }

    const deal = dealsById.get(instruction.dealId)
    if (!deal || deal.status !== DealStatus.ACTIVE) continue

    const instalment = findInstalmentForPeriod(deal.schedule, periodMonth, periodYear)
    if (!instalment) continue

    const scheduleItem = deal.schedule.find((s) => s.period === instalment.period)
    if (!scheduleItem || scheduleItem.status === ScheduleItemStatus.PAID) continue

    const entry: UpcomingDeduction = {
      employeeId: instruction.employeeId,
      dealId: instruction.dealId,
      deductionAmount: scheduleItem.amountNgn,
      deductionDay: instruction.deductionDay,
      periodMonth,
      periodYear,
      dueDate: scheduleItem.dueDate,
    }

    const list = byEmployer.get(instruction.employerId) ?? []
    list.push(entry)
    byEmployer.set(instruction.employerId, list)
  }

  return byEmployer
}

export async function sendMonthlyDeductionAdvanceNotices(referenceDate?: Date): Promise<{
  employersNotified: number
  totalDeductions: number
}> {
  const grouped = await collectUpcomingDeductions(referenceDate)
  let employersNotified = 0
  let totalDeductions = 0

  for (const [employerId, deductions] of grouped.entries()) {
    const employer = employerStore.findById(employerId)
    if (!employer?.monthlyDeductionWebhookUrl) continue

    const payload = {
      event: 'salary_deduction.advance_notice',
      employerId,
      payCycle: {
        periodMonth: deductions[0]?.periodMonth,
        periodYear: deductions[0]?.periodYear,
      },
      deductions,
      generatedAt: new Date().toISOString(),
    }

    try {
      const res = await fetch(employer.monthlyDeductionWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        employersNotified += 1
        totalDeductions += deductions.length
      } else {
        logger.warn('Employer advance notice webhook failed', {
          employerId,
          status: res.status,
        })
      }
    } catch (error) {
      logger.error('Employer advance notice webhook error', {
        employerId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { employersNotified, totalDeductions }
}
