import { z } from 'zod'

export const documentCategorySchema = z.enum([
  'identification',
  'receipt',
  'agreement',
  'insurance',
  'utility',
  'other',
])

export const documentStatusSchema = z.enum([
  'active',
  'expired',
  'expiring_soon',
  'pending_review',
  'rejected',
])

export const supportedFileFormatSchema = z.enum([
  'pdf',
  'jpg',
  'jpeg',
  'png',
  'webp',
  'svg',
  'doc',
  'docx',
])

export const createDocumentSchema = z.object({
  fileName: z.string().min(1).max(255),
  fileFormat: supportedFileFormatSchema,
  fileSizeBytes: z.number().int().positive().max(25 * 1024 * 1024), // 25MB
  storageKey: z.string().min(1),
  category: documentCategorySchema,
  tags: z.array(z.string().min(1).max(50)).min(0).max(10).default([]),
  expiresAt: z.string().datetime().optional(),
  description: z.string().max(500).optional(),
})

export const updateDocumentSchema = z.object({
  category: documentCategorySchema.optional(),
  tags: z.array(z.string().min(1).max(50)).min(0).max(10).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  description: z.string().max(500).nullable().optional(),
})

export const listDocumentsSchema = z.object({
  category: documentCategorySchema.optional(),
  status: documentStatusSchema.optional(),
  tags: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',') : undefined)),
  search: z.string().max(200).optional(),
  page: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 1)),
  pageSize: z
    .string()
    .optional()
    .transform((v) => Math.min(100, v ? parseInt(v, 10) : 20)),
})

export type DocumentCategory = z.infer<typeof documentCategorySchema>
export type DocumentStatus = z.infer<typeof documentStatusSchema>
export type SupportedFileFormat = z.infer<typeof supportedFileFormatSchema>
export type CreateDocumentRequest = z.infer<typeof createDocumentSchema>
export type UpdateDocumentRequest = z.infer<typeof updateDocumentSchema>
export type ListDocumentsRequest = z.infer<typeof listDocumentsSchema>

export interface TenantDocument {
  id: string
  userId: string
  fileName: string
  fileFormat: SupportedFileFormat
  fileSizeBytes: number
  storageKey: string
  category: DocumentCategory
  tags: string[]
  status: DocumentStatus
  expiresAt: string | null
  description: string | null
  createdAt: string
  updatedAt: string
}

export const PREVIEWABLE_FORMATS: SupportedFileFormat[] = [
  'pdf',
  'jpg',
  'jpeg',
  'png',
  'webp',
  'svg',
]

export function isPreviewable(format: SupportedFileFormat): boolean {
  return PREVIEWABLE_FORMATS.includes(format)
}

export function computeDocumentStatus(
  expiresAt: string | null,
  now: Date = new Date(),
): DocumentStatus {
  if (!expiresAt) return 'active'
  const expiry = new Date(expiresAt)
  if (expiry < now) return 'expired'
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
  if (expiry.getTime() - now.getTime() <= thirtyDaysMs) return 'expiring_soon'
  return 'active'
}
