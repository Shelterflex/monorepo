# Vesting Schedule Contract

Linear token vesting with an optional cliff and admin revocation.

## Overview

The vesting schedule contract allows an admin to create time-locked token allocations for beneficiaries. Tokens vest linearly over a specified duration after an optional cliff period. The admin can revoke revocable schedules, returning unvested tokens to themselves while allowing the beneficiary to keep vested amounts.

## Interface

### Initialization

- `initialize(env, admin, token)` - Set the admin address and the token to be vested. Can only be called once.

### Admin Functions

- `set_admin(env, caller, new_admin)` - Transfer admin role to a new address. Only the current admin can call this.
- `create_vesting_schedule(env, admin, beneficiary, total_amount, start_time, end_time, cliff_time, revocable)` - Create a vesting schedule for a beneficiary. Transfers `total_amount` tokens from the admin to the contract. Each beneficiary can have only one active schedule.
- `revoke(env, admin, beneficiary)` - Revoke a revocable schedule. Returns unvested tokens to the admin and leaves vested amounts claimable by the beneficiary. The schedule is truncated at the revocation time.

### Beneficiary Functions

- `claim(env, beneficiary)` - Transfer the vested-but-unclaimed amount to the beneficiary.
- `get_vesting_schedule(env, beneficiary)` - Get the full vesting schedule for a beneficiary.
- `get_claimable_amount(env, beneficiary)` - Get the amount currently claimable by the beneficiary.

### Pausable Functions

- `pause(env, admin)` - Pause all claim operations.
- `unpause(env, admin)` - Resume claim operations.
- `is_paused(env)` - Check if the contract is paused.

## Storage Layout

- `Admin` - Admin address (instance storage)
- `Token` - Token contract address (instance storage)
- `Paused` - Pause state (instance storage)
- `Schedule(Address)` - Vesting schedule per beneficiary (persistent storage)

### VestingSchedule Structure

```rust
pub struct VestingSchedule {
    pub total_amount: i128,      // Total tokens allocated
    pub claimed_amount: i128,    // Tokens already claimed
    pub start_time: u64,         // Unix timestamp when vesting starts
    pub cliff_time: u64,         // Unix timestamp when cliff ends
    pub end_time: u64,           // Unix timestamp when vesting ends
    pub revocable: bool,         // Whether the schedule can be revoked
    pub revoked: bool,           // Whether the schedule has been revoked
}
```

## Events

- `(vesting, initialized)` - Contract initialized with (admin, token)
- `(vesting, admin_set)` - Admin changed with new_admin
- `(vesting, created, beneficiary)` - Schedule created with (total_amount, start_time, cliff_time, end_time, revocable)
- `(vesting, claimed, beneficiary)` - Tokens claimed with amount
- `(vesting, revoked, beneficiary)` - Schedule revoked with (to_beneficiary, to_admin)
- `(vesting, paused)` - Contract paused with admin
- `(vesting, unpaused)` - Contract unpaused with admin

## Vesting Formula

The vested amount at time `now` is calculated as:

- Returns 0 if `now < cliff_time`
- Returns `total_amount` if `now >= end_time`
- Otherwise returns linear interpolation between start and end, rounded down

The formula uses checked arithmetic to prevent overflow and always rounds down to ensure the beneficiary can never claim more than `total_amount`.

## Revocation Behavior

When a revocable schedule is revoked:

1. The vested amount at the revocation time is calculated
2. The beneficiary receives any vested-but-unclaimed amount
3. The admin receives the unvested remainder
4. The schedule is truncated: `total_amount` and `claimed_amount` are set to the vested amount, and `end_time` is set to the revocation time
5. No further vesting occurs after revocation

Revoking before the cliff results in 0 claimable for the beneficiary, and all tokens return to the admin.

## Error Codes

- `AlreadyInitialized` - Contract already initialized
- `NotInitialized` - Contract not initialized
- `NotAuthorized` - Caller lacks required permission
- `Paused` - Contract is paused
- `InvalidAmount` - Amount must be positive
- `InvalidSchedule` - Time validation failed (start < end, start <= cliff <= end)
- `ScheduleExists` - Beneficiary already has a schedule
- `ScheduleNotFound` - No schedule found for beneficiary
- `NotRevocable` - Schedule is not revocable
- `AlreadyRevoked` - Schedule already revoked
- `NothingToClaim` - No vested-but-unclaimed amount available
