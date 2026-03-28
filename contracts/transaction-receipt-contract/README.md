# Transaction Receipt Contract

This Soroban smart contract records immutable transaction receipts keyed by a deterministic transaction ID derived from an external payment reference.

See `docs/specs/contracts/CONVENTIONS.md` for shared conventions (errors, events, init patterns).

See `docs/specs/contracts/UPGRADE_STRATEGY.md` for the contract upgrade/versioning strategy.

## Purpose

- Record canonical transaction receipts for on-chain indexing and audit.
- Prevent duplicate receipts using a deterministic tx_id derived from external payment references.
- Provide query APIs to fetch receipts and list receipts by deal with pagination.

## Initialization

Call `init(admin: Address, operator: Address)` once to initialize the contract. This stores the `admin` (manages operator and pause) and `operator` (records receipts) addresses and sets the paused state to `false`.

Attempting to `init` a second time returns `AlreadyInitialized`.

## Public API

- `init(env, admin, operator) -> Result<(), ContractError>`: initialize contract.
- `version(env) -> u32`: canonical on-chain version getter.
- `pause(env, admin) -> Result<(), ContractError>`: pause recording (admin only).
- `unpause(env, admin) -> Result<(), ContractError>`: unpause (admin only).
- `set_operator(env, admin, new_operator) -> Result<(), ContractError>`: update operator (admin only).
- `record_receipt(env, operator, input: ReceiptInput) -> Result<BytesN<32>, ContractError>`: record a transaction receipt (operator only, rejects duplicates or invalid input).
- `get_receipt(env, tx_id: BytesN<32>) -> Option<Receipt>`: fetch a receipt by tx_id.
- `list_receipts_by_deal(env, deal_id: String, limit: u32, cursor: Option<u32>) -> Vec<Receipt>`: list receipts for a deal with pagination.
- `list_receipts_by_user(env, user: Address, limit: u32, cursor: Option<u32>) -> Vec<Receipt>`: list receipts for a user (from or to) with pagination.

## ReceiptInput and Receipt

`ReceiptInput` contains all fields required to record a receipt, including `external_ref_source`, `external_ref`, `tx_type`, `amount_usdc`, `token`, `deal_id`, and optional metadata fields.

`Receipt` is the stored, immutable representation returned by queries and emitted in events. The `external_ref` field in `Receipt` equals the `tx_id` (SHA-256 of canonicalized external ref) per contract design.

## Transaction ID canonicalization

Canonical format: `v1|source=<lowercased_trimmed_source>|ref=<trimmed_ref>`

Validation rules:
- `external_ref_source` must be one of the allowed sources: `paystack`, `flutterwave`, `bank_transfer`, `stellar`, `onramp`, `offramp`, `manual_admin` (case-insensitive).
- `external_ref` is trimmed of whitespace and must be non-empty, must not contain the pipe character `|`, and must be at most 256 characters.

The canonical string is SHA-256 hashed to produce a 32-byte `tx_id` (type `BytesN<32>`).

## Transaction type validation

The contract enforces strict validation on transaction types to ensure indexer consistency. Only the following transaction types are allowed for MVP:

- `TENANT_REPAYMENT` - Tenant rent payments
- `LANDLORD_PAYOUT` - Landlord payouts  
- `WHISTLEBLOWER_REWARD` - Whistleblower rewards
- `STAKE` - Staking operations
- `UNSTAKE` - Unstaking operations
- `STAKE_REWARD_CLAIM` - Staking reward claims
- `CONVERSION` - NGN to USDC conversions (for staking flows)

Any transaction type not in this list will be rejected with `InvalidTxType` error (error code 9). Transaction types are case-sensitive and must match exactly.

## Metadata hash

`metadata_hash` is optional and expected to be the SHA-256 hash of the canonical receipt payload (v1).

Canonical payload v1 format:

`v1|external_ref_source=<lowercased_trimmed>|external_ref=<trimmed>|tx_type=<case_sensitive>|amount_usdc=<i128>|token=<address>|deal_id=<string>|listing_id=<string>|from=<address>|to=<address>|amount_ngn=<i128>|fx_rate_ngn_per_usdc=<i128>|fx_provider=<string>`

