import { randomUUID } from 'node:crypto'
import { appEventEmitter } from '../utils/eventEmitter.js'
import { auditLog, type AuditContext } from '../utils/auditLogger.js'

export interface ComplianceReport {
  reportId: string
  reportType: 'transaction' | 'kyc'
  format: 'json' | 'csv'
  dateFrom: Date
  dateTo: Date
  jurisdiction?: string
  status: 'pending' | 'completed' | 'failed'
  integrityHash?: string
  content?: string
  generatedAt?: Date
  createdAt: Date
  accessLog: Array<{
    userId: string
    accessedAt: Date
    ipAddress?: string
  }>
}

class ComplianceReportStore {
  private reports: Map<string, ComplianceReport> = new Map()

  create(data: {
    reportType: 'transaction' | 'kyc'
    format: 'json' | 'csv'
    dateFrom: Date
    dateTo: Date
    jurisdiction?: string
  }): ComplianceReport {
    const report: ComplianceReport = {
      reportId: randomUUID(),
      reportType: data.reportType,
      format: data.format,
      dateFrom: data.dateFrom,
      dateTo: data.dateTo,
      jurisdiction: data.jurisdiction,
      status: 'pending',
      createdAt: new Date(),
      accessLog: [],
    }

    this.reports.set(report.reportId, report)
    return report
  }

  findById(reportId: string): ComplianceReport | undefined {
    return this.reports.get(reportId)
  }

  updateStatus(
    reportId: string,
    status: 'pending' | 'completed' | 'failed',
    integrityHash?: string,
    content?: string,
  ): ComplianceReport | undefined {
    const report = this.reports.get(reportId)
    if (!report) return undefined

    report.status = status
    if (integrityHash) report.integrityHash = integrityHash
    if (content) report.content = content
    if (status === 'completed') report.generatedAt = new Date()

    this.reports.set(reportId, report)
    return report
  }

  logAccess(reportId: string, userId: string, ipAddress?: string): void {
    const report = this.reports.get(reportId)
    if (!report) return

    report.accessLog.push({
      userId,
      accessedAt: new Date(),
      ipAddress,
    })

    this.reports.set(reportId, report)
  }

  search(filters: {
    reportType?: 'transaction' | 'kyc'
    status?: 'pending' | 'completed' | 'failed'
    dateFrom?: Date
    dateTo?: Date
    page?: number
    pageSize?: number
  }): { reports: ComplianceReport[]; total: number } {
    let filtered = Array.from(this.reports.values())

    if (filters.reportType) {
      filtered = filtered.filter((r) => r.reportType === filters.reportType)
    }

    if (filters.status) {
      filtered = filtered.filter((r) => r.status === filters.status)
    }

    if (filters.dateFrom) {
      filtered = filtered.filter((r) => r.createdAt >= filters.dateFrom!)
    }

    if (filters.dateTo) {
      filtered = filtered.filter((r) => r.createdAt <= filters.dateTo!)
    }

    const total = filtered.length
    const page = filters.page || 1
    const pageSize = filters.pageSize || 20
    const start = (page - 1) * pageSize
    const paginated = filtered.slice(start, start + pageSize)

    return { reports: paginated, total }
  }
}

export const complianceReportStore = new ComplianceReportStore()
