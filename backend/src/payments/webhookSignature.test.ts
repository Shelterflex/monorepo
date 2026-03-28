import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  shouldValidateWebhookSignature,
  getProviderSecret,
  verifyPaystackSignature,
  verifyFlutterwaveSignature,
  verifyManualAdminSignature,
  verifyBankTransferSignature,
  verifyLegacySignature,
  generateTestSignature,
  requireValidWebhookSignature,
  type PaymentRail,
} from './webhookSignature.js'
import { AppError } from '../errors/AppError.js'

describe('webhookSignature', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Clear webhook-related env vars before each test
    delete process.env.NODE_ENV
    delete process.env.WEBHOOK_SIGNATURE_ENABLED
    delete process.env.WEBHOOK_SECRET
    delete process.env.PAYSTACK_SECRET
    delete process.env.FLUTTERWAVE_SECRET
    delete process.env.MANUAL_ADMIN_SECRET
  })

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv }
  })

  describe('shouldValidateWebhookSignature', () => {
    it('returns true in production', () => {
      process.env.NODE_ENV = 'production'
      expect(shouldValidateWebhookSignature()).toBe(true)
    })

    it('returns false in development by default', () => {
      process.env.NODE_ENV = 'development'
      expect(shouldValidateWebhookSignature()).toBe(false)
    })

    it('returns true when WEBHOOK_SIGNATURE_ENABLED is true', () => {
      process.env.NODE_ENV = 'development'
      process.env.WEBHOOK_SIGNATURE_ENABLED = 'true'
      expect(shouldValidateWebhookSignature()).toBe(true)
    })

    it('returns false when WEBHOOK_SIGNATURE_ENABLED is false', () => {
      process.env.NODE_ENV = 'development'
      process.env.WEBHOOK_SIGNATURE_ENABLED = 'false'
      expect(shouldValidateWebhookSignature()).toBe(false)
    })

    it('production takes precedence over WEBHOOK_SIGNATURE_ENABLED', () => {
      process.env.NODE_ENV = 'production'
      process.env.WEBHOOK_SIGNATURE_ENABLED = 'false'
      expect(shouldValidateWebhookSignature()).toBe(true)
    })
  })

  describe('getProviderSecret', () => {
    it('returns PAYSTACK_SECRET for paystack', () => {
      process.env.PAYSTACK_SECRET = 'paystack_secret_123'
      expect(getProviderSecret('paystack')).toBe('paystack_secret_123')
    })

    it('returns FLUTTERWAVE_SECRET for flutterwave', () => {
      process.env.FLUTTERWAVE_SECRET = 'flutterwave_secret_456'
      expect(getProviderSecret('flutterwave')).toBe('flutterwave_secret_456')
    })

    it('returns MANUAL_ADMIN_SECRET for manual_admin', () => {
      process.env.MANUAL_ADMIN_SECRET = 'admin_secret_789'
      expect(getProviderSecret('manual_admin')).toBe('admin_secret_789')
    })

    it('returns undefined for bank_transfer', () => {
      expect(getProviderSecret('bank_transfer')).toBeUndefined()
    })

    it('returns WEBHOOK_SECRET for psp (legacy)', () => {
      process.env.WEBHOOK_SECRET = 'legacy_secret_000'
      expect(getProviderSecret('psp')).toBe('legacy_secret_000')
    })

    it('returns undefined when secret is not set', () => {
      expect(getProviderSecret('paystack')).toBeUndefined()
      expect(getProviderSecret('flutterwave')).toBeUndefined()
      expect(getProviderSecret('manual_admin')).toBeUndefined()
    })
  })

  describe('verifyPaystackSignature', () => {
    const secret = 'sk_test_1234567890abcdef'
    const payload = '{"event":"charge.success","data":{"reference":"pi_test_001"}}'

    it('returns valid for correct HMAC-SHA512 signature', () => {
      const crypto = require('node:crypto')
      const validSignature = crypto
        .createHmac('sha512', secret)
        .update(payload, 'utf8')
        .digest('hex')

      const result = verifyPaystackSignature(payload, validSignature, [secret])
      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('returns invalid for wrong signature', () => {
      const result = verifyPaystackSignature(payload, 'invalid_signature', [secret])
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid Paystack signature')
    })

    it('returns invalid for missing signature', () => {
      const result = verifyPaystackSignature(payload, '', [secret])
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Missing x-paystack-signature header')
    })

    it('returns invalid for missing secret', () => {
      const crypto = require('node:crypto')
      const validSignature = crypto
        .createHmac('sha512', secret)
        .update(payload, 'utf8')
        .digest('hex')

      const result = verifyPaystackSignature(payload, validSignature, [])
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Paystack secret not configured')
    })

    it('uses timing-safe comparison to prevent timing attacks', () => {
      // Create a valid signature
      const crypto = require('node:crypto')
      const validSignature = crypto
        .createHmac('sha512', secret)
        .update(payload, 'utf8')
        .digest('hex')

      // Modify one character - should fail with timing-safe comparison
      const modifiedSignature = validSignature.slice(0, -1) + (validSignature.slice(-1) === 'a' ? 'b' : 'a')

      const result = verifyPaystackSignature(payload, modifiedSignature, [secret])
      expect(result.valid).toBe(false)
    })
  })

  describe('verifyFlutterwaveSignature', () => {
    const secret = 'flwsec_test_1234567890'
    const payload = '{"event":"charge.completed","data":{"tx_ref":"pi_test_002"}}'

    it('returns valid for correct HMAC-SHA256 signature', () => {
      const crypto = require('node:crypto')
      const validSignature = crypto
        .createHmac('sha256', secret)
        .update(payload, 'utf8')
        .digest('hex')

      const result = verifyFlutterwaveSignature(payload, validSignature, [secret])
      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('returns invalid for wrong signature', () => {
      const result = verifyFlutterwaveSignature(payload, 'wrong_signature', [secret])
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid Flutterwave signature')
    })

    it('returns invalid for missing signature', () => {
      const result = verifyFlutterwaveSignature(payload, '', [secret])
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Missing verif-hash header')
    })

    it('returns invalid for missing secret', () => {
      const crypto = require('node:crypto')
      const validSignature = crypto
        .createHmac('sha256', secret)
        .update(payload, 'utf8')
        .digest('hex')

      const result = verifyFlutterwaveSignature(payload, validSignature, [])
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Flutterwave secret not configured')
    })

    it('returns invalid for signature format errors', () => {
      // Odd-length hex string will cause Buffer error
      const result = verifyFlutterwaveSignature(payload, 'abc', [secret])
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid Flutterwave signature')
    })
  })

  describe('verifyManualAdminSignature', () => {
    const secret = 'admin_secret_key_12345'

    it('returns valid for matching signature', () => {
      const result = verifyManualAdminSignature(secret, [secret])
      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('returns invalid for non-matching signature', () => {
      const result = verifyManualAdminSignature('wrong_secret', [secret])
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid admin signature')
    })

    it('returns invalid for missing signature', () => {
      const result = verifyManualAdminSignature('', [secret])
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Missing x-admin-signature header')
    })

    it('returns invalid for missing secret', () => {
      const result = verifyManualAdminSignature(secret, [])
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Manual admin secret not configured')
    })
  })

  describe('verifyBankTransferSignature', () => {
    it('always returns invalid with explanatory message', () => {
      const result = verifyBankTransferSignature()
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Bank transfers do not support webhook signature validation. Use reconciliation instead.')
    })
  })

  describe('verifyLegacySignature', () => {
    const secret = 'webhook_secret_legacy'

    it('returns valid for matching signature', () => {
      const result = verifyLegacySignature(secret, [secret])
      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('returns invalid for non-matching signature', () => {
      const result = verifyLegacySignature('wrong_secret', [secret])
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid webhook signature')
    })

    it('returns invalid for missing signature', () => {
      const result = verifyLegacySignature('', [secret])
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Missing x-webhook-signature header')
    })

    it('returns invalid for missing secret', () => {
      const result = verifyLegacySignature(secret, [])
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Webhook secret not configured')
    })
  })

  describe('generateTestSignature', () => {
    const secret = 'test_secret_123'
    const payload = '{"test":"data"}'

    it('generates HMAC-SHA512 for paystack', () => {
      const crypto = require('node:crypto')
      const expected = crypto.createHmac('sha512', secret).update(payload, 'utf8').digest('hex')
      expect(generateTestSignature('paystack', payload, secret)).toBe(expected)
    })

    it('generates HMAC-SHA256 for flutterwave', () => {
      const crypto = require('node:crypto')
      const expected = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex')
      expect(generateTestSignature('flutterwave', payload, secret)).toBe(expected)
    })

    it('returns secret as-is for manual_admin', () => {
      expect(generateTestSignature('manual_admin', payload, secret)).toBe(secret)
    })

    it('returns secret as-is for psp (legacy)', () => {
      expect(generateTestSignature('psp', payload, secret)).toBe(secret)
    })
  })

  describe('requireValidWebhookSignature', () => {
    const createMockRequest = (headers: Record<string, string>, body?: unknown) => {
      return {
        headers,
        body,
        rawBody: body ? JSON.stringify(body) : undefined,
      } as any
    }

    beforeEach(() => {
      process.env.WEBHOOK_SIGNATURE_ENABLED = 'true'
    })

    it('throws 401 for invalid paystack signature', () => {
      process.env.PAYSTACK_SECRET = 'paystack_secret'
      const req = createMockRequest(
        { 'x-paystack-signature': 'invalid_signature' },
        { event: 'charge.success' }
      )

      expect(() => requireValidWebhookSignature(req, 'paystack')).toThrow(AppError)
      expect(() => requireValidWebhookSignature(req, 'paystack')).toThrow('Invalid Paystack signature')

      try {
        requireValidWebhookSignature(req, 'paystack')
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        expect((error as AppError).status).toBe(401)
        expect((error as AppError).code).toBe('UNAUTHORIZED')
      }
    })

    it('throws 401 for invalid flutterwave signature', () => {
      process.env.FLUTTERWAVE_SECRET = 'flutterwave_secret'
      const req = createMockRequest(
        { 'verif-hash': 'invalid_signature' },
        { event: 'charge.completed' }
      )

      expect(() => requireValidWebhookSignature(req, 'flutterwave')).toThrow(AppError)
      expect(() => requireValidWebhookSignature(req, 'flutterwave')).toThrow('Invalid Flutterwave signature')
    })

    it('throws 401 for invalid manual_admin signature', () => {
      process.env.MANUAL_ADMIN_SECRET = 'admin_secret'
      const req = createMockRequest(
        { 'x-admin-signature': 'wrong_secret' },
        { action: 'manual_deposit' }
      )

      expect(() => requireValidWebhookSignature(req, 'manual_admin')).toThrow(AppError)
      expect(() => requireValidWebhookSignature(req, 'manual_admin')).toThrow('Invalid admin signature')
    })

    it('throws 500 in production when secret is missing', () => {
      process.env.NODE_ENV = 'production'
      // Ensure PAYSTACK_SECRET is not set
      delete process.env.PAYSTACK_SECRET

      const req = createMockRequest(
        { 'x-paystack-signature': 'some_signature' },
        { event: 'charge.success' }
      )

      expect(() => requireValidWebhookSignature(req, 'paystack')).toThrow(AppError)

      try {
        requireValidWebhookSignature(req, 'paystack')
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        expect((error as AppError).status).toBe(500)
        expect((error as AppError).code).toBe('INTERNAL_ERROR')
        expect((error as AppError).message).toContain('Webhook secret not configured for paystack in production')
      }
    })

    it('passes validation when signature is valid for paystack', () => {
      const crypto = require('node:crypto')
      const secret = 'paystack_secret'
      const payload = '{"event":"charge.success"}'
      const validSignature = crypto.createHmac('sha512', secret).update(payload, 'utf8').digest('hex')

      process.env.PAYSTACK_SECRET = secret
      const req = createMockRequest(
        { 'x-paystack-signature': validSignature },
        { event: 'charge.success' }
      )

      // Should not throw
      expect(() => requireValidWebhookSignature(req, 'paystack')).not.toThrow()
    })

    it('passes validation when signature is valid for flutterwave', () => {
      const crypto = require('node:crypto')
      const secret = 'flutterwave_secret'
      const payload = '{"event":"charge.completed"}'
      const validSignature = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex')

      process.env.FLUTTERWAVE_SECRET = secret
      const req = createMockRequest(
        { 'verif-hash': validSignature },
        { event: 'charge.completed' }
      )

      // Should not throw
      expect(() => requireValidWebhookSignature(req, 'flutterwave')).not.toThrow()
    })

    it('passes validation for bank_transfer (no webhook validation)', () => {
      const req = createMockRequest({}, {})

      // Should not throw - bank transfers use reconciliation
      expect(() => requireValidWebhookSignature(req, 'bank_transfer')).not.toThrow()
    })

    it('skips validation when shouldValidateWebhookSignature returns false', () => {
      process.env.WEBHOOK_SIGNATURE_ENABLED = 'false'
      process.env.NODE_ENV = 'development'

      const req = createMockRequest({}, {})

      // Should not throw even with no signature
      expect(() => requireValidWebhookSignature(req, 'paystack')).not.toThrow()
    })

    it('always validates in production even with WEBHOOK_SIGNATURE_ENABLED=false', () => {
      process.env.NODE_ENV = 'production'
      process.env.WEBHOOK_SIGNATURE_ENABLED = 'false'
      process.env.PAYSTACK_SECRET = 'paystack_secret'

      const req = createMockRequest(
        { 'x-paystack-signature': 'invalid' },
        { event: 'charge.success' }
      )

      // Should throw because production always validates
      expect(() => requireValidWebhookSignature(req, 'paystack')).toThrow()
    })
  })
})
