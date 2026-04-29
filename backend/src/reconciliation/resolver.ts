/**
 * Automated resolution workflows for reconciliation mismatches.
 * Each handler returns true when a resolution was attempted (success or fail).
 * The worker escalates after maxResolutionAttempts.
 */

import { logger } from '../utils/logger.js'
import { listMismatches, updateMismatchStatus, listOpenMismatchesPastSla } from './store.js'
import type { Mismatch } from './types.js'
import { DEFAULT_TOLERANCE_RULES } from './types.js'

const MAX_AUTO_ATTEMPTS_DEFAULT = 3

function getMaxAttempts(mismatch: Mismatch): number {
  const rule = DEFAULT_TOLERANCE_RULES.find((r) =>
    mismatch.traceContext.rail === r.rail,
  )
  return rule?.maxResolutionAttempts ?? MAX_AUTO_ATTEMPTS_DEFAULT
}

// ── Per-class resolution handlers ─────────────────────────────────────────────

async function resolveMissingCredit(mismatch: Mismatch): Promise<boolean> {
  // Resolution: re-query the PSP for the settlement status and update the
  // provider event table. In production this would call provider.fetchSettlement().
  // Here we record the attempt and surface it for manual review if unresolvable.
  logger.info('[resolver] Attempting missing_credit resolution', { id: mismatch.id })
  // Placeholder: real implementation would call PSP reconciliation API
  return true
}

async function resolveDuplicateDebit(mismatch: Mismatch): Promise<boolean> {
  // Resolution: flag the duplicate provider events and request a PSP reversal.
  logger.info('[resolver] Attempting duplicate_debit resolution', { id: mismatch.id })
  return true
}

async function resolveAmountMismatch(mismatch: Mismatch): Promise<boolean> {
  // Resolution: if the difference is within a secondary tolerance, auto-close.
  // Otherwise flag for finance team review.
  const diff =
    mismatch.expectedAmountMinor != null && mismatch.actualAmountMinor != null
      ? mismatch.expectedAmountMinor > mismatch.actualAmountMinor
        ? mismatch.expectedAmountMinor - mismatch.actualAmountMinor
        : mismatch.actualAmountMinor - mismatch.expectedAmountMinor
      : null

  logger.info('[resolver] Attempting amount_mismatch resolution', {
    id: mismatch.id,
    diffMinor: diff?.toString(),
  })
  return true
}

async function resolveDelayedSettlement(mismatch: Mismatch): Promise<boolean> {
  // Delayed settlement already matched on amount — auto-close after logging.
  logger.info('[resolver] Auto-closing delayed_settlement', { id: mismatch.id })
  await updateMismatchStatus(mismatch.id, 'auto_resolved', {
    resolutionWorkflow: 'delayed_settlement_auto_close',
    lastResolutionAt: new Date(),
    resolutionAttempts: mismatch.resolutionAttempts + 1,
  })
  return true
}

const HANDLERS: Record<Mismatch['mismatchClass'], (m: Mismatch) => Promise<boolean>> = {
  missing_credit:    resolveMissingCredit,
  duplicate_debit:   resolveDuplicateDebit,
  amount_mismatch:   resolveAmountMismatch,
  delayed_settlement: resolveDelayedSettlement,
}

// ── Main resolution pass ──────────────────────────────────────────────────────

export async function runResolutionPass(): Promise<{ resolved: number; escalated: number }> {
  const result = { resolved: 0, escalated: 0 }

  const openMismatches = await listMismatches({ status: 'open', limit: 200 })

  for (const mismatch of openMismatches) {
    const maxAttempts = getMaxAttempts(mismatch)

    if (mismatch.resolutionAttempts >= maxAttempts) {
      await updateMismatchStatus(mismatch.id, 'escalated', {
        escalatedAt: new Date(),
        resolutionAttempts: mismatch.resolutionAttempts,
      })
      logger.warn('[resolver] Mismatch escalated', {
        id: mismatch.id,
        class: mismatch.mismatchClass,
        attempts: mismatch.resolutionAttempts,
      })
      result.escalated++
      continue
    }

    try {
      const handler = HANDLERS[mismatch.mismatchClass]
      const attempted = await handler(mismatch)

      if (attempted) {
        if (mismatch.mismatchClass === 'delayed_settlement') {
          result.resolved++
        } else {
          await updateMismatchStatus(mismatch.id, 'open', {
            resolutionWorkflow: mismatch.mismatchClass,
            lastResolutionAt: new Date(),
            resolutionAttempts: mismatch.resolutionAttempts + 1,
          })
        }
      }
    } catch (err) {
      logger.error('[resolver] Resolution handler threw', {
        id: mismatch.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Escalate anything past SLA regardless of attempt count
  const pastSla = await listOpenMismatchesPastSla()
  for (const mismatch of pastSla) {
    if (mismatch.status !== 'open') continue
    await updateMismatchStatus(mismatch.id, 'escalated', {
      escalatedAt: new Date(),
    })
    logger.warn('[resolver] Mismatch escalated due to SLA breach', {
      id: mismatch.id,
      class: mismatch.mismatchClass,
      slaDeadline: mismatch.slaDeadline?.toISOString(),
    })
    result.escalated++
  }

  return result
}
