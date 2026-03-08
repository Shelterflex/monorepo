import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto'
import { Keypair } from '@stellar/stellar-sdk'
import { WalletStore } from '../models/wallet.js'
import { CustodialWalletService } from './CustodialWalletService.js'

export interface EncryptionService {
  encrypt(data: Buffer, keyId: string): Promise<{ cipherText: Buffer; keyId: string }>
  decrypt(cipherText: Buffer, keyId: string): Promise<Buffer>
  getCurrentKeyId(): string
}

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
