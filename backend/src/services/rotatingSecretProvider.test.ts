import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Each test gets a fresh, real SecretRotationService instead of the process singleton.
const holder = vi.hoisted(() => ({ service: undefined as unknown }))
vi.mock('./secretRotationService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./secretRotationService.js')>()
  return { ...actual, getSecretRotationService: () => holder.service }
})

import { SecretRotationService } from './secretRotationService.js'
import {
  getRotatingSecret,
  getValidSecretVersions,
  tryWithRotatingSecret,
  validateWebhookSignatureWithRotation,
  getRotatingEncryptionKey,
  getRotatingCustodialKey,
  getRotatingAPIKey,
} from './rotatingSecretProvider.js'

// RFC 4231 test case 2 (key "Jefe").
const RFC4231_KEY = 'Jefe'
const RFC4231_DATA = 'what do ya want for nothing?'
const RFC4231_SHA256 = '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'
const RFC4231_SHA512 =
  '164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737'

let service: SecretRotationService
let auditDir: string

/** Registers `name` with an initial value supplied via a throwaway env var. */
function register(name: string, value: string): void {
  const envVar = `TEST_ROTATING_${name.toUpperCase()}`
  vi.stubEnv(envVar, value)
  service.registerSecret({ name, envVar, required: false })
}

