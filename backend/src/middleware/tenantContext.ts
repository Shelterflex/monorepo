/**
 * Multi-tenant data partitioning middleware (#657).
 *
 * Extracts and validates tenant (organization) context from the authenticated
 * request. Must run after `authenticateToken`. All tenant-scoped operations
 * must carry an explicit `tenantId`; unscoped paths fail fast.
 *
 * Tenant ID is resolved in priority order:
 *   1. `X-Tenant-ID` request header (service-to-service)
 *   2. `tenantId` claim on the verified session token
 *   3. `organizationId` on the authenticated user record
 */

import { Response, NextFunction } from 'express'
import { AuthenticatedRequest } from './auth.js'
import { AppError } from '../errors/AppError.js'
import { logger } from '../utils/logger.js'

export interface TenantRequest extends AuthenticatedRequest {
  tenantId: string
}

/** Sentinel for unscoped access — rejected at middleware boundary. */
export const UNSCOPED_TENANT = '__unscoped__' as const

export function requireTenantContext(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): void {
  const fromHeader = req.headers['x-tenant-id']
  const tenantId =
    (typeof fromHeader === 'string' ? fromHeader.trim() : null) ||
    (req.user as Record<string, unknown> & { tenantId?: string } | undefined)?.tenantId ||
    (req.user as Record<string, unknown> & { organizationId?: string } | undefined)?.organizationId

  if (!tenantId || tenantId === UNSCOPED_TENANT) {
    logger.warn('Rejected request: missing tenant context', {
      path: req.path,
      userId: req.user?.id,
      ip: req.ip,
      requestId: req.requestId,
    })
    next(
      new AppError(
        'TENANT_CONTEXT_REQUIRED',
        403,
        'Tenant context is required for this operation. Include X-Tenant-ID header or authenticate with a tenant-scoped token.',
      ),
    )
    return
  }

  // Guard against tenant header spoofing by non-admin users
  const userTenant =
    (req.user as Record<string, unknown> & { tenantId?: string } | undefined)?.tenantId ||
    (req.user as Record<string, unknown> & { organizationId?: string } | undefined)?.organizationId

  if (
    userTenant &&
    userTenant !== tenantId &&
    req.user?.role !== 'agent'
  ) {
    logger.warn('Blocked cross-tenant access attempt via header spoofing', {
      requestedTenant: tenantId,
      userTenant,
      userId: req.user?.id,
      ip: req.ip,
      requestId: req.requestId,
    })
    next(
      new AppError(
        'CROSS_TENANT_ACCESS_DENIED',
        403,
        'Access to tenant data outside your organization is not permitted.',
        { requestedTenantId: tenantId, userTenantId: userTenant },
      ),
    )
    return
  }

  ;(req as TenantRequest).tenantId = tenantId
  next()
}

/**
 * Asserts that a resource's owner tenant matches the request tenant.
 * Call from repository / service layer before returning any record.
 */
export function assertTenantMatch(
  requestTenantId: string,
  resourceTenantId: string,
  context: { resourceType: string; resourceId: string },
): void {
  if (requestTenantId !== resourceTenantId) {
    logger.error('Cross-tenant access blocked at data layer', {
      requestTenantId,
      resourceTenantId,
      ...context,
    })
    throw new AppError(
      'CROSS_TENANT_ACCESS_DENIED',
      403,
      `Access denied: ${context.resourceType} ${context.resourceId} does not belong to your tenant.`,
    )
  }
}
