import type { Request, Response, NextFunction } from 'express'
import { env } from '../schemas/env.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

/**
 * Shared-secret guard for legacy admin routes that authenticate via the
 * `x-admin-secret` header instead of session/role-based auth.
 *
 * Fails CLOSED: if `MANUAL_ADMIN_SECRET` isn't configured, every request is
 * rejected. Do not weaken this to "only check when configured" — that was
 * the fail-open bug this module exists to prevent (see issue #1608).
 */
function isAdminSecretValid(req: Request): boolean {
  const headerSecret = req.headers['x-admin-secret']
  return Boolean(env.MANUAL_ADMIN_SECRET) && headerSecret === env.MANUAL_ADMIN_SECRET
}

/**
 * Throws if the request doesn't carry a valid `x-admin-secret` header.
 * Use this form inside handlers that already run in a try/catch and call
 * `next(error)` themselves.
 */
export function assertAdminSecret(req: Request): void {
  if (!isAdminSecretValid(req)) {
    throw new AppError(ErrorCode.FORBIDDEN, 403, 'Invalid admin secret')
  }
}

/**
 * Express middleware form of the same check, for routes that mount it
 * directly in the router chain (e.g. `router.get('/x', requireAdminSecret, handler)`).
 */
export function requireAdminSecret(req: Request, _res: Response, next: NextFunction): void {
  try {
    assertAdminSecret(req)
    next()
  } catch (error) {
    next(error)
  }
}
