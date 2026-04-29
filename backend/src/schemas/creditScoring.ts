import { z } from 'zod'

export const riskBandSchema = z.enum(['low', 'medium', 'high', 'declined'])

export const factorWeightSchema = z.object({
  factorName: z.string().min(1).max(50),
  weight: z.number().min(0).max(100),
  normalization: z.enum(['linear', 'logarithmic', 'exponential']).default('linear'),
})

export const creditScoreSchema = z.object({
  tenantId: z.string().min(1).max(128),
  paymentHistoryScore: z.number().min(0).max(100).optional(),
  applicationDataScore: z.number().min(0).max(100).optional(),
  behavioralScore: z.number().min(0).max(100).optional(),
})

export type CreditScoreRequest = z.infer<typeof creditScoreSchema>
export type FactorWeight = z.infer<typeof factorWeightSchema>
export type RiskBand = z.infer<typeof riskBandSchema>

export const overrideSchema = z.object({
  tenantId: z.string().min(1).max(128),
  manualScore: z.number().min(0).max(1000),
  reason: z.string().min(1).max(500),
})

export type OverrideRequest = z.infer<typeof overrideSchema>

export const configSchema = z.object({
  factorWeights: z.array(factorWeightSchema).min(1),
  riskBandThresholds: z.object({
    low: z.number().min(0).max(1000),
    medium: z.number().min(0).max(1000),
    high: z.number().min(0).max(1000),
    declined: z.number().min(0).max(1000),
  }),
})

export type CreditScoreConfig = z.infer<typeof configSchema>
