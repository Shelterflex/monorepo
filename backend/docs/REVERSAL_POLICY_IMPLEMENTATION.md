# Chargeback/Reversal Enforcement Implementation (Policy A)

## Overview

This document describes the implementation of strict reversal handling (Policy A) for the NGN wallet system. When PSP deposits are reversed/charged back after users have spent the funds, the system enforces a strict policy where:

- User wallet is allowed to go negative
- Account is automatically frozen until repaid
- Platform does not eat the loss

## Architecture

### Data Models

#### UserRiskState
Located in: `src/models/userRiskState.ts`, `src/models/userRiskStateStore.ts`

Tracks frozen account status and compliance issues:

```typescript
interface UserRiskState {
  userId: string
  isFrozen: boolean
  freezeReason: 'NEGATIVE_BALANCE' | 'MANUAL' | 'COMPLIANCE'
  frozenAt: Date | null
  unfrozenAt: Date | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
}
```

#### DepositRecord (Extended)
Located in: `src/models/deposit.ts`

Added reversal tracking fields:
- `reversedAt: Date | null` - When the deposit was reversed
- `reversalRef: string | null` - Provider's reversal reference

### Services

#### NgnWalletService (Extended)
Located in: `src/services/ngnWalletService.ts`

New methods:
- `processDepositReversal()` - Handle deposit reversals (idempotent)
- `processTopUp()` - Handle top-ups with auto-unfreeze logic
- `isUserFrozen()` - Check if user is frozen
- `requireNotFrozen()` - Throw error if user is frozen

### Middleware

#### requireNotFrozen
Located in: `src/middleware/risk.ts`

Express middleware that blocks risky operations for frozen accounts:
- Applied to withdrawal endpoints
- Applied to staking from NGN wallet
- Returns 403 ACCOUNT_FROZEN error with appropriate message

### Routes

#### Admin Risk Routes
Located in: `src/routes/adminRisk.ts`

- `GET /api/admin/risk/frozen-users` - List all frozen users
- `GET /api/admin/risk/:userId` - Get risk state + balances for user
- `POST /api/admin/risk/:userId/freeze` - Manually freeze account
- `POST /api/admin/risk/:userId/unfreeze` - Manually unfreeze account

#### Webhook Routes (Extended)
Located in: `src/routes/webhooks.ts`

- `POST /api/webhooks/reversals/:provider` - Handle deposit reversal webhooks

## Reversal Processing Flow

### 1. Webhook Receives Reversal Event

```
POST /api/webhooks/reversals/onramp
{
  "provider": "onramp",
  "providerRef": "ONRAMP-REF-123",
  "reversalRef": "REVERSAL-REF-456",
  "eventType": "deposit.reversed",
  "timestamp": "2024-03-07T10:30:00Z"
}
```

### 2. Idempotency Check

The system checks if this reversal has already been processed by looking for:
- Existing `reversedAt` timestamp on the deposit record
- Uses `(provider, providerRef)` as the unique key

### 3. Balance Debit

```typescript
// Debit the wallet by the original deposit amount
newTotalNgn = currentTotalNgn - depositAmount
newAvailableNgn = currentAvailableNgn - depositAmount
```

### 4. Ledger Entry

A `top_up_reversed` ledger entry is created with negative amount:

```typescript
{
  id: "reversal-{depositId}",
  type: "top_up_reversed",
  amountNgn: -depositAmount,
  status: "confirmed",
  timestamp: now,
  reference: reversalRef
}
```

### 5. Auto-Freeze Logic

If `totalNgn < 0` after reversal:

```typescript
await userRiskStateStore.freeze(
  userId,
  'NEGATIVE_BALANCE',
  `Auto-frozen due to deposit reversal. Deficit: ${Math.abs(totalNgn)} NGN`
)
```

## Freeze/Unfreeze Logic

### Frozen State Determination

A user is considered frozen if:
1. `UserRiskState.isFrozen === true` (explicit freeze), OR
2. `totalBalanceNgn < 0` (implicit freeze due to negative balance)

### Freeze Reasons

#### NEGATIVE_BALANCE
- Automatic freeze when deposit reversal makes balance negative
- Auto-unfreezes when user tops up and balance becomes non-negative
- User can still top up while frozen

#### MANUAL
- Admin manually freezes account for suspicious activity
- Does NOT auto-unfreeze on top-up
- Requires manual admin unfreeze

#### COMPLIANCE
- Freeze for compliance review (KYC, AML, etc.)
- Does NOT auto-unfreeze on top-up
- Requires manual admin unfreeze

### Auto-Unfreeze on Top-Up

When a user tops up:

```typescript
if (
  riskState?.isFrozen &&
  riskState.freezeReason === 'NEGATIVE_BALANCE' &&
  newTotalNgn >= 0
) {
  await userRiskStateStore.unfreeze(userId, 'Auto-unfrozen after balance restored')
}
```

## Restricted Operations

When frozen, users CANNOT:
- Initiate withdrawals (`POST /api/wallet/ngn/withdraw/initiate`)
- Stake from NGN wallet (`POST /api/staking/stake-ngn`)
- Any operation that decreases available balance

When frozen, users CAN:
- View balances (`GET /api/wallet/ngn/balance`)
- View ledger history (`GET /api/wallet/ngn/ledger`)
- Top up (to repay deficit)

## Error Responses

### ACCOUNT_FROZEN (403)

```json
{
  "error": {
    "code": "ACCOUNT_FROZEN",
    "message": "Account frozen. Negative balance detected. Please top up to continue."
  }
}
```

Messages vary by freeze reason:
- NEGATIVE_BALANCE: "Negative balance: -50000 NGN. Please top up to continue."
- MANUAL: "Manual freeze by admin. Contact support."
- COMPLIANCE: "Compliance review required. Contact support."

