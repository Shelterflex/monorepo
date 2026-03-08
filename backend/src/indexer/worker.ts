import { SorobanAdapter } from '../soroban/adapter.js'
import { ReceiptRepository } from './receipt-repository.js'
import { parseReceiptEvent } from './event-parser.js'

export interface IndexerConfig { pollIntervalMs: number; startLedger?: number }

export class ReceiptIndexer {
     private running = false
     private lastLedger: number | null = null

     constructor(
          private adapter: SorobanAdapter,
          private repo: ReceiptRepository,
          private config: IndexerConfig
     ) { }

     async start() {
          if (this.running) return
          this.running = true
          this.lastLedger = (await this.repo.getCheckpoint()) ?? this.config.startLedger ?? null
          console.log(`[Indexer] Starting from ledger: ${this.lastLedger ?? 'latest'}`)
          while (this.running) {
               try { await this.poll() } catch (e) { console.error('[Indexer] Poll error:', e) }
               await new Promise(r => setTimeout(r, this.config.pollIntervalMs))
          }
     }

     stop() { this.running = false }

     private async poll() {
          const events = await this.adapter.getReceiptEvents(this.lastLedger)
          if (!events || !events.length) return
          await this.repo.upsertMany(events.map(parseReceiptEvent))
          const max = Math.max(...events.map(e => e.ledger))
          await this.repo.saveCheckpoint(max)
          this.lastLedger = max
          console.log(`[Indexer] Indexed ${events.length} receipt(s) up to ledger ${max}`)
     }
}