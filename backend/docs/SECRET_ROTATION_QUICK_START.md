# Secret Rotation Quick Start Guide

## 5-Minute Setup

### 1. Verify Installation

The secret rotation system is automatically initialized when the application starts. No additional installation required.

### 2. Check Status

```bash
curl http://localhost:4000/api/admin/secrets/status
```

You should see all registered secrets with their current versions.

### 3. Perform Your First Rotation

Let's rotate the webhook secret:

```bash
# Generate a new secret (32+ characters)
NEW_SECRET=$(openssl rand -hex 32)

# Rotate the secret
curl -X POST http://localhost:4000/api/admin/secrets/rotate \
  -H "Content-Type: application/json" \
  -d "{
    \"secretName\": \"webhook_secret\",
    \"newValue\": \"$NEW_SECRET\",
    \"gracePeriodMs\": 300000
  }"
```

### 4. Verify Rotation

```bash
# Check status
curl http://localhost:4000/api/admin/secrets/status

# View history
curl http://localhost:4000/api/admin/secrets/history?limit=5
```

### 5. Test Webhook with Both Secrets

During the grace period (5 minutes), both old and new secrets work:

```bash
# Test with old secret (should work)
curl -X POST http://localhost:4000/api/webhooks/payments/psp \
  -H "x-webhook-signature: OLD_SECRET_HERE" \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'

# Test with new secret (should also work)
curl -X POST http://localhost:4000/api/webhooks/payments/psp \
  -H "x-webhook-signature: $NEW_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
```

### 6. Wait for Grace Period

After 5 minutes, only the new secret will work. The old secret is automatically cleaned up.

## Common Operations

### Rotate Paystack Secret

```bash
# Get new secret from Paystack dashboard
NEW_PAYSTACK_SECRET="sk_live_your_new_secret"

# Rotate
curl -X POST http://localhost:4000/api/admin/secrets/rotate \
  -H "Content-Type: application/json" \
  -d "{
    \"secretName\": \"paystack_secret\",
    \"newValue\": \"$NEW_PAYSTACK_SECRET\",
    \"gracePeriodMs\": 600000
  }"

# Update Paystack webhook configuration within 10 minutes
```

### Rotate Encryption Key

```bash
# Generate new encryption key
NEW_KEY=$(openssl rand -hex 32)

# Rotate with longer grace period (15 minutes)
curl -X POST http://localhost:4000/api/admin/secrets/rotate \
  -H "Content-Type: application/json" \
  -d "{
    \"secretName\": \"encryption_key\",
    \"newValue\": \"$NEW_KEY\",
    \"gracePeriodMs\": 900000
  }"
```

### Environment-Based Rotation

Instead of using the API, you can update environment variables:

```bash
# Update .env file or secret manager
export WEBHOOK_SECRET="new-secret-value-here"

# Service automatically detects change within 30 seconds
# Or force immediate reload:
curl -X POST http://localhost:4000/api/admin/secrets/reload
```

## Monitoring

### Check Audit Logs

```bash
tail -f ./logs/secret-rotation-audit.log
```

### View Recent Rotations

```bash
curl http://localhost:4000/api/admin/secrets/history?limit=10 | jq
```

### Monitor Active Versions

```bash
watch -n 5 'curl -s http://localhost:4000/api/admin/secrets/status | jq'
```

## Troubleshooting

### Secret Not Rotating

```bash
# Force reload from environment
curl -X POST http://localhost:4000/api/admin/secrets/reload

# Check logs
tail -n 50 ./logs/secret-rotation-audit.log
```

### Validation Error

```bash
# Check secret format requirements
# Webhook secrets: min 32 chars
# Paystack: must start with "sk_"
# Encryption keys: min 32 chars
# Custodial keys: 32-byte base64

# Example: Generate valid encryption key
openssl rand -hex 32
```

### Grace Period Expired Too Soon

```bash
# Rotate again with longer grace period
curl -X POST http://localhost:4000/api/admin/secrets/rotate \
  -H "Content-Type: application/json" \
  -d "{
    \"secretName\": \"webhook_secret\",
    \"newValue\": \"new-value\",
    \"gracePeriodMs\": 1800000
  }"
```

## Production Checklist

Before rotating secrets in production:

- [ ] Test rotation in staging environment
- [ ] Verify zero downtime during rotation
- [ ] Confirm grace period is sufficient for your use case
- [ ] Set up monitoring for rotation events
- [ ] Document rotation procedures for your team
- [ ] Configure audit log retention
- [ ] Test automatic fallback mechanism
- [ ] Verify external systems can handle rotation

## Next Steps

- Read the full [Secret Rotation Documentation](./SECRET_ROTATION.md)
- Set up automated rotation schedules
- Integrate with your secret management system
- Configure monitoring and alerting
- Train your team on rotation procedures
