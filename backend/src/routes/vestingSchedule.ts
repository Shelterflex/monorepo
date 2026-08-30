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
import { requireAdminSecret, assertAdminSecret } from "../middleware/adminSecret.js";
import { z } from "zod";

// Validation schemas
const createVestingScheduleSchema = z.object({
  beneficiary: z.string(),
  totalAmount: z.string(), // USDC amount as string
  startTime: z.number(), // Unix timestamp
  endTime: z.number(), // Unix timestamp
  cliffTime: z.number(), // Unix timestamp
  revocable: z.boolean(),
});

const revokeVestingSchema = z.object({
  beneficiary: z.string(),
});

const getClaimableVestedSchema = z.object({
  beneficiary: z.string(),
});

const claimVestedSchema = z.object({
  beneficiary: z.string(),
});

export function createVestingScheduleRouter(adapter: SorobanAdapter) {
  const router = Router();

  /**
   * POST /api/admin/vesting-schedule/create
   * Create a new vesting schedule for a beneficiary (admin-only)
   */
  router.post(
    "/create",
    requireAdminSecret,
    validate(createVestingScheduleSchema, 'body'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { beneficiary, totalAmount, startTime, endTime, cliffTime, revocable } = req.body;

        if (!adapter.createVestingSchedule) {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            501,
            "Vesting schedule functionality not available"
          );
        }

        const txHash = await adapter.createVestingSchedule(
          beneficiary,
          BigInt(totalAmount),
          startTime,
          endTime,
          cliffTime,
          revocable
        );

        logger.info("Vesting schedule created", {
          beneficiary,
          totalAmount,
          startTime,
          endTime,
          cliffTime,
          revocable,
          txHash,
        });

        res.json({
          success: true,
          txHash,
          message: "Vesting schedule created successfully",
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/admin/vesting-schedule/revoke
   * Revoke a vesting schedule (admin-only)
   */
  router.post(
    "/revoke",
    requireAdminSecret,
    validate(revokeVestingSchema, 'body'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { beneficiary } = req.body;

        if (!adapter.revokeVesting) {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            501,
            "Vesting schedule functionality not available"
          );
        }

        const unclaimedAmount = await adapter.revokeVesting(beneficiary);

        logger.info("Vesting schedule revoked", {
          beneficiary,
          unclaimedAmount: unclaimedAmount.toString(),
        });

        res.json({
          success: true,
          unclaimedAmount: unclaimedAmount.toString(),
          message: "Vesting schedule revoked successfully",
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /api/vesting-schedule/claimable
   * Get claimable amount for a beneficiary (user-facing)
   */
  router.get(
    "/claimable",
    validate(getClaimableVestedSchema, 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { beneficiary } = req.query as { beneficiary: string };

        if (!adapter.getClaimableVested) {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            501,
            "Vesting schedule functionality not available"
          );
        }

        const claimableAmount = await adapter.getClaimableVested(beneficiary);

        res.json({
          beneficiary,
          claimableAmount: claimableAmount.toString(),
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/vesting-schedule/claim
   * Claim vested tokens for a beneficiary (user-facing)
   */
  router.post(
    "/claim",
    validate(claimVestedSchema, 'body'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { beneficiary } = req.body;

        if (!adapter.claimVested) {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            501,
            "Vesting schedule functionality not available"
          );
        }

        const claimedAmount = await adapter.claimVested(beneficiary);

        logger.info("Vested tokens claimed", {
          beneficiary,
          claimedAmount: claimedAmount.toString(),
        });

        res.json({
          success: true,
          beneficiary,
          claimedAmount: claimedAmount.toString(),
          message: "Vested tokens claimed successfully",
        });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
