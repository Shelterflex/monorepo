import { createHash } from 'node:crypto'
import { getPool } from '../db.js'
import { userCache } from '../utils/cache.js'

export type UserRole = 'tenant' | 'landlord' | 'agent'
export type DisplayCurrency = 'NGN' | 'USDC'

export interface User {
  id: string
  email: string
  createdAt: Date
  name: string
  role: UserRole
  walletAddress?: string
  tier: 'free' | 'pro' | 'enterprise'
  planQuota: number
  displayCurrency: DisplayCurrency
}

export interface LandlordProfile {
  userId: string
  phone?: string
  address?: string
  companyName?: string
  bankName?: string
  accountNumber?: string
  accountName?: string
  verificationLevel?: 'unverified' | 'id_verified' | 'id_and_property_verified' | 'premium'
  verifiedAt?: Date | null
  notificationPreferences: {
    newInquiries: boolean
    paymentUpdates: boolean
    propertyViews: boolean
    marketingTips: boolean
  }
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

export interface ActiveSession {
  id: string
  family: string | null
  createdAt: Date
  lastActiveAt: Date
  expiresAt: Date
  ip: string | null
  userAgent: string | null
  current: boolean
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
      `SELECT id, email, name, role, wallet_address, created_at, tier, plan_quota, display_currency 
       FROM users WHERE email = $1 AND deleted_at IS NULL`,
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
      planQuota: row.plan_quota,
      displayCurrency: row.display_currency ?? 'NGN',
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
      `SELECT id, email, name, role, wallet_address, created_at, tier, plan_quota, display_currency 
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
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
      planQuota: row.plan_quota,
      displayCurrency: row.display_currency ?? 'NGN',
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
       RETURNING id, email, name, role, wallet_address, created_at, tier, plan_quota, display_currency`,
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
      planQuota: row.plan_quota,
      displayCurrency: row.display_currency ?? 'NGN',
    }
  }

  async updateDisplayCurrency(email: string, displayCurrency: DisplayCurrency): Promise<User> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `UPDATE users SET display_currency = $1, updated_at = NOW()
       WHERE email = $2 AND deleted_at IS NULL
       RETURNING id, email, name, role, wallet_address, created_at, tier, plan_quota, display_currency`,
      [displayCurrency, email.toLowerCase()],
    )
    if (rows.length === 0) {
      throw new Error('User not found')
    }
    const row = rows[0]
    const user: User = {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      walletAddress: row.wallet_address,
      createdAt: row.created_at,
      tier: row.tier,
      planQuota: row.plan_quota,
      displayCurrency: row.display_currency,
    }
    await userCache.invalidate(`email:${email.toLowerCase()}`)
    await userCache.invalidate(`id:${user.id}`)
    return user
  }

  async getByWalletAddress(address: string): Promise<User | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `SELECT id, email, name, role, wallet_address, created_at, tier, plan_quota, display_currency 
       FROM users WHERE wallet_address = $1 AND deleted_at IS NULL`,
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
      planQuota: row.plan_quota,
      displayCurrency: row.display_currency ?? 'NGN',
    }
  }

  async linkWalletToUser(email: string, walletAddress: string): Promise<User> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `UPDATE users 
       SET wallet_address = $1, updated_at = NOW() 
       WHERE email = $2 
       RETURNING id, email, name, role, wallet_address, created_at, tier, plan_quota, display_currency`,
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
      planQuota: row.plan_quota,
      displayCurrency: row.display_currency ?? 'NGN',
    }
    // Invalidate/Update
    await userCache.set(`id:${user.id}`, user)
    await userCache.set(`email:${user.email.toLowerCase()}`, user)
    return user
  }

  /** Erases personal fields and deactivates the row. The placeholder email keeps the unique constraint satisfied. */
  async anonymize(userId: string, placeholderEmail: string): Promise<void> {
    const pool = await this.pool()
    await pool.query(
      `UPDATE users
       SET email = $2, name = 'Erased user', deactivated_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [userId, placeholderEmail]
    )
  }

  async updateName(userId: string, name: string): Promise<void> {
    const pool = await this.pool()
    await pool.query(
      `UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL`,
      [name, userId]
    )
    // Invalidate
    const user = await this.getById(userId)
    if (user) {
      await userCache.invalidate(`id:${userId}`)
      await userCache.invalidate(`email:${user.email.toLowerCase()}`)
    }
  }

  async getLandlordProfile(userId: string): Promise<LandlordProfile | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `SELECT * FROM landlord_profiles WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId]
    )

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      userId: row.user_id,
      phone: row.phone,
      address: row.address,
      companyName: row.company_name,
      bankName: row.bank_name,
      accountNumber: row.account_number,
      accountName: row.account_name,
      notificationPreferences: row.notification_preferences
    }
  }

  async updateLandlordProfile(userId: string, profile: Partial<LandlordProfile>): Promise<void> {
    const pool = await this.pool()
    const existing = await this.getLandlordProfile(userId)

    if (!existing) {
      // Create new profile with defaults
      const prefs = profile.notificationPreferences || {
        newInquiries: true,
        paymentUpdates: true,
        propertyViews: false,
        marketingTips: false
      }
      await pool.query(
        `INSERT INTO landlord_profiles (
          user_id, phone, address, company_name, bank_name, account_number, account_name, notification_preferences
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          userId,
          profile.phone ?? null,
          profile.address ?? null,
          profile.companyName ?? null,
          profile.bankName ?? null,
          profile.accountNumber ?? null,
          profile.accountName ?? null,
          JSON.stringify(prefs)
        ]
      )
    } else {
      // Update existing
      const fields: string[] = []
      const values: any[] = []
      let i = 1

      if (profile.phone !== undefined) { fields.push(`phone = $${i++}`); values.push(profile.phone) }
      if (profile.address !== undefined) { fields.push(`address = $${i++}`); values.push(profile.address) }
      if (profile.companyName !== undefined) { fields.push(`company_name = $${i++}`); values.push(profile.companyName) }
      if (profile.bankName !== undefined) { fields.push(`bank_name = $${i++}`); values.push(profile.bankName) }
      if (profile.accountNumber !== undefined) { fields.push(`account_number = $${i++}`); values.push(profile.accountNumber) }
      if (profile.accountName !== undefined) { fields.push(`account_name = $${i++}`); values.push(profile.accountName) }
      if (profile.notificationPreferences !== undefined) { 
        fields.push(`notification_preferences = $${i++}`); 
        values.push(JSON.stringify(profile.notificationPreferences)) 
      }

      if (fields.length > 0) {
        values.push(userId)
        await pool.query(
          `UPDATE landlord_profiles SET ${fields.join(', ')}, updated_at = NOW() WHERE user_id = $${i}`,
          values
        )
      }
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

  async create(
    email: string,
    token: string,
    expiresAt?: Date,
    auditInfo?: { ip?: string; userAgent?: string },
    link?: { id?: string; family?: string },
  ): Promise<void> {
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
      `INSERT INTO sessions (id, token_hash, user_id, expires_at, created_ip, user_agent, family)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7)`,
      [link?.id ?? null, tokenHash, user.id, expiresAt || defaultExpiresAt, auditInfo?.ip, auditInfo?.userAgent, link?.family ?? null]
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
          AND s.deleted_at IS NULL
          AND u.deleted_at IS NULL 
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

  async getTokenState(token: string): Promise<'active' | 'expired' | 'invalid'> {
    const pool = await this.pool()
    const tokenHash = this.hashToken(token)

    const { rows } = await pool.query(
      `SELECT expires_at, revoked_at
       FROM sessions
       WHERE token_hash = $1
         AND deleted_at IS NULL`,
      [tokenHash],
    )

    if (rows.length === 0 || rows[0].revoked_at) return 'invalid'
    return new Date(rows[0].expires_at).getTime() < Date.now() ? 'expired' : 'active'
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

  /**
   * Active (unrevoked, unexpired) sessions for a user. Sessions that share a
   * refresh-token family are one device: only the newest is returned.
   * `current` is true for the device that owns `currentToken`.
   */
  async listActiveSessions(userId: string, currentToken?: string): Promise<ActiveSession[]> {
    const pool = await this.pool()
    const currentHash = currentToken ? this.hashToken(currentToken) : null
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (COALESCE(s.family, s.id::text))
              s.id, s.family, s.created_at, s.last_active_at, s.expires_at, s.created_ip, s.user_agent,
              EXISTS (
                SELECT 1 FROM sessions c
                WHERE c.token_hash = $2
                  AND c.user_id = s.user_id
                  AND (c.id = s.id OR (c.family IS NOT NULL AND c.family = s.family))
              ) AS current
       FROM sessions s
       WHERE s.user_id = $1
         AND s.revoked_at IS NULL
         AND s.forced_logout_at IS NULL
         AND s.deleted_at IS NULL
         AND s.expires_at > NOW()
       ORDER BY COALESCE(s.family, s.id::text), s.created_at DESC`,
      [userId, currentHash],
    )
    return rows
      .map((row: any) => ({
        id: row.id,
        family: row.family ?? null,
        createdAt: row.created_at,
        lastActiveAt: row.last_active_at,
        expiresAt: row.expires_at,
        ip: row.created_ip ?? null,
        userAgent: row.user_agent ?? null,
        current: Boolean(row.current),
      }))
      .sort((a: ActiveSession, b: ActiveSession) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime())
  }

  /**
   * Revoke one of the user's sessions (and every session in its refresh family).
   * Returns the affected refresh families, or null if the session is not the user's.
   */
  async revokeSession(userId: string, sessionId: string): Promise<{ families: string[] } | null> {
    const pool = await this.pool()
    const { rows: owned } = await pool.query(
      `SELECT family FROM sessions WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [sessionId, userId],
    )
    if (owned.length === 0) return null

    const family: string | null = owned[0].family ?? null
    await pool.query(
      `UPDATE sessions SET revoked_at = NOW()
       WHERE user_id = $1 AND revoked_at IS NULL AND (id = $2 OR ($3::text IS NOT NULL AND family = $3))`,
      [userId, sessionId, family],
    )
    return { families: family ? [family] : [] }
  }

  /**
   * Revoke all of a user's sessions, optionally sparing the device owning
   * `exceptSessionId`. Returns the revoked count and affected refresh families.
   */
  async revokeAllSessions(
    userId: string,
    options: { exceptSessionId?: string } = {},
  ): Promise<{ count: number; families: string[] }> {
    const pool = await this.pool()
    const except = options.exceptSessionId ?? null
    const { rows } = await pool.query(
      `UPDATE sessions SET revoked_at = NOW(), forced_logout_at = NOW()
       WHERE user_id = $1
         AND revoked_at IS NULL
         AND deleted_at IS NULL
         AND (
           $2::uuid IS NULL
           OR (
             id <> $2::uuid
             AND (family IS NULL OR family IS DISTINCT FROM (SELECT family FROM sessions WHERE id = $2::uuid))
           )
         )
       RETURNING family`,
      [userId, except],
    )
    const families = [...new Set(rows.map((r: any) => r.family).filter(Boolean))] as string[]
    return { count: rows.length, families }
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
       WHERE email = $1 AND expires_at > NOW() AND deleted_at IS NULL`,
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
      `UPDATE otp_challenges SET attempts = $1 WHERE email = $2 AND deleted_at IS NULL`,
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
       WHERE address = $1 AND expires_at > NOW() AND used_at IS NULL AND deleted_at IS NULL`,
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
      `UPDATE wallet_challenges SET attempts = $1 WHERE address = $2 AND deleted_at IS NULL`,
      [attempts, address.toLowerCase()]
    )
  }

  async markAsUsed(address: string): Promise<void> {
    const pool = await this.pool()

    await pool.query(
      `UPDATE wallet_challenges SET used_at = NOW() WHERE address = $1 AND deleted_at IS NULL`,
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
