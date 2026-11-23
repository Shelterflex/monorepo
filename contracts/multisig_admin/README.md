# Multisig Admin Contract

`multisig_admin` gates privileged actions behind an M-of-N approval. A proposal names a target contract, a function and its arguments. It runs only after enough signers have approved it, and only while it is still pending.

The contract can also govern itself. A proposal whose target is the contract's own address can change the signer set, the threshold, or the proposal TTL.

The backend uses this contract as the admin of the contracts it covers. `backend/src/services/multisigGate.ts` files a covered call as a proposal here when multisig is enabled, and runs the call directly otherwise.

Source: [`src/lib.rs`](src/lib.rs). Tests: [`src/test.rs`](src/test.rs).

## Concepts

- **Signers**: a fixed list of addresses with no duplicates. Only signers can propose, approve, revoke, execute, cancel with a vote, and pause or unpause.
- **Threshold**: the number of approvals a proposal needs before it can execute. It is at least 1 and at most the number of signers.
- **Proposal TTL**: how long a new proposal stays open for approval, in seconds. The default is 604,800 (7 days). `expires_at` is fixed when the proposal is created, so changing the TTL affects only later proposals.
- **Proposal lifecycle**: `Pending` → `Executed`, or `Pending` → `Cancelled`. A `Pending` proposal past `expires_at` cannot be approved, revoked or executed. `get_proposal` reports it as `Expired`, but the stored status stays `Pending` (see [Known limitations](#known-limitations)).

## Storage layout

| Key | Storage | Value | Written by |
|---|---|---|---|
| `Signers` | instance | `Vec<Address>` | [`init`](src/lib.rs#L82), [`change_signers`](src/lib.rs#L453) |
| `Threshold` | instance | `u32` | [`init`](src/lib.rs#L82), [`change_threshold`](src/lib.rs#L458) |
| `ProposalTtl` | instance | `u64`, default `604_800` | [`init`](src/lib.rs#L82), [`set_proposal_ttl`](src/lib.rs#L463) |
| `Paused` | instance | `bool` | [`init`](src/lib.rs#L82), `pause`, `unpause` ([L508](src/lib.rs#L508), [L521](src/lib.rs#L521)) |
| `ProposalCount` | persistent | `u64`, the last issued proposal id | [`init`](src/lib.rs#L82) (set to 0), [`propose`](src/lib.rs#L113) |
| `Proposal(id)` | persistent | `Proposal` | [`propose`](src/lib.rs#L113), [`approve`](src/lib.rs#L167), [`revoke_approval`](src/lib.rs#L206), [`execute`](src/lib.rs#L253), [`cancel`](src/lib.rs#L322) |
| `CancelApprovals(id)` | persistent | `Vec<Address>` of signers who voted to cancel | [`cancel`](src/lib.rs#L322) |

Proposal ids start at 1 and increase by 1 for each proposal.

Each persistent key is extended with `extend_storage_ttl` from `soroban_access_control` after it is written. That call extends the entry to 500,000 ledgers when its remaining TTL falls below 10,000 ledgers. Instance entries are not extended by this crate (see [Known limitations](#known-limitations)).

## Interface

Authorization is checked inside each function. `require_auth` is the Soroban signature check. "Signer" means the address is in `Signers` at the time of the call.

### Lifecycle

| Function | Args | Auth | Errors | Events |
|---|---|---|---|---|
| [`init`](src/lib.rs#L82) | `signers: Vec<Address>`, `threshold: u32` | None. Nothing calls `require_auth`, so the first successful call sets the signers. | `AlreadyInitialized`, `EmptySigners`, `DuplicateSigner`, `InvalidThreshold` | `multisig / init` `(threshold, signers.len())` |
| [`propose`](src/lib.rs#L113) | `proposer`, `target: Address`, `function: Symbol`, `args: Vec<Val>` | Signer. `proposer.require_auth()`. | `Paused`, `NotSigner` | `multisig / proposed` `(id, proposer, target)` |
| [`approve`](src/lib.rs#L167) | `signer`, `proposal_id` | Signer. `signer.require_auth()`. | `Paused`, `NotSigner`, `ProposalNotFound`, `ProposalNotPending`, `ProposalExpired`, `AlreadyApproved` | `multisig / approved` `(proposal_id, signer)` |
| [`revoke_approval`](src/lib.rs#L206) | `signer`, `proposal_id` | Signer. `signer.require_auth()`. Only the signer's own approval is removed. | `Paused`, `NotSigner`, `ProposalNotFound`, `ProposalNotPending`, `ProposalExpired`, `NotApproved` | `multisig / revoked` `(proposal_id, signer)` |
| [`execute`](src/lib.rs#L253) | `executor`, `proposal_id` | Signer. `executor.require_auth()`. | `Paused`, `NotSigner`, `ProposalNotFound`, `AlreadyExecuted`, `ProposalNotPending`, `ProposalExpired`, `ThresholdNotReached`, `NotInitialized`, `NotAuthorized` | `multisig / executed` `(proposal_id, executor)` |
| [`cancel`](src/lib.rs#L322) | `caller`, `proposal_id` | `caller.require_auth()`. The proposer may cancel alone. A signer casts a cancel vote. Anyone else is refused. | `Paused`, `ProposalNotFound`, `ProposalNotPending`, `NotAuthorized`, `NotInitialized` | `multisig / cancelled` `(proposal_id, caller)` when the proposer cancels or the cancel votes reach the threshold, otherwise `multisig / cancel_vote` `(proposal_id, caller)` |

`execute` checks, in order: the executor is a signer, the proposal exists, it has not executed, it is still pending, it has not expired, and it has at least `threshold` approvals. Then it runs the call:

- If `target` is this contract, only `change_signers`, `change_threshold` and `set_proposal_ttl` are accepted. Each takes its new value as `args[0]`. Any other function, or an argument that cannot be decoded, returns `NotAuthorized`.
- Otherwise it calls `target.function(args...)` with `invoke_contract`. The call is made by this contract's address, so the target must treat this contract as its admin. The return value of that call is returned by `execute`.

The status is set to `Executed` before the call. If the call fails, the whole transaction reverts.

### Self-governance (only through `execute`)

These functions call `current_contract_address().require_auth()`. Nobody outside the contract can satisfy that, so they run only when an approved proposal targets this contract.

| Function | Args | Auth | Errors | Events |
|---|---|---|---|---|
| [`change_signers`](src/lib.rs#L453) | `new_signers: Vec<Address>` | This contract | `EmptySigners`, `DuplicateSigner`, `InvalidThreshold` (threshold > new length), `NotInitialized` | `multisig / signers_changed` `(new_len)` |
| [`change_threshold`](src/lib.rs#L458) | `new_threshold: u32` | This contract | `InvalidThreshold` (outside `1..=signers`), `NotInitialized` | `multisig / threshold_changed` `(new_threshold)` |
| [`set_proposal_ttl`](src/lib.rs#L463) | `new_ttl: u64` | This contract | `InvalidTtl` (0) | `multisig / ttl_changed` `(new_ttl)` |

### Pause (`Pausable` trait)

| Function | Args | Auth | Errors | Events |
|---|---|---|---|---|
| [`pause`](src/lib.rs#L508) | `admin: Address` | Signer. `admin.require_auth()`. | `PausableError::NotAuthorized` if not a signer | `multisig / pause` `(admin)` |
| [`unpause`](src/lib.rs#L521) | `admin: Address` | Signer. `admin.require_auth()`. | `PausableError::NotAuthorized` if not a signer | `multisig / unpause` `(admin)` |
| [`is_paused`](src/lib.rs#L534) | none | None | none | none |

While paused, `propose`, `approve`, `revoke_approval`, `execute` and `cancel` return `Paused`.

### Read-only

| Function | Args | Returns | Auth |
|---|---|---|---|
| [`get_proposal`](src/lib.rs#L410) | `id: u64` | `Proposal`, or `ProposalNotFound` | None. Reports `Pending` past `expires_at` as `Expired` without storing it. |
| [`list_proposals`](src/lib.rs#L426) | `status_filter: Option<ProposalStatus>` | `Vec<u64>` of matching ids, in ascending order | None |
| [`get_signers`](src/lib.rs#L470) | none | `Vec<Address>` | None |
| [`get_threshold`](src/lib.rs#L477) | none | `u32`, or `0` before `init` | None |
| [`get_proposal_ttl`](src/lib.rs#L484) | none | `u64` (seconds) | None |
| [`is_signer`](src/lib.rs#L491) | `caller: Address` | `bool` | None |

## Types

- `ProposalStatus`: `Pending = 1`, `Executed = 2`, `Cancelled = 3`, `Expired = 4`.
- `Proposal`: `id`, `proposer`, `target`, `function`, `args`, `approvals` (the proposer's approval is included from the start), `status`, `created_at`, `expires_at`.
- `Error` codes: `AlreadyInitialized = 1`, `NotInitialized = 2`, `NotAuthorized = 3`, `Paused = 4`, `InvalidThreshold = 5`, `DuplicateSigner = 6`, `EmptySigners = 7`, `NotSigner = 8`, `ProposalNotFound = 9`, `ProposalNotPending = 10`, `ProposalExpired = 11`, `AlreadyApproved = 12`, `NotApproved = 13`, `AlreadyExecuted = 14`, `ThresholdNotReached = 15`, `InvalidTtl = 16`.

## Usage

Rust, the way the tests use the client:

```rust
let client = MultisigAdminClient::new(&env, &multisig_id);

// Three signers, two approvals needed.
client.init(&soroban_sdk::vec![&env, alice.clone(), bob.clone(), carol.clone()], &2);

// Alice proposes a call to a target contract, Bob approves, Alice executes.
let args: Vec<Val> = soroban_sdk::vec![&env, 100i128.into_val(&env)];
let id = client.propose(&alice, &target, &Symbol::new(&env, "credit"), &args);
client.approve(&bob, &id);
client.execute(&alice, &id);

// Change the threshold to 3 by proposing a call to the contract itself.
let new_threshold: Vec<Val> = soroban_sdk::vec![&env, 3u32.into_val(&env)];
let id = client.propose(&alice, &multisig_id, &Symbol::new(&env, "change_threshold"), &new_threshold);
client.approve(&bob, &id);
client.approve(&carol, &id);
client.execute(&alice, &id);
```

## Known limitations

These come from reading the code. They are reported here and not fixed, because fixing them changes behaviour.

- **`init` is not authenticated.** It does not call `require_auth`, and it only checks that the contract is not yet initialised. Whoever calls it first chooses the signers and threshold. Deploy and initialise in one step, before the address is shared.
- **Instance storage is never extended.** `Signers`, `Threshold`, `ProposalTtl` and `Paused` live in instance storage, and this crate never extends them. Only the persistent keys are extended. Once the instance entry expires, the contract loses its signers and threshold. Check the instance TTL on the network and extend it through a separate maintenance transaction.
- **Approvals survive a signer's removal.** `change_signers` replaces `Signers` but does not touch existing `Proposal.approvals` or `CancelApprovals`. `execute` counts `approvals.len()` against the threshold without checking that each approver is still a signer. An approval given by a signer who was later removed still counts.
- **`cancel` ignores expiry.** It does not check `expires_at`, so a `Pending` proposal past its deadline can still be cancelled by its proposer or by signers' cancel votes. The stored status stays `Pending` for expired proposals. `get_proposal` reports `Expired` only in its return value, and `list_proposals(Some(Pending))` filters on the stored status.
- **`list_proposals` has no pagination.** It reads every id from 1 to `ProposalCount`, so its cost grows with the number of proposals.
- **Any single signer can pause the contract.** `pause` and `unpause` need one signer, not the threshold. While paused, `cancel` is also refused, so a single signer can stop all approval and execution.
- **Self-targeted proposals accept only three functions.** Anything else targeting this contract returns `NotAuthorized`, and so does an argument that fails to decode. The error does not say which of the two happened.
- **`set_proposal_ttl` applies only to new proposals.** `expires_at` is fixed when a proposal is created.
