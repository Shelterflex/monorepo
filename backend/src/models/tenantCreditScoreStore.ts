import { randomUUID } from 'node:crypto'
import { riskBandSchema } from '../schemas/creditScoring.js'
import type { RiskBand } from '../schemas/creditScoring.js'

export interface CreditScoreRecord {
  id: string
  tenantId: string
  computedScore: number
  riskBand: RiskBand
  factorInputs: Record<string, number>
  factorWeights: Record<string, number>
  triggeredRules?: string[]
  manualOverride?: {
    score: number
    reason: string
    overriddenBy: string
    overriddenAt: Date
  }
  createdAt: Date
  updatedAt: Date
}

class TenantCreditScoreStore {
  private scores: Map<string, CreditScoreRecord> = new Map()
  private config: {
    factorWeights: Array<{ factorName: string; weight: number; normalization: string }>
    riskBandThresholds: { low: number; medium: number; high: number; declined: number }
  } = {
    factorWeights: [
      { factorName: 'paymentHistory', weight: 35, normalization: 'linear' },
      { factorName: 'applicationData', weight: 30, normalization: 'linear' },
      { factorName: 'behavioralSignals', weight: 20, normalization: 'linear' },
      { factorName: 'rentalHistory', weight: 15, normalization: 'linear' },
    ],
    riskBandThresholds: { low: 700, medium: 500, high: 300, declined: 0 },
  }

  setConfig(config: {
    factorWeights: Array<{ factorName: string; weight: number; normalization: string }>
    riskBandThresholds: { low: number; medium: number; high: number; declined: number }
  }): void {
    this.config = config
  }

  getConfig(): {
    factorWeights: Array<{ factorName: string; weight: number; normalization: string }>
    riskBandThresholds: { low: number; medium: number; high: number; declined: number }
  } {
    return this.config
  }

  create(record: {
    tenantId: string
    computedScore: number
    riskBand: RiskBand
    factorInputs: Record<string, number>
    factorWeights: Record<string, number>
    triggeredRules?: string[]
  }): CreditScoreRecord {
    const id = randomUUID()
    const now = new Date()
    const scoreRecord: CreditScoreRecord = {
      id,
      tenantId: record.tenantId,
      computedScore: record.computedScore,
      riskBand: record.riskBand,
      factorInputs: record.factorInputs,
      factorWeights: record.factorWeights,
      triggeredRules: record.triggeredRules,
      createdAt: now,
      updatedAt: now,
    }
    this.scores.set(id, scoreRecord)
    return scoreRecord
  }

  findByTenantId(tenantId: string): CreditScoreRecord | undefined {
    for (const record of this.scores.values()) {
      if (record.tenantId === tenantId) {
        return record
      }
    }
    return undefined
  }

  findById(id: string): CreditScoreRecord | undefined {
    return this.scores.get(id)
  }

  updateOverride(
    id: string,
    override: { score: number; reason: string; overriddenBy: string },
  ): CreditScoreRecord | undefined {
    const record = this.scores.get(id)
    if (!record) return undefined

    record.manualOverride = {
      score: override.score,
      reason: override.reason,
      overriddenBy: override.overriddenBy,
      overriddenAt: new Date(),
    }
    record.updatedAt = new Date()
    this.scores.set(id, record)
    return record
  }

  search(filters: {
    tenantId?: string
    riskBand?: RiskBand
    minScore?: number
    maxScore?: number
    page?: number
    pageSize?: number
  }): { records: CreditScoreRecord[]; total: number } {
    let filtered = Array.from(this.scores.values())

    if (filters.tenantId) {
      filtered = filtered.filter((r) => r.tenantId === filters.tenantId)
    }

    if (filters.riskBand) {
      filtered = filtered.filter((r) => r.riskBand === filters.riskBand)
    }

    if (filters.minScore !== undefined) {
      filtered = filtered.filter((r) => r.computedScore >= filters.minScore!)
    }

    if (filters.maxScore !== undefined) {
      filtered = filtered.filter((r) => r.computedScore <= filters.maxScore!)
    }

    const total = filtered.length
    const page = filters.page || 1
    const pageSize = filters.pageSize || 20
    const start = (page - 1) * pageSize
    const paginated = filtered.slice(start, start + pageSize)

    return { records: paginated, total }
  }
}

export const tenantCreditScoreStore = new TenantCreditScoreStore()
