# Secret Rotation System

## Overview

The secret rotation system provides zero-downtime rotation of production secrets (API keys, webhook secrets, encryption keys) with automatic hot-reloading, graceful transition periods, audit logging, and automatic fallback on failure.

## Features

- **Hot-reloading**: Secrets are automatically reloaded from environment variables without service restart
- **Graceful transition**: Old secrets remain valid during a configurable grace period
- **Audit logging**: All rotation events are logged to `./logs/secret-rotation-audit.log`
- **Automatic fallback**: Operations automatically try older secret versions if the new one fails
- **Zero downtime**: Service continues operating during rotation with no interruption

## Architecture

### Components

1. **SecretRotationService** (`backend/src/services/secretRotationService.ts`)
   - Core service managing secret versions and rotation lifecycle
   - Watches environment for changes
   - Maintains grace periods for old secrets
   - Provides audit logging

2. **Rotating Secret Provider** (`backend/src/services/rotatingSecretProvider.ts`)
   - Adapter functions for accessing rotating secrets
   - Provides webhook signature validation with rotation support
   - Integrates with existing services

3. **Middleware** (`backend/src/middleware/secretRotation.ts`)
   - Express middleware integration
   - Admin API endpoints for rotation management
   - Automatic initialization on app startup

### Registered Secrets

The following secrets are managed by the rotation system:

| Secret Name                      | Environment Variable             | Grace Period | Validator          |
| -------------------------------- | -------------------------------- | ------------ | ------------------ |
| `webhook_secret`                 | `WEBHOOK_SECRET`                 | 5 minutes    | Min 32 chars       |
| `paystack_secret`                | `PAYSTACK_SECRET`                | 10 minutes   | Starts with `sk_`  |
| `flutterwave_secret`             | `FLUTTERWAVE_SECRET`             | 10 minutes   | -                  |
| `manual_admin_secret`            | `MANUAL_ADMIN_SECRET`            | 5 minutes    | Min 32 chars       |
| `resend_api_key`                 | `RESEND_API_KEY`                 | 5 minutes    | Starts with `re_`  |
| `encryption_key`                 | `ENCRYPTION_KEY`                 | 15 minutes   | Min 32 chars       |
| `custodial_wallet_master_key_v1` | `CUSTODIAL_WALLET_MASTER_KEY_V1` | 30 minutes   | 32-byte base64     |
| `custodial_wallet_master_key_v2` | `CUSTODIAL_WALLET_MASTER_KEY_V2` | 30 minutes   | 32-byte base64     |
| `soroban_admin_secret`           | `SOROBAN_ADMIN_SECRET`           | 10 minutes   | Stellar key format |

## Usage

### Automatic Rotation (Environment-based)

The service automatically detects changes to environment variables:

1. Update the environment variable (e.g., in your secret manager or `.env` file)
2. The service polls every 30 seconds (configurable via `ROTATION_WATCH_INTERVAL_MS`)
3. When a change is detected, rotation happens automatically
4. Old secret remains valid during the grace period

### Manual Rotation (API-based)

Use the admin API to manually trigger rotation:

```bash
# Rotate a secret
curl -X POST http://localhost:4000/api/admin/secrets/rotate \
  -H "Content-Type: application/json" \
  -d '{
    "secretName": "webhook_secret",
    "newValue": "new-secret-value-here",
    "gracePeriodMs": 300000
  }'

# Force reload from environment
curl -X POST http://localhost:4000/api/admin/secrets/reload

# Check rotation status
curl http://localhost:4000/api/admin/secrets/status

# View rotation history
curl http://localhost:4000/api/admin/secrets/history?limit=50
```

### Programmatic Usage

```typescript
import {
  getRotatingSecret,
  getValidSecretVersions,
  tryWithRotatingSecret,
} from "./services/rotatingSecretProvider.js";

// Get current active secret
const secret = getRotatingSecret("webhook_secret");

// Get all valid versions (active + grace period)
const validVersions = getValidSecretVersions("webhook_secret");

// Try operation with automatic fallback
const result = await tryWithRotatingSecret(
  "paystack_secret",
  async (secret) => {
    return await makeAPICall(secret);
  },
);
```

