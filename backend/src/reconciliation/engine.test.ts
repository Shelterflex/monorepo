import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runReconciliationPass } from './engine.js'
import * as store from './store.js'
import type { LedgerEvent, ProviderEvent } from './types.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeLedger(overrides: Partial<LedgerEvent> = {}): LedgerEvent {
  return {
    id: 'ledger-1',
    eventType: 'credit',
    amountMinor: 100_000n,
    currency: 'NGN',
    internalRef: 'ref-001',
    rail: 'paystack',
    status: 'pending',
    occurredAt: new Date('2026-01-01T10:00:00Z'),
    createdAt: new Date('2026-01-01T10:00:00Z'),
    ...overrides,
  }
}

function makeProvider(overrides: Partial<ProviderEvent> = {}): ProviderEvent {
  return {
    id: 'provider-1',
    provider: 'paystack',
    providerEventId: 'ps_evt_001',
    eventType: 'credit',
    amountMinor: 100_000n,
    currency: 'NGN',
    internalRef: 'ref-001',
    rawStatus: 'success',
    occurredAt: new Date('2026-01-01T10:00:30Z'),
    createdAt: new Date('2026-01-01T10:00:30Z'),
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('reconciliation engine', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('marks a clean match when amounts and timing align', async () => {
    vi.spyOn(store, 'listPendingLedgerEvents').mockResolvedValue([makeLedger()])
    vi.spyOn(store, 'findProviderEventByRef').mockResolvedValue(makeProvider())
    vi.spyOn(store, 'listProviderEventsByRef').mockResolvedValue([makeProvider()])
    const markStatus = vi.spyOn(store, 'markLedgerEventStatus').mockResolvedValue()
    const persistMismatch = vi.spyOn(store, 'persistMismatch').mockResolvedValue({} as any)

    const result = await runReconciliationPass()

    expect(result.matched).toBe(1)
    expect(result.mismatches).toBe(0)
    expect(markStatus).toHaveBeenCalledWith('ledger-1', 'matched')
    expect(persistMismatch).not.toHaveBeenCalled()
  })

  it('detects missing_credit when provider event is absent and delay window has passed', async () => {
    const oldEvent = makeLedger({
      occurredAt: new Date(Date.now() - 7_200_000), // 2 hours ago
    })
    vi.spyOn(store, 'listPendingLedgerEvents').mockResolvedValue([oldEvent])
    vi.spyOn(store, 'findProviderEventByRef').mockResolvedValue(null)
    const markStatus = vi.spyOn(store, 'markLedgerEventStatus').mockResolvedValue()
    const persistMismatch = vi.spyOn(store, 'persistMismatch').mockResolvedValue({} as any)

    const result = await runReconciliationPass()

    expect(result.mismatches).toBe(1)
    expect(persistMismatch).toHaveBeenCalledWith(
      expect.objectContaining({ mismatchClass: 'missing_credit' }),
    )
    expect(markStatus).toHaveBeenCalledWith(oldEvent.id, 'unmatched')
  })

  it('skips an event that has no provider event but is still within the delay window', async () => {
    const recentEvent = makeLedger({ occurredAt: new Date() })
    vi.spyOn(store, 'listPendingLedgerEvents').mockResolvedValue([recentEvent])
    vi.spyOn(store, 'findProviderEventByRef').mockResolvedValue(null)
    const markStatus = vi.spyOn(store, 'markLedgerEventStatus').mockResolvedValue()
    const persistMismatch = vi.spyOn(store, 'persistMismatch').mockResolvedValue({} as any)

    const result = await runReconciliationPass()

    expect(result.skipped).toBe(1)
    expect(persistMismatch).not.toHaveBeenCalled()
    expect(markStatus).not.toHaveBeenCalled()
  })

  it('detects amount_mismatch when amounts differ beyond tolerance', async () => {
    vi.spyOn(store, 'listPendingLedgerEvents').mockResolvedValue([makeLedger()])
    vi.spyOn(store, 'findProviderEventByRef').mockResolvedValue(
      makeProvider({ amountMinor: 99_000n }), // 1000 minor units off — beyond 100 tolerance
    )
    vi.spyOn(store, 'listProviderEventsByRef').mockResolvedValue([
      makeProvider({ amountMinor: 99_000n }),
    ])
    const persistMismatch = vi.spyOn(store, 'persistMismatch').mockResolvedValue({} as any)
    vi.spyOn(store, 'markLedgerEventStatus').mockResolvedValue()

    const result = await runReconciliationPass()

    expect(result.mismatches).toBe(1)
    expect(persistMismatch).toHaveBeenCalledWith(
      expect.objectContaining({
        mismatchClass: 'amount_mismatch',
        expectedAmountMinor: 100_000n,
        actualAmountMinor: 99_000n,
      }),
    )
  })

  it('accepts an amount within the configured tolerance as a clean match', async () => {
    vi.spyOn(store, 'listPendingLedgerEvents').mockResolvedValue([makeLedger()])
    vi.spyOn(store, 'findProviderEventByRef').mockResolvedValue(
      makeProvider({ amountMinor: 99_950n }), // 50 minor units off — within 100 tolerance
    )
    vi.spyOn(store, 'listProviderEventsByRef').mockResolvedValue([
      makeProvider({ amountMinor: 99_950n }),
    ])
    const persistMismatch = vi.spyOn(store, 'persistMismatch').mockResolvedValue({} as any)
    vi.spyOn(store, 'markLedgerEventStatus').mockResolvedValue()

    const result = await runReconciliationPass()

    expect(result.matched).toBe(1)
    expect(persistMismatch).not.toHaveBeenCalled()
  })

  it('detects duplicate_debit when multiple debit provider events exist', async () => {
    const debit1 = makeProvider({ id: 'p1', eventType: 'debit', providerEventId: 'ps_1' })
    const debit2 = makeProvider({ id: 'p2', eventType: 'debit', providerEventId: 'ps_2' })
    vi.spyOn(store, 'listPendingLedgerEvents').mockResolvedValue([
      makeLedger({ eventType: 'debit' }),
    ])
    vi.spyOn(store, 'findProviderEventByRef').mockResolvedValue(debit1)
    vi.spyOn(store, 'listProviderEventsByRef').mockResolvedValue([debit1, debit2])
    const persistMismatch = vi.spyOn(store, 'persistMismatch').mockResolvedValue({} as any)
    vi.spyOn(store, 'markLedgerEventStatus').mockResolvedValue()

    const result = await runReconciliationPass()

    expect(result.mismatches).toBe(1)
    expect(persistMismatch).toHaveBeenCalledWith(
      expect.objectContaining({ mismatchClass: 'duplicate_debit' }),
    )
  })

  it('detects delayed_settlement when provider event arrived after the max delay window', async () => {
    const ledger = makeLedger({ occurredAt: new Date('2026-01-01T00:00:00Z') })
    const lateProvider = makeProvider({
      occurredAt: new Date('2026-01-01T02:30:00Z'), // 2.5 hours late — beyond 1h paystack default
    })
    vi.spyOn(store, 'listPendingLedgerEvents').mockResolvedValue([ledger])
    vi.spyOn(store, 'findProviderEventByRef').mockResolvedValue(lateProvider)
    vi.spyOn(store, 'listProviderEventsByRef').mockResolvedValue([lateProvider])
    const persistMismatch = vi.spyOn(store, 'persistMismatch').mockResolvedValue({} as any)
    vi.spyOn(store, 'markLedgerEventStatus').mockResolvedValue()

    const result = await runReconciliationPass()

    expect(result.mismatches).toBe(1)
    expect(persistMismatch).toHaveBeenCalledWith(
      expect.objectContaining({ mismatchClass: 'delayed_settlement' }),
    )
  })

  it('processes multiple events in a single pass and counts correctly', async () => {
    const oldRef = { occurredAt: new Date(Date.now() - 7_200_000) }
    vi.spyOn(store, 'listPendingLedgerEvents').mockResolvedValue([
      makeLedger({ id: 'l1', internalRef: 'ref-001' }),                    // will match
      makeLedger({ id: 'l2', internalRef: 'ref-002', ...oldRef }),        // missing_credit
      makeLedger({ id: 'l3', internalRef: 'ref-003', occurredAt: new Date() }), // skipped (no provider, still within window)
    ])
    vi.spyOn(store, 'findProviderEventByRef').mockImplementation(async (ref) => {
      if (ref === 'ref-001') return makeProvider()
      return null
    })
    vi.spyOn(store, 'listProviderEventsByRef').mockImplementation(async (ref) => {
      if (ref === 'ref-001') return [makeProvider()]
      return []
    })
    vi.spyOn(store, 'persistMismatch').mockResolvedValue({} as any)
    vi.spyOn(store, 'markLedgerEventStatus').mockResolvedValue()

    const result = await runReconciliationPass()

    expect(result.matched).toBe(1)
    expect(result.mismatches).toBe(1)
    expect(result.skipped).toBe(1)
  })

  it('continues processing remaining events when one throws', async () => {
    vi.spyOn(store, 'listPendingLedgerEvents').mockResolvedValue([
      makeLedger({ id: 'l1', internalRef: 'bad-ref' }),
      makeLedger({ id: 'l2', internalRef: 'good-ref' }),
    ])
    vi.spyOn(store, 'findProviderEventByRef').mockImplementation(async (ref) => {
      if (ref === 'bad-ref') throw new Error('PSP lookup failure')
      return makeProvider({ internalRef: ref })
    })
    vi.spyOn(store, 'listProviderEventsByRef').mockResolvedValue([makeProvider()])
    vi.spyOn(store, 'persistMismatch').mockResolvedValue({} as any)
    vi.spyOn(store, 'markLedgerEventStatus').mockResolvedValue()

    const result = await runReconciliationPass()

    expect(result.skipped).toBe(1)  // bad-ref — error counted as skipped
    expect(result.matched).toBe(1)  // good-ref — still processed
  })
})
