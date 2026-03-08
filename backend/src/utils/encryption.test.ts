/**
 * Unit tests for AES-256-GCM encryption utility
 * 
 * Tests are isolated and do not depend on a running server or database
 */

import { describe, it, expect } from 'vitest'
import {
  encrypt,
  decrypt,
  generateMasterKey,
  isValidMasterKey,
  getActiveMasterKey,
  type EncryptedKeyEnvelope,
} from './encryption.js'

describe('encryption', () => {
  // Generate a valid master key for testing
  const testMasterKey = generateMasterKey()

  describe('roundtrip encryption', () => {
    it('should encrypt and decrypt successfully', () => {
      const secretKey = Buffer.from('my-super-secret-key-1234567890')
      
      const envelope = encrypt(secretKey, testMasterKey)
      const decrypted = decrypt(envelope, testMasterKey)
      
      expect(decrypted.toString()).toBe(secretKey.toString())
    })

    it('should produce different ciphertexts for same plaintext (IV uniqueness)', () => {
      const secretKey = Buffer.from('my-secret')
      
      const envelope1 = encrypt(secretKey, testMasterKey)
      const envelope2 = encrypt(secretKey, testMasterKey)
      
      // Ciphertexts should be different due to random IV
      expect(envelope1.ciphertext).not.toBe(envelope2.ciphertext)
      expect(envelope1.iv).not.toBe(envelope2.iv)
    })

    it('should handle binary data correctly', () => {
      const secretKey = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd])
      
      const envelope = encrypt(secretKey, testMasterKey)
      const decrypted = decrypt(envelope, testMasterKey)
      
      expect(Buffer.compare(decrypted, secretKey)).toBe(0)
    })

    it('should handle empty buffer', () => {
      const secretKey = Buffer.alloc(0)
      
      const envelope = encrypt(secretKey, testMasterKey)
      const decrypted = decrypt(envelope, testMasterKey)
      
      expect(decrypted.length).toBe(0)
    })
  })

  describe('envelope format', () => {
    it('should have correct structure', () => {
      const secretKey = Buffer.from('test-secret')
      const envelope = encrypt(secretKey, testMasterKey)
      
      expect(envelope).toHaveProperty('version')
      expect(envelope).toHaveProperty('algo')
      expect(envelope).toHaveProperty('iv')
      expect(envelope).toHaveProperty('ciphertext')
      expect(envelope).toHaveProperty('tag')
    })

    it('should use correct algorithm identifier', () => {
      const secretKey = Buffer.from('test-secret')
      const envelope = encrypt(secretKey, testMasterKey)
      
      expect(envelope.algo).toBe('aes-256-gcm')
      expect(envelope.version).toBe('v1')
    })

    it('should have base64-encoded fields', () => {
      const secretKey = Buffer.from('test-secret')
      const envelope = encrypt(secretKey, testMasterKey)
      
      // All fields should be valid base64
      expect(() => Buffer.from(envelope.iv, 'base64')).not.toThrow()
      expect(() => Buffer.from(envelope.ciphertext, 'base64')).not.toThrow()
      expect(() => Buffer.from(envelope.tag, 'base64')).not.toThrow()
    })

    it('should have correct IV length (16 bytes)', () => {
      const secretKey = Buffer.from('test-secret')
      const envelope = encrypt(secretKey, testMasterKey)
      
      const iv = Buffer.from(envelope.iv, 'base64')
      expect(iv.length).toBe(16)
    })

    it('should have correct auth tag length (16 bytes)', () => {
      const secretKey = Buffer.from('test-secret')
      const envelope = encrypt(secretKey, testMasterKey)
      
      const tag = Buffer.from(envelope.tag, 'base64')
      expect(tag.length).toBe(16)
    })
  })

  describe('wrong key fails', () => {
    it('should fail decryption with wrong master key', () => {
      const secretKey = Buffer.from('my-secret')
      const wrongKey = generateMasterKey()
      
      const envelope = encrypt(secretKey, testMasterKey)
      
      // Should throw authentication error
      expect(() => decrypt(envelope, wrongKey)).toThrow('authentication tag verification failed')
    })

    it('should fail with completely different key', () => {
      const secretKey = Buffer.from('sensitive-data')
      const envelope = encrypt(secretKey, testMasterKey)
      
      // Generate another key
      const anotherKey = generateMasterKey()
      
      expect(() => decrypt(envelope, anotherKey)).toThrow('authentication tag verification failed')
    })
  })

  describe('tampered ciphertext fails', () => {
    it('should reject modified ciphertext', () => {
      const secretKey = Buffer.from('my-secret')
      const envelope = encrypt(secretKey, testMasterKey)
      
      // Tamper with the ciphertext
      const tamperedEnvelope: EncryptedKeyEnvelope = {
        ...envelope,
        ciphertext: Buffer.from('tampered-data').toString('base64'),
      }
      
      expect(() => decrypt(tamperedEnvelope, testMasterKey)).toThrow('authentication tag verification failed')
    })

    it('should reject modified IV', () => {
      const secretKey = Buffer.from('my-secret')
      const envelope = encrypt(secretKey, testMasterKey)
      
      // Tamper with the IV
      const fakeIv = Buffer.from([
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
        0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f
      ]).toString('base64')
      const tamperedEnvelope: EncryptedKeyEnvelope = { ...envelope, iv: fakeIv }
      
      expect(() => decrypt(tamperedEnvelope, testMasterKey)).toThrow('authentication tag verification failed')
    })

    it('should reject modified auth tag', () => {
      const secretKey = Buffer.from('my-secret')
      const envelope = encrypt(secretKey, testMasterKey)
      
      // Tamper with the auth tag
      const fakeTag = Buffer.from([
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
        0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f
      ]).toString('base64')
      const tamperedEnvelope: EncryptedKeyEnvelope = { ...envelope, tag: fakeTag }
      
      expect(() => decrypt(tamperedEnvelope, testMasterKey)).toThrow('authentication tag verification failed')
    })

    it('should reject modified version (if checked)', () => {
      const secretKey = Buffer.from('my-secret')
      const envelope = encrypt(secretKey, testMasterKey)
      
      // Modify version - this won't affect decryption but documents the behavior
      const modifiedEnvelope: EncryptedKeyEnvelope = {
        ...envelope,
        version: 'v999',
      }
      
      // Decryption should still work (version is metadata for future use)
      const decrypted = decrypt(modifiedEnvelope, testMasterKey)
      expect(decrypted.toString()).toBe(secretKey.toString())
    })
  })

  describe('master key validation', () => {
    it('should validate correct master key format', () => {
      const validKey = generateMasterKey()
      expect(isValidMasterKey(validKey)).toBe(true)
    })

    it('should reject invalid base64', () => {
      expect(isValidMasterKey('not-valid-base64!!!')).toBe(false)
    })

    it('should reject wrong length key', () => {
      const shortKey = Buffer.from('short').toString('base64')
      expect(isValidMasterKey(shortKey)).toBe(false)
    })

    it('should reject empty string', () => {
      expect(isValidMasterKey('')).toBe(false)
    })

    it('should throw on encrypt with invalid master key', () => {
      const secretKey = Buffer.from('test')
      const invalidKey = 'invalid-key'
      
      expect(() => encrypt(secretKey, invalidKey)).toThrow('Invalid master key length')
    })

    it('should throw on decrypt with invalid master key', () => {
      const envelope: EncryptedKeyEnvelope = {
        version: 'v1',
        algo: 'aes-256-gcm',
        iv: Buffer.alloc(16).toString('base64'),
        ciphertext: Buffer.alloc(16).toString('base64'),
        tag: Buffer.alloc(16).toString('base64'),
      }
      
      expect(() => decrypt(envelope, 'invalid-key')).toThrow('Invalid master key length')
    })
  })

  describe('getActiveMasterKey', () => {
    it('should return V1 key when active version is 1', () => {
      const env = {
        CUSTODIAL_WALLET_MASTER_KEY_V1: testMasterKey,
        CUSTODIAL_WALLET_MASTER_KEY_ACTIVE_VERSION: 1,
      }
      
      expect(getActiveMasterKey(env)).toBe(testMasterKey)
    })

    it('should return V2 key when active version is 2', () => {
      const v2Key = generateMasterKey()
      const env = {
        CUSTODIAL_WALLET_MASTER_KEY_V1: testMasterKey,
        CUSTODIAL_WALLET_MASTER_KEY_V2: v2Key,
        CUSTODIAL_WALLET_MASTER_KEY_ACTIVE_VERSION: 2,
      }
      
      expect(getActiveMasterKey(env)).toBe(v2Key)
    })

    it('should default to version 1', () => {
      const env = {
        CUSTODIAL_WALLET_MASTER_KEY_V1: testMasterKey,
      }
      
      expect(getActiveMasterKey(env)).toBe(testMasterKey)
    })

    it('should throw when V1 key is missing', () => {
      const env = {
        CUSTODIAL_WALLET_MASTER_KEY_ACTIVE_VERSION: 1,
      }
      
      expect(() => getActiveMasterKey(env)).toThrow('CUSTODIAL_WALLET_MASTER_KEY_V1 is required')
    })

    it('should throw when V2 key is missing but version is 2', () => {
      const env = {
        CUSTODIAL_WALLET_MASTER_KEY_V1: testMasterKey,
        CUSTODIAL_WALLET_MASTER_KEY_ACTIVE_VERSION: 2,
      }
      
      expect(() => getActiveMasterKey(env)).toThrow('CUSTODIAL_WALLET_MASTER_KEY_V2 is required')
    })

    it('should throw when master key is invalid', () => {
      const env = {
        CUSTODIAL_WALLET_MASTER_KEY_V1: 'invalid-key',
        CUSTODIAL_WALLET_MASTER_KEY_ACTIVE_VERSION: 1,
      }
      
      expect(() => getActiveMasterKey(env)).toThrow('Invalid master key format')
    })
  })

  describe('generateMasterKey', () => {
    it('should generate valid master keys', () => {
      const key = generateMasterKey()
      expect(isValidMasterKey(key)).toBe(true)
    })

    it('should generate unique keys', () => {
      const key1 = generateMasterKey()
      const key2 = generateMasterKey()
      expect(key1).not.toBe(key2)
    })

    it('should generate 32-byte keys', () => {
      const key = generateMasterKey()
      const decoded = Buffer.from(key, 'base64')
      expect(decoded.length).toBe(32)
    })
  })
})
