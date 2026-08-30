import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import {
  outboxStore,
  OutboxSender,
  OutboxStatus,
  TxType,
} from "../outbox/index.js";
import { SorobanAdapter } from "../soroban/adapter.js";
import { logger } from "../utils/logger.js";
import {
  auditAdminWalletAction,
  auditListingApproved,
  auditListingRejected,
  auditRewardMarkedPaid,
  auditAdminOutboxMarkDead,
  auditAdminOutboxRetry,
  auditLog,
  extractAuditContext,
  type AuditEventType,
} from "../utils/auditLogger.js";
import { AppError, notFound } from "../errors/AppError.js";
import { ErrorCode } from "../errors/errorCodes.js";
import { validate } from "../middleware/validate.js";
import {
  assertAdminSecret,
  requireAdminSecret,
} from "../middleware/adminSecret.js";
import { markRewardPaidSchema } from "../schemas/reward.js";
import {
  adminListingFiltersSchema,
  approveListingSchema,
  rejectListingSchema,
} from "../schemas/listing.js";
import { rewardStore } from "../models/rewardStore.js";
import { RewardStatus } from "../models/reward.js";
import { listingStore } from "../models/listingStore.js";
import { ListingStatus } from "../models/listing.js";
import { env } from "../schemas/env.js";
import type { WalletStore } from "../models/wallet.js";
import type { EncryptionService } from "../services/walletService.js";
import { ReceiptIndexer } from "../indexer/worker.js";
import { kycRepository } from "../repositories/KycRepository.js";
import { paymentDisputeRepository } from "../repositories/PaymentDisputeRepository.js";
import { v4 as uuidv4 } from "uuid";

