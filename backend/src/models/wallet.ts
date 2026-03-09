/**
 * Wallet model and types for custodial wallet implementation
 */

export interface Wallet {
  userId: string
  publicKey: string
  encryptedSecretKey: string // Base64 encoded encrypted secret
  keyId: string // Identifier for the encryption key used
  createdAt: Date
  updatedAt: Date
}

export interface CreateWalletInput {
  userId: string
  publicKey: string
  encryptedSecretKey: string
  keyId: string
}

export interface WalletStore {
  create(input: CreateWalletInput): Promise<Wallet>
  getByUserId(userId: string): Promise<Wallet | null>
  getPublicAddress(userId: string): Promise<string>
  getEncryptedKey(userId: string): Promise<{ cipherText: string; keyId: string } | null>
  listUserIdsByKeyId(
    keyId: string,
    limit: number,
    cursorUserId?: string,
  ): Promise<{ userIds: string[]; nextCursorUserId?: string }>
  updateEncryption(
    userId: string,
    newEncryptedSecretKey: string,
    newKeyId: string
  ): Promise<Wallet>
}
