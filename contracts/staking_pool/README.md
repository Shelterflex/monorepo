# Staking Pool Contract

A Soroban smart contract for staking USDC tokens with pause functionality for emergencies and metadata hash support for receipt verification.

See `docs/specs/contracts/CONVENTIONS.md` for shared conventions (errors, events, init patterns) and `docs/specs/contracts/UPGRADE_STRATEGY.md` for the contract upgrade/versioning strategy.

## Overview

The Staking Pool contract allows users to stake and unstake USDC tokens while providing administrators with emergency pause capabilities. This is an MVP implementation focused on core staking functionality without reward distribution, now enhanced with canonical metadata hash computation for transaction receipt verification.

## Features

- **Staking**: Users can stake USDC tokens
- **Unstaking**: Users can unstake their tokens (with optional lock period)
- **Lock Periods**: Optional time-based lockups to stabilize liquidity
- **Emergency Controls**: Admin can pause/unpause the contract
- **Token Integration**: Uses Soroban token interface for secure transfers
- **Event Emission**: Comprehensive events for indexers and monitoring
- **Metadata Hash**: Canonical payload serialization and SHA-256 hashing for receipt verification

## Contract Interface

### Initialization

```rust
init(admin: Address, token: Address)
```
- `admin`: Address of the contract administrator
- `token`: Address of the USDC token contract
- Can only be called once
- Emits: `("init", admin)`

### Core Functions

#### stake
```rust
stake(from: Address, amount: i128)
```
- `from`: Address of the user staking tokens
- `amount`: Amount of tokens to stake (must be positive)
- Requires: `from.require_auth()`
- Requires: Contract not paused
- Transfers tokens from user to contract
- Emits: `("stake", user)` with data: `(amount, new_user_balance, new_total)`

#### unstake
```rust
unstake(to: Address, amount: i128)
```
- `to`: Address of the user unstaking tokens
- `amount`: Amount of tokens to unstake (must be positive)
- Requires: `to.require_auth()`
- Requires: Contract not paused
- Requires: Sufficient staked balance
- Requires: Lock period expired (if lock period > 0)
- Transfers tokens from contract to user
- Emits: `("unstake", user)` with data: `(amount, new_user_balance, new_total)`

#### staked_balance
```rust
staked_balance(user: Address) -> i128
```
- `user`: Address to query
- Returns: Amount of tokens staked by the user

#### total_staked
```rust
total_staked() -> i128
```
- Returns: Total amount of tokens staked in the contract

### Lock Period Functions

#### set_lock_period
```rust
set_lock_period(seconds: u64)
```
- `seconds`: Lock period duration in seconds (0 = no lock period)
- Requires: Admin authorization
- Emits: `("set_lock_period",)` with data: `(seconds)`

#### get_lock_period
```rust
get_lock_period() -> u64
```
- Returns: Current lock period in seconds

### Admin Functions

#### pause
```rust
pause()
```
- Requires: Admin authorization
- Pauses all staking/unstaking operations
- Emits: `("pause",)`

#### unpause
```rust
unpause()
```
- Requires: Admin authorization
- Resumes normal contract operations
- Emits: `("unpause",)`

#### is_paused
```rust
is_paused() -> bool
```
- Returns: Current pause state of the contract

### Metadata Hash Functions

#### compute_metadata_hash
```rust
compute_metadata_hash(input: ReceiptInput) -> BytesN<32>
```
- `input`: ReceiptInput struct containing transaction data
- Returns: SHA-256 hash of canonical payload v1
- Requires: `amount_usdc` must be positive
- Uses deterministic serialization rules (see Canonical Payload Format v1 below)

#### verify_metadata_hash
```rust
verify_metadata_hash(input: ReceiptInput, expected_hash: BytesN<32>) -> bool
```
- `input`: ReceiptInput struct containing transaction data
- `expected_hash`: Expected SHA-256 hash to verify against
- Returns: `true` if hash matches, `false` otherwise

#### ReceiptInput Struct
```rust
pub struct ReceiptInput {
    pub tx_type: Symbol,           // Transaction type (e.g., "stake", "unstake")
    pub amount_usdc: i128,        // Transaction amount in USDC (must be positive)
    pub token: Address,           // USDC token contract address
    pub user: Address,            // User address performing the transaction
    pub timestamp: Option<u64>,   // Optional timestamp (uses current ledger time if None)
    pub deal_id: Option<String>,  // Optional deal identifier
    pub listing_id: Option<String>, // Optional listing identifier
    pub metadata: Option<Map<Symbol, String>>, // Optional metadata fields
}
```

