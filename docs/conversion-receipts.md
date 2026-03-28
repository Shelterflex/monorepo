# Conversion Receipt Recording System

## Overview

The conversion receipt recording system provides full auditability for NGN→USDC currency conversions by recording them on-chain as immutable receipts. Every conversion that occurs in the platform—whether from user deposits, offramp operations, or manual admin conversions—generates a receipt stored on the Stellar blockchain via Soroban smart contracts.

### Why Conversion Receipts?

Conversion receipts serve several critical purposes:

- **Auditability**: Every conversion is permanently recorded on-chain with complete metadata
- **Transparency**: Users and operators can verify conversion rates and amounts
- **Compliance**: Provides an immutable audit trail for regulatory requirements
- **Reconciliation**: Enables accurate reconciliation between off-chain and on-chain state
- **Dispute Resolution**: Provides authoritative records for resolving conversion disputes

### Key Features

- **End-to-end tracking**: From conversion completion to on-chain receipt
- **Multi-layer idempotency**: Prevents duplicate receipts at service, outbox, adapter, and contract layers
- **Reliable delivery**: Outbox pattern ensures receipts are recorded even if initial attempts fail
- **Rich metadata**: Records NGN amount, FX rate, and FX provider for each conversion
- **Automatic retry**: Failed receipts are automatically retried with exponential backoff
- **Staking support**: Handles synthetic deposit IDs for staking-related conversions

## Architecture

### System Components

The conversion receipt system consists of four main layers:

1. **Service Layer** (`ConversionService`): Manages conversions and initiates receipt recording
2. **Outbox Layer** (`OutboxStore`, `OutboxWorker`, `OutboxSender`): Ensures reliable delivery using the outbox pattern
3. **Adapter Layer** (`SorobanAdapter`): Interfaces with the Soroban blockchain
4. **Contract Layer** (Soroban Smart Contract): Stores receipts on-chain with idempotency enforcement

### Architecture Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Service Layer                                │
│  ConversionService.convertDeposit() / convertForStaking()           │
│  • Executes conversion with provider                                 │
│  • Calls ensureConversionReceiptOutbox()                            │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Outbox Layer                                 │
│  outboxStore.create()                                               │
│  • Creates CONVERSION outbox entry                                   │
│  • Uses (source, ref) as unique constraint                          │
│  • Stores payload with all metadata                                 │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Outbox Worker                                   │
│  OutboxWorker.processItems()                                        │
│  • Polls for PENDING outbox items                                    │
│  • Calls OutboxSender.send() for each item                          │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Outbox Sender                                   │
│  OutboxSender.sendReceipt()                                         │
│  • Routes CONVERSION txType to adapter                               │
│  • Handles retry logic with exponential backoff                      │
│  • Updates outbox status (SENT/FAILED)                              │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Adapter Layer                                   │
│  SorobanAdapter.recordReceipt()                                     │
│  • Builds receipt parameters                                         │
│  • Submits transaction to Soroban                                    │
│  • Handles duplicate receipt errors as idempotent success           │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Contract Layer                                  │
│  Smart Contract: record_receipt()                                   │
│  • Validates receipt parameters                                      │
│  • Rejects duplicates based on tx_id                                │
│  • Stores receipt with metadata on-chain                            │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Descriptions

#### ConversionService

The `ConversionService` orchestrates currency conversions and ensures receipts are recorded. It provides two main methods:

- `convertDeposit()`: Converts NGN to USDC for user deposits
- `convertForStaking()`: Converts NGN to USDC for staking operations using synthetic deposit IDs

Both methods are idempotent—calling them multiple times with the same deposit ID returns the existing conversion without creating duplicates.

#### OutboxStore

The `OutboxStore` persists outbox entries in the database with a unique constraint on `(source, ref)` to prevent duplicates. It provides methods to:

- Create new outbox entries (idempotent via unique constraint)
- Query entries by status (PENDING, SENT, FAILED)
- Update entry status and retry information

#### OutboxWorker

The `OutboxWorker` runs as a background process that:

