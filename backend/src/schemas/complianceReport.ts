import { z } from 'zod'

export const reportTypeSchema = z.enum(['transaction', 'kyc'])

export const reportFormatSchema = z.enum(['json', 'csv'])

export const generateReportSchema = z.object({
  reportType: reportTypeSchema,
  format: reportFormatSchema.default('json'),
  dateFrom: z.string().datetime({ message: 'Invalid ISO 8601 datetime' }),
  dateTo: z.string().datetime({ message: 'Invalid ISO 8601 datetime' }),
  jurisdiction: z.string().min(2).max(10).optional(),
})

export type GenerateReportRequest = z.infer<typeof generateReportSchema>

export const reportStatusSchema = z.enum(['pending', 'completed', 'failed'])

export const reportMetadataSchema = z.object({
  reportId: z.string().uuid(),
  reportType: reportTypeSchema,
  format: reportFormatSchema,
  dateFrom: z.string(),
  dateTo: z.string(),
  jurisdiction: z.string().optional(),
  status: reportStatusSchema,
  integrityHash: z.string().optional(),
  generatedAt: z.string().optional(),
  downloadUrl: z.string().optional(),
  createdAt: z.string(),
})

export type ReportMetadata = z.infer<typeof reportMetadataSchema>

export const reportQuerySchema = z.object({
  reportType: reportTypeSchema.optional(),
  status: reportStatusSchema.optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
