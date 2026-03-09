import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto'
import { Keypair } from '@stellar/stellar-sdk'
import { WalletStore } from '../models/wallet.js'
import { CustodialWalletService } from './CustodialWalletService.js'

export interface EncryptionService {
  encrypt(data: Buffer, keyId: string): Promise<{ cipherText: Buffer; keyId: string }>
  decrypt(cipherText: Buffer, keyId: string): Promise<Buffer>
  getCurrentKeyId(): string
}

type Keyring = Record<string, string>

export interface WalletService {
  createWalletForUser(userId: string): Promise<{ publicKey: string }>
  getPublicAddress(userId: string): Promise<string>
  signMessage(userId: string, message: string): Promise<{ signature: string; publicKey: string }>
  signSorobanTransaction(userId: string, xdr: string): Promise<{ signature: string; publicKey: string }>
}

export class WalletServiceImpl implements WalletService {
  constructor(
    private walletStore: WalletStore,
    private encryptionService: EncryptionService,
    private custodialService: CustodialWalletService
  ) { }

  async createWalletForUser(userId: string): Promise<{ publicKey: string }> {
    // Check if wallet already exists
    const existing = await this.walletStore.getByUserId(userId)
    if (existing) {
      return { publicKey: existing.publicKey }
    }

    // Generate new Stellar keypair
    const keypair = Keypair.random()
    const secretKey = Buffer.from(keypair.secret(), 'utf8')
    const publicKey = keypair.publicKey()

    // Encrypt the secret key
    const keyId = this.encryptionService.getCurrentKeyId()
    const { cipherText } = await this.encryptionService.encrypt(secretKey, keyId)

    // Store the wallet
    await this.walletStore.create({
      userId,
      publicKey: publicKey,
      encryptedSecretKey: cipherText.toString('base64'),
      keyId,
    })

    return { publicKey }
  }

  async getPublicAddress(userId: string): Promise<string> {
    return this.walletStore.getPublicAddress(userId)
  }

  async signMessage(userId: string, message: string): Promise<{ signature: string; publicKey: string }> {
    return this.custodialService.signMessage(userId, message)
  }

  async signSorobanTransaction(userId: string, xdr: string): Promise<{ signature: string; publicKey: string }> {
    return this.custodialService.signTransaction(userId, xdr)
  }
}

export class KeyringEncryptionService implements EncryptionService {
  private readonly keyring: Keyring
  private readonly latestKeyId: string

  constructor(keys: Keyring) {
    const entries = Object.entries(keys).filter(([, v]) => typeof v === 'string' && v.length >= 32)
    if (entries.length === 0) {
      throw new Error('No encryption keys configured: set ENCRYPTION_KEY_V1, ENCRYPTION_KEY_V2, ...')
    }
    this.keyring = Object.fromEntries(entries)

    // Pick latest by numeric suffix, fall back to lexical.
    const ids = Object.keys(this.keyring)
    ids.sort((a, b) => {
      const na = parseInt(a.replace(/^ENCRYPTION_KEY_V/i, ''), 10)
      const nb = parseInt(b.replace(/^ENCRYPTION_KEY_V/i, ''), 10)
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
      return a.localeCompare(b)
    })
    this.latestKeyId = ids[ids.length - 1]
  }

  getCurrentKeyId(): string {
    return this.latestKeyId
  }

  private getKeyBaseForId(keyId: string): string {
    const keyBase = this.keyring[keyId]
    if (!keyBase) {
      throw new Error(`Unknown encryption key id: ${keyId}`)
    }
    if (keyBase.length < 32) {
      throw new Error(`Invalid encryption key for ${keyId}: must be at least 32 characters`)
    }
    return keyBase
  }

