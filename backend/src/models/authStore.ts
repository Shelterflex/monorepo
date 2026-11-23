import { createHash, randomUUID } from 'node:crypto'
import { getPool } from '../db.js'
import {
  PostgresUserRepository,
  PostgresSessionRepository,
  PostgresOtpChallengeRepository,
  PostgresWalletChallengeRepository,
  type User,
  type OtpChallenge,
  type Session,
  type ActiveSession,
  type WalletChallenge,
  type UserRole,
  type LandlordProfile
} from '../repositories/AuthRepository.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { logger } from '../utils/logger.js'

export type { UserRole, User, OtpChallenge, Session, ActiveSession, WalletChallenge, LandlordProfile }

export const SESSION_TTL_MS = 15 * 60 * 1000 // 15 minutes
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export interface RefreshTokenRecord {
  id: string
  userId: string
  email: string
  tokenHash: string
  family: string
  usedAt: Date | null
  expiresAt: Date
  createdAt: Date
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// ─── Backend selection ────────────────────────────────────────────────────────
//
// Each store runs against exactly ONE backend, chosen explicitly, never by
// catching a database error:
//
//   - AUTH_STORE=memory | postgres forces the choice (the test setup uses
//     `memory`, see vitest.config.ts).
//   - Otherwise Postgres is used when DATABASE_URL is set and the in-memory
//     implementation when it is not, as the other stores do.
//
// In Postgres mode a database error surfaces as a 503 and is never papered over
// with a process-local copy. That copy used to disagree with the database across
// instances and restarts: a session revoked in Postgres could still be honoured,
// a user created during an outage vanished afterwards, and OTP state was lost.

export type AuthStoreMode = 'postgres' | 'memory'

export function getAuthStoreMode(env: NodeJS.ProcessEnv = process.env): AuthStoreMode {
  const explicit = env.AUTH_STORE?.trim().toLowerCase()
  if (explicit === 'memory' || explicit === 'postgres') return explicit
  return env.DATABASE_URL ? 'postgres' : 'memory'
}

function inMemory(): boolean {
  return getAuthStoreMode() === 'memory'
}

/**
 * Run a Postgres operation. A failure is logged (operation name and error code
 * only: never emails, tokens or the raw database message, which can embed row
 * values) and surfaced as a 503. Domain errors raised by the repositories for a
 * missing user are passed through unchanged.
 */
async function db<T>(store: string, operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof AppError) throw error
    if (error instanceof Error && error.message === 'User not found') throw error

    const code = (error as { code?: unknown } | null)?.code
    logger.error('Auth store database error', {
      store,
      operation,
      errorCode: typeof code === 'string' ? code : undefined,
      errorName: error instanceof Error ? error.name : typeof error,
    })
    throw new AppError(
      ErrorCode.SERVICE_UNAVAILABLE,
      503,
      'Authentication service temporarily unavailable',
    )
  }
}

class UserStore {
  private postgresRepo = new PostgresUserRepository()
  // Used only when the in-memory backend is selected (AUTH_STORE=memory or no DATABASE_URL).
  private fallbackCache = new Map<string, User>()
  private landlordProfiles = new Map<string, LandlordProfile>()

  async getByEmail(email: string): Promise<User | undefined> {
    if (inMemory()) return this.fallbackCache.get(email)
    const result = await db('user', 'getByEmail', () => this.postgresRepo.getByEmail(email))
    return result || undefined
  }

  async getById(userId: string): Promise<User | undefined> {
    if (inMemory()) {
      for (const user of this.fallbackCache.values()) {
        if (user.id === userId) return user
      }
      return undefined
    }
    const result = await db('user', 'getById', () => this.postgresRepo.getById(userId))
    return result || undefined
  }

  async getOrCreateByEmail(email: string): Promise<User> {
    if (inMemory()) {
      const existing = this.fallbackCache.get(email)
      if (existing) return existing

      const user: User = {
        id: randomUUID(),
        email,
        createdAt: new Date(),
        name: email.split('@')[0] ?? email,
        role: 'tenant',
        tier: 'free',
        planQuota: 100,
        displayCurrency: 'NGN',
      }
      this.fallbackCache.set(email, user)
      return user
    }
    return db('user', 'getOrCreateByEmail', () => this.postgresRepo.getOrCreateByEmail(email))
  }

