# MVP Staking Pool

A minimal Soroban staking pool contract for rent funding and future profit sharing.

## Overview

This is a minimal viable product (MVP) staking pool contract that provides the essential functionality for users to stake and unstake tokens. The contract is designed to be safe and minimal, with room for future enhancements.

## Features

- **Token Staking**: Users can stake USDC tokens into the pool
- **Token Unstaking**: Users can unstake their tokens from the pool
- **Balance Tracking**: Individual user balances and total pool balance
- **Reward Accrual (Index-Based)**: Rewards accrue per-user via a global reward index (no iteration over stakers)
- **Admin Controls**: Admin can pause/unpause the contract
- **Event Emission**: Standardized events for stake/unstake operations
- **Input Validation**: Positive amount requirements and authorization checks

## Contract Functions

### Core Functions

- `init(admin: Address, token: Address)` - Initialize the contract
- `stake(user: Address, amount: i128)` - Stake tokens into the pool
- `unstake(user: Address, amount: i128)` - Unstake tokens from the pool
- `staked_balance(user: Address) -> i128` - Get user's staked balance
- `total_staked() -> i128` - Get total tokens staked in pool
- `claimable(user: Address) -> i128` - Get current claimable rewards for a user
- `claim(to: Address) -> i128` - Claim accrued rewards to `to`

### Admin Functions

- `pause()` - Pause the contract (admin only)
- `unpause()` - Unpause the contract (admin only)
- `fund_rewards(from: Address, amount: i128)` - Fund rewards and update the global reward index (admin only)

## Reward Accrual Model

Rewards are distributed using an index-based accrual model to avoid O(n) iteration over all stakers.

State:

- `global_reward_index` (fixed-point `i128`)
- per-user `user_reward_index`
- per-user `claimable_rewards`

Fixed-point:

- Scale: `REWARD_INDEX_SCALE = 1_000_000_000_000` (1e12)
- Rounding: reward accrual uses integer division and rounds down toward zero

Accrual rule (conceptual): when `fund_rewards(amount)` is called, the global index is incremented by:

`(amount * REWARD_INDEX_SCALE) / total_staked`

Each user accrues rewards lazily when they interact (stake/unstake/claim/claimable) based on the difference between `global_reward_index` and their `user_reward_index`.

## Event Topics

The contract emits standardized events:

- `("stake", user)` - Emitted when a user stakes tokens
- `("unstake", user)` - Emitted when a user unstakes tokens

## Security Features

- **Authorization**: Users must authenticate for stake/unstake operations
- **Admin Controls**: Only admin can pause/unpause the contract
- **Input Validation**: All amounts must be positive
- **Pause Protection**: All operations are blocked when paused
- **Balance Checks**: Users cannot unstake more than they have staked

## Usage

### Initialization

```rust
// Initialize the contract with admin and USDC token address
staking_pool.init(&admin, &usdc_token_address);
```

### Staking

```rust
// Stake 100 USDC tokens
staking_pool.stake(&user, &100i128);
```

### Unstaking

```rust
// Unstake 50 USDC tokens
staking_pool.unstake(&user, &50i128);
```

### Checking Balances

```rust
// Get user's staked balance
let user_balance = staking_pool.staked_balance(&user);

// Get total staked amount
let total_staked = staking_pool.total_staked();
```

## Testing

Run the test suite:

```bash
cargo test
```

The contract includes comprehensive unit tests covering:
- Initialization scenarios
- Stake/unstake edge cases
- Authorization and access control
- Pause/unpause functionality
- Input validation
- Event emission

## Acceptance Criteria

✅ **Unit tests cover stake/unstake edge cases**
✅ **Event topics standardized: `("stake", user)` and `("unstake", user)`**
✅ **All `cargo test` tests pass**

## Future Enhancements

This MVP is designed to be extended with features such as:
- Profit sharing mechanisms
- Reward distribution
- Lock periods
- Governance features
- Multi-token support

## License

This project is part of the monorepo and follows the same licensing terms.
