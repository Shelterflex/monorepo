# Rent Schedule Contract

`rent_schedule` stores each deal's repayment schedule as a list of instalments and tracks
payments, overdue marking, and waivers against them. It does not move tokens. Payment
amounts are recorded by the caller, and the contract trusts them.

All statements below were derived from `src/lib.rs`. Function names link to their definitions.

## Roles

| Role | Set by | Used for |
|---|---|---|
| `admin` | [`init`](src/lib.rs#L142) | Pause and unpause, and [`waive_instalment`](src/lib.rs#L336). Also accepted by `create_schedule` and `mark_overdue` |
| `operator` | [`init`](src/lib.rs#L142) | Accepted by [`create_schedule`](src/lib.rs#L163) and [`mark_overdue`](src/lib.rs#L285), alongside admin |

`record_payment` accepts any signed caller. See limitation 1.

## Storage layout

Keys are defined in [`DataKey`](src/lib.rs#L67).

| Key | Storage | Value |
|---|---|---|
| `Config` | Instance | `Config { admin, operator }` |
| `Paused` | Instance | `bool` |
| `Schedule(deal_id)` | Persistent | `Vec<ScheduledInstalment>` |
| `Waiver(deal_id, instalment_number)` | Persistent | `WaiverAudit { actor, reason, amount_waived, waived_at }` |

Persistent entries are extended by [`extend_persistent_ttl`](src/lib.rs#L130) on writes and on
some reads (for example [`get_schedule`](src/lib.rs#L426)). An entry that nothing touches can
still expire and need a restore.

## Types

- [`ScheduledInstalment`](src/lib.rs#L29): `instalment_number`, `due_timestamp`, `amount_due`,
  `amount_paid`, `status`, `paid_at`, `last_tx_id`.
- [`InstalmentStatus`](src/lib.rs#L60): `Pending`, `Paid`, `Overdue`, `Waived`.
- [`WaiverReason`](src/lib.rs#L42): `Hardship` (1), `DisputeResolved` (2), `AdminAdjustment`
  (3), `Promotional` (4).

## Interface

Errors are [`Error`](src/lib.rs#L13) variants. `ContractPaused` means `Error::ContractPaused`.

| Function | Arguments | Authorization | Returns | Errors |
|---|---|---|---|---|
| [`init`](src/lib.rs#L142) | `admin, operator` | **None.** First call wins | `()` | `AlreadyInitialized` |
| [`create_schedule`](src/lib.rs#L163) | `caller, deal_id, instalments` | Caller must be admin or operator, then `caller.require_auth()`. **Not paused-gated** | `()` | `NotInitialized`, `NotAuthorized`, `ScheduleExists` |
| [`record_payment`](src/lib.rs#L203) | `caller, deal_id, instalment_number, amount, tx_id, paid_at` | `caller.require_auth()` **only. No role check** (see limitations). Paused-gated | `()` | `ContractPaused`, `NotInitialized`, `InvalidAmount` (≤ 0), `NoSchedule`, `NotFound`, `InvalidStatus` (instalment is Paid or Waived), `Overpayment` |
| [`mark_overdue`](src/lib.rs#L285) | `caller, deal_id, instalment_number` | Admin or operator, then `caller.require_auth()`. Paused-gated | `()` | `ContractPaused`, `NotInitialized`, `NotAuthorized`, `NoSchedule`, `NotFound`, `InvalidStatus` |
| [`waive_instalment`](src/lib.rs#L336) | `caller, deal_id, instalment_number, reason` | Admin only, then `caller.require_auth()`. **Not paused-gated** | `()` | `NotInitialized`, `NotAuthorized`, `NoSchedule`, `NotFound`, `AlreadyWaived`, `InvalidStatus` (instalment is Paid) |
| [`get_waiver`](src/lib.rs#L407) | `deal_id, instalment_number` | none | `Option<WaiverAudit>` | none |
| [`instalment_remaining`](src/lib.rs#L415) | `deal_id, instalment_number` | none | `Result<i128, Error>`. `amount_due - amount_paid` | `NoSchedule`, `NotFound` |
| [`get_schedule`](src/lib.rs#L426) | `deal_id` | none | `Vec<ScheduledInstalment>` sorted by `instalment_number`. Empty if none | none |
| [`get_instalment`](src/lib.rs#L458) | `deal_id, instalment_number` | none | `Result<ScheduledInstalment, Error>` | `NoSchedule`, `NotFound` |
| `pause` ([`src/lib.rs#L479`](src/lib.rs#L479), Pausable trait) | `caller` | Must equal `Config.admin`, after `caller.require_auth()` | `Result<(), PausableError>` | `NotAuthorized` (also if not initialised) |
| `unpause` ([`src/lib.rs#L498`](src/lib.rs#L498), Pausable trait) | `caller` | Same as `pause` | `Result<(), PausableError>` | `NotAuthorized` |
| `is_paused` ([`src/lib.rs#L517`](src/lib.rs#L517), Pausable trait) | none | none | `bool` (false if never set) | none |

Pause is checked by [`require_not_paused`](src/lib.rs#L88). Only `record_payment` and
`mark_overdue` call it.

## Events

Topics are `(contract, name, …)` symbols. Data is the tuple shown.

| Function | Topics | Data |
|---|---|---|
| `init` | `rent_schedule`, `init` | `()` |
| `create_schedule` | `rent_schedule`, `schedule_created`, `deal_id` | `(count, total_amount)` |
| `record_payment`, when the instalment is fully paid | `rent_schedule`, `instalment_paid`, `deal_id` | `(instalment_number, amount_due, tx_id)` |
| `record_payment`, when the instalment is partly paid | `rent_schedule`, `partial_payment_recorded`, `deal_id` | `(instalment_number, amount, amount_paid, remaining, tx_id)` |
| `mark_overdue` | `rent_schedule`, `instalment_overdue`, `deal_id` | `(instalment_number, remaining)` |
| `waive_instalment` | `rent_schedule`, `instalment_waived`, `deal_id` | `(instalment_number, caller, reason, amount_waived, waived_at)` |
| `pause` / `unpause` | `Pausable`, `pause` / `unpause` | `()` |

## Usage example

```rust
let client = RentScheduleClient::new(&env, &contract_id);
client.init(&admin, &operator);

// Operator creates the schedule. `instalments` is a Vec<ScheduledInstalment>.
client.create_schedule(&operator, &deal_id, &instalments);

// Record a payment against instalment 1. The caller must sign.
client.record_payment(&operator, &deal_id, &1u32, &500i128, &tx_id, &paid_at);

// Admin waives the remaining balance of instalment 2 for a hardship case.
client.waive_instalment(&admin, &deal_id, &2u32, &WaiverReason::Hardship);
```

## Known limitations

These were found by reading the code. Each is reported here and not fixed, per the issue.

1. **`record_payment` has no role check.** It calls `caller.require_auth()` and then applies
   the payment. It never compares `caller` with `Config.admin` or `Config.operator`, unlike
   `create_schedule`, `mark_overdue`, and `waive_instalment`. Any address that signs can mark
   an instalment paid. This is the most serious finding in this crate, and it is not covered
   by a test.
2. **`record_payment` does not check `tx_id`.** The same `tx_id` can be applied to several
   payments, and the contract has no link to a real token transfer.
3. **`paid_at` is caller-supplied.** The contract records the value it receives, not the
   ledger time.
4. **`create_schedule` does not validate its input.** It does not check `amount_due > 0`,
   unique `instalment_number` values, `amount_paid == 0`, or `status == Pending`. A caller can
   create an instalment that is already `Paid`. Duplicate numbers are not rejected, and lookups
   use the first match.
5. **Only `record_payment` and `mark_overdue` are paused-gated.** `create_schedule` and
   `waive_instalment` still run while the contract is paused.
6. **`init` is first-come with no auth.** `init` does not call `require_auth`. Whoever calls it
   first sets `admin` and `operator`, so deployment and `init` should be done atomically.
