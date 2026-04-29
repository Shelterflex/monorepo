import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { tenantCreditScoreStore, type CreditScoreRecord } from '../models/tenantCreditScoreStore.js'
import type { RiskBand, FactorWeight } from '../schemas/creditScoring.js'

export class TenantCreditScoringService {
  /**
   * Compute a credit score from factor inputs using configured weights
   */
  computeScore(factorInputs: Record<string, number>): {
    score: number
    riskBand: RiskBand
    factorWeights: Record<string, number>
    triggeredRules: string[]
  } {
    const config = tenantCreditScoreStore.getConfig()
    
    // Validate weights sum to 100
    const totalWeight = config.factorWeights.reduce((sum, f) => sum + f.weight, 0)
    if (totalWeight !== 100) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        400,
        `Factor weights must sum to 100, got ${totalWeight}`,
      )
    }

    let weightedScore = 0
    const appliedWeights: Record<string, number> = {}
    const triggeredRules: string[] = []

    for (const factor of config.factorWeights) {
      const inputValue = factorInputs[factor.factorName] ?? 0
      
      // Normalize the input value (assuming input is 0-100 scale)
      let normalizedValue = inputValue
      if (factor.normalization === 'logarithmic') {
        normalizedValue = Math.log1p(inputValue) * (100 / Math.log1p(100))
      } else if (factor.normalization === 'exponential') {
        normalizedValue = (Math.exp(inputValue / 100) - 1) * (100 / (Math.E - 1))
      }
      
      // Clamp to 0-100
      normalizedValue = Math.max(0, Math.min(100, normalizedValue))
      
      weightedScore += (normalizedValue * factor.weight) / 100
      appliedWeights[factor.factorName] = factor.weight

      // Check for triggered rules
      if (factor.factorName === 'paymentHistory' && inputValue < 50) {
        triggeredRules.push('poor_payment_history')
      }
      if (factor.factorName === 'applicationData' && inputValue < 40) {
        triggeredRules.push('incomplete_application_data')
      }
      if (factor.factorName === 'behavioralSignals' && inputValue < 30) {
        triggeredRules.push('concerning_behavioral_signals')
      }
    }

    // Round to integer
    const score = Math.round(weightedScore)
    
    // Determine risk band
    const thresholds = config.riskBandThresholds
    let riskBand: RiskBand = 'declined'
    if (score >= thresholds.low) {
      riskBand = 'low'
    } else if (score >= thresholds.medium) {
      riskBand = 'medium'
    } else if (score >= thresholds.high) {
      riskBand = 'high'
    }

    return { score, riskBand, factorWeights: appliedWeights, triggeredRules }
  }

  /**
   * Score a tenant and store the result
   */
  scoreTenant(
    tenantId: string,
    factorInputs: Record<string, number>,
    triggeredRules?: string[],
  ): CreditScoreRecord {
    const { score, riskBand, factorWeights, triggeredRules: rules } = this.computeScore(factorInputs)

    const record = tenantCreditScoreStore.create({
      tenantId,
      computedScore: score,
      riskBand,
      factorInputs,
      factorWeights,
      triggeredRules: triggeredRules || rules,
    })

    return record
  }

  /**
   * Manually override a tenant's credit score
   */
  overrideScore(
    tenantId: string,
    manualScore: number,
    reason: string,
    overriddenBy: string,
  ): CreditScoreRecord {
    const existingRecord = tenantCreditScoreStore.findByTenantId(tenantId)
    if (!existingRecord) {
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'Credit score record not found for tenant')
    }

    const updated = tenantCreditScoreStore.updateOverride(existingRecord.id, {
      score: manualScore,
      reason,
      overriddenBy,
    })

    if (!updated) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 500, 'Failed to update override')
    }

    return updated
  }

  /**
   * Get a tenant's credit score
   */
  getTenantScore(tenantId: string): CreditScoreRecord | undefined {
    return tenantCreditScoreStore.findByTenantId(tenantId)
  }

  /**
   * Update scoring configuration
   */
  updateConfig(factorWeights: FactorWeight[], riskBandThresholds: {
    low: number
    medium: number
    high: number
    declined: number
  }): void {
    // Validate weights sum to 100
    const totalWeight = factorWeights.reduce((sum, f) => sum + f.weight, 0)
    if (totalWeight !== 100) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        400,
        `Factor weights must sum to 100, got ${totalWeight}`,
      )
    }

    // Validate thresholds are in correct order
    if (riskBandThresholds.low <= riskBandThresholds.medium) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        400,
        'Low threshold must be greater than medium threshold',
      )
    }
    if (riskBandThresholds.medium <= riskBandThresholds.high) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        400,
        'Medium threshold must be greater than high threshold',
      )
    }
    if (riskBandThresholds.high <= riskBandThresholds.declined) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        400,
        'High threshold must be greater than declined threshold',
      )
    }

    tenantCreditScoreStore.setConfig({
      factorWeights: factorWeights.map(f => ({
        factorName: f.factorName,
        weight: f.weight,
        normalization: f.normalization || 'linear',
      })),
      riskBandThresholds,
    })
  }

  /**
   * Get current configuration
   */
  getConfig(): {
    factorWeights: Array<{ factorName: string; weight: number; normalization: string }>
    riskBandThresholds: { low: number; medium: number; high: number; declined: number }
  } {
    return tenantCreditScoreStore.getConfig()
  }
}
