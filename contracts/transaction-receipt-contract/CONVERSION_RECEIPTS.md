# Conversion Receipt Implementation

## Overview

Added support for recording NGN→USDC conversion receipts with full auditability and user indexing.

## Changes Made

### 1. Transaction Type Support

**File:** `src/lib.rs`

- Added `CONVERSION` to `ALLOWED_TX_TYPES` array
- Conversion receipts are validated and stored like other transaction types
- Idempotency enforced using canonical external reference rules

### 2. User Indexing

**File:** `src/lib.rs`

Added new storage keys:
```rust
UserIndex(Address, u32)  // Maps (user_address, index) → tx_id
UserCount(Address)       // Maps user_address → count
```

Updated `record_receipt()` to automatically index receipts by:
- `from` address (if present)
- `to` address (if present)

This enables efficient queries for all receipts involving a specific user.

### 3. Query API

**File:** `src/lib.rs`

Added new public function:
```rust
pub fn list_receipts_by_user(
    env: Env,
    user: Address,
    limit: u32,
    cursor: Option<u32>,
) -> Vec<Receipt>
```

Returns all receipts where the user appears as sender or recipient, with pagination support.

### 4. Tests

**File:** `src/test.rs`

Added three comprehensive tests:

1. **`test_conversion_receipt_with_metadata`**
   - Records a CONVERSION receipt with NGN amount, FX rate, and provider
   - Verifies all metadata fields are stored correctly

2. **`test_list_receipts_by_user`**
   - Records multiple receipts with different users
   - Tests user indexing for both sender and recipient
   - Validates pagination (limit and cursor)

3. **`test_conversion_idempotency`**
   - Verifies duplicate conversion receipts are rejected
   - Ensures external reference uniqueness is enforced

### 5. Documentation

**File:** `README.md`

- Added `CONVERSION` to transaction types list
- Documented `list_receipts_by_user` in Public API section
- Added "Conversion receipts" section explaining metadata fields
- Added "Indexing strategy" section explaining the three query patterns

## Acceptance Criteria ✅

- [x] Conversion receipts are idempotent using canonical external ref rules
- [x] Indexers can query conversion receipts by dealId (existing `list_receipts_by_deal`)
- [x] Indexers can query conversion receipts by user (new `list_receipts_by_user`)
- [x] `tx_type: CONVERSION` added to allowed list
- [x] Metadata fields supported: `amount_ngn`, `fx_rate_ngn_per_usdc`, `fx_provider`
- [x] External ref pointing to conversion provider ref

## Usage Example

```rust
// Record a conversion receipt
let input = ReceiptInput {
    external_ref_source: Symbol::new(&env, "onramp"),
    external_ref: String::from_str(&env, "conv_12345"),
    tx_type: Symbol::new(&env, "CONVERSION"),
    amount_usdc: 1_000_000,  // Result: 1 USDC
    token: usdc_token_address,
    deal_id: String::from_str(&env, "deal_001"),
    listing_id: None,
    from: Some(user_address),
    to: Some(staking_pool_address),
    amount_ngn: Some(1_500_000_000),  // Source: 1,500 NGN
    fx_rate_ngn_per_usdc: Some(1_500),  // Rate: 1,500 NGN per USDC
    fx_provider: Some(String::from_str(&env, "provider_x")),
    metadata_hash: None,
};

let tx_id = client.record_receipt(&operator, &input);

// Query by user
let user_receipts = client.list_receipts_by_user(&user_address, &10, &None);

// Query by deal
let deal_receipts = client.list_receipts_by_deal(&String::from_str(&env, "deal_001"), &10, &None);
```

## Canonical metadata_hash (v1)

If you choose to supply `metadata_hash` when recording a receipt, it MUST be the SHA-256 of the canonical receipt payload (v1):

`v1|external_ref_source=<lowercased_trimmed>|external_ref=<trimmed>|tx_type=<case_sensitive>|amount_usdc=<i128>|token=<address>|deal_id=<string>|listing_id=<string>|from=<address>|to=<address>|amount_ngn=<i128>|fx_rate_ngn_per_usdc=<i128>|fx_provider=<string>`

Rules:
- Deterministic ordering as shown above. Ordering MUST NOT change.
- Optional fields are omitted entirely when `None`.
- When present, values are rendered without extra whitespace.

The contract validates a provided `metadata_hash` and rejects mismatches with `InvalidMetadataHash` (error code 10).

## Test Results

All 40 tests pass, including the 3 new conversion receipt tests:

```
test test::test_conversion_receipt_with_metadata ... ok
test test::test_list_receipts_by_user ... ok
test test::test_conversion_idempotency ... ok
```

## Indexing Performance

The user indexing strategy provides O(1) lookup for:
- Total receipt count per user
- Paginated receipt retrieval per user

Storage overhead: 2 additional keys per user per receipt (UserIndex + UserCount update)
