import { createHash } from 'node:crypto'
import { getPool } from '../db.js'
import { userCache } from '../utils/cache.js'

export type UserRole = 'tenant' | 'landlord' | 'agent'

export interface User {
  id: string
  email: string
  createdAt: Date
  name: string
  role: UserRole
  walletAddress?: string
  tier: 'free' | 'pro' | 'enterprise'
  planQuota: number
}

export interface OtpChallenge {
  email: string
  otpHash: string
  salt: string
  expiresAt: Date
  attempts: number
}

export interface Session {
  token: string
  email: string
  createdAt: Date
}

export interface WalletChallenge {
  address: string
  challengeXdr: string
  nonce: string
  expiresAt: Date
  attempts: number
}

export class PostgresUserRepository {
  private async pool() {
    const pool = await getPool()
    if (!pool) {
      throw new Error('Database pool is not available (DATABASE_URL/pg not configured)')
    }
    return pool
  }

  async getByEmail(email: string): Promise<User | null> {
    const cacheKey = `email:${email.toLowerCase()}`
    const cached = await userCache.get(cacheKey)
    if (cached) return cached

    const pool = await this.pool()
    const { rows } = await pool.query(
      `SELECT id, email, name, role, wallet_address, created_at, tier, plan_quota 
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    )

    if (rows.length === 0) return null

    const row = rows[0]
    const user: User = {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      walletAddress: row.wallet_address,
      createdAt: row.created_at,
      tier: row.tier,
      planQuota: row.plan_quota
    }

    await userCache.set(cacheKey, user)
    await userCache.set(`id:${user.id}`, user)
    return user
  }

  async getById(id: string): Promise<User | null> {
    const cacheKey = `id:${id}`
    const cached = await userCache.get(cacheKey)
    if (cached) return cached

    const pool = await this.pool()
    const { rows } = await pool.query(
      `SELECT id, email, name, role, wallet_address, created_at, tier, plan_quota 
       FROM users WHERE id = $1`,
      [id]
    )

    if (rows.length === 0) return null

    const row = rows[0]
    const user: User = {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      walletAddress: row.wallet_address,
      createdAt: row.created_at,
      tier: row.tier,
      planQuota: row.plan_quota
    }

    await userCache.set(cacheKey, user)
    await userCache.set(`email:${user.email.toLowerCase()}`, user)
    return user
  }

  async getOrCreateByEmail(email: string): Promise<User> {
    const existing = await this.getByEmail(email)
    if (existing) return existing

    const pool = await this.pool()
    const { rows } = await pool.query(
      `INSERT INTO users (email, name, role) 
       VALUES ($1, $2, $3) 
       RETURNING id, email, name, role, wallet_address, created_at, tier, plan_quota`,
      [
        email.toLowerCase(),
        email.split('@')[0] ?? email,
        'tenant'
      ]
    )

    const row = rows[0]
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      walletAddress: row.wallet_address,
      createdAt: row.created_at,
      tier: row.tier,
      planQuota: row.plan_quota
    }
  }

  async getByWalletAddress(address: string): Promise<User | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `SELECT id, email, name, role, wallet_address, created_at, tier, plan_quota 
       FROM users WHERE wallet_address = $1`,
      [address.toLowerCase()]
    )

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      walletAddress: row.wallet_address,
      createdAt: row.created_at,
      tier: row.tier,
      planQuota: row.plan_quota
    }
  }

  async linkWalletToUser(email: string, walletAddress: string): Promise<User> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `UPDATE users 
       SET wallet_address = $1, updated_at = NOW() 
       WHERE email = $2 
       RETURNING id, email, name, role, wallet_address, created_at, tier, plan_quota`,
      [walletAddress.toLowerCase(), email.toLowerCase()]
    )

    const row = rows[0]
    const user: User = {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      walletAddress: row.wallet_address,
      createdAt: row.created_at,
      tier: row.tier,
      planQuota: row.plan_quota
    }
    // Invalidate/Update
    await userCache.set(`id:${user.id}`, user)
    await userCache.set(`email:${user.email.toLowerCase()}`, user)
    return user
  }

  async updateName(userId: string, name: string): Promise<void> {
    const pool = await this.pool()
    await pool.query(
      `UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2`,
      [name, userId]
    )
    // Invalidate
    const user = await this.getById(userId)
    if (user) {
      await userCache.invalidate(`id:${userId}`)
      await userCache.invalidate(`email:${user.email.toLowerCase()}`)
    }
  }
}

export class PostgresSessionRepository {
  private async pool() {
    const pool = await getPool()
    if (!pool) {
      throw new Error('Database pool is not available (DATABASE_URL/pg not configured)')
    }
    return pool
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  async create(email: string, token: string, expiresAt?: Date, auditInfo?: { ip?: string; userAgent?: string }): Promise<void> {
    const pool = await this.pool()
    const tokenHash = this.hashToken(token)

    // Get user ID
    const userRepo = new PostgresUserRepository()
    const user = await userRepo.getByEmail(email)
    if (!user) {
      throw new Error('User not found')
    }

    const defaultExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    await pool.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at, created_ip, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [tokenHash, user.id, expiresAt || defaultExpiresAt, auditInfo?.ip, auditInfo?.userAgent]
    )
  }

  async getByToken(token: string): Promise<(Session & { userId: string }) | null> {
    const pool = await this.pool()
    const tokenHash = this.hashToken(token)

    const { rows } = await pool.query(
      `SELECT s.token_hash, s.created_at, s.user_id, u.email
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token_hash = $1 
         AND s.expires_at > NOW() 
         AND s.revoked_at IS NULL`,
      [tokenHash]
    )

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      token, // Return original token for compatibility
      email: row.email,
      createdAt: row.created_at,
      userId: row.user_id
    }
  }

  async revokeByToken(token: string): Promise<void> {
    const pool = await this.pool()
    const tokenHash = this.hashToken(token)

    await pool.query(
      `UPDATE sessions SET revoked_at = NOW() WHERE token_hash = $1`,
      [tokenHash]
    )
  }

  async revokeByUserId(userId: string): Promise<void> {
    const pool = await this.pool()

    await pool.query(
      `UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId]
    )
  }

  async cleanupExpired(): Promise<number> {
    const pool = await this.pool()
    const { rows } = await pool.query('SELECT cleanup_expired_sessions() as count')
    return rows[0].count
  }
}

