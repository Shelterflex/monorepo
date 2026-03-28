/**
 * Rotating Secret Provider
 * 
 * Provides secrets with automatic rotation and fallback support
 * Integrates with existing services that need secrets
 */

import { getSecretRotationService } from './secretRotationService.js';

/**
 * Get a secret with rotation support
 */
export function getRotatingSecret(secretName: string): string | undefined {
  const service = getSecretRotationService();
  return service.getSecret(secretName);
}

/**
 * Get all valid versions of a secret (for validation with fallback)
 */
export function getValidSecretVersions(secretName: string): string[] {
  const service = getSecretRotationService();
  return service.getValidSecretVersions(secretName);
}

/**
 * Try an operation with automatic fallback to older secret versions
 */
export async function tryWithRotatingSecret<T>(
  secretName: string,
  operation: (secret: string) => Promise<T>
): Promise<T> {
  const service = getSecretRotationService();
  return service.tryWithSecret(secretName, operation);
}

/**
 * Webhook signature validator with rotation support
 * Tries current secret first, then falls back to valid older versions
 */
export async function validateWebhookSignatureWithRotation(
  payload: string,
  signature: string,
  secretName: string,
  algorithm: 'sha256' | 'sha512' = 'sha256'
): Promise<boolean> {
  const crypto = await import('crypto');
  const validSecrets = getValidSecretVersions(secretName);

  if (validSecrets.length === 0) {
    throw new Error(`No valid secrets available for: ${secretName}`);
  }

  // Try each valid secret version
  for (const secret of validSecrets) {
    const hmac = crypto.createHmac(algorithm, secret);
    hmac.update(payload);
    const expectedSignature = hmac.digest('hex');

    // Constant-time comparison to prevent timing attacks
    if (crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )) {
      return true;
    }
  }

  return false;
}

/**
 * Get encryption key with rotation support
 */
export function getRotatingEncryptionKey(): string {
  const key = getRotatingSecret('encryption_key');
  if (!key) {
    throw new Error('Encryption key not available');
  }
  return key;
}

/**
 * Get custodial wallet master key with rotation support
 */
export function getRotatingCustodialKey(version: number): string | undefined {
  const secretName = version === 2 
    ? 'custodial_wallet_master_key_v2' 
    : 'custodial_wallet_master_key_v1';
  return getRotatingSecret(secretName);
}

/**
 * Get API key with rotation support
 */
export function getRotatingAPIKey(provider: 'paystack' | 'flutterwave' | 'resend'): string | undefined {
  const secretMap = {
    paystack: 'paystack_secret',
    flutterwave: 'flutterwave_secret',
    resend: 'resend_api_key',
  };
  return getRotatingSecret(secretMap[provider]);
}
