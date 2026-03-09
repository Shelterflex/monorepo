import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PostgresReceiptRepository, IndexedReceipt } from './receipt-repository.js'
import { getPool } from '../db.js'
import { TxType } from '../outbox/types.js'

vi.mock('../db.js', () => ({
  getPool: vi.fn()
}))

describe('PostgresReceiptRepository', () => {
  let repo: PostgresReceiptRepository
  let mockPool: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockPool = {
      query: vi.fn()
    }
    ;(getPool as any).mockResolvedValue(mockPool)
    repo = new PostgresReceiptRepository()
  })

  const sampleReceipt: IndexedReceipt = {
    txId: 'tx123',
    txType: TxType.STAKE,
    dealId: 'deal123',
    amountUsdc: '100.00',
    externalRefHash: 'hash123',
    ledger: 1000,
    indexedAt: new Date('2024-01-01T00:00:00Z')
  }

  it('should upsert receipts correctly', async () => {
    await repo.upsertMany([sampleReceipt])

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO indexed_receipts'),
      expect.arrayContaining([sampleReceipt.txId, sampleReceipt.txType, sampleReceipt.dealId])
    )
  })

  it('should get checkpoint correctly', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{ last_ledger: '1234' }]
    })

    const checkpoint = await repo.getCheckpoint()
    expect(checkpoint).toBe(1234)
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining("SELECT last_ledger FROM indexer_checkpoint WHERE name = 'receipt_indexer'")
    )
  })

  it('should return null when no checkpoint exists', async () => {
    mockPool.query.mockResolvedValue({ rows: [] })
    const checkpoint = await repo.getCheckpoint()
    expect(checkpoint).toBeNull()
  })

  it('should save checkpoint correctly', async () => {
    await repo.saveCheckpoint(5000)
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO indexer_checkpoint'),
      [5000]
    )
  })

  it('should query receipts with filters and pagination', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ count: '100' }] }) // count query
      .mockResolvedValueOnce({ rows: [] }) // data query

    const result = await repo.query({ dealId: 'deal1', page: 2, pageSize: 10 })

    expect(result.total).toBe(100)
    expect(result.page).toBe(2)
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT COUNT(*) FROM indexed_receipts'),
      ['deal1']
    )
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT * FROM indexed_receipts'),
      ['deal1', 10, 10]
    )
  })
})