## Edge Cases

### 1. Reversal After User Reserved Funds

**Scenario:** User initiates withdrawal (funds moved to `heldNgn`), then deposit is reversed.

**Behavior:**
- Reversal still applies to `totalNgn` and `availableNgn`
- Held funds remain held (not silently cancelled)
- User becomes frozen if balance is negative
- Pending withdrawal approval must fail or require manual admin override

### 2. Reversal While Withdrawal Pending

**Scenario:** User has pending withdrawal, deposit is reversed.

**Behavior:**
- User becomes frozen
- Payout approval should fail until deficit is repaid
- Admin can manually review and decide

### 3. Multiple Reversals

**Scenario:** Multiple deposits are reversed.

**Behavior:**
- Each reversal is processed independently
- Balance can go deeply negative
- User remains frozen until all deficits are repaid

### 4. Webhook Replay

**Scenario:** Same reversal webhook is sent multiple times.

**Behavior:**
- Idempotency check prevents double-debit
- Returns 200 OK on replay
- No side effects on second+ call

## Testing

### Unit Tests
Located in: `src/services/ngnWalletService.reversal.test.ts`

Tests cover:
- ✅ Reversal debits wallet correctly
- ✅ Reversal makes wallet negative → user frozen
- ✅ Idempotency (replay doesn't double-debit)
- ✅ NOT_FOUND error if deposit doesn't exist
- ✅ Top-up credits wallet and adds ledger entry
- ✅ Auto-unfreeze on top-up (NEGATIVE_BALANCE only)
- ✅ No auto-unfreeze for MANUAL/COMPLIANCE
- ✅ requireNotFrozen throws ACCOUNT_FROZEN
- ✅ Withdrawal blocked when frozen
- ✅ Withdrawal allowed when not frozen
- ✅ Edge case: reversal after funds reserved

### Integration Tests

#### Admin Risk Routes
Located in: `src/routes/adminRisk.test.ts`

Tests cover:
- ✅ GET frozen users list
- ✅ GET user risk state + balances
- ✅ POST freeze user (MANUAL, COMPLIANCE)
- ✅ POST unfreeze user
- ✅ Authentication required

#### Webhook Routes
Located in: `src/routes/webhooks.reversal.test.ts`

Tests cover:
- ✅ Process reversal and freeze user
- ✅ Idempotency (replay protection)
- ✅ 200 OK even if deposit not found
- ✅ Reject mismatched provider
- ✅ Reject invalid event type
- ✅ Webhook signature verification

## Security Considerations

### Webhook Signature Verification

When `WEBHOOK_SIGNATURE_ENABLED=true`:

```typescript
const sig = req.headers['x-webhook-signature']
if (sig !== process.env.WEBHOOK_SECRET) {
  throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid webhook signature')
}
```

### No Sensitive Data Logging

The implementation ensures:
- No bank account details in logs
- No secret keys in logs
- User IDs and amounts only (safe for audit)

### Admin Authorization

Current implementation uses `authenticateToken` middleware. In production, should add:
- Role-based access control (RBAC)
- Admin-only routes protection
- Audit logging for admin actions

## Database Migration (Future)

Current implementation uses in-memory stores. For production:

```sql
-- User risk state table
CREATE TABLE user_risk_states (
  user_id VARCHAR(255) PRIMARY KEY,
  is_frozen BOOLEAN NOT NULL DEFAULT FALSE,
  freeze_reason VARCHAR(50),
  frozen_at TIMESTAMP,
  unfrozen_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_risk_frozen ON user_risk_states(is_frozen) WHERE is_frozen = TRUE;

-- Add reversal fields to deposits table
ALTER TABLE deposits
ADD COLUMN reversed_at TIMESTAMP,
ADD COLUMN reversal_ref VARCHAR(255);

CREATE INDEX idx_deposits_reversed ON deposits(reversed_at) WHERE reversed_at IS NOT NULL;
```

## Monitoring & Alerts

Recommended monitoring:

1. **Frozen Account Count**
   - Alert if sudden spike in frozen accounts
   - Track by freeze reason

2. **Reversal Rate**
   - Monitor reversal frequency by provider
   - Alert if reversal rate exceeds threshold

3. **Negative Balance Depth**
   - Track distribution of negative balances
   - Alert on large deficits

4. **Auto-Unfreeze Rate**
   - Monitor how many users repay and get unfrozen
   - Track time-to-repayment

## API Documentation

Full OpenAPI documentation available in:
- `backend/docs/openapi-risk-endpoints.yml`

Add these definitions to the main `backend/openapi.yml` file.

## Acceptance Criteria

✅ Policy A enforced consistently across wallet flows
✅ Clear error code (ACCOUNT_FROZEN) and messages for frozen users
✅ Admin can freeze/unfreeze and view risk status
✅ OpenAPI updated with ACCOUNT_FROZEN error on restricted endpoints
✅ No sensitive data logged (no bank details, no secret keys)
✅ Comprehensive test coverage (unit + integration)
✅ Idempotent webhook handling
✅ Auto-freeze on negative balance
✅ Auto-unfreeze on repayment (NEGATIVE_BALANCE only)
✅ Edge cases documented and tested

## Future Enhancements

1. **Notification System**
   - Email/SMS when account is frozen
   - Reminder to top up for negative balance

2. **Grace Period**
   - Allow small negative balance without immediate freeze
   - Configurable threshold (e.g., -1000 NGN)

3. **Partial Repayment**
   - Track repayment progress
   - Unfreeze when deficit below threshold

4. **Dispute Resolution**
   - Allow users to dispute reversals
   - Admin workflow for dispute review

5. **Analytics Dashboard**
   - Visualize reversal trends
   - Risk metrics by user segment
