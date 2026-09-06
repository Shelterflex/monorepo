/**
 * Structured Audit Logger for Sensitive Operations
 *
 * Writes structured JSON to stdout AND (when a database is configured)
 * persists each entry to the audit_log table with a cryptographic hash chain
 * that makes retroactive tampering detectable.
 *
 * Security Notes:
 * - NEVER include secrets, keys, or sensitive values in any log entry
 * - metadata must only contain a safe subset of context
 * - Excluded by design, not by accident
 */

import type { Request } from 'express'
import { getPool } from '../db.js'
import { logger } from './logger.js'
import { redactPiiFields } from './piiRedaction.js'

/**
 * All audit event types across the system.
 * Grouped by domain for readability.
 */
export type AuditEventType =
  | "WALLET_CREATED"
  | "WALLET_SIGNING_USED"
  | "WALLET_EXPORT_ATTEMPT"
  | "ADMIN_WALLET_ACTION"
  | "ADMIN_CONTRACT_PAUSE"
  | "ADMIN_CONTRACT_UNPAUSE"
  | "ADMIN_CONTRACT_UPGRADE"
  | "ADMIN_SET_OPERATOR"
  | "ADMIN_OUTBOX_RETRY"
  | "ADMIN_OUTBOX_MARK_DEAD"
  | "ADMIN_REWARD_MARK_PAID"
  | "ADMIN_LISTING_APPROVE"
  | "ADMIN_LISTING_REJECT"
  | "ADMIN_RISK_FREEZE"
  | "ADMIN_RISK_UNFREEZE"
  | "ADMIN_CIRCUIT_BREAKER_FREEZE"
  | "ADMIN_CIRCUIT_BREAKER_PROPOSE_DRAIN"
  | "ADMIN_CIRCUIT_BREAKER_EXECUTE_DRAIN"
  | "ADMIN_CIRCUIT_BREAKER_SET_RECOVERY_DELAY"
  | "WEBHOOK_REPLAY_INITIATED"
  | "WEBHOOK_REPLAY_COMPLETED"
  | "WEBHOOK_REPLAY_FAILED"
  // Authentication
  | "AUTH_OTP_REQUESTED"
  | "AUTH_LOGIN_SUCCESS"
  | "AUTH_LOGIN_FAILED"
  | "AUTH_LOGOUT"
  | "AUTH_LOGOUT_ALL"
  | "AUTH_WALLET_CHALLENGE_ISSUED"
  | "AUTH_WALLET_LOGIN_SUCCESS"
  | "AUTH_WALLET_LOGIN_FAILED"
  // Wallet
  | "WALLET_CREATED"
  | "WALLET_SIGNING_USED"
  | "WALLET_EXPORT_ATTEMPT"
  | "ADMIN_WALLET_ACTION"
  // Deals
  | 'DEAL_CREATED'
  | 'DEAL_UPDATED'
  | 'DEAL_STATUS_CHANGED'
  // Listings
  | 'LISTING_CREATED'
  | 'LISTING_APPROVED'
  | 'LISTING_REJECTED'
  // Deposits & Payments
  | 'NGN_DEPOSIT_INITIATED'
  | 'NGN_WITHDRAWAL_INITIATED'
  | 'PAYMENT_INITIATED'
  // Staking
  | 'STAKING_INITIATED'
  // Rewards
  | 'REWARD_MARKED_PAID'
  // Admin operations
  | 'ADMIN_OUTBOX_MARK_DEAD'
  | 'ADMIN_OUTBOX_RETRY'
  | 'ADMIN_INDEXER_PAUSE'
  | 'ADMIN_INDEXER_RESUME'
  | 'ADMIN_SECRET_ROTATED'
  // Risk
  | 'RISK_ACCOUNT_FROZEN'
  | 'RISK_TIER_CHANGED'
  | 'ADMIN_RISK_FREEZE'
  | 'ADMIN_RISK_UNFREEZE'
  // KYC
  | 'KYC_SUBMITTED'
  | 'KYC_APPROVED'
  | 'KYC_REJECTED'
  // Disputes
  | 'DISPUTE_CREATED'
  | 'DISPUTE_RESOLVED'
  // Inspector jobs
  | 'INSPECTOR_JOB_CREATED'
  | 'INSPECTOR_JOB_CLAIMED'
  | 'INSPECTOR_REPORT_SUBMITTED'
  | 'INSPECTOR_REPORT_APPROVED'
  | 'INSPECTOR_REPORT_REJECTED'
  // Rent guarantee insurance
  | 'INSURANCE_QUOTE_REQUESTED'
  | 'INSURANCE_POLICY_PURCHASED'
  | 'INSURANCE_CLAIM_FILED'
  // Tenant document vault
  | 'DOCUMENT_UPLOAD_URL_ISSUED'
  | 'DOCUMENT_DOWNLOAD_URL_ISSUED'
  | 'DOCUMENT_UPLOAD_CONFIRMED'
  | 'DOCUMENT_PREVIEWED'
  | 'DOCUMENT_UPLOADED'
  | 'DOCUMENT_UPDATED'
  | 'DOCUMENT_DELETED'
  | 'DOCUMENT_LISTED'
  | 'DOCUMENT_VIEWED'
  // Tenant rating card
  | 'TENANT_RATING_SUBMITTED'
  | 'TENANT_RATING_SHARE_TOKEN_GENERATED'
  // Tenant referral programme
  | 'REFERRAL_VIEWED'
  | 'REFERRAL_APPLIED'
  | 'ADMIN_REFERRALS_VIEWED'
  // Data privacy / erasure
  | 'USER_ERASURE_REQUESTED'
  | 'USER_ERASURE_COMPLETED'
  // Credit bureau
  | 'CREDIT_REPORT_PULLED'
  | 'CREDIT_REPORT_VIEWED'
  // Rental agreements / e-signature
  | 'AGREEMENT_GENERATED'
  | 'AGREEMENT_SIGNATURE_REQUESTED'
  | 'AGREEMENT_SIGNED'
  | 'AGREEMENT_FULLY_EXECUTED'
  // Landlord verification
  | 'LANDLORD_VERIFICATION_UPDATED'
  // State-changing operations (auto-generated)
  | 'STATE_CHANGED'
  | 'STATE_DELETED'
  // Admin operations (auto-generated)
  | 'ADMIN_OPERATION'