export class PostgresOtpChallengeRepository {
  private async pool() {
    const pool = await getPool()
    if (!pool) {
      throw new Error('Database pool is not available (DATABASE_URL/pg not configured)')
    }
    return pool
  }

  async set(challenge: OtpChallenge, auditInfo?: { ip?: string; userAgent?: string }): Promise<void> {
    const pool = await this.pool()

    // Delete any existing challenge for this email
    await this.deleteByEmail(challenge.email)

    await pool.query(
      `INSERT INTO otp_challenges (email, otp_hash, salt, expires_at, attempts, created_ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        challenge.email.toLowerCase(),
        challenge.otpHash,
        challenge.salt,
        challenge.expiresAt,
        challenge.attempts,
        auditInfo?.ip,
        auditInfo?.userAgent
      ]
    )
  }

  async getByEmail(email: string): Promise<OtpChallenge | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `SELECT email, otp_hash, salt, expires_at, attempts 
       FROM otp_challenges 
       WHERE email = $1 AND expires_at > NOW()`,
      [email.toLowerCase()]
    )

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      email: row.email,
      otpHash: row.otp_hash,
      salt: row.salt,
      expiresAt: row.expires_at,
      attempts: row.attempts
    }
  }

  async updateAttempts(email: string, attempts: number): Promise<void> {
    const pool = await this.pool()

    await pool.query(
      `UPDATE otp_challenges SET attempts = $1 WHERE email = $2`,
      [attempts, email.toLowerCase()]
    )
  }

  async deleteByEmail(email: string): Promise<void> {
    const pool = await this.pool()

    await pool.query(
      `DELETE FROM otp_challenges WHERE email = $1`,
      [email.toLowerCase()]
    )
  }

  async cleanupExpired(): Promise<number> {
    const pool = await this.pool()
    const { rows } = await pool.query('SELECT cleanup_expired_challenges() as count')
    return rows[0].count
  }
}

export class PostgresWalletChallengeRepository {
  private async pool() {
    const pool = await getPool()
    if (!pool) {
      throw new Error('Database pool is not available (DATABASE_URL/pg not configured)')
    }
    return pool
  }

  async set(challenge: WalletChallenge, auditInfo?: { ip?: string; userAgent?: string }): Promise<void> {
    const pool = await this.pool()

    // Delete any existing challenge for this address
    await this.deleteByAddress(challenge.address)

    await pool.query(
      `INSERT INTO wallet_challenges (address, nonce, challenge_xdr, expires_at, attempts, created_ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        challenge.address.toLowerCase(),
        challenge.nonce,
        challenge.challengeXdr,
        challenge.expiresAt,
        challenge.attempts,
        auditInfo?.ip,
        auditInfo?.userAgent
      ]
    )
  }

  async getByAddress(address: string): Promise<WalletChallenge | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `SELECT address, nonce, challenge_xdr, expires_at, attempts 
       FROM wallet_challenges 
       WHERE address = $1 AND expires_at > NOW() AND used_at IS NULL`,
      [address.toLowerCase()]
    )

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      address: row.address,
      challengeXdr: row.challenge_xdr,
      nonce: row.nonce,
      expiresAt: row.expires_at,
      attempts: row.attempts
    }
  }

  async updateAttempts(address: string, attempts: number): Promise<void> {
    const pool = await this.pool()

    await pool.query(
      `UPDATE wallet_challenges SET attempts = $1 WHERE address = $2`,
      [attempts, address.toLowerCase()]
    )
  }

  async markAsUsed(address: string): Promise<void> {
    const pool = await this.pool()

    await pool.query(
      `UPDATE wallet_challenges SET used_at = NOW() WHERE address = $1`,
      [address.toLowerCase()]
    )
  }

  async deleteByAddress(address: string): Promise<void> {
    const pool = await this.pool()

    await pool.query(
      `DELETE FROM wallet_challenges WHERE address = $1`,
      [address.toLowerCase()]
    )
  }

  async cleanupExpired(): Promise<number> {
    const pool = await this.pool()
    const { rows } = await pool.query('SELECT cleanup_expired_challenges() as count')
    return rows[0].count
  }
}
