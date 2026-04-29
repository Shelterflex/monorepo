import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { validate } from '../middleware/validate.js'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'
import { complianceReportStore } from '../models/complianceReportStore.js'
import { ComplianceReportService } from '../services/complianceReportService.js'
import { generateReportSchema, reportQuerySchema } from '../schemas/complianceReport.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { auditLog, extractAuditContext } from '../utils/auditLogger.js'

const reportService = new ComplianceReportService()

export function createComplianceReportRouter() {
  const router = Router()

  function requireComplianceRole(req: Request): AuthenticatedRequest {
    const user = (req as any).user
    if (!user) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Authentication required')
    }
    if (user.role !== 'admin' && user.role !== 'compliance' && user.role !== 'super_admin') {
      throw new AppError(ErrorCode.FORBIDDEN, 403, 'Compliance role required')
    }
    return user
  }

  router.post(
    '/generate',
    authenticateToken,
    validate(generateReportSchema),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const user = requireComplianceRole(req)
        const { reportType, format, dateFrom, dateTo, jurisdiction } =
          req.body as any

        const report = complianceReportStore.create({
          reportType,
          format,
          dateFrom: new Date(dateFrom),
          dateTo: new Date(dateTo),
          jurisdiction,
        })

        auditLog(
          'COMPLIANCE_REPORT_GENERATING' as any,
          extractAuditContext(req, user.role as any),
          {
            reportId: report.reportId,
            reportType,
            format,
            dateFrom,
            dateTo,
            jurisdiction,
          },
        )

        // Generate report asynchronously
        reportService
          .generateReport(report.reportId)
          .catch((err) => console.error('Report generation failed:', err))

        res.status(202).json({
          success: true,
          reportId: report.reportId,
          status: 'pending',
          message: 'Report generation initiated',
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/:reportId',
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const user = requireComplianceRole(req)
        const { reportId } = req.params

        const report = complianceReportStore.findById(reportId)
        if (!report) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, 'Report not found')
        }

        // Log access
        complianceReportStore.logAccess(
          reportId,
          user.id,
          req.ip,
        )

        auditLog(
          'COMPLIANCE_REPORT_ACCESSED' as any,
          extractAuditContext(req, user.role as any),
          { reportId, reportType: report.reportType },
        )

        res.json({
          reportId: report.reportId,
          reportType: report.reportType,
          format: report.format,
          dateFrom: report.dateFrom.toISOString(),
          dateTo: report.dateTo.toISOString(),
          jurisdiction: report.jurisdiction,
          status: report.status,
          integrityHash: report.integrityHash,
          generatedAt: report.generatedAt?.toISOString(),
          createdAt: report.createdAt.toISOString(),
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/:reportId/download',
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const user = requireComplianceRole(req)
        const { reportId } = req.params

        const report = complianceReportStore.findById(reportId)
        if (!report) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, 'Report not found')
        }

        if (report.status !== 'completed') {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            400,
            `Report is ${report.status}`,
          )
        }

        if (!report.content) {
          throw new AppError(ErrorCode.INTERNAL_ERROR, 500, 'Report content not found')
        }

        // Log access
        complianceReportStore.logAccess(
          reportId,
          user.id,
          req.ip,
        )

        auditLog(
          'COMPLIANCE_REPORT_DOWNLOADED' as any,
          extractAuditContext(req, user.role as any),
          { reportId, reportType: report.reportType, format: report.format },
        )

        const contentType =
          report.format === 'csv' ? 'text/csv' : 'application/json'
        const filename = `compliance_report_${reportId}.${report.format}`

        res.setHeader('Content-Type', contentType)
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${filename}"`,
        )
        if (report.integrityHash) {
          res.setHeader('X-Integrity-Hash', report.integrityHash)
        }

        res.send(report.content)
      } catch (error) {
        next(error)
      }
    },
  )

  router.get(
    '/',
    authenticateToken,
    validate(reportQuerySchema),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const user = requireComplianceRole(req)
        const parsed = reportQuerySchema.safeParse(req.query)

        if (!parsed.success) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            400,
            parsed.error.errors.map((e) => e.message).join('; '),
          )
        }

        const q = parsed.data
        const result = complianceReportStore.search({
          reportType: q.reportType,
          status: q.status,
          dateFrom: q.dateFrom ? new Date(q.dateFrom) : undefined,
          dateTo: q.dateTo ? new Date(q.dateTo) : undefined,
          page: q.page,
          pageSize: q.pageSize,
        })

        res.json({
          reports: result.reports.map((r) => ({
            reportId: r.reportId,
            reportType: r.reportType,
            format: r.format,
            dateFrom: r.dateFrom.toISOString(),
            dateTo: r.dateTo.toISOString(),
            jurisdiction: r.jurisdiction,
            status: r.status,
            integrityHash: r.integrityHash,
            generatedAt: r.generatedAt?.toISOString(),
            createdAt: r.createdAt.toISOString(),
          })),
          pagination: {
            total: result.total,
            page: q.page || 1,
            pageSize: q.pageSize || 20,
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/:reportId/verify',
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const user = requireComplianceRole(req)
        const { reportId } = req.params
        const { content, expectedHash } = req.body as any

        const report = complianceReportStore.findById(reportId)
        if (!report) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, 'Report not found')
        }

        const isValid = reportService.verifyIntegrity(
          content || report.content || '',
          expectedHash || report.integrityHash || '',
        )

        auditLog(
          'COMPLIANCE_REPORT_VERIFIED' as any,
          extractAuditContext(req, user.role as any),
          { reportId, isValid },
        )

        res.json({
          valid: isValid,
          reportId,
          integrityHash: report.integrityHash,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
