# Shelterflex Contracts (Soroban)

This folder contains Soroban smart contracts written in Rust.

## Prerequisites

- Rust (stable)
- Soroban CLI (via `stellar` CLI) installed and configured

## Workspace

- `rent_wallet/` - Minimal reference contract for wallet-like credit/debit flows
- `rent_payments/` - Contract for managing deals and receipts with paginated queries

## Build & test

```bash
cd contracts

# 1) Run unit tests
cargo test

# 2) Build the deployable contract WASM (recommended)
# Produces an optimized .wasm under each contract crate's `target/` directory.
stellar contract build

# 3) Build the deployable contract WASM (cargo-only alternative)
rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown -p rent_wallet
```

The `cargo build --release` (native) build is not the deployable artifact for Soroban.

## Troubleshooting

- **Tooling versions**
  - `rustc --version` should be stable.
  - `stellar --version` should be recent enough to support `stellar contract build`.
  - This repo uses `soroban-sdk = 22.0.7` (see `rent_wallet/Cargo.toml`).

- **`error: toolchain ... does not support target 'wasm32-unknown-unknown'`**
  - Install the target:
    - `rustup target add wasm32-unknown-unknown`

- **`stellar: command not found` / `stellar contract: unknown command`**
  - Install/upgrade the Stellar CLI with Soroban support and verify:
    - `stellar --version`
    - `stellar contract --help`

- **Build succeeds but you can’t find the `.wasm`**
  - If you used `stellar contract build`, look under the relevant contract crate’s `target/` directory.
  - If you used the cargo-only build, look under:
    - `contracts/target/wasm32-unknown-unknown/release/`

## Deploy (example)

Exact commands depend on your Soroban CLI version.

High-level flow:

1. Choose network (local sandbox or testnet)
2. Build the contract WASM
3. Deploy
4. Initialize with an admin address

Recommended contributor expectations for deployment-related issues:

- Provide exact CLI commands you used
- Include network info (rpc url + passphrase)
- Include contract id and init params

## Contract interface

### `rent_wallet`

- `init(admin: Address)`
- `credit(user: Address, amount: i128)` (admin-auth)
- `debit(user: Address, amount: i128)` (admin-auth)
- `balance(user: Address) -> i128`
- `set_admin(new_admin: Address)` (admin-auth)
- `pause()` (admin-auth)
- `unpause()` (admin-auth)
- `is_paused() -> bool`

### Events

The `rent_wallet` contract emits Soroban events to support indexing and auditability.

- **`credit`**
  - **Topic**
    - `("credit", user: Address)`
  - **Data**
    - `(amount: i128, new_balance: i128)`

- **`debit`**
  - **Topic**
    - `("debit", user: Address)`
  - **Data**
    - `(amount: i128, new_balance: i128)`

For both events:

- **`user`** is the address whose balance was modified.
- **`amount`** is the delta applied (always positive).
- **`new_balance`** is the resulting balance after applying the delta.

- **`pause`**
  - **Topic**
    - `("pause",)`
  - **Data**
    - `()`
  - Emitted when the contract is paused by the admin.

- **`unpause`**
  - **Topic**
    - `("unpause",)`
  - **Data**
    - `()`
  - Emitted when the contract is unpaused by the admin.

### Pause Functionality

The contract includes a pause mechanism for emergency stops:

- **`pause()`**: Pauses the contract. Only the admin can call this function.
- **`unpause()`**: Unpauses the contract. Only the admin can call this function.
- **`is_paused()`**: Returns `true` if the contract is paused, `false` otherwise.

**Behavior when paused:**
- `credit()` and `debit()` operations will fail with a panic if called while the contract is paused.
- `balance()` and other read-only operations continue to work normally when paused.
- Only the admin can pause or unpause the contract.

### `rent_payments`

- `init(admin: Address)`
- `create_receipt(deal_id: DealId, amount: i128, payer: Address) -> Receipt` (admin-auth)
- `list_receipts_by_deal(deal_id: DealId, limit: u32, cursor: Option<Cursor>) -> ReceiptPage`
- `receipt_count(deal_id: DealId) -> u64`

#### Cursor-Based Pagination

The `list_receipts_by_deal` function implements cursor-based pagination for efficient retrieval of receipts.

**Cursor Format:**
- The cursor is a struct containing:
  - `timestamp: Timestamp` (u64) - The timestamp of the last receipt in the previous page
  - `tx_id: TxId` (BytesN<32>) - The transaction ID of the last receipt in the previous page

**Ordering:**
Receipts are ordered by a stable, deterministic ordering:
1. Primary: `timestamp` (ascending)
2. Secondary: `tx_id` (ascending, byte-wise comparison)

This ensures:
- Consistent pagination results even if multiple receipts share the same timestamp
- No skipping or duplication of receipts across pages
- Deterministic ordering that remains stable over time

**Usage:**
- First page: Pass `None` as the cursor
- Subsequent pages: Use `next_cursor` from the previous `ReceiptPage`
- Check `has_next` to determine if more pages are available

**Example:**
```rust
// First page
let page1 = client.list_receipts_by_deal(&deal_id, &10u32, &None);

// Next page (if available)
if page1.has_next {
    let page2 = client.list_receipts_by_deal(&deal_id, &10u32, &Some(page1.next_cursor));
}
```

**Limits:**
- `limit` must be between 1 and 100 (inclusive)
- The function will panic if an invalid limit is provided

#### Events

- **`receipt_created`**
  - **Topic**
    - `("receipt_created", deal_id: DealId)`
  - **Data**
    - `(receipt_id: ReceiptId, amount: i128, payer: Address)`
  - Emitted when a new receipt is created for a deal.
