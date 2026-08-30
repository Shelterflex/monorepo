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
const proposeAssignRoleSchema = {
  body: {
    type: "object",
    required: ["subject", "role"],
    properties: {
      subject: { type: "string" },
      role: { type: "number", minimum: 0, maximum: 3 },
    },
  },
};

const confirmAssignRoleSchema = {
  body: {
    type: "object",
    required: ["subject"],
    properties: {
      subject: { type: "string" },
    },
  },
};

const delegatePermissionSchema = {
  body: {
    type: "object",
    required: ["delegatee", "permission"],
    properties: {
      delegatee: { type: "string" },
      permission: { type: "number", minimum: 0 },
    },
  },
};

const getRoleSchema = {
  query: {
    type: "object",
    required: ["address"],
    properties: {
      address: { type: "string" },
    },
  },
};

const hasPermissionSchema = {
  query: {
    type: "object",
    required: ["address", "permission"],
    properties: {
      address: { type: "string" },
      permission: { type: "number", minimum: 0 },
    },
  },
};

export function createAdminContractAccessRouter(adapter: SorobanAdapter) {
  const router = Router();

  // Admin auth guard helper
  function requireAdminSecret(req: Request) {
    const headerSecret = req.headers["x-admin-secret"];
    if (env.MANUAL_ADMIN_SECRET && headerSecret !== env.MANUAL_ADMIN_SECRET) {
      throw new AppError(ErrorCode.FORBIDDEN, 403, "Invalid admin secret");
    }
  }

  /**
   * POST /api/admin/contract-access/propose-assign-role
   * Propose assigning a role to a subject address
   */
  router.post(
    "/propose-assign-role",
    requireAdminSecret,
    validate(proposeAssignRoleSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { subject, role } = req.body;

        if (!adapter.proposeAssignRole) {
          throw new AppError(
            ErrorCode.NOT_IMPLEMENTED,
            501,
            "Contract access role management not available in current adapter"
          );
        }

        const txHash = await adapter.proposeAssignRole(subject, role);

        res.json({
          success: true,
          txHash,
          message: "Role assignment proposed successfully",
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/admin/contract-access/confirm-assign-role
   * Confirm a pending role assignment for a subject
   */
  router.post(
    "/confirm-assign-role",
    requireAdminSecret,
    validate(confirmAssignRoleSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { subject } = req.body;

        if (!adapter.confirmAssignRole) {
          throw new AppError(
            ErrorCode.NOT_IMPLEMENTED,
            501,
            "Contract access role management not available in current adapter"
          );
        }

        const txHash = await adapter.confirmAssignRole(subject);

        res.json({
          success: true,
          txHash,
          message: "Role assignment confirmed successfully",
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/admin/contract-access/delegate-permission
   * Delegate a specific permission to another address
   */
  router.post(
    "/delegate-permission",
    requireAdminSecret,
    validate(delegatePermissionSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { delegatee, permission } = req.body;

        if (!adapter.delegatePermission) {
          throw new AppError(
            ErrorCode.NOT_IMPLEMENTED,
            501,
            "Contract access role management not available in current adapter"
          );
        }

        const txHash = await adapter.delegatePermission(delegatee, permission);

        res.json({
          success: true,
          txHash,
          message: "Permission delegated successfully",
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /api/admin/contract-access/role
   * Get the role assigned to an address
   */
  router.get(
    "/role",
    requireAdminSecret,
    validate(getRoleSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { address } = req.query as { address: string };

        if (!adapter.getRole) {
          throw new AppError(
            ErrorCode.NOT_IMPLEMENTED,
            501,
            "Contract access role management not available in current adapter"
          );
        }

        const role = await adapter.getRole(address);

        res.json({
          success: true,
          address,
          role,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /api/admin/contract-access/permission
   * Check if an address has a specific permission
   */
  router.get(
    "/permission",
    requireAdminSecret,
    validate(hasPermissionSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { address, permission } = req.query as { address: string; permission: string };

        if (!adapter.hasPermission) {
          throw new AppError(
            ErrorCode.NOT_IMPLEMENTED,
            501,
            "Contract access role management not available in current adapter"
          );
        }

        const hasPermission = await adapter.hasPermission(address, Number(permission));

        res.json({
          success: true,
          address,
          permission: Number(permission),
          hasPermission,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /api/admin/contract-access/roles
   * List all addresses with assigned roles
   */
  router.get(
    "/roles",
    requireAdminSecret,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!adapter.listRoles) {
          throw new AppError(
            ErrorCode.NOT_IMPLEMENTED,
            501,
            "Contract access role management not available in current adapter"
          );
        }

        const roles = await adapter.listRoles();

        res.json({
          success: true,
          roles,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