- Polls for PENDING outbox items at regular intervals (default: 60 seconds)
- Checks if FAILED items are ready for retry based on `nextRetryAt`
- Delegates sending to `OutboxSender`

#### OutboxSender

The `OutboxSender` handles the actual sending of outbox items:

- Routes different transaction types to appropriate handlers
- Implements retry logic with exponential backoff
- Updates outbox status based on success/failure
- Enforces max retry limit (10 attempts)

#### SorobanAdapter

The `SorobanAdapter` interfaces with the Soroban blockchain:

- Builds receipt parameters from outbox payload
- Submits transactions to the smart contract
- Handles duplicate receipt errors gracefully (treats as idempotent success)
- Provides configuration for network, contract ID, and admin credentials

#### Smart Contract

The Soroban smart contract provides the final layer of receipt storage:

- Stores receipts with immutable on-chain records
- Enforces idempotency by rejecting duplicate `tx_id` values
- Validates receipt parameters and metadata
- Emits events for indexing and verification

## End-to-End Flow

### Step-by-Step Walkthrough

Here's what happens when a conversion is completed:

**Step 1: Conversion Execution**

```typescript
const conversion = await conversionService.convertDeposit({
  depositId: 'deposit-123',
  userId: 'user-456',
  amountNgn: 160000  // 160,000 NGN
})
```

The service:
- Checks if a conversion already exists for this `depositId` (idempotency check)
- If not, creates a pending conversion record
- Calls the conversion provider to execute the NGN→USDC conversion
- Marks the conversion as completed with the result (amountUsdc, fxRate, providerRef)

**Step 2: Outbox Entry Creation**

After the conversion completes, `ensureConversionReceiptOutbox()` is called:

```typescript
await outboxStore.create({
  txType: TxType.CONVERSION,
  source: 'onramp',  // or 'offramp', 'manual_admin'
  ref: conversion.providerRef,  // External reference for idempotency
  payload: {
    txType: TxType.CONVERSION,
    amountUsdc: conversion.amountUsdc,
    tokenAddress: getUsdcTokenAddress(),
    dealId: 'conversion',
    amountNgn: conversion.amountNgn,
    fxRateNgnPerUsdc: conversion.fxRateNgnPerUsdc,
    fxProvider: conversion.provider,
    conversionId: conversion.conversionId,
    depositId: conversion.depositId,
    conversionProviderRef: conversion.providerRef,
    userId: conversion.userId
  }
})
```

The outbox store:
- Creates a new entry with status PENDING
- Generates a deterministic `txId` (SHA-256 hash of canonical external reference)
- Enforces uniqueness via `(source, ref)` constraint
- Returns existing entry if duplicate attempt is made

**Step 3: Outbox Worker Processing**

The `OutboxWorker` runs periodically (every 60 seconds by default):

```typescript
// Worker polls for pending items
const pendingItems = await outboxStore.listByStatus(OutboxStatus.PENDING)

for (const item of pendingItems) {
  await outboxSender.send(item)
}
```

**Step 4: Outbox Sender Routing**

The sender routes the CONVERSION transaction to the receipt handler:

```typescript
switch (item.txType) {
  case TxType.CONVERSION:
    await this.sendReceipt(item)
    break
  // ... other types
}
```

**Step 5: Adapter Submission**

The adapter submits the receipt to the blockchain:

```typescript
await adapter.recordReceipt({
  txId: item.txId,
  txType: TxType.CONVERSION,
  amountUsdc: payload.amountUsdc,
  tokenAddress: payload.tokenAddress,
  dealId: 'conversion',
  amountNgn: payload.amountNgn,
  fxRate: payload.fxRateNgnPerUsdc,
  fxProvider: payload.fxProvider
})
```

**Step 6: On-Chain Storage**

The smart contract:
- Validates the receipt parameters
- Checks for duplicate `tx_id` (rejects if exists)
- Stores the receipt with all metadata
- Emits a receipt event for indexing

**Step 7: Status Update**

On success, the sender updates the outbox:

```typescript
await outboxStore.updateStatus(item.id, OutboxStatus.SENT)
```

The receipt is now permanently recorded on-chain!

## Idempotency Guarantees

The system provides idempotency at four distinct layers to ensure receipts are never duplicated:

### Layer 1: Service Layer Idempotency

**Location**: `ConversionService.convertDeposit()` / `convertForStaking()`

**Mechanism**: Before creating a new conversion, the service checks if one already exists for the given `depositId`:

```typescript
const existing = await conversionStore.getByDepositId(params.depositId)
if (existing?.status === 'completed') {
  await this.ensureConversionReceiptOutbox(existing)
  return existing
}
```

**Guarantee**: Multiple calls with the same `depositId` return the same conversion record without creating duplicates.

**Why it matters**: Prevents duplicate conversions at the source, which would lead to duplicate receipts downstream.

### Layer 2: Outbox Layer Idempotency

**Location**: `OutboxStore.create()`

**Mechanism**: The database enforces a unique constraint on `(source, ref)`:

```sql
UNIQUE (source, ref)
```

When a duplicate entry is attempted, the store returns the existing entry instead of creating a new one.

**Guarantee**: Only one outbox entry can exist for a given `(source, ref)` combination.

**Why it matters**: Even if the service layer is bypassed or called multiple times, the outbox prevents duplicate entries from being created.

### Layer 3: Adapter Layer Idempotency

**Location**: `SorobanAdapter.recordReceipt()`

**Mechanism**: The adapter catches errors indicating duplicate receipts from the contract:

```typescript
try {
  // Submit transaction to contract
  await submitTransaction(...)
} catch (err) {
  if (isDuplicateReceiptError(err, params.txId)) {
    logger.info('Receipt already recorded (idempotent success)', {
      txId: params.txId
    })
    return  // Treat as success
  }
  throw err  // Re-throw other errors
}
```

**Guarantee**: Duplicate receipt errors are treated as idempotent success, not failures.

**Why it matters**: Allows safe retries without failing when a receipt was already recorded in a previous attempt.

### Layer 4: Contract Layer Idempotency

**Location**: Soroban Smart Contract `record_receipt()`

**Mechanism**: The contract maintains a map of `tx_id` to receipts and rejects duplicates:

```rust
if receipts.contains_key(&tx_id) {
  return Err(Error::DuplicateReceipt)
}
receipts.set(&tx_id, &receipt)
```

**Guarantee**: The contract is the final authority—it will never store duplicate receipts for the same `tx_id`.

**Why it matters**: Provides the ultimate guarantee that receipts are unique on-chain, regardless of any issues in upstream layers.

## Metadata Fields

Each conversion receipt includes rich metadata for auditability and reconciliation:

### amountNgn

**Type**: `number` (integer, in kobo—smallest NGN unit)

**Description**: The source amount in Nigerian Naira that was converted to USDC.

**Example**: `160000` represents 1,600.00 NGN (160,000 kobo)

**Purpose**: 
- Enables verification of the conversion input amount
- Supports reconciliation with off-chain conversion records
- Provides transparency for users to verify conversion amounts

**On-chain storage**: Stored as `i128` in the smart contract

### fxRate (fxRateNgnPerUsdc)

**Type**: `number` (decimal)

**Description**: The exchange rate used for the conversion, expressed as NGN per 1 USDC.

**Example**: `1600` means 1 USDC = 1,600 NGN

**Purpose**:
- Documents the exact rate used for the conversion
- Enables verification that the conversion was executed at the agreed rate
- Supports historical analysis of exchange rate trends
- Critical for dispute resolution

**On-chain storage**: Scaled by 1,000,000 and stored as `i128` in the smart contract to preserve precision

**Calculation verification**:
```typescript
// Verify the conversion math
const expectedUsdc = amountNgn / fxRate
// Should match conversion.amountUsdc (within rounding tolerance)
```

### fxProvider

**Type**: `string`

**Description**: Identifies which conversion provider executed the conversion.

