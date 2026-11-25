# Deal Escrow Contract

`deal_escrow` holds tenant funds for each deal until the operator or admin releases them
to a recipient split. It also provides:

- a rent-release flow with a challenge window, a resolver, and timeout settlement;
- upgrade governance (proposal, delay, guardian co-signature, emergency path);
- a freeze circuit breaker with a two-step governance "drain" that re-opens the contract;
- a per-deal lifecycle record (`Draft` → `Active` → `Completed` or `Defaulted`).

All statements below were derived from `src/lib.rs` and the helper modules
`src/access_control.rs` and `src/validation.rs`. Function names link to their definitions.

## Roles

| Role | Set by | Used for |
|---|---|---|
| `admin` | [`init`](src/lib.rs#L476) | Configuration, pause, upgrades, freeze, drain, lifecycle changes |
| `operator` | [`init`](src/lib.rs#L476) | With admin, may [`request_rent_release`](src/lib.rs#L844) and [`release`](src/lib.rs#L579) |
| `resolver` | [`set_resolver`](src/lib.rs#L731) (admin) | The only caller allowed into [`resolve_rent_dispute`](src/lib.rs#L962) |
| `guardian` | [`set_guardian`](src/lib.rs#L1155) (admin) | Optional. When set, must co-sign [`execute_upgrade`](src/lib.rs#L1247) and [`emergency_upgrade`](src/lib.rs#L1306) |
| depositor | First successful [`deposit`](src/lib.rs#L528) for a deal | May challenge a pending rent release; receives the refund on dispute timeout |

## Storage layout

Keys are defined in [`DataKey`](src/lib.rs#L21).

**Instance storage** (contract-wide):

| Key | Value |
|---|---|
| `ContractVersion` | `u32`, starts at 1 |
| `StorageSchemaVersion` | `u32`, set to 3 by `init` |
| `Admin`, `Operator`, `Resolver`, `Guardian`, `Token`, `ReceiptContract` | `Address` |
| `ChallengeWindowSeconds`, `DisputeTimeoutSeconds`, `UpgradeDelay`, `RecoveryDelaySeconds` | `u64` |
| `Paused` | `bool` |
| `Reentrancy` | `bool`, set while an external token transfer is in progress |
| `PendingUpgradeHash`, `PendingUpgradeAt` | Pending WASM proposal |
| `CircuitBreakerState` | `CircuitBreakerState` (`Unfrozen`, `Frozen`, `RecoveryAwaiting`) |
| `PendingDrainHash`, `PendingDrainAt` | Pending governance drain |

**Persistent storage** (one entry per deal, keyed by `deal_id`):

| Key | Value |
|---|---|
| `DealBalance(deal_id)` | `i128` escrowed balance |
| `DealDepositor(deal_id)` | `Address` of the first depositor, written once |
| `DealState(deal_id)` | `DealState { total_balance, locked_amount, pending_payout }` |
| `DealLifecycle(deal_id)` | `DealLifecycleStatus` |
| `PendingRentRelease(deal_id)` | `PendingRentRelease` |
| `RentDispute(deal_id)` | `RentDispute` |
| `LegacyLockedAmountV2(deal_id)`, `LegacyPendingPayoutV2(deal_id)` | Read only by [`migrate_storage_schema`](src/lib.rs#L756) when migrating from schema v2 |

## Interface

Errors are `ContractError` variants from [`src/lib.rs`](src/lib.rs#L59). "Paused" means the
function returns `Paused` while the pause flag is set.

| Function | Arguments | Authorization | Returns | Errors |
|---|---|---|---|---|
| [`init`](src/lib.rs#L476) | `admin, operator, token, receipt_contract` | `admin.require_auth()`; first call only | `()` | `AlreadyInitialized` |
| [`contract_version`](src/lib.rs#L510) | none | none | `u32` | none |
| [`deposit`](src/lib.rs#L528) | `from, deal_id, amount` | `from.require_auth()`. Paused-gated. Not blocked by freeze | `()` | `Paused`, `InvalidAmount`, `EmptyString`, `ReentrancyDetected` |
| [`release`](src/lib.rs#L579) | `caller, deal_id, to, principal_amount, platform_addr, platform_amount, reporter_addr, reporter_amount, external_ref_source, external_ref` | Admin or operator. Paused-gated. Frozen-gated | Total released (`i128`) | `Paused`, `Frozen`, `NotAuthorized`, `EmptyString`, `InvalidAmount`, `InsufficientBalance`, `InvalidSplit`, `ReentrancyDetected` |
| [`balance`](src/lib.rs#L673) | `deal_id` | none | `i128` | none |
| [`storage_schema_version`](src/lib.rs#L680) | none | none | `u32` | none |
| [`configure_dispute_windows`](src/lib.rs#L693) | `admin, challenge_window_seconds, dispute_timeout_seconds` | Admin | `()` | `NotAuthorized`, `InvalidReleaseWindow` (either value is 0) |
| [`set_resolver`](src/lib.rs#L731) | `admin, resolver` | Admin | `()` | `NotAuthorized` |
| [`migrate_storage_schema`](src/lib.rs#L756) | `admin, from_version, deal_ids` | Admin | `()` | `NotAuthorized`, `InvalidSchemaVersion` (not v1 or v2, or not the current version). Returns early with `migration_noop` if already at v3 |
| [`request_rent_release`](src/lib.rs#L844) | `caller, deal_id, to, amount, external_ref_source, external_ref` | Admin or operator. Paused-gated | `()` | `Paused`, `NotAuthorized`, `InvalidAmount`, `EmptyString`, `PendingReleaseExists`, `InsufficientBalance` |
| [`challenge_rent_release`](src/lib.rs#L910) | `caller, deal_id, challenge_evidence_ref` | `caller.require_auth()`. Caller must be the depositor or the pending `to`. Only within the challenge window. Paused-gated | `()` | `Paused`, `EmptyString`, `NoPendingRelease`, `DisputeNotAllowed`, `NotAuthorized` |
| [`resolve_rent_dispute`](src/lib.rs#L962) | `caller, deal_id, outcome, resolution_evidence_ref` | Caller must equal the configured resolver. Paused-gated | `()` | `Paused`, `EmptyString`, `NotAuthorized`, `NoOpenDispute`, `InvalidSettlement`, `MigrationInvariantViolation`, `ReentrancyDetected` |
| [`settle_rent_release_timeout`](src/lib.rs#L994) | `deal_id` | None. Anyone may call once the window has closed and no dispute is open. Paused-gated | `()` | `Paused`, `NoPendingRelease`, `DisputeNotAllowed`, `InvalidReleaseWindow` |
| [`settle_dispute_timeout`](src/lib.rs#L1023) | `deal_id` | None. Anyone may call once the dispute timeout has elapsed. Paused-gated | `()` | `Paused`, `NoOpenDispute`, `InvalidSettlement`, `InvalidReleaseWindow` |
| `pause` (Pausable trait, [`src/lib.rs#L1100`](src/lib.rs#L1100)) | `admin` | Admin | `Result<(), PausableError>` | `NotAuthorized` |
| `unpause` (Pausable trait, [`src/lib.rs#L1118`](src/lib.rs#L1118)) | `admin` | Admin | `Result<(), PausableError>` | `NotAuthorized` |
| `is_paused` (Pausable trait, [`src/lib.rs#L1140`](src/lib.rs#L1140)) | none | none | `bool` | none |
| [`set_guardian`](src/lib.rs#L1155) | `admin, guardian` | Admin | `()` | `NotAuthorized` |
| [`set_upgrade_delay`](src/lib.rs#L1176) | `admin, delay_seconds` | Admin | `()` | `NotAuthorized` |
| [`propose_upgrade`](src/lib.rs#L1210) | `admin, new_wasm_hash` | Admin | `()` | `NotAuthorized`, `UpgradeAlreadyPending` |
| [`execute_upgrade`](src/lib.rs#L1247) | `admin, new_wasm_hash` | Admin. Guardian co-signs if set. Delay enforced when `UpgradeDelay > 0` | `()` | `NotAuthorized`, `NoUpgradePending` (no pending hash, or hash mismatch), `UpgradeDelayNotMet` |
| [`emergency_upgrade`](src/lib.rs#L1306) | `admin, new_wasm_hash` | Admin. Guardian co-signs if set. Skips the delay | `()` | `NotAuthorized` |
| [`cancel_upgrade`](src/lib.rs#L1346) | `admin` | Admin | `()` | `NotAuthorized`, `NoUpgradePending` |
| [`freeze`](src/lib.rs#L1382) | `admin` | Admin | `()` | `NotAuthorized`, `Frozen` (already frozen) |
| [`is_frozen`](src/lib.rs#L1406) | none | none | `bool` | none |
| [`propose_drain`](src/lib.rs#L1419) | `admin, drain_hash` | Admin. Contract must be frozen | `()` | `NotAuthorized`, `InvalidGovernanceDrain` |
| [`execute_drain`](src/lib.rs#L1459) | `admin, drain_hash` | Admin. Hash must match the proposal. Recovery delay must have passed. Contract must still be frozen | `()` | `NotAuthorized`, `NoPendingRelease` (no proposal, or hash mismatch), `RecoveryDelayNotMet`, `InvalidGovernanceDrain` |
| [`set_recovery_delay`](src/lib.rs#L1509) | `admin, delay_seconds` | Admin | `()` | `NotAuthorized` |
| [`get_circuit_breaker_state`](src/lib.rs#L1540) | none | none | `u32` (0 Unfrozen, 1 Frozen, 2 RecoveryAwaiting) | none |
| [`activate_deal`](src/lib.rs#L1566) | `admin, deal_id` | Admin. Paused-gated | `()` | `NotAuthorized`, `InvalidDealTransition` (current state is not `Draft`) |
| [`complete_deal`](src/lib.rs#L1590) | `admin, deal_id` | Admin. Paused-gated | `()` | `NotAuthorized`, `InvalidDealTransition` (current state is not `Active`) |
| [`default_deal`](src/lib.rs#L1614) | `admin, deal_id` | Admin. Paused-gated | `()` | `NotAuthorized`, `InvalidDealTransition` (current state is not `Active`) |
| [`deal_lifecycle_status`](src/lib.rs#L1641) | `deal_id` | none | `DealLifecycleStatus` | none |

Paused and frozen gates are enforced by [`require_not_paused`](src/lib.rs#L317) and
[`require_not_frozen`](src/lib.rs#L302). The second one is called only from `release`.

## Events

Topics are `(contract, name)` symbols, except where noted. Data is the tuple shown.

| Function | Topics | Data |
|---|---|---|
| `init` | `deal_escrow`, `init` | `(admin, operator, token, receipt_contract, 1u32)` |
| `deposit` | `deal_escrow`, `deposit` | `(deal_id, from, amount)` |
| `release` | `deal_escrow`, `release` | `(deal_id, to, principal_amount, platform_addr, platform_amount, reporter_addr, reporter_amount, external_ref_source, tx_id)` |
| `configure_dispute_windows` | `deal_escrow`, `configure_dispute_windows` | `(challenge_window_seconds, dispute_timeout_seconds)` |
| `set_resolver` | `deal_escrow`, `set_resolver` | `resolver` |
| `migrate_storage_schema` | `deal_escrow`, `migration_noop` / `migration_started` / `migration_completed` | `(current, 3)` / `(from_version, 3, deal_ids.len())` / `(from_version, 3)` |
| `request_rent_release` | `deal_escrow`, `rent_release_requested` | `(deal_id, caller, amount, challenge_end_at)` |
| `challenge_rent_release` | `deal_escrow`, `rent_release_challenged` | `(deal_id, caller, now)` |
| `resolve_rent_dispute`, `settle_rent_release_timeout`, `settle_dispute_timeout` | `deal_escrow`, `rent_release_settled` | `(deal_id, recipient, amount, outcome, tx_id, resolved_by_resolver)` |
| `pause` | `Pausable`, `pause` | `()` |
| `unpause` | `deal_escrow`, `unpause` | `admin` |
| `set_guardian` | `deal_escrow`, `set_guardian` | `guardian` |
| `set_upgrade_delay` | `deal_escrow`, `set_upgrade_delay` | `delay_seconds` |
| `propose_upgrade` | `deal_escrow`, `propose_upgrade` | `(new_wasm_hash, now)` |
| `execute_upgrade` | `deal_escrow`, `execute_upgrade` | `new_wasm_hash` |
| `emergency_upgrade` | `deal_escrow`, `emergency_upgrade` | `(admin, new_wasm_hash, timestamp)` |
| `cancel_upgrade` | `deal_escrow`, `cancel_upgrade` | `(admin, hash)` |
| `freeze` | `deal_escrow`, `freeze` | `(admin, timestamp)` |
| `propose_drain` | `deal_escrow`, `propose_drain` | `(drain_hash, now)` |
| `execute_drain` | `deal_escrow`, `execute_drain` | `(admin, drain_hash, timestamp)` |
| `set_recovery_delay` | `deal_escrow`, `set_recovery_delay` | `delay_seconds` |
| `activate_deal`, `complete_deal`, `default_deal` | `deal_escrow`, `activate_deal` / `complete_deal` / `default_deal` | `(deal_id, admin)` |

## Rent release lifecycle

1. **Request.** Admin or operator calls `request_rent_release`. It sets `locked_amount` and
   `pending_payout` to `amount` and records a `PendingRentRelease` whose challenge window
   closes at `now + ChallengeWindowSeconds`.
2. **Challenge (optional).** Within the window, the depositor or the pending recipient calls
   `challenge_rent_release`. This opens a `RentDispute`.
3. **Settle.**
   - With no dispute, anyone may call `settle_rent_release_timeout` after the window closes.
     Funds go to the recipient.
   - With a dispute, the configured resolver calls `resolve_rent_dispute` with a
     `SettlementOutcome` (`ReleaseToRecipient` or `RefundToDepositor`). If the resolver does
     not act, anyone may call `settle_dispute_timeout` after `DisputeTimeoutSeconds`. Funds
     are refunded to the depositor.

Settlement moves `pending.amount` out of the contract, reduces `total_balance`, and clears
`locked_amount`, `pending_payout`, the pending release, and the dispute record.

## Circuit breaker and governance drain

- `freeze` sets `CircuitBreakerState::Frozen`. While frozen, `release` returns `Frozen`.
  `deposit` still succeeds (covered by a test).
- `propose_drain` is allowed only while frozen. It stores a hash and a timestamp.
- `execute_drain` clears the proposal, after `RecoveryDelaySeconds` has passed, and sets the
  state to `Unfrozen`. **It does not transfer any tokens.** The name refers to the
  governance step, not to moving funds.

## Usage example

```rust
let client = DealEscrowClient::new(&env, &contract_id);
client.init(&admin, &operator, &token, &receipt_contract);

// Tenant funds the escrow for a deal.
client.deposit(&tenant, &deal_id, &1_000_0000000);

// Operator splits the full balance: principal to the landlord, fee to the platform,
// and reporter share to a whistleblower (the three must sum to the balance).
client.release(
    &operator,
    &deal_id,
    &landlord,
    &900_0000000,
    &platform,
    &80_0000000,
    &reporter,
    &20_0000000,
    &Symbol::new(&env, "rent"),
    &String::from_str(&env, "receipt-123"),
);
```

## Known limitations

These were found by reading the code. Each one is reported here and not fixed, per the issue.

1. **`release` does not check for a pending rent release.** It zeroes `locked_amount` and
   `pending_payout`. A later settlement of that pending release then fails the
   `MigrationInvariantViolation` check. The funds were already paid out by `release`, so no
   double spend occurs, but the pending record is left stuck.
2. **`challenge_rent_release` does not check for an existing dispute.** A second challenge
   inside the window overwrites the `RentDispute` and resets `opened_at`, which restarts the
   dispute timeout.
3. **Freeze gates `release` only.** `request_rent_release`, `challenge_rent_release`,
   `resolve_rent_dispute`, and both settlement timeouts are not frozen-gated. They can still
   lock or move funds while the circuit breaker is `Frozen`.
4. **`RecoveryAwaiting` is never set.** It is matched in `require_not_frozen`, but no code
   path writes it.
5. **The deal lifecycle is informational.** `deposit`, `release`, and `request_rent_release`
   do not read `DealLifecycle`. A `Draft` or `Defaulted` deal can still receive deposits and
   releases.
6. **`execute_drain` moves no tokens.** See the note above.
7. **Event namespaces are inconsistent.** `pause` emits `("Pausable", "pause")`, while
   `unpause` emits `("deal_escrow", "unpause")`.
8. **`init` is first-come.** It only checks that the `admin` argument signed. Whoever calls
   it first with their own admin address becomes admin, so deployment and `init` should be
   done atomically.
