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

class UserStore {
  private postgresRepo = new PostgresUserRepository()
  private fallbackCache = new Map<string, User>()

  async getByEmail(email: string): Promise<User | undefined> {
    try {
      const result = await this.postgresRepo.getByEmail(email)
      return result || undefined
    } catch (error) {
      console.warn('Postgres user lookup failed, using fallback cache:', error)
      return this.fallbackCache.get(email)
    }
  }

  async getById(userId: string): Promise<User | undefined> {
    try {
      const result = await this.postgresRepo.getById(userId)
      return result || undefined
    } catch (error) {
      console.warn('Postgres user lookup by id failed, using fallback cache:', error)
      for (const user of this.fallbackCache.values()) {
        if (user.id === userId) return user
      }
      return undefined
    }
  }

  async getOrCreateByEmail(email: string): Promise<User> {
    try {
      const user = await this.postgresRepo.getOrCreateByEmail(email)
      // Update fallback cache
      this.fallbackCache.set(email, user)
      return user
    } catch (error) {
      console.warn('Postgres user creation failed, using fallback cache:', error)

      const existing = this.fallbackCache.get(email)
      if (existing) return existing

      const now = new Date()
      const user: User = {
        id: randomUUID(),
        email,
        createdAt: now,
        name: email.split('@')[0] ?? email,
        role: 'tenant',
        tier: 'free',
        planQuota: 100,
        displayCurrency: 'NGN',
      }

      this.fallbackCache.set(email, user)
      return user
    }
  }

  async updateDisplayCurrency(email: string, displayCurrency: 'NGN' | 'USDC'): Promise<User> {
    try {
      const user = await this.postgresRepo.updateDisplayCurrency(email, displayCurrency)
      this.fallbackCache.set(email, user)
      return user
    } catch (error) {
      console.warn('Postgres display currency update failed, using fallback cache:', error)
      const user = this.fallbackCache.get(email)
      if (user) {
        user.displayCurrency = displayCurrency
        this.fallbackCache.set(email, user)
        return user
      }
      throw new Error('User not found for preference update')
    }
  }

  async getByWalletAddress(address: string): Promise<User | undefined> {
    try {
      const result = await this.postgresRepo.getByWalletAddress(address)
      return result || undefined
    } catch (error) {
      console.warn('Postgres wallet lookup failed, using fallback cache:', error)
      for (const user of this.fallbackCache.values()) {
        if (user.walletAddress === address.toLowerCase()) {
          return user
        }
      }
      return undefined
    }
  }

  async linkWalletToUser(email: string, walletAddress: string): Promise<User> {
    try {
      const user = await this.postgresRepo.linkWalletToUser(email, walletAddress)
      // Update fallback cache
      this.fallbackCache.set(email, user)
      return user
    } catch (error) {
      console.warn('Postgres wallet linking failed, using fallback cache:', error)
      const user = this.fallbackCache.get(email)
      if (user) {
        user.walletAddress = walletAddress.toLowerCase()
        this.fallbackCache.set(email, user)
        return user
      }
      throw new Error('User not found for wallet linking')
    }
  }

  async getLandlordProfile(userId: string): Promise<LandlordProfile | null> {
    try {
      return await this.postgresRepo.getLandlordProfile(userId)
    } catch (error) {
      console.warn('Postgres landlord profile lookup failed:', error)
      return null
    }
  }

  async updateLandlordProfile(userId: string, profile: Partial<LandlordProfile>): Promise<void> {
    try {
      await this.postgresRepo.updateLandlordProfile(userId, profile)
    } catch (error) {
      console.warn('Postgres landlord profile update failed:', error)
      throw error
    }
  }

  async updateName(userId: string, name: string): Promise<void> {
    try {
      await this.postgresRepo.updateName(userId, name)
    } catch (error) {
      console.warn('Postgres user name update failed:', error)
      throw error
    }
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
  }
}

class OtpChallengeStore {
  private postgresRepo = new PostgresOtpChallengeRepository()
  private fallbackCache = new Map<string, OtpChallenge>()

  async set(challenge: OtpChallenge): Promise<void> {
    try {
      await this.postgresRepo.set(challenge)
    } catch (error) {
      console.warn('Postgres OTP challenge storage failed, using fallback cache:', error)
      this.fallbackCache.set(challenge.email, challenge)
    }
  }

  async getByEmail(email: string): Promise<OtpChallenge | undefined> {
    try {
      const result = await this.postgresRepo.getByEmail(email)
      return result || undefined
    } catch (error) {
      console.warn('Postgres OTP challenge lookup failed, using fallback cache:', error)
      return this.fallbackCache.get(email)
    }
  }

  async deleteByEmail(email: string): Promise<void> {
    try {
      await this.postgresRepo.deleteByEmail(email)
    } catch (error) {
      console.warn('Postgres OTP challenge deletion failed, using fallback cache:', error)
      this.fallbackCache.delete(email)
    }
  }

  async updateAttempts(email: string, attempts: number): Promise<void> {
    try {
      await this.postgresRepo.updateAttempts(email, attempts)
    } catch (error) {
      console.warn('Postgres OTP attempts update failed, using fallback cache:', error)
      const challenge = this.fallbackCache.get(email)
      if (challenge) {
        challenge.attempts = attempts
        this.fallbackCache.set(email, challenge)
      }
    }
  }

  clear(): void {
    this.fallbackCache.clear()
  }
}

class WalletChallengeStore {
  private postgresRepo = new PostgresWalletChallengeRepository()
  private fallbackCache = new Map<string, WalletChallenge>()