  private async deriveKey(encryptionKeyBase: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      scrypt(encryptionKeyBase, salt, 32, (err, derivedKey) => {
        if (err) reject(err)
        else resolve(derivedKey)
      })
    })
  }

  async encrypt(data: Buffer, keyId: string): Promise<{ cipherText: Buffer; keyId: string }> {
    const envelopeVersion = 1
    const iv = randomBytes(12)
    const encryptionKeyBase = this.getKeyBaseForId(keyId)
    const key = await this.deriveKey(encryptionKeyBase, Buffer.from(keyId, 'utf8'))

    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()])
    const authTag = cipher.getAuthTag()

    const envelope = {
      version: envelopeVersion,
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      ciphertext: encrypted.toString('base64'),
    }

    const cipherText = Buffer.from(JSON.stringify(envelope), 'utf8')
    return { cipherText, keyId }
  }

  async decrypt(cipherText: Buffer, keyId: string): Promise<Buffer> {
    let parsed: unknown
    try {
      parsed = JSON.parse(cipherText.toString('utf8'))
    } catch {
      throw new Error('Invalid ciphertext: not valid envelope JSON')
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('version' in parsed) ||
      !('iv' in parsed) ||
      !('authTag' in parsed) ||
      !('ciphertext' in parsed)
    ) {
      throw new Error('Invalid ciphertext: missing envelope fields')
    }

    const envelope = parsed as {
      version: number
      iv: string
      authTag: string
      ciphertext: string
    }

    if (envelope.version !== 1) {
      throw new Error(`Invalid ciphertext: unsupported envelope version ${String(envelope.version)}`)
    }

    const iv = Buffer.from(envelope.iv, 'base64')
    const tag = Buffer.from(envelope.authTag, 'base64')
    const encrypted = Buffer.from(envelope.ciphertext, 'base64')

    if (iv.length !== 12) {
      throw new Error('Invalid ciphertext: invalid IV length')
    }
    if (tag.length !== 16) {
      throw new Error('Invalid ciphertext: invalid authTag length')
    }

    const encryptionKeyBase = this.getKeyBaseForId(keyId)
    const key = await this.deriveKey(encryptionKeyBase, Buffer.from(keyId, 'utf8'))
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)

    try {
      return Buffer.concat([decipher.update(encrypted), decipher.final()])
    } catch {
      throw new Error('Decryption failed: authentication tag verification failed')
    }
  }
}

export function readEncryptionKeyringFromEnv(envObj: Record<string, string | undefined>): Keyring {
  const keyring: Keyring = {}
  for (const [k, v] of Object.entries(envObj)) {
    if (!k.startsWith('ENCRYPTION_KEY_V')) continue
    if (!v) continue
    keyring[k] = v
  }
  return keyring
}

/**
 * Environment-based encryption service for MVP
 * Uses scrypt with environment variable to derive encryption keys
 */
export class EnvironmentEncryptionService implements EncryptionService {
  constructor(private encryptionKeyBase: string) {
    if (!encryptionKeyBase || encryptionKeyBase.length < 32) {
      throw new Error('Encryption key must be at least 32 characters')
    }
  }

  getCurrentKeyId(): string {
    // For MVP, we use a single key ID
    // In production, this should support key rotation
    return 'env-key-1'
  }

  private async deriveKey(salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      scrypt(this.encryptionKeyBase, salt, 32, (err, derivedKey) => {
        if (err) reject(err)
        else resolve(derivedKey)
      })
    })
  }

  async encrypt(data: Buffer, keyId: string): Promise<{ cipherText: Buffer; keyId: string }> {
    const envelopeVersion = 1
    const iv = randomBytes(12)
    const key = await this.deriveKey(Buffer.from(keyId, 'utf8'))

    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()])
    const authTag = cipher.getAuthTag()

    const envelope = {
      version: envelopeVersion,
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      ciphertext: encrypted.toString('base64'),
    }

    const cipherText = Buffer.from(JSON.stringify(envelope), 'utf8')
    return { cipherText, keyId }
  }

  async decrypt(cipherText: Buffer, keyId: string): Promise<Buffer> {
    let parsed: unknown
    try {
      parsed = JSON.parse(cipherText.toString('utf8'))
    } catch {
      throw new Error('Invalid ciphertext: not valid envelope JSON')
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('version' in parsed) ||
      !('iv' in parsed) ||
      !('authTag' in parsed) ||
      !('ciphertext' in parsed)
    ) {
      throw new Error('Invalid ciphertext: missing envelope fields')
    }

    const envelope = parsed as {
      version: number
      iv: string
      authTag: string
      ciphertext: string
    }

    if (envelope.version !== 1) {
      throw new Error(`Invalid ciphertext: unsupported envelope version ${String(envelope.version)}`)
    }

    const iv = Buffer.from(envelope.iv, 'base64')
    const tag = Buffer.from(envelope.authTag, 'base64')
    const encrypted = Buffer.from(envelope.ciphertext, 'base64')

    if (iv.length !== 12) {
      throw new Error('Invalid ciphertext: invalid IV length')
    }
    if (tag.length !== 16) {
      throw new Error('Invalid ciphertext: invalid authTag length')
    }

    const key = await this.deriveKey(Buffer.from(keyId, 'utf8'))
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)

    try {
      return Buffer.concat([decipher.update(encrypted), decipher.final()])
    } catch {
      throw new Error('Decryption failed: authentication tag verification failed')
    }
  }
}
