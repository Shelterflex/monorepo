import { Router, type Request, type Response, type NextFunction } from 'express'
import { outboxStore, OutboxSender, OutboxStatus, TxType } from '../outbox/index.js'
import { SorobanAdapter } from '../soroban/adapter.js'
import { logger } from '../utils/logger.js'
import { auditAdminWalletAction } from '../utils/auditLogger.js'
import { AppError, notFound } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { validate } from '../middleware/validate.js'
import { markRewardPaidSchema } from '../schemas/reward.js'
import {
  adminListingFiltersSchema,
  approveListingSchema,
  rejectListingSchema,
} from '../schemas/listing.js'
import { rewardStore } from '../models/rewardStore.js'
import { RewardStatus } from '../models/reward.js'
import {
  depositsQuerySchema,
  walletsQuerySchema,
  conversionsQuerySchema,
  outboxReconQuerySchema,
} from '../schemas/reconciliation.js'
import { depositStore } from '../models/depositStore.js'
import { walletStore } from '../models/walletStore.js'
import { conversionStore } from '../models/conversionStore.js'

export function createAdminRouter(adapter: SorobanAdapter, walletStore?: WalletStore) {
  const router = Router()
  const sender = new OutboxSender(adapter)

  router.post(
    '/wallets/rewrap',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!walletStore) {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            501,
            'Wallet rotation is not configured on this deployment',
          )
        }

        const fromVersion = Number(req.body.fromVersion) as MasterKeyVersion
        const toVersion = Number(req.body.toVersion) as MasterKeyVersion
        const batchSize = req.body.batchSize ? Number(req.body.batchSize) : 100

        if (fromVersion !== 1 && fromVersion !== 2) {
          throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'fromVersion must be 1 or 2')
        }
        if (toVersion !== 1 && toVersion !== 2) {
          throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'toVersion must be 1 or 2')
        }
        if (fromVersion >= toVersion) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            400,
            'toVersion must be greater than fromVersion',
          )
        }
        if (!Number.isFinite(batchSize) || batchSize <= 0 || batchSize > 1000) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            400,
            'batchSize must be between 1 and 1000',
          )
        }

        const activeVersion = getActiveMasterKeyVersion()
        if (activeVersion !== toVersion) {
          throw new AppError(
            ErrorCode.CONFLICT,
            409,
            'Active master key version must match toVersion before rotation',
          )
        }

        logger.info('Wallet rewrap requested', {
          fromVersion,
          toVersion,
          batchSize,
          requestId: req.requestId,
        })

        // Audit log: admin wallet action (rewrap)
        auditAdminWalletAction(req, {
          action: 'WALLET_REWRAP',
          details: {
            fromVersion,
            toVersion,
            batchSize,
          },
        })

        const candidates = await walletStore.listByEncryptionVersion(fromVersion, batchSize)

        let processed = 0
        let updated = 0
        const failures: { walletId: string; reason: string }[] = []

        for (const wallet of candidates) {
          processed += 1
          if (wallet.encryptionVersion !== fromVersion) {
            continue
          }

          try {
            const changed = await walletStore.rewrapWalletDek(wallet.id, fromVersion, toVersion)
            if (changed) {
              updated += 1
            }
          } catch (error) {
            const reason = error instanceof Error ? error.message : 'unknown error'
            failures.push({ walletId: wallet.id, reason })
            logger.error('Failed to rewrap wallet', {
              walletId: wallet.id,
              fromVersion,
              toVersion,
              error: reason,
              requestId: req.requestId,
            })
          }
        }

        const hasMore = candidates.length === batchSize

        logger.info('Wallet rewrap completed', {
          fromVersion,
          toVersion,
          processed,
          updated,
          failures: failures.length,
          hasMore,
          requestId: req.requestId,
        })

        res.json({
          fromVersion,
          toVersion,
          processed,
          updated,
          skipped: processed - updated,
          failures,
          hasMore,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * GET /api/admin/outbox
   * 
   * List outbox items, optionally filtered by status
   * Query params:
   *   - status: pending | sent | failed (optional)
   *   - limit: number (optional, default 100)
   */
  router.get('/outbox', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, limit } = req.query
      const limitNum = limit ? parseInt(String(limit), 10) : 100

      if (limitNum < 1 || limitNum > 1000) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          400,
          'Limit must be between 1 and 1000',
        )
      }

      let items

      if (status) {
        // Validate status
        if (!Object.values(OutboxStatus).includes(status as OutboxStatus)) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            400,
            `Invalid status. Must be one of: ${Object.values(OutboxStatus).join(', ')}`,
          )
        }

        items = await outboxStore.listByStatus(status as OutboxStatus)
      } else {
        items = await outboxStore.listAll(limitNum)
      }

      logger.info('Outbox items retrieved', {
        count: items.length,
        status: status || 'all',
        requestId: req.requestId,
      })

      res.json({
        items: items.map((item) => ({
          id: item.id,
          txType: item.txType,
          txId: item.txId,
          externalRef: item.canonicalExternalRefV1,
          status: item.status,
          attempts: item.attempts,
          lastError: item.lastError,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
          payload: item.payload,
        })),
        total: items.length,
      })
    } catch (error) {
      next(error)
    }
  })

  /**
   * POST /api/admin/outbox/:id/retry
   * 
   * Retry a specific outbox item
   */
  router.post('/outbox/:id/retry', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params

      logger.info('Manual retry requested', {
        outboxId: id,
        requestId: req.requestId,
      })

      const item = await outboxStore.getById(id)
      if (!item) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, `Outbox item not found: ${id}`)
      }

      const success = await sender.retry(id)

      // Fetch updated item
      const updatedItem = await outboxStore.getById(id)
      if (!updatedItem) {
        throw new AppError(
          ErrorCode.INTERNAL_ERROR,
          500,
          'Failed to retrieve outbox item after retry',
        )
      }

      res.json({
        success,
        item: {
          id: updatedItem.id,
          txId: updatedItem.txId,
          status: updatedItem.status,
          attempts: updatedItem.attempts,
          lastError: updatedItem.lastError,
          updatedAt: updatedItem.updatedAt.toISOString(),
        },
        message: success
          ? 'Retry successful, receipt written to chain'
          : 'Retry failed, item remains in failed state',
      })
    } catch (error) {
      next(error)
    }
  })

  /**
   * POST /api/admin/outbox/retry-all
   * 
   * Retry all failed outbox items
   */
  router.post('/outbox/retry-all', async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('Retry all failed items requested', {
        requestId: req.requestId,
      })

      const result = await sender.retryAll()

      logger.info('Retry all completed', {
        succeeded: result.succeeded,
        failed: result.failed,
        requestId: req.requestId,
      })

      res.json({
        success: true,
        succeeded: result.succeeded,
        failed: result.failed,
        message: `Retried ${result.succeeded + result.failed} items: ${result.succeeded} succeeded, ${result.failed} failed`,
      })
    } catch (error) {
      next(error)
    }
  })

  /**
   * POST /api/admin/rewards/:rewardId/mark-paid
   * 
   * Mark a reward as paid and record receipt on-chain
   * 
   * Rules:
   * - Reward must be in 'payable' status
   * - Creates on-chain receipt with WHISTLEBLOWER_REWARD type
   * - Idempotent by external reference
   */
  router.post(
    '/rewards/:rewardId/mark-paid',
    validate(markRewardPaidSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { rewardId } = req.params
        const {
          amountUsdc,
          tokenAddress,
          externalRefSource,
          externalRef,
          amountNgn,
          fxRateNgnPerUsdc,
          fxProvider,
        } = req.body

        logger.info('Marking reward as paid', {
          rewardId,
          externalRefSource,
          externalRef,
          requestId: req.requestId,
        })

        // Get reward
        const reward = await rewardStore.getById(rewardId)
        if (!reward) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, `Reward with ID '${rewardId}' not found`)
        }

        // Check if reward is payable
        if (reward.status !== RewardStatus.PAYABLE) {
          throw new AppError(
            ErrorCode.CONFLICT,
            409,
            `Reward cannot be marked as paid. Current status: ${reward.status}`,
            {
              currentStatus: reward.status,
              requiredStatus: RewardStatus.PAYABLE,
            },
          )
        }

        // Create outbox item for on-chain receipt (idempotent by source+ref)
        const outboxItem = await outboxStore.create({
          txType: TxType.WHISTLEBLOWER_REWARD,
          source: externalRefSource,
          ref: externalRef,
          payload: {
            txType: TxType.WHISTLEBLOWER_REWARD,
            dealId: reward.dealId,
            listingId: reward.listingId,
            whistleblowerId: reward.whistleblowerId,
            amountUsdc,
            tokenAddress,
            externalRefSource,
            externalRef,
            ...(amountNgn && { amountNgn }),
            ...(fxRateNgnPerUsdc && { fxRateNgnPerUsdc }),
            ...(fxProvider && { fxProvider }),
          },
        })

        logger.info('Outbox item created for reward receipt', {
          rewardId,
          outboxId: outboxItem.id,
          txId: outboxItem.txId,
          requestId: req.requestId,
        })

        // Attempt to send to chain
        const sent = await sender.send(outboxItem)

        // Update reward status
        const updatedReward = await rewardStore.markAsPaid(
          rewardId,
          outboxItem.txId,
          externalRefSource,
          externalRef,
          {
            amountNgn,
            fxRateNgnPerUsdc,
            fxProvider,
          },
        )

        if (!updatedReward) {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            500,
            'Failed to update reward status',
          )
        }

        // Fetch updated outbox item
        const updatedOutbox = await outboxStore.getById(outboxItem.id)
        if (!updatedOutbox) {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            500,
            'Failed to retrieve outbox item after send attempt',
          )
        }

        logger.info('Reward marked as paid', {
          rewardId,
          txId: outboxItem.txId,
          outboxStatus: updatedOutbox.status,
          requestId: req.requestId,
        })

        res.status(sent ? 200 : 202).json({
          success: true,
          reward: {
            rewardId: updatedReward.rewardId,
            status: updatedReward.status,
            paidAt: updatedReward.paidAt?.toISOString(),
            paymentTxId: updatedReward.paymentTxId,
          },
          receipt: {
            outboxId: updatedOutbox.id,
            txId: updatedOutbox.txId,
            status: updatedOutbox.status,
          },
          message: sent
            ? 'Reward marked as paid and receipt written to chain'
            : 'Reward marked as paid, receipt queued for retry',
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * GET /api/admin/reconciliation/deposits
   * 
   * List deposits for reconciliation workflows.
   * Query:
   *  - status: unmatched | matched | reversed (optional)
   *  - page, pageSize
   */
  router.get(
    '/reconciliation/deposits',
    validate(depositsQuerySchema, 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { status, page, pageSize } = req.query as any
        const result = await depositStore.listByStatus(status, page, pageSize)
        res.json({
          items: result.items.map((d) => ({
            id: d.id,
            accountId: d.accountId,
            externalRef: `${d.externalRefSource}:${d.externalRef}`,
            amountNgn: d.amountNgn,
            status: d.status,
            createdAt: d.createdAt.toISOString(),
            matchedAt: d.matchedAt?.toISOString(),
            reversalId: d.reversalId,
          })),
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
          totalPages: result.totalPages,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * GET /api/admin/reconciliation/wallets
   * 
   * List wallets, optionally only those with negative balances.
   * Query:
   *  - negative: true|false (optional, default false)
   *  - page, pageSize
   */
  router.get(
    '/reconciliation/wallets',
    validate(walletsQuerySchema, 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { negative, page, pageSize } = req.query as any
        const result = negative
          ? await walletStore.listNegative(page, pageSize)
          : await walletStore.listAll(page, pageSize)
        res.json({
          items: result.items.map((w) => ({
            accountId: w.accountId,
            balanceNgn: w.balanceNgn,
            updatedAt: w.updatedAt.toISOString(),
          })),
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
          totalPages: result.totalPages,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * GET /api/admin/reconciliation/conversions
   * 
   * List currency conversions by status for reconciliation.
   * Query:
   *  - status: pending | completed | failed (optional)
   *  - page, pageSize
   */
  router.get(
    '/reconciliation/conversions',
    validate(conversionsQuerySchema, 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { status, page, pageSize } = req.query as any
        const result = await conversionStore.listByStatus(status, page, pageSize)
        res.json({
          items: result.items.map((c) => ({
            id: c.id,
            from: c.from,
            to: c.to,
            amount: c.amount,
            status: c.status,
            createdAt: c.createdAt.toISOString(),
            updatedAt: c.updatedAt.toISOString(),
            externalRef: c.externalRefSource && c.externalRef ? `${c.externalRefSource}:${c.externalRef}` : undefined,
          })),
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
          totalPages: result.totalPages,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * GET /api/admin/reconciliation/outbox
   * 
   * Read-only list of pending/failed outbox items with limited fields.
   * Query:
   *  - status: pending | failed (optional)
   *  - page, pageSize
   */
  router.get(
    '/reconciliation/outbox',
    validate(outboxReconQuerySchema, 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { status, page, pageSize } = req.query as any
        // Reuse outboxStore and implement pagination client-side since store returns all
        let items =
          status === 'failed'
            ? await outboxStore.listByStatus(OutboxStatus.FAILED)
            : status === 'pending'
            ? await outboxStore.listByStatus(OutboxStatus.PENDING)
            : await outboxStore.listAll(pageSize * page) // fetch enough to paginate deterministically

        // Sort newest first for ops
        items = items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        const total = items.length
        const start = (page - 1) * pageSize
        const pageItems = items.slice(start, start + pageSize)

        res.json({
          items: pageItems.map((item) => ({
            id: item.id,
            txType: item.txType,
            txId: item.txId,
            externalRef: item.canonicalExternalRefV1,
            status: item.status,
            attempts: item.attempts,
            lastError: item.lastError,
            createdAt: item.createdAt.toISOString(),
            updatedAt: item.updatedAt.toISOString(),
          })),
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize) || 1,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
