import type { LatePaymentConfig } from '../config/latePayment.js'
import { getLatePaymentConfig } from '../config/latePayment.js'
import {
  DealStatus,
  ScheduleItemStatus,
  type DealWithSchedule,
  type ScheduleItem,
} from '../models/deal.js'
import { dealStore } from '../models/dealStore.js'
import {
  calendarDayKey,
  daysPastDue,
  latePaymentEscalationStore,
  type EscalationStep,
} from '../models/latePaymentEscalationStore.js'
import { adminTaskStore } from '../models/adminTaskStore.js'
import { userApplicationBlockStore } from '../models/userApplicationBlockStore.js'
import { updateScheduleStatuses } from '../utils/scheduleGenerator.js'
import { lateFeeService } from './lateFeeService.js'
import { sendLatePaymentNotification } from './latePaymentNotifier.js'
import { logger } from '../utils/logger.js'
import { recordLatePaymentEscalation } from '../metrics.js'

export interface EscalationRunError {
  dealId: string
  error: string
}

export interface EscalationRunResult {
  dealsProcessed: number
  installmentsProcessed: number
  failedDeals: number
  errors: EscalationRunError[]
}

export class LatePaymentEscalationService {
  constructor(private config: LatePaymentConfig = getLatePaymentConfig()) {}

  private markEscalationStep(paymentId: string, step: EscalationStep): boolean {
    const applied = latePaymentEscalationStore.markStepOnce(paymentId, step)
    if (applied) {
      recordLatePaymentEscalation(step)
    }
    return applied
  }

  async processAllActiveDeals(now: Date = new Date()): Promise<EscalationRunResult> {
    const deals = await dealStore.listActiveDealsWithSchedules()
    let installmentsProcessed = 0
    let failedDeals = 0
    const errors: EscalationRunError[] = []

    for (const deal of deals) {
      try {
        if (deal.status === DealStatus.DEFAULTED || deal.status === DealStatus.COMPLETED) {
          continue
        }

        const paidPeriods = deal.schedule
          .filter((s) => s.status === ScheduleItemStatus.PAID)
          .map((s) => s.period)

        if (paidPeriods.length === deal.schedule.length) {
          continue
        }

        const refreshed = updateScheduleStatuses(deal.schedule, now, paidPeriods)

        for (const item of refreshed) {
          if (item.status === ScheduleItemStatus.PAID) continue
          if (item.status === ScheduleItemStatus.UPCOMING && daysPastDue(item.dueDate, now) < 0) {
            continue
          }

          await this.processInstallment(deal, item, now)
          installmentsProcessed += 1
        }
      } catch (error) {
        failedDeals += 1
        const message = error instanceof Error ? error.message : String(error)
        errors.push({ dealId: deal.dealId, error: message })
        logger.error(
          'Late payment escalation failed for deal; continuing with remaining deals',
          { dealId: deal.dealId },
          error,
        )
      }
    }

    return { dealsProcessed: deals.length, installmentsProcessed, failedDeals, errors }
  }

