import { Router, type Response, type NextFunction } from "express";
import { validate } from "../middleware/validate.js";
import { NgnWalletService } from "../services/ngnWalletService.js";
import { userRiskStateStore } from "../models/userRiskStateStore.js";
import {
  freezeUserRequestSchema,
  unfreezeUserRequestSchema,
  userRiskDetailResponseSchema,
  frozenUsersResponseSchema,
  type FreezeUserRequest,
  type UnfreezeUserRequest,
} from "../schemas/risk.js";
import { logger } from "../utils/logger.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/errorCodes.js";
import {
  authenticateToken,
  type AuthenticatedRequest,
} from "../middleware/auth.js";
import { auditAdminRiskOperation } from "../utils/auditLogger.js";

export function createAdminRiskRouter(
  ngnWalletService: NgnWalletService,
): Router {
  const router = Router();

  /**
   * GET /api/admin/risk/frozen-users
   * Returns all frozen user accounts
   */
  router.get(
    "/frozen-users",
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        logger.info("Getting frozen users", {
          adminId: req.user!.id,
          requestId: req.requestId,
        });

        const frozenStates = await userRiskStateStore.getAllFrozen();

        const response = {
          success: true,
          users: frozenStates.map((state) => ({
            ...state,
            frozenAt: state.frozenAt?.toISOString() || null,
            unfrozenAt: state.unfrozenAt?.toISOString() || null,
            createdAt: state.createdAt.toISOString(),
            updatedAt: state.updatedAt.toISOString(),
          })),
        };

        logger.info("Frozen users retrieved", {
          adminId: req.user!.id,
          count: frozenStates.length,
          requestId: req.requestId,
        });

        res.json(frozenUsersResponseSchema.parse(response));
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * GET /api/admin/risk/:userId
   * Returns risk state and current balances for a specific user
   */
  router.get(
    "/:userId",
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const { userId } = req.params;

        logger.info("Getting user risk details", {
          adminId: req.user!.id,
          targetUserId: userId,
          requestId: req.requestId,
        });

        const riskState = await userRiskStateStore.getByUserId(userId);
        const balances = await ngnWalletService.getBalance(userId);

        if (!riskState) {
          // User has no risk state record - return default unfrozen state
          const response = {
            success: true,
            riskState: {
              userId,
              isFrozen: false,
              freezeReason: null,
              frozenAt: null,
              unfrozenAt: null,
              notes: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            balances,
          };

          res.json(userRiskDetailResponseSchema.parse(response));
          return;
        }

        const response = {
          success: true,
          riskState: {
            ...riskState,
            frozenAt: riskState.frozenAt?.toISOString() || null,
            unfrozenAt: riskState.unfrozenAt?.toISOString() || null,
            createdAt: riskState.createdAt.toISOString(),
            updatedAt: riskState.updatedAt.toISOString(),
          },
          balances,
        };

        logger.info("User risk details retrieved", {
          adminId: req.user!.id,
          targetUserId: userId,
          isFrozen: riskState.isFrozen,
          requestId: req.requestId,
        });

        res.json(userRiskDetailResponseSchema.parse(response));
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * POST /api/admin/risk/:userId/freeze
   * Manually freeze a user account
   */
  router.post(
    "/:userId/freeze",
    authenticateToken,
    validate(freezeUserRequestSchema, "body"),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const { userId } = req.params;
        const { reason, notes } = req.body as FreezeUserRequest;

        logger.info("Freezing user account", {
          adminId: req.user!.id,
          targetUserId: userId,
          reason,
          requestId: req.requestId,
        });

        const riskState = await userRiskStateStore.freeze(
          userId,
          reason,
          notes,
        );

        const response = {
          success: true,
          riskState: {
            ...riskState,
            frozenAt: riskState.frozenAt?.toISOString() || null,
            unfrozenAt: riskState.unfrozenAt?.toISOString() || null,
            createdAt: riskState.createdAt.toISOString(),
            updatedAt: riskState.updatedAt.toISOString(),
          },
        };

        logger.info("User account frozen", {
          adminId: req.user!.id,
          targetUserId: userId,
          reason,
          requestId: req.requestId,
        });

        // Audit log: admin risk freeze
        auditAdminRiskOperation(req, "ADMIN_RISK_FREEZE", {
          targetUserId: userId,
          reason,
          notes,
        });

        res.json(response);
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * POST /api/admin/risk/:userId/unfreeze
   * Manually unfreeze a user account
   */
  router.post(
    "/:userId/unfreeze",
    authenticateToken,
    validate(unfreezeUserRequestSchema, "body"),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const { userId } = req.params;
        const { notes } = req.body as UnfreezeUserRequest;

        logger.info("Unfreezing user account", {
          adminId: req.user!.id,
          targetUserId: userId,
          requestId: req.requestId,
        });

        const riskState = await userRiskStateStore.unfreeze(userId, notes);

        const response = {
          success: true,
          riskState: {
            ...riskState,
            frozenAt: riskState.frozenAt?.toISOString() || null,
            unfrozenAt: riskState.unfrozenAt?.toISOString() || null,
            createdAt: riskState.createdAt.toISOString(),
            updatedAt: riskState.updatedAt.toISOString(),
          },
        };

        logger.info("User account unfrozen", {
          adminId: req.user!.id,
          targetUserId: userId,
          requestId: req.requestId,
        });

        // Audit log: admin risk unfreeze
        auditAdminRiskOperation(req, "ADMIN_RISK_UNFREEZE", {
          targetUserId: userId,
          notes,
        });

        res.json(response);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
