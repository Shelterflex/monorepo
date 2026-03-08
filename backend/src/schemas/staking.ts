import { z } from 'zod'
import { TxType } from '../outbox/types.js'

/**
 * Schema for staking request
 */
export const stakeSchema = z.object({
  amountUsdc: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/, 'Must be a positive decimal with up to 6 places (USDC is canonical)')
    .describe('Amount to stake in USDC (canonical unit)'),
  externalRefSource: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Must be alphanumeric with underscores/hyphens only')
    .describe('Staking provider source identifier (e.g., manual, stellar)'),
  externalRef: z
    .string()
    .min(1)
    .describe('Provider-specific staking reference string'),
})

export type StakeRequest = z.infer<typeof stakeSchema>

/**
 * Schema for unstaking request
 */
export const unstakeSchema = z.object({
  amountUsdc: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/, 'Must be a positive decimal with up to 6 places (USDC is canonical)')
    .describe('Amount to unstake in USDC (canonical unit)'),
  externalRefSource: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Must be alphanumeric with underscores/hyphens only')
    .describe('Unstaking provider source identifier (e.g., manual, stellar)'),
  externalRef: z
    .string()
    .min(1)
    .describe('Provider-specific unstaking reference string'),
})

export type UnstakeRequest = z.infer<typeof unstakeSchema>

/**
 * Schema for claiming staking rewards
 */
export const claimStakeRewardSchema = z.object({
  externalRefSource: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Must be alphanumeric with underscores/hyphens only')
    .describe('Claim provider source identifier (e.g., manual, stellar)'),
  externalRef: z
    .string()
    .min(1)
    .describe('Provider-specific claim reference string'),
})

export type ClaimStakeRewardRequest = z.infer<typeof claimStakeRewardSchema>

/**
 * Schema for staking with NGN balance
 */
export const stakeNgnSchema = z.object({
  amountNgn: z
    .number()
    .positive()
    .min(100, 'Minimum staking amount is 100 NGN')
    .describe('Amount to stake in NGN'),
  externalRefSource: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Must be alphanumeric with underscores/hyphens only')
    .describe('Staking source identifier (e.g., web, mobile)'),
  externalRef: z
    .string()
    .min(1)
    .describe('External reference for idempotency (e.g., UUID, transaction ID)'),
})

export type StakeNgnRequest = z.infer<typeof stakeNgnSchema>

/**
 * Schema for staking position response
 */
export const stakingPositionSchema = z.object({
  staked: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/, 'Must be a positive decimal with up to 6 places')
    .describe('Total amount currently staked in USDC'),
  claimable: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/, 'Must be a positive decimal with up to 6 places')
    .describe('Amount of rewards available for claiming in USDC'),
})

export type StakingPositionResponse = z.infer<typeof stakingPositionSchema>
