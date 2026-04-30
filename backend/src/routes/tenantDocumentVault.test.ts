import { describe, it, expect, beforeEach, vi } from 'vitest'
import { computeDocumentStatus, isPreviewable, createDocumentSchema, updateDocumentSchema, listDocumentsSchema } from '../schemas/tenantDocumentVault.js'
import { InMemoryTenantDocumentVaultStore } from '../models/tenantDocumentVaultStore.js'

describe('Tenant Document Vault - Schema & Status', () => {
  describe('computeDocumentStatus', () => {
    it('returns "active" when no expiration is set', () => {
      expect(computeDocumentStatus(null)).toBe('active')
    })

    it('returns "active" when expiration is far in the future', () => {
      const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
      expect(computeDocumentStatus(future)).toBe('active')
    })

    it('returns "expiring_soon" when expiration is within 30 days', () => {
      const soon = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString()
      expect(computeDocumentStatus(soon)).toBe('expiring_soon')
    })

    it('returns "expired" when expiration is in the past', () => {
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      expect(computeDocumentStatus(past)).toBe('expired')
    })

    it('returns "expiring_soon" when exactly 30 days away', () => {
      const thirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 - 1).toISOString()
      expect(computeDocumentStatus(thirtyDays)).toBe('expiring_soon')
    })
  })

  describe('isPreviewable', () => {
    it('returns true for previewable formats', () => {
      expect(isPreviewable('pdf')).toBe(true)
      expect(isPreviewable('jpg')).toBe(true)
      expect(isPreviewable('jpeg')).toBe(true)
      expect(isPreviewable('png')).toBe(true)
      expect(isPreviewable('webp')).toBe(true)
      expect(isPreviewable('svg')).toBe(true)
    })

    it('returns false for non-previewable formats', () => {
      expect(isPreviewable('doc')).toBe(false)
      expect(isPreviewable('docx')).toBe(false)
    })
  })

  describe('createDocumentSchema', () => {
    it('validates a valid document creation request', () => {
      const result = createDocumentSchema.safeParse({
        fileName: 'lease-2024.pdf',
        fileFormat: 'pdf',
        fileSizeBytes: 1024000,
        storageKey: 'uploads/abc123',
        category: 'agreement',
        tags: ['lease', '2024'],
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        description: 'Annual lease agreement',
      })
      expect(result.success).toBe(true)
    })

    it('rejects missing required fields', () => {
      const result = createDocumentSchema.safeParse({
        fileName: 'test.pdf',
      })
      expect(result.success).toBe(false)
    })

    it('rejects files over 25MB', () => {
      const result = createDocumentSchema.safeParse({
        fileName: 'huge.pdf',
        fileFormat: 'pdf',
        fileSizeBytes: 26 * 1024 * 1024,
        storageKey: 'uploads/big',
        category: 'other',
      })
      expect(result.success).toBe(false)
    })

    it('rejects too many tags', () => {
      const result = createDocumentSchema.safeParse({
        fileName: 'tagged.pdf',
        fileFormat: 'pdf',
        fileSizeBytes: 1000,
        storageKey: 'uploads/tagged',
        category: 'other',
        tags: Array.from({ length: 11 }, (_, i) => `tag${i}`),
      })
      expect(result.success).toBe(false)
    })
  })

  describe('updateDocumentSchema', () => {
    it('allows partial updates', () => {
      const result = updateDocumentSchema.safeParse({
        category: 'receipt',
      })
      expect(result.success).toBe(true)
    })

    it('allows clearing expiration with null', () => {
      const result = updateDocumentSchema.safeParse({
        expiresAt: null,
      })
      expect(result.success).toBe(true)
    })
  })

  describe('listDocumentsSchema', () => {
    it('parses pagination from query strings', () => {
      const result = listDocumentsSchema.safeParse({
        page: '2',
        pageSize: '10',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.page).toBe(2)
        expect(result.data.pageSize).toBe(10)
      }
    })

    it('parses comma-separated tags', () => {
      const result = listDocumentsSchema.safeParse({
        tags: 'lease,2024',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.tags).toEqual(['lease', '2024'])
      }
    })

    it('defaults page and pageSize when omitted', () => {
      const result = listDocumentsSchema.safeParse({})
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.page).toBe(1)
        expect(result.data.pageSize).toBe(20)
      }
    })
  })
})