  async updateDisplayCurrency(email: string, displayCurrency: 'NGN' | 'USDC'): Promise<User> {
    if (inMemory()) {
      const user = this.fallbackCache.get(email)
      if (!user) throw new Error('User not found for preference update')
      user.displayCurrency = displayCurrency
      return user
    }
    return db('user', 'updateDisplayCurrency', () =>
      this.postgresRepo.updateDisplayCurrency(email, displayCurrency),
    )
  }

  async getByWalletAddress(address: string): Promise<User | undefined> {
    if (inMemory()) {
      for (const user of this.fallbackCache.values()) {
        if (user.walletAddress === address.toLowerCase()) return user
      }
      return undefined
    }
    const result = await db('user', 'getByWalletAddress', () =>
      this.postgresRepo.getByWalletAddress(address),
    )
    return result || undefined
  }

  async linkWalletToUser(email: string, walletAddress: string): Promise<User> {
    if (inMemory()) {
      const user = this.fallbackCache.get(email)
      if (!user) throw new Error('User not found for wallet linking')
      user.walletAddress = walletAddress.toLowerCase()
      return user
    }
    return db('user', 'linkWalletToUser', () => this.postgresRepo.linkWalletToUser(email, walletAddress))
  }

  async getLandlordProfile(userId: string): Promise<LandlordProfile | null> {
    if (inMemory()) return this.landlordProfiles.get(userId) ?? null
    return db('user', 'getLandlordProfile', () => this.postgresRepo.getLandlordProfile(userId))
  }

  async updateLandlordProfile(userId: string, profile: Partial<LandlordProfile>): Promise<void> {
    if (inMemory()) {
      const current = this.landlordProfiles.get(userId)
      this.landlordProfiles.set(userId, {
        notificationPreferences: {
          newInquiries: true,
          paymentUpdates: true,
          propertyViews: true,
          marketingTips: true,
        },
        ...current,
        ...profile,
        userId,
      })
      return
    }
    await db('user', 'updateLandlordProfile', () => this.postgresRepo.updateLandlordProfile(userId, profile))
  }

  async updateName(userId: string, name: string): Promise<void> {
    if (inMemory()) {
      for (const user of this.fallbackCache.values()) {
        if (user.id === userId) user.name = name
      }
      return
    }
    await db('user', 'updateName', () => this.postgresRepo.updateName(userId, name))
  }

  /**
   * Replaces the account's email and name and marks it deactivated (account erasure, #2053).
   * With a database, a failure is thrown so the erasure is retried. Without one, only the fallback cache changes.
   */
  async anonymize(userId: string, placeholderEmail: string): Promise<void> {
    if (await getPool()) {
      await this.postgresRepo.anonymize(userId, placeholderEmail)
    }
    for (const [email, user] of [...this.fallbackCache.entries()]) {
      if (user.id !== userId) continue
      this.fallbackCache.delete(email)
      this.fallbackCache.set(placeholderEmail, { ...user, email: placeholderEmail, name: 'Erased user' })
    }
  }

  clear(): void {
    this.fallbackCache.clear()
    this.landlordProfiles.clear()
  }
}

class OtpChallengeStore {
  private postgresRepo = new PostgresOtpChallengeRepository()
  private fallbackCache = new Map<string, OtpChallenge>()

  async set(challenge: OtpChallenge): Promise<void> {
    if (inMemory()) {
      this.fallbackCache.set(challenge.email, challenge)
      return
    }
    await db('otp', 'set', () => this.postgresRepo.set(challenge))
  }

  async getByEmail(email: string): Promise<OtpChallenge | undefined> {
    if (inMemory()) return this.fallbackCache.get(email)
    const result = await db('otp', 'getByEmail', () => this.postgresRepo.getByEmail(email))
    return result || undefined
  }

  async deleteByEmail(email: string): Promise<void> {
    if (inMemory()) {
      this.fallbackCache.delete(email)
      return
    }
    await db('otp', 'deleteByEmail', () => this.postgresRepo.deleteByEmail(email))
  }