### Webhook Signature Validation

Webhook signature validation automatically supports rotation:

```typescript
import { requireValidWebhookSignature } from "./payments/webhookSignature.js";

// Automatically tries all valid secret versions
requireValidWebhookSignature(req, "paystack");
```

## Rotation Workflow

### Standard Rotation Process

1. **Preparation**
   - Generate new secret value
   - Ensure new secret meets validation requirements

2. **Rotation**
   - Update environment variable or call rotation API
   - Service detects change and activates new secret
   - Old secret marked for expiration after grace period

3. **Grace Period**
   - Both old and new secrets are valid
   - Incoming requests can use either version
   - Allows external systems time to update

4. **Cleanup**
   - After grace period expires, old secret is removed
   - Only new secret remains active

### Example: Rotating Paystack Secret

```bash
# Step 1: Generate new secret from Paystack dashboard
NEW_SECRET="sk_live_new_secret_value"

# Step 2: Rotate via API (recommended for production)
curl -X POST http://localhost:4000/api/admin/secrets/rotate \
  -H "Content-Type: application/json" \
  -d "{
    \"secretName\": \"paystack_secret\",
    \"newValue\": \"$NEW_SECRET\",
    \"gracePeriodMs\": 600000
  }"

# Step 3: Update Paystack webhook configuration with new secret
# (Do this during the grace period)

# Step 4: Verify rotation status
curl http://localhost:4000/api/admin/secrets/status

# Step 5: Wait for grace period to expire (10 minutes)
# Old secret will be automatically cleaned up
```

## Configuration

### Environment Variables

```bash
# Watch interval for environment changes (default: 30000ms = 30 seconds)
ROTATION_WATCH_INTERVAL_MS=30000

# Audit log directory (default: ./logs)
AUDIT_LOG_DIR=./logs

# Node environment (affects validation requirements)
NODE_ENV=production
```

### Grace Periods

Grace periods can be customized per secret or per rotation:

```typescript
// In secretRotation.ts, modify the secretConfigs array:
{
  name: 'webhook_secret',
  envVar: 'WEBHOOK_SECRET',
  required: true,
  gracePeriodMs: 300000, // 5 minutes (default)
}

// Or specify during manual rotation:
await service.rotateSecret('webhook_secret', newValue, {
  gracePeriodMs: 600000 // 10 minutes (override)
});
```

## Monitoring and Audit

### Audit Logs

All rotation events are logged to `./logs/secret-rotation-audit.log`:

```json
{
  "secretName": "webhook_secret",
  "oldVersion": "v1",
  "newVersion": "v1234567890",
  "timestamp": "2024-03-27T10:30:00.000Z",
  "success": true
}
```

### Status Endpoint

Check the status of all managed secrets:

```bash
curl http://localhost:4000/api/admin/secrets/status
```

Response:

```json
{
  "success": true,
  "data": {
    "webhook_secret": {
      "activeVersion": "v1234567890",
      "validVersionCount": 2,
      "lastRotation": "2024-03-27T10:30:00.000Z"
    },
    "paystack_secret": {
      "activeVersion": "v1",
      "validVersionCount": 1,
      "lastRotation": "2024-03-20T08:15:00.000Z"
    }
  }
}
```

### History Endpoint

View recent rotation events:

```bash
curl http://localhost:4000/api/admin/secrets/history?limit=10
```

## Security Considerations

### Secret Storage

- Secrets are stored in memory only (never persisted to disk except in audit logs)
- Audit logs contain version identifiers, not actual secret values
- Environment variables should be managed by a secure secret manager (AWS Secrets Manager, HashiCorp Vault, etc.)

### Validation

- All secrets are validated before activation
- Invalid secrets are rejected and logged
- Production mode enforces stricter validation requirements

### Access Control

- Admin API endpoints should be protected with authentication/authorization
- Consider adding IP whitelisting for rotation endpoints
- Audit logs should be monitored for unauthorized rotation attempts

