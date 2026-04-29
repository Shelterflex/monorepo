import { randomUUID } from 'node:crypto'
import crypto from 'node:crypto'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { complianceReportStore } from '../models/complianceReportStore.js'
import { kycRepository } from '../repositories/KycRepository.js'
import { auditLog, type AuditContext } from '../utils/auditLogger.js'

export interface TransactionRecord {
  id: string
  type: string
  amount: string
  currency: string
  userId: string
  timestamp: Date
  status: string
  metadata?: Record<string, unknown>
}

export interface KycRecord {
  id: string
  userId: string
  status: string
  documentType: string
  createdAt: Date
  updatedAt: Date
  provider?: string
  externalId?: string
}

export class ComplianceReportService {
  /**
   * Generate a compliance report asynchronously
   */
  async generateReport(reportId: string): Promise<void> {
    const report = complianceReportStore.findById(reportId)
    if (!report) {
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'Report not found')
    }

    try {
      let content: string

      if (report.reportType === 'transaction') {
        content = await this.generateTransactionReport(report)
      } else {
        content = await this.generateKycReport(report)
      }

      const hash = this.computeIntegrityHash(content)

      complianceReportStore.updateStatus(reportId, 'completed', hash, content)
    } catch (error) {
      complianceReportStore.updateStatus(reportId, 'failed')
      throw error
    }
  }

  private async generateTransactionReport(report: any): Promise<string> {
    const records: TransactionRecord[] = await this.fetchTransactionRecords(
      report.dateFrom,
      report.dateTo,
    )

    if (report.format === 'csv') {
      return this.formatTransactionsAsCsv(records)
    }
    return JSON.stringify(records, null, 2)
  }

  private async generateKycReport(report: any): Promise<string> {
    const records: KycRecord[] = await this.fetchKycRecords(
      report.dateFrom,
      report.dateTo,
    )

    if (report.format === 'csv') {
      return this.formatKycAsCsv(records)
    }
    return JSON.stringify(records, null, 2)
  }

  private async fetchTransactionRecords(
    dateFrom: Date,
    dateTo: Date,
  ): Promise<TransactionRecord[]> {
    // TODO: Replace with actual data source (e.g., transaction repository)
    return [
      {
        id: randomUUID(),
        type: 'deposit',
        amount: '1000.000000',
        currency: 'USDC',
        userId: 'user-123',
        timestamp: new Date(),
        status: 'completed',
      },
    ]
  }

  private async fetchKycRecords(
    dateFrom: Date,
    dateTo: Date,
  ): Promise<KycRecord[]> {
    try {
      const kycRecords = await kycRepository.findByDateRange(dateFrom, dateTo)
      return kycRecords.map((r) => ({
        id: r.id,
        userId: r.userId,
        status: r.status,
        documentType: r.documentType,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        provider: r.provider,
        externalId: r.externalId,
      }))
    } catch {
      return []
    }
  }

  private formatTransactionsAsCsv(records: TransactionRecord[]): string {
    const header = 'id,type,amount,currency,userId,timestamp,status\n'
    const rows = records
      .map(
        (r) =>
          `${r.id},${r.type},${r.amount},${r.currency},${r.userId},${r.timestamp.toISOString()},${r.status}`,
      )
      .join('\n')
    return header + rows
  }

  private formatKycAsCsv(records: KycRecord[]): string {
    const header = 'id,userId,status,documentType,createdAt,updatedAt,provider\n'
    const rows = records
      .map(
        (r) =>
          `${r.id},${r.userId},${r.status},${r.documentType},${r.createdAt.toISOString()},${r.updatedAt.toISOString()},${r.provider || ''}`,
      )
      .join('\n')
    return header + rows
  }

  computeIntegrityHash(content: string): string {
    return crypto
      .createHash('sha256')
      .update(content)
      .digest('hex')
  }

  verifyIntegrity(content: string, expectedHash: string): boolean {
    const actualHash = this.computeIntegrityHash(content)
    return actualHash === expectedHash
  }
}
