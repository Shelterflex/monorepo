import { randomUUID } from 'node:crypto'
import {
  PostgresUserRepository,
  PostgresSessionRepository,
  PostgresOtpChallengeRepository,
  PostgresWalletChallengeRepository,
  type User,
  type OtpChallenge,
  type Session,
  type WalletChallenge,
  type UserRole
} from '../repositories/AuthRepository.js'

export type { UserRole, User, OtpChallenge, Session, WalletChallenge }

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

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
        planQuota: 100
      }

      this.fallbackCache.set(email, user)
      return user
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

class SessionStore {
  private postgresRepo = new PostgresSessionRepository()
  private fallbackCache = new Map<string, Session>()

  async create(
    email: string,
    token: string,
    auditInfo?: { ip?: string; userAgent?: string },
  ): Promise<Session> {
    const session: Session = {
      token,
      email,
      createdAt: new Date(),
    }

    try {
      await this.postgresRepo.create(email, token, undefined, auditInfo)
    } catch (error) {
      console.warn('Postgres session creation failed, using fallback cache:', error)
      this.fallbackCache.set(token, session)
    }

    return session
  }

  async getByToken(token: string): Promise<Session | undefined> {
    try {
      const session = await this.postgresRepo.getByToken(token)
      if (!session) return undefined

      return {
        token: session.token,
        email: session.email,
        createdAt: session.createdAt,
      }
    } catch (error) {
      console.warn('Postgres session lookup failed, using fallback cache:', error)
      return this.fallbackCache.get(token)
    }
  }

  async deleteByToken(token: string): Promise<void> {
    try {
      await this.postgresRepo.revokeByToken(token)
    } catch (error) {
      console.warn('Postgres session deletion failed, using fallback cache:', error)
      this.fallbackCache.delete(token)
    }
  }

  revokeAllByEmail(email: string): number {
    // Postgres-backed session revocation-by-user would require userId, not email.
    // This fallback implementation only affects in-memory sessions.
    let count = 0
    for (const [token, session] of this.fallbackCache.entries()) {
      if (session.email === email) {
        this.fallbackCache.delete(token)
        count++
      }
    }
    return count
  }

  clear(): void {
    this.fallbackCache.clear()
  }
}

export const userStore = new UserStore()
export const otpChallengeStore = new OtpChallengeStore()
export const walletChallengeStore = new WalletChallengeStore()
export const sessionStore = new SessionStore()
