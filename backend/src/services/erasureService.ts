/**
 * Account erasure (#2053): request -> confirm -> grace period -> anonymization.
 *
 *  - request:  the user asks for erasure. Blockers are checked and the request is pending.
 *  - confirm:  within 30 days of the request, the user confirms. Blockers are checked again
 *              and the request becomes scheduled with a 14-day grace window.
 *  - cancel:   allowed while pending, or while scheduled and before the grace window ends.
 *  - complete: the data-retention job runs the due completions. Blockers are checked once more.
 *              A blocked request is cancelled, not anonymized. Otherwise sessions are revoked,
 *              personal fields are replaced and the account is deactivated.
 *
 * Financial rows are kept. Only the user's identity fields change, so the records still
 * refer to an account that exists.
 */

import { randomUUID } from 'node:crypto'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { userStore } from '../models/authStore.js'
import {
  erasureRequestStore,
  OPEN_ERASURE_STATUSES,
  type ErasureRequest,
} from '../models/erasureRequestStore.js'
import { auditLog, type AuditContext } from '../utils/auditLogger.js'
import { logger } from '../utils/logger.js'
import { findErasureBlockers, type ErasureBlocker } from './erasureGuards.js'

export const ERASURE_CONFIRM_WINDOW_DAYS = 30
export const ERASURE_GRACE_PERIOD_DAYS = 14

const DAY_MS = 24 * 60 * 60 * 1000

export interface ErasureRequestView {
  id: string
  status: ErasureRequest['status']
  requestedAt: string
  confirmBy: string
  confirmedAt: string | null
  graceEndsAt: string | null
  cancelledAt: string | null
  canCancel: boolean
}

function toView(row: ErasureRequest, now: Date): ErasureRequestView {
  const inGrace = row.status === 'scheduled' && row.graceEndsAt !== null && row.graceEndsAt.getTime() > now.getTime()
  return {
    id: row.id,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    confirmBy: row.confirmBy.toISOString(),
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    graceEndsAt: row.graceEndsAt ? row.graceEndsAt.toISOString() : null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    canCancel: row.status === 'pending' || inGrace,
  }
}

function blockedError(blockers: ErasureBlocker[]): AppError {
  return new AppError(
    ErrorCode.CONFLICT,
    409,
    `Account erasure is blocked until these are resolved: ${blockers.join(', ')}`,
    { blockers },
  )
}

function placeholderEmail(userId: string): string {
  return `erased+${userId}@erased.invalid`
}

export async function requestErasure(
  userId: string,
  audit: AuditContext,
  now: Date = new Date(),
): Promise<ErasureRequestView> {
  const open = await erasureRequestStore.findOpenForUser(userId)
  if (open) {
    throw new AppError(ErrorCode.CONFLICT, 409, 'An account erasure request is already open', {
      requestId: open.id,
    })
  }

  const blockers = await findErasureBlockers(userId)
  if (blockers.length > 0) throw blockedError(blockers)

  const row = await erasureRequestStore.create({
    userId,
    requestedAt: now,
    confirmBy: new Date(now.getTime() + ERASURE_CONFIRM_WINDOW_DAYS * DAY_MS),
  })
  auditLog('USER_ERASURE_REQUESTED', audit, { requestId: row.id })
  return toView(row, now)
}

export async function getErasure(userId: string, now: Date = new Date()): Promise<ErasureRequestView | null> {
  const row = await erasureRequestStore.findLatestForUser(userId)
  return row ? toView(row, now) : null
}