  async updateAttempts(email: string, attempts: number): Promise<void> {
    if (inMemory()) {
      const challenge = this.fallbackCache.get(email)
      if (challenge) challenge.attempts = attempts
      return
    }
    await db('otp', 'updateAttempts', () => this.postgresRepo.updateAttempts(email, attempts))
  }

  clear(): void {
    this.fallbackCache.clear()
  }
}

class WalletChallengeStore {
  private postgresRepo = new PostgresWalletChallengeRepository()
  private fallbackCache = new Map<string, WalletChallenge>()

  async set(challenge: WalletChallenge): Promise<void> {
    if (inMemory()) {
      this.fallbackCache.set(challenge.address.toLowerCase(), challenge)
      return
    }
    await db('wallet_challenge', 'set', () => this.postgresRepo.set(challenge))
  }

  async getByAddress(address: string): Promise<WalletChallenge | undefined> {
    if (inMemory()) return this.fallbackCache.get(address.toLowerCase())
    const result = await db('wallet_challenge', 'getByAddress', () =>
      this.postgresRepo.getByAddress(address),
    )
    return result || undefined
  }

  async deleteByAddress(address: string): Promise<void> {
    if (inMemory()) {
      this.fallbackCache.delete(address.toLowerCase())
      return
    }
    await db('wallet_challenge', 'deleteByAddress', () => this.postgresRepo.deleteByAddress(address))
  }

  async updateAttempts(address: string, attempts: number): Promise<void> {
    if (inMemory()) {
      const challenge = this.fallbackCache.get(address.toLowerCase())
      if (challenge) challenge.attempts = attempts
      return
    }
    await db('wallet_challenge', 'updateAttempts', () =>
      this.postgresRepo.updateAttempts(address, attempts),
    )
  }

  async markAsUsed(address: string): Promise<void> {
    if (inMemory()) {
      // The in-memory backend has no "used" flag: a used challenge is simply removed.
      this.fallbackCache.delete(address.toLowerCase())
      return
    }
    await db('wallet_challenge', 'markAsUsed', () => this.postgresRepo.markAsUsed(address))
  }

  clear(): void {
    this.fallbackCache.clear()
  }
}

interface FallbackSessionMeta {
  id: string
  family?: string
  ip?: string
  userAgent?: string
  expiresAt?: Date
  lastActiveAt: Date
}

class SessionStore {
  private postgresRepo = new PostgresSessionRepository()
  // Used only when the in-memory backend is selected (AUTH_STORE=memory or no DATABASE_URL).
  private fallbackCache = new Map<string, Session>()

  async create(
    email: string,
    token: string,
    auditInfo?: { ip?: string; userAgent?: string },
    family?: string,
  ): Promise<Session> {
    const now = new Date()
    const session: Session & FallbackSessionMeta = {
      token,
      email,
      createdAt: now,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: auditInfo?.userAgent,
      ip: auditInfo?.ip,
      id: randomUUID(),
      family,
      lastActiveAt: now,
    }

    if (inMemory()) {
      this.fallbackCache.set(token, session as any)
    } else {
      // Postgres is the only record of this session; a failure means no session was created.
      await db('session', 'create', () =>
        this.postgresRepo.create(email, token, session.expiresAt!, auditInfo, { id: session.id, family }),
      )
    }
    return session as any
  }

  async getByToken(token: string): Promise<Session | undefined> {
    let session: (Session & { expiresAt?: Date; userAgent?: string }) | undefined
    if (inMemory()) {
      session = this.fallbackCache.get(token) as any
    } else {
      const dbSession = await db('session', 'getByToken', () => this.postgresRepo.getByToken(token))
      if (dbSession) {
        session = {
          token: dbSession.token,
          email: dbSession.email,
          createdAt: dbSession.createdAt,
          expiresAt: (dbSession as any).expiresAt,
          userAgent: (dbSession as any).userAgent,
        }
      }
    }

    if (!session) return undefined

    const expiresAtTime = session.expiresAt ? session.expiresAt.getTime() : session.createdAt.getTime() + SESSION_TTL_MS
    if (expiresAtTime < Date.now()) {
      await this.deleteByToken(token)
      return undefined
    }

    return session
  }

