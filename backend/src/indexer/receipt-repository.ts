import { TxType } from '../outbox/types.js'
import { getPool } from '../db.js'

export interface IndexedReceipt {
     txId: string; txType: TxType; dealId: string; listingId?: string
     amountUsdc: string; amountNgn?: number; fxRate?: number; fxProvider?: string
     from?: string; to?: string; externalRefHash: string; metadataHash?: string
     ledger: number; indexedAt: Date
}
export interface ReceiptQuery { dealId?: string; txType?: TxType; page?: number; pageSize?: number }
export interface PagedReceipts { data: IndexedReceipt[]; total: number; page: number; pageSize: number }

export interface ReceiptRepository {
     upsertMany(receipts: IndexedReceipt[]): Promise<void>
     findByDealId(dealId: string): Promise<IndexedReceipt[]>
     query(params: ReceiptQuery): Promise<PagedReceipts>
     getCheckpoint(): Promise<number | null>
     saveCheckpoint(ledger: number): Promise<void>
}

export class StubReceiptRepository implements ReceiptRepository {
     private store = new Map<string, IndexedReceipt>()
     private checkpoint: number | null = null

     async upsertMany(receipts: IndexedReceipt[]) { for (const r of receipts) this.store.set(r.txId, r) }
     async findByDealId(dealId: string) { return [...this.store.values()].filter(r => r.dealId === dealId) }
     async query({ dealId, txType, page = 1, pageSize = 20 }: ReceiptQuery): Promise<PagedReceipts> {
          let r = [...this.store.values()]
          if (dealId) r = r.filter(x => x.dealId === dealId)
          if (txType) r = r.filter(x => x.txType === txType)
          return { data: r.slice((page - 1) * pageSize, page * pageSize), total: r.length, page, pageSize }
     }
     async getCheckpoint() { return this.checkpoint }
     async saveCheckpoint(ledger: number) { this.checkpoint = ledger }
}

export class PostgresReceiptRepository implements ReceiptRepository {
     private async pool() {
          const pool = await getPool()
          if (!pool) throw new Error('Postgres pool not available')
          return pool
     }

     async upsertMany(receipts: IndexedReceipt[]): Promise<void> {
          if (!receipts.length) return
          const pool = await this.pool()
          
          for (const r of receipts) {
               await pool.query(
                    `INSERT INTO indexed_receipts (
                         tx_id, tx_type, deal_id, listing_id, amount_usdc, amount_ngn, 
                         fx_rate, fx_provider, sender, receiver, external_ref_hash, 
                         metadata_hash, ledger, indexed_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                    ON CONFLICT (tx_id) DO UPDATE SET
                         tx_type = EXCLUDED.tx_type,
                         deal_id = EXCLUDED.deal_id,
                         listing_id = EXCLUDED.listing_id,
                         amount_usdc = EXCLUDED.amount_usdc,
                         amount_ngn = EXCLUDED.amount_ngn,
                         fx_rate = EXCLUDED.fx_rate,
                         fx_provider = EXCLUDED.fx_provider,
                         sender = EXCLUDED.sender,
                         receiver = EXCLUDED.receiver,
                         external_ref_hash = EXCLUDED.external_ref_hash,
                         metadata_hash = EXCLUDED.metadata_hash,
                         ledger = EXCLUDED.ledger,
                         indexed_at = EXCLUDED.indexed_at`,
                    [
                         r.txId, r.txType, r.dealId, r.listingId ?? null, r.amountUsdc, r.amountNgn ?? null,
                         r.fxRate ?? null, r.fxProvider ?? null, r.from ?? null, r.to ?? null,
                         r.externalRefHash, r.metadataHash ?? null, r.ledger, r.indexedAt
                    ]
               )
          }
     }

     async findByDealId(dealId: string): Promise<IndexedReceipt[]> {
          const pool = await this.pool()
          const { rows } = await pool.query(
               `SELECT * FROM indexed_receipts WHERE deal_id = $1 ORDER BY indexed_at DESC`,
               [dealId]
          )
          return rows.map(this.mapRow)
     }

     async query({ dealId, txType, page = 1, pageSize = 20 }: ReceiptQuery): Promise<PagedReceipts> {
          const pool = await this.pool()
          const offset = (page - 1) * pageSize
          
          let filter = 'WHERE 1=1'
          const params: any[] = []
          
          if (dealId) {
               params.push(dealId)
               filter += ` AND deal_id = $${params.length}`
          }
          if (txType) {
               params.push(txType)
               filter += ` AND tx_type = $${params.length}`
          }

          const countRes = await pool.query(`SELECT COUNT(*) FROM indexed_receipts ${filter}`, params)
          const total = parseInt(countRes.rows[0].count, 10)

          const dataParams = [...params, pageSize, offset]
          const { rows } = await pool.query(
               `SELECT * FROM indexed_receipts ${filter} ORDER BY indexed_at DESC LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
               dataParams
          )

          return { data: rows.map(this.mapRow), total, page, pageSize }
     }

     async getCheckpoint(): Promise<number | null> {
          const pool = await this.pool()
          const { rows } = await pool.query(
               `SELECT last_ledger FROM indexer_checkpoint WHERE name = 'receipt_indexer'`
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
               [ledger]
          )
     }

     private mapRow(row: any): IndexedReceipt {
          return {
               txId: row.tx_id,
               txType: row.tx_type as TxType,
               dealId: row.deal_id,
               listingId: row.listing_id,
               amountUsdc: row.amount_usdc,
               amountNgn: row.amount_ngn ? parseFloat(row.amount_ngn) : undefined,
               fxRate: row.fx_rate ? parseFloat(row.fx_rate) : undefined,
               fxProvider: row.fx_provider,
               from: row.sender,
               to: row.receiver,
               externalRefHash: row.external_ref_hash,
               metadataHash: row.metadata_hash,
               ledger: parseInt(row.ledger, 10),
               indexedAt: new Date(row.indexed_at)
          }
     }
}