  async set(challenge: WalletChallenge): Promise<void> {
    try {
      await this.postgresRepo.set(challenge)
    } catch (error) {
      console.warn('Postgres wallet challenge storage failed, using fallback cache:', error)
      this.fallbackCache.set(challenge.address.toLowerCase(), challenge)
    }
  }

  async getByAddress(address: string): Promise<WalletChallenge | undefined> {
    try {
      const result = await this.postgresRepo.getByAddress(address)
      return result || undefined
    } catch (error) {
      console.warn('Postgres wallet challenge lookup failed, using fallback cache:', error)
      return this.fallbackCache.get(address.toLowerCase())
    }
  }

  async deleteByAddress(address: string): Promise<void> {
    try {
      await this.postgresRepo.deleteByAddress(address)
    } catch (error) {
      console.warn('Postgres wallet challenge deletion failed, using fallback cache:', error)
      this.fallbackCache.delete(address.toLowerCase())
    }
  }

  async updateAttempts(address: string, attempts: number): Promise<void> {
    try {
      await this.postgresRepo.updateAttempts(address, attempts)
    } catch (error) {
      console.warn('Postgres wallet attempts update failed, using fallback cache:', error)
      const challenge = this.fallbackCache.get(address.toLowerCase())
      if (challenge) {
        challenge.attempts = attempts
        this.fallbackCache.set(address.toLowerCase(), challenge)
      }
    }
  }

  async markAsUsed(address: string): Promise<void> {
    try {
      await this.postgresRepo.markAsUsed(address)
    } catch (error) {
      console.warn('Postgres wallet challenge usage marking failed, using fallback cache:', error)
      // In fallback mode, we just delete it
      this.fallbackCache.delete(address.toLowerCase())
    }
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

    try {
      await this.postgresRepo.create(email, token, session.expiresAt, auditInfo, { id: session.id, family })
    } catch (error) {
      console.warn('Postgres session creation failed, using fallback cache:', error)
    }

    this.fallbackCache.set(token, session as any)
    return session as any
  }

  async getByToken(token: string): Promise<Session | undefined> {
    let session: (Session & { expiresAt?: Date; userAgent?: string }) | undefined
    try {
      const dbSession = await this.postgresRepo.getByToken(token)
      if (dbSession) {
        session = {
          token: dbSession.token,
          email: dbSession.email,
          createdAt: dbSession.createdAt,
          expiresAt: (dbSession as any).expiresAt,
          userAgent: (dbSession as any).userAgent,
        }
      }
    } catch (error) {
      console.warn('Postgres session lookup failed, using fallback cache:', error)
      session = this.fallbackCache.get(token) as any
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
    const fallback = this.fallbackCache.get(token) as (Session & { expiresAt?: Date }) | undefined
    if (fallback) {
      const expiresAt = fallback.expiresAt ?? new Date(fallback.createdAt.getTime() + SESSION_TTL_MS)
      return expiresAt.getTime() < Date.now() ? 'expired' : 'active'
    }

    try {
      return await this.postgresRepo.getTokenState(token)
    } catch (error) {
      console.warn('Postgres token state lookup failed:', error)
      return 'invalid'
    }
  }

  async deleteByToken(token: string): Promise<void> {
    try {
      await this.postgresRepo.revokeByToken(token)
    } catch (error) {
      console.warn('Postgres session deletion failed, using fallback cache:', error)
    }
    this.fallbackCache.delete(token)
  }

  revokeByToken(token: string): void {
    this.fallbackCache.delete(token)
    this.postgresRepo.revokeByToken(token).catch(err => {
      console.warn('Postgres session revocation failed:', err)
    })
  }

  getActiveSessionsByEmail(email: string): Session[] {
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

  revokeAllByEmail(email: string): number {
    let count = 0
    for (const [token, session] of this.fallbackCache.entries()) {
      if (session.email === email) {
        this.fallbackCache.delete(token)
        count++
      }
    }
    return count
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
    try {
      return await this.postgresRepo.listActiveSessions(userId, currentToken)
    } catch (error) {
      console.warn('Postgres session listing failed, using fallback cache:', error)
      return this.fallbackActive(email, currentToken)
    }
  }

  /**
   * Revoke one of the user's own sessions plus its refresh-token family.
   * Returns false when the session does not exist or belongs to someone else.
   */
  async revokeSession(userId: string, email: string, sessionId: string): Promise<boolean> {
    const families = new Set<string>()
    let found = false

    try {
      const result = await this.postgresRepo.revokeSession(userId, sessionId)
      if (result) {
        found = true
        result.families.forEach((f) => families.add(f))
      }
    } catch (error) {
      console.warn('Postgres session revocation failed, using fallback cache:', error)
    }

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
    try {
      const result = await this.postgresRepo.revokeAllSessions(userId, { exceptSessionId })
      count = result.count
    } catch (error) {
      console.warn('Postgres session revocation failed, using fallback cache:', error)
    }

    let fallbackCount = 0
    for (const [token, s] of this.fallbackCache.entries()) {
      const meta = s as Session & FallbackSessionMeta
      if (s.email !== email) continue
      if (exceptSessionId && (meta.id === exceptSessionId || (exceptFamily && meta.family === exceptFamily))) continue
      this.fallbackCache.delete(token)
      fallbackCount++
    }

    await refreshTokenStore.invalidateAllByUserId(userId, exceptFamily)
    return Math.max(count, fallbackCount)
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