**Valid values**:
- `'onramp'`: Conversion from user deposit (NGN → USDC)
- `'offramp'`: Conversion for user withdrawal (USDC → NGN, recorded as NGN → USDC equivalent)
- `'manual_admin'`: Manual conversion executed by admin

**Purpose**:
- Tracks which provider handled each conversion
- Enables provider-specific reconciliation and auditing
- Supports analysis of provider performance and rates
- Required for compliance and reporting

**On-chain storage**: Stored as `String` in the smart contract (optional field)

### Additional Fields

While not metadata per se, these fields are also recorded:

- **txId**: Deterministic identifier (SHA-256 of canonical external reference)
- **txType**: Always `TxType.CONVERSION` for conversion receipts
- **amountUsdc**: Result amount in USDC (decimal string)
- **tokenAddress**: USDC token contract address
- **dealId**: Always `'conversion'` for conversion receipts

## Verification Guide

### For Operators: Verifying Receipts Were Recorded

**1. Check Conversion Status**

Query the conversion record to verify it completed:

```typescript
const conversion = await conversionStore.getByDepositId(depositId)
console.log('Status:', conversion.status)  // Should be 'completed'
console.log('Provider Ref:', conversion.providerRef)  // Should exist
```

**2. Check Outbox Entry**

Verify an outbox entry was created:

```typescript
const outboxItem = await outboxStore.getByExternalRef(
  'onramp',  // or 'offramp', 'manual_admin'
  conversion.providerRef
)
console.log('Outbox Status:', outboxItem.status)  // Should be 'SENT'
console.log('Retry Count:', outboxItem.retryCount)
console.log('Processed At:', outboxItem.processedAt)
```

**3. Verify On-Chain Receipt**

Query the blockchain indexer for the receipt:

```typescript
const receipt = await indexer.getReceiptByTxId(outboxItem.txId)
console.log('On-chain Receipt:', receipt)
console.log('Amount NGN:', receipt.amountNgn)
console.log('FX Rate:', receipt.fxRate)
console.log('FX Provider:', receipt.fxProvider)
```

**4. Verify Metadata Matches**

Cross-check that on-chain metadata matches the conversion:

```typescript
assert(receipt.amountNgn === conversion.amountNgn)
assert(receipt.fxRate === conversion.fxRateNgnPerUsdc)
assert(receipt.fxProvider === conversion.provider)
```

### For Developers: Testing Receipt Recording

**Integration Test Example**

```typescript
import { ConversionService } from './conversionService'
import { outboxStore, OutboxStatus } from '../outbox'
import { TestSorobanAdapter } from '../soroban/test-adapter'

// Set up test infrastructure
const testAdapter = new TestSorobanAdapter(sorobanConfig)
const outboxSender = new OutboxSender(testAdapter)
const conversionService = new ConversionService(stubProvider, 'onramp')

// Execute conversion
const conversion = await conversionService.convertDeposit({
  depositId: 'test-deposit-123',
  userId: 'test-user-456',
  amountNgn: 160000
})

// Process outbox
const pendingItems = await outboxStore.listByStatus(OutboxStatus.PENDING)
for (const item of pendingItems) {
  await outboxSender.send(item)
}

// Verify receipt was recorded
const receipts = testAdapter.getRecordedReceipts()
expect(receipts).toHaveLength(1)
expect(receipts[0].amountNgn).toBe(160000)
expect(receipts[0].fxRate).toBe(1600)
expect(receipts[0].fxProvider).toBe('onramp')
```

## Troubleshooting

### Common Issues and Solutions

#### Issue 1: Outbox Entry Stuck in PENDING Status

**Symptoms**:
- Conversion completed successfully
- Outbox entry exists with status PENDING
- Receipt not recorded on-chain

**Possible Causes**:
1. OutboxWorker is not running
2. Adapter configuration is incorrect
3. Network connectivity issues

**Solutions**:

