import { OutboxSender } from './sender.js'
import { OutboxWorker } from './worker.js'
import { createSorobanAdapter } from '../soroban/index.js'
import { getSorobanConfigFromEnv } from '../soroban/client.js'
import { logger } from '../utils/logger.js'

export function maybeStartOutboxWorker() {
  if (process.env.OUTBOX_WORKER_ENABLED === 'true') {
    const sorobanConfig = getSorobanConfigFromEnv(process.env)
    const adapter = createSorobanAdapter(sorobanConfig)
    const sender = new OutboxSender(adapter)
    const worker = new OutboxWorker(sender)
    worker.start(60000) // 1 minute interval
    logger.info('Outbox retry worker enabled')
  } else {
    logger.info('Outbox retry worker disabled')
  }
}
