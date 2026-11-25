# Timelock Contract

`timelock` delays privileged admin actions. An admin queues an operation with a delay. Once the
delay has passed, anyone can execute it, provided it is still inside a grace period. The admin
can cancel queued operations. A multisig of members can pause execution.

All statements below were derived from `src/lib.rs`. Function names link to their definitions.

## Roles

| Role | Set by | Used for |
|---|---|---|
| `admin` | [`init`](src/lib.rs#L55) | [`queue`](src/lib.rs#L84), [`cancel`](src/lib.rs#L215), [`unpause`](src/lib.rs#L277), [`expire`](src/lib.rs#L298), [`set_min_delay`](src/lib.rs#L332) |
| `multisig_members` | [`init`](src/lib.rs#L55) | Pause only, via [`emergency_pause`](src/lib.rs#L246). Needs at least 2 entries that all sign |
| anyone | n/a | [`execute`](src/lib.rs#L149) after the ETA, before the grace period ends |

## Constants

- `GRACE_PERIOD = 1_209_600` seconds (14 days). An operation can be executed only while
  `eta <= now <= eta + GRACE_PERIOD`.

## Storage layout

Keys are defined in [`DataKey`](src/lib.rs).

| Key | Storage | Value |
|---|---|---|
| `Admin` | Instance | `Address` |
| `MinDelay`, `MaxDelay` | Instance | `u64` bounds on the `delay` argument of `queue` |
| `MultisigMembers` | Instance | `Vec<Address>` |
| `Paused` | Instance | `bool` |
| `Queued(tx_hash)` | **Temporary** | `eta: u64`. The contract never extends its TTL (see limitations) |

`tx_hash` is `sha256` of the XDR encoding of `[target, function, args…, eta]`. The delay is not
part of the hash.

## Errors

[`TimelockError`](src/lib.rs): `AlreadyInitialized`, `NotAuthorized`, `InvalidDelay`,
`TransactionAlreadyQueued`, `TransactionNotQueued`, `TimestampNotMet`, `TransactionExpired`,
`InsufficientMultisigApprovals`, `ContractPaused`.

## Interface

| Function | Arguments | Authorization | Returns | Errors |
|---|---|---|---|---|
| [`init`](src/lib.rs#L55) | `admin, min_delay, max_delay, multisig_members` | **None.** First call wins | `()` | `AlreadyInitialized`, `InvalidDelay` (`min_delay > max_delay` or `min_delay == 0`) |
| [`queue`](src/lib.rs#L84) | `admin, target, function, args, delay` | `admin.require_auth()`, then must equal stored admin. **Not paused-gated** | `BytesN<32>` (the tx hash) | `NotAuthorized`, `InvalidDelay` (outside `[min, max]`), `TransactionAlreadyQueued` |
| [`execute`](src/lib.rs#L149) | `target, function, args, eta` | **None.** Anyone may call. Paused-gated | `Val` (the return value of the invoked call) | `ContractPaused`, `TransactionNotQueued` (not queued, or `eta` does not match), `TimestampNotMet` (`now < eta`), `TransactionExpired` (`now > eta + GRACE_PERIOD`) |
| [`cancel`](src/lib.rs#L215) | `admin, tx_hash` | Admin | `()` | `NotAuthorized`, `TransactionNotQueued` |
| [`emergency_pause`](src/lib.rs#L246) | `members` | Each entry must `require_auth()` and must be in `MultisigMembers`. Requires `members.len() >= 2` | `()` | `InsufficientMultisigApprovals`, `NotAuthorized` |
| [`unpause`](src/lib.rs#L277) | `admin` | Admin | `()` | `NotAuthorized` |
| [`expire`](src/lib.rs#L298) | `admin, tx_hash` | Admin | `()` | `NotAuthorized`, `TransactionNotQueued`, `TimestampNotMet` (`now <= eta + GRACE_PERIOD`) |
| [`set_min_delay`](src/lib.rs#L332) | `admin, new_min_delay` | Admin | `()` | `NotAuthorized`, `InvalidDelay` (0, lower than the current minimum, or above `MaxDelay`) |

Only `execute` checks `Paused`. `queue`, `cancel`, `expire`, and `set_min_delay` still run while
the contract is paused.

## Events

| Function | Topics | Data |
|---|---|---|
| `queue` | `governance`, `queued` | `(tx_hash, target, function, args, eta)` |
| `execute` | `governance`, `executed` | `tx_hash` |
| `cancel` | `governance`, `cancelled` | `tx_hash` |
| `emergency_pause` | `governance`, `emergency_pause` | `()` |
| `unpause` | `governance`, `unpause` | `()` |
| `expire` | `timelock`, `operation_expired` | `(tx_hash, stored_eta)` |
| `set_min_delay` | **None** (see limitations) | |

## Usage example

```rust
let client = TimelockClient::new(&env, &contract_id);
client.init(&admin, &600u64, &2_592_000u64, &members);

// Admin queues a call to `target.set_fee(42)` that runs after 1 day.
let args = vec![&env, 42u32.into_val(&env)];
let tx_hash = client.queue(&admin, &target, &Symbol::new(&env, "set_fee"), &args, &86_400u64);

// After the ETA, anyone can execute it. `eta` must be the value that was queued.
let eta = env.ledger().timestamp() + 86_400;
client.execute(&target, &Symbol::new(&env, "set_fee"), &args, &eta);
```

## Known limitations

These were found by reading the code. Each is reported here and not fixed, per the issue.

1. **Queued operations can expire silently.** `Queued` lives in temporary storage, and no code
   path extends its TTL. If the entry expires before its ETA, `execute` returns
   `TransactionNotQueued`, and nothing records that the operation was lost.
2. **`emergency_pause` does not check that members are distinct.** It counts list entries, not
   distinct addresses. By reading the code, a list such as `[A, A]` passes the length check and
   the membership check, and `A`'s signature covers both `require_auth` calls, so one member
   could pause the contract alone. This was not executed, and no test covers a duplicate member.
3. **Only the admin can lift an emergency pause.** `unpause` accepts only the admin. The
   multisig cannot undo its own pause, so an unavailable admin leaves the contract paused.
4. **`set_min_delay` emits no event.** Changes to the minimum delay are invisible to indexers.
5. **Event namespaces are inconsistent.** `expire` uses the `timelock` topic. Every other
   event uses `governance`.
6. **`init` is first-come with no auth.** It never calls `require_auth`. Whoever calls it first
   sets the admin, the delay bounds, and the multisig, so deployment and `init` should be done
   atomically.
7. **Admin reads panic when unset.** `queue`, `cancel`, `expire`, `set_min_delay`, and
   `unpause` call `.unwrap()` on the admin key. Before `init` they abort rather than return a
   `TimelockError`.