## Interface

| Method | Args | Auth | Emitted events |
|---|---|---|---|
| `init` | `admin: Address, token: Address` | public (one-time init) | `("staking_pool","init")` |
| `contract_version` | none | public | none |
| `set_operator` | `admin: Address, operator: Address, enabled: bool` | admin | `("staking_pool","set_operator", operator)` |
| `is_operator` | `addr: Address` | public | none |
| `stake` | `from: Address, amount: i128` | user (`from`) | `("staking_pool","stake", from)` |
| `unstake` | `to: Address, amount: i128` | user (`to`) | `("staking_pool","unstake", to)` |
| `staked_balance` | `user: Address` | public | none |
| `total_staked` | none | public | none |
| `pause` | `admin: Address` | admin | `("staking_pool","pause")` |
| `unpause` | `admin: Address` | admin | `("staking_pool","unpause")` |
| `is_paused` | none | public | none |
| `set_lock_period` | `admin: Address, seconds: u64` | admin | `("staking_pool","set_lock_period")` |
| `get_lock_period` | none | public | none |
| `compute_metadata_hash` | `input: ReceiptInput` | public | none |
| `verify_metadata_hash` | `input: ReceiptInput, expected_hash: BytesN<32>` | public | none |

## Event Shapes

### Stake Event
```
Topics: ["stake", user_address]
Data: [amount, new_user_balance, new_total]
```

### Unstake Event
```
Topics: ["unstake", user_address]
Data: [amount, new_user_balance, new_total]
```

### Pause Event
```
Topics: ["pause"]
Data: []
```

### Unpause Event
```
Topics: ["unpause"]
Data: []
```

### Init Event
```
Topics: ["init"]
Data: [admin_address]
```

### Set Lock Period Event
```
Topics: ["set_lock_period"]
Data: [lock_period_seconds]
```

## Canonical Payload Format v1

The `compute_metadata_hash` function uses a deterministic serialization format to ensure consistent hashing across different implementations.

### Serialization Rules

**Field Order**: Fields are serialized in the exact order listed below:

1. **tx_type** (Symbol, 32 bytes max)
   - Serialized as Symbol value
   - Empty string if None

2. **amount_usdc** (i128, 16 bytes big-endian)
   - Always positive (validated before hashing)
   - Serialized as i128 value

3. **token** (Address, 32 bytes)
   - Serialized as Address value

4. **user** (Address, 32 bytes)
   - Serialized as Address value

5. **timestamp** (u64, 8 bytes)
   - Uses current ledger timestamp if None
   - Serialized as u64 value

6. **deal_id** (String, variable length with length prefix)
   - Empty string if None
   - Length prefix indicates string length

7. **listing_id** (String, variable length with length prefix)
   - Empty string if None
   - Length prefix indicates string length

8. **metadata** (Map<Symbol, String>, sorted by key)
   - Empty marker if None
   - Key-value pairs sorted by Symbol key (lexicographic)
   - Each pair: key followed by value

### Deterministic Properties

- **Fixed Ordering**: Fields are always serialized in the same order
- **Optional Fields**: None values are serialized as empty values
- **Metadata Sorting**: Map entries are sorted by key to ensure deterministic ordering
- **No Delimiters**: Fields are concatenated directly without separators
- **Hash Algorithm**: SHA-256 is used for final hash computation

### Example Serialization

```rust
// Input
ReceiptInput {
    tx_type: "stake",
    amount_usdc: 1000000,
    token: 0x1234...,
    user: 0x5678...,
    timestamp: Some(1620000000),
    deal_id: None,
    listing_id: Some("LIST001"),
    metadata: Some({"category": "rent_payment"})
}

// Serialized bytes (simplified representation)
// ["stake"][1000000][0x1234...][0x5678...][1620000000]["""LIST001"]["category"]["rent_payment"]

// Final SHA-256 hash
// 0xa1b2c3... (32 bytes)
```

### Usage Examples

```rust
// Compute hash for a stake transaction
let input = ReceiptInput {
    tx_type: Symbol::new(&env, "stake"),
    amount_usdc: 1000000i128,
    token: usdc_token_address,
    user: user_address,
    timestamp: Some(1620000000u64),
    deal_id: Some(String::from_str(&env, "DEAL001")),
    listing_id: None,
    metadata: None,
};

let hash = staking_pool.compute_metadata_hash(&input);

// Verify hash
let is_valid = staking_pool.verify_metadata_hash(&input, &expected_hash);
assert!(is_valid);
```

