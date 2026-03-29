import crypto from 'node:crypto'
import type { Request } from 'express'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { getValidSecretVersions } from '../services/rotatingSecretProvider.js'

// Extend Express Request to support rawBody middleware
declare global {
  namespace Express {
    interface Request {
      rawBody?: string
    }
  }
}

export type PaymentRail = 'paystack' | 'flutterwave' | 'bank_transfer' | 'manual_admin' | 'psp'

export interface WebhookValidationResult {
  valid: boolean
  error?: string
}

/**
 * Check if webhook signature validation should be enforced
 * Production ALWAYS validates signatures
 */
export function shouldValidateWebhookSignature(): boolean {
  const nodeEnv = process.env.NODE_ENV
  if (nodeEnv === 'production') return true
  return process.env.WEBHOOK_SIGNATURE_ENABLED === 'true'
}

/**
 * Get the webhook secret for a specific provider
 * Returns undefined if not configured
 * Supports secret rotation - returns all valid versions
 */
export function getProviderSecret(rail: PaymentRail): string | undefined {
  // Try to get from rotation service first
  const secretNameMap: Record<PaymentRail, string | undefined> = {
    paystack: 'paystack_secret',
    flutterwave: 'flutterwave_secret',
    manual_admin: 'manual_admin_secret',
    psp: 'webhook_secret',
    bank_transfer: undefined,
  };

  const secretName = secretNameMap[rail];
  if (secretName) {
    const validVersions = getValidSecretVersions(secretName);
    if (validVersions.length > 0) {
      return validVersions[0]; // Return active version
    }
  }

  // Fallback to environment variables
  switch (rail) {
    case 'paystack':
      return process.env.PAYSTACK_SECRET
    case 'flutterwave':
      return process.env.FLUTTERWAVE_SECRET
    case 'manual_admin':
      return process.env.MANUAL_ADMIN_SECRET
    case 'bank_transfer':
      // Bank transfers don't use webhooks - validated via reconciliation
      return undefined
    case 'psp':
    default:
      // Fallback to legacy WEBHOOK_SECRET for stub provider
      return process.env.WEBHOOK_SECRET
  }
}

/**
 * Get all valid secret versions for a provider (for rotation support)
 */
export function getProviderSecretVersions(rail: PaymentRail): string[] {
  const secretNameMap: Record<PaymentRail, string | undefined> = {
    paystack: 'paystack_secret',
    flutterwave: 'flutterwave_secret',
    manual_admin: 'manual_admin_secret',
    psp: 'webhook_secret',
    bank_transfer: undefined,
  };

  const secretName = secretNameMap[rail];
  if (secretName) {
    const validVersions = getValidSecretVersions(secretName);
    if (validVersions.length > 0) {
      return validVersions;
    }
  }

  // Fallback to single environment variable
  const envSecret = getProviderSecret(rail);
  return envSecret ? [envSecret] : [];
}

/**
 * Paystack webhook signature verification
 * Uses HMAC-SHA512 with the secret key
 * Signature is sent in x-paystack-signature header
 * Payload is the raw request body as a string
 * Supports secret rotation - tries all valid secret versions
 */
export function verifyPaystackSignature(
  payload: string,
  signature: string,
  secrets: string[]
): WebhookValidationResult {
  if (!signature) {
    return { valid: false, error: 'Missing x-paystack-signature header' }
  }

  if (secrets.length === 0) {
    return { valid: false, error: 'Paystack secret not configured' }
  }

  // Try each valid secret version
  for (const secret of secrets) {
    const expectedSignature = crypto
      .createHmac('sha512', secret)
      .update(payload, 'utf8')
      .digest('hex')

    // Use timing-safe comparison to prevent timing attacks
    // Handle length mismatch gracefully
    if (signature.length === expectedSignature.length) {
      try {
        const isValid = crypto.timingSafeEqual(
          Buffer.from(signature, 'hex'),
          Buffer.from(expectedSignature, 'hex')
        )

        if (isValid) {
          return { valid: true }
        }
      } catch {
        // Continue to next secret version
      }
    }
  }

  return { valid: false, error: 'Invalid Paystack signature' }
}

/**
 * Flutterwave webhook signature verification
 * Uses a different scheme - typically includes signature in header
 * and may use HMAC or JWT depending on version
 * This implementation follows the standard webhook verification pattern:
 * - Signature in the 'verif-hash' header
 * - HMAC-SHA256 with the secret key
 * Supports secret rotation - tries all valid secret versions
 */
export function verifyFlutterwaveSignature(
  payload: string,
  signature: string,
  secrets: string[]
): WebhookValidationResult {
  if (!signature) {
    return { valid: false, error: 'Missing verif-hash header' }
  }

  if (secrets.length === 0) {
    return { valid: false, error: 'Flutterwave secret not configured' }
  }

  // Try each valid secret version
  for (const secret of secrets) {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload, 'utf8')
      .digest('hex')

    // Use timing-safe comparison
    try {
      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      )

      if (isValid) {
        return { valid: true }
      }
    } catch {
      // Continue to next secret version
    }
  }

  return { valid: false, error: 'Invalid Flutterwave signature' }
}

