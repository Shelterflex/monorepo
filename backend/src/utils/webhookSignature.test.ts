import crypto from 'crypto'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { verifyHmacSha256 } from './webhookSignature.js'

/*
 * Known-answer vectors. None of these are computed with the code under test:
 *  - RFC 4231 test case 2 (HMAC-SHA-256, key "Jefe").
 *  - The remaining vectors were generated independently with Python's `hmac`
 *    module and cross-checked with `openssl dgst -sha256 -hmac`.
 */
const VECTORS = [
  {
    name: 'RFC 4231 test case 2',
    secret: 'Jefe',
    body: 'what do ya want for nothing?',
    sig: '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
  },
  {
    name: 'Paystack-style JSON body',
    secret: 'sk_test_secret',
    body: '{"event":"charge.success","data":{"reference":"ref_123","amount":500000}}',
    sig: 'a86a2e338be891ae21498255efac4a7b6bcc9b93d111cbb9795cef32609b08ae',
  },
  {
    name: 'empty body',
    secret: 'whsec_test',
    body: '',
    sig: '43c0f4d23c8e8841358fad4624b1a592799222b29f25bb59baea43cdcb522ed1',
  },
  {
    name: 'unicode body (UTF-8 encoded)',
    secret: 'whsec_test',
    body: '{"event":"charge.success","customer":"Adébáyọ̀ ₦"}',
    sig: '63903cf7514a6f3940eb6f075dbad944b700911f0bedfa66c45e0f526fbb36f8',
  },
] as const

const [RFC] = VECTORS

describe('verifyHmacSha256', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('valid signatures', () => {
    it.each(VECTORS)('accepts the known-answer signature: $name', ({ secret, body, sig }) => {
      expect(verifyHmacSha256(secret, body, sig)).toBe(true)
    })

    it('accepts a "sha256=" prefixed signature (GitHub style)', () => {
      expect(verifyHmacSha256(RFC.secret, RFC.body, `sha256=${RFC.sig}`)).toBe(true)
    })

    it('accepts an upper-case hex signature', () => {
      expect(verifyHmacSha256(RFC.secret, RFC.body, RFC.sig.toUpperCase())).toBe(true)
    })
  })

  describe('invalid signatures', () => {
    it.each(VECTORS)('rejects a signature with one flipped nibble: $name', ({ secret, body, sig }) => {
      const flipped = (sig[0] === '0' ? '1' : '0') + sig.slice(1)
      expect(verifyHmacSha256(secret, body, flipped)).toBe(false)
    })

    it('rejects the right signature with the wrong secret', () => {
      expect(verifyHmacSha256('jefe', RFC.body, RFC.sig)).toBe(false)
    })

    it('rejects a tampered body', () => {
      expect(verifyHmacSha256(RFC.secret, RFC.body + ' ', RFC.sig)).toBe(false)
    })

    it('treats unicode normalisation differences as tampering', () => {
      const unicode = VECTORS[3]
      // NFD form encodes to different bytes than the signed NFC body.
      expect(verifyHmacSha256(unicode.secret, unicode.body.normalize('NFD'), unicode.sig)).toBe(false)
    })

    it('rejects a signature over a different body (empty vs non-empty)', () => {
      const empty = VECTORS[2]
      expect(verifyHmacSha256(empty.secret, 'x', empty.sig)).toBe(false)
    })

    it('rejects a sha512-style prefix (only "sha256=" is stripped)', () => {
      expect(verifyHmacSha256(RFC.secret, RFC.body, `sha512=${RFC.sig}`)).toBe(false)
    })
  })

  describe('wrong length', () => {
    // [description, signature]
    const cases: Array<[string, string]> = [
      ['empty string', ''],
      ['"sha256=" with nothing after it', 'sha256='],
      ['truncated to 31 bytes', RFC.sig.slice(0, 62)],
      ['one byte too long', RFC.sig + '00'],
      ['double length', RFC.sig + RFC.sig],
      ['base64 instead of hex', Buffer.from(RFC.sig, 'hex').toString('base64')],
      ['non-hex characters', 'z'.repeat(64)],
    ]

    it.each(cases)('returns false (does not throw) for %s', (_label, sig) => {
      expect(() => verifyHmacSha256(RFC.secret, RFC.body, sig)).not.toThrow()
      expect(verifyHmacSha256(RFC.secret, RFC.body, sig)).toBe(false)
    })

    it('does not call timingSafeEqual when lengths differ', () => {
      const spy = vi.spyOn(crypto, 'timingSafeEqual')
      verifyHmacSha256(RFC.secret, RFC.body, 'abcd')
      expect(spy).not.toHaveBeenCalled()
    })

    // BUG (reported): Buffer.from(hex) silently stops at the first non-hex character
    // and drops a trailing odd nibble, so a valid signature followed by junk decodes
    // to the same 32 bytes and is accepted. These document the desired behaviour.
    it.fails('rejects a valid signature with a trailing odd nibble', () => {
      expect(verifyHmacSha256(RFC.secret, RFC.body, RFC.sig + 'a')).toBe(false)
    })

    it.fails('rejects a valid signature followed by non-hex junk', () => {
      expect(verifyHmacSha256(RFC.secret, RFC.body, RFC.sig + 'zz-junk')).toBe(false)
    })
  })

  describe('timing-safe comparison', () => {
    it('compares equal-length buffers with crypto.timingSafeEqual', () => {
      const spy = vi.spyOn(crypto, 'timingSafeEqual')
      expect(verifyHmacSha256(RFC.secret, RFC.body, RFC.sig)).toBe(true)
      expect(spy).toHaveBeenCalledTimes(1)
      const [a, b] = spy.mock.calls[0]
      expect(Buffer.isBuffer(a) && Buffer.isBuffer(b)).toBe(true)
      expect((a as Buffer).length).toBe(32)
      expect((b as Buffer).length).toBe(32)
    })

    it('uses timingSafeEqual for a mismatching signature too (no early exit on content)', () => {
      const spy = vi.spyOn(crypto, 'timingSafeEqual')
      const wrongLastByte = RFC.sig.slice(0, 62) + '00'
      expect(verifyHmacSha256(RFC.secret, RFC.body, wrongLastByte)).toBe(false)
      expect(spy).toHaveBeenCalledTimes(1)
    })
  })
})
