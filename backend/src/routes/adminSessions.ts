/**
 * Admin Session Management Routes  (#686)
 *
 * GET  /api/admin/sessions/:userId          — list active sessions for a user
 * POST /api/admin/sessions/:userId/force-logout — revoke all sessions (admin forced logout)
 * DELETE /api/admin/sessions/:sessionId     — revoke a single session
 */

import { Router, type Request, type Response, type NextFunction } from 'express'
import { sha256Hex } from '../utils/sha256.js'
import { z } from 'zod'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { env } from '../schemas/env.js'
import { getPool } from '../db.js'
import { generateId } from '../utils/tokens.js'
import { logger } from '../utils/logger.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_CONCURRENT_SESSIONS = parseInt(
  process.env.MAX_CONCURRENT_SESSIONS ?? '5',
  10,
)

// ── Helpers ───────────────────────────────────────────────────────────────────

function requireAdmin(req: Request): void {
  const secret = req.headers['x-admin-secret']
  if (env.MANUAL_ADMIN_SECRET && secret !== env.MANUAL_ADMIN_SECRET) {
    throw new AppError(ErrorCode.FORBIDDEN, 403, 'Invalid admin secret')
  }
}

function hashIp(ip: string | undefined): string | null {
  if (!ip) return null
  return sha256Hex(ip).slice(0, 16)
}

function deviceFingerprint(req: Request): string {
  const ua = req.get('User-Agent') ?? ''
  const accept = req.get('Accept-Language') ?? ''
  return sha256Hex(`${ua}|${accept}`).slice(0, 32)
}

// ── Store helpers (operate directly on sessions table) ────────────────────────

interface SessionRow {
  id: string
  tokenHash: string
  userId: string
  createdAt: Date
  expiresAt: Date
  lastActiveAt: Date
  ipHash: string | null
  userAgent: string | null
  deviceFingerprint: string | null
  revokedAt: Date | null
  forcedLogoutAt: Date | null
}

async function listActiveSessions(userId: string): Promise<SessionRow[]> {
  const pool = await getPool()
  if (!pool) return []
  const { rows } = await pool.query(
    `SELECT id, token_hash, user_id, created_at, expires_at, last_active_at,
            ip_hash, user_agent, device_fingerprint, revoked_at, forced_logout_at
     FROM sessions
     WHERE user_id = $1
       AND revoked_at IS NULL
       AND forced_logout_at IS NULL
       AND expires_at > NOW()
     ORDER BY last_active_at DESC`,
    [userId],
  )
  return rows.map((r) => ({
    id: r.id,
    tokenHash: r.token_hash,
    userId: r.user_id,
    createdAt: new Date(r.created_at),
    expiresAt: new Date(r.expires_at),
    lastActiveAt: new Date(r.last_active_at),
    ipHash: r.ip_hash,
    userAgent: r.user_agent,
    deviceFingerprint: r.device_fingerprint,
    revokedAt: r.revoked_at ? new Date(r.revoked_at) : null,
    forcedLogoutAt: r.forced_logout_at ? new Date(r.forced_logout_at) : null,
  }))
}

async function enforceSessionLimit(userId: string): Promise<number> {
  const pool = await getPool()
  if (!pool) return 0
  // Revoke oldest sessions beyond the limit
  const { rowCount } = await pool.query(
    `UPDATE sessions SET revoked_at = NOW()
     WHERE id IN (
       SELECT id FROM sessions
       WHERE user_id = $1
         AND revoked_at IS NULL
         AND forced_logout_at IS NULL
         AND expires_at > NOW()
       ORDER BY last_active_at ASC
       LIMIT GREATEST(0, (
         SELECT COUNT(*) FROM sessions
         WHERE user_id = $1
           AND revoked_at IS NULL
           AND forced_logout_at IS NULL
           AND expires_at > NOW()
       ) - $2 + 1)
     )`,
    [userId, MAX_CONCURRENT_SESSIONS],
  )
  return rowCount ?? 0
}

async function forcedLogoutAll(userId: string): Promise<number> {
  const pool = await getPool()
  if (!pool) return 0
  const { rowCount } = await pool.query(
    `UPDATE sessions SET forced_logout_at = NOW()
     WHERE user_id = $1
       AND revoked_at IS NULL
       AND forced_logout_at IS NULL`,
    [userId],
  )
  return rowCount ?? 0
}

async function revokeSession(sessionId: string): Promise<boolean> {
  const pool = await getPool()
  if (!pool) return false
  const { rowCount } = await pool.query(
    `UPDATE sessions SET revoked_at = NOW()
     WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId],
  )
  return (rowCount ?? 0) > 0
}

async function touchSession(tokenHash: string): Promise<void> {
  const pool = await getPool()
  if (!pool) return
  await pool.query(
    `UPDATE sessions SET last_active_at = NOW() WHERE token_hash = $1`,
    [tokenHash],
  )
}

// ── Router ────────────────────────────────────────────────────────────────────

export function createAdminSessionsRouter() {
  const router = Router()

  /** GET /api/admin/sessions/:userId — list active sessions */
  router.get(
    '/:userId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        requireAdmin(req)
        const sessions = await listActiveSessions(req.params.userId)
        res.json({ data: sessions, count: sessions.length })
      } catch (err) {
        next(err)
      }
    },
  )

  /** POST /api/admin/sessions/:userId/force-logout — admin forced logout */
  router.post(
    '/:userId/force-logout',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        requireAdmin(req)
        const count = await forcedLogoutAll(req.params.userId)
        logger.warn('Admin forced logout executed', {
          targetUserId: req.params.userId,
          sessionsRevoked: count,
          adminIp: hashIp(req.ip),
        })
        res.json({ ok: true, sessionsRevoked: count })
      } catch (err) {
        next(err)
      }
    },
  )

  /** DELETE /api/admin/sessions/:sessionId — revoke a single session */
  router.delete(
    '/:sessionId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        requireAdmin(req)
        const ok = await revokeSession(req.params.sessionId)
        if (!ok) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, 'Session not found or already revoked')
        }
        res.json({ ok: true })
      } catch (err) {
        next(err)
      }
    },
  )

  return router
}

// ── Exported helpers used by auth routes ──────────────────────────────────────

export { enforceSessionLimit, touchSession, deviceFingerprint, hashIp }
export { MAX_CONCURRENT_SESSIONS }
