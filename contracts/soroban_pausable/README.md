# Soroban Pausable

`soroban_pausable` is a shared library. It defines the `Pausable` trait, which contracts
implement to get an admin-controlled pause switch, and `PausableError`. It also ships a small
test-harness contract, `TestPausableContract`, that the crate's own tests use.

The crate has no pause logic of its own that other contracts can call. Each contract that uses
the trait implements it on its own contract type. `deal_escrow` and `rent_schedule` do this.
Each contract is then responsible for checking `is_paused` before its own state-changing
operations.

All statements below were derived from `src/lib.rs`. Function names link to their definitions.

## Types

- [`PausableError`](src/lib.rs#L10): `Paused = 3001`, `NotAuthorized = 3002`.
- [`Pausable`](src/lib.rs#L15) trait: `pause(env, admin)`, `unpause(env, admin)`, `is_paused(env)`.
- [`DataKey`](src/lib.rs#L28): `Admin`, `Paused`. Both are kept in **instance** storage.

## Interface

### `Pausable` trait

| Function | Arguments | Authorization | Returns | Errors |
|---|---|---|---|---|
| `pause` | `admin: Address` | `admin.require_auth()`, then `admin` must equal the stored admin | `Result<(), PausableError>` | `NotAuthorized` (wrong admin). Panics `admin not set` if the admin was never stored |
| `unpause` | `admin: Address` | Same as `pause` | `Result<(), PausableError>` | `NotAuthorized` |
| `is_paused` | none | none | `bool` (`false` if `Paused` was never set) | none |

The auth check runs before the admin comparison. A caller without a valid signature aborts the
host. A signed caller who is not the admin gets `NotAuthorized`.

### `TestPausableContract` (test harness)

| Function | Arguments | Authorization | Returns | Notes |
|---|---|---|---|---|
| [`init`](src/lib.rs#L40) | `admin: Address` | **None** | `()` | Panics `already initialized` on a second call. Sets `Paused = false` |
| [`guarded_operation`](src/lib.rs#L48) | none | none | `Result<(), PausableError>` | Returns `Paused` while paused. Example of a guarded call |

## Events

| Function | Topics | Data |
|---|---|---|
| `pause` | `Pausable`, `pause` | `()` |
| `unpause` | `Pausable`, `unpause` | `()` |

The events do not include the admin address or the ledger time.

## Usage example

Implementing the trait on a contract:

```rust
use soroban_pausable::{Pausable, PausableError};

#[contractimpl]
impl Pausable for MyContract {
    fn pause(env: Env, admin: Address) -> Result<(), PausableError> {
        /* check admin, set Paused = true, emit event */
        Ok(())
    }
    /* unpause, is_paused likewise */
}

// In each state-changing entry point:
if <MyContract as Pausable>::is_paused(env.clone()) {
    return Err(MyError::Paused);
}
```

## Known limitations

These were found by reading the code. Each is reported here and not fixed, per the issue.

1. **`init` has no auth and first-call wins.** Whoever calls the harness `init` first sets the
   admin. This matters only for the harness, but it is the same pattern as in the contracts
   that copy it.
2. **Events carry no actor.** `pause` and `unpause` emit `()`. An indexer must read the
   transaction to learn who paused the contract.
3. **Pause is advisory.** The crate cannot stop a contract's entry points from running. Each
   contract must check `is_paused` itself. A contract that forgets the check keeps running
   while paused.
4. **Pre-init calls panic, not error.** Before `init`, `pause` panics with `admin not set`.
   Callers get a host panic, not a `PausableError`.
