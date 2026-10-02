/**
 * Admin Routes for Whistleblower Application Review
 *
 * Provides endpoints for:
 * - Listing pending and historical whistleblower applications
 * - Approving/rejecting applications with status transitions
 * - Viewing application details
 */

import { Router, type Request, type Response, type NextFunction } from 'express'
import { validate } from '../middleware/validate.js'
import { logger } from '../utils/logger.js'
import { AppError, notFound } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { env } from '../schemas/env.js'
import { whistleblowerApplicationStore } from '../models/whistleblowerApplicationStore.js'
import {
  WhistleblowerApplicationStatus,
  WhistleblowerApplication,
} from '../models/whistleblowerApplication.js'
import {
  listWhistleblowerApplicationsSchema,
  getWhistleblowerApplicationSchema,
  approveWhistleblowerApplicationSchema,
  rejectWhistleblowerApplicationSchema,
} from '../schemas/whistleblowerApplication.js'

/**
 * Factory function to create admin whistleblower application router
 */
export function createAdminWhistleblowerApplicationsRouter(): Router {
  const router = Router()

  function requireAdminSecret(req: Request): void {
    const headerSecret = req.headers['x-admin-secret']
    if (env.MANUAL_ADMIN_SECRET && headerSecret !== env.MANUAL_ADMIN_SECRET) {
      throw new AppError(ErrorCode.FORBIDDEN, 403, 'Invalid admin secret')
    }
  }

  /**
   * GET /api/admin/whistleblower-applications
   *
   * List whistleblower applications for admin review.
   * Supports filtering by status (pending, approved, rejected).
   * Defaults to showing all applications sorted by newest first.
   */
  router.get(
    '/',
    validate(listWhistleblowerApplicationsSchema, 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        requireAdminSecret(req)

        const filters = req.query as {
          status?: 'pending' | 'approved' | 'rejected'
          page?: string
          pageSize?: string
        }

        logger.info('Admin listing whistleblower applications', {
          status: filters.status,
          requestId: req.requestId,
        })

        const result = await whistleblowerApplicationStore.list({
          status: filters.status as WhistleblowerApplicationStatus | undefined,
          page: filters.page ? parseInt(filters.page, 10) : 1,
          pageSize: filters.pageSize ? parseInt(filters.pageSize, 10) : 20,
        })

        res.json({
          success: true,
          applications: result.applications.map(formatApplicationResponse),
          pagination: {
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
            totalPages: result.totalPages,
          },
        })
      } catch (error) {
        next(error)
      }
    }
  )

  /**
   * GET /api/admin/whistleblower-applications/:applicationId
   *
   * Get detailed information about a specific whistleblower application.
   * Returns 404 if application not found.
   */
  router.get(
    '/:applicationId',
    validate(getWhistleblowerApplicationSchema, 'params'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        requireAdminSecret(req)

        const { applicationId } = req.params

        logger.info('Admin getting whistleblower application details', {
          applicationId,
          requestId: req.requestId,
        })

        const application = await whistleblowerApplicationStore.getById(applicationId)
        if (!application) {
          throw notFound(`Whistleblower application with ID '${applicationId}'`)
        }

        res.json({
          success: true,
          application: formatApplicationResponse(application),
        })
      } catch (error) {
        next(error)
      }
    }
  )

  /**
   * POST /api/admin/whistleblower-applications/:applicationId/approve
   *
   * Approve a pending whistleblower application.
   * Only valid transition: pending -> approved.
   * Returns 409 if application is not in pending status.
   */
  router.post(
    '/:applicationId/approve',
    validate(getWhistleblowerApplicationSchema, 'params'),
    validate(approveWhistleblowerApplicationSchema, 'body'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        requireAdminSecret(req)

        const { applicationId } = req.params
        const { reviewedBy } = req.body as { reviewedBy: string }

        logger.info('Admin approving whistleblower application', {
          applicationId,
          reviewedBy,
          requestId: req.requestId,
        })

        const application = await whistleblowerApplicationStore.getById(applicationId)
        if (!application) {
          throw notFound(`Whistleblower application with ID '${applicationId}'`)
        }

        // Validate status transition
        if (application.status !== WhistleblowerApplicationStatus.PENDING) {
          throw new AppError(
            ErrorCode.CONFLICT,
            409,
            `Application cannot be approved. Current status: ${application.status}`,
            {
              currentStatus: application.status,
              allowedFrom: WhistleblowerApplicationStatus.PENDING,
            }
          )
        }

        const updated = await whistleblowerApplicationStore.updateStatus(
          applicationId,
          WhistleblowerApplicationStatus.APPROVED,
          reviewedBy
        )

        if (!updated) {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            500,
            'Failed to update application status'
          )
        }

        logger.info('Whistleblower application approved', {
          applicationId,
          reviewedBy,
          requestId: req.requestId,
        })

        res.json({
          success: true,
          application: formatApplicationResponse(updated),
          message: 'Application approved successfully',
        })
      } catch (error) {
        next(error)
      }
    }
  )

  /**
   * POST /api/admin/whistleblower-applications/:applicationId/reject
   *
   * Reject a pending whistleblower application with a mandatory reason.
   * Only valid transition: pending -> rejected.
   * Returns 409 if application is not in pending status.
   */
  router.post(
    '/:applicationId/reject',
    validate(getWhistleblowerApplicationSchema, 'params'),
    validate(rejectWhistleblowerApplicationSchema, 'body'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        requireAdminSecret(req)

        const { applicationId } = req.params
        const { reviewedBy, reason } = req.body as { reviewedBy: string; reason: string }

        logger.info('Admin rejecting whistleblower application', {
          applicationId,
          reviewedBy,
          requestId: req.requestId,
        })

        const application = await whistleblowerApplicationStore.getById(applicationId)
        if (!application) {
          throw notFound(`Whistleblower application with ID '${applicationId}'`)
        }

        // Validate status transition
        if (application.status !== WhistleblowerApplicationStatus.PENDING) {
          throw new AppError(
            ErrorCode.CONFLICT,
            409,
            `Application cannot be rejected. Current status: ${application.status}`,
            {
              currentStatus: application.status,
              allowedFrom: WhistleblowerApplicationStatus.PENDING,
            }
          )
        }

        const updated = await whistleblowerApplicationStore.updateStatus(
          applicationId,
          WhistleblowerApplicationStatus.REJECTED,
          reviewedBy,
          reason
        )

        if (!updated) {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            500,
            'Failed to update application status'
          )
        }

        logger.info('Whistleblower application rejected', {
          applicationId,
          reviewedBy,
          reason,
          requestId: req.requestId,
        })

        res.json({
          success: true,
          application: formatApplicationResponse(updated),
          message: 'Application rejected successfully',
        })
      } catch (error) {
        next(error)
      }
    }
  )

  return router
}

/**
 * Formats a WhistleblowerApplication for API response
 * Shaped for the existing verification panel UI
 */
function formatApplicationResponse(application: WhistleblowerApplication) {
  return {
    applicationId: application.applicationId,
    fullName: application.fullName,
    email: application.email,
    phone: application.phone,
    address: application.address,
    linkedinProfile: application.linkedinProfile,
    facebookProfile: application.facebookProfile,
    instagramProfile: application.instagramProfile,
    status: application.status,
    createdAt: application.createdAt.toISOString(),
    updatedAt: application.updatedAt.toISOString(),
    reviewedAt: application.reviewedAt?.toISOString(),
    reviewedBy: application.reviewedBy,
    rejectionReason: application.rejectionReason,
    // Social verification data for the UI
    socialScore: application.socialScore ?? 50,
    greenFlags: application.greenFlags ?? [],
    redFlags: application.redFlags ?? [],
  }
}
