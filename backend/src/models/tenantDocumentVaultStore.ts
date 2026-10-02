/**
 * Tenant Document Vault Store
 * In-memory and PostgreSQL implementations for tenant document persistence
 */

import { getPool } from '../db.js'
import {
  type TenantDocument,
  type DocumentCategory,
  type DocumentStatus,
  type CreateDocumentRequest,
  type UpdateDocumentRequest,
  type PendingUploadInput,
  type ConfirmUploadInput,
  computeDocumentStatus,
} from '../schemas/tenantDocumentVault.js'

export interface TenantDocumentVaultStore {
  create(userId: string, data: CreateDocumentRequest): Promise<TenantDocument>
  createPendingUpload(userId: string, data: PendingUploadInput): Promise<TenantDocument>
  confirmUpload(
    documentId: string,
    userId: string,
    data: ConfirmUploadInput,
  ): Promise<TenantDocument | null>
  findById(documentId: string, userId: string): Promise<TenantDocument | null>
  list(
    userId: string,
    filters?: {
      category?: DocumentCategory
      status?: DocumentStatus
      tags?: string[]
      search?: string
      page?: number
      pageSize?: number
    },
  ): Promise<{ documents: TenantDocument[]; total: number; page: number; pageSize: number }>
  update(documentId: string, userId: string, data: UpdateDocumentRequest): Promise<TenantDocument | null>
  delete(documentId: string, userId: string): Promise<boolean>
}

function docTypeToCategory(docType: string): DocumentCategory {
  const map: Record<string, DocumentCategory> = {
    id_card: 'identification',
    passport: 'identification',
    employment_letter: 'agreement',
    bank_statement: 'receipt',
    utility_bill: 'utility',
    proof_of_address: 'utility',
  }
  return map[docType] ?? 'other'
}

function mapRowToDocument(row: Record<string, unknown>): TenantDocument {
  const tags = typeof row.tags === 'string' ? JSON.parse(row.tags as string) : (row.tags as string[]) || []
  const expiresAt = row.expires_at as string | null
  const docType = (row.doc_type as string | null) ?? null
  return {
    id: row.id as string,
    userId: row.user_id as string,
    fileName: (row.file_name as string | null) ?? '',
    fileFormat: (row.file_format as TenantDocument['fileFormat']) ?? 'pdf',
    fileSizeBytes: (row.file_size_bytes as number | null) ?? 0,
    storageKey: row.storage_key as string,
    category: (row.category as DocumentCategory) ?? (docType ? docTypeToCategory(docType) : 'other'),
    docType,
    contentType: (row.content_type as string | null) ?? null,
    uploadStatus: ((row.upload_status as string) ?? 'confirmed') as TenantDocument['uploadStatus'],
    tags,
    status: computeDocumentStatus(expiresAt),
    expiresAt,
    description: row.description as string | null,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  }
}

export class InMemoryTenantDocumentVaultStore implements TenantDocumentVaultStore {
  private documents: Map<string, TenantDocument> = new Map()
  private counter = 1

  async create(userId: string, data: CreateDocumentRequest): Promise<TenantDocument> {
    const id = `DOC-${Date.now()}-${this.counter++}`
    const now = new Date().toISOString()
    const doc: TenantDocument = {
      id,
      userId,
      fileName: data.fileName,
      fileFormat: data.fileFormat,
      fileSizeBytes: data.fileSizeBytes,
      storageKey: data.storageKey,
      category: data.category,
      docType: null,
      contentType: null,
      uploadStatus: 'confirmed',
      tags: data.tags ?? [],
      status: computeDocumentStatus(data.expiresAt ?? null),
      expiresAt: data.expiresAt ?? null,
      description: data.description ?? null,
      createdAt: now,
      updatedAt: now,
    }
    this.documents.set(id, doc)
    return doc
  }

  async createPendingUpload(userId: string, data: PendingUploadInput): Promise<TenantDocument> {
    const id = `DOC-${Date.now()}-${this.counter++}`
    const now = new Date().toISOString()
    const category = docTypeToCategory(data.docType)
    const doc: TenantDocument = {
      id,
      userId,
      fileName: '',
      fileFormat: 'pdf',
      fileSizeBytes: 0,
      storageKey: data.objectKey,
      category,
      docType: data.docType,
      contentType: data.contentType,
      uploadStatus: 'pending',
      tags: [],
      status: 'active',
      expiresAt: null,
      description: null,
      createdAt: now,
      updatedAt: now,
    }
    this.documents.set(id, doc)
    return doc
  }