```typescript
// Check if OutboxWorker is running
// Look for log messages: "OutboxWorker started"

// Manually trigger send for debugging
const item = await outboxStore.getById(outboxItemId)
await outboxSender.send(item)

// Check adapter configuration
const config = adapter.getConfig()
console.log('Contract ID:', config.contractId)
console.log('RPC URL:', config.rpcUrl)
console.log('Network:', config.networkPassphrase)
```

#### Issue 2: Outbox Entry in FAILED Status

**Symptoms**:
- Outbox entry has status FAILED
- `lastError` field contains error message
- `retryCount` is incrementing

**Possible Causes**:
1. Transient network errors
2. Contract errors (invalid parameters)
3. Insufficient gas/fees
4. Configuration errors

**Solutions**:

```typescript
// Check the error message
const item = await outboxStore.getById(outboxItemId)
console.log('Last Error:', item.lastError)
console.log('Retry Count:', item.retryCount)
console.log('Next Retry At:', item.nextRetryAt)

// For transient errors, wait for automatic retry
// For persistent errors, investigate the error message

// Manual retry if needed
await outboxSender.retry(outboxItemId)
```

**Common Error Messages**:

- `"Simulated transient failure"`: Test adapter failure simulation (test environment only)
- `"Receipt already exists for tx_id"`: Duplicate receipt (handled as idempotent success)
- `"Invalid receipt payload: missing required fields"`: Payload validation failed
- `"Configuration error: missing SOROBAN_CONTRACT_ID"`: Adapter not configured

#### Issue 3: Max Retry Count Reached

**Symptoms**:
- Outbox entry has status FAILED
- `retryCount` is 10 or higher
- No more automatic retries

**Possible Causes**:
- Persistent configuration error
- Invalid payload data
- Contract is paused or unavailable

**Solutions**:

```typescript
// Investigate the root cause
const item = await outboxStore.getById(outboxItemId)
console.log('Last Error:', item.lastError)
console.log('Payload:', item.payload)

// Fix the underlying issue (configuration, contract, etc.)

// Reset retry count and manually retry
await outboxStore.resetRetryCount(outboxItemId)
await outboxSender.retry(outboxItemId)
```

#### Issue 4: Duplicate Conversion Created

**Symptoms**:
- Multiple conversion records for the same depositId
- Multiple outbox entries for the same conversion

**Possible Causes**:
- Race condition in concurrent requests
- Service layer idempotency check bypassed

**Solutions**:

```typescript
// Check for duplicate conversions
const conversions = await conversionStore.listByDepositId(depositId)
console.log('Conversion Count:', conversions.length)

// The outbox layer should still prevent duplicate receipts
// Verify only one outbox entry exists
const outboxItems = await outboxStore.listByDealId('conversion', TxType.CONVERSION)
const itemsForDeposit = outboxItems.filter(item => 
  item.payload.depositId === depositId
)
console.log('Outbox Items:', itemsForDeposit.length)  // Should be 1

// If multiple outbox items exist, check their status
// Only one should be SENT, others should fail with duplicate error
```

#### Issue 5: Metadata Missing or Incorrect

**Symptoms**:
- Receipt recorded on-chain but metadata fields are null or wrong
- `amountNgn`, `fxRate`, or `fxProvider` don't match conversion

**Possible Causes**:
- Conversion record missing metadata
- Payload construction error
- Adapter parameter mapping error

**Solutions**:

```typescript
// Verify conversion has metadata
const conversion = await conversionStore.getByDepositId(depositId)
console.log('Amount NGN:', conversion.amountNgn)
console.log('FX Rate:', conversion.fxRateNgnPerUsdc)
console.log('Provider:', conversion.provider)

// Verify outbox payload
const outboxItem = await outboxStore.getByExternalRef(source, ref)
console.log('Payload:', outboxItem.payload)

// Verify adapter received correct parameters
// Check adapter logs for recordReceipt calls
```

#### Issue 6: Staking Conversion Not Creating Receipt

**Symptoms**:
- Staking conversion completed
- No outbox entry created

**Possible Causes**:
- Missing `providerRef` in conversion
- `convertForStaking()` not called correctly

**Solutions**:

