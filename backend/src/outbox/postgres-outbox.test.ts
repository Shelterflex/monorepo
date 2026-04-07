import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PostgresOutboxStore, initOutboxStore, outboxStore } from './store.js'
import { getPool } from '../db.js'
import { TxType, OutboxStatus } from './types.js'
import { buildCanonicalString, computeTxId } from './canonicalization.js'

vi.mock('../db.js', () => ({ getPool: vi.fn() }))

// Stable canonical ref for tests
const SOURCE = 'stripe'
const REF = 'pi_test999'
const CANONICAL = buildCanonicalString(SOURCE, REF)
const TX_ID = computeTxId(SOURCE, REF)

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'uuid-1',
    tx_id: TX_ID,
    tx_type: TxType.RECEIPT,
    canonical_external_ref_v1: CANONICAL,
    status: OutboxStatus.PENDING,
    attempts: 0,
    last_error: '',
    aggregate_type: '',
    aggregate_id: '',
    event_type: '',
    retry_count: 0,
    next_retry_at: null,
    processed_at: null,
    payload: { dealId: 'deal-1' },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('PostgresOutboxStore', () => {
  let repo: PostgresOutboxStore
  let mockPool: { query: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPool = { query: vi.fn() }
    ;(getPool as ReturnType<typeof vi.fn>).mockResolvedValue(mockPool)
    repo = new PostgresOutboxStore()
  })

  it('create: inserts and returns the new row', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [makeRow()] })

    const item = await repo.create({ txType: TxType.RECEIPT, source: SOURCE, ref: REF, payload: { dealId: 'deal-1' } })

    expect(mockPool.query).toHaveBeenCalledTimes(1)
    const [sql, params] = mockPool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('INSERT INTO outbox_items')
    expect(sql).toContain('ON CONFLICT (canonical_external_ref_v1) DO NOTHING')
    expect(params).toContain(CANONICAL)
    expect(item.canonicalExternalRefV1).toBe(CANONICAL)
    expect(item.status).toBe(OutboxStatus.PENDING)
  })

  it('create: idempotent — falls back to SELECT when conflict resolved with no rows', async () => {
    // INSERT returns no rows (conflict) → SELECT returns existing
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })                 // INSERT → conflict
      .mockResolvedValueOnce({ rows: [makeRow()] })        // SELECT → existing

    const item = await repo.create({ txType: TxType.RECEIPT, source: SOURCE, ref: REF, payload: { dealId: 'deal-1' } })

    expect(mockPool.query).toHaveBeenCalledTimes(2)
    const [selectSql] = mockPool.query.mock.calls[1] as [string, unknown[]]
    expect(selectSql).toContain('SELECT * FROM outbox_items WHERE canonical_external_ref_v1')
    expect(item.id).toBe('uuid-1')
  })

  it('getById: queries by id', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [makeRow()] })
    const item = await repo.getById('uuid-1')
    expect(item).not.toBeNull()
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id = $1'), ['uuid-1'],
    )
  })

  it('getById: returns null when not found', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] })
    expect(await repo.getById('no-such')).toBeNull()
  })

  it('getByExternalRef: queries by canonical ref', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [makeRow()] })
    const item = await repo.getByExternalRef(SOURCE, REF)
    expect(item).not.toBeNull()
    const [, params] = mockPool.query.mock.calls[0] as [string, unknown[]]
    expect(params).toContain(CANONICAL)
  })

  it('listByStatus: returns mapped items', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [makeRow(), makeRow({ id: 'uuid-2' })] })
    const items = await repo.listByStatus(OutboxStatus.PENDING)
    expect(items).toHaveLength(2)
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE status = $1 ORDER BY created_at ASC'),
      [OutboxStatus.PENDING],
    )
  })

  it('updateStatus: sends UPDATE and increments attempts', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [makeRow({ status: OutboxStatus.FAILED, attempts: 1 })] })
    const updated = await repo.updateStatus('uuid-1', OutboxStatus.FAILED, { error: 'timeout' })
    expect(updated?.status).toBe(OutboxStatus.FAILED)
    expect(updated?.attempts).toBe(1)
    const [sql, params] = mockPool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('UPDATE outbox_items')
    expect(params).toContain('uuid-1')
    expect(params).toContain('timeout')
  })

  it('updateStatus: returns null when id not found', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] })
    expect(await repo.updateStatus('missing', OutboxStatus.SENT)).toBeNull()
  })

  it('listByDealId: filters by payload dealId', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [makeRow()] })
    await repo.listByDealId('deal-1')
    const [sql, params] = mockPool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain("payload->>'dealId'")
    expect(params).toContain('deal-1')
  })

  it('listAll: queries with DESC order and limit', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] })
    await repo.listAll(50)
    const [sql, params] = mockPool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('ORDER BY created_at DESC LIMIT')
    expect(params).toContain(50)
  })

  it('getHealthSummary: returns aggregated counts', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        pending: '3',
        sent: '10',
        failed: '2',
        dead: '1',
        total: '16',
        oldest_pending: '2026-01-01T00:00:00.000Z',
        oldest_failed: '2026-01-02T00:00:00.000Z',
      }],
    })

    const summary = await repo.getHealthSummary()
    expect(summary).toEqual({
      pending: 3,
      sent: 10,
      failed: 2,
      dead: 1,
      total: 16,
      oldestPending: '2026-01-01T00:00:00.000Z',
      oldestFailed: '2026-01-02T00:00:00.000Z',
    })
  })

  it('getHealthSummary: returns null dates when no pending/failed', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        pending: '0',
        sent: '5',
        failed: '0',
        dead: '0',
        total: '5',
        oldest_pending: null,
        oldest_failed: null,
      }],
    })

    const summary = await repo.getHealthSummary()
    expect(summary.oldestPending).toBeNull()
    expect(summary.oldestFailed).toBeNull()
  })
})

describe('outboxStore proxy + initOutboxStore', () => {
  it('default store is in-memory (no DATABASE_URL)', async () => {
    await outboxStore.clear()
    const item = await outboxStore.create({
      txType: TxType.RECEIPT,
      source: 'test',
      ref: 'ref-proxy-1',
      payload: {},
    })
    expect(item.id).toBeDefined()
    expect(item.status).toBe(OutboxStatus.PENDING)
    await outboxStore.clear()
  })

  it('initOutboxStore swaps the backing store', async () => {
    const fakeStore = {
      create: vi.fn().mockResolvedValue({ id: 'fake-id' }),
      getById: vi.fn(), getByExternalRef: vi.fn(),
      listByStatus: vi.fn(), updateStatus: vi.fn(),
      listByDealId: vi.fn(), listAll: vi.fn(), clear: vi.fn(),
      markDead: vi.fn(), getHealthSummary: vi.fn(),
    }
    initOutboxStore(fakeStore as never)

    await outboxStore.create({ txType: TxType.RECEIPT, source: 's', ref: 'r', payload: {} })
    expect(fakeStore.create).toHaveBeenCalledTimes(1)

    // Restore default for other tests
    // (the original singleton is restored by other test suites calling clear)
  })
})
