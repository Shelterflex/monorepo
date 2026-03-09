# Webhook Signature Verification

This document describes the provider-specific webhook signature verification implementation.

## Overview

Webhook signature validation is **ALWAYS enforced in production**. Invalid signatures result in a `401 Unauthorized` response. Missing webhook secrets in production result in a `500 Internal Server Error` (indicating a configuration issue).

## Supported Payment Providers

### Paystack

**Signature Scheme**: HMAC-SHA512

**Required Environment Variable**:
```bash
PAYSTACK_SECRET=your_paystack_secret_key
```

**Webhook Header**: `x-paystack-signature`

**Verification Method**:
- The signature is an HMAC-SHA512 hash of the raw request body
- The secret key is used as the HMAC key
- The signature is sent as a hex-encoded string in the header
- We use timing-safe comparison to prevent timing attacks

**Example**:
```http
POST /api/webhooks/payments/paystack
Content-Type: application/json
x-paystack-signature: abc123...

{"event":"charge.success","data":{"reference":"pi_123"}}
```

---

### Flutterwave

**Signature Scheme**: HMAC-SHA256

**Required Environment Variable**:
```bash
FLUTTERWAVE_SECRET=your_flutterwave_secret_hash
```

**Webhook Header**: `verif-hash`

**Verification Method**:
- The signature is an HMAC-SHA256 hash of the raw request body
- The secret hash is used as the HMAC key
- The signature is sent as a hex-encoded string in the header
- We use timing-safe comparison to prevent timing attacks

**Example**:
```http
POST /api/webhooks/payments/flutterwave
Content-Type: application/json
verif-hash: def456...

{"event":"charge.completed","data":{"tx_ref":"pi_456"}}
```

---

### Manual Admin

**Signature Scheme**: Shared Secret Comparison

**Required Environment Variable**:
```bash
MANUAL_ADMIN_SECRET=your_admin_secret
```

**Webhook Header**: `x-admin-signature`

**Verification Method**:
- Simple constant-time string comparison
- The signature header must exactly match the configured secret
- Used for admin-initiated manual operations

**Example**:
```http
POST /api/webhooks/payments/manual_admin
Content-Type: application/json
x-admin-signature: admin_secret_key_123

{"action":"manual_deposit","amount":100000}
```

---

### Bank Transfer

**Signature Scheme**: None (Reconciliation-based)

**Required Environment Variable**: None

**Validation Method**:
- Bank transfers do **NOT** use webhooks for validation
- Payments are validated through reconciliation processes
- Manual verification of bank statements or transfer confirmations

**Note**: Attempting to validate a bank transfer webhook signature will fail with an appropriate error message explaining that reconciliation should be used instead.

---

### Legacy PSP (Stub Provider)

**Signature Scheme**: Shared Secret Comparison (Legacy)

**Required Environment Variable**:
```bash
WEBHOOK_SECRET=your_legacy_webhook_secret
```

**Webhook Header**: `x-webhook-signature`

**Verification Method**:
- Simple string comparison (not timing-safe)
- For backward compatibility with existing integrations
- Should be migrated to provider-specific schemes

---

## Environment Variable Summary

| Provider | Environment Variable | Required in Production | Header Name | Algorithm |
|----------|---------------------|------------------------|-------------|-----------|
| Paystack | `PAYSTACK_SECRET` | Yes | `x-paystack-signature` | HMAC-SHA512 |
| Flutterwave | `FLUTTERWAVE_SECRET` | Yes | `verif-hash` | HMAC-SHA256 |
| Manual Admin | `MANUAL_ADMIN_SECRET` | Yes | `x-admin-signature` | Shared Secret |
| Bank Transfer | N/A | N/A | N/A | Reconciliation |
| Legacy PSP | `WEBHOOK_SECRET` | Yes | `x-webhook-signature` | Shared Secret |

## Configuration for Production

In production (`NODE_ENV=production`), all provider secrets **MUST** be configured. The application will fail to start with a validation error if any required secret is missing.

### Example Production Environment

```bash
# Required for all payment providers in production
PAYSTACK_SECRET=sk_live_xxxxxxxxxxxxxxxx
FLUTTERWAVE_SECRET=FLWSECK-xxxxxxxxxxxx-X
MANUAL_ADMIN_SECRET=your_secure_admin_secret_here

# Optional: Legacy fallback (if using stub provider)
WEBHOOK_SECRET=legacy_webhook_secret
```

## Testing

For testing webhook signatures, use the test vectors in `/test-vectors.json` or generate valid signatures using the `generateTestSignature` function:

```typescript
import { generateTestSignature } from './payments/webhookSignature.js'

const payload = JSON.stringify({ event: 'charge.success', data: { reference: 'pi_123' } })
const signature = generateTestSignature('paystack', payload, 'your_test_secret')
```

### Test Vectors

The `test-vectors.json` file contains test vectors for all providers:
- `webhook_signature_vectors` - Test cases for signature verification
  - Valid signatures
  - Invalid signatures
  - Missing signatures
  - Format errors

## Security Considerations

1. **Timing Attack Prevention**: All signature comparisons use `crypto.timingSafeEqual()` to prevent timing attacks
2. **Production Enforcement**: Signature validation is always enabled in production, regardless of `WEBHOOK_SIGNATURE_ENABLED`
3. **Configuration Failures**: Missing secrets in production return `500 Internal Server Error` to indicate misconfiguration
4. **Invalid Signatures**: Invalid signatures return `401 Unauthorized` and never reach business logic

## Migration from Legacy

To migrate from the legacy signature scheme to provider-specific schemes:

1. Set the appropriate provider-specific secret environment variable
2. Update webhook endpoints to use the correct header name
3. Test with the new signature generation method
4. Remove `WEBHOOK_SECRET` once migration is complete