/**
 * Valid actor types
 */
export type ActorType = "user" | "admin" | "system";

/**
 * Audit log entry structure (in-memory / stdout representation)
 */
export interface AuditLogEntry {
  eventType: AuditEventType
  userId: string
  requestId: string
  ip: string
  actorType: ActorType
  timestamp: string
  metadata: Record<string, unknown>
  httpMethod?: string
  httpPath?: string
}

/**
 * Context required for audit logging
 */
export interface AuditContext {
  userId: string
  requestId: string
  ip: string
  actorType: ActorType
  httpMethod?: string
  httpPath?: string
}

/**
 * Extract audit context from Express request
 */
export function extractAuditContext(req: Request, actorType: ActorType): AuditContext {
  return {
    userId: extractUserId(req),
    requestId: req.requestId || 'unknown',
    ip: extractIp(req),
    actorType,
    httpMethod: req.method,
    httpPath: req.path,
  }
}

function extractUserId(req: Request): string {
  const user = (req as any).user
  if (user && typeof user === 'object') {
    if (user.id) return String(user.id)
    if (user.userId) return String(user.userId)
    if (user.sub) return String(user.sub)
  }
  if ((req as any).userId) return String((req as any).userId)
  const headerUserId = req.headers['x-user-id']
  if (typeof headerUserId === 'string' && headerUserId) return headerUserId
  return 'anonymous'
}

function extractIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded) {
    return forwarded.split(',')[0].trim()
  }
  const realIp = req.headers['x-real-ip']
  if (typeof realIp === 'string' && realIp) return realIp
  return req.socket?.remoteAddress || req.ip || 'unknown'
}

/**
 * Sanitize metadata — strips any key whose name suggests it contains a secret.
 */
function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return redactPiiFields(metadata) as Record<string, unknown>
}

/**
 * Persist audit entry to the database (best-effort, non-blocking).
 * Failures are logged as warnings and never propagate to callers.
 */
async function persistToDatabase(
  eventType: AuditEventType,
  context: AuditContext,
  metadata: Record<string, unknown>,
  timestamp: string,
  required = false,
): Promise<void> {
  try {
    const pool = await getPool()
    if (!pool) {
      if (required) throw new Error('Audit database is not configured')
      return
    }

    // Lazy import to avoid circular dependency at module load time
    const { auditRepository } = await import('../repositories/AuditRepository.js')

    await auditRepository.append({
      eventType,
      actorType: context.actorType,
      userId: context.userId !== 'anonymous' ? context.userId : null,
      requestId: context.requestId !== 'unknown' ? context.requestId : null,
      ipAddress: context.ip !== 'unknown' ? context.ip : null,
      httpMethod: context.httpMethod ?? null,
      httpPath: context.httpPath ?? null,
      metadata,
      createdAt: new Date(timestamp),
    })
  } catch (err) {
    logger.warn('Failed to persist audit entry to database', {
      eventType,
      error: err instanceof Error ? err.message : String(err),
    })
    if (required) throw err
  }
}

export interface AuditLogOptions {
  /** Wait for the append-only database write and propagate persistence failures. */
  durable?: boolean
}

/**
 * Write an audit log entry to stdout and (asynchronously) to the database.
 */
