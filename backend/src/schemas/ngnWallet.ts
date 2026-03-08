import { z } from 'zod'

export const bankAccountDetailsSchema = z.object({
  accountNumber: z.string().min(10, 'Account number must be 10 digits').max(10, 'Account number must be 10 digits'),
  accountName: z.string().min(3, 'Account name is required').max(100, 'Account name too long'),
  bankName: z.string().min(3, 'Bank name is required').max(100, 'Bank name too long'),
})

export const withdrawalRequestSchema = z.object({
  amountNgn: z.number().min(100, 'Minimum withdrawal is 100 NGN').max(1000000, 'Maximum withdrawal is 1,000,000 NGN'),
  bankAccountRef: z.string().min(1, 'Bank account reference is required').optional(),
  bankAccount: bankAccountDetailsSchema.optional(),
}).superRefine((val, ctx) => {
  if (!val.bankAccountRef && !val.bankAccount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Either bankAccountRef or bankAccount is required',
      path: ['bankAccountRef'],
    })
  }
})

export const withdrawalResponseSchema = z.object({
  success: z.boolean().optional(),
  id: z.string(),
  amountNgn: z.number(),
  status: z.enum(['pending', 'approved', 'rejected', 'confirmed', 'failed', 'reversed']),
  bankAccount: bankAccountDetailsSchema,
  reference: z.string(),
  createdAt: z.string(),
  processedAt: z.string().nullable(),
  failureReason: z.string().nullable(),
})

export const withdrawalHistoryResponseSchema = z.object({
  success: z.boolean().optional(),
  entries: z.array(withdrawalResponseSchema),
  nextCursor: z.string().nullable(),
})

export const ngnBalanceResponseSchema = z.object({
  success: z.boolean().optional(),
  availableNgn: z.number(),
  heldNgn: z.number(),
  totalNgn: z.number(),
})

export const ngnLedgerEntrySchema = z.object({
  id: z.string(),
  type: z.enum(['top_up', 'topup_pending', 'topup_confirmed', 'top_up_reversed', 'topup_reversed', 'withdrawal', 'stake', 'stake_reserve', 'stake_release', 'unstake', 'reward', 'conversion_debit']),
  amountNgn: z.number(),
  status: z.enum(['pending', 'approved', 'rejected', 'confirmed', 'failed', 'reversed']),
  timestamp: z.string(),
  reference: z.string().nullable(),
})

export const ngnLedgerResponseSchema = z.object({
  success: z.boolean().optional(),
  entries: z.array(ngnLedgerEntrySchema),
  nextCursor: z.string().nullable(),
})

export type BankAccountDetails = z.infer<typeof bankAccountDetailsSchema>
export type WithdrawalRequest = z.infer<typeof withdrawalRequestSchema>
export type WithdrawalResponse = z.infer<typeof withdrawalResponseSchema>
export type WithdrawalHistoryResponse = z.infer<typeof withdrawalHistoryResponseSchema>
export type NgnBalanceResponse = z.infer<typeof ngnBalanceResponseSchema>
export type NgnLedgerEntry = z.infer<typeof ngnLedgerEntrySchema>
export type NgnLedgerResponse = z.infer<typeof ngnLedgerResponseSchema>
