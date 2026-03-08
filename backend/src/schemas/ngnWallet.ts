import { z } from 'zod'
import { LedgerEntryType } from '../models/ngnWallet.js'

export const bankAccountDetailsSchema = z.object({
  accountNumber: z.string().min(10, 'Account number must be 10 digits').max(10, 'Account number must be 10 digits'),
  accountName: z.string().min(3, 'Account name is required').max(100, 'Account name too long'),
  bankName: z.string().min(3, 'Bank name is required').max(100, 'Bank name too long'),
})

export const withdrawalRequestSchema = z.object({
  amountNgn: z.number().min(100, 'Minimum withdrawal is 100 NGN').max(1000000, 'Maximum withdrawal is 1,000,000 NGN'),
  bankAccount: bankAccountDetailsSchema,
})

export const withdrawalResponseSchema = z.object({
  success: z.boolean().optional(),
  id: z.string(),
  amountNgn: z.number(),
  status: z.enum(['pending', 'approved', 'rejected', 'confirmed', 'failed']),
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
  availableBalanceNgn: z.number(),
  heldBalanceNgn: z.number(),
  totalBalanceNgn: z.number(),
})

export const ledgerEntryTypeSchema = z.nativeEnum(LedgerEntryType)

export const ngnLedgerEntrySchema = z.object({
  id: z.string(),
  type: z.string(),
  amountNgn: z.number(),
  status: z.enum(['pending', 'approved', 'rejected', 'confirmed', 'failed']),
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
