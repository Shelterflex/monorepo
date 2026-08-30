/**
 * Listing Applications Routes
 * API endpoints for tenant application workflow
 */

import { Router, Request, Response } from "express";
import { applicationService } from "../services/applicationService.js";
import { listingApplicationRepository } from "../repositories/ListingApplicationRepository.js";
import {
  ListingApplicationStatus,
  PaymentPlan,
} from "../models/listingApplication.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/errorCodes.js";
import { idempotency } from "../middleware/idempotency.js";

const router = Router();

/**
 * POST /api/listings/:listingId/apply
 * Tenant submits application for a listing
 */
router.post(
  "/listings/:listingId/apply",
  idempotency(),
  async (req: Request, res: Response, next) => {
    try {
      const { listingId } = req.params;
      const { coverNote, preferredStartDate, paymentPlan } = req.body;

      const tenantId = (req as any).user?.id;
      if (!tenantId) {
        throw new AppError(
          ErrorCode.UNAUTHORIZED,
          401,
          "Must be authenticated as a tenant",
        );
      }

      // Validation
      if (!preferredStartDate) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          400,
          "preferredStartDate is required",
        );
      }

      if (!paymentPlan || !Object.values(PaymentPlan).includes(paymentPlan)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          400,
          "Invalid paymentPlan",
        );
      }

      // Persist the listing owner's real ID so subsequent reviews can enforce
      // ownership against the landlord associated with this specific listing.
      const landlordId =
        await listingApplicationRepository.getListingLandlordId(listingId);
      if (!landlordId) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, "Listing not found");
      }

      const application = await applicationService.apply({
        listingId,
        tenantId,
        landlordId,
        coverNote,
        preferredStartDate: new Date(preferredStartDate),
        paymentPlan,
      });

      res.status(201).json({
        success: true,
        application,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /api/applications/my
 * Tenant views their applications
 */
router.get("/applications/my", async (req: Request, res: Response, next) => {
  try {
    const tenantId = (req as any).user?.id;
    if (!tenantId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, "Must be authenticated");
    }

    const applications =
      await listingApplicationRepository.findByTenantId(tenantId);

    res.json({
      success: true,
      applications,
      total: applications.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/listings/:listingId/applications
 * Landlord views applicants for their listing
 */
router.get(
  "/listings/:listingId/applications",
  async (req: Request, res: Response, next) => {
    try {
      const { listingId } = req.params;
      const landlordId = (req as any).user?.id;

      if (!landlordId) {
        throw new AppError(
          ErrorCode.UNAUTHORIZED,
          401,
          "Must be authenticated as a landlord",
        );
      }

      // Verify landlord owns this listing
      const listingOwner =
        await listingApplicationRepository.getListingLandlordId(listingId);
      if (!listingOwner) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, "Listing not found");
      }

      if (listingOwner !== landlordId) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          403,
          "You can only view applications for your own listings",
        );
      }

      const applications =
        await listingApplicationRepository.findByListingId(listingId);

      res.json({
        success: true,
        applications,
        total: applications.length,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/applications/:id/review
 * Landlord approves or rejects application
 */
router.post(
  "/applications/:id/review",
  async (req: Request, res: Response, next) => {
    try {
      const { id } = req.params;
      const { decision, notes } = req.body;
      const landlordId = (req as any).user?.id;

      if (!landlordId) {
        throw new AppError(
          ErrorCode.UNAUTHORIZED,
          401,
          "Must be authenticated",
        );
      }

      if (!decision || !["approve", "reject"].includes(decision)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          400,
          "decision must be approve or reject",
        );
      }

      const application = await applicationService.reviewApplication(
        id,
        landlordId,
        decision,
        notes,
      );

      res.json({
        success: true,
        application,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * DELETE /api/applications/:id
 * Tenant withdraws application
 */
router.delete(
  "/applications/:id",
  async (req: Request, res: Response, next) => {
    try {
      const { id } = req.params;
      const tenantId = (req as any).user?.id;

      if (!tenantId) {
        throw new AppError(
          ErrorCode.UNAUTHORIZED,
          401,
          "Must be authenticated",
        );
      }

      const application = await applicationService.withdrawApplication(
        id,
        tenantId,
      );

      res.json({
        success: true,
        application,
        message: "Application withdrawn successfully",
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