## Security Features

- **Authorization**: All operations require proper user authentication
- **Admin Controls**: Only admin can pause/unpause the contract
- **Input Validation**: All amounts must be positive
- **Balance Checks**: Unstake operations validate sufficient balance
- **Pause Protection**: Critical operations are blocked when paused

## Data Storage

The contract uses instance storage for:
- `Admin`: Administrator address
- `Token`: USDC token contract address
- `StakedBalances`: Map of user addresses to staked amounts
- `TotalStaked`: Total amount staked across all users
- `Paused`: Contract pause state
- `LockPeriod`: Lock period duration in seconds (0 = no lock period)
- `StakeTimestamps`: Map of user addresses to their last stake timestamp

## Usage Example

```rust
// Initialize contract
staking_pool.init(admin_address, usdc_token_address);

// Set lock period (admin only) - 1 hour lock period
staking_pool.set_lock_period(3600u64);

// Check current lock period
let lock_period = staking_pool.get_lock_period();

// Stake tokens (user must approve token transfer first)
staking_pool.stake(user_address, 1000i128);

// Check balances
let user_balance = staking_pool.staked_balance(user_address);
let total_balance = staking_pool.total_staked();

// Unstake tokens (will fail if lock period not expired)
staking_pool.unstake(user_address, 500i128);

// Emergency pause (admin only)
staking_pool.pause();

// Resume operations (admin only)
staking_pool.unpause();
```

## Testing

Run the comprehensive test suite:

```bash
cargo test
```

Test coverage includes:
- Happy path stake/unstake operations
- Insufficient balance scenarios
- Pause/unpause functionality
- Authorization controls
- Event emission verification
- Edge cases and error conditions
- **Metadata hash computation and verification**
- **Golden test vectors for deterministic hashing**
- **Deterministic serialization validation**

### Metadata Hash Tests

The test suite includes comprehensive tests for the metadata hash functionality:

- **Basic hash computation**: Tests with minimal required fields
- **Optional fields**: Tests with all optional fields populated
- **Verification**: Tests both successful and failed hash verification
- **Determinism**: Ensures same input always produces same hash
- **Uniqueness**: Ensures different inputs produce different hashes
- **Input validation**: Rejects zero or negative amounts
- **Golden test vectors**: Fixed test cases for regression testing

### Golden Test Vectors

Golden test vectors provide deterministic test cases that can be used across different implementations:

```rust
// Golden Vector 1: Basic stake
let input = ReceiptInput {
    tx_type: "stake",
    amount_usdc: 1000000, // 1 USDC
    timestamp: 1620000000,
    // ... other fields
};
// Expected hash: deterministic based on canonical serialization

// Golden Vector 2: Unstake with metadata
let input = ReceiptInput {
    tx_type: "unstake",
    amount_usdc: 500000, // 0.5 USDC
    metadata: {"source": "bank_transfer", "reference": "TX123456789"},
    // ... other fields
};
// Expected hash: deterministic based on canonical serialization
```

## Requirements

- Soroban SDK v22.0.7
- Rust 2021 edition
- Token contract implementing Soroban token interface

## Notes

- This is an MVP implementation without reward distribution
- Rewards are planned for a separate issue/implementation
- Contract uses instance storage for data persistence
- All token amounts use i128 type and must be positive

## Lock Period Behavior

- **Default**: No lock period (0 seconds) - tokens can be unstaked immediately
- **Timer Reset**: Each new stake resets the lock timer for that user's entire staked balance
- **Validation**: Unstake operations fail if `current_time < stake_timestamp + lock_period`
- **Cleanup**: Stake timestamps are removed when users fully unstake (balance becomes 0)
- **Admin Control**: Only administrators can set/change the lock period
- **Granularity**: Lock periods are specified in seconds using the ledger timestamp

### Example Lock Period Flow

1. Admin sets lock period to 1 hour (3600 seconds)
2. User stakes 100 tokens at timestamp 1000
3. User cannot unstake until timestamp 4600 (1000 + 3600)
4. User stakes 50 more tokens at timestamp 2000
5. Lock timer resets - user cannot unstake until timestamp 5600 (2000 + 3600)
6. User fully unstakes 150 tokens after timestamp 5600
7. Stake timestamp for user is cleaned up