### Grace Period Best Practices

- **Short grace periods** (5 minutes): Low-risk secrets, frequent rotations
- **Medium grace periods** (10-15 minutes): API keys, webhook secrets
- **Long grace periods** (30+ minutes): Encryption keys, wallet keys

## Testing

### Unit Tests

```bash
cd backend
npm test -- secretRotationService.test.ts
```

### Integration Testing

1. Start the application in development mode
2. Rotate a secret via API
3. Verify old and new secrets both work during grace period
4. Wait for grace period to expire
5. Verify only new secret works after expiration

### Staging Validation

Before deploying to production:

1. Deploy to staging environment
2. Rotate all production secrets in staging
3. Verify zero downtime during rotation
4. Monitor audit logs for any failures
5. Confirm automatic fallback works correctly

## Troubleshooting

### Secret Not Rotating

**Symptom**: Environment variable changed but service still uses old secret

**Solutions**:

- Check watch interval: `ROTATION_WATCH_INTERVAL_MS`
- Verify environment variable name matches registered secret
- Check logs for validation errors
- Try manual reload: `POST /api/admin/secrets/reload`

### Validation Failures

**Symptom**: Rotation fails with "validation failed" error

**Solutions**:

- Check secret format requirements (see table above)
- Verify secret length meets minimum requirements
- Check for special character requirements (e.g., `sk_` prefix for Paystack)

### Grace Period Issues

**Symptom**: Old secret stops working before grace period expires

**Solutions**:

- Check system clock synchronization
- Verify grace period configuration
- Check for manual cleanup or service restarts

### Webhook Signature Failures

**Symptom**: Webhooks fail with "Invalid signature" after rotation

**Solutions**:

- Verify external system updated to new secret
- Check if grace period has expired
- Verify signature algorithm matches provider requirements
- Check audit logs for rotation timing

## Migration Guide

### Migrating Existing Secrets

To migrate existing secrets to the rotation system:

1. **Identify secrets**: List all secrets currently used in the application
2. **Register secrets**: Add to `secretConfigs` in `secretRotation.ts`
3. **Update consumers**: Modify code to use `getRotatingSecret()` instead of `process.env`
4. **Test rotation**: Perform test rotation in staging
5. **Deploy**: Roll out to production with monitoring

### Backward Compatibility

The system maintains backward compatibility:

- Falls back to `process.env` if rotation service not initialized
- Existing code continues to work without modification
- Gradual migration is supported

## API Reference

### Admin Endpoints

#### GET /api/admin/secrets/status

Get status of all managed secrets.

**Response**:

```json
{
  "success": true,
  "data": {
    "secretName": {
      "activeVersion": "string",
      "validVersionCount": number,
      "lastRotation": "ISO8601 date"
    }
  }
}
```

#### GET /api/admin/secrets/history

Get rotation history.

**Query Parameters**:

- `limit` (optional): Number of events to return (default: 100)

**Response**:

```json
{
  "success": true,
  "data": [
    {
      "secretName": "string",
      "oldVersion": "string",
      "newVersion": "string",
      "timestamp": "ISO8601 date",
      "success": boolean,
      "error": "string (optional)"
    }
  ]
}
```

#### POST /api/admin/secrets/rotate

Manually trigger secret rotation.

**Request Body**:

```json
{
  "secretName": "string (required)",
  "newValue": "string (required)",
  "gracePeriodMs": number (optional)
}
```

**Response**:

```json
{
  "success": true,
  "message": "Secret rotated successfully"
}
```

#### POST /api/admin/secrets/reload

Force reload secrets from environment.

**Response**:

```json
{
  "success": true,
  "message": "Secrets reloaded from environment"
}
```

## Future Enhancements

- Integration with AWS Secrets Manager
- Integration with HashiCorp Vault
- Automatic rotation scheduling
- Slack/email notifications for rotation events
- Metrics and dashboards for rotation monitoring
- Multi-region secret synchronization
