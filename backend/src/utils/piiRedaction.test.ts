import { describe, it, expect } from 'vitest'
import { redactPiiFields } from './piiRedaction.js'

const R = '[REDACTED]'

/** Deep-freezes a value so any in-place mutation throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v)
    Object.freeze(value)
  }
  return value
}

describe('redactPiiFields', () => {
  describe('primitives pass through unchanged', () => {
    it.each([
      ['string', 'hello'],
      ['email-looking string', 'ada@example.com'],
      ['number', 42],
      ['zero', 0],
      ['boolean', false],
      ['null', null],
      ['undefined', undefined],
    ])('%s', (_label, value) => {
      expect(redactPiiFields(value)).toBe(value)
    })

    it.each([
      ['bigint', BigInt(10)],
      ['symbol', Symbol('s')],
      ['function', () => 1],
    ])('returns a %s unchanged', (_label, value) => {
      expect(redactPiiFields(value)).toBe(value)
    })
  })

  describe('top-level PII and secret keys', () => {
    it.each([
      // Registry PII fields
      ['email', 'ada@example.com'],
      ['phone', '+2348012345678'],
      ['nin', '12345678901'],
      ['bvn', '22222222222'],
      ['bankAccountNumber', '0123456789'],
      ['accountNumber', '0123456789'],
      ['dateOfBirth', '1990-01-01'],
      ['residentialAddress', '1 Marina, Lagos'],
      ['fullName', 'Ada Lovelace'],
      // Secret-like keys
      ['password', 'hunter2'],
      ['token', 'eyJhbGciOiJIUzI1NiJ9.e30.x'],
      ['accessToken', 'at_123'],
      ['refresh_token', 'rt_123'],
      ['authorization', 'Bearer abc'],
      ['apiKey', 'sk_live_123'],
      ['otp', '123456'],
      ['mnemonic', 'abandon abandon ...'],
      ['privateKey', 'S...'],
      ['clientSecret', 'cs_123'],
      ['dbCredentials', 'user:pass'],
    ])('redacts %s', (key, value) => {
      expect(redactPiiFields({ [key]: value, keep: 'ok' })).toEqual({ [key]: R, keep: 'ok' })
    })

    it.each(['EMAIL', 'Phone', 'PASSWORD', 'X-Auth-Token'])('matches keys case-insensitively (%s)', (key) => {
      expect(redactPiiFields({ [key]: 'v' })).toEqual({ [key]: R })
    })

    it('redacts a PII key even when its value is an object or null', () => {
      expect(redactPiiFields({ token: { raw: 'abc' }, email: null })).toEqual({ token: R, email: R })
    })

    it('leaves non-PII keys untouched', () => {
      const input = { userId: 'u1', amount: 5000, status: 'ok', walletId: 'w1' }
      expect(redactPiiFields(input)).toEqual(input)
    })
  })

  describe('nested objects and arrays', () => {
    it('redacts PII inside nested objects', () => {
      expect(
        redactPiiFields({ user: { id: 'u1', email: 'a@b.com', profile: { phone: '080', city: 'Lagos' } } }),
      ).toEqual({ user: { id: 'u1', email: R, profile: { phone: R, city: 'Lagos' } } })
    })

    it('redacts PII inside arrays of objects', () => {
      expect(
        redactPiiFields({ contacts: [{ email: 'a@b.com', id: 1 }, { phone: '080', id: 2 }] }),
      ).toEqual({ contacts: [{ email: R, id: 1 }, { phone: R, id: 2 }] })
    })

    it('handles a top-level array', () => {
      expect(redactPiiFields([{ token: 't' }, 'plain', 3])).toEqual([{ token: R }, 'plain', 3])
    })

    it('handles nested arrays', () => {
      expect(redactPiiFields({ a: [[{ password: 'x' }]] })).toEqual({ a: [[{ password: R }]] })
    })
  })

  describe('depth limit', () => {
    function nest(levels: number): Record<string, unknown> {
      let node: Record<string, unknown> = { leaf: 'value' }
      for (let i = 0; i < levels; i++) node = { child: node }
      return node
    }

    it('walks structures up to depth 20', () => {
      expect(JSON.stringify(redactPiiFields(nest(20)))).toContain('"leaf":"value"')
    })

    it('replaces anything deeper than 20 levels with the redaction marker', () => {
      const out = JSON.stringify(redactPiiFields(nest(25)))
      expect(out).not.toContain('"leaf"')
      expect(out).toContain(R)
    })

    it('returns the marker immediately when called with depth > 20', () => {
      expect(redactPiiFields({ a: 1 }, 21)).toBe(R)
    })

    it('terminates on a cyclic object', () => {
      const cyclic: Record<string, unknown> = { id: 1 }
      cyclic.self = cyclic
      expect(() => redactPiiFields(cyclic)).not.toThrow()
    })
  })

  describe('non-mutation of inputs', () => {
    it('does not mutate a nested input (deep-frozen)', () => {
      const input = deepFreeze({
        email: 'a@b.com',
        user: { token: 't', list: [{ phone: '080' }] },
      })
      const snapshot = JSON.parse(JSON.stringify(input))
      expect(() => redactPiiFields(input)).not.toThrow()
      expect(input).toEqual(snapshot)
    })

    it('returns new object and array instances', () => {
      const inner = { id: 1 }
      const list = [inner]
      const input = { inner, list }
      const out = redactPiiFields(input) as typeof input
      expect(out).not.toBe(input)
      expect(out.inner).not.toBe(inner)
      expect(out.list).not.toBe(list)
    })
  })

  describe('known limitations (reported)', () => {
    it('only redacts by key — PII embedded in a free-text value is kept', () => {
      // A logger call like { note: "call +2348012345678" } leaks the number.
      const out = redactPiiFields({ note: 'email ada@example.com or call +2348012345678' })
      expect(out).toEqual({ note: 'email ada@example.com or call +2348012345678' })
    })

    it('flattens Date instances to empty objects', () => {
      expect(redactPiiFields({ at: new Date('2026-01-01T00:00:00Z') })).toEqual({ at: {} })
    })

    it('redacts any key containing "token", including harmless counters', () => {
      expect(redactPiiFields({ tokenCount: 3 })).toEqual({ tokenCount: R })
    })
  })
})
