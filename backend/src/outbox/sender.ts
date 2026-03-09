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
    const MAX_RETRY_COUNT = 10;
    try {
      logger.info('Attempting to send outbox item', {
        outboxId: item.id,
        txType: item.txType,
        txId: item.txId,
        retryCount: item.retryCount,
      })

      if (item.retryCount >= MAX_RETRY_COUNT) {
        logger.warn('Max retry count reached, not retrying', {
          outboxId: item.id,
          txId: item.txId,
          retryCount: item.retryCount,
        })
        return false;
      }

      // Route to appropriate handler based on tx type
      switch (item.txType) {
        case TxType.RECEIPT:
        case TxType.TENANT_REPAYMENT:
        case TxType.LANDLORD_PAYOUT:
        case TxType.WHISTLEBLOWER_REWARD:
        case TxType.STAKE:
        case TxType.UNSTAKE:
        case TxType.STAKE_REWARD_CLAIM:
          await this.sendReceipt(item)
          break
        default:
          throw new Error(`Unknown tx type: ${item.txType}`)
      }

      // Mark as sent
      item.processedAt = new Date();
      item.retryCount = item.retryCount || 0;
      item.nextRetryAt = null;
      await outboxStore.updateStatus(item.id, OutboxStatus.SENT)

      logger.info('Successfully sent outbox item', {
        outboxId: item.id,
        txId: item.txId,
        retryCount: item.retryCount,
      })

      return true
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      item.retryCount = (item.retryCount || 0) + 1;
      // Exponential backoff: 2^retryCount * 1000ms, capped at 1 hour
      const backoffMs = Math.min(Math.pow(2, item.retryCount) * 1000, 60 * 60 * 1000);
      item.nextRetryAt = new Date(Date.now() + backoffMs);
      item.processedAt = new Date();
      item.lastError = errorMessage;

      logger.error('Failed to send outbox item', {
        outboxId: item.id,
        txId: item.txId,
        retryCount: item.retryCount,
        lastError: item.lastError,
      })

      // Mark as failed
      await outboxStore.updateStatus(item.id, OutboxStatus.FAILED, errorMessage)

      // Persist retry fields (in-memory only)
      outboxStore.items.set(item.id, item)

      return false
    }
  }

  /**
   * Send a receipt transaction via the Soroban adapter.
   * The adapter's recordReceipt is idempotent: the contract rejects duplicate txId.
   */
  private async sendReceipt(item: OutboxItem): Promise<void> {
    const { payload } = item

    // Handle staking transactions differently - they don't require dealId or tokenAddress
    if (item.txType === TxType.STAKE || item.txType === TxType.UNSTAKE || item.txType === TxType.STAKE_REWARD_CLAIM) {
      // For staking transactions, we need at least amountUsdc and txType
      if (!payload.amountUsdc && item.txType !== TxType.STAKE_REWARD_CLAIM) {
        throw new Error('Invalid staking payload: missing required field amountUsdc')
      }
      if (!payload.txType) {
        throw new Error('Invalid staking payload: missing required field txType')
      }

      // For staking, we use a default dealId and tokenAddress since they're not relevant
      await this.adapter.recordReceipt({
        txId: item.txId,
        txType: item.txType as import('./types.js').TxType,
        amountUsdc: payload.amountUsdc ? String(payload.amountUsdc) : '0',
        tokenAddress: process.env.USDC_TOKEN_ADDRESS || '0x0000000000000000000000000000000000000000',
        dealId: 'staking-transaction',
        amountNgn: payload.amountNgn != null ? Number(payload.amountNgn) : undefined,
        fxRate: payload.fxRateNgnPerUsdc != null ? Number(payload.fxRateNgnPerUsdc) : undefined,
        fxProvider: payload.fxProvider ? String(payload.fxProvider) : undefined,
      })

      logger.debug('Staking transaction recorded on-chain', {
        txId: item.txId,
        txType: item.txType,
      })
      return
    }

    // Handle regular payment transactions
    if (!payload.dealId || !payload.amountUsdc || !payload.tokenAddress || !payload.txType) {
      throw new Error('Invalid receipt payload: missing required fields (dealId, amountUsdc, tokenAddress, txType)')
    }

    await this.adapter.recordReceipt({
      txId: item.txId,
      txType: item.txType as import('./types.js').TxType,
      amountUsdc: String(payload.amountUsdc),
      tokenAddress: String(payload.tokenAddress),
      dealId: String(payload.dealId),
      listingId: payload.listingId ? String(payload.listingId) : undefined,
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
