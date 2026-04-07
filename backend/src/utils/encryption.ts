/**
 * AES-256-GCM Encryption Utility for Custodial Wallet Secret Keys
 * 
 * This module provides envelope encryption for wallet secret keys using AES-256-GCM.
 * The envelope format supports future KMS/HSM upgrade paths through versioning.
 * 
 * Security Notes:
 * - NEVER log the raw secret key at any point
 * - Master keys are base64-encoded 32-byte AES-256 keys
 * - Each encryption uses a unique 16-byte IV (initialization vector)
 * - GCM provides authenticated encryption (confidentiality + integrity)
 * 
 * Envelope Format:
 * {
 *   version: string      // Encryption version (e.g., "v1") for future KMS/HSM upgrades
 *   algo: string         // Algorithm identifier (e.g., "aes-256-gcm")
 *   iv: string           // Base64-encoded 16-byte initialization vector
 *   ciphertext: string   // Base64-encoded encrypted secret key
 *   tag: string          // Base64-encoded 16-byte GCM authentication tag
 * }
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const TAG_LENGTH = 16
const KEY_LENGTH = 32
const CURRENT_VERSION = 'v1'

/**
 * Encrypted key envelope structure
 * This format allows for future KMS/HSM integration by versioning
 */
export interface EncryptedKeyEnvelope {
  /** Version for future KMS/HSM upgrade path */
  version: string
  /** Algorithm identifier */
  algo: string
  /** Base64-encoded initialization vector */
  iv: string
  /** Base64-encoded encrypted secret */
  ciphertext: string
  /** Base64-encoded GCM authentication tag */
  tag: string
}

/**
 * Encrypts a secret key using AES-256-GCM
 * 
 * @param secretKey - The raw secret key buffer to encrypt
 * @param masterKey - Base64-encoded 32-byte AES-256 master key
 * @returns EncryptedKeyEnvelope containing the encrypted data and metadata
 * @throws Error if encryption fails
 * 
 * SECURITY: Never log the secretKey parameter
 */
export function encrypt(secretKey: Buffer, masterKey: string): EncryptedKeyEnvelope {
  // Decode master key from base64
  const key = Buffer.from(masterKey, 'base64')
  if (key.length !== KEY_LENGTH) {
    throw new Error(`Invalid master key length: expected ${KEY_LENGTH} bytes, got ${key.length}`)
  }

  // Generate cryptographically secure random IV
  const iv = randomBytes(IV_LENGTH)

  // Create cipher
  const cipher = createCipheriv(ALGORITHM, key, iv)

  // Encrypt the secret key
  const encrypted = Buffer.concat([cipher.update(secretKey), cipher.final()])

  // Get authentication tag
  const tag = cipher.getAuthTag()

  // Return envelope format
  return {
    version: CURRENT_VERSION,
    algo: ALGORITHM,
    iv: iv.toString('base64'),
    ciphertext: encrypted.toString('base64'),
    tag: tag.toString('base64'),
  }
}

/**
 * Decrypts an encrypted key envelope using AES-256-GCM
 * 
 * @param envelope - The EncryptedKeyEnvelope containing encrypted data
 * @param masterKey - Base64-encoded 32-byte AES-256 master key
 * @returns Buffer containing the decrypted secret key
 * @throws Error if decryption fails or authentication tag verification fails
 * 
 * SECURITY: Never log the returned buffer
 */
export function decrypt(envelope: EncryptedKeyEnvelope, masterKey: string): Buffer {
  // Decode master key from base64
  const key = Buffer.from(masterKey, 'base64')
  if (key.length !== KEY_LENGTH) {
    throw new Error(`Invalid master key length: expected ${KEY_LENGTH} bytes, got ${key.length}`)
  }

  // Decode envelope components
  const iv = Buffer.from(envelope.iv, 'base64')
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64')
  const tag = Buffer.from(envelope.tag, 'base64')

  // Validate component lengths
  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length: expected ${IV_LENGTH} bytes, got ${iv.length}`)
  }
  if (tag.length !== TAG_LENGTH) {
    throw new Error(`Invalid auth tag length: expected ${TAG_LENGTH} bytes, got ${tag.length}`)
  }

  // Create decipher
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)

  // Decrypt
  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return decrypted
  } catch (error) {
    const cause = error instanceof Error ? error : undefined
    throw new Error('Decryption failed: authentication tag verification failed', { cause })
  }
}

/**
 * Generates a new random master key suitable for AES-256-GCM encryption
 * 
 * @returns Base64-encoded 32-byte random key
 */
export function generateMasterKey(): string {
  return randomBytes(KEY_LENGTH).toString('base64')
}

/**
 * Validates that a master key is properly formatted
 * 
 * @param masterKey - The base64-encoded master key to validate
 * @returns true if valid, false otherwise
 */
export function isValidMasterKey(masterKey: string): boolean {
  try {
    const key = Buffer.from(masterKey, 'base64')
    return key.length === KEY_LENGTH
  } catch {
    return false
  }
}

/**
 * Gets the active master key from environment configuration
 * 
 * @param env - Environment variables object
 * @returns The active master key string
 * @throws Error if the active key is not configured or invalid
 */
export function getActiveMasterKey(env: {
  CUSTODIAL_WALLET_MASTER_KEY_V1?: string
  CUSTODIAL_WALLET_MASTER_KEY_V2?: string
  CUSTODIAL_WALLET_MASTER_KEY_ACTIVE_VERSION?: string | number
}): string {
  const activeVersion = Number.parseInt(String(env.CUSTODIAL_WALLET_MASTER_KEY_ACTIVE_VERSION ?? '1'), 10)
  
  const keyVar = activeVersion === 2 
    ? 'CUSTODIAL_WALLET_MASTER_KEY_V2' 
    : 'CUSTODIAL_WALLET_MASTER_KEY_V1'
  
  const masterKey = activeVersion === 2 
    ? env.CUSTODIAL_WALLET_MASTER_KEY_V2 
    : env.CUSTODIAL_WALLET_MASTER_KEY_V1

  if (!masterKey) {
    throw new Error(
      `Custodial wallet master key not configured: ${keyVar} is required ` +
      `(active version: ${activeVersion}). Set CUSTODIAL_WALLET_MASTER_KEY_ACTIVE_VERSION ` +
      `to 1 or 2, and provide the corresponding master key.`
    )
  }

  if (!isValidMasterKey(masterKey)) {
    throw new Error(
      `Invalid master key format for ${keyVar}: must be base64-encoded ${KEY_LENGTH}-byte string. ` +
      `Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
    )
  }

  return masterKey
}
