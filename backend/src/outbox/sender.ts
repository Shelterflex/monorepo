import { SorobanAdapter } from '../soroban/adapter.js'
import { logger } from '../utils/logger.js'
import { outboxStore } from './store.js'
import { OutboxStatus, TxType, type OutboxItem } from './types.js'

/**
 * Outbox sender - handles sending transactions to the blockchain
 */
export class OutboxSender {
  constructor(private adapter: SorobanAdapter) {}

  /**
   * Attempt to send an outbox item to the blockchain
   * Returns true if successful, false otherwise
   */
  async send(item: OutboxItem): Promise<boolean> {
    try {
      logger.info('Attempting to send outbox item', {
        id: item.id,
        txType: item.txType,
        txId: item.txId,
        attempt: item.attempts + 1,
      })

      // Route to appropriate handler based on tx type
      switch (item.txType) {
        case TxType.RECEIPT:
        case TxType.TENANT_REPAYMENT:
        case TxType.LANDLORD_PAYOUT:
        case TxType.WHISTLEBLOWER_REWARD:
          await this.sendReceipt(item)
          break
        default:
          throw new Error(`Unknown tx type: ${item.txType}`)
      }

      // Mark as sent
      await outboxStore.updateStatus(item.id, OutboxStatus.SENT)

      logger.info('Successfully sent outbox item', {
        id: item.id,
        txId: item.txId,
      })

      return true
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      logger.error('Failed to send outbox item', {
        id: item.id,
        txId: item.txId,
        attempt: item.attempts + 1,
        error: errorMessage,
      })

      // Mark as failed
      await outboxStore.updateStatus(item.id, OutboxStatus.FAILED, errorMessage)

      return false
    }
  }

  /**
   * Send a receipt transaction via the Soroban adapter.
   * The adapter's recordReceipt is idempotent: the contract rejects duplicate txId.
   */
  private async sendReceipt(item: OutboxItem): Promise<void> {
    const { payload } = item

    if (!payload.dealId || !payload.amountUsdc || !payload.tokenAddress || !payload.txType) {
      throw new Error('Invalid receipt payload: missing required fields (dealId, amountUsdc, tokenAddress, txType)')
    }

    const { createHash } = await import('node:crypto')
    const externalRefHash = createHash('sha256')
      .update(item.canonicalExternalRefV1)
      .digest('hex')

    await this.adapter.recordReceipt({
      txId: item.txId,
      txType: item.txType as import('./types.js').TxType,
      amountUsdc: String(payload.amountUsdc),
      tokenAddress: String(payload.tokenAddress),
      dealId: String(payload.dealId),
      listingId: payload.listingId ? String(payload.listingId) : undefined,
      externalRefHash,
      amountNgn: payload.amountNgn != null ? Number(payload.amountNgn) : undefined,
      fxRate: payload.fxRateNgnPerUsdc != null ? Number(payload.fxRateNgnPerUsdc) : undefined,
      fxProvider: payload.fxProvider ? String(payload.fxProvider) : undefined,
    })

    logger.debug('Receipt recorded on-chain', {
      dealId: String(payload.dealId),
      txId: item.txId,
      txType: item.txType,
    })
  }

  /**
   * Retry a failed outbox item
   */
  async retry(itemId: string): Promise<boolean> {
    const item = await outboxStore.getById(itemId)
    if (!item) {
      throw new Error(`Outbox item not found: ${itemId}`)
    }

    if (item.status === OutboxStatus.SENT) {
      logger.info('Outbox item already sent, skipping retry', { id: itemId })
      return true
    }

    return this.send(item)
  }

  /**
   * Retry all failed items
   */
  async retryAll(): Promise<{ succeeded: number; failed: number }> {
    const failedItems = await outboxStore.listByStatus(OutboxStatus.FAILED)
    
    let succeeded = 0
    let failed = 0

    for (const item of failedItems) {
      const success = await this.send(item)
      if (success) {
        succeeded++
      } else {
        failed++
      }
    }

    return { succeeded, failed }
  }
}
