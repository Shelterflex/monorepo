import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'

export function generateOtpSalt(): string {
  return randomBytes(16).toString('hex')
}

export function hashOtp(otp: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${otp}`).digest('hex')
}

export function verifyOtpHash(otp: string, salt: string, expectedHash: string): boolean {
  const actual = hashOtp(otp, salt)

  // constant-time compare
  const a = Buffer.from(actual, 'hex')
  const b = Buffer.from(expectedHash, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
