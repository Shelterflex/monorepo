import {
  Router,
  type Response,
  type NextFunction,
} from "express";
import { SorobanAdapter } from "../soroban/adapter.js";
import { logger } from "../utils/logger.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/errorCodes.js";
import { validate } from "../middleware/validate.js";
import { authenticateToken, type AuthenticatedRequest } from "../middleware/auth.js";
import { z } from "zod";

// Validation schemas
const ownClaimSchema = z.object({}).strict().default({});

function requireWalletAddress(req: AuthenticatedRequest): string {
  const address = req.user?.walletAddress;
  if (!address) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      400,
      "User must have a linked Stellar wallet address"
    );
  }
  return address;
}

export function createWhistleblowerRewardsRouter(adapter: SorobanAdapter) {
  const router = Router();

  /**
   * GET /api/whistleblower-rewards/claimable
   * Get claimable reward amount for a whistleblower (user-facing)
   */
  router.get(
    "/claimable",
    authenticateToken,
    validate(ownClaimSchema, 'query'),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const whistleblower = requireWalletAddress(req);

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
    authenticateToken,
    validate(ownClaimSchema, 'body'),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const whistleblower = requireWalletAddress(req);

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
