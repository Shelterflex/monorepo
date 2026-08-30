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
const getClaimableRewardSchema = z.object({
  whistleblower: z.string(),
});

const claimRewardSchema = z.object({
  whistleblower: z.string(),
});

export function createWhistleblowerRewardsRouter(adapter: SorobanAdapter) {
  const router = Router();

  /**
   * GET /api/whistleblower-rewards/claimable
   * Get claimable reward amount for a whistleblower (user-facing)
   */
  router.get(
    "/claimable",
    validate(getClaimableRewardSchema, 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { whistleblower } = req.query as { whistleblower: string };

        if (!adapter.getClaimableReward) {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            501,
            "Whistleblower rewards functionality not available"
          );
        }

        const claimableAmount = await adapter.getClaimableReward(whistleblower);

        res.json({
          whistleblower,
          claimableAmount: claimableAmount.toString(),
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/whistleblower-rewards/claim
   * Claim allocated reward for a whistleblower (user-facing)
   */
  router.post(
    "/claim",
    validate(claimRewardSchema, 'body'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { whistleblower } = req.body;

        if (!adapter.claimReward) {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            501,
            "Whistleblower rewards functionality not available"
          );
        }

        const claimedAmount = await adapter.claimReward(whistleblower);

        logger.info("Whistleblower reward claimed", {
          whistleblower,
          claimedAmount: claimedAmount.toString(),
        });

        res.json({
          success: true,
          whistleblower,
          claimedAmount: claimedAmount.toString(),
          message: "Whistleblower reward claimed successfully",
        });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
