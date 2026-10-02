import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { validate } from "../middleware/validate.js";
import { paymentsWebhookSchema } from "../schemas/deposit.js";
import { depositReversalWebhookSchema } from "../schemas/risk.js";
import { depositStore } from "../models/depositStore.js";
import { ngnDepositStore } from "../models/ngnDepositStore.js";
import { webhookEventDedupeStore } from "../models/webhookEventDedupeStore.js";
import { logger } from "../utils/logger.js";
import { recordKPI } from "../utils/appMetrics.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/errorCodes.js";
import { outboxStore, OutboxSender, TxType } from "../outbox/index.js";
import { createSorobanAdapter } from "../soroban/index.js";
import { getSorobanConfigFromEnv } from "../soroban/client.js";
import { NgnWalletService } from "../services/ngnWalletService.js";
import { getPaymentProvider } from "../payments/index.js";
import { requireValidWebhookSignature } from "../payments/webhookSignature.js";
import {
  verifyPaystackSignature,
  verifyFlutterwaveSignature,
} from "../middleware/webhookSignature.js";
import { jsonPayloadSha256Hex, sha256Hex, generateRandomSecretHex } from "../utils/sha256.js";
import { z } from "zod";
import { authenticateToken, type AuthenticatedRequest } from "../middleware/auth.js";
import {
  WebhookEventType,
  webhookSubscriptionStore,
  webhookDeliveryStore
} from "../models/webhookSubscription.js";
import { getWebhookReplayStore } from "../webhookReplay/store.js";
import { WebhookProcessingStatus } from "../webhookReplay/types.js";
import { validateUrlForSSRF, revalidateUrlForSSRF } from "../utils/ssrfProtection.js";
import rateLimit from "express-rate-limit";

function extractWebhookHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers[key] = value;
    else if (Array.isArray(value)) headers[key] = value.join(",");
  }
  return headers;
}