  async getTokenState(token: string): Promise<'active' | 'expired' | 'invalid'> {
    if (inMemory()) {
      const cached = this.fallbackCache.get(token) as (Session & { expiresAt?: Date }) | undefined
      if (!cached) return 'invalid'
      const expiresAt = cached.expiresAt ?? new Date(cached.createdAt.getTime() + SESSION_TTL_MS)
      return expiresAt.getTime() < Date.now() ? 'expired' : 'active'
    }
    return db('session', 'getTokenState', () => this.postgresRepo.getTokenState(token))
  }

  async deleteByToken(token: string): Promise<void> {
    if (inMemory()) {
      this.fallbackCache.delete(token)
      return
    }
    await db('session', 'deleteByToken', () => this.postgresRepo.revokeByToken(token))
  }

  /** Revoke one session. Rejects with a 503 if Postgres is unavailable, so a revocation is never silently lost. */
  async revokeByToken(token: string): Promise<void> {
    await this.deleteByToken(token)
  }

  /**
   * Active sessions for an email from the in-memory backend. Synchronous, so it
   * cannot query Postgres; use `listActiveSessions` there.
   */
  getActiveSessionsByEmail(email: string): Session[] {
    if (!inMemory()) {
      throw new Error('getActiveSessionsByEmail is only available with the in-memory auth store')
    }
    const now = Date.now()
    const sessions: Session[] = []
    for (const session of this.fallbackCache.values()) {
      const expiresAt = (session as any).expiresAt || new Date(session.createdAt.getTime() + SESSION_TTL_MS)
      if (session.email === email && expiresAt.getTime() > now) {
        sessions.push({
          ...session,
          expiresAt,
        } as any)
      }
    }
    return sessions
  }

  /** Revoke every session for an email; returns how many were revoked. */
  async revokeAllByEmail(email: string): Promise<number> {
    if (inMemory()) {
      let count = 0
      for (const [token, session] of this.fallbackCache.entries()) {
        if (session.email === email) {
          this.fallbackCache.delete(token)
          count++
        }
      }
      return count
    }
    const user = await userStore.getByEmail(email)
    if (!user) return 0
    const result = await db('session', 'revokeAllByEmail', () =>
      this.postgresRepo.revokeAllSessions(user.id, {}),
    )
    return result.count
  }

