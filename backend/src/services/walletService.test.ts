import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WalletServiceImpl, EnvironmentEncryptionService } from './walletService.js'
import { type CustodialWalletService } from './CustodialWalletService.js'
import { InMemoryWalletStore } from '../models/walletStore.js'
import { Keypair } from '@stellar/stellar-sdk'

describe('WalletService', () => {
  let walletService: WalletServiceImpl
  let walletStore: InMemoryWalletStore
  let encryptionService: EnvironmentEncryptionService

  beforeEach(() => {
    walletStore = new InMemoryWalletStore()
    encryptionService = new EnvironmentEncryptionService('test-encryption-key-32-chars-long-123456')

    // Mock custodial service for legacy tests
    const custodialService: CustodialWalletService = {
      signMessage: vi.fn(async (userId, msg) => {
        if (userId === 'non-existent-user') throw new Error('No wallet found')
        return { signature: 'mock-sig', publicKey: 'GDHD3Y2D3Y2D3Y2D3Y2D3Y2D3Y2D3Y2D3Y2D3Y2D3Y2D3Y2D3Y2D3Y2D' }
      }),
      signTransaction: vi.fn(async (userId, xdr) => {
        if (userId === 'non-existent-user') throw new Error('No wallet found')
        return { signature: 'mock-sig', publicKey: 'GDHD3Y2D3Y2D3Y2D3Y2D3Y2D3Y2D3Y2D3Y2D3Y2D3Y2D3Y2D3Y2D3Y2D' }
      })
    }

    walletService = new WalletServiceImpl(walletStore, encryptionService, custodialService)
  })

  describe('createWalletForUser', () => {
    it('should create a new wallet for a user', async () => {
      const userId = 'user-123'
      const result = await walletService.createWalletForUser(userId)

      expect(result.publicKey).toMatch(/^G[A-Z0-9]{55}$/)

      const wallet = await walletStore.getByUserId(userId)
      expect(wallet).toBeTruthy()
      expect(wallet!.userId).toBe(userId)
      expect(wallet!.publicKey).toBe(result.publicKey)
      expect(wallet!.encryptedSecretKey).toBeTruthy()
      expect(wallet!.keyId).toBe('env-key-1')
    })

    it('should return existing wallet if already exists', async () => {
      const userId = 'user-123'
      const firstResult = await walletService.createWalletForUser(userId)
      const secondResult = await walletService.createWalletForUser(userId)

      expect(firstResult.publicKey).toBe(secondResult.publicKey)

      const wallets = walletStore.getAll()
      expect(wallets).toHaveLength(1)
    })

    it('should generate unique addresses for different users', async () => {
      const user1 = 'user-1'
      const user2 = 'user-2'

      const result1 = await walletService.createWalletForUser(user1)
      const result2 = await walletService.createWalletForUser(user2)

      expect(result1.publicKey).not.toBe(result2.publicKey)
    })
  })

  describe('getPublicAddress', () => {
    it('should return public address for existing user', async () => {
      const userId = 'user-123'
      const { publicKey } = await walletService.createWalletForUser(userId)

      const address = await walletService.getPublicAddress(userId)
      expect(address).toBe(publicKey)
    })

    it('should throw error for non-existent user', async () => {
      const userId = 'non-existent-user'

      await expect(walletService.getPublicAddress(userId)).rejects.toThrow('Wallet not found')
    })
  })

  describe('signMessage', () => {
    it('should sign message with user private key', async () => {
      const userId = 'user-123'
      await walletService.createWalletForUser(userId)

      const message = 'Hello, Stellar!'
      const result = await walletService.signMessage(userId, message)

      expect(result.signature).toBeTruthy()
      expect(result.publicKey).toMatch(/^G[A-Z0-9]{55}$/)
      expect(typeof result.signature).toBe('string')
    })

    it('should throw error for non-existent user', async () => {
      const userId = 'non-existent-user'

      await expect(walletService.signMessage(userId, 'test')).rejects.toThrow('No wallet found')
    })
  })

  describe('signSorobanTransaction', () => {
    it('should sign Soroban transaction with user private key', async () => {
      const userId = 'user-123'
      await walletService.createWalletForUser(userId)

      const xdr = 'AAAAAgAAAABex1gJFQYAAAAA'
      const result = await walletService.signSorobanTransaction(userId, xdr)

      expect(result.signature).toBeTruthy()
      expect(result.publicKey).toMatch(/^G[A-Z0-9]{55}$/)
      expect(typeof result.signature).toBe('string')
    })

    it('should throw error for non-existent user', async () => {
      const userId = 'non-existent-user'

      await expect(walletService.signSorobanTransaction(userId, 'test-xdr')).rejects.toThrow('No wallet found')
    })
  })
})

describe('EnvironmentEncryptionService', () => {
  let encryptionService: EnvironmentEncryptionService

  beforeEach(() => {
    encryptionService = new EnvironmentEncryptionService('test-encryption-key-32-chars-long-123456')
  })

  it('should encrypt and decrypt data correctly', async () => {
    const originalData = Buffer.from('secret-key-data', 'utf8')
    const keyId = encryptionService.getCurrentKeyId()

    const { cipherText } = await encryptionService.encrypt(originalData, keyId)
    const decryptedData = await encryptionService.decrypt(cipherText, keyId)

    expect(decryptedData.toString('utf8')).toBe(originalData.toString('utf8'))
    expect(cipherText).not.toEqual(originalData)
  })

  it('should fail to decrypt when ciphertext is tampered with', async () => {
    const originalData = Buffer.from('secret-key-data', 'utf8')
    const keyId = encryptionService.getCurrentKeyId()

    const { cipherText } = await encryptionService.encrypt(originalData, keyId)
    const parsed = JSON.parse(cipherText.toString('utf8')) as {
      version: number
      iv: string
      authTag: string
      ciphertext: string
    }

    const ct = Buffer.from(parsed.ciphertext, 'base64')
    ct[0] = ct[0] ^ 0x01
    parsed.ciphertext = ct.toString('base64')
    const tampered = Buffer.from(JSON.stringify(parsed), 'utf8')

    await expect(encryptionService.decrypt(tampered, keyId)).rejects.toThrow(
      'Decryption failed: authentication tag verification failed'
    )
  })

  it('should throw error with short encryption key', () => {
    expect(() => new EnvironmentEncryptionService('short')).toThrow('Encryption key must be at least 32 characters')
  })

  it('should return consistent key ID', () => {
    const keyId1 = encryptionService.getCurrentKeyId()
    const keyId2 = encryptionService.getCurrentKeyId()
    expect(keyId1).toBe(keyId2)
    expect(keyId1).toBe('env-key-1')
  })

  it('should fail to decrypt with invalid ciphertext', async () => {
    const invalidCipherText = Buffer.from('too-short')
    const keyId = encryptionService.getCurrentKeyId()

    await expect(encryptionService.decrypt(invalidCipherText, keyId)).rejects.toThrow('Invalid ciphertext')
  })
})
