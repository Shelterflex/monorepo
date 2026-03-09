# Reversal System Quick Reference

## 🚀 Quick Start

### What is Policy A?
Strict reversal handling where:
- User wallet can go negative
- Account auto-freezes until repaid
- Platform doesn't eat the loss

### When does a user get frozen?
1. **Automatic:** When `totalBalanceNgn < 0` (after deposit reversal)
2. **Manual:** Admin freezes for suspicious activity
3. **Compliance:** Admin freezes for KYC/AML review

### When does a user get unfrozen?
1. **Automatic:** When balance becomes ≥ 0 (only for NEGATIVE_BALANCE)
2. **Manual:** Admin unfreezes (for MANUAL or COMPLIANCE freezes)

## 📊 Freeze Reasons

| Reason | Trigger | Auto-Unfreeze? | User Action |
|--------|---------|----------------|-------------|
| NEGATIVE_BALANCE | Deposit reversal | ✅ Yes (on top-up) | Top up to repay deficit |
| MANUAL | Admin action | ❌ No | Contact support |
| COMPLIANCE | Admin action | ❌ No | Complete KYC/AML |

## 🔒 What Frozen Users Can/Cannot Do

### ❌ Cannot Do (Blocked)
- Initiate withdrawals
- Stake from NGN wallet
- Any operation that decreases available balance

### ✅ Can Do (Allowed)
- View balances
- View transaction history
- Top up wallet (to repay deficit)

## 🔗 API Endpoints

### User-Facing
```
POST /api/wallet/ngn/withdraw/initiate  → 403 if frozen
```

### Admin-Facing
```
GET  /api/admin/risk/frozen-users       → List frozen accounts
GET  /api/admin/risk/:userId            → View user risk + balance
POST /api/admin/risk/:userId/freeze     → Freeze account
POST /api/admin/risk/:userId/unfreeze   → Unfreeze account
```

### Webhooks
```
POST /api/webhooks/reversals/:provider  → Process reversal
```

## 💡 Common Scenarios

### Scenario 1: Deposit Reversal
```
1. User deposits 100,000 NGN
2. User spends 80,000 NGN (balance: 20,000)
3. Deposit is reversed (chargeback)
4. Balance becomes -80,000 NGN
5. User is auto-frozen (NEGATIVE_BALANCE)
6. User tops up 80,000 NGN
7. Balance becomes 0 NGN
8. User is auto-unfrozen
```

### Scenario 2: Manual Freeze
```
1. Admin detects suspicious activity
2. Admin freezes account (MANUAL)
3. User cannot withdraw or stake
4. Admin investigates
5. Admin manually unfreezes after resolution
```

### Scenario 3: Compliance Freeze
```
1. KYC verification required
2. Admin freezes account (COMPLIANCE)
3. User completes KYC
4. Admin reviews and manually unfreezes
```

## 🛠️ Admin Actions

### View Frozen Users
```bash
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:4000/api/admin/risk/frozen-users
```

### Check User Status
```bash
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:4000/api/admin/risk/USER_ID
```

### Freeze User
```bash
curl -X POST http://localhost:4000/api/admin/risk/USER_ID/freeze \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "MANUAL",
    "notes": "Suspicious activity"
  }'
```

### Unfreeze User
```bash
curl -X POST http://localhost:4000/api/admin/risk/USER_ID/unfreeze \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"notes": "Issue resolved"}'
```

## 🔔 Error Messages

### For Users

**Negative Balance:**
```json
{
  "error": {
    "code": "ACCOUNT_FROZEN",
    "message": "Account frozen. Negative balance detected. Please top up to continue."
  }
}
```

**Manual Freeze:**
```json
{
  "error": {
    "code": "ACCOUNT_FROZEN",
    "message": "Account frozen. Manual freeze by admin. Contact support."
  }
}
```

**Compliance Freeze:**
```json
{
  "error": {
    "code": "ACCOUNT_FROZEN",
    "message": "Account frozen. Compliance review required. Contact support."
  }
}
```

## 📈 Balance Calculation

```typescript
totalBalanceNgn = availableNgn + heldNgn

// Can be negative!
// Example: availableNgn = -50000, heldNgn = 10000
// totalBalanceNgn = -40000 (user is frozen)
```

## 🔄 Reversal Flow

```
1. Webhook received → POST /api/webhooks/reversals/:provider
2. Find original deposit by providerRef
3. Check if already reversed (idempotency)
4. Debit wallet by deposit amount
5. Create reversal ledger entry (negative amount)
6. If totalBalanceNgn < 0 → Auto-freeze (NEGATIVE_BALANCE)
7. Return 200 OK
```

## 🧪 Testing

### Run All Reversal Tests
```bash
cd backend
npm test -- reversal --run
```

### Run Specific Test Suite
```bash
npm test -- ngnWalletService.reversal.test.ts --run
npm test -- adminRisk.test.ts --run
npm test -- webhooks.reversal.test.ts --run
```

## 📝 Key Files

### Models
- `src/models/userRiskState.ts` - Risk state interface
- `src/models/userRiskStateStore.ts` - Risk state storage

### Services
- `src/services/ngnWalletService.ts` - Reversal logic

### Routes
- `src/routes/adminRisk.ts` - Admin endpoints
- `src/routes/webhooks.ts` - Reversal webhook

### Middleware
- `src/middleware/risk.ts` - Freeze check

### Tests
- `src/services/ngnWalletService.reversal.test.ts`
- `src/routes/adminRisk.test.ts`
- `src/routes/webhooks.reversal.test.ts`

## 🎯 Key Metrics to Monitor

1. **Frozen Account Count** - Track by reason
2. **Reversal Rate** - By provider
3. **Average Deficit** - How negative do balances go?
4. **Time to Repayment** - How long until unfrozen?
5. **Auto-Unfreeze Success Rate** - % of users who repay

## 🚨 Troubleshooting

### User says they're frozen but balance is positive
- Check `UserRiskState` - might be MANUAL or COMPLIANCE freeze
- Check with admin team for freeze reason

### Reversal webhook not working
- Verify webhook signature is correct
- Check provider and providerRef match
- Look for deposit in system

### User topped up but still frozen
- Check freeze reason - only NEGATIVE_BALANCE auto-unfreezes
- Verify balance is actually ≥ 0
- Check if manual unfreeze is needed

## 📚 Further Reading

- `REVERSAL_POLICY_IMPLEMENTATION.md` - Complete implementation guide
- `IMPLEMENTATION_SUMMARY.md` - Summary and status
- `openapi-risk-endpoints.yml` - API documentation
- `REVERSAL_CHECKLIST.md` - Implementation checklist