/**
 * Manual admin webhook signature verification
 * Uses simple shared secret comparison for admin-initiated operations
 * Signature is sent in x-admin-signature header
 * Supports secret rotation - tries all valid secret versions
 */
export function verifyManualAdminSignature(
  signature: string,
  secrets: string[]
): WebhookValidationResult {
  if (!signature) {
    return { valid: false, error: 'Missing x-admin-signature header' }
  }

  if (secrets.length === 0) {
    return { valid: false, error: 'Manual admin secret not configured' }
  }

  // Try each valid secret version
  for (const secret of secrets) {
    try {
      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature, 'utf8'),
        Buffer.from(secret, 'utf8')
      )

      if (isValid) {
        return { valid: true }
      }
    } catch {
      // Continue to next secret version
    }
  }

  return { valid: false, error: 'Invalid admin signature' }
}

/**
 * Bank transfer validation
 * Bank transfers do not use webhooks for validation
 * They are validated through reconciliation processes
 * This function always returns invalid with appropriate error
 */
export function verifyBankTransferSignature(): WebhookValidationResult {
  return {
    valid: false,
    error: 'Bank transfers do not support webhook signature validation. Use reconciliation instead.',
  }
}

/**
 * Legacy fallback signature verification (for backward compatibility)
 * Uses simple string comparison with WEBHOOK_SECRET
 * Supports secret rotation - tries all valid secret versions
 */
export function verifyLegacySignature(
  signature: string,
  secrets: string[]
): WebhookValidationResult {
  if (!signature) {
    return { valid: false, error: 'Missing x-webhook-signature header' }
  }

  if (secrets.length === 0) {
    return { valid: false, error: 'Webhook secret not configured' }
  }

  // Try each valid secret version
  for (const secret of secrets) {
    if (signature === secret) {
      return { valid: true }
    }
  }

  return { valid: false, error: 'Invalid webhook signature' }
}

/**
 * Extract raw body from request
 * Express body parsers may modify the body, so we need the raw body for HMAC
 */
export function getRawBody(req: Request): string {
  // If rawBody middleware is used, use that
  if (typeof req.rawBody === 'string') {
    return req.rawBody
  }

  // Otherwise, stringify the parsed body (less secure but works for validation)
  if (req.body) {
    return JSON.stringify(req.body)
  }

  return ''
}

/**
 * Main entry point for provider-specific webhook signature validation
 * Enforces:
 * - Production ALWAYS validates signatures
 * - Invalid signature => 401 UNAUTHORIZED
 * - Missing secret in prod => 500 INTERNAL_ERROR (misconfiguration)
 * Supports secret rotation - tries all valid secret versions
 */
export function requireValidWebhookSignature(req: Request, rail: PaymentRail): void {
  // Skip validation if not required
  if (!shouldValidateWebhookSignature()) {
    return
  }

  const secrets = getProviderSecretVersions(rail);

  // In production, missing secret is a 500 error (misconfiguration)
  if (secrets.length === 0 && process.env.NODE_ENV === 'production') {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      500,
      `Webhook secret not configured for ${rail} in production`
    )
  }

  // For bank transfers, skip webhook validation (reconciliation-based)
  if (rail === 'bank_transfer') {
    return
  }

  let result: WebhookValidationResult

  switch (rail) {
    case 'paystack': {
      const signature = req.headers['x-paystack-signature'] as string
      const rawBody = getRawBody(req)
      result = verifyPaystackSignature(rawBody, signature, secrets)
      break
    }

    case 'flutterwave': {
      const signature = req.headers['verif-hash'] as string
      const rawBody = getRawBody(req)
      result = verifyFlutterwaveSignature(rawBody, signature, secrets)
      break
    }

    case 'manual_admin': {
      const signature = req.headers['x-admin-signature'] as string
      result = verifyManualAdminSignature(signature, secrets)
      break
    }

    case 'psp':
    default: {
      // Legacy fallback
      const signature = req.headers['x-webhook-signature'] as string
      result = verifyLegacySignature(signature, secrets)
      break
    }
  }

  if (!result.valid) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 401, result.error || 'Invalid webhook signature')
  }
}

/**
 * Generate a test signature for a given provider (for test vectors)
 */
export function generateTestSignature(
  rail: PaymentRail,
  payload: string,
  secret: string
): string {
  switch (rail) {
    case 'paystack':
      return crypto.createHmac('sha512', secret).update(payload, 'utf8').digest('hex')

    case 'flutterwave':
      return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex')

    case 'manual_admin':
      return secret

    case 'psp':
    default:
      return secret
  }
}