```typescript
// Verify the conversion was created with convertForStaking
const conversion = await conversionStore.getByDepositId(depositId)
console.log('Deposit ID format:', conversion.depositId)
// Should be: "stake:{externalRefSource}:{externalRef}"

// Verify providerRef exists
console.log('Provider Ref:', conversion.providerRef)

// If providerRef is missing, the conversion provider didn't return it
// Check StubConversionProvider or real provider implementation
```

### Debugging Tools

**Enable Debug Logging**

```typescript
// Set log level to debug
process.env.LOG_LEVEL = 'debug'

// Look for these log messages:
// - "Attempting to send outbox item"
// - "Receipt recorded on-chain"
// - "Receipt already recorded (idempotent success)"
// - "Failed to send outbox item"
```

**Inspect Outbox State**

```typescript
// List all outbox items by status
const pending = await outboxStore.listByStatus(OutboxStatus.PENDING)
const failed = await outboxStore.listByStatus(OutboxStatus.FAILED)
const sent = await outboxStore.listByStatus(OutboxStatus.SENT)

console.log('Pending:', pending.length)
console.log('Failed:', failed.length)
console.log('Sent:', sent.length)
```

**Test Adapter Inspection**

```typescript
// In test environment, use TestSorobanAdapter
const testAdapter = new TestSorobanAdapter(config)

// After processing, inspect recorded receipts
const receipts = testAdapter.getRecordedReceipts()
console.log('Recorded Receipts:', receipts)

// Simulate failures for testing
testAdapter.simulateFailures(2)  // Fail next 2 attempts
testAdapter.simulateDuplicateError()  // Simulate duplicate on next attempt
```

## Code Examples

### Example 1: Execute a Conversion

```typescript
import { ConversionService } from './services/conversionService'
import { StubConversionProvider } from './services/conversionProvider'

// Create conversion service
const provider = new StubConversionProvider(1600)  // 1600 NGN per USDC
const conversionService = new ConversionService(provider, 'onramp')

// Execute conversion
const conversion = await conversionService.convertDeposit({
  depositId: 'deposit-123',
  userId: 'user-456',
  amountNgn: 160000  // 160,000 NGN (1,600.00 NGN)
})

console.log('Conversion ID:', conversion.conversionId)
console.log('Amount USDC:', conversion.amountUsdc)
console.log('FX Rate:', conversion.fxRateNgnPerUsdc)
console.log('Provider Ref:', conversion.providerRef)
```

### Example 2: Execute a Staking Conversion

```typescript
// Execute conversion for staking operation
const stakingConversion = await conversionService.convertForStaking({
  externalRefSource: 'staking-provider',
  externalRef: 'stake-ref-12345',
  userId: 'user-789',
  amountNgn: 320000  // 320,000 NGN
})

// Deposit ID uses synthetic format
console.log('Deposit ID:', stakingConversion.depositId)
// Output: "stake:staking-provider:stake-ref-12345"
```

### Example 3: Query Outbox Status

```typescript
import { outboxStore, OutboxStatus } from './outbox'

// Get outbox entry by external reference
const outboxItem = await outboxStore.getByExternalRef(
  'onramp',
  'provider-ref-123'
)

console.log('Status:', outboxItem.status)
console.log('Retry Count:', outboxItem.retryCount)
console.log('Created At:', outboxItem.createdAt)
console.log('Processed At:', outboxItem.processedAt)

if (outboxItem.status === OutboxStatus.FAILED) {
  console.log('Last Error:', outboxItem.lastError)
  console.log('Next Retry At:', outboxItem.nextRetryAt)
}
```

### Example 4: Manually Retry Failed Item

```typescript
import { OutboxSender } from './outbox/sender'
import { SorobanAdapter } from './soroban/adapter'

// Create sender with real adapter
const adapter = new SorobanAdapter(sorobanConfig)
const sender = new OutboxSender(adapter)

// Retry specific item
const success = await sender.retry(outboxItemId)
console.log('Retry successful:', success)

// Retry all failed items
const result = await sender.retryAll()
console.log('Succeeded:', result.succeeded)
console.log('Failed:', result.failed)
```