  private async processInstallment(
    deal: DealWithSchedule,
    item: ScheduleItem,
    now: Date,
  ): Promise<void> {
    const dpd = daysPastDue(item.dueDate, now)
    if (dpd < 0) return

    const paymentId = lateFeeService.ensurePaymentRecord(deal.dealId, item.period, item.amountNgn)
    const dayKey = calendarDayKey(now)

    if (dpd === 0) {
      await this.tryNotify(
        paymentId,
        't0_due_today',
        dayKey,
        deal.tenantId,
        'Payment due today',
        `Your rent instalment (period ${item.period}) for deal ${deal.dealId} is due today.`,
        `late:${paymentId}:t0:${dayKey}`,
        'payment_due',
        { dealId: deal.dealId, period: item.period, amountNgn: item.amountNgn },
      )
      return
    }

    if (dpd >= 1 && dpd <= this.config.gracePeriodDays) {
      await this.tryNotify(
        paymentId,
        't_grace_reminder',
        dayKey,
        deal.tenantId,
        'Payment reminder',
        `Your instalment (period ${item.period}) is ${dpd} day(s) overdue. Please pay within the grace period.`,
        `late:${paymentId}:grace:${dayKey}`,
        'payment_overdue',
        { dealId: deal.dealId, period: item.period, daysPastDue: dpd },
      )
      return
    }

    if (dpd >= this.config.lateFeeDay) {
      if (this.markEscalationStep(paymentId, 't4_late_fee')) {
        const { applied, lateFeeAmountNgn } = lateFeeService.applyLateFee(
          paymentId,
          this.config.lateFeeRate,
        )
        if (applied) {
          await sendLatePaymentNotification({
            userId: deal.tenantId,
            title: 'Late fee applied',
            body: `A late fee of ₦${lateFeeAmountNgn.toLocaleString()} has been added to period ${item.period}.`,
            dedupeKey: `late:${paymentId}:fee`,
            template: 'payment_overdue',
            data: { dealId: deal.dealId, period: item.period, lateFeeAmountNgn },
          })
        }
      }
    }

    if (dpd >= this.config.atRiskDay && deal.status === DealStatus.ACTIVE) {
      if (this.markEscalationStep(paymentId, 't7_at_risk')) {
        await dealStore.updateStatus(deal.dealId, DealStatus.AT_RISK)
        await sendLatePaymentNotification({
          userId: deal.tenantId,
          title: 'Account at risk',
          body: `Deal ${deal.dealId} has been flagged at risk due to overdue period ${item.period}.`,
          dedupeKey: `late:${paymentId}:atrisk`,
          template: 'payment_overdue',
          data: { dealId: deal.dealId, period: item.period },
        })
        await sendLatePaymentNotification({
          userId: deal.landlordId,
          title: 'Tenant payment at risk',
          body: `Deal ${deal.dealId} period ${item.period} is ${dpd} days overdue.`,
          dedupeKey: `late:${paymentId}:atrisk:landlord`,
          template: 'payment_overdue',
          data: { dealId: deal.dealId, period: item.period },
        })
      }
    }

    if (dpd >= this.config.adminEscalationDay) {
      if (this.markEscalationStep(paymentId, 't14_admin_escalation')) {
        adminTaskStore.create({
          type: 'late_payment_escalation',
          dealId: deal.dealId,
          tenantId: deal.tenantId,
          landlordId: deal.landlordId,
          paymentId,
          period: item.period,
          daysPastDue: dpd,
          summary: `Manual review required: ${dpd} days overdue on period ${item.period}`,
        })
        await sendLatePaymentNotification({
          userId: deal.tenantId,
          title: 'Payment escalation notice',
          body: `Your overdue payment (period ${item.period}) has been escalated for review.`,
          dedupeKey: `late:${paymentId}:escalation:tenant`,
          template: 'payment_overdue',
          data: { dealId: deal.dealId, period: item.period, daysPastDue: dpd },
        })
        await sendLatePaymentNotification({
          userId: deal.landlordId,
          title: 'Payment escalation notice',
          body: `Tenant on deal ${deal.dealId} period ${item.period} requires escalation (${dpd} days overdue).`,
          dedupeKey: `late:${paymentId}:escalation:landlord`,
          template: 'payment_overdue',
          data: { dealId: deal.dealId, period: item.period, daysPastDue: dpd },
        })
      }
    }

    if (dpd >= this.config.defaultDay) {
      if (this.markEscalationStep(paymentId, 't30_default')) {
        await dealStore.updateStatus(deal.dealId, DealStatus.DEFAULTED)
        userApplicationBlockStore.block(
          deal.tenantId,
          `Auto-default on deal ${deal.dealId} at T+${this.config.defaultDay}`,
        )
        adminTaskStore.create({
          type: 'landlord_protection',
          dealId: deal.dealId,
          tenantId: deal.tenantId,
          landlordId: deal.landlordId,
          paymentId,
          period: item.period,
          daysPastDue: dpd,
          summary: `Landlord protection workflow: deal ${deal.dealId} defaulted`,
        })
        await sendLatePaymentNotification({
          userId: deal.tenantId,
          title: 'Deal defaulted',
          body: `Deal ${deal.dealId} has been marked defaulted. New applications are blocked until resolved.`,
          dedupeKey: `late:${paymentId}:default:tenant`,
          template: 'payment_overdue',
          data: { dealId: deal.dealId },
        })
        await sendLatePaymentNotification({
          userId: deal.landlordId,
          title: 'Deal defaulted — landlord protection',
          body: `Deal ${deal.dealId} was auto-defaulted after ${dpd} days overdue. Landlord protection workflow started.`,
          dedupeKey: `late:${paymentId}:default:landlord`,
          template: 'payment_overdue',
          data: { dealId: deal.dealId },
        })
      }
    }
  }

  private async tryNotify(
    paymentId: string,
    step: EscalationStep,
    dayKey: string,
    userId: string,
    title: string,
    body: string,
    dedupeKey: string,
    template: 'payment_due' | 'payment_overdue',
    data: Record<string, unknown>,
  ): Promise<void> {
    if (!latePaymentEscalationStore.markApplied(paymentId, step, dayKey)) return
    await sendLatePaymentNotification({ userId, title, body, dedupeKey, template, data })
  }
}

export const latePaymentEscalationService = new LatePaymentEscalationService()