export async function confirmErasure(
  userId: string,
  requestId: string,
  audit: AuditContext,
  now: Date = new Date(),
): Promise<ErasureRequestView> {
  const row = await erasureRequestStore.findById(requestId)
  if (!row || row.userId !== userId) {
    throw new AppError(ErrorCode.NOT_FOUND, 404, 'Erasure request not found')
  }
  if (row.status !== 'pending') {
    throw new AppError(ErrorCode.INVALID_STATE_TRANSITION, 409, 'Only a pending erasure request can be confirmed')
  }
  if (row.confirmBy.getTime() <= now.getTime()) {
    await erasureRequestStore.transition(requestId, ['pending'], 'expired', {}, now)
    throw new AppError(ErrorCode.INVALID_STATE_TRANSITION, 409, 'The confirmation window for this request has passed')
  }

  const blockers = await findErasureBlockers(userId)
  if (blockers.length > 0) throw blockedError(blockers)

  const graceEndsAt = new Date(now.getTime() + ERASURE_GRACE_PERIOD_DAYS * DAY_MS)
  const updated = await erasureRequestStore.transition(
    requestId,
    ['pending'],
    'scheduled',
    { confirmedAt: now, graceEndsAt },
    now,
  )
  if (!updated) {
    throw new AppError(ErrorCode.CONFLICT, 409, 'This erasure request was changed by another request. Refresh and try again')
  }
  auditLog('USER_ERASURE_CONFIRMED', audit, { requestId, graceEndsAt: graceEndsAt.toISOString() })
  return toView(updated, now)
}

export async function cancelErasure(
  userId: string,
  audit: AuditContext,
  now: Date = new Date(),
): Promise<ErasureRequestView> {
  const open = await erasureRequestStore.findOpenForUser(userId)
  if (!open) {
    throw new AppError(ErrorCode.NOT_FOUND, 404, 'No open erasure request')
  }
  if (open.status === 'scheduled' && (open.graceEndsAt === null || open.graceEndsAt.getTime() <= now.getTime())) {
    throw new AppError(
      ErrorCode.INVALID_STATE_TRANSITION,
      409,
      'The grace period has ended, so this erasure can no longer be cancelled',
    )
  }

  const updated = await erasureRequestStore.transition(
    open.id,
    OPEN_ERASURE_STATUSES,
    'cancelled',
    { cancelledAt: now },
    now,
  )
  if (!updated) {
    throw new AppError(ErrorCode.CONFLICT, 409, 'This erasure request was changed by another request. Refresh and try again')
  }
  auditLog('USER_ERASURE_CANCELLED', audit, { requestId: open.id, previousStatus: open.status })
  return toView(updated, now)
}

/** Replaces the account's identity fields and revokes its sessions. Financial rows are kept. */
async function anonymizeAccount(userId: string, now: Date): Promise<void> {
  const user = await userStore.getById(userId)
  if (user) {
    await userStore.revokeAllSessions(userId, user.email)
  }
  await userStore.anonymize(userId, placeholderEmail(userId))
  logger.info('Account erasure anonymized user', { userId, at: now.toISOString() })
}

export interface ErasureRunSummary {
  completed: number
  cancelledForBlockers: number
  expiredUnconfirmed: number
}

/** Runs the due steps: completes erasures whose grace window has ended and expires stale requests. */
export async function processDueErasures(now: Date = new Date()): Promise<ErasureRunSummary> {
  const summary: ErasureRunSummary = { completed: 0, cancelledForBlockers: 0, expiredUnconfirmed: 0 }

  for (const row of await erasureRequestStore.listStalePending(now)) {
    const expired = await erasureRequestStore.transition(row.id, ['pending'], 'expired', {}, now)
    if (expired) summary.expiredUnconfirmed += 1
  }

  for (const row of await erasureRequestStore.listDueForCompletion(now)) {
    const system: AuditContext = {
      userId: row.userId,
      requestId: randomUUID(),
      ip: 'system',
      actorType: 'system',
    }

    const blockers = await findErasureBlockers(row.userId)
    if (blockers.length > 0) {
      const cancelled = await erasureRequestStore.transition(
        row.id,
        ['scheduled'],
        'cancelled',
        { cancelledAt: now },
        now,
      )
      if (cancelled) {
        summary.cancelledForBlockers += 1
        auditLog('USER_ERASURE_CANCELLED', system, { requestId: row.id, reason: 'blocked', blockers })
      }
      continue
    }

    await anonymizeAccount(row.userId, now)
    const completed = await erasureRequestStore.transition(row.id, ['scheduled'], 'completed', {}, now)
    if (completed) {
      summary.completed += 1
      auditLog('USER_ERASURE_COMPLETED', system, {
        requestId: row.id,
        anonymizedFields: ['email', 'name'],
        deactivated: true,
      })
    }
  }

  return summary
}
