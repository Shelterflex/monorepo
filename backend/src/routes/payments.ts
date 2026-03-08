import { Router, type Request, type Response, type NextFunction } from 'express'
import { validate } from '../middleware/validate.js'
import { confirmPaymentSchema } from '../schemas/payment.js'
import { outboxStore, OutboxSender } from '../outbox/index.js'
import { SorobanAdapter } from '../soroban/adapter.js'
import { logger } from '../utils/logger.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

export function createPaymentsRouter(adapter: SorobanAdapter) {
  const router = Router()
  const sender = new OutboxSender(adapter)

  /**
   * POST /api/payments/confirm
   *
   * Confirm an off-chain or on-chain payment and write a USDC receipt to the Soroban ledger.
   * On-chain accounting is standardized in USDC; NGN values are optional metadata.
   *
   * Flow:
   * 1. Validate request (Zod schema)
   * 2. Build canonical external ref: "{externalRefSource}:{externalRef}"
   * 3. Persist outbox item (idempotent — returns existing if duplicate)
   * 4. Attempt immediate on-chain write via adapter.recordReceipt()
   * 5. If write succeeds → 200; if queued for retry → 202
   */
  router.post(
    '/confirm',
    validate(confirmPaymentSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const {
          dealId,
          txType,
          amountUsdc,
          tokenAddress,
          externalRefSource,
          externalRef,
          amountNgn,
          fxRateNgnPerUsdc,
          fxProvider,
        } = req.body

        // Log non-sensitive fields only — no amounts, no external refs
        logger.info('Payment confirmation requested', {
          dealId,
          txType,
          requestId: req.requestId,
        })

        // Build canonical external ref: lowercase source + raw ref
        const canonicalExternalRefV1 = `${externalRefSource.toLowerCase()}:${externalRef}`

        // Create outbox item (idempotent by canonicalExternalRefV1)
        const outboxItem = await outboxStore.create({
          txType,
          canonicalExternalRefV1,
          payload: {
            dealId,
            txType,
            amountUsdc,
            tokenAddress,
            ...(amountNgn != null && { amountNgn }),
            ...(fxRateNgnPerUsdc != null && { fxRateNgnPerUsdc }),
            ...(fxProvider != null && { fxProvider }),
          },
        })

        logger.info('Outbox item created or retrieved', {
          outboxId: outboxItem.id,
          txId: outboxItem.txId,
          status: outboxItem.status,
          requestId: req.requestId,
        })

        // Attempt immediate on-chain write
        const sent = await sender.send(outboxItem)

        const updatedItem = await outboxStore.getById(outboxItem.id)
        if (!updatedItem) {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            500,
            'Failed to retrieve outbox item after send attempt',
          )
        }

        res.status(sent ? 200 : 202).json({
          success: true,
          outboxId: updatedItem.id,
          txId: updatedItem.txId,
          status: updatedItem.status,
          message: sent
            ? 'Payment confirmed and USDC receipt written to chain'
            : 'Payment confirmed, USDC receipt queued for retry',
        })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
