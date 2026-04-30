/**
 * Tenant Document Vault Routes
 * Handles CRUD and preview for tenant uploaded documents
 */

import { Router, type Request, type Response, type NextFunction } from 'express'
import { authenticateToken } from '../middleware/auth.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import {
  createDocumentSchema,
  updateDocumentSchema,
  listDocumentsSchema,
  isPreviewable,
  type TenantDocument,
} from '../schemas/tenantDocumentVault.js'
import {
  getTenantDocumentVaultStore,
} from '../models/tenantDocumentVaultStore.js'
import { logger } from '../utils/logger.js'
import { auditLog, extractAuditContext, type AuditEventType } from '../utils/auditLogger.js'

const router = Router()

function requireTenant(req: Request): string {
  const user = (req as any).user
  if (!user?.id) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'User not authenticated')
  }
  return user.id as string
}

/**
 * GET /api/tenant/vault
 * List documents for authenticated tenant with filters
 */
router.get(
  '/',
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = requireTenant(req)
      const filters = listDocumentsSchema.parse(req.query)

      const store = getTenantDocumentVaultStore()
      const result = await store.list(userId, {
        category: filters.category,
        status: filters.status,
        tags: filters.tags,
        search: filters.search,
        page: filters.page,
        pageSize: filters.pageSize,
      })

      res.json({
        success: true,
        data: result.documents,
        pagination: {
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
          totalPages: Math.ceil(result.total / result.pageSize),
        },
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return next(new AppError(ErrorCode.VALIDATION_ERROR, 400, (error as any).issues?.map((i: any) => i.message).join(', ') || error.message))
      }
      next(error)
    }
  },
)

/**
 * GET /api/tenant/vault/:documentId
 * Get a single document by ID (ownership check enforced)
 */
router.get(
  '/:documentId',
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = requireTenant(req)
      const { documentId } = req.params

      if (!documentId) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Document ID is required')
      }

      const store = getTenantDocumentVaultStore()
      const doc = await store.findById(documentId, userId)

      if (!doc) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Document not found')
      }

      res.json({ success: true, data: doc })
    } catch (error) {
      next(error)
    }
  },
)

/**
 * GET /api/tenant/vault/:documentId/preview
 * Secure preview — returns preview metadata; only for supported formats
 */
router.get(
  '/:documentId/preview',
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = requireTenant(req)
      const { documentId } = req.params

      if (!documentId) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Document ID is required')
      }

      const store = getTenantDocumentVaultStore()
      const doc = await store.findById(documentId, userId)

      if (!doc) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Document not found')
      }

      if (!isPreviewable(doc.fileFormat)) {
        res.json({
          success: true,
          data: {
            documentId: doc.id,
            fileName: doc.fileName,
            fileFormat: doc.fileFormat,
            previewAvailable: false,
            message: `Preview is not supported for .${doc.fileFormat} files. Please download the file to view it.`,
          },
        })
        return
      }

      auditLog('DOCUMENT_PREVIEWED' as AuditEventType, extractAuditContext(req, 'user'), {
        documentId: doc.id,
        fileFormat: doc.fileFormat,
      })

      res.json({
        success: true,
        data: {
          documentId: doc.id,
          fileName: doc.fileName,
          fileFormat: doc.fileFormat,
          fileSizeBytes: doc.fileSizeBytes,
          previewAvailable: true,
          storageKey: doc.storageKey,
        },
      })
    } catch (error) {
      next(error)
    }
  },
)

/**
 * POST /api/tenant/vault
 * Upload a new document record
 */
router.post(
  '/',
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = requireTenant(req)
      const parsed = createDocumentSchema.safeParse(req.body)

      if (!parsed.success) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Invalid document data')
      }

      const store = getTenantDocumentVaultStore()
      const doc = await store.create(userId, parsed.data)

      auditLog('DOCUMENT_UPLOADED' as AuditEventType, extractAuditContext(req, 'user'), {
        documentId: doc.id,
        category: doc.category,
        fileFormat: doc.fileFormat,
      })

      res.status(201).json({ success: true, data: doc })
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return next(new AppError(ErrorCode.VALIDATION_ERROR, 400, error.message))
      }
      next(error)
    }
  },
)

/**
 * PATCH /api/tenant/vault/:documentId
 * Update document metadata (tags, category, expiration, description)
 */
router.patch(
  '/:documentId',
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = requireTenant(req)
      const { documentId } = req.params

      if (!documentId) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Document ID is required')
      }

      const parsed = updateDocumentSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Invalid update data')
      }

      const store = getTenantDocumentVaultStore()
      const updated = await store.update(documentId, userId, parsed.data)

      if (!updated) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Document not found or access denied')
      }

      auditLog('DOCUMENT_UPDATED' as AuditEventType, extractAuditContext(req, 'user'), {
        documentId,
        updatedFields: Object.keys(parsed.data),
      })

      res.json({ success: true, data: updated })
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return next(new AppError(ErrorCode.VALIDATION_ERROR, 400, error.message))
      }
      next(error)
    }
  },
)

/**
 * DELETE /api/tenant/vault/:documentId
 * Delete a document (ownership enforced)
 */
router.delete(
  '/:documentId',
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = requireTenant(req)
      const { documentId } = req.params

      if (!documentId) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Document ID is required')
      }

      const store = getTenantDocumentVaultStore()
      const deleted = await store.delete(documentId, userId)

      if (!deleted) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Document not found or access denied')
      }

      auditLog('DOCUMENT_DELETED' as AuditEventType, extractAuditContext(req, 'user'), {
        documentId,
      })

      res.json({ success: true })
    } catch (error) {
      next(error)
    }
  },
)

export function createTenantDocumentVaultRouter(): Router {
  return router
}
