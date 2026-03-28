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
import { listingStore } from '../models/listingStore.js'
import { ListingStatus } from '../models/listing.js'
import { env } from '../schemas/env.js'
import type { WalletStore } from '../models/wallet.js'
import type { EncryptionService } from '../services/walletService.js'
import { ReceiptIndexer } from '../indexer/worker.js'

export function createAdminRouter(adapter: SorobanAdapter, walletStore?: WalletStore, encryptionService?: EncryptionService, indexer?: ReceiptIndexer) {
  const router = Router()
  const sender = new OutboxSender(adapter)

  // Admin auth guard helper
  function requireAdminSecret(req: Request) {
    const headerSecret = req.headers['x-admin-secret']
    if (env.MANUAL_ADMIN_SECRET && headerSecret !== env.MANUAL_ADMIN_SECRET) {
      throw new AppError(ErrorCode.FORBIDDEN, 403, 'Invalid admin secret')
    }
  }

  /**
   * GET /api/admin/flags
   * Expose read-only feature flags for easier debugging.
   */
  router.get('/flags', requireAdminSecret, (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({
        custodialModeEnabled: env.CUSTODIAL_MODE_ENABLED,
        custodialSigningPaused: env.CUSTODIAL_SIGNING_PAUSED,
        webhookSignatureEnabled: env.WEBHOOK_SIGNATURE_ENABLED,
        databaseEnabled: !!process.env.DATABASE_URL,
        sorobanAdapterMode: env.SOROBAN_NETWORK,
      })
    } catch (error) {
      next(error)
    }
  })

  router.post(
    '/wallets/rewrap',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!walletStore || !encryptionService) {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            501,
            'Wallet rotation is not configured on this deployment',
          )
        }

        const headerSecret = req.headers['x-admin-secret']
        if (env.MANUAL_ADMIN_SECRET && headerSecret !== env.MANUAL_ADMIN_SECRET) {
          throw new AppError(ErrorCode.FORBIDDEN, 403, 'Invalid admin secret')
        }

        const fromKeyId = typeof req.body.fromKeyId === 'string' ? req.body.fromKeyId : undefined
        const toKeyId = typeof req.body.toKeyId === 'string' ? req.body.toKeyId : encryptionService.getCurrentKeyId()
        const batchSize = req.body.batchSize ? Number(req.body.batchSize) : 100
        const userId = typeof req.body.userId === 'string' ? req.body.userId : undefined

        if (!toKeyId) {
          throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'toKeyId is required')
        }
        if (!Number.isFinite(batchSize) || batchSize <= 0 || batchSize > 1000) {
          throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'batchSize must be between 1 and 1000')
        }

        logger.info('Wallet rewrap requested', {
          fromKeyId: fromKeyId ?? 'any',
          toKeyId,
          batchSize,
          userId: userId ?? 'batch',
          requestId: req.requestId,
        })

        // Audit log: admin wallet action (rewrap)
        auditAdminWalletAction(req, {
          action: 'WALLET_REWRAP',
          details: {
            fromKeyId: fromKeyId ?? 'any',
            toKeyId,
            batchSize,
            userId: userId ?? 'batch',
          },
        })

        const work: string[] = []
        if (userId) {
          work.push(userId)
        } else {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            501,
            'Batch rewrap is not implemented for this wallet store; supply userId',
          )
        }

        let processed = 0
        let updated = 0
        let skipped = 0
        const failures: { userId: string; reason: string }[] = []

        for (const uid of work) {
          processed += 1
          try {
            const record = await walletStore.getEncryptedKey(uid)
            if (!record) {
              skipped += 1
              continue
            }

            if (record.keyId === toKeyId) {
              skipped += 1
              continue
            }

            if (fromKeyId && record.keyId !== fromKeyId) {
              skipped += 1
              continue
            }

            const cipherTextBuf = Buffer.from(record.cipherText, 'base64')
            const plaintext = await encryptionService.decrypt(cipherTextBuf, record.keyId)
            const { cipherText: newCipherTextBuf } = await encryptionService.encrypt(plaintext, toKeyId)

            await walletStore.updateEncryption(uid, newCipherTextBuf.toString('base64'), toKeyId)
            updated += 1
          } catch (error) {
            const reason = error instanceof Error ? error.message : 'unknown error'
            failures.push({ userId: uid, reason })
            logger.error('Failed to rewrap wallet', {
              userId: uid,
              fromKeyId: fromKeyId ?? 'any',
              toKeyId,
              error: reason,
              requestId: req.requestId,
            })
          }
        }

        const hasMore = false

        logger.info('Wallet rewrap completed', {
          fromKeyId: fromKeyId ?? 'any',
          toKeyId,
          processed,
          updated,
          skipped,
          failures: failures.length,
          hasMore,
          requestId: req.requestId,
        })

        res.json({
          fromKeyId: fromKeyId ?? 'any',
          toKeyId,
          processed,
          updated,
          skipped,
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
   *   - status: pending | sent | failed | dead (optional)
   *   - limit: number (optional, default 100)
   */
  router.get('/outbox', requireAdminSecret, async (req: Request, res: Response, next: NextFunction) => {
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
   * POST /api/admin/outbox/:id/mark-dead
   * 
   * Permanently mark an outbox item as dead (stops all future retries).
   * Requires a mandatory 'reason' in the request body.
   */
  router.post('/outbox/:id/mark-dead', requireAdminSecret, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params
      const { reason } = req.body

      if (!reason || typeof reason !== 'string' || reason.trim() === '') {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          400,
          'reason is required to mark an outbox item as dead',
        )
      }

      const item = await outboxStore.getById(id)
      if (!item) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, `Outbox item not found: ${id}`)
      }

      if (item.status === OutboxStatus.SENT) {
        throw new AppError(
          ErrorCode.CONFLICT,
          409,
          `Cannot mark a SENT outbox item as dead (id: ${id})`,
        )
      }

      const dead = await outboxStore.markDead(id, reason.trim())
      if (!dead) {
        throw new AppError(ErrorCode.INTERNAL_ERROR, 500, 'Failed to mark outbox item as dead')
      }

      logger.warn('Outbox item manually marked dead', {
        outboxId: id,
        reason: reason.trim(),
        requestId: req.requestId,
      })

      res.json({
        success: true,
        item: {
          id: dead.id,
          txId: dead.txId,
          status: dead.status,
          lastError: dead.lastError,
          updatedAt: dead.updatedAt.toISOString(),
        },
        message: 'Outbox item permanently marked as dead and will not be retried',
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
  router.post('/outbox/:id/retry', requireAdminSecret, async (req: Request, res: Response, next: NextFunction) => {
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
  router.post('/outbox/retry-all', requireAdminSecret, async (req: Request, res: Response, next: NextFunction) => {
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
   * GET /api/admin/whistleblower/listings
   *
   * List whistleblower listings for admin review.
   * Defaults to status=pending_review when no status is provided.
   * Query params:
   *   - status: pending_review | approved | rejected | rented (optional, default: pending_review)
   *   - page: number (optional, default 1)
   *   - pageSize: number (optional, default 20, max 100)
   */
  router.get(
    '/whistleblower/listings',
    validate(adminListingFiltersSchema, 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const filters = req.query

        logger.info('Admin listing moderation queue requested', {
          filters,
          requestId: req.requestId,
        })

        const result = await listingStore.list(filters)

        res.json({
          listings: result.listings.map((listing) => ({
            listingId: listing.listingId,
            whistleblowerId: listing.whistleblowerId,
            address: listing.address,
            city: listing.city,
            area: listing.area,
            bedrooms: listing.bedrooms,
            bathrooms: listing.bathrooms,
            annualRentNgn: listing.annualRentNgn,
            description: listing.description,
            photos: listing.photos,
            status: listing.status,
            reviewedBy: listing.reviewedBy,
            reviewedAt: listing.reviewedAt?.toISOString(),
            rejectionReason: listing.rejectionReason,
            createdAt: listing.createdAt.toISOString(),
            updatedAt: listing.updatedAt.toISOString(),
          })),
          pagination: {
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
            totalPages: result.totalPages,
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * POST /api/admin/whistleblower/listings/:id/approve
   *
   * Approve a pending_review listing.
   * Only valid transition: pending_review -> approved.
   */
  router.post(
    '/whistleblower/listings/:id/approve',
    validate(approveListingSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params
        const { reviewedBy } = req.body

        const listing = await listingStore.getById(id)
        if (!listing) {
          throw notFound(`Listing with ID '${id}'`)
        }

        if (listing.status !== ListingStatus.PENDING_REVIEW) {
          throw new AppError(
            ErrorCode.CONFLICT,
            409,
            `Listing cannot be approved. Current status: ${listing.status}`,
            { currentStatus: listing.status, allowedFrom: ListingStatus.PENDING_REVIEW },
          )
        }

        const updated = await listingStore.moderate(id, ListingStatus.APPROVED, reviewedBy)

        logger.info('Listing approved', {
          listingId: id,
          reviewedBy,
          requestId: req.requestId,
        })

        res.json({
          listing: {
            listingId: updated!.listingId,
            status: updated!.status,
            reviewedBy: updated!.reviewedBy,
            reviewedAt: updated!.reviewedAt?.toISOString(),
            updatedAt: updated!.updatedAt.toISOString(),
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * POST /api/admin/whistleblower/listings/:id/reject
   *
   * Reject a pending_review listing with a mandatory reason.
   * Only valid transition: pending_review -> rejected.
   */
  router.post(
    '/whistleblower/listings/:id/reject',
    validate(rejectListingSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params
        const { reviewedBy, reason } = req.body

        const listing = await listingStore.getById(id)
        if (!listing) {
          throw notFound(`Listing with ID '${id}'`)
        }

        if (listing.status !== ListingStatus.PENDING_REVIEW) {
          throw new AppError(
            ErrorCode.CONFLICT,
            409,
            `Listing cannot be rejected. Current status: ${listing.status}`,
            { currentStatus: listing.status, allowedFrom: ListingStatus.PENDING_REVIEW },
          )
        }

        const updated = await listingStore.moderate(
          id,
          ListingStatus.REJECTED,
          reviewedBy,
          reason,
        )

        logger.info('Listing rejected', {
          listingId: id,
          reviewedBy,
          requestId: req.requestId,
        })

        res.json({
          listing: {
            listingId: updated!.listingId,
            status: updated!.status,
            reviewedBy: updated!.reviewedBy,
            reviewedAt: updated!.reviewedAt?.toISOString(),
            rejectionReason: updated!.rejectionReason,
            updatedAt: updated!.updatedAt.toISOString(),
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * GET /api/admin/indexer/metrics
   * 
   * Get ReceiptIndexer metrics and status
   */
  router.get('/indexer/metrics', async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireAdminSecret(req)

      if (!indexer) {
        throw new AppError(
          ErrorCode.INTERNAL_ERROR,
          501,
          'ReceiptIndexer is not configured on this deployment',
        )
      }

      const metrics = indexer.getMetrics()

      logger.info('Indexer metrics retrieved', {
        requestId: req.requestId,
        metrics,
      })

      res.json({
        metrics,
      })
    } catch (error) {
      next(error)
    }
  })

  /**
   * POST /api/admin/indexer/pause
   * 
   * Pause the ReceiptIndexer (stops polling)
   */
  router.post('/indexer/pause', async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireAdminSecret(req)

      if (!indexer) {
        throw new AppError(
          ErrorCode.INTERNAL_ERROR,
          501,
          'ReceiptIndexer is not configured on this deployment',
        )
      }

      logger.info('Indexer pause requested', {
        requestId: req.requestId,
      })

      // Audit log: admin indexer action (pause)
      auditAdminWalletAction(req, {
        action: 'INDEXER_PAUSE',
        details: {},
      })

      indexer.pause()

      const metrics = indexer.getMetrics()

      logger.info('Indexer paused', {
        requestId: req.requestId,
        isPaused: metrics.isPaused,
      })

      res.json({
        success: true,
        message: 'Indexer paused successfully',
        metrics,
      })
    } catch (error) {
      next(error)
    }
  })

  /**
   * POST /api/admin/indexer/resume
   * 
   * Resume the ReceiptIndexer (continues polling)
   */
  router.post('/indexer/resume', async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireAdminSecret(req)

      if (!indexer) {
        throw new AppError(
          ErrorCode.INTERNAL_ERROR,
          501,
          'ReceiptIndexer is not configured on this deployment',
        )
      }

      logger.info('Indexer resume requested', {
        requestId: req.requestId,
      })

      // Audit log: admin indexer action (resume)
      auditAdminWalletAction(req, {
        action: 'INDEXER_RESUME',
        details: {},
      })

      indexer.resume()

      const metrics = indexer.getMetrics()

      logger.info('Indexer resumed', {
        requestId: req.requestId,
        isPaused: metrics.isPaused,
      })

      res.json({
        success: true,
        message: 'Indexer resumed successfully',
        metrics,
      })
    } catch (error) {
      next(error)
    }
  })

  return router
}