  private fallbackActive(email: string, currentToken?: string): ActiveSession[] {
    const now = Date.now()
    const current = currentToken
      ? (this.fallbackCache.get(currentToken) as (Session & FallbackSessionMeta) | undefined)
      : undefined
    const byDevice = new Map<string, Session & FallbackSessionMeta>()
    for (const raw of this.fallbackCache.values()) {
      const session = raw as Session & FallbackSessionMeta
      const expiresAt = session.expiresAt ?? new Date(session.createdAt.getTime() + SESSION_TTL_MS)
      if (session.email !== email || expiresAt.getTime() <= now) continue
      const key = session.family ?? session.id
      const seen = byDevice.get(key)
      if (!seen || seen.createdAt.getTime() <= session.createdAt.getTime()) byDevice.set(key, session)
    }
    return [...byDevice.values()]
      .map((session) => ({
        id: session.id,
        family: session.family ?? null,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt ?? session.createdAt,
        expiresAt: session.expiresAt ?? new Date(session.createdAt.getTime() + SESSION_TTL_MS),
        ip: session.ip ?? null,
        userAgent: session.userAgent ?? null,
        current: Boolean(
          current &&
            (current.id === session.id || (current.family !== undefined && current.family === session.family)),
        ),
      }))
      .sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime())
  }

  /** Active sessions for a user (one entry per device); `current` flags the caller's own. */
  async listActiveSessions(userId: string, email: string, currentToken?: string): Promise<ActiveSession[]> {
    if (inMemory()) return this.fallbackActive(email, currentToken)
    return db('session', 'listActiveSessions', () => this.postgresRepo.listActiveSessions(userId, currentToken))
  }

  /**
   * Revoke one of the user's own sessions plus its refresh-token family.
   * Returns false when the session does not exist or belongs to someone else.
   */
  async revokeSession(userId: string, email: string, sessionId: string): Promise<boolean> {
    const families = new Set<string>()
    let found = false

    if (inMemory()) {
      const target = [...this.fallbackCache.values()].find(
        (s) => s.email === email && (s as Session & FallbackSessionMeta).id === sessionId,
      ) as (Session & FallbackSessionMeta) | undefined
      if (target) {
        found = true
        if (target.family) families.add(target.family)
        for (const [token, s] of this.fallbackCache.entries()) {
          const meta = s as Session & FallbackSessionMeta
          if (s.email === email && (meta.id === sessionId || (target.family && meta.family === target.family))) {
            this.fallbackCache.delete(token)
          }
        }
      }
    } else {
      const result = await db('session', 'revokeSession', () => this.postgresRepo.revokeSession(userId, sessionId))
      if (result) {
        found = true
        result.families.forEach((f) => families.add(f))
      }
    }

    for (const family of families) await refreshTokenStore.invalidateFamily(family)
    return found
  }

  /** Revoke every session (and refresh token) for a user, optionally sparing one device. */
  async revokeAllSessions(
    userId: string,
    email: string,
    options: { exceptSessionId?: string } = {},
  ): Promise<number> {
    const { exceptSessionId } = options
    let exceptFamily: string | undefined
    if (exceptSessionId) {
      const active = await this.listActiveSessions(userId, email)
      exceptFamily = active.find((s) => s.id === exceptSessionId)?.family ?? undefined
    }

    let count = 0
    if (inMemory()) {
      for (const [token, s] of this.fallbackCache.entries()) {
        const meta = s as Session & FallbackSessionMeta
        if (s.email !== email) continue
        if (exceptSessionId && (meta.id === exceptSessionId || (exceptFamily && meta.family === exceptFamily))) continue
        this.fallbackCache.delete(token)
        count++
      }
    } else {
      const result = await db('session', 'revokeAllSessions', () =>
        this.postgresRepo.revokeAllSessions(userId, { exceptSessionId }),
      )
      count = result.count
    }

    await refreshTokenStore.invalidateAllByUserId(userId, exceptFamily)
    return count
  }

  clear(): void {
    this.fallbackCache.clear()
  }
}

class RefreshTokenStore {
  private records = new Map<string, RefreshTokenRecord>()

  async create(input: {
    userId: string
    email: string
    rawToken: string
    family: string
    expiresAt?: Date
  }): Promise<RefreshTokenRecord> {
    const now = new Date()
    const record: RefreshTokenRecord = {
      id: randomUUID(),
      userId: input.userId,
      email: input.email,
      tokenHash: hashRefreshToken(input.rawToken),
      family: input.family,
      usedAt: null,
      expiresAt: input.expiresAt ?? new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      createdAt: now,
    }
    this.records.set(record.tokenHash, record)
    return record
  }

  async findByRawToken(rawToken: string): Promise<RefreshTokenRecord | undefined> {
    return this.records.get(hashRefreshToken(rawToken))
  }

  async markUsed(rawToken: string): Promise<void> {
    const record = await this.findByRawToken(rawToken)
    if (record) {
      record.usedAt = new Date()
      this.records.set(record.tokenHash, record)
    }
  }

  async invalidateFamily(family: string): Promise<number> {
    let count = 0
    for (const record of this.records.values()) {
      if (record.family === family && record.usedAt === null) {
        record.usedAt = new Date()
        count++
      }
    }
    return count
  }

  async invalidateAllByUserId(userId: string, exceptFamily?: string): Promise<number> {
    let count = 0
    for (const record of this.records.values()) {
      if (record.userId === userId && record.usedAt === null && record.family !== exceptFamily) {
        record.usedAt = new Date()
        count++
      }
    }
    return count
  }

  clear(): void {
    this.records.clear()
  }
}

export const userStore = new UserStore()
export const otpChallengeStore = new OtpChallengeStore()
export const walletChallengeStore = new WalletChallengeStore()
export const sessionStore = new SessionStore()
export const refreshTokenStore = new RefreshTokenStore()
