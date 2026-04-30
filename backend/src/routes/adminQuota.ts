import { Router, Response } from 'express'
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js'
import { quotaManager } from '../services/QuotaManager.js'
import { burstRateLimiter } from '../services/BurstRateLimiter.js'
import { validate } from '../middleware/validate.js'
import { z } from 'zod'
import { logger } from '../utils/logger.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

const router = Router()

// Schemas for validation
const createOverrideSchema = z.object({
  userId: z.string().min(1),
  endpoint: z.string().optional(),
  elevatedLimit: z.number().min(1).max(10000),
  reason: z.string().min(1).max(500),
  expiresAt: z.number().optional(),
})

const removeOverrideSchema = z.object({
  userId: z.string().min(1),
  endpoint: z.string().optional(),
})

/**
 * Helper function to check admin access
 * Since the User type doesn't include 'admin' role, we'll use a simple check
 * In production, this should be replaced with proper role-based access control
 */
function isAdmin(user: any): boolean {
  // For now, we'll check if the user has an admin flag or specific permission
  // This is a placeholder - implement proper RBAC
  return user?.isAdmin === true || user?.role === 'admin'
}

/**
 * Get quota usage for a user
 * GET /api/admin/quota/usage/:userId
 */
router.get(
  '/usage/:userId',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      // Admin-only check
      if (!isAdmin(req.user)) {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'Admin access required')
      }

      const { userId } = req.params
      const endpoint = req.query.endpoint as string | undefined

      const usage = await quotaManager.getQuotaUsage(userId, endpoint || 'all')
      res.json(usage)
    } catch (error) {
      next(error)
    }
  }
)

/**
 * Get all quota overrides for a user
 * GET /api/admin/quota/overrides/:userId
 */
router.get(
  '/overrides/:userId',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      // Admin-only check
      if (!isAdmin(req.user)) {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'Admin access required')
      }

      const { userId } = req.params
      const overrides = await quotaManager.getUserOverrides(userId)
      res.json({ overrides })
    } catch (error) {
      next(error)
    }
  }
)

/**
 * Create a quota override (admin function)
 * POST /api/admin/quota/override
 */
router.post(
  '/override',
  authenticateToken,
  validate(createOverrideSchema, 'body'),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      // Admin-only check
      if (!isAdmin(req.user)) {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'Admin access required')
      }

      const { userId, endpoint, elevatedLimit, reason, expiresAt } = req.body

      const override = await quotaManager.setOverride({
        userId,
        endpoint,
        elevatedLimit,
        reason,
        createdBy: req.user!.id,
        createdAt: Date.now(),
        expiresAt,
      })

      // Log admin action for audit
      logger.warn('Admin created quota override', {
        adminId: req.user!.id,
        userId,
        endpoint,
        elevatedLimit,
        reason,
        expiresAt,
      })

      res.status(201).json({ success: true, override })
    } catch (error) {
      next(error)
    }
  }
)

/**
 * Remove a quota override (admin function)
 * DELETE /api/admin/quota/override
 */
router.delete(
  '/override',
  authenticateToken,
  validate(removeOverrideSchema, 'body'),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      // Admin-only check
      if (!isAdmin(req.user)) {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'Admin access required')
      }

      const { userId, endpoint } = req.body

      await quotaManager.removeOverride(userId, endpoint)

      // Log admin action for audit
      logger.info('Admin removed quota override', {
        adminId: req.user!.id,
        userId,
        endpoint,
      })

      res.json({ success: true })
    } catch (error) {
      next(error)
    }
  }
)

/**
 * Get quota statistics
 * GET /api/admin/quota/stats
 */
router.get(
  '/stats',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      // Admin-only check
      if (!isAdmin(req.user)) {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'Admin access required')
      }

      const stats = await quotaManager.getQuotaStats()
      res.json(stats)
    } catch (error) {
      next(error)
    }
  }
)

/**
 * Reset quota for a user (admin function)
 * POST /api/admin/quota/reset
 */
router.post(
  '/reset',
  authenticateToken,
  validate(z.object({ userId: z.string().min(1), endpoint: z.string().optional() }), 'body'),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      // Admin-only check
      if (!isAdmin(req.user)) {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'Admin access required')
      }

      const { userId, endpoint } = req.body
      const key = `ratelimit:user:${userId}${endpoint ? `:${endpoint}` : ''}`

      await burstRateLimiter.resetQuota(key)

      // Log admin action for audit
      logger.warn('Admin reset user quota', {
        adminId: req.user!.id,
        userId,
        endpoint,
      })

      res.json({ success: true })
    } catch (error) {
      next(error)
    }
  }
)

export function createAdminQuotaRouter(): Router {
  return router
}
