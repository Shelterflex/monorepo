import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PostgresReceiptRepository, IndexedReceipt } from './receipt-repository.js'
import { getPool } from '../db.js'
import { TxType } from '../outbox/types.js'

vi.mock('../db.js', () => ({
  getPool: vi.fn()
}))

describe('PostgresReceiptRepository', () => {
  let repo: PostgresReceiptRepository
  let mockPool: { query: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPool = { query: vi.fn() }
    ;(getPool as ReturnType<typeof vi.fn>).mockResolvedValue(mockPool)
    repo = new PostgresReceiptRepository()
  })

  const sampleReceipt: IndexedReceipt = {
    txId: 'tx123',
    txType: TxType.STAKE,
    dealId: 'deal123',
    amountUsdc: '100.00',
    externalRefHash: 'hash123',
    ledger: 1000,
    indexedAt: new Date('2024-01-01T00:00:00Z'),
  }

  it('upserts a single receipt in one query', async () => {
    await repo.upsertMany([sampleReceipt])

    expect(mockPool.query).toHaveBeenCalledTimes(1)
    const [sql, params] = mockPool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('INSERT INTO indexed_receipts')
    expect(sql).toContain('ON CONFLICT (tx_id) DO UPDATE')
    expect(params).toContain(sampleReceipt.txId)
    expect(params).toContain(sampleReceipt.txType)
    expect(params).toContain(sampleReceipt.dealId)
  })

  it('upserts multiple receipts in a single batch query', async () => {
    const r2 = { ...sampleReceipt, txId: 'tx456', dealId: 'deal456' }
    await repo.upsertMany([sampleReceipt, r2])

    // Must be exactly one round-trip regardless of count
    expect(mockPool.query).toHaveBeenCalledTimes(1)
    const [sql, params] = mockPool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('INSERT INTO indexed_receipts')
    // 14 cols × 2 rows = 28 params
    expect(params).toHaveLength(28)
    expect(params).toContain('tx123')
    expect(params).toContain('tx456')
  })

  it('skips the query when receipts array is empty', async () => {
    await repo.upsertMany([])
    expect(mockPool.query).not.toHaveBeenCalled()
  })

  it('gets checkpoint correctly', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ last_ledger: '1234' }] })

    const checkpoint = await repo.getCheckpoint()
    expect(checkpoint).toBe(1234)
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining("SELECT last_ledger FROM indexer_checkpoint WHERE name = 'receipt_indexer'"),
    )
  })

  it('returns null when no checkpoint exists', async () => {
    mockPool.query.mockResolvedValue({ rows: [] })
    expect(await repo.getCheckpoint()).toBeNull()
  })

  it('saves checkpoint correctly', async () => {
    await repo.saveCheckpoint(5000)
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO indexer_checkpoint'),
      [5000],
    )
  })

  it('queries receipts with filters and correct pagination params', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ count: '100' }] }) // count
      .mockResolvedValueOnce({ rows: [] })                  // data

    const result = await repo.query({ dealId: 'deal1', page: 2, pageSize: 10 })

    expect(result.total).toBe(100)
    expect(result.page).toBe(2)
    expect(result.pageSize).toBe(10)

    // Count query
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT COUNT(*)'),
      ['deal1'],
    )
    // Data query: params = [dealId, pageSize, offset]
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT * FROM indexed_receipts'),
      ['deal1', 10, 10], // offset = (2-1)*10 = 10
    )
  })

  it('builds SQL conditions for fromAddress, toAddress, fromDate, and toDate', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ count: '5' }] })
      .mockResolvedValueOnce({ rows: [] })

    const fromDate = new Date('2024-01-01T00:00:00Z')
    const toDate = new Date('2024-12-31T00:00:00Z')

    await repo.query({ fromAddress: 'SENDER_A', toAddress: 'RCVR_B', fromDate, toDate })

    const [countSql, countParams] = mockPool.query.mock.calls[0] as [string, unknown[]]
    expect(countSql).toContain('sender = $1')
    expect(countSql).toContain('receiver = $2')
    expect(countSql).toContain('indexed_at >= $3')
    expect(countSql).toContain('indexed_at <= $4')
    expect(countParams).toEqual(['SENDER_A', 'RCVR_B', fromDate, toDate])
  })

  it('omits WHERE clause when no filters are given', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] })

    await repo.query({})

    const [countSql] = mockPool.query.mock.calls[0] as [string, unknown[]]
    expect(countSql).not.toContain('WHERE')
  })
})