Rules:
- Deterministic ordering as shown above. Ordering MUST NOT change.
- Optional fields (`listing_id`, `from`, `to`, `amount_ngn`, `fx_rate_ngn_per_usdc`, `fx_provider`) are omitted entirely when `None` (no `|key=` segment).
- When present, values are rendered without extra whitespace.

If `metadata_hash` is provided, the contract verifies it matches the canonical payload and rejects mismatches with `InvalidMetadataHash` (error code 10).

Length behavior:
- `metadata_hash` is typed as `Option<BytesN<32>>`, so only 32-byte hashes are accepted by the contract interface.
- Non-32-byte values are rejected at Soroban value decoding/type-conversion boundaries before contract logic executes.
- `metadata_hash` remains optional (`None` is valid and skips hash verification).

## Conversion receipts

Conversion receipts (`tx_type: CONVERSION`) record NGN to USDC conversions for full auditability in staking flows. These receipts support:

- `amount_usdc` - The resulting USDC amount (canonical)
- `amount_ngn` - The source NGN amount (metadata)
- `fx_rate_ngn_per_usdc` - The exchange rate used (metadata)
- `fx_provider` - The conversion provider name (metadata)
- `external_ref` - Provider's conversion reference (for idempotency)

Conversion receipts follow the same idempotency rules as other transaction types, using the canonical external reference to prevent duplicates.

## Indexing strategy

The contract maintains three indexing strategies for efficient queries:

1. **By transaction ID** - Direct lookup via `get_receipt(tx_id)`
2. **By deal** - Query all receipts for a deal via `list_receipts_by_deal(deal_id, limit, cursor)`
3. **By user** - Query all receipts where a user is sender or recipient via `list_receipts_by_user(user, limit, cursor)`

When a receipt is recorded with `from` and/or `to` addresses, the contract automatically indexes it under both users. This enables efficient queries for user transaction history without scanning all receipts.

## Error codes

The contract exposes the following `ContractError` variants (numeric values shown in tests):

- `AlreadyInitialized` (1)
- `NotAuthorized` (2)
- `Paused` (3)
- `InvalidAmount` (4)
- `DuplicateTransaction` (5)
- `InvalidExternalRefSource` (6)
- `InvalidExternalRef` (7)
- `InvalidTimestamp` (8)
- `InvalidTxType` (9) - Transaction type not in allowed list
- `InvalidMetadataHash` (10)

## Events

The contract emits canonical events with deterministic shapes:

- `init`: topic `(transaction_receipt, init)`, data `(admin, operator, version)`
- `set_operator`: topic `(transaction_receipt, set_operator)`, data `(old_operator, new_operator)`
- `pause`: topic `(transaction_receipt, pause)`, data `admin`
- `unpause`: topic `(transaction_receipt, unpause)`, data `admin`
- `receipt_recorded`: topic `(transaction_receipt, receipt_recorded, tx_id)`, data `Receipt`

Deterministic event vectors are asserted in tests for at least two event types (`init`, `receipt_recorded`) and include explicit topic and payload decoding assertions.

## Usage examples (testing harness)

The `src/test.rs` and `src/integration_tests.rs` files contain examples of how to call the contract from the Soroban test environment (`Env`). Examples include initialization, recording receipts, and querying.

## Testing

Run the contract tests with:

```bash
cargo test --manifest-path monorepo/contracts/transaction-receipt-contract/Cargo.toml
```

The project includes unit tests and integration-style tests that cover canonicalization, authorization, pause/unpause, duplicate prevention, and pagination.

Property-based tests are described in the design spec and can be added using `proptest` where necessary. Current tests validate the core behaviors and invariants.

## Notes

- The contract uses Soroban SDK storage patterns and event emission.
- The caller is responsible for generating `metadata_hash` if desired.
- The contract enforces deterministic tx_id generation to prevent duplicates originating from the same external reference.
