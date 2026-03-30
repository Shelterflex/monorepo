import { TimelockEvent } from './event-parser.js'
import { TimelockRepository } from './timelock-repository.js'
import { logger } from '../utils/logger.js'

export class TimelockProcessor {
  constructor(private repo: TimelockRepository) {}

  async processEvents(events: TimelockEvent[]): Promise<void> {
    if (events.length === 0) return

    for (const event of events) {
      try {
        switch (event.type) {
          case 'queued':
            await this.repo.upsert({
              txHash: event.txHash,
              target: event.target,
              functionName: event.functionName,
              args: event.args,
              eta: event.delay, // This was already corrected to absolute timestamp
              status: 'queued',
              ledger: event.ledger,
            })
            break

          case 'executed':
            await this.repo.updateStatus(event.txHash, 'executed', event.ledger)
            break

          case 'cancelled':
            await this.repo.updateStatus(event.txHash, 'cancelled', event.ledger)
            break
        }
      } catch (err) {
        logger.error('Failed to process timelock event', {
          txHash: event.txHash,
          type: event.type,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // Advance checkpoint to the highest ledger processed in this batch
    const maxLedger = Math.max(...events.map((e) => e.ledger))
    await this.repo.saveCheckpoint(maxLedger)
  }

  async getCheckpoint(): Promise<number | null> {
    return this.repo.getCheckpoint()
  }
}