### Example 5: Integration Test Setup

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { ConversionService } from './conversionService'
import { StubConversionProvider } from './conversionProvider'
import { outboxStore, OutboxSender, OutboxStatus } from '../outbox'
import { TestSorobanAdapter } from '../soroban/test-adapter'

describe('Conversion Receipt Tests', () => {
  let conversionService: ConversionService
  let outboxSender: OutboxSender
  let testAdapter: TestSorobanAdapter

  beforeEach(async () => {
    // Clear test database
    await conversionStore.clear()
    await outboxStore.clear()

    // Set up test adapter
    testAdapter = new TestSorobanAdapter(sorobanConfig)
    testAdapter.reset()

    // Set up sender and service
    outboxSender = new OutboxSender(testAdapter)
    const stubProvider = new StubConversionProvider(1600)
    conversionService = new ConversionService(stubProvider, 'onramp')
  })

  it('should record receipt with metadata', async () => {
    // Execute conversion
    const conversion = await conversionService.convertDeposit({
      depositId: 'test-deposit',
      userId: 'test-user',
      amountNgn: 160000
    })

    // Process outbox
    const pending = await outboxStore.listByStatus(OutboxStatus.PENDING)
    for (const item of pending) {
      await outboxSender.send(item)
    }

    // Verify receipt
    const receipts = testAdapter.getRecordedReceipts()
    expect(receipts).toHaveLength(1)
    expect(receipts[0].amountNgn).toBe(160000)
    expect(receipts[0].fxRate).toBe(1600)
    expect(receipts[0].fxProvider).toBe('onramp')
  })
})
```

### Example 6: Verify Receipt On-Chain

```typescript
import { indexer } from './indexer'

// Get receipt by transaction ID
const receipt = await indexer.getReceiptByTxId(txId)

console.log('Transaction ID:', receipt.txId)
console.log('Transaction Type:', receipt.txType)
console.log('Amount USDC:', receipt.amountUsdc)
console.log('Amount NGN:', receipt.amountNgn)
console.log('FX Rate:', receipt.fxRate)
console.log('FX Provider:', receipt.fxProvider)
console.log('Deal ID:', receipt.dealId)
console.log('Token Address:', receipt.tokenAddress)

// Verify metadata matches conversion
const conversion = await conversionStore.getByProviderRef(providerRef)
assert(receipt.amountNgn === conversion.amountNgn)
assert(receipt.fxRate === conversion.fxRateNgnPerUsdc)
assert(receipt.fxProvider === conversion.provider)
```

### Example 7: Handle Idempotency

```typescript
// Call convertDeposit multiple times with same depositId
const depositId = 'deposit-idempotent-test'

const conversion1 = await conversionService.convertDeposit({
  depositId,
  userId: 'user-123',
  amountNgn: 160000
})

const conversion2 = await conversionService.convertDeposit({
  depositId,
  userId: 'user-123',
  amountNgn: 160000
})

// Both return the same conversion
console.log('Same conversion:', conversion1.conversionId === conversion2.conversionId)
// Output: true

// Only one outbox entry exists
const outboxItems = await outboxStore.listByDealId('conversion', TxType.CONVERSION)
const itemsForDeposit = outboxItems.filter(item => 
  item.payload.depositId === depositId
)
console.log('Outbox items:', itemsForDeposit.length)
// Output: 1
```

## Summary

The conversion receipt recording system provides a robust, auditable, and reliable way to record NGN→USDC conversions on-chain. Key takeaways:

- **Four-layer idempotency** ensures receipts are never duplicated
- **Outbox pattern** guarantees reliable delivery with automatic retries
- **Rich metadata** (amountNgn, fxRate, fxProvider) enables full auditability
- **Staking support** handles synthetic deposit IDs for staking operations
- **Comprehensive testing** validates all correctness properties

For questions or issues, refer to the Troubleshooting section or consult the integration tests in `backend/src/services/conversionReceipt.integration.test.ts`.
