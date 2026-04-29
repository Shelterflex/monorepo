import { logger } from '../utils/logger.js'
import {
  listPendingLedgerEvents,
  markLedgerEventStatus,
  findProviderEventByRef,
  listProviderEventsByRef,
  persistMismatch,
} from './store.js'
import type { LedgerEvent, ProviderEvent, ToleranceRule } from './types.js'
import { DEFAULT_TOLERANCE_RULES } from './types.js'

export type ReconciliationResult = {
  matched: number
  mismatches: number
  skipped: number
}

function getRule(rail: string, rules: ToleranceRule[]): ToleranceRule {
  return rules.find((r) => r.rail === rail) ?? {
    rail,
    toleranceMinor: 0n,
    maxDelaySeconds: 3600,
    maxResolutionAttempts: 3,
  }
}

// ── Classifiers ───────────────────────────────────────────────────────────────

function isAmountMismatch(
  expected: bigint,
  actual: bigint,
  toleranceMinor: bigint,
): boolean {
  const diff = expected > actual ? expected - actual : actual - expected
  return diff > toleranceMinor
}

function isDelayedSettlement(
  ledger: LedgerEvent,
  provider: ProviderEvent,
  maxDelaySeconds: number,
): boolean {
  const diffMs = Math.abs(provider.occurredAt.getTime() - ledger.occurredAt.getTime())
  return diffMs > maxDelaySeconds * 1000
}

function isDuplicate(providerEvents: ProviderEvent[]): boolean {
  return providerEvents.filter((e) => e.eventType === 'debit').length > 1
}

// ── Core matching ─────────────────────────────────────────────────────────────

async function reconcileLedgerEvent(
  ledger: LedgerEvent,
  rules: ToleranceRule[],
): Promise<'matched' | 'mismatch' | 'skipped'> {
  const rule = getRule(ledger.rail, rules)
  const trace = { internalRef: ledger.internalRef, rail: ledger.rail, ledgerEventId: ledger.id }

  // 1. Find the PSP settlement event for this internal ref
  const providerEvent = await findProviderEventByRef(ledger.internalRef)

  if (!providerEvent) {
    // No PSP event yet — check if we're past the max delay window
    const ageMs = Date.now() - ledger.occurredAt.getTime()
    if (ageMs > rule.maxDelaySeconds * 1000) {
      await persistMismatch({
        mismatchClass: 'missing_credit',
        ledgerEventId: ledger.id,
        toleranceMinor: rule.toleranceMinor,
        expectedAmountMinor: ledger.amountMinor,
        traceContext: { ...trace, ageMs },
      })
      await markLedgerEventStatus(ledger.id, 'unmatched')
      logger.warn('[reconciliation] Missing credit detected', trace)
      return 'mismatch'
    }
    // Still within delay window — skip for now
    return 'skipped'
  }

  // 2. Check for duplicates
  const allProviderEvents = await listProviderEventsByRef(ledger.internalRef)
  if (isDuplicate(allProviderEvents)) {
    await persistMismatch({
      mismatchClass: 'duplicate_debit',
      ledgerEventId: ledger.id,
      providerEventId: providerEvent.id,
      toleranceMinor: rule.toleranceMinor,
      expectedAmountMinor: ledger.amountMinor,
      actualAmountMinor: providerEvent.amountMinor,
      traceContext: { ...trace, duplicateCount: allProviderEvents.length },
    })
    await markLedgerEventStatus(ledger.id, 'unmatched')
    logger.warn('[reconciliation] Duplicate debit detected', trace)
    return 'mismatch'
  }

  // 3. Check for amount mismatch
  if (isAmountMismatch(ledger.amountMinor, providerEvent.amountMinor, rule.toleranceMinor)) {
    await persistMismatch({
      mismatchClass: 'amount_mismatch',
      ledgerEventId: ledger.id,
      providerEventId: providerEvent.id,
      toleranceMinor: rule.toleranceMinor,
      expectedAmountMinor: ledger.amountMinor,
      actualAmountMinor: providerEvent.amountMinor,
      traceContext: trace,
    })
    await markLedgerEventStatus(ledger.id, 'unmatched')
    logger.warn('[reconciliation] Amount mismatch detected', {
      ...trace,
      expected: ledger.amountMinor.toString(),
      actual: providerEvent.amountMinor.toString(),
    })
    return 'mismatch'
  }

  // 4. Check for delayed settlement (event arrived but was very late)
  if (isDelayedSettlement(ledger, providerEvent, rule.maxDelaySeconds)) {
    await persistMismatch({
      mismatchClass: 'delayed_settlement',
      ledgerEventId: ledger.id,
      providerEventId: providerEvent.id,
      toleranceMinor: rule.toleranceMinor,
      expectedAmountMinor: ledger.amountMinor,
      actualAmountMinor: providerEvent.amountMinor,
      traceContext: {
        ...trace,
        ledgerOccurredAt: ledger.occurredAt.toISOString(),
        providerOccurredAt: providerEvent.occurredAt.toISOString(),
      },
    })
    // Delayed settlement is still a match on amount — mark matched
    await markLedgerEventStatus(ledger.id, 'matched')
    logger.warn('[reconciliation] Delayed settlement detected', trace)
    return 'mismatch'
  }

  // 5. Clean match
  await markLedgerEventStatus(ledger.id, 'matched')
  logger.info('[reconciliation] Ledger event matched', trace)
  return 'matched'
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function runReconciliationPass(
  rules: ToleranceRule[] = DEFAULT_TOLERANCE_RULES,
  batchSize = 200,
): Promise<ReconciliationResult> {
  const result: ReconciliationResult = { matched: 0, mismatches: 0, skipped: 0 }

  const pendingEvents = await listPendingLedgerEvents(batchSize)
  logger.info('[reconciliation] Starting pass', { count: pendingEvents.length })

  for (const event of pendingEvents) {
    try {
      const outcome = await reconcileLedgerEvent(event, rules)
      if (outcome === 'matched') result.matched++
      else if (outcome === 'mismatch') result.mismatches++
      else result.skipped++
    } catch (err) {
      logger.error('[reconciliation] Error reconciling event', {
        ledgerEventId: event.id,
        error: err instanceof Error ? err.message : String(err),
      })
      result.skipped++
    }
  }

  logger.info('[reconciliation] Pass complete', result)
  return result
}
