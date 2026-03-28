# Rent Payments Contract

A Soroban smart contract for managing rent payment receipts with cursor-based pagination.

## Features

- **Receipt Management**: Create and store rent payment receipts
- **Cursor-Based Pagination**: Safe, stable pagination without skipping/duplicating records
- **Stable Ordering**: Deterministic ordering using `(timestamp ASC, tx_id ASC)`
- **Comprehensive Testing**: Full test coverage including edge cases

## Core Types

### Receipt
```rust
pub struct Receipt {
    pub id: ReceiptId,           // Unique receipt identifier
    pub deal_id: DealId,         // Associated deal
    pub amount: i128,            // Payment amount
    pub timestamp: Timestamp,     // Creation timestamp
    pub tx_id: TxId,            // Transaction hash (BytesN<32>)
    pub payer: Address,          // Payer address
}
```

### Cursor
```rust
pub struct Cursor {
    pub timestamp: Timestamp,     // Last seen timestamp
    pub tx_id: TxId,            // Last seen transaction ID
}
```

### ReceiptPage
```rust
pub struct ReceiptPage {
    pub receipts: Vec<Receipt>,   // Paginated receipts
    pub has_next: bool,          // True if more pages exist
    pub next_cursor: Cursor,      // Cursor for next page
}
```

## Pagination

### Stable Ordering

Receipts are ordered by:
1. **timestamp** (ascending)
2. **tx_id** (ascending, as bytes comparison)

This ensures deterministic ordering even when multiple receipts have the same timestamp.

### Cursor Usage

The `list_receipts_by_deal` function implements cursor-based pagination:

```rust
pub fn list_receipts_by_deal(
    env: Env,
    deal_id: DealId,
    limit: u32,              // 1-100 receipts per page
    cursor: Option<Cursor>,   // None for first page
) -> ReceiptPage
```

#### First Page
```rust
let first_page = contract.list_receipts_by_deal(
    &deal_id,
    &10u32,        // 10 receipts per page
    &None          // Start from beginning
);
```

#### Subsequent Pages
```rust
if first_page.has_next {
    let second_page = contract.list_receipts_by_deal(
        &deal_id,
        &10u32,
        &Some(first_page.next_cursor)  // Use cursor from previous page
    );
}
```

#### Pagination Loop
```rust
let mut cursor = None;
loop {
    let page = contract.list_receipts_by_deal(&deal_id, &10u32, &cursor);
    
    // Process receipts
    for receipt in page.receipts.iter() {
        // Handle receipt
    }
    
    if !page.has_next {
        break;
    }
    
    cursor = Some(page.next_cursor);
}
```

### Cursor Encoding

The cursor encodes the last seen `(timestamp, tx_id)` tuple:
- **timestamp**: u64 ledger timestamp
- **tx_id**: BytesN<32> transaction hash

This format ensures:
- **Stable positioning**: Cursor always points to a specific location
- **Resume capability**: Can resume from any point in the result set
- **No duplicates**: Each receipt appears exactly once across pages

## API Reference

### Functions

#### `init(env: Env, admin: Address)`
Initialize the contract with an admin address.

#### `create_receipt(env: Env, deal_id: DealId, amount: i128, payer: Address) -> Receipt`
Create a new receipt for a deal. Requires admin authentication.

#### `list_receipts_by_deal(env: Env, deal_id: DealId, limit: u32, cursor: Option<Cursor>) -> ReceiptPage`
List receipts for a deal with cursor-based pagination.

#### `receipt_count(env: Env, deal_id: DealId) -> u64`
Get the total number of receipts for a deal.

## Interface

| Method | Args | Auth | Emitted events |
|---|---|---|---|
| `init` | `admin: Address` | public (one-time init) | `("init")` |
| `contract_version` | none | public | none |
| `create_receipt` | `deal_id: DealId, amount: i128, payer: Address` | admin | `("receipt_created", deal_id)` |
| `list_receipts_by_deal` | `deal_id: DealId, limit: u32, cursor: Option<Cursor>` | public | none |
| `receipt_count` | `deal_id: DealId` | public | none |

## Error Handling

- **Invalid limit**: Returns `ContractError::InvalidLimit` if limit is 0 or > 100
- **Authentication**: `create_receipt` requires admin authentication
- **Validation**: `create_receipt` returns `ContractError::InvalidAmount` if amount is not positive

## Testing

The contract includes comprehensive tests:

- **Basic pagination**: Single and multi-page scenarios
- **Edge cases**: Empty results, invalid limits
- **Stable ordering**: Verifies consistent ordering across pages
- **Same timestamp**: Tests ordering when timestamps are identical
- **No skipping/duplication**: Ensures each receipt appears exactly once

Run tests:
```bash
cargo test
```

## Integration Notes

### Backend Integration

When integrating with backend systems:
1. Store the cursor between page requests
2. Handle empty pages gracefully
3. Use the `has_next` flag to determine pagination completion
4. Validate cursor integrity before resuming

### Performance Considerations

- **Sorting**: Receipts are sorted on-demand using bubble sort (O(n²))
- **Memory**: All receipts for a deal are loaded into memory
- **Limits**: Maximum 100 receipts per page to prevent excessive memory usage

For production use with large datasets, consider:
- Implementing indexed storage
- Using more efficient sorting algorithms
- Adding database-style indexing for timestamp/tx_id combinations

## Security

- **Admin-only**: Only admin can create receipts
- **Input validation**: All inputs are validated
- **Cursor safety**: Cursors are validated before use
- **Rate limiting**: Built-in limits prevent excessive resource usage
