import { z } from 'zod'

export const requestOtpSchema = z.object({
  email: z.string().email(),
})

export const verifyOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6),
})

export const walletChallengeSchema = z.object({
  address: z.string().regex(/^G[A-Z0-9]{55}$/, 'Invalid Stellar public key'),
})

export const walletVerifySchema = z.object({
  address: z.string().regex(/^G[A-Z0-9]{55}$/, 'Invalid Stellar public key'),
  signedChallengeXdr: z.string(),
})
