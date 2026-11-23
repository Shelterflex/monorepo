import { describe, it, expect, afterEach, vi } from 'vitest'

// otp.ts uses a named import, so wrap timingSafeEqual at the module level to observe it.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  return { ...actual, default: actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) }
})

import { timingSafeEqual } from 'node:crypto'
import { generateOtpSalt, hashOtp, verifyOtpHash } from './otp.js'

/*
 * Known-answer vectors for hashOtp = SHA-256("<salt>:<otp>"), generated
 * independently with Python's hashlib and `openssl dgst -sha256`.
 */
const VECTORS = [
  {
    salt: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    otp: '123456',
    hash: '273c5af299806d5610e7b0a517395f2176a08f056447489349e4e70af7028d01',
  },
  {
    salt: '00000000000000000000000000000000',
    otp: '000000',
    hash: '44dec39e77e89b6a807177b97401f4c0240f39e4b2c658b45f45259583143414',
  },
] as const

const [V1, V2] = VECTORS

describe('generateOtpSalt', () => {
  it('returns 16 random bytes as 32 lower-case hex characters', () => {
    expect(generateOtpSalt()).toMatch(/^[0-9a-f]{32}$/)
  })

  it('does not repeat across many calls', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => generateOtpSalt()))
    expect(seen.size).toBe(1000)
  })
})

describe('hashOtp', () => {
  it.each(VECTORS)('matches the known answer for salt=$salt otp=$otp', ({ salt, otp, hash }) => {
    expect(hashOtp(otp, salt)).toBe(hash)
  })

  it('changes when the salt changes', () => {
    expect(hashOtp(V1.otp, V2.salt)).not.toBe(V1.hash)
  })

  it('changes when the OTP changes', () => {
    expect(hashOtp('123457', V1.salt)).not.toBe(V1.hash)
  })

  it('is not the unsalted SHA-256 of the OTP', () => {
    // SHA-256("123456"), independently computed.
    expect(hashOtp('123456', '')).not.toBe(
      '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92',
    )
  })
})

describe('verifyOtpHash', () => {
  afterEach(() => {
    vi.mocked(timingSafeEqual).mockClear()
  })

  it.each(VECTORS)('accepts the right OTP and salt ($otp)', ({ salt, otp, hash }) => {
    expect(verifyOtpHash(otp, salt, hash)).toBe(true)
  })

  it('round-trips with a freshly generated salt', () => {
    const salt = generateOtpSalt()
    expect(verifyOtpHash('654321', salt, hashOtp('654321', salt))).toBe(true)
  })

  it('accepts an upper-case stored hash', () => {
    expect(verifyOtpHash(V1.otp, V1.salt, V1.hash.toUpperCase())).toBe(true)
  })

  it.each([
    ['wrong OTP', '123457', V1.salt],
    ['OTP with extra digit', '1234567', V1.salt],
    ['OTP with leading/trailing space', ' 123456', V1.salt],
    ['empty OTP', '', V1.salt],
    ['wrong salt', V1.otp, V2.salt],
    ['empty salt', V1.otp, ''],
  ])('rejects: %s', (_label, otp, salt) => {
    expect(verifyOtpHash(otp, salt, V1.hash)).toBe(false)
  })

  it('rejects a stored hash with one flipped nibble', () => {
    const tampered = (V1.hash[0] === '0' ? '1' : '0') + V1.hash.slice(1)
    expect(verifyOtpHash(V1.otp, V1.salt, tampered)).toBe(false)
  })

  it.each([
    ['empty', ''],
    ['truncated', V1.hash.slice(0, 62)],
    ['too long', V1.hash + '00'],
    ['non-hex', 'z'.repeat(64)],
  ])('returns false without throwing for a %s stored hash', (_label, stored) => {
    expect(() => verifyOtpHash(V1.otp, V1.salt, stored)).not.toThrow()
    expect(verifyOtpHash(V1.otp, V1.salt, stored)).toBe(false)
  })

  it('compares with crypto.timingSafeEqual on equal-length input', () => {
    expect(verifyOtpHash('000001', V1.salt, V1.hash)).toBe(false)
    expect(timingSafeEqual).toHaveBeenCalledTimes(1)
  })

  it('skips timingSafeEqual when the stored hash length differs', () => {
    verifyOtpHash(V1.otp, V1.salt, 'abcd')
    expect(timingSafeEqual).not.toHaveBeenCalled()
  })

  // BUG (reported): Buffer.from(hex) drops a trailing odd nibble / stops at the first
  // non-hex character, so a stored hash with appended junk still verifies.
  it.fails('rejects a stored hash with trailing junk', () => {
    expect(verifyOtpHash(V1.otp, V1.salt, V1.hash + 'x')).toBe(false)
  })
})
