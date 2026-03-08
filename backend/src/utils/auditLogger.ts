/**
 * Structured Audit Logger for Sensitive Custodial Wallet Operations
 *
 * This module provides structured JSON logging for security-sensitive events.
 * All audit logs are output as structured JSON for easy searching and filtering.
 *
 * Security Notes:
 * - NEVER include secrets, keys, or sensitive values in any log entry
 * - metadata must only contain a safe subset of context
 * - Excluded by design, not by accident
 *
 * Audit Log Format:
 * {
 *   eventType: string,    // e.g., "WALLET_CREATED", "WALLET_SIGNING_USED"
 *   userId: string,       // User identifier
 *   requestId: string,    // Request correlation ID
 *   ip: string,           // Client IP address
 *   actorType: string,    // "user" | "admin" | "system"
 *   timestamp: string,    // ISO 8601 timestamp
 *   metadata: object      // Safe context (no secrets)
 * }
 */

import type { Request } from 'express'

/**
 * Valid audit event types for custodial wallet operations
 */
export type AuditEventType =
  | 'WALLET_CREATED'
  | 'WALLET_SIGNING_USED'
  | 'WALLET_EXPORT_ATTEMPT'
  | 'ADMIN_WALLET_ACTION'

/**
 * Valid actor types
 */
export type ActorType = 'user' | 'admin' | 'system'

/**
 * Audit log entry structure
 */
export interface AuditLogEntry {
  /** Event type identifier */
  eventType: AuditEventType
  /** User identifier */
  userId: string
  /** Request correlation ID */
  requestId: string
  /** Client IP address */
  ip: string
  /** Type of actor performing the action */
  actorType: ActorType
  /** ISO 8601 timestamp */
  timestamp: string
  /** Safe metadata - never contains secrets */
  metadata: Record<string, unknown>
}

/**
 * Context required for audit logging
 */
export interface AuditContext {
  /** User identifier */
  userId: string
  /** Request correlation ID */
  requestId: string
  /** Client IP address */
  ip: string
  /** Type of actor */
  actorType: ActorType
}

/**
 * Extract audit context from Express request
 *
 * @param req - Express request object
 * @param actorType - Type of actor (user, admin, system)
 * @returns AuditContext with userId, requestId, ip, actorType
 */
export function extractAuditContext(
  req: Request,
  actorType: ActorType
): AuditContext {
  // Get userId from request - supports various auth patterns
  const userId = extractUserId(req)

  // Get requestId from request (set by requestIdMiddleware)
  const requestId = req.requestId || 'unknown'

  // Get IP address - handle proxies
  const ip = extractIp(req)

  return {
    userId,
    requestId,
    ip,
    actorType,
  }
}

/**
 * Extract user ID from request
 * Supports: req.user.id, req.userId, headers
 */
function extractUserId(req: Request): string {
  // Try common patterns for user ID
  const user = (req as any).user
  if (user && typeof user === 'object') {
    if (user.id) return String(user.id)
    if (user.userId) return String(user.userId)
    if (user.sub) return String(user.sub)
  }

  // Try direct property
  if ((req as any).userId) {
    return String((req as any).userId)
  }

  // Try header (for service-to-service calls)
  const headerUserId = req.headers['x-user-id']
  if (headerUserId && typeof headerUserId === 'string') {
    return headerUserId
  }

  // Fallback to anonymous
  return 'anonymous'
}

/**
 * Extract client IP from request
 * Handles proxies and various header formats
 */
function extractIp(req: Request): string {
  // Check for forwarded IP (behind proxy)
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded) {
    // Get first IP in the chain
    return forwarded.split(',')[0].trim()
  }

  // Check other proxy headers
  const realIp = req.headers['x-real-ip']
  if (typeof realIp === 'string' && realIp) {
    return realIp
  }

  // Fall back to connection remote address
  return req.socket?.remoteAddress || req.ip || 'unknown'
}

/**
 * Sanitize metadata to ensure no secrets are logged
 *
 * @param metadata - Raw metadata object
 * @returns Sanitized metadata with secrets removed
 */
function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}

  // Keys that should never be logged
  const SENSITIVE_KEYS = new Set([
    'password',
    'secret',
    'token',
    'authorization',
    'apiKey',
    'api_key',
    'privateKey',
    'private_key',
    'accessToken',
    'access_token',
    'secretKey',
    'secret_key',
    'masterKey',
    'master_key',
    'encryptedSecretKey',
    'envelope',
    'cipherText',
    'ciphertext',
    'authTag',
    'iv',
    'key',
    'signature',
    'seed',
    'mnemonic',
    'passphrase',
  ])

  for (const [key, value] of Object.entries(metadata)) {
    // Skip sensitive keys
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]'
      continue
    }

    // Skip keys containing sensitive substrings
    const lowerKey = key.toLowerCase()
    if (
      lowerKey.includes('secret') ||
      lowerKey.includes('password') ||
      lowerKey.includes('token') ||
      lowerKey.includes('key') ||
      lowerKey.includes('private') ||
      lowerKey.includes('credential')
    ) {
      sanitized[key] = '[REDACTED]'
      continue
    }

    // Recursively sanitize nested objects
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeMetadata(value as Record<string, unknown>)
    } else {
      sanitized[key] = value
    }
  }

  return sanitized
}

/**
 * Write an audit log entry
 *
 * @param eventType - Type of audit event
 * @param context - Audit context (userId, requestId, ip, actorType)
 * @param metadata - Safe metadata (will be sanitized)
 */
export function auditLog(
  eventType: AuditEventType,
  context: AuditContext,
  metadata: Record<string, unknown> = {}
): void {
  const entry: AuditLogEntry = {
    eventType,
    userId: context.userId,
    requestId: context.requestId,
    ip: context.ip,
    actorType: context.actorType,
    timestamp: new Date().toISOString(),
    metadata: sanitizeMetadata(metadata),
  }

  // Output structured JSON to stdout
  process.stdout.write(JSON.stringify(entry) + '\n')
}

/**
 * Convenience function for logging wallet creation events
 */
export function auditWalletCreated(
  req: Request,
  metadata: { walletId?: string; publicAddress?: string } = {}
): void {
  const context = extractAuditContext(req, 'user')
  auditLog('WALLET_CREATED', context, metadata)
}

/**
 * Convenience function for logging wallet signing usage
 */
export function auditWalletSigningUsed(
  req: Request,
  metadata: { dealId?: string; txType?: string; txId?: string } = {}
): void {
  const context = extractAuditContext(req, 'user')
  auditLog('WALLET_SIGNING_USED', context, metadata)
}

/**
 * Convenience function for logging wallet export attempts
 */
export function auditWalletExportAttempt(
  req: Request,
  metadata: { walletId?: string; reason?: string } = {}
): void {
  const context = extractAuditContext(req, 'user')
  auditLog('WALLET_EXPORT_ATTEMPT', context, metadata)
}

/**
 * Convenience function for logging admin wallet actions
 */
export function auditAdminWalletAction(
  req: Request,
  metadata: { action?: string; walletId?: string; details?: Record<string, unknown> } = {}
): void {
  const context = extractAuditContext(req, 'admin')
  auditLog('ADMIN_WALLET_ACTION', context, metadata)
}