describe('InMemoryTenantDocumentVaultStore', () => {
  let store: InMemoryTenantDocumentVaultStore

  beforeEach(() => {
    store = new InMemoryTenantDocumentVaultStore()
  })

  it('creates a document and returns it with computed status', async () => {
    const doc = await store.create('user-1', {
      fileName: 'passport.jpg',
      fileFormat: 'jpg',
      fileSizeBytes: 500000,
      storageKey: 'uploads/passport',
      category: 'identification',
      tags: ['id', 'passport'],
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    })

    expect(doc.id).toBeTruthy()
    expect(doc.userId).toBe('user-1')
    expect(doc.fileName).toBe('passport.jpg')
    expect(doc.category).toBe('identification')
    expect(doc.tags).toEqual(['id', 'passport'])
    expect(doc.status).toBe('active')
  })

  it('finds a document by id with user ownership check', async () => {
    const doc = await store.create('user-1', {
      fileName: 'test.pdf',
      fileFormat: 'pdf',
      fileSizeBytes: 1000,
      storageKey: 'uploads/test',
      category: 'other',
    })

    const found = await store.findById(doc.id, 'user-1')
    expect(found).toBeTruthy()
    expect(found?.id).toBe(doc.id)

    const notFound = await store.findById(doc.id, 'user-2')
    expect(notFound).toBeNull()
  })

  it('lists documents filtered by category', async () => {
    await store.create('user-1', {
      fileName: 'id.pdf',
      fileFormat: 'pdf',
      fileSizeBytes: 1000,
      storageKey: 'uploads/id',
      category: 'identification',
    })
    await store.create('user-1', {
      fileName: 'receipt.pdf',
      fileFormat: 'pdf',
      fileSizeBytes: 2000,
      storageKey: 'uploads/receipt',
      category: 'receipt',
    })

    const result = await store.list('user-1', { category: 'receipt' })
    expect(result.documents).toHaveLength(1)
    expect(result.documents[0].category).toBe('receipt')
  })

  it('lists documents filtered by status', async () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    await store.create('user-1', {
      fileName: 'expired.pdf',
      fileFormat: 'pdf',
      fileSizeBytes: 1000,
      storageKey: 'uploads/expired',
      category: 'other',
      expiresAt: pastDate,
    })
    await store.create('user-1', {
      fileName: 'active.pdf',
      fileFormat: 'pdf',
      fileSizeBytes: 2000,
      storageKey: 'uploads/active',
      category: 'other',
    })

    const expired = await store.list('user-1', { status: 'expired' })
    expect(expired.documents).toHaveLength(1)
    expect(expired.documents[0].fileName).toBe('expired.pdf')

    const active = await store.list('user-1', { status: 'active' })
    expect(active.documents).toHaveLength(1)
    expect(active.documents[0].fileName).toBe('active.pdf')
  })

  it('lists documents filtered by search term', async () => {
    await store.create('user-1', {
      fileName: 'lease-agreement-2024.pdf',
      fileFormat: 'pdf',
      fileSizeBytes: 3000,
      storageKey: 'uploads/lease',
      category: 'agreement',
      description: 'Annual lease agreement for Lagos property',
    })
    await store.create('user-1', {
      fileName: 'passport-scan.jpg',
      fileFormat: 'jpg',
      fileSizeBytes: 4000,
      storageKey: 'uploads/passport',
      category: 'identification',
    })

    const result = await store.list('user-1', { search: 'lease' })
    expect(result.documents).toHaveLength(1)
    expect(result.documents[0].fileName).toBe('lease-agreement-2024.pdf')
  })

  it('lists documents filtered by tags', async () => {
    await store.create('user-1', {
      fileName: 'doc1.pdf',
      fileFormat: 'pdf',
      fileSizeBytes: 1000,
      storageKey: 'uploads/1',
      category: 'other',
      tags: ['important', '2024'],
    })
    await store.create('user-1', {
      fileName: 'doc2.pdf',
      fileFormat: 'pdf',
      fileSizeBytes: 2000,
      storageKey: 'uploads/2',
      category: 'other',
      tags: ['draft'],
    })

    const result = await store.list('user-1', { tags: ['important'] })
    expect(result.documents).toHaveLength(1)
    expect(result.documents[0].fileName).toBe('doc1.pdf')
  })

  it('paginates results', async () => {
    for (let i = 0; i < 5; i++) {
      await store.create('user-1', {
        fileName: `doc-${i}.pdf`,
        fileFormat: 'pdf',
        fileSizeBytes: 1000,
        storageKey: `uploads/${i}`,
        category: 'other',
      })
    }

    const page1 = await store.list('user-1', { page: 1, pageSize: 2 })
    expect(page1.documents).toHaveLength(2)
    expect(page1.total).toBe(5)

    const page3 = await store.list('user-1', { page: 3, pageSize: 2 })
    expect(page3.documents).toHaveLength(1)
  })

  it('updates document metadata', async () => {
    const doc = await store.create('user-1', {
      fileName: 'test.pdf',
      fileFormat: 'pdf',
      fileSizeBytes: 1000,
      storageKey: 'uploads/test',
      category: 'other',
    })

    const updated = await store.update(doc.id, 'user-1', {
      category: 'receipt',
      tags: ['updated'],
    })

    expect(updated).toBeTruthy()
    expect(updated?.category).toBe('receipt')
    expect(updated?.tags).toEqual(['updated'])
  })

  it('prevents updating another user document', async () => {
    const doc = await store.create('user-1', {
      fileName: 'test.pdf',
      fileFormat: 'pdf',
      fileSizeBytes: 1000,
      storageKey: 'uploads/test',
      category: 'other',
    })

    const result = await store.update(doc.id, 'user-2', { category: 'receipt' })
    expect(result).toBeNull()
  })

  it('deletes a document', async () => {
    const doc = await store.create('user-1', {
      fileName: 'test.pdf',
      fileFormat: 'pdf',
      fileSizeBytes: 1000,
      storageKey: 'uploads/test',
      category: 'other',
    })

    const deleted = await store.delete(doc.id, 'user-1')
    expect(deleted).toBe(true)

    const found = await store.findById(doc.id, 'user-1')
    expect(found).toBeNull()
  })

  it('prevents deleting another user document', async () => {
    const doc = await store.create('user-1', {
      fileName: 'test.pdf',
      fileFormat: 'pdf',
      fileSizeBytes: 1000,
      storageKey: 'uploads/test',
      category: 'other',
    })

    const deleted = await store.delete(doc.id, 'user-2')
    expect(deleted).toBe(false)
  })

  it('scopes list to user only', async () => {
    await store.create('user-1', {
      fileName: 'user1-doc.pdf',
      fileFormat: 'pdf',
      fileSizeBytes: 1000,
      storageKey: 'uploads/u1',
      category: 'other',
    })
    await store.create('user-2', {
      fileName: 'user2-doc.pdf',
      fileFormat: 'pdf',
      fileSizeBytes: 2000,
      storageKey: 'uploads/u2',
      category: 'other',
    })

    const result = await store.list('user-1')
    expect(result.documents).toHaveLength(1)
    expect(result.documents[0].fileName).toBe('user1-doc.pdf')
  })
})
