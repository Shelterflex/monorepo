# Golden Test Vectors for tx_id Consistency

## Overview

This document describes the golden test vectors implemented to ensure that the backend and contract compute identical `tx_id` values for the same external reference.

## Purpose

The golden test vectors guarantee that any changes to the canonicalization logic will be caught immediately by failing tests on both the backend and contract sides.

## Test Vectors

### Vector 1: Normal Case
- **Input**: `("paystack", "psk_12345")`
- **Expected Canonical**: `"v1|source=paystack|ref=psk_12345"`
- **Expected SHA256**: `"71e9a576e18d122acff8e200cefac00bfcba57f4dc64e9cdad89f64304c6d0ec"`

### Vector 2: Whitespace Trimming and Case Normalization
- **Input**: `("BANK_TRANSFER", " UTR_98765 ")`
- **Expected Canonical**: `"v1|source=bank_transfer|ref=UTR_98765"`
- **Expected SHA256**: `"e6cd19e46ae4e78bffce61f7ada43833ee97f01e3317be080e27ee398e74a29b"`

### Vector 3: Error Case (Empty Reference)
- **Input**: `("stellar", "")`
- **Expected Error**: `"Ref cannot be empty after trimming"`

## Implementation

### Backend Tests

Location: `backend/src/outbox/canonicalization.test.ts`

The backend tests include a new test suite called "golden test vectors" that:
1. Tests canonical string generation
2. Tests SHA256 hash computation
3. Tests error handling for invalid inputs
4. Verifies hash format (64-character hex string)

### Contract Tests

Location: `contracts/transaction-receipt-contract/src/test.rs`

The contract tests include a `test_golden_vectors` function that:
1. Tests successful tx_id generation for valid inputs
2. Tests error handling for invalid inputs
3. Verifies determinism (same inputs produce same outputs)
4. Verifies that different inputs produce different outputs

## Canonicalization Rules

Both backend and contract follow the same canonicalization rules:

1. **Source**: Trim whitespace and convert to lowercase
2. **Reference**: Trim whitespace but preserve case
3. **Format**: `"v1|source=<source>|ref=<ref>"`
4. **Validation**: 
   - Source must not be empty after trimming
   - Reference must not be empty after trimming
   - Reference must not contain pipe character (`|`)
   - Total canonical string must not exceed 256 characters
5. **Hash**: SHA-256 of UTF-8 encoded canonical string

## Acceptance Criteria Met

✅ **Define a small set of inputs**: Three test vectors defined
✅ **Expected canonical string and expected sha256 hex**: Computed and verified
✅ **Backend tests**: Test canonicalExternalRefV1 builder and computeTxId
✅ **Contract tests**: Test that receipt tx_id equals sha256(canonical string)
✅ **Tests fail loudly if canonicalization changes**: Both test suites will fail if either side changes canonicalization

## Usage

### Running Backend Tests
```bash
cd backend
npm test -- src/outbox/canonicalization.test.ts
```

### Running Contract Tests
```bash
cd contracts/transaction-receipt-contract
cargo test test_golden_vectors
```

## Future Maintenance

When making changes to the canonicalization logic:
1. Update the golden test vectors if the behavior change is intentional
2. Run both test suites to ensure consistency
3. Update this document if the test vectors change

The tests serve as a safety net to prevent accidental divergence between backend and contract implementations.