export function auditLog(
  eventType: AuditEventType,
  context: AuditContext,
  metadata: Record<string, unknown> = {},
  options: AuditLogOptions = {},
): void | Promise<void> {
  const safeMetadata = sanitizeMetadata(metadata)
  const timestamp = new Date().toISOString()

  const entry: AuditLogEntry = {
    eventType,
    userId: context.userId,
    requestId: context.requestId,
    ip: context.ip,
    actorType: context.actorType,
    timestamp,
    metadata: safeMetadata,
    httpMethod: context.httpMethod,
    httpPath: context.httpPath,
  }

  // Synchronous stdout write — always happens
  process.stdout.write(JSON.stringify(entry) + '\n')

  // Async DB persistence — failures are swallowed after logging a warning
  if (options.durable) {
    return persistToDatabase(eventType, context, safeMetadata, timestamp, true)
  }

  void persistToDatabase(eventType, context, safeMetadata, timestamp)
}

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

export function auditWalletCreated(
  req: Request,
  metadata: { walletId?: string; publicAddress?: string } = {},
): void {
  auditLog('WALLET_CREATED', extractAuditContext(req, 'user'), metadata)
}

export function auditWalletSigningUsed(
  req: Request,
  metadata: { dealId?: string; txType?: string; txId?: string } = {},
): void {
  auditLog('WALLET_SIGNING_USED', extractAuditContext(req, 'user'), metadata)
}

export function auditWalletExportAttempt(
  req: Request,
  metadata: { walletId?: string; reason?: string } = {},
): void {
  auditLog('WALLET_EXPORT_ATTEMPT', extractAuditContext(req, 'user'), metadata)
}

export function auditAdminWalletAction(
  req: Request,
  metadata: { action?: string; walletId?: string; details?: Record<string, unknown> } = {},
): void {
  auditLog('ADMIN_WALLET_ACTION', extractAuditContext(req, 'admin'), metadata)
}

export function auditAuthOtpRequested(
  req: Request,
  metadata: { email?: string } = {},
): void {
  auditLog('AUTH_OTP_REQUESTED', extractAuditContext(req, 'user'), metadata)
}

export function auditAuthLoginSuccess(
  req: Request,
  metadata: { userId?: string; email?: string } = {},
): void {
  auditLog('AUTH_LOGIN_SUCCESS', extractAuditContext(req, 'user'), metadata)
}

export function auditAuthLoginFailed(
  req: Request,
  metadata: { email?: string; reason?: string } = {},
): void {
  auditLog('AUTH_LOGIN_FAILED', extractAuditContext(req, 'user'), metadata)
}

export function auditAuthLogout(
  req: Request,
  metadata: { userId?: string } = {},
): void {
  auditLog('AUTH_LOGOUT', extractAuditContext(req, 'user'), metadata)
}

export function auditAuthLogoutAll(
  req: Request,
  metadata: { userId?: string; sessionCount?: number } = {},
): void {
  auditLog('AUTH_LOGOUT_ALL', extractAuditContext(req, 'user'), metadata)
}

export function auditAuthWalletChallengeIssued(
  req: Request,
  metadata: { address?: string } = {},
): void {
  auditLog('AUTH_WALLET_CHALLENGE_ISSUED', extractAuditContext(req, 'user'), metadata)
}

export function auditAuthWalletLoginSuccess(
  req: Request,
  metadata: { address?: string; userId?: string } = {},
): void {
  auditLog('AUTH_WALLET_LOGIN_SUCCESS', extractAuditContext(req, 'user'), metadata)
}

export function auditAuthWalletLoginFailed(
  req: Request,
  metadata: { address?: string; reason?: string } = {},
): void {
  auditLog('AUTH_WALLET_LOGIN_FAILED', extractAuditContext(req, 'user'), metadata)
}

export function auditListingApproved(
  req: Request,
  metadata: { listingId?: string; reviewedBy?: string } = {},
): void {
  auditLog('LISTING_APPROVED', extractAuditContext(req, 'admin'), metadata)
}

export function auditListingRejected(
  req: Request,
  metadata: { listingId?: string; reviewedBy?: string; reason?: string } = {},
): void {
  auditLog('LISTING_REJECTED', extractAuditContext(req, 'admin'), metadata)
}

export function auditRewardMarkedPaid(
  req: Request,
  metadata: { rewardId?: string; amountUsdc?: number; txId?: string } = {},
): void {
  auditLog('REWARD_MARKED_PAID', extractAuditContext(req, 'admin'), metadata)
}

export function auditAdminOutboxMarkDead(
  req: Request,
  metadata: { outboxId?: string; reason?: string } = {},
): void {
  auditLog('ADMIN_OUTBOX_MARK_DEAD', extractAuditContext(req, 'admin'), metadata)
}

export function auditAdminOutboxRetry(
  req: Request,
  metadata: { outboxId?: string } = {},
): void {
  auditLog('ADMIN_OUTBOX_RETRY', extractAuditContext(req, 'admin'), metadata)
}

export function auditAdminRiskOperation(
  req: Request,
  eventType: 'ADMIN_RISK_FREEZE' | 'ADMIN_RISK_UNFREEZE',
  metadata: Record<string, unknown> = {},
): void {
  auditLog(eventType, extractAuditContext(req, 'admin'), metadata)
}
