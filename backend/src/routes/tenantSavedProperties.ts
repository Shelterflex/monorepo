/**
 * Tenant saved property routes
 */

import { Router, Request, Response } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { savedPropertyStore } from "../models/savedPropertyStore.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/errorCodes.js";

const router = Router();

function getUserId(req: Request): string {
  const userId = (req as Request & { user?: { userId: string } }).user?.userId;
  if (!userId) {
    throw new AppError(
      ErrorCode.UNAUTHORIZED,
      401,
      "User not authenticated",
    );
  }
  return userId;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * GET /api/tenant/saved-properties
 * List saved listing IDs for the authenticated tenant with pagination.
 */
router.get("/", authenticateToken, async (req: Request, res: Response, next) => {
  try {
    const userId = getUserId(req);

    const rawLimit = req.query.limit ?? req.query.pageSize;
    const limitNum = rawLimit !== undefined ? parseInt(String(rawLimit), 10) : DEFAULT_LIMIT;
    const limit = Math.min(MAX_LIMIT, Math.max(1, isNaN(limitNum) ? DEFAULT_LIMIT : limitNum));

    let offset = 0;
    if (req.query.offset !== undefined) {
      const offsetNum = parseInt(String(req.query.offset), 10);
      offset = Math.max(0, isNaN(offsetNum) ? 0 : offsetNum);
    } else if (req.query.page !== undefined) {
      const pageNum = parseInt(String(req.query.page), 10);
      const page = Math.max(1, isNaN(pageNum) ? 1 : pageNum);
      offset = (page - 1) * limit;
    }

    const total = await savedPropertyStore.count(userId);
    const listingIds = await savedPropertyStore.listListingIds(userId, { limit, offset });

    res.json({
      success: true,
      data: listingIds,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + listingIds.length < total,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/tenant/saved-properties/:listingId
 * Save a listing (idempotent).
 */
router.post(
  "/:listingId",
  authenticateToken,
  async (req: Request, res: Response, next) => {
    try {
      const userId = getUserId(req);
      const { listingId } = req.params;
      const record = await savedPropertyStore.save(userId, listingId);
      res.status(201).json({
        success: true,
        data: { listingId: record.listingId, saved: true },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * DELETE /api/tenant/saved-properties/:listingId
 * Remove a saved listing.
 */
router.delete(
  "/:listingId",
  authenticateToken,
  async (req: Request, res: Response, next) => {
    try {
      const userId = getUserId(req);
      const { listingId } = req.params;
      await savedPropertyStore.remove(userId, listingId);
      res.json({
        success: true,
        data: { listingId, saved: false },
      });
    } catch (error) {
      next(error);
    }
  },
);

export function createTenantSavedPropertiesRouter(): Router {
  return router;
}
