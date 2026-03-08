import { z } from 'zod'

export const stakeFromDepositSchema = z.object({
  conversionId: z.string().min(1).describe('Conversion ID returned by deposit confirmation'),
})

export type StakeFromDepositRequest = z.infer<typeof stakeFromDepositSchema>
