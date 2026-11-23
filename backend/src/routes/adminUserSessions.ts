/**
 * Admin user session management routes
 * Allows admins to list and revoke all sessions for a user
 */

import { Router, type Request, type Response, type NextFunction } from 'express'
import { sessionStore, userStore } from '../models/authStore.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { validate } from '../middleware/validate.js'
import { z } from 'zod'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'
import { auditAuthSessionRevoked } from '../utils/auditLogger.js'

const router = Router()

// ── Schemas ───────────────────────────────────────────────────────────────

const userIdParamSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
})

const sessionIdParamSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  sessionId: z.string().uuid('Invalid session ID'),
})

// ── Helpers ───────────────────────────────────────────────────────────────

function isAdmin(req: Request): boolean {
  const role = (req as AuthenticatedRequest).user?.role
  return role === 'admin' || role === 'super_admin'
}

async function getUserById(userId: string) {
  const user = await userStore.getById(userId)
  if (!user) {
    throw new AppError(ErrorCode.NOT_FOUND, 404, `User with ID ${userId} not found`)
  }
  return user
}

// ── Routes ───────────────────────────────────────────────────────────────

/**
 * GET /api/admin/users/:userId/sessions
 * List active sessions for a user (admin only)
 */
router.get(
  '/:userId/sessions',
  authenticateToken,
  validate(userIdParamSchema, 'params'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!isAdmin(req)) {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'Admin access required')
      }

      const { userId } = req.params
      const user = await getUserById(userId)

      const sessions = await sessionStore.listActiveSessions(userId, user.email)

      res.json({
        success: true,
        data: { sessions },
      })
    } catch (error) {
      next(error)
    }
  }
)

/**
 * DELETE /api/admin/users/:userId/sessions
 * Revoke all sessions for a user (admin only)
 */
router.delete(
  '/:userId/sessions',
  authenticateToken,
  validate(userIdParamSchema, 'params'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!isAdmin(req)) {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'Admin access required')
      }

      const { userId } = req.params
      const callerId = (req as AuthenticatedRequest).user?.id

      // Prevent admins from revoking their own sessions through this endpoint
      if (userId === callerId) {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'Cannot revoke your own sessions through this endpoint')
      }

      const user = await getUserById(userId)

      const revoked = await sessionStore.revokeAllSessions(userId, user.email)

      auditAuthSessionRevoked(req, {
        userId,
        email: user.email,
        revoked,
        reason: 'admin_force_logout',
      })

      res.json({
        success: true,
        data: { revoked },
      })
    } catch (error) {
      next(error)
    }
  }
)

/**
 * DELETE /api/admin/users/:userId/sessions/:sessionId
 * Revoke a specific session for a user (admin only)
 */
router.delete(
  '/:userId/sessions/:sessionId',
  authenticateToken,
  validate(sessionIdParamSchema, 'params'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!isAdmin(req)) {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'Admin access required')
      }

      const { userId, sessionId } = req.params
      const callerId = (req as AuthenticatedRequest).user?.id

      // Prevent admins from revoking their own sessions through this endpoint
      if (userId === callerId) {
        throw new AppError(ErrorCode.FORBIDDEN, 403, 'Cannot revoke your own sessions through this endpoint')
      }

      const user = await getUserById(userId)

      const success = await sessionStore.revokeSession(userId, user.email, sessionId)

      if (!success) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Session not found')
      }

      auditAuthSessionRevoked(req, {
        userId,
        email: user.email,
        sessionId,
        reason: 'admin_force_logout',
      })

      res.json({
        success: true,
        data: { revoked: true },
      })
    } catch (error) {
      next(error)
    }
  }
)

export function createAdminUserSessionsRouter(): Router {
  return router
}