  async confirmUpload(
    documentId: string,
    userId: string,
    data: ConfirmUploadInput,
  ): Promise<TenantDocument | null> {
    const doc = this.documents.get(documentId)
    if (!doc || doc.userId !== userId || doc.uploadStatus !== 'pending') return null

    const updated: TenantDocument = {
      ...doc,
      fileName: data.fileName,
      fileFormat: data.fileFormat,
      fileSizeBytes: data.fileSizeBytes,
      uploadStatus: 'confirmed',
      updatedAt: new Date().toISOString(),
    }
    this.documents.set(documentId, updated)
    return updated
  }

  async findById(documentId: string, userId: string): Promise<TenantDocument | null> {
    const doc = this.documents.get(documentId)
    if (!doc || doc.userId !== userId) return null
    // Recompute status for dynamic expiry
    return { ...doc, status: computeDocumentStatus(doc.expiresAt) }
  }

  async list(
    userId: string,
    filters?: {
      category?: DocumentCategory
      status?: DocumentStatus
      tags?: string[]
      search?: string
      page?: number
      pageSize?: number
    },
  ): Promise<{ documents: TenantDocument[]; total: number; page: number; pageSize: number }> {
    let docs = Array.from(this.documents.values())
      .filter((d) => d.userId === userId)
      .map((d) => ({ ...d, status: computeDocumentStatus(d.expiresAt) }))

    if (filters?.category) {
      docs = docs.filter((d) => d.category === filters.category)
    }
    if (filters?.status) {
      docs = docs.filter((d) => d.status === filters.status)
    }
    if (filters?.tags && filters.tags.length > 0) {
      docs = docs.filter((d) => filters.tags!.some((t) => d.tags.includes(t)))
    }
    if (filters?.search) {
      const q = filters.search.toLowerCase()
      docs = docs.filter(
        (d) =>
          d.fileName.toLowerCase().includes(q) ||
          (d.description && d.description.toLowerCase().includes(q)) ||
          d.tags.some((t) => t.toLowerCase().includes(q)),
      )
    }

    docs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    const page = filters?.page ?? 1
    const pageSize = filters?.pageSize ?? 20
    const total = docs.length
    const start = (page - 1) * pageSize
    const documents = docs.slice(start, start + pageSize)

    return { documents, total, page, pageSize }
  }

  async update(documentId: string, userId: string, data: UpdateDocumentRequest): Promise<TenantDocument | null> {
    const doc = this.documents.get(documentId)
    if (!doc || doc.userId !== userId) return null

    const updated: TenantDocument = {
      ...doc,
      category: data.category ?? doc.category,
      tags: data.tags ?? doc.tags,
      expiresAt: data.expiresAt !== undefined ? data.expiresAt : doc.expiresAt,
      description: data.description !== undefined ? data.description : doc.description,
      updatedAt: new Date().toISOString(),
    }
    updated.status = computeDocumentStatus(updated.expiresAt)
    this.documents.set(documentId, updated)
    return updated
  }

  async delete(documentId: string, userId: string): Promise<boolean> {
    const doc = this.documents.get(documentId)
    if (!doc || doc.userId !== userId) return false
    // In-memory implementation: simulate soft-delete by removing from map
    // (Note: in-memory store doesn't support retention holds check)
    this.documents.delete(documentId)
    return true
  }
}

export class PostgresTenantDocumentVaultStore implements TenantDocumentVaultStore {
  async create(userId: string, data: CreateDocumentRequest): Promise<TenantDocument> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not configured')

