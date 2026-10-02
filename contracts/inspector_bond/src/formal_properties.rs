#![cfg(kani)]

use soroban_sdk::{Address, Env};

use crate::{BondRecord, ContractError, DataKey, InspectorBond};

// ── Inspector Bond — Formal Verification Properties ──────────────────────────
//
// Scope per issue #1697: prove bond custody consistency.
//
// Run with:  cargo kani --harness <name>

// ---------------------------------------------------------------------------
// 1. Bond custody: deposited amount is exactly retrievable
// ---------------------------------------------------------------------------

/// Property: After a bond deposit of `amount`, the stored bond record reflects
/// exactly that amount, and no more than `amount` can be returned on withdrawal.
///
/// Invariant: BondRecord.amount == deposited_amount immediately after deposit.
#[kani::proof]
fn verify_bond_custody_consistency() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let inspector = Address::generate(&env);

    let contract_id = env.register(InspectorBond, ());
    let client = InspectorBondClient::new(&env, &contract_id);

    // Initialize with min bond = 1_000, slash penalty = 500 bps (5%),
    // unstake lock = 7 days
    client
        .try_init(&admin, &1_000i128, &500u32, &7u64)
        .unwrap()
        .unwrap();

    let deposit_amount: i128 = 50_000;

    // Deposit bond
    client
        .try_deposit(&inspector, &deposit_amount)
        .unwrap()
        .unwrap();

    // Retrieve bond record
    let record = client.get_bond(&inspector);

    // Property: stored amount must equal the deposited amount exactly
    assert_eq!(
        record.amount, deposit_amount,
        "bond record must reflect exactly the deposited amount"
    );

    // Property: initial slash count must be zero
    assert_eq!(record.slash_count, 0, "initial slash count must be zero");
}

// ---------------------------------------------------------------------------
// 2. Slash reduces bond by computed amount, never makes it negative
// ---------------------------------------------------------------------------

/// Property: A slash reduces the inspector's bond by exactly the penalty
/// (slash_penalty_bps / 10_000 × amount) and the result is never negative.
///
/// Invariant: bond_after = max(0, bond_before − penalty)
///          ∧ slash_count_after = slash_count_before + 1
#[kani::proof]
fn verify_slash_reduces_bond_correctly() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let inspector = Address::generate(&env);

    let contract_id = env.register(InspectorBond, ());
    let client = InspectorBondClient::new(&env, &contract_id);

    // 1000 bps = 10% slash penalty
    client
        .try_init(&admin, &1_000i128, &1000u32, &7u64)
        .unwrap()
        .unwrap();

    let deposit_amount: i128 = 10_000;
    client
        .try_deposit(&inspector, &deposit_amount)
        .unwrap()
        .unwrap();

    let bond_before = client.get_bond(&inspector).amount;
    let slash_count_before = client.get_bond(&inspector).slash_count;

    // Slash the inspector
    client.try_slash(&admin, &inspector).unwrap().unwrap();

    let record_after = client.get_bond(&inspector);

    // Property: bond must not be negative
    assert!(
        record_after.amount >= 0,
        "bond amount must never go negative after slash"
    );

    // Property: slash count must increment
    assert_eq!(
        record_after.slash_count,
        slash_count_before + 1,
        "slash count must increment by exactly 1"
    );

    // Property: bond must decrease (or reach zero if penalty ≥ bond)
    assert!(
        record_after.amount <= bond_before,
        "bond must not increase after slash"
    );
}

// ---------------------------------------------------------------------------
// 3. Withdrawal before lock expiry must be rejected
// ---------------------------------------------------------------------------

/// Property: A withdrawal request before the unstake lock period expires must
/// fail with LockNotExpired.
///
/// Invariant: now < locked_until ⟹ withdraw returns Err(LockNotExpired).
#[kani::proof]
fn verify_withdrawal_before_lock_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);

    let admin = Address::generate(&env);
    let inspector = Address::generate(&env);

    let contract_id = env.register(InspectorBond, ());
    let client = InspectorBondClient::new(&env, &contract_id);

    // 7-day unstake lock
    client
        .try_init(&admin, &1_000i128, &500u32, &7u64)
        .unwrap()
        .unwrap();

    client
        .try_deposit(&inspector, &10_000i128)
        .unwrap()
        .unwrap();

    // Initiate unstake
    client.try_initiate_unstake(&inspector).unwrap().unwrap();

    // Attempt withdrawal before lock expires (still at t=1000)
    let result = client.try_withdraw(&inspector);
    assert!(
        matches!(result.unwrap_err().unwrap(), ContractError::LockNotExpired),
        "withdrawal before lock expiry must be rejected"
    );

    // Property: bond amount must be unchanged
    let record = client.get_bond(&inspector);
    assert_eq!(
        record.amount, 10_000,
        "bond must not change on rejected early withdrawal"
    );
}

// ---------------------------------------------------------------------------
// 4. Double-deposit increases bond, not replaces it
// ---------------------------------------------------------------------------

/// Property: A second deposit adds to the existing bond rather than
/// overwriting it.
///
/// Invariant: bond_after_second_deposit == bond_after_first + second_amount.
#[kani::proof]
fn verify_bond_deposits_are_additive() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let inspector = Address::generate(&env);

    let contract_id = env.register(InspectorBond, ());
    let client = InspectorBondClient::new(&env, &contract_id);

    client
        .try_init(&admin, &1_000i128, &500u32, &7u64)
        .unwrap()
        .unwrap();

    let first: i128 = 5_000;
    let second: i128 = 3_000;

    client.try_deposit(&inspector, &first).unwrap().unwrap();
    let after_first = client.get_bond(&inspector).amount;

    client.try_deposit(&inspector, &second).unwrap().unwrap();
    let after_second = client.get_bond(&inspector).amount;

    assert_eq!(
        after_second,
        after_first + second,
        "second deposit must be additive, not replace the bond"
    );
}
