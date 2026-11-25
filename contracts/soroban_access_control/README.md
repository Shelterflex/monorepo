# Soroban Access Control

`soroban_access_control` is a shared library of authorization helpers. It also ships a small
test-harness contract, `TestAccessControlContract`, which the crate's tests use. Contracts that
need an admin/operator split can call these helpers from their own entry points. `deal_escrow`
wraps them in its `access_control` module.

The helpers do not store roles. Each calling contract keeps its own `admin` and `operator`, and
passes them in. For a richer role model, see [`contract_access`](../contract_access/README.md).

All statements below were derived from `src/lib.rs`. Function names link to their definitions.

## Helper functions

| Function | Arguments | Behavior | Returns |
|---|---|---|---|
| [`extend_storage_ttl`](src/lib.rs#L27) | `env, key: &Val` | Extends one **persistent** entry to 500,000 ledgers when its TTL drops below 10,000 | `()` |
| [`deny`](src/lib.rs#L35) | `env, caller, operation: &str, err: E` | Emits `access_control / unauthorized` and returns `err` | `E` |
| [`require_admin_permission`](src/lib.rs#L49) | `env, admin, caller, operation, not_authorized: E` | `caller.require_auth()`. If `caller != admin`, calls `deny` | `Result<(), E>` |
| [`require_admin_or_operator_permission`](src/lib.rs#L65) | `env, admin, operator: Option<&Address>, caller, operation, not_authorized: E` | `caller.require_auth()`. Succeeds if `caller` is admin, or equals `operator` when one is given. Otherwise calls `deny` | `Result<(), E>` |

Callers choose the error type `E`. Each denial emits an event naming the operation.

## Test harness contract

Used only by the crate's tests. It is not a deployable product.

| Function | Arguments | Authorization | Returns | Errors |
|---|---|---|---|---|
| [`init`](src/lib.rs#L107) | `admin` | **None.** Panics `already initialized` on a second call | `()` | panic |
| [`set_operator`](src/lib.rs#L114) | `caller, operator` | Admin (`require_admin_permission`) | `Result<(), TestError>` | `NotAuthorized` |
| [`admin_only_operation`](src/lib.rs#L127) | `caller` | Admin | `Result<(), TestError>` | `NotAuthorized` |
| [`admin_or_operator_operation`](src/lib.rs#L139) | `caller` | Admin, or the stored operator | `Result<(), TestError>` | `NotAuthorized` |

`TestError::NotAuthorized` is `4001`. Storage uses **instance** keys `Admin` and `Operator`
([`DataKey`](src/lib.rs#L97)). Calling a function before `init` panics with `admin not set`.

## Events

| Event | Topics | Data | When |
|---|---|---|---|
| Unauthorized access | `access_control`, `unauthorized`, `caller` | `Symbol(operation)` | Every denial from `deny`, including the harness's denials |

Successful checks emit nothing.

## Usage example

```rust
use soroban_access_control::require_admin_or_operator_permission;

pub fn credit(env: Env, caller: Address, user: Address, amount: i128) -> Result<(), MyError> {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    let operator: Option<Address> = env.storage().instance().get(&DataKey::Operator);
    require_admin_or_operator_permission(
        &env,
        &admin,
        operator.as_ref(),
        &caller,
        "credit",
        MyError::NotAuthorized,
    )?;
    /* ... */
    Ok(())
}
```

## Known limitations

These were found by reading the code. Each is reported here and not fixed, per the issue.

1. **`caller.require_auth()` runs before the role check.** A caller who did not sign aborts the
   host. No denial event is emitted in that case. Only signed callers who fail the role check
   produce the `unauthorized` event.
2. **No function clears the operator.** `set_operator` in the harness can only replace it. Once
   set, the operator cannot be removed.
3. **`init` on the harness has no auth.** The first caller sets the admin. The harness is test
   code, but the same pattern appears in the contracts that copy it.
4. **`extend_storage_ttl` is persistent-only.** It calls `extend_ttl` on a persistent key and
   does not touch instance storage.
