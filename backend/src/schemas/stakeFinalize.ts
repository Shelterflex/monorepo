import { z } from 'zod'

export const stakeFinalizeSchema = z.object({
  conversionId: z.string().min(1),
})

export type StakeFinalizeRequest = z.infer<typeof stakeFinalizeSchema>
