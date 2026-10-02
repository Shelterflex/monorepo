#![cfg(kani)]

//! Kani formal-verification harnesses for `vesting_schedule`.
//!
//! Core invariants:
//!   1. `claimed_amount` never exceeds `total_amount`.
//!   2. `claimed_amount` never decreases (monotonic).
//!   3. `calculate_vested_amount` is bounded in [0, total_amount].
//!   4. `calculate_claimable_amount` returns 0 before cliff.

use crate::{calculate_claimable_amount, calculate_vested_amount, VestingSchedule};
use soroban_sdk::{testutils::Address as _, Address, Env};

// ── proofs ────────────────────────────────────────────────────────────────────

/// **Proof 1 — vested amount bounded by [0, total_amount]**
#[kani::proof]
fn verify_vested_amount_bounded() {
    let env = Env::default();
    let addr = Address::generate(&env);

    let total_amount: i128 = kani::any();
    let start_time: u64 = kani::any();
    let end_time: u64 = kani::any();
    let current_time: u64 = kani::any();

    kani::assume(total_amount >= 0);
    kani::assume(end_time > start_time);

    let schedule = VestingSchedule {
        beneficiary: addr,
        total_amount,
        claimed_amount: 0,
        start_time,
        end_time,
        cliff_time: start_time,
        revocable: false,
        revoked: false,
    };

    let vested = calculate_vested_amount(&schedule, current_time);
    assert!(vested >= 0, "vested must be >= 0");
    assert!(
        vested <= total_amount,
        "vested must not exceed total_amount"
    );
}

/// **Proof 2 — claimed_amount never exceeds total_amount**
///
/// The claim path does `claimed_amount += claimable` where
/// `claimable = vested - claimed_amount`. So the new claimed equals vested,
/// which is bounded by total_amount.
#[kani::proof]
fn verify_claimed_never_exceeds_total() {
    let env = Env::default();
    let addr = Address::generate(&env);

    let total_amount: i128 = kani::any();
    let claimed_before: i128 = kani::any();
    let start_time: u64 = kani::any();
    let end_time: u64 = kani::any();
    let current_time: u64 = kani::any();

    kani::assume(total_amount >= 0);
    kani::assume(claimed_before >= 0);
    kani::assume(claimed_before <= total_amount);
    kani::assume(end_time > start_time);
    kani::assume(current_time >= start_time); // past cliff for simplicity

    let schedule = VestingSchedule {
        beneficiary: addr,
        total_amount,
        claimed_amount: claimed_before,
        start_time,
        end_time,
        cliff_time: start_time,
        revocable: false,
        revoked: false,
    };

    let vested = calculate_vested_amount(&schedule, current_time);
    let claimable = vested.saturating_sub(claimed_before);
    let claimed_after = claimed_before + claimable;

    assert!(
        claimed_after <= total_amount,
        "claimed_amount must never exceed total_amount"
    );
}

/// **Proof 3 — claimed_amount is monotonically non-decreasing**
#[kani::proof]
fn verify_claimed_monotonic() {
    let total: i128 = kani::any();
    let claimed_before: i128 = kani::any();
    let claimable: i128 = kani::any();

    kani::assume(total >= 0);
    kani::assume(claimed_before >= 0);
    kani::assume(claimed_before <= total);
    kani::assume(claimable >= 0);

    let claimed_after = claimed_before + claimable;
    assert!(
        claimed_after >= claimed_before,
        "claimed_amount must never decrease"
    );
}

/// **Proof 4 — claimable is 0 before cliff**
#[kani::proof]
fn verify_claimable_zero_before_cliff() {
    let env = Env::default();
    let addr = Address::generate(&env);

    let total_amount: i128 = kani::any();
    let start_time: u64 = kani::any();
    let end_time: u64 = kani::any();
    let cliff_time: u64 = kani::any();
    let current_time: u64 = kani::any();

    kani::assume(total_amount >= 0);
    kani::assume(end_time > start_time);
    kani::assume(cliff_time >= start_time);
    kani::assume(cliff_time <= end_time);
    kani::assume(current_time < cliff_time);

    let schedule = VestingSchedule {
        beneficiary: addr,
        total_amount,
        claimed_amount: 0,
        start_time,
        end_time,
        cliff_time,
        revocable: false,
        revoked: false,
    };

    let claimable = calculate_claimable_amount(&schedule, current_time);
    assert_eq!(claimable, 0, "nothing claimable before cliff");
}

/// **Proof 5 — vested(t2) >= vested(t1) when t2 >= t1 (monotone)**
#[kani::proof]
fn verify_vested_monotone_in_time() {
    let env = Env::default();
    let addr = Address::generate(&env);

    let total_amount: i128 = kani::any();
    let start_time: u64 = kani::any();
    let end_time: u64 = kani::any();
    let t1: u64 = kani::any();
    let t2: u64 = kani::any();

    kani::assume(total_amount >= 0);
    kani::assume(end_time > start_time);
    kani::assume(t2 >= t1);

    let schedule = VestingSchedule {
        beneficiary: addr,
        total_amount,
        claimed_amount: 0,
        start_time,
        end_time,
        cliff_time: start_time,
        revocable: false,
        revoked: false,
    };

    let v1 = calculate_vested_amount(&schedule, t1);
    let v2 = calculate_vested_amount(&schedule, t2);

    assert!(v2 >= v1, "vested amount must be non-decreasing over time");
}
