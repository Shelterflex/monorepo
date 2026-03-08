# Wallet Integration Guide

## Overview

This guide shows how to integrate the custodial wallet service with your existing OTP authentication system.

## Integration Points

### 1. After Successful OTP Login

When a user successfully authenticates via OTP, you should automatically create a wallet for them if one doesn't exist:

```typescript
// In your OTP success handler
async function handleSuccessfulOTP(userId: string) {
  try {
    // Create wallet if it doesn't exist
    await walletService.createWalletForUser(userId)
    
    // Get wallet address for user profile
    const address = await walletService.getPublicAddress(userId)
    
    // Store address in user profile or return to client
    return { success: true, address }
  } catch (error) {
    console.error('Wallet creation failed:', error)
    return { success: false, error: 'Wallet creation failed' }
  }
}
```

### 2. Frontend Integration

Your frontend should call the wallet endpoints after successful login:

```javascript
// After successful OTP login
const response = await fetch('/api/wallet/address', {
  headers: {
    'x-user-id': userId, // Or use JWT token
    'Content-Type': 'application/json'
  }
})

const { address } = await response.json()
// Display address to user
```

### 3. Transaction Signing

For blockchain operations, use the signing endpoints:

```javascript
// Sign a message
const signResponse = await fetch('/api/wallet/sign-message', {
  method: 'POST',
  headers: {
    'x-user-id': userId,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ message: 'Your message to sign' })
})

const { signature, publicKey } = await signResponse.json()

// Sign a Soroban transaction
const txResponse = await fetch('/api/wallet/sign-transaction', {
  method: 'POST',
  headers: {
    'x-user-id': userId,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ xdr: 'base64-encoded-transaction-xdr' })
})

const { signature, publicKey } = await txResponse.json()
```

## Environment Configuration

Add these environment variables to your `.env` file:

```env
# Wallet encryption (required)
ENCRYPTION_KEY=your-super-secure-encryption-key-here-32-chars-min

# Existing Soroban configuration
SOROBAN_NETWORK=testnet
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
SOROBAN_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
```

## Security Considerations

1. **Authentication**: Replace the header-based `x-user-id` with proper JWT tokens in production
2. **Key Management**: Use a secure key management system instead of environment variables
3. **Rate Limiting**: Implement rate limiting on wallet endpoints
4. **Monitoring**: Monitor wallet creation and signing operations for suspicious activity

## API Endpoints

### GET /api/wallet/address
Returns the public wallet address for the authenticated user.

**Headers:**
- `x-user-id`: User identifier (or JWT token)

**Response:**
```json
{
  "success": true,
  "address": "GABC123..."
}
```

### POST /api/wallet/create
Creates a new wallet for the user if one doesn't exist.

**Headers:**
- `x-user-id`: User identifier (or JWT token)

**Response:**
```json
{
  "success": true,
  "address": "GABC123..."
}
```

### POST /api/wallet/sign-message
Signs a message with the user's private key.

**Headers:**
- `x-user-id`: User identifier (or JWT token)

**Body:**
```json
{
  "message": "Message to sign"
}
```

**Response:**
```json
{
  "success": true,
  "signature": "base64-signature",
  "publicKey": "GABC123..."
}
```

### POST /api/wallet/sign-transaction
Signs a Soroban transaction with the user's private key.

**Headers:**
- `x-user-id`: User identifier (or JWT token)

**Body:**
```json
{
  "xdr": "base64-encoded-transaction-xdr"
}
```

**Response:**
```json
{
  "success": true,
  "signature": "base64-signature",
  "publicKey": "GABC123..."
}
```

## Testing

Run the wallet tests to verify functionality:

```bash
npm test -- walletService
npm test -- wallet.test.ts
```

## Production Deployment

1. Replace in-memory wallet store with database persistence
2. Implement proper JWT-based authentication
3. Use HSM or KMS for encryption key management
4. Set up monitoring and alerting
5. Implement key rotation procedures

See `docs/WALLET_SECURITY.md` for detailed security requirements.
