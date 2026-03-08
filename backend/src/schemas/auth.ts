import { z } from 'zod'

export const requestOtpSchema = z.object({
  email: z.string().email(),
})

export const verifyOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6),
})

export const walletChallengeSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
})

export const walletVerifySchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
  signature: z.string(),
})
