/**
 * Deal Progress Service
 *
 * Computes a deal's payment progress by reading TENANT_REPAYMENT receipts
 * from the outbox store (the ledger proxy).
 *
 * USDC is canonical. Only SENT outbox items (i.e. confirmed on-chain) are counted.
 */

import { OutboxStatus, TxType, type OutboxItem } from '../outbox/types.js'
import type { DealWithSchedule } from '../models/deal.js'
import { parseCanonicalString } from '../outbox/canonicalization.js'

export interface DealProgress {
  /** Total USDC paid across all on-chain TENANT_REPAYMENT receipts */
  totalPaidUsdc: string
  /** Number of TENANT_REPAYMENT receipts confirmed on-chain */
  periodsPaid: number
  /** termMonths minus periodsPaid, clamped to >= 0 */
  remainingPeriods: number
  /** ISO date of next scheduled payment; null if fully paid */
  nextDueDate: string | null
  /** txId of the most recent confirmed receipt; undefined if no payments yet */
  lastPaymentTxId?: string
  /** Source part of canonicalExternalRefV1 (e.g. "stripe"); undefined if no payments yet */
  lastPaymentExternalRefSource?: string
  /** Ref part of canonicalExternalRefV1 (e.g. "pi_abc123"); undefined if no payments yet */
  lastPaymentExternalRef?: string
}

/**
 * Compute deal progress from on-chain receipts.
 *
 * @param deal   - Deal with schedule (used for termMonths and due dates)
 * @param items  - All outbox items for this deal (any txType, any status)
 */
export function computeDealProgress(
  deal: DealWithSchedule,
  items: OutboxItem[],
): DealProgress {
  // Filter: only SENT TENANT_REPAYMENT receipts count as paid on-chain
  const paidReceipts = items.filter(
    (item) =>
      item.txType === TxType.TENANT_REPAYMENT &&
      item.status === OutboxStatus.SENT,
  )

  // Total USDC paid (sum amountUsdc from payload)
  const totalPaidUsdcNum = paidReceipts.reduce((acc, item) => {
    const amount = parseFloat(String(item.payload.amountUsdc ?? '0'))
    return acc + (isNaN(amount) ? 0 : amount)
  }, 0)

  const periodsPaid = paidReceipts.length
  const remainingPeriods = Math.max(0, deal.termMonths - periodsPaid)

  // Next due date: look at schedule index = periodsPaid (0-indexed)
  const nextScheduleItem = deal.schedule[periodsPaid] ?? null
  const nextDueDate = nextScheduleItem ? nextScheduleItem.dueDate : null

  // Last payment: most recent receipt (items are sorted ascending, so last = most recent)
  const lastReceipt = paidReceipts[paidReceipts.length - 1]

  let lastPaymentTxId: string | undefined
  let lastPaymentExternalRefSource: string | undefined
  let lastPaymentExternalRef: string | undefined

  if (lastReceipt) {
    lastPaymentTxId = lastReceipt.txId

    // Parse canonicalExternalRefV1 format: "v1|source=<source>|ref=<ref>"
    try {
      const parsed = parseCanonicalString(lastReceipt.canonicalExternalRefV1)
      lastPaymentExternalRefSource = parsed.source
      lastPaymentExternalRef = parsed.ref
    } catch {
      // Fallback for old format or parsing errors
      const separatorIndex = lastReceipt.canonicalExternalRefV1.indexOf(':')
      if (separatorIndex !== -1) {
        lastPaymentExternalRefSource = lastReceipt.canonicalExternalRefV1.slice(0, separatorIndex)
        lastPaymentExternalRef = lastReceipt.canonicalExternalRefV1.slice(separatorIndex + 1)
      }
    }
  }

  return {
    totalPaidUsdc: totalPaidUsdcNum.toFixed(6),
    periodsPaid,
    remainingPeriods,
    nextDueDate,
    ...(lastPaymentTxId !== undefined && { lastPaymentTxId }),
    ...(lastPaymentExternalRefSource !== undefined && { lastPaymentExternalRefSource }),
    ...(lastPaymentExternalRef !== undefined && { lastPaymentExternalRef }),
  }
}
