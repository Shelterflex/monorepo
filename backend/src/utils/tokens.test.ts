import { describe, it, expect, afterEach, vi } from 'vitest'
import { generateOtp, generateToken, generateId } from './tokens.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('generateOtp', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns exactly six digits', () => {
    for (let i = 0; i < 500; i++) {
      expect(generateOtp()).toMatch(/^\d{6}$/)
    }
  })

  // Table of Math.random() outputs → expected OTP. Covers both ends of [0, 1).
  it.each([
    [0, '100000'],
    [0.5, '550000'],
    [1 - Number.EPSILON, '999999'],
  ])('Math.random() = %s → %s', (r, expected) => {
    vi.spyOn(Math, 'random').mockReturnValue(r)
    expect(generateOtp()).toBe(expected)
  })

  it('never produces a value below 100000 or above 999999', () => {
    for (let i = 0; i < 2000; i++) {
      const n = Number(generateOtp())
      expect(n).toBeGreaterThanOrEqual(100000)
      expect(n).toBeLessThanOrEqual(999999)
    }
  })

  it('spreads values roughly uniformly across the range', () => {
    // 9 buckets by leading digit (1–9); each should get ~1/9 of samples.
    const samples = 9000
    const buckets = new Array(10).fill(0)
    for (let i = 0; i < samples; i++) buckets[Number(generateOtp()[0])]++
    expect(buckets[0]).toBe(0) // leading zero is impossible
    for (let d = 1; d <= 9; d++) {
      // Expected 1000 per bucket; ±30% is far outside normal variance (σ≈31).
      expect(buckets[d]).toBeGreaterThan(700)
      expect(buckets[d]).toBeLessThan(1300)
    }
  })

  it('is driven by Math.random rather than a CSPRNG', () => {
    // BUG (reported): OTPs come from Math.random(), which is not cryptographically
    // secure. This test pins the current behaviour so a fix is a deliberate change.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.123456)
    generateOtp()
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('generateToken', () => {
  it('returns 32 random bytes as 64 lower-case hex characters', () => {
    expect(generateToken()).toMatch(/^[0-9a-f]{64}$/)
  })

  it('does not repeat across many calls', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => generateToken()))
    expect(seen.size).toBe(1000)
  })

  it('uses every hex symbol with roughly equal frequency', () => {
    const counts = new Map<string, number>()
    const total = 200 * 64
    for (let i = 0; i < 200; i++) {
      for (const ch of generateToken()) counts.set(ch, (counts.get(ch) ?? 0) + 1)
    }
    expect(counts.size).toBe(16)
    for (const c of counts.values()) {
      // Expected 800 each; bounds are ~±10σ.
      expect(c).toBeGreaterThan(total / 16 - 300)
      expect(c).toBeLessThan(total / 16 + 300)
    }
  })

  it('is not an OTP-sized or empty value', () => {
    const t = generateToken()
    expect(t).not.toBe('')
    expect(t).not.toMatch(/^\d{6}$/)
  })
})

describe('generateId', () => {
  it('returns an RFC 4122 version 4 UUID', () => {
    expect(generateId()).toMatch(UUID_V4)
  })

  it('does not repeat across many calls', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => generateId()))
    expect(seen.size).toBe(1000)
  })

  it('never returns the nil UUID', () => {
    expect(generateId()).not.toBe('00000000-0000-0000-0000-000000000000')
  })
})
