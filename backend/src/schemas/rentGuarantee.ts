import { z } from 'zod'

/**
 * Insurance claim request for POST /insurance/:policyId/claim
 * Validates claim submission data
 */
export const insuranceClaimBodySchema = z
  .object({
    reason: z
      .string()
      .min(1)
      .max(500)
      .describe('Reason for the claim (e.g., "non-payment", "tenant-default")'),
    claimAmount: z
      .number()
      .positive()
      .describe('Amount being claimed in NGN'),
    description: z
      .string()
      .min(1)
      .max(2000)
      .optional()
      .describe('Detailed description of the claim'),
    claimDate: z
      .string()
      .datetime()
      .optional()
      .describe('ISO 8601 date when the claim incident occurred'),
  })
  .strict()

export type InsuranceClaimBody = z.infer<typeof insuranceClaimBodySchema>
