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
import { logger } from "../utils/logger.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/errorCodes.js";
import { outboxStore, OutboxSender, TxType } from "../outbox/index.js";
import { createSorobanAdapter } from "../soroban/index.js";
import { getSorobanConfigFromEnv } from "../soroban/client.js";
import { NgnWalletService } from "../services/ngnWalletService.js";
import { getPaymentProvider } from "../payments/index.js";
import { requireValidWebhookSignature } from "../payments/webhookSignature.js";

export function createWebhooksRouter(ngnWalletService: NgnWalletService) {
  const router = Router();
  const adapter = createSorobanAdapter(getSorobanConfigFromEnv(process.env));
  const sender = new OutboxSender(adapter);

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
   * Signature validation is enforced in production mode when WEBHOOK_SIGNATURE_ENABLED=true
   */
  router.post(
    "/payments/:rail",
    validate(paymentsWebhookSchema),
    async (req: Request, res: Response, next: NextFunction) => {
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
          return res.status(200).json({ success: true });
        }

        // Handle reversed/chargeback status
        if (internalStatus === "reversed") {
          const reversed = existingStakingDeposit
            ? await depositStore.reverseByCanonical(rail, externalRef)
            : await ngnDepositStore.setStatusByCanonical(
                rail,
                externalRef,
                "reversed",
              );

          if (reversed) {
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

        res.status(200).json({ success: true });
      } catch (error) {
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

        res.status(200).json({ success: true });
      } catch (error) {
        if (error instanceof AppError && error.code === ErrorCode.NOT_FOUND) {
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
        next(error);
      }
    },
  );

  return router;
}
