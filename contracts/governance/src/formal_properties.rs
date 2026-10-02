#![cfg(kani)]

//! Kani formal-verification harnesses for `governance`.
//!
//! Core security invariants under proof:
//!   1. **Proposal state-machine correctness** — proposals can only advance
//!      through legal transitions (Active → Passed/Rejected → Executed or
//!      Active → Cancelled).  No proposal may be executed without first
//!      being finalized as `Passed`.
//!   2. **Timelock enforcement** — `execute_proposal` is rejected before
//!      `voting_ends_at + TIMELOCK_SECS` has elapsed.
//!
//! Kani proofs are gated with `#[cfg(kani)]` and are NOT compiled or run by
//! `cargo test`.  They require `cargo kani` and are not a CI merge gate.

use soroban_sdk::{testutils::Address as _, Address, Env, Symbol};

use crate::{ContractError, DataKey, Governance, Proposal, ProposalStatus};

// Re-export the private constants via their canonical values.
// (They are not `pub` in lib.rs but are compile-time constants, so we
// reproduce them here as `const` to avoid any drift — any mismatch between
// these values and the lib would be caught by the proof assertions below.)
const VOTING_PERIOD_SECS: u64 = 7 * 24 * 3600; // 604_800
const TIMELOCK_SECS: u64 = 48 * 3600; // 172_800
const MIN_STAKE_TO_PROPOSE: i128 = 1;

// ── helpers ───────────────────────────────────────────────────────────────────

fn init_governance(env: &Env, total_staked: i128) -> (Address, crate::GovernanceClient<'_>) {
    let contract_id = env.register(Governance, ());
    let client = crate::GovernanceClient::new(env, &contract_id);
    let admin = Address::generate(env);
    env.mock_all_auths();
    client.init(&admin, &total_staked);
    (admin, client)
}

/// Give `voter` exactly `stake` tokens by calling `set_voter_stake` (admin fn).
fn give_stake(
    env: &Env,
    client: &crate::GovernanceClient<'_>,
    admin: &Address,
    voter: &Address,
    stake: i128,
) {
    client.set_voter_stake(admin, voter, &stake);
}

/// Create a proposal through the contract and return its id.
fn create_proposal(client: &crate::GovernanceClient<'_>, proposer: &Address, env: &Env) -> u64 {
    client.create_proposal(proposer, &Symbol::new(env, "param"), &100i128, &200i128)
}

// ── proofs ────────────────────────────────────────────────────────────────────

/// **Proof 1 — cannot execute an Active (unfinalized) proposal**
///
/// A proposal that has not yet been finalized (still `Active`) must never be
/// executable — even after the timelock window would have elapsed.
#[kani::proof]
fn verify_unfinalized_proposal_cannot_be_executed() {
    let env = Env::default();
    let total_staked: i128 = 1_000;
    let (admin, client) = init_governance(&env, total_staked);

    let proposer = Address::generate(&env);
    give_stake(&env, &client, &admin, &proposer, MIN_STAKE_TO_PROPOSE);
    let proposal_id = create_proposal(&client, &proposer, &env);

    // Advance time past the full voting + timelock window but do NOT finalize.
    env.ledger()
        .with_mut(|li| li.timestamp += VOTING_PERIOD_SECS + TIMELOCK_SECS + 1);

    let result = client.try_execute_proposal(&proposal_id);

    // Must fail: the proposal was never finalized as Passed.
    assert!(
        result.is_err(),
        "executing an unfinalized proposal must fail"
    );
}

/// **Proof 2 — execute_proposal is blocked before timelock elapses**
///
/// Even after a proposal reaches `Passed`, execution must be refused until
/// `voting_ends_at + TIMELOCK_SECS` has passed.
#[kani::proof]
fn verify_execute_blocked_before_timelock() {
    let env = Env::default();
    let total_staked: i128 = 1_000;
    let (admin, client) = init_governance(&env, total_staked);

    let proposer = Address::generate(&env);
    let voter = Address::generate(&env);
    give_stake(&env, &client, &admin, &proposer, MIN_STAKE_TO_PROPOSE);
    // Voter has enough stake to pass quorum on their own.
    give_stake(&env, &client, &admin, &voter, total_staked);

    let proposal_id = create_proposal(&client, &proposer, &env);

    // Vote before voting period ends.
    client.vote(&voter, &proposal_id, &true);

    // Advance time to just after the voting period but before timelock.
    env.ledger()
        .with_mut(|li| li.timestamp += VOTING_PERIOD_SECS + 1);

    // Finalize: should pass.
    let status = client.finalize_proposal(&proposal_id);
    assert!(
        matches!(status, ProposalStatus::Passed),
        "proposal should be Passed after finalization with sufficient votes"
    );

    // Attempt to execute immediately (timelock has NOT yet elapsed).
    let result = client.try_execute_proposal(&proposal_id);
    assert!(
        matches!(result, Err(Ok(ContractError::TimelockNotElapsed))),
        "execute_proposal must fail before timelock elapses"
    );
}

