import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { SorobanAdapter } from "../soroban/adapter.js";
import { logger } from "../utils/logger.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/errorCodes.js";
import { validate } from "../middleware/validate.js";
import { requireAdminSecret } from "../middleware/adminSecret.js";
import { z } from "zod";

// Validation schemas
const proposeDrainSchema = z.object({
  destination: z.string(),
});

const setRecoveryDelaySchema = z.object({
  delaySeconds: z.number().int().min(0),
});

export function createCircuitBreakerRouter(adapter: SorobanAdapter) {
  const router = Router();

  /**
   * POST /api/admin/circuit-breaker/freeze
   * Freeze the deal_escrow contract (admin-only emergency control)
   */
  router.post(
    "/freeze",
    requireAdminSecret,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!adapter.freeze) {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            501,
            "Circuit breaker functionality not available"
          );
        }

        const txHash = await adapter.freeze();

        logger.info("Deal escrow frozen", { txHash });

        res.json({
          success: true,
          txHash,
          message: "Deal escrow frozen successfully",
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /api/admin/circuit-breaker/status
   * Get the current circuit breaker state (admin-only)
   */
  router.get(
    "/status",
    requireAdminSecret,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!adapter.isFrozen || !adapter.getCircuitBreakerState) {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            501,
            "Circuit breaker functionality not available"
          );
        }

        const [frozen, state] = await Promise.all([
          adapter.isFrozen(),
          adapter.getCircuitBreakerState(),
        ]);

        res.json({
          frozen,
          state,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/admin/circuit-breaker/propose-drain
   * Propose draining funds to a destination (admin-only emergency control)
   */
  router.post(
    "/propose-drain",
    requireAdminSecret,
    validate(proposeDrainSchema, 'body'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { destination } = req.body;

        if (!adapter.proposeDrain) {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            501,
            "Circuit breaker functionality not available"
          );
        }

        const txHash = await adapter.proposeDrain(destination);

        logger.info("Drain proposed", { destination, txHash });

        res.json({
          success: true,
          txHash,
          message: "Drain proposed successfully",
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/admin/circuit-breaker/execute-drain
   * Execute the proposed drain (admin-only emergency control)
   */
  router.post(
    "/execute-drain",
    requireAdminSecret,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!adapter.executeDrain) {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            501,
            "Circuit breaker functionality not available"
          );
        }

        const txHash = await adapter.executeDrain();

        logger.info("Drain executed", { txHash });

        res.json({
          success: true,
          txHash,
          message: "Drain executed successfully",
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/admin/circuit-breaker/set-recovery-delay
   * Set the recovery delay for circuit breaker (admin-only)
   */
  router.post(
    "/set-recovery-delay",
    requireAdminSecret,
    validate(setRecoveryDelaySchema, 'body'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { delaySeconds } = req.body;

        if (!adapter.setRecoveryDelay) {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            501,
            "Circuit breaker functionality not available"
          );
        }

        const txHash = await adapter.setRecoveryDelay(delaySeconds);

        logger.info("Recovery delay set", { delaySeconds, txHash });

        res.json({
          success: true,
          txHash,
          message: "Recovery delay set successfully",
        });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