export function createAdminRouter(
  adapter: SorobanAdapter,
  walletStore?: WalletStore,
  encryptionService?: EncryptionService,
  indexer?: ReceiptIndexer,
) {
  const router = Router();
  const sender = new OutboxSender(adapter);

  /**
   * GET /api/admin/flags
   * Expose read-only feature flags for easier debugging.
   */
  router.get(
    "/flags",
    requireAdminSecret,
    (req: Request, res: Response, next: NextFunction) => {
      try {
        res.json({
          custodialModeEnabled: env.CUSTODIAL_MODE_ENABLED,
          custodialSigningPaused: env.CUSTODIAL_SIGNING_PAUSED,
          webhookSignatureEnabled: env.WEBHOOK_SIGNATURE_ENABLED,
          databaseEnabled: !!process.env.DATABASE_URL,
          sorobanAdapterMode: env.SOROBAN_NETWORK,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/wallets/rewrap",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!walletStore || !encryptionService) {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            501,
            "Wallet rotation is not configured on this deployment",
          );
        }

        assertAdminSecret(req);

        const fromKeyId =
          typeof req.body.fromKeyId === "string"
            ? req.body.fromKeyId
            : undefined;
        const toKeyId =
          typeof req.body.toKeyId === "string"
            ? req.body.toKeyId
            : encryptionService.getCurrentKeyId();
        const batchSize = req.body.batchSize ? Number(req.body.batchSize) : 100;
        const userId =
          typeof req.body.userId === "string" ? req.body.userId : undefined;

        if (!toKeyId) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            400,
            "toKeyId is required",
          );
        }
        if (!Number.isFinite(batchSize) || batchSize <= 0 || batchSize > 1000) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            400,
            "batchSize must be between 1 and 1000",
          );
        }

        logger.info("Wallet rewrap requested", {
          fromKeyId: fromKeyId ?? "any",
          toKeyId,
          batchSize,
          userId: userId ?? "batch",
          requestId: req.requestId,
        });

        // Audit log: admin wallet action (rewrap)
        auditAdminWalletAction(req, {
          action: "WALLET_REWRAP",
          details: {
            fromKeyId: fromKeyId ?? "any",
            toKeyId,
            batchSize,
            userId: userId ?? "batch",
          },
        });

        const work: string[] = [];
        if (userId) {
          work.push(userId);
        } else {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            501,
            "Batch rewrap is not implemented for this wallet store; supply userId",
          );
        }

        let processed = 0;
        let updated = 0;
        let skipped = 0;
        const failures: { userId: string; reason: string }[] = [];

        for (const uid of work) {
          processed += 1;
          try {
            const record = await walletStore.getEncryptedKey(uid);
            if (!record) {
              skipped += 1;
              continue;
            }

            if (record.keyId === toKeyId) {
              skipped += 1;
              continue;
            }

            if (fromKeyId && record.keyId !== fromKeyId) {
              skipped += 1;
              continue;
            }

            const cipherTextBuf = Buffer.from(record.cipherText, "base64");
            const plaintext = await encryptionService.decrypt(
              cipherTextBuf,
              record.keyId,
            );
            const { cipherText: newCipherTextBuf } =
              await encryptionService.encrypt(plaintext, toKeyId);

            await walletStore.updateEncryption(
              uid,
              newCipherTextBuf.toString("base64"),
              toKeyId,
            );
            updated += 1;
          } catch (error) {
            const reason =
              error instanceof Error ? error.message : "unknown error";
            failures.push({ userId: uid, reason });
            logger.error("Failed to rewrap wallet", {
              userId: uid,
              fromKeyId: fromKeyId ?? "any",
              toKeyId,
              error: reason,
              requestId: req.requestId,
            });
          }
        }

        const hasMore = false;

        logger.info("Wallet rewrap completed", {
          fromKeyId: fromKeyId ?? "any",
          toKeyId,
          processed,
          updated,
          skipped,
          failures: failures.length,
          hasMore,
          requestId: req.requestId,
        });

        res.json({
          fromKeyId: fromKeyId ?? "any",
          toKeyId,
          processed,
          updated,
          skipped,
          failures,
          hasMore,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * GET /api/admin/outbox/health
   *
   * Returns a summary of outbox health: counts by status, oldest pending/failed items.
   * Useful for monitoring dashboards and alerting on stuck or dead-lettered events.
   */
  router.get(
    "/outbox/health",
    requireAdminSecret,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const summary = await outboxStore.getHealthSummary();

        logger.info("Outbox health summary retrieved", {
          ...summary,
          requestId: req.requestId,
        });

        res.json({
          status:
            summary.dead > 0 || summary.failed > 10 ? "degraded" : "healthy",
          summary,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * GET /api/admin/outbox/dead-letter
   *
   * List dead-lettered outbox items (issue #974).
   */
  router.get(
    "/outbox/dead-letter",
    requireAdminSecret,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 100;
        const items = await outboxStore.listByStatus(OutboxStatus.DEAD);
        res.json({
          success: true,
          data: items.slice(0, Math.min(limit, 1000)),
          total: items.length,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * GET /api/admin/outbox
   *
   * List outbox items, optionally filtered by status
   * Query params:
   *   - status: pending | sent | failed | dead (optional)
   *   - limit: number (optional, default 100)
   */
  router.get(
    "/outbox",
    requireAdminSecret,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { status, limit } = req.query;
        const limitNum = limit ? parseInt(String(limit), 10) : 100;

        if (limitNum < 1 || limitNum > 1000) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            400,
            "Limit must be between 1 and 1000",
          );
        }

        let items;

        if (status) {
          // Validate status
          if (!Object.values(OutboxStatus).includes(status as OutboxStatus)) {
            throw new AppError(
              ErrorCode.VALIDATION_ERROR,
              400,
              `Invalid status. Must be one of: ${Object.values(OutboxStatus).join(", ")}`,
            );
          }

          items = await outboxStore.listByStatus(status as OutboxStatus);
        } else {
          items = await outboxStore.listAll(limitNum);
        }

        logger.info("Outbox items retrieved", {
          count: items.length,
          status: status || "all",
          requestId: req.requestId,
        });

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
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * POST /api/admin/outbox/:id/mark-dead
   *
   * Permanently mark an outbox item as dead (stops all future retries).
   * Requires a mandatory 'reason' in the request body.
   */
  router.post(
    "/outbox/:id/mark-dead",
    requireAdminSecret,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;
        const { reason } = req.body;

        if (!reason || typeof reason !== "string" || reason.trim() === "") {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            400,
            "reason is required to mark an outbox item as dead",
          );
        }

        const item = await outboxStore.getById(id);
        if (!item) {
          throw new AppError(
            ErrorCode.NOT_FOUND,
            404,
            `Outbox item not found: ${id}`,
          );
        }

        if (item.status === OutboxStatus.SENT) {
          throw new AppError(
            ErrorCode.CONFLICT,
            409,
            `Cannot mark a SENT outbox item as dead (id: ${id})`,
          );
        }

        const dead = await outboxStore.markDead(id, reason.trim());
        if (!dead) {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            500,
            "Failed to mark outbox item as dead",
          );
        }

        logger.warn("Outbox item manually marked dead", {
          outboxId: id,
          reason: reason.trim(),
          requestId: req.requestId,
        });

        auditAdminOutboxMarkDead(req, { outboxId: id, reason: reason.trim() });

        res.json({
          success: true,
          item: {
            id: dead.id,
            txId: dead.txId,
            status: dead.status,
            lastError: dead.lastError,
            updatedAt: dead.updatedAt.toISOString(),
          },
          message:
            "Outbox item permanently marked as dead and will not be retried",
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * POST /api/admin/outbox/:id/retry
   *
   * Retry a specific outbox item
   */
  router.post(
    "/outbox/:id/retry",
    requireAdminSecret,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;

        logger.info("Manual retry requested", {
          outboxId: id,
          requestId: req.requestId,
        });

        auditAdminOutboxRetry(req, { outboxId: id });

        const item = await outboxStore.getById(id);
        if (!item) {
          throw new AppError(
            ErrorCode.NOT_FOUND,
            404,
            `Outbox item not found: ${id}`,
          );
        }

        const success = await sender.retry(id);

        // Fetch updated item
        const updatedItem = await outboxStore.getById(id);
        if (!updatedItem) {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            500,
            "Failed to retrieve outbox item after retry",
          );
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
            ? "Retry successful, receipt written to chain"
            : "Retry failed, item remains in failed state",
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * POST /api/admin/outbox/retry-all
   *
   * Retry all failed outbox items
   */
  router.post(
    "/outbox/retry-all",
    requireAdminSecret,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        logger.info("Retry all failed items requested", {
          requestId: req.requestId,
        });

        const result = await sender.retryAll();

        logger.info("Retry all completed", {
          succeeded: result.succeeded,
          failed: result.failed,
          requestId: req.requestId,
        });

        res.json({
          success: true,
          succeeded: result.succeeded,
          failed: result.failed,
          message: `Retried ${result.succeeded + result.failed} items: ${result.succeeded} succeeded, ${result.failed} failed`,
        });
      } catch (error) {
        next(error);
      }
    },
  );

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
    "/rewards/:rewardId/mark-paid",
    validate(markRewardPaidSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { rewardId } = req.params;
        const {
          amountUsdc,
          tokenAddress,
          externalRefSource,
          externalRef,
          amountNgn,
          fxRateNgnPerUsdc,
          fxProvider,
        } = req.body;

        logger.info("Marking reward as paid", {
          rewardId,
          externalRefSource,
          externalRef,
          requestId: req.requestId,
        });

        // Get reward
        const reward = await rewardStore.getById(rewardId);
        if (!reward) {
          throw new AppError(
            ErrorCode.NOT_FOUND,
            404,
            `Reward with ID '${rewardId}' not found`,
          );
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
          );
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
        });

        logger.info("Outbox item created for reward receipt", {
          rewardId,
          outboxId: outboxItem.id,
          txId: outboxItem.txId,
          requestId: req.requestId,
        });

        // Attempt to send to chain
        const sent = await sender.send(outboxItem);

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
        );

        if (!updatedReward) {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            500,
            "Failed to update reward status",
          );
        }

        // Fetch updated outbox item
        const updatedOutbox = await outboxStore.getById(outboxItem.id);
        if (!updatedOutbox) {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            500,
            "Failed to retrieve outbox item after send attempt",
          );
        }

        logger.info("Reward marked as paid", {
          rewardId,
          txId: outboxItem.txId,
          outboxStatus: updatedOutbox.status,
          requestId: req.requestId,
        });

        auditRewardMarkedPaid(req, {
          rewardId,
          amountUsdc: amountUsdc as number,
          txId: outboxItem.txId,
        });

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
            ? "Reward marked as paid and receipt written to chain"
            : "Reward marked as paid, receipt queued for retry",
        });
      } catch (error) {
        next(error);
      }
    },
  );

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
    "/whistleblower/listings",
    validate(adminListingFiltersSchema, "query"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const filters = req.query;

        logger.info("Admin listing moderation queue requested", {
          filters,
          requestId: req.requestId,
        });

        const result = await listingStore.list(filters);

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
            outrightPriceNgn: listing.outrightPriceNgn,
            installmentBasePriceNgn: listing.installmentBasePriceNgn,
            negotiatedLandlordRateNgn: listing.negotiatedLandlordRateNgn,
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
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * POST /api/admin/whistleblower/listings/:id/approve
   *
   * Approve a pending_review listing.
   * Only valid transition: pending_review -> approved.
   */
  router.post(
    "/whistleblower/listings/:id/approve",
    validate(approveListingSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;
        const { reviewedBy } = req.body;

        const listing = await listingStore.getById(id);
        if (!listing) {
          throw notFound(`Listing with ID '${id}'`);
        }

        if (listing.status !== ListingStatus.PENDING_REVIEW) {
          throw new AppError(
            ErrorCode.CONFLICT,
            409,
            `Listing cannot be approved. Current status: ${listing.status}`,
            {
              currentStatus: listing.status,
              allowedFrom: ListingStatus.PENDING_REVIEW,
            },
          );
        }

        // KYC gate: landlord (whistleblower) must have approved KYC before listing can go live
        const landlordKyc = await kycRepository.findByUserId(listing.whistleblowerId);
        if (!landlordKyc || landlordKyc.status !== 'approved') {
          throw new AppError(
            ErrorCode.FORBIDDEN,
            403,
            'LANDLORD_KYC_REQUIRED',
            { kycStatus: landlordKyc?.status ?? 'not_submitted' },
          );
        }

        const updated = await listingStore.moderate(
          id,
          ListingStatus.APPROVED,
          reviewedBy,
        );

        logger.info("Listing approved", {
          listingId: id,
          reviewedBy,
          requestId: req.requestId,
        });

        auditListingApproved(req, { listingId: id, reviewedBy });

        res.json({
          listing: {
            listingId: updated!.listingId,
            status: updated!.status,
            reviewedBy: updated!.reviewedBy,
            reviewedAt: updated!.reviewedAt?.toISOString(),
            updatedAt: updated!.updatedAt.toISOString(),
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * POST /api/admin/whistleblower/listings/:id/reject
   *
   * Reject a pending_review listing with a mandatory reason.
   * Only valid transition: pending_review -> rejected.
   */
  router.post(
    "/whistleblower/listings/:id/reject",
    validate(rejectListingSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;
        const { reviewedBy, reason } = req.body;

        const listing = await listingStore.getById(id);
        if (!listing) {
          throw notFound(`Listing with ID '${id}'`);
        }

        if (listing.status !== ListingStatus.PENDING_REVIEW) {
          throw new AppError(
            ErrorCode.CONFLICT,
            409,
            `Listing cannot be rejected. Current status: ${listing.status}`,
            {
              currentStatus: listing.status,
              allowedFrom: ListingStatus.PENDING_REVIEW,
            },
          );
        }

        const updated = await listingStore.moderate(
          id,
          ListingStatus.REJECTED,
          reviewedBy,
          reason,
        );

        logger.info("Listing rejected", {
          listingId: id,
          reviewedBy,
          requestId: req.requestId,
        });

        auditListingRejected(req, { listingId: id, reviewedBy, reason });

        res.json({
          listing: {
            listingId: updated!.listingId,
            status: updated!.status,
            reviewedBy: updated!.reviewedBy,
            reviewedAt: updated!.reviewedAt?.toISOString(),
            rejectionReason: updated!.rejectionReason,
            updatedAt: updated!.updatedAt.toISOString(),
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * GET /api/admin/indexer/metrics
   *
   * Get ReceiptIndexer metrics and status
   */
  router.get(
    "/indexer/metrics",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        assertAdminSecret(req);

        if (!indexer) {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            501,
            "ReceiptIndexer is not configured on this deployment",
          );
        }

        const metrics = indexer.getMetrics();

        logger.info("Indexer metrics retrieved", {
          requestId: req.requestId,
          metrics,
        });

        res.json({
          metrics,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * POST /api/admin/indexer/pause
   *
   * Pause the ReceiptIndexer (stops polling)
   */
  router.post(
    "/indexer/pause",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        assertAdminSecret(req);

        if (!indexer) {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            501,
            "ReceiptIndexer is not configured on this deployment",
          );
        }

        logger.info("Indexer pause requested", {
          requestId: req.requestId,
        });

        // Audit log: admin indexer action (pause)
        auditAdminWalletAction(req, {
          action: "INDEXER_PAUSE",
          details: {},
        });

        indexer.pause();

        const metrics = indexer.getMetrics();

        logger.info("Indexer paused", {
          requestId: req.requestId,
          isPaused: metrics.isPaused,
        });

        res.json({
          success: true,
          message: "Indexer paused successfully",
          metrics,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * POST /api/admin/indexer/resume
   *
   * Resume the ReceiptIndexer (continues polling)
   */
  router.post(
    "/indexer/resume",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        assertAdminSecret(req);

        if (!indexer) {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            501,
            "ReceiptIndexer is not configured on this deployment",
          );
        }

        logger.info("Indexer resume requested", {
          requestId: req.requestId,
        });

        // Audit log: admin indexer action (resume)
        auditAdminWalletAction(req, {
          action: "INDEXER_RESUME",
          details: {},
        });

        indexer.resume();

        const metrics = indexer.getMetrics();

        logger.info("Indexer resumed", {
          requestId: req.requestId,
          isPaused: metrics.isPaused,
        });

        res.json({
          success: true,
          message: "Indexer resumed successfully",
          metrics,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * POST /api/admin/kyc/bulk
   *
   * Bulk approve or reject KYC submissions
   * Max batch size: 50 IDs
   * Requires super_admin role
   */
  router.post(
    "/kyc/bulk",
    requireAdminSecret,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { action, ids, reason } = req.body as {
          action: "approve" | "reject";
          ids: string[];
          reason?: string;
        };

        if (!action || !["approve", "reject"].includes(action)) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            400,
            "Invalid action. Must be 'approve' or 'reject'",
          );
        }

        if (!Array.isArray(ids) || ids.length === 0) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            400,
            "IDs array is required and must not be empty",
          );
        }

        if (ids.length > 50) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            400,
            "Max batch size is 50 IDs",
          );
        }

        const batchId = uuidv4();
        const adminId = (req as any).user?.id || "admin";

        logger.info("Bulk KYC action requested", {
          batchId,
          action,
          count: ids.length,
          requestId: req.requestId,
        });

        // Process IDs in parallel
        const results = await Promise.allSettled(
          ids.map(async (id) => {
            try {
              const record = await kycRepository.findById(id);
              if (!record) {
                return { id, success: false, reason: "Record not found" };
              }

              if (action === "approve") {
                if (record.status !== "pending" && record.status !== "in_review") {
                  return {
                    id,
                    success: false,
                    reason: `Cannot approve in current status: ${record.status}`,
                  };
                }
                await kycRepository.updateStatus(
                  id,
                  "approved",
                  undefined,
                  undefined,
                  reason,
                  adminId,
                );
                auditLog(
                  "KYC_APPROVED" as AuditEventType,
                  extractAuditContext(req, "admin"),
                  {
                    batchId,
                    recordId: id,
                    userId: record.userId,
                  },
                );

                // Enqueue allowlist add operation for on-chain recording
                const user = await (req as any).authRepository?.getById(record.userId);
                if (user?.walletAddress) {
                  await outboxStore.create({
                    txType: TxType.ALLOWLIST_ADD,
                    source: 'kyc_approval',
                    ref: id,
                    payload: {
                      address: user.walletAddress,
                      label: 'approved',
                    },
                    aggregateId: record.userId,
                    aggregateType: 'user',
                    eventType: 'KYC_APPROVED',
                    requestId: req.requestId,
                  });
                  logger.info('Allowlist add enqueued for KYC approval', {
                    outboxRef: id,
                    userId: record.userId,
                    address: user.walletAddress,
                  });
                } else {
                  logger.warn('User has no wallet address, skipping allowlist add', {
                    userId: record.userId,
                    kycId: id,
                  });
                }
              } else {
                if (record.status !== "pending" && record.status !== "in_review") {
                  return {
                    id,
                    success: false,
                    reason: `Cannot reject in current status: ${record.status}`,
                  };
                }
                await kycRepository.updateStatus(
                  id,
                  "rejected",
                  undefined,
                  undefined,
                  reason,
                  adminId,
                );
                auditLog(
                  "KYC_REJECTED" as AuditEventType,
                  extractAuditContext(req, "admin"),
                  {
                    batchId,
                    recordId: id,
                    userId: record.userId,
                  },
                );

                // Enqueue allowlist remove operation for on-chain recording
                const user = await (req as any).authRepository?.getById(record.userId);
                if (user?.walletAddress) {
                  await outboxStore.create({
                    txType: TxType.ALLOWLIST_REMOVE,
                    source: 'kyc_rejection',
                    ref: id,
                    payload: {
                      address: user.walletAddress,
                    },
                    aggregateId: record.userId,
                    aggregateType: 'user',
                    eventType: 'KYC_REJECTED',
                    requestId: req.requestId,
                  });
                  logger.info('Allowlist remove enqueued for KYC rejection', {
                    outboxRef: id,
                    userId: record.userId,
                    address: user.walletAddress,
                  });
                } else {
                  logger.warn('User has no wallet address, skipping allowlist remove', {
                    userId: record.userId,
                    kycId: id,
                  });
                }
              }

              return { id, success: true };
            } catch (error) {
              return {
                id,
                success: false,
                reason:
                  error instanceof Error ? error.message : "Unknown error",
              };
            }
          })
        );

        const succeeded: string[] = [];
        const failed: { id: string; reason: string }[] = [];

        results.forEach((result) => {
          if (result.status === "fulfilled") {
            if (result.value.success) {
              succeeded.push(result.value.id);
            } else {
              failed.push({
                id: result.value.id,
                reason: result.value.reason || "Unknown error",
              });
            }
          } else {
            failed.push({
              id: "unknown",
              reason: result.reason?.message || "Promise rejected",
            });
          }
        });

        logger.info("Bulk KYC action completed", {
          batchId,
          action,
          succeeded: succeeded.length,
          failed: failed.length,
          requestId: req.requestId,
        });

        res.json({
          success: true,
          batchId,
          action,
          succeeded,
          failed,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/admin/disputes/bulk
   *
   * Bulk resolve or reject payment disputes
   * Max batch size: 50 IDs
   * Requires super_admin role
   */
  router.post(
    "/disputes/bulk",
    requireAdminSecret,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { action, ids, resolution } = req.body as {
          action: "resolve" | "reject";
          ids: string[];
          resolution?: string;
        };

        if (!action || !["resolve", "reject"].includes(action)) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            400,
            "Invalid action. Must be 'resolve' or 'reject'",
          );
        }

        if (!Array.isArray(ids) || ids.length === 0) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            400,
            "IDs array is required and must not be empty",
          );
        }

        if (ids.length > 50) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            400,
            "Max batch size is 50 IDs",
          );
        }

        const batchId = uuidv4();
        const adminId = (req as any).user?.id || "admin";

        logger.info("Bulk dispute action requested", {
          batchId,
          action,
          count: ids.length,
          requestId: req.requestId,
        });

        // Process IDs in parallel
        const results = await Promise.allSettled(
          ids.map(async (id) => {
            try {
              const dispute = await paymentDisputeRepository.findById(id);
              if (!dispute) {
                return { id, success: false, reason: "Dispute not found" };
              }

              if (dispute.status !== "pending" && dispute.status !== "under_review") {
                return {
                  id,
                  success: false,
                  reason: `Cannot process in current status: ${dispute.status}`,
                };
              }

              const newStatus = action === "resolve" ? "resolved" : "rejected";
              const updated = await paymentDisputeRepository.updateStatus(
                id,
                newStatus,
                resolution,
                adminId
              );

              if (updated) {
                const { enqueueResolveRentDispute } = await import(
                  "../services/disputes/rentReleaseSync.js"
                );
                enqueueResolveRentDispute(updated, newStatus, resolution ?? "").catch((err) =>
                  logger.error("Failed to enqueue resolve_rent_dispute for dispute:", err)
                );
              }

              auditLog(
                "DISPUTE_RESOLVED" as AuditEventType,
                extractAuditContext(req, "admin"),
                {
                  batchId,
                  disputeId: id,
                  status: newStatus,
                  resolution,
                }
              );

              return { id, success: true };
            } catch (error) {
              return {
                id,
                success: false,
                reason:
                  error instanceof Error ? error.message : "Unknown error",
              };
            }
          })
        );

        const succeeded: string[] = [];
        const failed: { id: string; reason: string }[] = [];

        results.forEach((result) => {
          if (result.status === "fulfilled") {
            if (result.value.success) {
              succeeded.push(result.value.id);
            } else {
              failed.push({
                id: result.value.id,
                reason: result.value.reason || "Unknown error",
              });
            }
          } else {
            failed.push({
              id: "unknown",
              reason: result.reason?.message || "Promise rejected",
            });
          }
        });

        logger.info("Bulk dispute action completed", {
          batchId,
          action,
          succeeded: succeeded.length,
          failed: failed.length,
          requestId: req.requestId,
        });

        res.json({
          success: true,
          batchId,
          action,
          succeeded,
          failed,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/admin/listings/bulk
   *
   * Bulk activate, deactivate, or delete listings
   * Max batch size: 50 IDs
   * Requires super_admin role
   */
  router.post(
    "/listings/bulk",
    requireAdminSecret,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { action, ids } = req.body as {
          action: "activate" | "deactivate" | "delete";
          ids: string[];
        };

        if (!action || !["activate", "deactivate", "delete"].includes(action)) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            400,
            "Invalid action. Must be 'activate', 'deactivate', or 'delete'",
          );
        }

        if (!Array.isArray(ids) || ids.length === 0) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            400,
            "IDs array is required and must not be empty",
          );
        }

        if (ids.length > 50) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            400,
            "Max batch size is 50 IDs",
          );
        }

        const batchId = uuidv4();
        const adminId = (req as any).user?.id || "admin";

        logger.info("Bulk listing action requested", {
          batchId,
          action,
          count: ids.length,
          requestId: req.requestId,
        });

        // Process IDs in parallel
        const results = await Promise.allSettled(
          ids.map(async (id) => {
            try {
              const listing = await listingStore.getById(id);
              if (!listing) {
                return { id, success: false, reason: "Listing not found" };
              }

              if (action === "activate") {
                if (listing.status !== ListingStatus.PENDING_REVIEW) {
                  return {
                    id,
                    success: false,
                    reason: `Cannot activate in current status: ${listing.status}`,
                  };
                }
                const updated = await listingStore.moderate(
                  id,
                  ListingStatus.APPROVED,
                  adminId
                );
                auditLog(
                  "LISTING_APPROVED" as AuditEventType,
                  extractAuditContext(req, "admin"),
                  {
                    batchId,
                    listingId: id,
                    reviewedBy: adminId,
                  }
                );
              } else if (action === "deactivate") {
                if (listing.status !== ListingStatus.APPROVED) {
                  return {
                    id,
                    success: false,
                    reason: `Cannot deactivate in current status: ${listing.status}`,
                  };
                }
                const updated = await listingStore.moderate(
                  id,
                  ListingStatus.REJECTED,
                  adminId,
                  "Deactivated by admin"
                );
                auditLog(
                  "LISTING_REJECTED" as AuditEventType,
                  extractAuditContext(req, "admin"),
                  {
                    batchId,
                    listingId: id,
                    reviewedBy: adminId,
                    reason: "Deactivated by admin",
                  }
                );
              } else if (action === "delete") {
                // Soft delete - update status to rejected with reason
                const updated = await listingStore.moderate(
                  id,
                  ListingStatus.REJECTED,
                  adminId,
                  "Deleted by admin"
                );
                auditLog(
                  "LISTING_DELETED" as AuditEventType,
                  extractAuditContext(req, "admin"),
                  {
                    batchId,
                    listingId: id,
                    reviewedBy: adminId,
                  }
                );
              }

              return { id, success: true };
            } catch (error) {
              return {
                id,
                success: false,
                reason:
                  error instanceof Error ? error.message : "Unknown error",
              };
            }
          })
        );

        const succeeded: string[] = [];
        const failed: { id: string; reason: string }[] = [];

        results.forEach((result) => {
          if (result.status === "fulfilled") {
            if (result.value.success) {
              succeeded.push(result.value.id);
            } else {
              failed.push({
                id: result.value.id,
                reason: result.value.reason || "Unknown error",
              });
            }
          } else {
            failed.push({
              id: "unknown",
              reason: result.reason?.message || "Promise rejected",
            });
          }
        });

        logger.info("Bulk listing action completed", {
          batchId,
          action,
          succeeded: succeeded.length,
          failed: failed.length,
          requestId: req.requestId,
        });

        res.json({
          success: true,
          batchId,
          action,
          succeeded,
          failed,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /api/admin/receipts
   * List indexed receipts with optional filters (no admin-secret gate)
   */
  router.get(
    "/receipts",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!indexer?.receiptRepository) {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            501,
            "Receipt repository not available on this deployment",
          );
        }

        const page = Math.max(1, Number(req.query.page ?? 1));
        const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20)));
        const dealId = typeof req.query.dealId === "string" ? req.query.dealId : undefined;

        const result = await indexer.receiptRepository.query({
          dealId,
          page,
          pageSize,
        });

        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