describe('rotatingSecretProvider', () => {
  beforeAll(() => {
    // rotateSecret() appends to an audit file; keep it out of the repo.
    auditDir = mkdtempSync(join(tmpdir(), 'rotating-secret-test-'))
  })

  afterAll(() => {
    rmSync(auditDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    vi.stubEnv('AUDIT_LOG_DIR', auditDir)
    service = new SecretRotationService()
    holder.service = service
  })

  afterEach(() => {
    service.stopWatching()
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  describe('getRotatingSecret', () => {
    it('returns the active value of a registered secret', () => {
      register('svc_secret', 'initial-value')
      expect(getRotatingSecret('svc_secret')).toBe('initial-value')
    })

    it('returns the new value immediately after rotation', async () => {
      register('svc_secret', 'old')
      await service.rotateSecret('svc_secret', 'new', { version: 'v2' })
      expect(getRotatingSecret('svc_secret')).toBe('new')
    })

    it('returns undefined for an unknown secret', () => {
      expect(getRotatingSecret('nope')).toBeUndefined()
    })
  })

  describe('getValidSecretVersions — rotation overlap window', () => {
    it('returns an empty list for an unknown secret', () => {
      expect(getValidSecretVersions('nope')).toEqual([])
    })

    it('returns only the current value before any rotation', () => {
      register('overlap', 'v1-value')
      expect(getValidSecretVersions('overlap')).toEqual(['v1-value'])
    })

    it('keeps the old value valid during the grace period and drops it after', async () => {
      const t0 = new Date('2026-01-01T00:00:00.000Z').getTime()
      vi.useFakeTimers()
      vi.setSystemTime(t0)
      register('overlap', 'old')

      const graceMs = 60_000
      await service.rotateSecret('overlap', 'new', { gracePeriodMs: graceMs, version: 'v2' })

      // [ms after rotation, expected valid versions]
      const table: Array<[number, string[]]> = [
        [0, ['old', 'new']],
        [graceMs / 2, ['old', 'new']],
        [graceMs - 1, ['old', 'new']],
        // Expiry check is `expiresAt > now`, so exactly at the boundary the old value is gone.
        [graceMs, ['new']],
        [graceMs + 1, ['new']],
      ]

      for (const [offset, expected] of table) {
        vi.setSystemTime(t0 + offset)
        expect(getValidSecretVersions('overlap'), `at +${offset}ms`).toEqual(expected)
      }
      // Active value is unaffected by the expiry of older versions.
      expect(getRotatingSecret('overlap')).toBe('new')
    })

    it('a zero grace period invalidates the old value immediately', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
      register('overlap', 'old')
      await service.rotateSecret('overlap', 'new', { gracePeriodMs: 0, version: 'v2' })
      expect(getValidSecretVersions('overlap')).toEqual(['new'])
    })

    it('three overlapping versions are all valid until each grace window ends', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
      register('overlap', 'a')
      await service.rotateSecret('overlap', 'b', { gracePeriodMs: 10_000, version: 'v2' })
      vi.advanceTimersByTime(5_000)
      await service.rotateSecret('overlap', 'c', { gracePeriodMs: 10_000, version: 'v3' })
      expect(getValidSecretVersions('overlap')).toEqual(['a', 'b', 'c'])
      vi.advanceTimersByTime(5_000) // a expires (10s after first rotation)
      expect(getValidSecretVersions('overlap')).toEqual(['b', 'c'])
      vi.advanceTimersByTime(5_000) // b expires (10s after second rotation)
      expect(getValidSecretVersions('overlap')).toEqual(['c'])
    })
  })

  describe('tryWithRotatingSecret', () => {
    it('uses the active secret first', async () => {
      register('op', 'old')
      await service.rotateSecret('op', 'new', { gracePeriodMs: 60_000, version: 'v2' })
      const op = vi.fn(async (s: string) => `ok:${s}`)
      await expect(tryWithRotatingSecret('op', op)).resolves.toBe('ok:new')
      expect(op).toHaveBeenCalledTimes(1)
      expect(op).toHaveBeenCalledWith('new')
    })

    it('falls back to an older version still inside the overlap window', async () => {
      register('op', 'old')
      await service.rotateSecret('op', 'new', { gracePeriodMs: 60_000, version: 'v2' })
      const op = vi.fn(async (s: string) => {
        if (s !== 'old') throw new Error('rejected')
        return 'ok'
      })
      await expect(tryWithRotatingSecret('op', op)).resolves.toBe('ok')
      expect(op.mock.calls.map((c) => c[0])).toEqual(['new', 'old'])
    })

    it('rejects when every valid version fails', async () => {
      register('op', 'only')
      const op = vi.fn(async () => {
        throw new Error('always fails')
      })
      await expect(tryWithRotatingSecret('op', op)).rejects.toThrow()
    })

    it('rejects when the secret has no valid versions', async () => {
      const op = vi.fn()
      await expect(tryWithRotatingSecret('missing', op)).rejects.toThrow(
        'No valid versions available for secret: missing',
      )
      expect(op).not.toHaveBeenCalled()
    })
  })

  describe('validateWebhookSignatureWithRotation', () => {
    it('accepts an RFC 4231 SHA-256 signature for the current secret', async () => {
      register('wh', RFC4231_KEY)
      await expect(
        validateWebhookSignatureWithRotation(RFC4231_DATA, RFC4231_SHA256, 'wh'),
      ).resolves.toBe(true)
    })

    it('accepts an RFC 4231 SHA-512 signature when algorithm is sha512', async () => {
      register('wh', RFC4231_KEY)
      await expect(
        validateWebhookSignatureWithRotation(RFC4231_DATA, RFC4231_SHA512, 'wh', 'sha512'),
      ).resolves.toBe(true)
    })

    it('accepts a signature made with the previous secret during the overlap window', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
      register('wh', RFC4231_KEY)
      await service.rotateSecret('wh', 'brand-new-secret', { gracePeriodMs: 60_000, version: 'v2' })

      await expect(
        validateWebhookSignatureWithRotation(RFC4231_DATA, RFC4231_SHA256, 'wh'),
      ).resolves.toBe(true)

      vi.advanceTimersByTime(60_000)
      await expect(
        validateWebhookSignatureWithRotation(RFC4231_DATA, RFC4231_SHA256, 'wh'),
      ).resolves.toBe(false)
    })

    it('rejects a same-length signature that does not match', async () => {
      register('wh', RFC4231_KEY)
      const tampered = '0' + RFC4231_SHA256.slice(1)
      await expect(
        validateWebhookSignatureWithRotation(RFC4231_DATA, tampered, 'wh'),
      ).resolves.toBe(false)
    })

    it('rejects a valid signature for a tampered payload', async () => {
      register('wh', RFC4231_KEY)
      await expect(
        validateWebhookSignatureWithRotation(RFC4231_DATA + ' ', RFC4231_SHA256, 'wh'),
      ).resolves.toBe(false)
    })

    it('rejects a SHA-256 signature when sha512 is requested', async () => {
      register('wh', RFC4231_KEY)
      // BUG (reported): a length mismatch makes timingSafeEqual throw instead of returning false.
      await expect(
        validateWebhookSignatureWithRotation(RFC4231_DATA, RFC4231_SHA256, 'wh', 'sha512'),
      ).rejects.toThrow(RangeError)
    })

    it('throws (rather than returning false) for a wrong-length signature', async () => {
      register('wh', RFC4231_KEY)
      // BUG (reported): callers must wrap this in try/catch or a malformed header becomes a 500.
      await expect(validateWebhookSignatureWithRotation(RFC4231_DATA, 'abc', 'wh')).rejects.toThrow(
        RangeError,
      )
      await expect(validateWebhookSignatureWithRotation(RFC4231_DATA, '', 'wh')).rejects.toThrow(
        RangeError,
      )
    })

    it('throws when no secret versions are available', async () => {
      await expect(
        validateWebhookSignatureWithRotation(RFC4231_DATA, RFC4231_SHA256, 'missing'),
      ).rejects.toThrow('No valid secrets available for: missing')
    })
  })

  describe('getRotatingEncryptionKey', () => {
    it('returns the active encryption key', () => {
      register('encryption_key', 'enc-key-1')
      expect(getRotatingEncryptionKey()).toBe('enc-key-1')
    })

    it('throws when the encryption key is not registered', () => {
      expect(() => getRotatingEncryptionKey()).toThrow('Encryption key not available')
    })
  })

  describe('getRotatingCustodialKey', () => {
    beforeEach(() => {
      register('custodial_wallet_master_key_v1', 'master-v1')
      register('custodial_wallet_master_key_v2', 'master-v2')
    })

    // [version, expected]. Any version other than 2 falls back to the v1 key.
    const table: Array<[number, string]> = [
      [2, 'master-v2'],
      [1, 'master-v1'],
      [0, 'master-v1'],
      [3, 'master-v1'],
      [-1, 'master-v1'],
      [Number.NaN, 'master-v1'],
    ]

    it.each(table)('version %s → %s', (version, expected) => {
      expect(getRotatingCustodialKey(version)).toBe(expected)
    })

    it('returns undefined when the selected key is not registered', () => {
      service = new SecretRotationService()
      holder.service = service
      expect(getRotatingCustodialKey(1)).toBeUndefined()
      expect(getRotatingCustodialKey(2)).toBeUndefined()
    })
  })

  describe('getRotatingAPIKey', () => {
    const table: Array<['paystack' | 'flutterwave' | 'resend', string]> = [
      ['paystack', 'paystack_secret'],
      ['flutterwave', 'flutterwave_secret'],
      ['resend', 'resend_api_key'],
    ]

    it.each(table)('maps %s to the %s secret', (provider, secretName) => {
      register(secretName, `${provider}-key`)
      expect(getRotatingAPIKey(provider)).toBe(`${provider}-key`)
    })

    it('returns undefined when the provider key is not registered', () => {
      expect(getRotatingAPIKey('paystack')).toBeUndefined()
    })

    it('returns undefined for an unknown provider at runtime', () => {
      register('paystack_secret', 'x')
      expect(getRotatingAPIKey('stripe' as 'paystack')).toBeUndefined()
    })
  })
})
