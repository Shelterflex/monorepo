import { TxType } from '../outbox/types.js'
import { getPool } from '../db.js'

export interface IndexedReceipt {
  txId: string; txType: TxType; dealId: string; listingId?: string
  amountUsdc: string; amountNgn?: number; fxRate?: number; fxProvider?: string
  from?: string; to?: string; externalRefHash: string; metadataHash?: string
  ledger: number; indexedAt: Date
}
export interface ReceiptQuery {
  dealId?: string
  txType?: TxType
  fromAddress?: string
  toAddress?: string
  fromDate?: Date
  toDate?: Date
  page?: number
  pageSize?: number
}
export interface PagedReceipts { data: IndexedReceipt[]; total: number; page: number; pageSize: number }

export interface ReceiptRepository {
  upsertMany(receipts: IndexedReceipt[]): Promise<void>
  findByDealId(dealId: string): Promise<IndexedReceipt[]>
  findByTxId(txId: string): Promise<IndexedReceipt | null>
  query(params: ReceiptQuery): Promise<PagedReceipts>
  getCheckpoint(): Promise<number | null>
  saveCheckpoint(ledger: number): Promise<void>
}

export class StubReceiptRepository implements ReceiptRepository {
  private store = new Map<string, IndexedReceipt>()
  private checkpoint: number | null = null

  async upsertMany(receipts: IndexedReceipt[]) { for (const r of receipts) this.store.set(r.txId, r) }
  async findByDealId(dealId: string) { return [...this.store.values()].filter(r => r.dealId === dealId) }
  async findByTxId(txId: string) { return this.store.get(txId) || null }
  async query({ dealId, txType, fromAddress, toAddress, fromDate, toDate, page = 1, pageSize = 20 }: ReceiptQuery): Promise<PagedReceipts> {
    let r = [...this.store.values()]
    if (dealId) r = r.filter(x => x.dealId === dealId)
    if (txType) r = r.filter(x => x.txType === txType)
    if (fromAddress) r = r.filter(x => x.from === fromAddress)
    if (toAddress) r = r.filter(x => x.to === toAddress)
    if (fromDate) r = r.filter(x => x.indexedAt >= fromDate)
    if (toDate) r = r.filter(x => x.indexedAt <= toDate)
    return { data: r.slice((page - 1) * pageSize, page * pageSize), total: r.length, page, pageSize }
  }
  async getCheckpoint() { return this.checkpoint }
  async saveCheckpoint(ledger: number) { this.checkpoint = ledger }
}

const COLS = [
  'tx_id', 'tx_type', 'deal_id', 'listing_id', 'amount_usdc', 'amount_ngn',
  'fx_rate', 'fx_provider', 'sender', 'receiver', 'external_ref_hash',
  'metadata_hash', 'ledger', 'indexed_at',
] as const

function receiptToRow(r: IndexedReceipt): unknown[] {
  return [
    r.txId, r.txType, r.dealId, r.listingId ?? null, r.amountUsdc, r.amountNgn ?? null,
    r.fxRate ?? null, r.fxProvider ?? null, r.from ?? null, r.to ?? null,
    r.externalRefHash, r.metadataHash ?? null, r.ledger, r.indexedAt,
  ]
}

export class PostgresReceiptRepository implements ReceiptRepository {
  private async pool() {
    const pool = await getPool()
    if (!pool) throw new Error('Postgres pool not available')
    return pool
  }

  /**
   * Batch-upserts all receipts in a single SQL statement.
   * Each receipt maps to `COLS.length` parameters — no per-row round-trips.
   */
  async upsertMany(receipts: IndexedReceipt[]): Promise<void> {
    if (!receipts.length) return
    const pool = await this.pool()
    const n = COLS.length

    // Build ($1,$2,...), ($n+1,...) style value placeholders
    const valuePlaceholders = receipts
      .map((_, i) => `(${COLS.map((_, j) => `$${i * n + j + 1}`).join(', ')})`)
      .join(',\n')

    const params = receipts.flatMap(receiptToRow)

    await pool.query(
      `INSERT INTO indexed_receipts (${COLS.join(', ')})
       VALUES ${valuePlaceholders}
       ON CONFLICT (tx_id) DO UPDATE SET
         tx_type           = EXCLUDED.tx_type,
         deal_id           = EXCLUDED.deal_id,
         listing_id        = EXCLUDED.listing_id,
         amount_usdc       = EXCLUDED.amount_usdc,
         amount_ngn        = EXCLUDED.amount_ngn,
         fx_rate           = EXCLUDED.fx_rate,
         fx_provider       = EXCLUDED.fx_provider,
         sender            = EXCLUDED.sender,
         receiver          = EXCLUDED.receiver,
         external_ref_hash = EXCLUDED.external_ref_hash,
         metadata_hash     = EXCLUDED.metadata_hash,
         ledger            = EXCLUDED.ledger,
         indexed_at        = EXCLUDED.indexed_at`,
      params,
    )
  }

