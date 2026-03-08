import { z } from 'zod'

export const walletAddressResponseSchema = z.object({
  success: z.boolean(),
  address: z.string(),
})

export type WalletAddressResponse = z.infer<typeof walletAddressResponseSchema>

export const walletCreationResponseSchema = z.object({
  success: z.boolean(),
  address: z.string(),
})

export type WalletCreationResponse = z.infer<typeof walletCreationResponseSchema>

export const signMessageRequestSchema = z.object({
  message: z.string().min(1, 'Message is required'),
})

export type SignMessageRequest = z.infer<typeof signMessageRequestSchema>

export const signMessageResponseSchema = z.object({
  success: z.boolean(),
  signature: z.string(),
  publicKey: z.string(),
})

export type SignMessageResponse = z.infer<typeof signMessageResponseSchema>

export const signTransactionRequestSchema = z.object({
  xdr: z.string().min(1, 'XDR is required'),
})

export type SignTransactionRequest = z.infer<typeof signTransactionRequestSchema>

export const signTransactionResponseSchema = z.object({
  success: z.boolean(),
  signature: z.string(),
  publicKey: z.string(),
})

export type SignTransactionResponse = z.infer<typeof signTransactionResponseSchema>
