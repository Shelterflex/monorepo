import { Response, NextFunction } from 'express'
import { AuthenticatedRequest } from './auth.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { logger } from '../utils/logger.js'
import { auditLog, extractAuditContext } from '../utils/auditLogger.js'

/**
 * Extends AuthenticatedRequest with a resolved scopedUserId that all
 * repository queries must filter by.  Admin requests that explicitly
 * target a different user via :userId param or ?userId= query have the
 * cross-user access attempt recorded in the audit log.
 */
export interface ScopedRequest extends AuthenticatedRequest {
  /** The user ID that database queries must be scoped to. */
  scopedUserId: string
}

/**
 * Derives the target user ID from the request.
 *
 * Resolution order:
 *  1. Route param  :userId
 *  2. Query param  ?userId=
 *  3. Authenticated user's own ID
 */
function resolveTargetUserId(req: AuthenticatedRequest): string {
  const paramId = req.params['userId'] as string | undefined
  const queryId = req.query['userId'] as string | undefined
  return paramId ?? queryId ?? req.user!.id
}

/**
 * Middleware that attaches `req.scopedUserId` to every authenticated request.
 *
 * - Regular users are always scoped to their own ID; attempting to pass a
 *   different user ID returns 403 Forbidden.
 * - Admin/agent users may target any user ID; cross-user access is recorded
 *   in the audit log.
 *
 * Must be applied **after** `authenticateToken`.
 */
export function userScope(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new AppError(ErrorCode.UNAUTHORIZED, 401, 'Authentication required'))
    return
  }

  const actorId = req.user.id
  const actorRole = req.user.role
  const targetId = resolveTargetUserId(req)

  const isCrossUser = targetId !== actorId
  const isPrivileged = actorRole === 'agent' // agents are the admin-equivalent role

  if (isCrossUser && !isPrivileged) {
    logger.warn('Data isolation violation attempt blocked', {
      actorId,
      targetId,
      path: req.path,
      requestId: req.requestId,
    })
    next(new AppError(ErrorCode.FORBIDDEN, 403, 'Access to this resource is not allowed'))
    return
  }

  if (isCrossUser && isPrivileged) {
    const auditCtx = extractAuditContext(req, 'admin')
    auditLog('ADMIN_WALLET_ACTION', auditCtx, {
      action: 'CROSS_USER_DATA_ACCESS',
      actorId,
      targetUserId: targetId,
      path: req.path,
      method: req.method,
    })

    logger.info('Admin cross-user access', {
      actorId,
      targetId,
      path: req.path,
      requestId: req.requestId,
    })
  }

  ;(req as ScopedRequest).scopedUserId = targetId
  next()
}
