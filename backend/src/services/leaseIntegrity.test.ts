import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkDocumentIntegrity,
  documentVersionFromKey,
  hashStoredDocument,
} from './leaseIntegrity.js'

const storage = { downloadFile: vi.fn() }

vi.mock('./storageService.js', () => ({
  getStorageProvider: () => storage,
}))

const sha256 = (input: string | Buffer) => createHash('sha256').update(input).digest('hex')

const KEY = 'lease/deal-1/0f9c.pdf'

describe('leaseIntegrity (#2119)', () => {
  beforeEach(() => {
    storage.downloadFile.mockReset()
  })

  describe('hashStoredDocument', () => {
    it('hashes the bytes that storage returns', async () => {
      const bytes = Buffer.from('%PDF-1.4 lease body')
      storage.downloadFile.mockResolvedValue({ buffer: bytes, contentType: 'application/pdf' })

      await expect(hashStoredDocument(KEY)).resolves.toBe(sha256(bytes))
      expect(storage.downloadFile).toHaveBeenCalledWith(KEY)
    })

    it('hashes empty stored bytes as the empty input, not as the key', async () => {
      storage.downloadFile.mockResolvedValue({ buffer: Buffer.alloc(0), contentType: 'application/pdf' })

      const hash = await hashStoredDocument(KEY)

      expect(hash).toBe(sha256(Buffer.alloc(0)))
      expect(hash).not.toBe(sha256(KEY))
    })

    it('falls back to hashing the key when the object is not in storage', async () => {
      storage.downloadFile.mockRejectedValue(new Error('NoSuchKey'))

      await expect(hashStoredDocument(KEY)).resolves.toBe(sha256(KEY))
    })
  })

  describe('documentVersionFromKey', () => {
    it.each([
      ['lease/deal-1/0f9c.pdf', '0f9c.pdf'],
      ['0f9c.pdf', '0f9c.pdf'],
      ['lease/deal-1/', 'v1'],
      ['', 'v1'],
    ])('derives the version from %j as %j', (key, expected) => {
      expect(documentVersionFromKey(key)).toBe(expected)
    })
  })

  describe('checkDocumentIntegrity', () => {
    it('reports valid when the stored bytes match the recorded hash', async () => {
      const bytes = Buffer.from('original lease')
      storage.downloadFile.mockResolvedValue({ buffer: bytes, contentType: 'application/pdf' })
      const lastModified = new Date('2026-11-01T10:00:00.000Z')

      const result = await checkDocumentIntegrity({
        documentKey: KEY,
        recordedHash: sha256(bytes),
        lastModified,
      })

      expect(result).toEqual({
        valid: true,
        documentHash: sha256(bytes),
        recordedHash: sha256(bytes),
        documentVersion: '0f9c.pdf',
        lastModified: '2026-11-01T10:00:00.000Z',
      })
    })

    it('reports invalid when the stored bytes differ from the recorded hash', async () => {
      const original = Buffer.from('original lease')
      const tampered = Buffer.from('original lease.')
      storage.downloadFile.mockResolvedValue({ buffer: tampered, contentType: 'application/pdf' })

      const result = await checkDocumentIntegrity({
        documentKey: KEY,
        recordedHash: sha256(original),
        lastModified: new Date(0),
      })

      expect(result.valid).toBe(false)
      expect(result.documentHash).toBe(sha256(tampered))
      expect(result.recordedHash).toBe(sha256(original))
    })

    it('treats a lease with no recorded hash as valid and reports the fresh hash', async () => {
      const bytes = Buffer.from('legacy lease')
      storage.downloadFile.mockResolvedValue({ buffer: bytes, contentType: 'application/pdf' })

      const withUndefined = await checkDocumentIntegrity({ documentKey: KEY, lastModified: new Date(0) })
      const withEmpty = await checkDocumentIntegrity({ documentKey: KEY, recordedHash: '', lastModified: new Date(0) })

      expect(withUndefined.valid).toBe(true)
      expect(withUndefined.recordedHash).toBe('')
      expect(withUndefined.documentHash).toBe(sha256(bytes))
      expect(withEmpty.valid).toBe(true)
    })

    it('accepts a legacy lease whose recorded hash was computed over the key', async () => {
      storage.downloadFile.mockRejectedValue(new Error('NoSuchKey'))

      const result = await checkDocumentIntegrity({
        documentKey: KEY,
        recordedHash: sha256(KEY),
        lastModified: new Date(0),
      })

      expect(result.valid).toBe(true)
      expect(result.documentHash).toBe(sha256(KEY))
    })

    it('reports a whitespace-only change as a mismatch', async () => {
      const bytes = Buffer.from('lease')
      storage.downloadFile.mockResolvedValue({ buffer: Buffer.from('lease '), contentType: 'application/pdf' })

      const result = await checkDocumentIntegrity({
        documentKey: KEY,
        recordedHash: sha256(bytes),
        lastModified: new Date(0),
      })

      expect(result.valid).toBe(false)
    })

    it('reports a storage outage as a mismatch against a stored PDF hash (documents current behaviour)', async () => {
      // Not a bug fix target: an unreachable store falls back to hashing the key,
      // so a lease recorded with a PDF hash reads as tampered. Recorded in the PR as an
      // open question for maintainers; this test pins the current behaviour.
      storage.downloadFile.mockRejectedValue(new Error('ECONNREFUSED'))

      const result = await checkDocumentIntegrity({
        documentKey: KEY,
        recordedHash: sha256(Buffer.from('%PDF-1.4 lease body')),
        lastModified: new Date(0),
      })

      expect(result.valid).toBe(false)
    })
  })
})