  async findByDealId(dealId: string): Promise<IndexedReceipt[]> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `SELECT * FROM indexed_receipts WHERE deal_id = $1 ORDER BY indexed_at DESC`,
      [dealId],
    )
    return rows.map(this.mapRow)
  }

  async findByTxId(txId: string): Promise<IndexedReceipt | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `SELECT * FROM indexed_receipts WHERE tx_id = $1 LIMIT 1`,
      [txId],
    )
    return rows.length ? this.mapRow(rows[0]) : null
  }

  async query({ dealId, txType, fromAddress, toAddress, fromDate, toDate, page = 1, pageSize = 20 }: ReceiptQuery): Promise<PagedReceipts> {
    const pool = await this.pool()
    const offset = (page - 1) * pageSize

    const conditions: string[] = []
    const params: unknown[] = []

    if (dealId)      { params.push(dealId);      conditions.push(`deal_id = $${params.length}`) }
    if (txType)      { params.push(txType);      conditions.push(`tx_type = $${params.length}`) }
    if (fromAddress) { params.push(fromAddress); conditions.push(`sender = $${params.length}`) }
    if (toAddress)   { params.push(toAddress);   conditions.push(`receiver = $${params.length}`) }
    if (fromDate)    { params.push(fromDate);    conditions.push(`indexed_at >= $${params.length}`) }
    if (toDate)      { params.push(toDate);      conditions.push(`indexed_at <= $${params.length}`) }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) FROM indexed_receipts ${where}`,
      params,
    )
    const total = parseInt(countRows[0].count, 10)

    const dataParams = [...params, pageSize, offset]
    const limitIdx = dataParams.length - 1
    const offsetIdx = dataParams.length
    const { rows } = await pool.query(
      `SELECT * FROM indexed_receipts ${where} ORDER BY indexed_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      dataParams,
    )

    return { data: rows.map(this.mapRow), total, page, pageSize }
  }

  async getCheckpoint(): Promise<number | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `SELECT last_ledger FROM indexer_checkpoint WHERE name = 'receipt_indexer'`,
    )
    if (!rows.length) return null
    return parseInt(rows[0].last_ledger, 10)
  }

  async saveCheckpoint(ledger: number): Promise<void> {
    const pool = await this.pool()
    await pool.query(
      `INSERT INTO indexer_checkpoint (name, last_ledger, updated_at)
       VALUES ('receipt_indexer', $1, NOW())
       ON CONFLICT (name) DO UPDATE SET last_ledger = EXCLUDED.last_ledger, updated_at = NOW()`,
      [ledger],
    )
  }

  private mapRow(row: Record<string, unknown>): IndexedReceipt {
    return {
      txId: row.tx_id as string,
      txType: row.tx_type as TxType,
      dealId: row.deal_id as string,
      listingId: row.listing_id as string | undefined,
      amountUsdc: row.amount_usdc as string,
      amountNgn: row.amount_ngn != null ? parseFloat(row.amount_ngn as string) : undefined,
      fxRate: row.fx_rate != null ? parseFloat(row.fx_rate as string) : undefined,
      fxProvider: row.fx_provider as string | undefined,
      from: row.sender as string | undefined,
      to: row.receiver as string | undefined,
      externalRefHash: row.external_ref_hash as string,
      metadataHash: row.metadata_hash as string | undefined,
      ledger: parseInt(row.ledger as string, 10),
      indexedAt: new Date(row.indexed_at as string),
    }
  }
}