    const { rows } = await pool.query(
      `INSERT INTO tenant_documents (user_id, file_name, file_format, file_size_bytes, storage_key, category, tags, expires_at, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        userId,
        data.fileName,
        data.fileFormat,
        data.fileSizeBytes,
        data.storageKey,
        data.category,
        JSON.stringify(data.tags ?? []),
        data.expiresAt ?? null,
        data.description ?? null,
      ],
    )
    return mapRowToDocument(rows[0])
  }

  async createPendingUpload(userId: string, data: PendingUploadInput): Promise<TenantDocument> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not configured')

    const category = docTypeToCategory(data.docType)
    const { rows } = await pool.query(
      `INSERT INTO tenant_documents (
         user_id, storage_key, category, doc_type, content_type, upload_status,
         file_name, file_format, file_size_bytes, tags
       )
       VALUES ($1, $2, $3, $4, $5, 'pending', '', 'pdf', NULL, '[]')
       RETURNING *`,
      [userId, data.objectKey, category, data.docType, data.contentType],
    )
    return mapRowToDocument(rows[0])
  }

  async confirmUpload(
    documentId: string,
    userId: string,
    data: ConfirmUploadInput,
  ): Promise<TenantDocument | null> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not configured')

    const { rows } = await pool.query(
      `UPDATE tenant_documents
       SET upload_status = 'confirmed',
           file_name = $1,
           file_format = $2,
           file_size_bytes = $3,
           updated_at = NOW()
       WHERE id = $4 AND user_id = $5 AND upload_status = 'pending'
       RETURNING *`,
      [data.fileName, data.fileFormat, data.fileSizeBytes, documentId, userId],
    )
    if (rows.length === 0) return null
    return mapRowToDocument(rows[0])
  }

  async findById(documentId: string, userId: string): Promise<TenantDocument | null> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not configured')

    const { rows } = await pool.query(
      `SELECT * FROM tenant_documents WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [documentId, userId],
    )
    if (rows.length === 0) return null
    return mapRowToDocument(rows[0])
  }

  async list(
    userId: string,
    filters?: {
      category?: DocumentCategory
      status?: DocumentStatus
      tags?: string[]
      search?: string
      page?: number
      pageSize?: number
    },
  ): Promise<{ documents: TenantDocument[]; total: number; page: number; pageSize: number }> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not configured')

    const conditions: string[] = ['user_id = $1', 'deleted_at IS NULL']
    const params: unknown[] = [userId]
    let paramIndex = 2

    if (filters?.category) {
      conditions.push(`category = $${paramIndex++}`)
      params.push(filters.category)
    }
    if (filters?.search) {
      conditions.push(
        `(file_name ILIKE $${paramIndex} OR description ILIKE $${paramIndex} OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(tags) t WHERE t ILIKE $${paramIndex}))`,
      )
      params.push(`%${filters.search}%`)
      paramIndex++
    }
    if (filters?.tags && filters.tags.length > 0) {
      conditions.push(`tags ?| $${paramIndex++}`)
      params.push(filters.tags)
    }

    const where = `WHERE ${conditions.join(' AND ')}`
    const page = filters?.page ?? 1
    const pageSize = Math.min(100, filters?.pageSize ?? 20)
    const offset = (page - 1) * pageSize

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM tenant_documents ${where}`,
      params,
    )
    const total = countResult.rows[0].total

    const dataResult = await pool.query(
      `SELECT * FROM tenant_documents ${where} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, pageSize, offset],
    )

    let documents = dataResult.rows.map(mapRowToDocument)

    // Status filter is computed dynamically since it depends on expires_at vs now
    if (filters?.status) {
      documents = documents.filter((d) => d.status === filters.status)
    }

    return { documents, total, page, pageSize }
  }

  async update(documentId: string, userId: string, data: UpdateDocumentRequest): Promise<TenantDocument | null> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not configured')

    const sets: string[] = []
    const params: unknown[] = []
    let paramIndex = 1

    if (data.category !== undefined) {
      sets.push(`category = $${paramIndex++}`)
      params.push(data.category)
    }
    if (data.tags !== undefined) {
      sets.push(`tags = $${paramIndex++}`)
      params.push(JSON.stringify(data.tags))
    }
    if (data.expiresAt !== undefined) {
      sets.push(`expires_at = $${paramIndex++}`)
      params.push(data.expiresAt)
    }
    if (data.description !== undefined) {
      sets.push(`description = $${paramIndex++}`)
      params.push(data.description)
    }

    if (sets.length === 0) {
      return this.findById(documentId, userId)
    }

    sets.push(`updated_at = NOW()`)
    params.push(documentId, userId)

    const { rows } = await pool.query(
      `UPDATE tenant_documents SET ${sets.join(', ')} WHERE id = $${paramIndex++} AND user_id = $${paramIndex} RETURNING *`,
      params,
    )
    if (rows.length === 0) return null
    return mapRowToDocument(rows[0])
  }

  async delete(documentId: string, userId: string): Promise<boolean> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not configured')

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Check for active retention holds before allowing deletion
      const holdCheck = await client.query(
        `SELECT 1 FROM data_retention_holds
         WHERE table_name = 'tenant_documents'
           AND record_id = $1::text
           AND released_at IS NULL
         LIMIT 1`,
        [documentId],
      )

      if (holdCheck.rows.length > 0) {
        await client.query('ROLLBACK')
        return false
      }

      // Soft delete by setting deleted_at timestamp
      const { rowCount } = await client.query(
        `UPDATE tenant_documents
         SET deleted_at = NOW()
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
        [documentId, userId],
      )

      await client.query('COMMIT')
      return (rowCount ?? 0) > 0
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}

let store: TenantDocumentVaultStore

export function getTenantDocumentVaultStore(): TenantDocumentVaultStore {
  if (!store) {
    const useDb = process.env.DATABASE_URL
    store = useDb
      ? new PostgresTenantDocumentVaultStore()
      : new InMemoryTenantDocumentVaultStore()
  }
  return store
}

export function initTenantDocumentVaultStore(usePostgres: boolean): void {
  store = usePostgres
    ? new PostgresTenantDocumentVaultStore()
    : new InMemoryTenantDocumentVaultStore()
}
