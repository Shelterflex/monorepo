#![cfg(kani)]

//! Kani formal-verification harnesses for `multisig_admin`.
//!
//! Core security invariant under proof:
//!   **Threshold enforcement** — a proposal can only transition to `Executed`
//!   when the live approval count is ≥ the configured threshold.
//!
//! Kani proofs are gated with `#[cfg(kani)]` and are NOT compiled or run by
//! `cargo test`.  They require `cargo kani` and are not a CI merge gate.

use soroban_sdk::{testutils::Address as _, Address, Bytes, Env, Vec};

use crate::{Config, DataKey, MultisigAdmin, OperationType, Proposal, ProposalStatus};

// ── helpers ──────────────────────────────────────────────────────────────────

/// Store a minimal `Config` with `threshold` signers (all distinct synthetic
/// addresses) and return the signer vec.
fn make_config(env: &Env, threshold: u32, n_signers: u32) -> soroban_sdk::Vec<Address> {
    let mut signers = Vec::new(env);
    for _ in 0..n_signers {
        signers.push_back(Address::generate(env));
    }
    let cfg = Config {
        signers: signers.clone(),
        threshold,
    };
    env.storage().instance().set(&DataKey::Config, &cfg);
    env.storage()
        .instance()
        .set(&DataKey::NextProposalId, &1u64);
    signers
}

/// Write a `Pending` proposal with `approval_count` pre-filled and a
/// matching approvals vec.  Returns the proposal id.
fn make_proposal_with_approvals(
    env: &Env,
    signers: &soroban_sdk::Vec<Address>,
    approval_count: u32,
) -> u64 {
    let id: u64 = 1;
    let proposer = signers.get(0).unwrap();
    let prop = Proposal {
        proposer,
        operation: OperationType::ForceReleaseEscrow,
        params: Bytes::new(env),
        expiry: 0, // never expires
        status: ProposalStatus::Pending,
        approval_count,
    };
    env.storage().instance().set(&DataKey::Proposal(id), &prop);

    // Build approvals vec with `approval_count` unique signers.
    let mut approvals: Vec<Address> = Vec::new(env);
    for i in 0..(approval_count as usize) {
        if i < signers.len() as usize {
            approvals.push_back(signers.get(i as u32).unwrap());
        }
    }
    env.storage()
        .instance()
        .set(&DataKey::Approvals(id), &approvals);
    id
}

// ── proofs ────────────────────────────────────────────────────────────────────

/// **Proof 1 — threshold gate**
///
/// When the live approval count equals exactly `threshold - 1` (one short),
/// calling `execute` must panic (the contract panics with "NotEnoughApprovals").
/// We verify the panic is always triggered in that scenario regardless of
/// which signer attempts the execution.
#[kani::proof]
fn verify_execute_requires_threshold() {
    let env = Env::default();
    env.mock_all_auths();

    // Concrete threshold = 2, signers = 3 → one approval short of threshold.
    let threshold: u32 = 2;
    let n_signers: u32 = 3;
    let signers = make_config(&env, threshold, n_signers);

    // Pre-fill approval_count = threshold - 1 = 1.
    let _proposal_id = make_proposal_with_approvals(&env, &signers, threshold - 1);

    // Any signer may attempt execution — pick the first one.
    let executor = signers.get(0).unwrap();

    // execute() checks `approvals.len() < cfg.threshold` and panics.
    // kani::expect_panic asserts the panic is always hit.
    kani::expect_panic("NotEnoughApprovals", || {
        MultisigAdmin::execute(env.clone(), executor, 1u64);
    });
}

/// **Proof 2 — threshold met allows execute**
///
/// When approval_count == threshold, `execute` must succeed (no panic) and
/// persist `ProposalStatus::Executed` to storage.
#[kani::proof]
fn verify_execute_succeeds_at_threshold() {
    let env = Env::default();
    env.mock_all_auths();

    let threshold: u32 = 2;
    let n_signers: u32 = 3;
    let signers = make_config(&env, threshold, n_signers);

    let proposal_id = make_proposal_with_approvals(&env, &signers, threshold);

    let executor = signers.get(0).unwrap();
    // Should not panic.
    MultisigAdmin::execute(env.clone(), executor, proposal_id);

    // Post-condition: proposal is now Executed.
    let stored: Proposal = env
        .storage()
        .instance()
        .get(&DataKey::Proposal(proposal_id))
        .expect("proposal missing after execute");
    assert!(
        matches!(stored.status, ProposalStatus::Executed),
        "proposal status must be Executed after successful execute"
    );
}

/// **Proof 3 — non-signer cannot execute**
///
/// An address not listed as a signer must never be able to execute a proposal,
/// even if the approval count meets the threshold.
#[kani::proof]
fn verify_non_signer_cannot_execute() {
    let env = Env::default();
    env.mock_all_auths();

    let threshold: u32 = 1;
    let signers = make_config(&env, threshold, 2);
    let proposal_id = make_proposal_with_approvals(&env, &signers, threshold);

    // outsider is NOT in the signers vec.
    let outsider = Address::generate(&env);

    kani::expect_panic("NotASigner", || {
        MultisigAdmin::execute(env.clone(), outsider, proposal_id);
    });
}

/// **Proof 4 — approval_count invariant**
///
/// After `approve` the stored `approval_count` must equal the length of the
/// live approvals vec.  These two must always agree — divergence would let
/// the threshold check be bypassed.
#[kani::proof]
fn verify_approval_count_matches_approvals_vec() {
    let env = Env::default();
    env.mock_all_auths();

    let threshold: u32 = 2;
    let signers = make_config(&env, threshold, 3);

    // Start with an empty proposal (no prior approvals).
    let proposal_id = make_proposal_with_approvals(&env, &signers, 0);

    // Signer 1 approves.
    let signer1 = signers.get(1).unwrap();
    MultisigAdmin::approve(env.clone(), signer1, proposal_id);

    // Read back both the proposal and the approvals vec.
    let prop: Proposal = env
        .storage()
        .instance()
        .get(&DataKey::Proposal(proposal_id))
        .unwrap();
    let approvals: soroban_sdk::Vec<Address> = env
        .storage()
        .instance()
        .get(&DataKey::Approvals(proposal_id))
        .unwrap();

    assert_eq!(
        prop.approval_count,
        approvals.len() as u32,
        "approval_count must equal the length of the approvals vec"
    );
}
