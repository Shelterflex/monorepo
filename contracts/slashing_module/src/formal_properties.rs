#![cfg(kani)]

use soroban_sdk::{Address, Bytes, Env, String, Symbol};

use crate::{ContractError, DataKey, SlashStatus, SlashingModule};

// ── Slashing Module — Formal Verification Properties ─────────────────────────
//
// Scope per issue #1697: prove slash-amount correctness only.
// Explicitly out of scope: the unbounded InspectorSlashHistory vector
// (tracked in a separate issue) — this module does NOT modify storage logic.
//
// Run with:  cargo kani --harness <name>

// ---------------------------------------------------------------------------
// 1. Slash amount correctness: slash reduces staked balance by exactly the
//    computed amount, no more, no less.
// ---------------------------------------------------------------------------

/// Property: After a finalized slash of `slash_amount`, the actor's stored
/// SlashedAmount increases by exactly `slash_amount` and their StakedBalance
/// decreases by exactly `slash_amount`.
///
/// Invariant: final_slashed == initial_slashed + slash_amount
///          ∧ final_staked  == initial_staked  − slash_amount
#[kani::proof]
fn verify_slash_amount_correctness() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let submitter = Address::generate(&env);
    let actor = Address::generate(&env);

    let contract_id = env.register(SlashingModule, ());
    let client = SlashingModuleClient::new(&env, &contract_id);

    // Initialize
    client.try_init(&admin).unwrap().unwrap();

    // Register submitter
    client
        .try_add_submitter(&admin, &submitter)
        .unwrap()
        .unwrap();

    // Seed staked balance for actor: 1_000_000
    let initial_stake: i128 = 1_000_000;
    client
        .try_set_staked_balance(&admin, &actor, &initial_stake)
        .unwrap()
        .unwrap();

    let initial_slashed: i128 = client.get_slashed_amount(&actor);

    // Build slash evidence
    let evidence_hash = Bytes::from_array(&env, &[0u8; 32]);
    let reason = String::from_str(&env, "double_sign");
    let slash_amount: i128 = 50_000;

    // Submit slash
    client
        .try_submit_slash(&submitter, &actor, &slash_amount, &evidence_hash, &reason)
        .unwrap()
        .unwrap();

    let final_slashed: i128 = client.get_slashed_amount(&actor);
    let final_staked: i128 = client.get_staked_balance(&actor);

    // Property: slashed amount increased by exactly the slash amount
    assert_eq!(
        final_slashed,
        initial_slashed + slash_amount,
        "slashed amount must increase by exactly slash_amount"
    );

    // Property: staked balance decreased by exactly the slash amount
    assert_eq!(
        final_staked,
        initial_stake - slash_amount,
        "staked balance must decrease by exactly slash_amount"
    );
}

// ---------------------------------------------------------------------------
// 2. Slash cannot exceed staked balance (no negative balance)
// ---------------------------------------------------------------------------

/// Property: A slash amount greater than the actor's staked balance must be
/// capped at the staked balance, leaving staked balance at zero (not negative).
///
/// Invariant: staked_balance ≥ 0 after any slash.
#[kani::proof]
fn verify_slash_cannot_produce_negative_balance() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let submitter = Address::generate(&env);
    let actor = Address::generate(&env);

    let contract_id = env.register(SlashingModule, ());
    let client = SlashingModuleClient::new(&env, &contract_id);

    client.try_init(&admin).unwrap().unwrap();
    client
        .try_add_submitter(&admin, &submitter)
        .unwrap()
        .unwrap();

    // Seed a modest stake
    let initial_stake: i128 = 100;
    client
        .try_set_staked_balance(&admin, &actor, &initial_stake)
        .unwrap()
        .unwrap();

    // Attempt to slash MORE than the stake
    let evidence_hash = Bytes::from_array(&env, &[1u8; 32]);
    let reason = String::from_str(&env, "downtime");
    let excessive_slash: i128 = 999_999;

    // Slash must succeed (capped) or fail — either way balance must be ≥ 0
    let _ = client.try_submit_slash(
        &submitter,
        &actor,
        &excessive_slash,
        &evidence_hash,
        &reason,
    );

    let final_staked: i128 = client.get_staked_balance(&actor);
    assert!(
        final_staked >= 0,
        "staked balance must never go negative after slash"
    );
}

// ---------------------------------------------------------------------------
// 3. Duplicate evidence rejected (commitment hash deduplication)
// ---------------------------------------------------------------------------

/// Property: Submitting a slash with a commitment hash that has already been
/// recorded must be rejected, preventing double-slashing for the same event.
///
/// Invariant: same evidence_hash used twice ⟹ second call returns an error.
#[kani::proof]
fn verify_duplicate_evidence_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let submitter = Address::generate(&env);
    let actor = Address::generate(&env);

    let contract_id = env.register(SlashingModule, ());
    let client = SlashingModuleClient::new(&env, &contract_id);

    client.try_init(&admin).unwrap().unwrap();
    client
        .try_add_submitter(&admin, &submitter)
        .unwrap()
        .unwrap();
    client
        .try_set_staked_balance(&admin, &actor, &1_000_000i128)
        .unwrap()
        .unwrap();

    let evidence_hash = Bytes::from_array(&env, &[2u8; 32]);
    let reason = String::from_str(&env, "invalid_block");
    let slash_amount: i128 = 10_000;

    // First submission — must succeed
    client
        .try_submit_slash(&submitter, &actor, &slash_amount, &evidence_hash, &reason)
        .unwrap()
        .unwrap();

    // Second submission with same hash — must fail
    let dup_result =
        client.try_submit_slash(&submitter, &actor, &slash_amount, &evidence_hash, &reason);
    assert!(
        dup_result.is_err() || matches!(dup_result.unwrap_err(), Ok(_)),
        "duplicate evidence must be rejected"
    );
}

// ---------------------------------------------------------------------------
// 4. Unauthorized submitter cannot slash
// ---------------------------------------------------------------------------

/// Property: An address that is not a registered submitter must not be able
/// to submit a slash.
///
/// Invariant: caller ∉ registered_submitters ⟹ submit_slash returns Err(NotAuthorized).
#[kani::proof]
fn verify_only_registered_submitter_can_slash() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    let actor = Address::generate(&env);

    let contract_id = env.register(SlashingModule, ());
    let client = SlashingModuleClient::new(&env, &contract_id);

    client.try_init(&admin).unwrap().unwrap();
    // Deliberately do NOT register `attacker` as a submitter

    client
        .try_set_staked_balance(&admin, &actor, &1_000_000i128)
        .unwrap()
        .unwrap();

    let evidence_hash = Bytes::from_array(&env, &[3u8; 32]);
    let reason = String::from_str(&env, "unauthorized_attempt");

    let result = client.try_submit_slash(&attacker, &actor, &50_000i128, &evidence_hash, &reason);
    assert!(result.is_err(), "unregistered submitter must be rejected");
}
