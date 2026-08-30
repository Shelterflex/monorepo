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
import { env } from "../schemas/env.js";

// Schema definitions for validation
const proposeUpgradeSchema = {
  body: {
    type: "object",
    required: ["newWasmHash"],
    properties: {
      newWasmHash: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
    },
  },
};

const confirmUpgradeSchema = {
  body: {
    type: "object",
    required: ["newWasmHash"],
    properties: {
      newWasmHash: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
    },
  },
};

const transferAdminSchema = {
  body: {
    type: "object",
    required: ["newAdminAddress"],
    properties: {
      newAdminAddress: { type: "string" },
    },
  },
};

export function createAdminUpgradeableProxyRouter(adapter: SorobanAdapter) {
  const router = Router();

  // Admin auth guard helper
  function requireAdminSecret(req: Request) {
    const headerSecret = req.headers["x-admin-secret"];
    if (env.MANUAL_ADMIN_SECRET && headerSecret !== env.MANUAL_ADMIN_SECRET) {
      throw new AppError(ErrorCode.FORBIDDEN, 403, "Invalid admin secret");
    }
  }

  /**
   * POST /api/admin/upgradeable-proxy/propose-upgrade
   * Propose a contract upgrade with a new WASM hash
   */
  router.post(
    "/propose-upgrade",
    requireAdminSecret,
    validate(proposeUpgradeSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { newWasmHash } = req.body;

        if (!adapter.proposeUpgrade) {
          throw new AppError(
            ErrorCode.NOT_IMPLEMENTED,
            501,
            "Upgradeable proxy governance not available in current adapter"
          );
        }

        const txHash = await adapter.proposeUpgrade(newWasmHash);

        res.json({
          success: true,
          txHash,
          message: "Upgrade proposed successfully",
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/admin/upgradeable-proxy/confirm-upgrade
   * Confirm and execute a pending upgrade
   */
  router.post(
    "/confirm-upgrade",
    requireAdminSecret,
    validate(confirmUpgradeSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { newWasmHash } = req.body;

        if (!adapter.confirmUpgrade) {
          throw new AppError(
            ErrorCode.NOT_IMPLEMENTED,
            501,
            "Upgradeable proxy governance not available in current adapter"
          );
        }

        const txHash = await adapter.confirmUpgrade(newWasmHash);

        res.json({
          success: true,
          txHash,
          message: "Upgrade confirmed and executed successfully",
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/admin/upgradeable-proxy/cancel-upgrade
   * Cancel a pending upgrade proposal
   */
  router.post(
    "/cancel-upgrade",
    requireAdminSecret,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!adapter.cancelUpgrade) {
          throw new AppError(
            ErrorCode.NOT_IMPLEMENTED,
            501,
            "Upgradeable proxy governance not available in current adapter"
          );
        }

        const txHash = await adapter.cancelUpgrade();

        res.json({
          success: true,
          txHash,
          message: "Upgrade cancelled successfully",
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/admin/upgradeable-proxy/transfer-admin
   * Transfer admin rights to a new address
   */
  router.post(
    "/transfer-admin",
    requireAdminSecret,
    validate(transferAdminSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { newAdminAddress } = req.body;

        if (!adapter.transferAdmin) {
          throw new AppError(
            ErrorCode.NOT_IMPLEMENTED,
            501,
            "Upgradeable proxy governance not available in current adapter"
          );
        }

        const txHash = await adapter.transferAdmin(newAdminAddress);

        res.json({
          success: true,
          txHash,
          message: "Admin transferred successfully",
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /api/admin/upgradeable-proxy/pending-upgrade
   * Check if there is a pending upgrade
   */
  router.get(
    "/pending-upgrade",
    requireAdminSecret,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!adapter.hasPendingUpgrade) {
          throw new AppError(
            ErrorCode.NOT_IMPLEMENTED,
            501,
            "Upgradeable proxy governance not available in current adapter"
          );
        }

        const hasPending = await adapter.hasPendingUpgrade();

        res.json({
          success: true,
          hasPendingUpgrade: hasPending,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