export function createWebhooksRouter(ngnWalletService: NgnWalletService) {
  const router = Router();
  const adapter = createSorobanAdapter(getSorobanConfigFromEnv(process.env));
  const sender = new OutboxSender(adapter);

  // Rate limit for webhook subscription creation
  const subscriptionRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 subscriptions per 15 minutes per user
    keyGenerator: (req) => {
      const authReq = req as AuthenticatedRequest;
      return authReq.user?.id || 'anonymous';
    },
    message: 'Too many webhook subscription requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
  });

  /**
   * POST /api/webhooks/payments/:rail
   *
   * Webhook endpoint for payment provider notifications.
   * Idempotent by (rail, externalRef) - replays won't double-credit.
   *
   * Handles:
   * - confirmed: Credits NGN wallet and marks deposit as confirmed
   * - failed: Marks deposit as failed (no wallet credit)
   * - reversed: Debits NGN wallet and marks deposit as reversed
   *
   * Signature validation is always enforced in production. In non-production,
   * it can be enabled with WEBHOOK_SIGNATURE_ENABLED=true.
   */
  router.post(
    "/payments/:rail",
    (req: Request, res: Response, next: NextFunction) => {
      const rail = String(req.params.rail)
      if (rail === 'paystack') return verifyPaystackSignature(req, res, next)
      if (rail === 'flutterwave') return verifyFlutterwaveSignature(req, res, next)
      next()
    },
    validate(paymentsWebhookSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      const replayStore = getWebhookReplayStore();
      let replayWebhookEventId: string | null = null;
      try {
        const rail = String(req.params.rail);

        const provider = getPaymentProvider(rail);
        const parsed = await provider.parseAndValidateWebhook(req);
        const { externalRefSource, externalRef, rawStatus, providerStatus } =
          parsed;

        // Validate rail matches externalRefSource
        if (externalRefSource !== rail) {
          throw new AppError(ErrorCode.VALIDATION_ERROR, 400, "Rail mismatch");
        }

        const replayEvent = await replayStore.createEvent({
          provider: rail,
          eventType: `payments.${String(rawStatus ?? providerStatus ?? "unknown")}`,
          externalId: parsed.providerEventId,
          payload: req.body as Record<string, unknown>,
          headers: extractWebhookHeaders(req),
          processingStatus: WebhookProcessingStatus.PENDING,
        });
        replayWebhookEventId = replayEvent.id;
        if (replayEvent.processingStatus === WebhookProcessingStatus.PROCESSED) {
          recordKPI("webhookEventDeduped");
          return res
            .status(200)
            .json({ success: true, deduped: true, providerEventId: parsed.providerEventId });
        }

        // Persisted idempotency on provider event id (after signature validation) — replays short-circuit here.
        const payloadHash = jsonPayloadSha256Hex(req.body);
        const claim = await webhookEventDedupeStore.tryClaim({
          rail,
          providerEventId: parsed.providerEventId,
          payloadHash,
        });
        if (claim === "duplicate") {
          recordKPI("webhookEventDeduped");
          logger.info("Webhook event deduplicated (provider event id)", {
            rail,
            providerEventId: parsed.providerEventId,
            requestId: req.requestId,
          });
          return res
            .status(200)
            .json({ success: true, deduped: true, providerEventId: parsed.providerEventId });
        }

        const existingStakingDeposit = await depositStore.getByCanonical(
          rail,
          externalRef,
        );
        const existingWalletDeposit = existingStakingDeposit
          ? null
          : await ngnDepositStore.getByCanonical(rail, externalRef);

        if (!existingStakingDeposit && !existingWalletDeposit) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, "Deposit not found");
        }

        const depositId =
          existingStakingDeposit?.depositId ?? existingWalletDeposit!.depositId;
        const userId =
          existingStakingDeposit?.userId ?? existingWalletDeposit!.userId;
        const amountNgn =
          existingStakingDeposit?.amountNgn ?? existingWalletDeposit!.amountNgn;
        const reference = externalRef;

        const internalStatus = provider.mapStatus({
          rawStatus,
          providerStatus,
        });

        // Handle failed status
        if (internalStatus === "failed") {
          if (existingStakingDeposit) {
            await depositStore.fail(depositId);
          } else {
            await ngnDepositStore.setStatusById(depositId, "failed");
          }
          logger.warn("Deposit failed via webhook", {
            depositId,
            userId,
            rail,
            externalRef,
            providerStatus,
            requestId: req.requestId,
          });
          await replayStore.updateEventStatus(
            replayWebhookEventId!,
            WebhookProcessingStatus.PROCESSED,
          );
          return res.status(200).json({ success: true });
        }

        // Handle reversed/chargeback status
        if (internalStatus === "reversed") {
          const wasCredited =
            existingStakingDeposit?.status === "confirmed" ||
            existingWalletDeposit?.status === "confirmed";
          const reversed = existingStakingDeposit
            ? await depositStore.reverseByCanonical(rail, externalRef)
            : await ngnDepositStore.setStatusByCanonical(
                rail,
                externalRef,
                "reversed",
              );

          if (reversed && wasCredited) {
            // Debit wallet balance (idempotent - won't double-debit)
            const result = await ngnWalletService.reverseTopUp(
              userId,
              depositId,
              amountNgn,
              reference,
            );

            logger.info("Deposit reversed via webhook", {
              depositId,
              userId,
              rail,
              externalRef,
              amountNgn,
              newAvailableBalance: result.newBalance.availableNgn,
              providerStatus,
              requestId: req.requestId,
            });
          }

          await replayStore.updateEventStatus(
            replayWebhookEventId!,
            WebhookProcessingStatus.PROCESSED,
          );
          return res.status(200).json({ success: true });
        }

        // Handle confirmed status
        if (internalStatus === "confirmed") {
          if (existingStakingDeposit) {
            const confirmed = await depositStore.confirmByCanonical(
              rail,
              externalRef,
            );

            if (confirmed && confirmed.confirmedAt) {
              const creditResult = await ngnWalletService.creditTopUp(
                userId,
                depositId,
                amountNgn,
                reference,
              );

              if (creditResult.credited) {
                logger.info(
                  "Deposit confirmed and wallet credited, triggering conversion",
                  {
                    depositId,
                    userId,
                    amountNgn,
                    requestId: req.requestId,
                  },
                );

                // Auto-convert to USDC (idempotent)
                // We use a try-catch to log conversion failure but still return 200 to the PSP
                try {
                  const synthesis = await (
                    req.app.get("conversionService") as any
                  ).convertDeposit({
                    depositId,
                    userId,
                    amountNgn,
                  });

                  // Auto-stake if conversion successful (idempotent by depositId)
                  const outboxItem = await outboxStore.create({
                    txType: TxType.STAKE,
                    source: "deposit",
                    ref: depositId,
                    payload: {
                      txType: TxType.STAKE,
                      amountUsdc: synthesis.amountUsdc,
                      amountNgn: synthesis.amountNgn,
                      fxRateNgnPerUsdc: synthesis.fxRateNgnPerUsdc,
                      depositId,
                      userId,
                    },
                  });
                  await sender.send(outboxItem);

                  logger.info(
                    "Auto-conversion and staking initiated from webhook",
                    {
                      depositId,
                      conversionId: synthesis.conversionId,
                      outboxId: outboxItem.id,
                      requestId: req.requestId,
                    },
                  );
                } catch (convError) {
                  logger.error("Auto-conversion failed in webhook context", {
                    depositId,
                    error:
                      convError instanceof Error
                        ? convError.message
                        : String(convError),
                    requestId: req.requestId,
                  });
                }
              }

              logger.info("Deposit confirmation processing complete", {
                depositId,
                userId,
                credited: creditResult.credited,
                requestId: req.requestId,
              });
            }
          } else {
            const confirmed = await ngnDepositStore.setStatusByCanonical(
              rail,
              externalRef,
              "confirmed",
            );
            if (confirmed) {
              const creditResult = await ngnWalletService.creditTopUp(
                userId,
                depositId,
                amountNgn,
                reference,
              );
              logger.info(
                "Wallet topup confirmed and wallet credited via webhook",
                {
                  depositId,
                  userId,
                  rail,
                  externalRef,
                  amountNgn,
                  newAvailableBalance: creditResult.newBalance.availableNgn,
                  credited: creditResult.credited,
                  providerStatus,
                  requestId: req.requestId,
                },
              );
            }
          }
        }

        await replayStore.updateEventStatus(
          replayWebhookEventId!,
          WebhookProcessingStatus.PROCESSED,
        );
        res.status(200).json({ success: true });
      } catch (error) {
        if (replayWebhookEventId) {
          const message = error instanceof Error ? error.message : String(error);
          await replayStore.updateEventStatus(
            replayWebhookEventId,
            WebhookProcessingStatus.FAILED,
            message,
          );
        }
        next(error);
      }
    },
  );

  /**
   * POST /api/webhooks/reversals/:provider
   * Handle deposit reversal/chargeback webhooks
   * Idempotent based on (provider, providerRef, eventType)
   */
  router.post(
    "/reversals/:provider",
    validate(depositReversalWebhookSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      const replayStore = getWebhookReplayStore();
      let replayWebhookEventId: string | null = null;
      try {
        const provider = String(req.params.provider);

        // Enforce provider-specific webhook signature validation (always on in production)
        requireValidWebhookSignature(req, provider as any);

        const {
          provider: bodyProvider,
          providerRef,
          reversalRef,
          eventType,
        } = req.body;

        const replayEvent = await replayStore.createEvent({
          provider,
          eventType: String(eventType),
          externalId: String(reversalRef),
          payload: req.body as Record<string, unknown>,
          headers: extractWebhookHeaders(req),
          processingStatus: WebhookProcessingStatus.PENDING,
        });
        replayWebhookEventId = replayEvent.id;
        if (replayEvent.processingStatus === WebhookProcessingStatus.PROCESSED) {
          recordKPI("webhookEventDeduped");
          return res
            .status(200)
            .json({ success: true, deduped: true, providerEventId: reversalRef });
        }

        if (bodyProvider !== provider) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            400,
            "Provider mismatch",
          );
        }

        if (eventType !== "deposit.reversed") {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            400,
            "Invalid event type",
          );
        }

        const claim = await webhookEventDedupeStore.tryClaim({
          rail: provider,
          providerEventId: reversalRef,
          payloadHash: jsonPayloadSha256Hex(req.body),
        });
        if (claim === "duplicate") {
          recordKPI("webhookEventDeduped");
          return res.status(200).json({
            success: true,
            deduped: true,
            providerEventId: reversalRef,
          });
        }

        logger.info("Processing deposit reversal webhook", {
          provider,
          providerRef,
          reversalRef,
          requestId: req.requestId,
        });

        // Process the reversal (idempotent)
        await ngnWalletService.processDepositReversal(
          provider,
          providerRef,
          reversalRef,
        );

        logger.info("Deposit reversal processed successfully", {
          provider,
          providerRef,
          reversalRef,
          requestId: req.requestId,
        });

        await replayStore.updateEventStatus(
          replayWebhookEventId!,
          WebhookProcessingStatus.PROCESSED,
        );
        res.status(200).json({ success: true });
      } catch (error) {
        if (error instanceof AppError && error.code === ErrorCode.NOT_FOUND) {
          if (replayWebhookEventId) {
            await replayStore.updateEventStatus(
              replayWebhookEventId,
              WebhookProcessingStatus.FAILED,
              error.message,
            );
          }
          // If deposit not found, still return 200 to prevent webhook retries
          logger.warn("Deposit not found for reversal webhook", {
            provider: req.params.provider,
            providerRef: (req.body as { providerRef?: string }).providerRef,
            reversalRef: (req.body as { reversalRef?: string }).reversalRef,
            requestId: req.requestId,
          });
          res.status(200).json({ success: true, message: "Deposit not found" });
          return;
        }
        if (replayWebhookEventId) {
          const message = error instanceof Error ? error.message : String(error);
          await replayStore.updateEventStatus(
            replayWebhookEventId,
            WebhookProcessingStatus.FAILED,
            message,
          );
        }
        next(error);
      }
    },
  );

  const subscriptionSchema = z.object({
    targetUrl: z.string().url(),
    events: z.array(z.nativeEnum(WebhookEventType)),
  });

  /**
   * POST /api/webhooks/subscriptions
   * Register a new subscription (authenticated; owner scoped)
   */
  router.post(
    "/subscriptions",
    authenticateToken,
    subscriptionRateLimit,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const userId = req.user?.id;
        if (!userId) {
          throw new AppError(ErrorCode.UNAUTHORIZED, 401, "Authentication required");
        }

        const { targetUrl, events } = subscriptionSchema.parse(req.body);

        // SSRF protection: validate URL doesn't point to private/internal IPs
        try {
          validateUrlForSSRF(targetUrl);
        } catch (ssrfError) {
          throw new AppError(ErrorCode.VALIDATION_ERROR, 400, ssrfError instanceof Error ? ssrfError.message : 'Invalid URL');
        }

        const plainSecret = `whsec_${generateRandomSecretHex(24)}`;
        const hashedSecret = sha256Hex(plainSecret);

        const sub = await webhookSubscriptionStore.create({
          ownerId: userId,
          targetUrl,
          secret: hashedSecret,
          events: events as WebhookEventType[],
        });

        res.status(201).json({
          success: true,
          subscription: {
            id: sub.id,
            ownerId: sub.ownerId,
            targetUrl: sub.targetUrl,
            secret: plainSecret,
            events: sub.events,
            active: sub.active,
            createdAt: sub.createdAt.toISOString(),
          }
        });
      } catch (error) {
        if (error instanceof Error && error.name === "ZodError") {
          return next(new AppError(ErrorCode.VALIDATION_ERROR, 400, error.message));
        }
        next(error);
      }
    }
  );

  /**
   * GET /api/webhooks/subscriptions
   * List own subscriptions
   */
  router.get(
    "/subscriptions",
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const userId = req.user?.id;
        if (!userId) {
          throw new AppError(ErrorCode.UNAUTHORIZED, 401, "Authentication required");
        }

        const subs = await webhookSubscriptionStore.listByOwner(userId);
        res.status(200).json({
          success: true,
          subscriptions: subs.map(s => ({
            id: s.id,
            ownerId: s.ownerId,
            targetUrl: s.targetUrl,
            events: s.events,
            active: s.active,
            createdAt: s.createdAt.toISOString(),
          }))
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * DELETE /api/webhooks/subscriptions/:id
   * Remove a subscription
   */
  router.delete(
    "/subscriptions/:id",
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const userId = req.user?.id;
        if (!userId) {
          throw new AppError(ErrorCode.UNAUTHORIZED, 401, "Authentication required");
        }

        const { id } = req.params;
        const sub = await webhookSubscriptionStore.findById(id);
        if (!sub) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, "Subscription not found");
        }

        if (sub.ownerId !== userId) {
          throw new AppError(ErrorCode.FORBIDDEN, 403, "Access denied");
        }

        await webhookSubscriptionStore.delete(id);
        res.status(200).json({ success: true, message: "Subscription removed" });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /api/webhooks/subscriptions/:id/deliveries
   * Delivery history for a subscription
   */
  router.get(
    "/subscriptions/:id/deliveries",
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const userId = req.user?.id;
        if (!userId) {
          throw new AppError(ErrorCode.UNAUTHORIZED, 401, "Authentication required");
        }

        const { id } = req.params;
        const sub = await webhookSubscriptionStore.findById(id);
        if (!sub) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, "Subscription not found");
        }

        if (sub.ownerId !== userId) {
          throw new AppError(ErrorCode.FORBIDDEN, 403, "Access denied");
        }

        const deliveries = await webhookDeliveryStore.getHistoryBySubscription(id);
        res.status(200).json({
          success: true,
          deliveries: deliveries.map(d => ({
            id: d.id,
            subscriptionId: d.subscriptionId,
            event: d.event,
            payload: d.payload,
            status: d.status,
            responseCode: d.responseCode,
            responseBody: d.responseBody,
            attemptedAt: d.attemptedAt.toISOString(),
          }))
        });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
