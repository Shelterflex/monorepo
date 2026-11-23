import { describe, it, expect } from 'vitest'
import { sha256Hex, jsonPayloadSha256Hex, generateRandomSecretHex } from './sha256.js'

/*
 * Known-answer vectors. "" and "abc" are the FIPS 180-2 / NIST examples; the rest
 * were produced independently with Python's hashlib and `openssl dgst -sha256`.
 */
const SHA256_EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const SHA256_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
const SHA256_UNICODE = 'd0b03f0849afbf94cfa56452e25a5af7d642941783bac606f2973de91ccede99' // "₦5,000 — café 🏠"
const SHA256_NULL = '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b' // "null"
const SHA256_OBJ = '5ad23549920813d0132a4f30550d22969aed9a11742f48c948f69210506150e5' // {"amount":5000,"currency":"NGN","tags":["a","b"]}
const SHA256_STR = '5aa762ae383fbb727af3c7a36d4940a5b8c40a989452d2304fc958ff3f354e7a' // "\"hello\""

const HEX_64 = /^[0-9a-f]{64}$/

describe('sha256Hex', () => {
  it.each([
    ['empty string', '', SHA256_EMPTY],
    ['"abc"', 'abc', SHA256_ABC],
    ['unicode (UTF-8 encoded)', '₦5,000 — café 🏠', SHA256_UNICODE],
    ['"null"', 'null', SHA256_NULL],
  ])('matches the known answer for %s', (_label, input, expected) => {
    expect(sha256Hex(input)).toBe(expected)
  })

  it('returns 64 lower-case hex characters', () => {
    expect(sha256Hex('anything')).toMatch(HEX_64)
  })

  it('produces a different digest for a one-character change', () => {
    expect(sha256Hex('abd')).not.toBe(SHA256_ABC)
    expect(sha256Hex('abc ')).not.toBe(SHA256_ABC)
  })
})

describe('jsonPayloadSha256Hex', () => {
  it('hashes the JSON.stringify form of an object', () => {
    expect(jsonPayloadSha256Hex({ amount: 5000, currency: 'NGN', tags: ['a', 'b'] })).toBe(SHA256_OBJ)
  })

  it('hashes a string payload including its JSON quotes', () => {
    expect(jsonPayloadSha256Hex('hello')).toBe(SHA256_STR)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('treats %s as JSON null', (_label, value) => {
    expect(jsonPayloadSha256Hex(value)).toBe(SHA256_NULL)
  })

  it('ignores properties JSON cannot represent', () => {
    expect(
      jsonPayloadSha256Hex({ amount: 5000, currency: 'NGN', tags: ['a', 'b'], fn: () => 1, u: undefined }),
    ).toBe(SHA256_OBJ)
  })

  it('is key-order sensitive (not canonical JSON)', () => {
    // Documented limitation: the doc comment says "Stable JSON" but key order changes the hash.
    expect(jsonPayloadSha256Hex({ currency: 'NGN', amount: 5000, tags: ['a', 'b'] })).not.toBe(SHA256_OBJ)
  })

  it('throws on values JSON.stringify cannot serialise', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => jsonPayloadSha256Hex(cyclic)).toThrow(TypeError)
    expect(() => jsonPayloadSha256Hex({ n: BigInt(1) })).toThrow(TypeError)
  })
})

describe('generateRandomSecretHex', () => {
  it('defaults to 24 bytes (48 hex characters)', () => {
    expect(generateRandomSecretHex()).toMatch(/^[0-9a-f]{48}$/)
  })

  it.each([1, 16, 32, 64])('returns %i bytes as 2× hex characters', (n) => {
    expect(generateRandomSecretHex(n)).toMatch(new RegExp(`^[0-9a-f]{${n * 2}}$`))
  })

  it('returns an empty string for zero bytes', () => {
    expect(generateRandomSecretHex(0)).toBe('')
  })

  it.each([-1, Number.NaN, 2 ** 31])('throws for an invalid byte count (%s)', (n) => {
    expect(() => generateRandomSecretHex(n)).toThrow()
  })

  it('silently truncates a fractional byte count', () => {
    // Quirk (reported): 1.5 is floored to 1 byte rather than rejected.
    expect(generateRandomSecretHex(1.5)).toMatch(/^[0-9a-f]{2}$/)
  })

  it('does not repeat across many calls', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => generateRandomSecretHex()))
    expect(seen.size).toBe(1000)
  })
})
