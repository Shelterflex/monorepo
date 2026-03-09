import { Wallet, CreateWalletInput, WalletStore } from '../models/wallet.js'
import { getPool } from '../db.js'

/**
 * In-memory implementation of WalletStore for MVP development
 * In production, this should be replaced with a database implementation
 */
export class InMemoryWalletStore implements WalletStore {
  private wallets: Map<string, Wallet> = new Map()

  async create(input: CreateWalletInput): Promise<Wallet> {
    // Check if wallet already exists for this user
    if (this.wallets.has(input.userId)) {
      throw new Error(`Wallet already exists for user ${input.userId}`)
    }

    const wallet: Wallet = {
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    this.wallets.set(input.userId, wallet)
    return wallet
  }

  async getByUserId(userId: string): Promise<Wallet | null> {
    return this.wallets.get(userId) || null
  }

  async getPublicAddress(userId: string): Promise<string> {
    const wallet = this.wallets.get(userId)
    if (!wallet) {
      throw new Error(`Wallet not found for user ${userId}`)
    }
    return wallet.publicKey
  }

  async getEncryptedKey(userId: string): Promise<{ cipherText: string; keyId: string } | null> {
    const wallet = this.wallets.get(userId)
    if (!wallet) {
      return null
    }
    return {
      cipherText: wallet.encryptedSecretKey,
      keyId: wallet.keyId,
    }
  }

  async listUserIdsByKeyId(
    keyId: string,
    limit: number,
    cursorUserId?: string,
  ): Promise<{ userIds: string[]; nextCursorUserId?: string }> {
    const ids = Array.from(this.wallets.values())
      .filter((w) => w.keyId === keyId)
      .map((w) => w.userId)
      .sort((a, b) => a.localeCompare(b))

    const startIndex = cursorUserId ? ids.findIndex((id) => id > cursorUserId) : 0
    const start = startIndex < 0 ? ids.length : startIndex
    const slice = ids.slice(start, start + limit)
    const nextCursorUserId = slice.length === limit ? slice[slice.length - 1] : undefined
    return { userIds: slice, nextCursorUserId }
  }

  async updateEncryption(
    userId: string,
    newEncryptedSecretKey: string,
    newKeyId: string
  ): Promise<Wallet> {
    const wallet = this.wallets.get(userId)
    if (!wallet) {
      throw new Error(`Wallet not found for user ${userId}`)
    }

    const updatedWallet: Wallet = {
      ...wallet,
      encryptedSecretKey: newEncryptedSecretKey,
      keyId: newKeyId,
      updatedAt: new Date(),
    }

    this.wallets.set(userId, updatedWallet)
    return updatedWallet
  }

  // Helper method for testing/cleanup
  clear(): void {
    this.wallets.clear()
  }

  // Helper method to get all wallets (for testing)
  getAll(): Wallet[] {
    return Array.from(this.wallets.values())
  }
}

export class PostgresWalletStore implements WalletStore {
  private async pool() {
    const pool = await getPool()
    if (!pool) {
      throw new Error('Database pool is not available (DATABASE_URL/pg not configured)')
    }
    return pool
  }

  private mapRow(row: any): Wallet {
    return {
      userId: String(row.user_id),
      publicKey: String(row.public_key),
      encryptedSecretKey: String(row.encrypted_secret_key),
      keyId: String(row.key_id),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }
  }

  async create(input: CreateWalletInput): Promise<Wallet> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `INSERT INTO wallets (user_id, public_key, encrypted_secret_key, key_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO NOTHING
       RETURNING *`,
      [input.userId, input.publicKey, input.encryptedSecretKey, input.keyId],
    )

    const row = rows[0]
    if (!row) {
      throw new Error(`Wallet already exists for user ${input.userId}`)
    }
    return this.mapRow(row)
  }

  async getByUserId(userId: string): Promise<Wallet | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `SELECT * FROM wallets WHERE user_id = $1`,
      [userId],
    )
    const row = rows[0]
    return row ? this.mapRow(row) : null
  }

  async getPublicAddress(userId: string): Promise<string> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `SELECT public_key FROM wallets WHERE user_id = $1`,
      [userId],
    )
    const row = rows[0]
    if (!row) {
      throw new Error(`Wallet not found for user ${userId}`)
    }
    return String(row.public_key)
  }

  async getEncryptedKey(userId: string): Promise<{ cipherText: string; keyId: string } | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `SELECT encrypted_secret_key, key_id FROM wallets WHERE user_id = $1`,
      [userId],
    )
    const row = rows[0]
    if (!row) return null
    return {
      cipherText: String(row.encrypted_secret_key),
      keyId: String(row.key_id),
    }
  }

  async listUserIdsByKeyId(
    keyId: string,
    limit: number,
    cursorUserId?: string,
  ): Promise<{ userIds: string[]; nextCursorUserId?: string }> {
    const pool = await this.pool()
    const effectiveLimit = Math.max(1, Math.min(1000, limit))

    const values: any[] = [keyId, effectiveLimit]
    let cursorSql = ''
    if (cursorUserId) {
      values.push(cursorUserId)
      cursorSql = ' AND user_id > $3'
    }

    const { rows } = await pool.query(
      `SELECT user_id
       FROM wallets
       WHERE key_id = $1${cursorSql}
       ORDER BY user_id ASC
       LIMIT $2`,
      values,
    )

    const userIds = rows.map((r: any) => String(r.user_id))
    const nextCursorUserId = userIds.length === effectiveLimit ? userIds[userIds.length - 1] : undefined
    return { userIds, nextCursorUserId }
  }

  async updateEncryption(
    userId: string,
    newEncryptedSecretKey: string,
    newKeyId: string
  ): Promise<Wallet> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `UPDATE wallets
       SET encrypted_secret_key=$2,
           key_id=$3,
           updated_at=NOW()
       WHERE user_id=$1
       RETURNING *`,
      [userId, newEncryptedSecretKey, newKeyId],
    )
    const row = rows[0]
    if (!row) {
      throw new Error(`Wallet not found for user ${userId}`)
    }
    return this.mapRow(row)
  }
}