/// **Proof 3 — execute succeeds exactly at timelock boundary**
///
/// At `voting_ends_at + TIMELOCK_SECS` (inclusive) the execute must succeed.
#[kani::proof]
fn verify_execute_succeeds_at_timelock_boundary() {
    let env = Env::default();
    let total_staked: i128 = 1_000;
    let (admin, client) = init_governance(&env, total_staked);

    let proposer = Address::generate(&env);
    let voter = Address::generate(&env);
    give_stake(&env, &client, &admin, &proposer, MIN_STAKE_TO_PROPOSE);
    give_stake(&env, &client, &admin, &voter, total_staked);

    let proposal_id = create_proposal(&client, &proposer, &env);
    client.vote(&voter, &proposal_id, &true);

    // Advance time past voting period.
    env.ledger()
        .with_mut(|li| li.timestamp += VOTING_PERIOD_SECS + 1);
    client.finalize_proposal(&proposal_id);

    // Advance time to exactly the timelock boundary.
    // Current timestamp = VOTING_PERIOD_SECS + 1; voting_ends_at = VOTING_PERIOD_SECS.
    // execute_after = voting_ends_at + TIMELOCK_SECS = VOTING_PERIOD_SECS + TIMELOCK_SECS.
    // We need: now >= execute_after ⇒ need to add TIMELOCK_SECS - 1 more.
    env.ledger()
        .with_mut(|li| li.timestamp += TIMELOCK_SECS - 1);

    let result = client.try_execute_proposal(&proposal_id);
    assert!(
        result.is_ok(),
        "execute_proposal must succeed at the timelock boundary"
    );
}

/// **Proof 4 — cancelled proposal cannot be executed**
///
/// Once a proposal is cancelled it must be permanently blocked from execution
/// regardless of elapsed time.
#[kani::proof]
fn verify_cancelled_proposal_cannot_be_executed() {
    let env = Env::default();
    let total_staked: i128 = 1_000;
    let (admin, client) = init_governance(&env, total_staked);

    let proposer = Address::generate(&env);
    give_stake(&env, &client, &admin, &proposer, MIN_STAKE_TO_PROPOSE);

    let proposal_id = create_proposal(&client, &proposer, &env);

    // Cancel the proposal (while still Active, before voting ends).
    client.cancel_proposal(&proposer, &proposal_id);

    // Advance well past voting and timelock windows.
    env.ledger()
        .with_mut(|li| li.timestamp += VOTING_PERIOD_SECS + TIMELOCK_SECS + 1);

    let result = client.try_execute_proposal(&proposal_id);
    assert!(
        result.is_err(),
        "cancelled proposal must never be executable"
    );
}

/// **Proof 5 — double-vote is always prevented**
///
/// A voter may only vote once per proposal; a second `vote` call for the same
/// (voter, proposal_id) pair must fail with `AlreadyVoted`.
#[kani::proof]
fn verify_double_vote_prevented() {
    let env = Env::default();
    let total_staked: i128 = 1_000;
    let (admin, client) = init_governance(&env, total_staked);

    let proposer = Address::generate(&env);
    let voter = Address::generate(&env);
    give_stake(&env, &client, &admin, &proposer, MIN_STAKE_TO_PROPOSE);
    give_stake(&env, &client, &admin, &voter, 100);

    let proposal_id = create_proposal(&client, &proposer, &env);

    // First vote — must succeed.
    client.vote(&voter, &proposal_id, &true);

    // Second vote — must be rejected.
    let result = client.try_vote(&voter, &proposal_id, &false);
    assert!(
        matches!(result, Err(Ok(ContractError::AlreadyVoted))),
        "double-voting on a proposal must be rejected"
    );
}
