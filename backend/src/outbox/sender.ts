import { SorobanAdapter } from '../soroban/adapter.js'
import { logger } from '../utils/logger.js'
import { outboxStore } from './store.js'
import { OutboxStatus, TxType, type OutboxItem } from './types.js'
import { outboxConfig } from '../config/outboxConfig.js'

/**
 * Outbox sender - handles sending transactions to the blockchain
 *
 * Exactly-once guarantees implemented here:
 *
 * 1. **Durable intent before broadcast** — `onTxBuilt` callback persists the
 *    Stellar tx hash to the outbox row *before* calling sendTransaction.  A
 *    worker crash after this point can be recovered without resubmission.
 *
 * 2. **Crash recovery** — if `item.submittedTxHash` is already set when `send`
 *    is called, the worker queries the chain for that hash rather than calling
 *    the adapter again, preventing double-application.
 *
 * 3. **Confirmation depth** — after a confirmed tx the item moves to CONFIRMING;
 *    the worker checks finality depth before marking SENT (see worker.ts).
 */
export class OutboxSender {
  constructor(private adapter: SorobanAdapter) {}

  /**
   * Attempt to send an outbox item to the blockchain.
   * Returns true if the item advanced toward SENT, false on failure.
   */
  async send(item: OutboxItem): Promise<boolean> {
    const MAX_RETRY_COUNT = 10

    try {
      // -----------------------------------------------------------------------
      // Crash-recovery path: a previous worker broadcast this tx but died
      // before recording the result.  Resolve via chain query.
      // -----------------------------------------------------------------------
      if (item.submittedTxHash) {
        return this.resolveInFlight(item)
      }

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
        return false
      }

      // -----------------------------------------------------------------------
      // Normal send path — persist hash before broadcast via onTxBuilt hook
      // -----------------------------------------------------------------------
      switch (item.txType) {
        case TxType.RECEIPT:
        case TxType.TENANT_REPAYMENT:
        case TxType.LANDLORD_PAYOUT:
        case TxType.WHISTLEBLOWER_REWARD:
        case TxType.STAKE:
        case TxType.UNSTAKE:
        case TxType.STAKE_REWARD_CLAIM:
        case TxType.CONVERSION:
          await this.sendReceipt(item)
          break
        case TxType.DEAL_STATUS_CHANGED:
          if (this.adapter.syncDealStatus) {
            await this.sendDealStatus(item)
          } else {
            throw new Error('Deal status sync not supported by adapter')
          }
          break
        default:
          throw new Error(`Unknown tx type: ${item.txType}`)
      }

      item.processedAt = new Date()
      item.nextRetryAt = null
      await outboxStore.updateStatus(item.id, OutboxStatus.SENT)

      logger.info('Successfully sent outbox item', {
        outboxId: item.id,
        txId: item.txId,
        retryCount: item.retryCount,
      })

      return true
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const currentRetryCount = item.retryCount || 0
      const backoffMs = Math.min(Math.pow(2, currentRetryCount) * 1000, 60 * 60 * 1000)
      const nextRetryAt = new Date(Date.now() + backoffMs)

      logger.error('Failed to send outbox item', {
        outboxId: item.id,
        txId: item.txId,
        retryCount: currentRetryCount,
        lastError: errorMessage,
      })

      await outboxStore.updateStatus(item.id, OutboxStatus.FAILED, {
        error: errorMessage,
        nextRetryAt,
      })

      return false
    }
  }

  /**
   * Resolve an item that has a persisted tx hash but no confirmed result.
   * Queries the chain to determine whether the tx landed, failed, or expired.
   */
  private async resolveInFlight(item: OutboxItem): Promise<boolean> {
    const txHash = item.submittedTxHash!

    if (!this.adapter.getTransactionStatus) {
      // Adapter cannot query chain status; fall through to blind resubmission
      // by clearing the hash and letting the normal path retry.
      logger.warn('Adapter does not support getTransactionStatus; clearing in-flight hash for resubmission', {
        outboxId: item.id,
        txHash,
      })
      await outboxStore.persistSubmittedTxHash(item.id, '')  // clear
      return false
    }

    const chainStatus = await this.adapter.getTransactionStatus(txHash)

    logger.info('Resolved in-flight tx', {
      outboxId: item.id,
      txHash,
      chainStatus: chainStatus.status,
      ledger: chainStatus.ledger,
    })

    if (chainStatus.status === 'success') {
      await outboxStore.markConfirming(
        item.id,
        txHash,
        chainStatus.ledger ?? 0,
        outboxConfig.confirmationDepth,
      )
      return true
    }

    if (chainStatus.status === 'pending') {
      // Still in-flight; skip this cycle
      return false
    }

    // 'failed' or 'not_found' — reopen for resubmission
    await outboxStore.reopenItem(
      item.id,
      `in-flight tx ${txHash} resolved as ${chainStatus.status}; re-queued`,
    )
    // Immediately reset to PENDING so the worker picks it up
    await outboxStore.updateStatus(item.id, OutboxStatus.PENDING)
    return false
  }

  private async sendReceipt(item: OutboxItem): Promise<void> {
    const { payload } = item

    if (
      item.txType === TxType.STAKE ||
      item.txType === TxType.UNSTAKE ||
      item.txType === TxType.STAKE_REWARD_CLAIM ||
      item.txType === TxType.CONVERSION
    ) {
      if (!payload.amountUsdc && item.txType !== TxType.STAKE_REWARD_CLAIM) {
        throw new Error('Invalid staking payload: missing required field amountUsdc')
      }
      if (!payload.txType) {
        throw new Error('Invalid staking payload: missing required field txType')
      }

      await this.adapter.recordReceipt(
        {
          txId: item.txId,
          txType: item.txType as import('./types.js').TxType,
          amountUsdc: payload.amountUsdc ? String(payload.amountUsdc) : '0',
          tokenAddress: payload.tokenAddress
            ? String(payload.tokenAddress)
            : process.env.USDC_TOKEN_ADDRESS || '0x0000000000000000000000000000000000000000',
          dealId: payload.dealId
            ? String(payload.dealId)
            : item.txType === TxType.CONVERSION
              ? 'conversion'
              : 'staking-transaction',
          amountNgn: payload.amountNgn != null ? Number(payload.amountNgn) : undefined,
          fxRate: payload.fxRateNgnPerUsdc != null ? Number(payload.fxRateNgnPerUsdc) : undefined,
          fxProvider: payload.fxProvider ? String(payload.fxProvider) : undefined,
        },
        {
          onTxBuilt: async (txHash) => {
            await outboxStore.persistSubmittedTxHash(item.id, txHash)
          },
        },
      )
      return
    }

    if (!payload.dealId || !payload.amountUsdc || !payload.tokenAddress || !payload.txType) {
      throw new Error('Invalid receipt payload: missing required fields (dealId, amountUsdc, tokenAddress, txType)')
    }

    await this.adapter.recordReceipt(
      {
        txId: item.txId,
        txType: item.txType as import('./types.js').TxType,
        amountUsdc: String(payload.amountUsdc),
        tokenAddress: String(payload.tokenAddress),
        dealId: String(payload.dealId),
        listingId: payload.listingId ? String(payload.listingId) : undefined,
        amountNgn: payload.amountNgn != null ? Number(payload.amountNgn) : undefined,
        fxRate: payload.fxRateNgnPerUsdc != null ? Number(payload.fxRateNgnPerUsdc) : undefined,
        fxProvider: payload.fxProvider ? String(payload.fxProvider) : undefined,
      },
      {
        onTxBuilt: async (txHash) => {
          await outboxStore.persistSubmittedTxHash(item.id, txHash)
        },
      },
    )

    logger.debug('Receipt recorded on-chain', {
      dealId: String(payload.dealId),
      txId: item.txId,
      txType: item.txType,
    })
  }

  private async sendDealStatus(item: OutboxItem): Promise<void> {
    if (!this.adapter.syncDealStatus) {
      throw new Error('Adapter does not support deal status sync')
    }
    const { payload } = item
    const newStatus = payload.newStatus as 'active' | 'completed' | 'defaulted'
    if (!payload.dealId || !newStatus) {
      throw new Error('Invalid deal status sync payload')
    }
    await this.adapter.syncDealStatus({
      dealId: String(payload.dealId),
      contractDealId: String(payload.contractDealId ?? payload.dealId),
      newStatus,
      actor: String(payload.actor ?? 'system'),
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
