#![cfg(test)]
//! Property-based invariant tests for rent_wallet.
//!
//! ## Invariants tested
//!
//! 1. **Conservation**: after every step, the sum of all user balances equals
//!    `total_credited - total_debited`. rent_wallet has no transfer entry point,
//!    so credit and debit are the only ways value enters or leaves the ledger.
//! 2. **No negative balance**: no balance is ever below zero. A debit larger than
//!    the balance is rejected and changes nothing.
//! 3. **Admin-only mutation**: a non-admin caller never changes a balance.
//! 4. **Pause gating**: while paused, every credit and debit is rejected.
//! 5. **No wrap-around**: amounts outside `[MIN_AMOUNT, MAX_AMOUNT]` are rejected,
//!    and accepted amounts accumulate exactly.
//!
//! Not covered: the monthly spending cap. `monthly_cap.rs` is not declared in
//! `lib.rs`, so the cap is not part of the compiled contract.
//!
//! ## Running the tests
//!
//! ```bash
//! cargo test --package rent_wallet proptest
//! ```
//!
//! For deeper local fuzzing:
//! ```bash
//! PROPTEST_CASES=10000 cargo test --package rent_wallet proptest
//! ```

extern crate std;

use std::vec::Vec as StdVec;

use crate::validation::{MAX_AMOUNT, MIN_AMOUNT};
use crate::{RentWallet, RentWalletClient};
use proptest::prelude::*;
use proptest::test_runner::TestCaseError;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env};

const USERS: usize = 4;

// ── Operations ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
enum Op {
    Credit {
        user: usize,
        amount: i128,
        by_admin: bool,
    },
    Debit {
        user: usize,
        amount: i128,
        by_admin: bool,
    },
    Pause,
    Unpause,
}

/// Amounts across the full i128 range, with the validation edges weighted in.
fn amount_strategy() -> impl Strategy<Value = i128> {
    prop_oneof![
        6 => 1i128..=1_000_000i128,
        2 => MIN_AMOUNT..=MAX_AMOUNT,
        1 => Just(MAX_AMOUNT),
        1 => Just(MAX_AMOUNT + 1),
        1 => Just(0i128),
        1 => Just(-1i128),
        1 => Just(i128::MIN),
        1 => Just(i128::MAX),
    ]
}

fn mutation_strategy(by_admin: bool) -> impl Strategy<Value = Op> {
    (0..USERS, amount_strategy(), any::<bool>()).prop_map(move |(user, amount, is_credit)| {
        if is_credit {
            Op::Credit {
                user,
                amount,
                by_admin,
            }
        } else {
            Op::Debit {
                user,
                amount,
                by_admin,
            }
        }
    })
}

fn any_op_strategy() -> impl Strategy<Value = Op> {
    prop_oneof![
        6 => mutation_strategy(true),
        2 => mutation_strategy(false),
        1 => Just(Op::Pause),
        1 => Just(Op::Unpause),
    ]
}

// ── Model and harness ────────────────────────────────────────────────────────

struct Model {
    balances: StdVec<i128>,
    paused: bool,
    total_credited: i128,
    total_debited: i128,
}

fn is_valid_amount(amount: i128) -> bool {
    (MIN_AMOUNT..=MAX_AMOUNT).contains(&amount)
}

fn setup(env: &Env) -> (RentWalletClient<'_>, Address, Address, StdVec<Address>) {
    env.mock_all_auths();
    let contract_id = env.register(RentWallet, ());
    let client = RentWalletClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let non_admin = Address::generate(env);
    let users: StdVec<Address> = (0..USERS).map(|_| Address::generate(env)).collect();

    client.init(&admin);

    (client, admin, non_admin, users)
}

fn check_state(
    client: &RentWalletClient<'_>,
    users: &[Address],
    model: &Model,
) -> Result<(), TestCaseError> {
    let mut sum: i128 = 0;
    for (i, user) in users.iter().enumerate() {
        let balance = client.balance(user);
        prop_assert_eq!(balance, model.balances[i]);
        prop_assert!(balance >= 0, "negative balance {} for user {}", balance, i);
        sum += balance;
    }
    prop_assert_eq!(sum, model.total_credited - model.total_debited);
    prop_assert_eq!(client.is_paused(), model.paused);
    Ok(())
}

fn run_sequence(ops: &[Op], start_paused: bool) -> Result<(), TestCaseError> {
    let env = Env::default();
    let (client, admin, non_admin, users) = setup(&env);

    let mut model = Model {
        balances: (0..USERS).map(|_| 0).collect(),
        paused: false,
        total_credited: 0,
        total_debited: 0,
    };

    if start_paused {
        client.pause(&admin);
        model.paused = true;
    }
    check_state(&client, &users, &model)?;

    for op in ops {
        match op {
            Op::Pause => {
                client.pause(&admin);
                model.paused = true;
            }
            Op::Unpause => {
                client.unpause(&admin);
                model.paused = false;
            }
            Op::Credit {
                user,
                amount,
                by_admin,
            } => {
                let caller: &Address = if *by_admin { &admin } else { &non_admin };
                let accepted = *by_admin && !model.paused && is_valid_amount(*amount);

                let result = client.try_credit(caller, &users[*user], amount);
                prop_assert_eq!(
                    result.is_ok(),
                    accepted,
                    "credit {} by_admin {} paused {}",
                    amount,
                    by_admin,
                    model.paused
                );

                if accepted {
                    model.balances[*user] += *amount;
                    model.total_credited += *amount;
                }
            }
            Op::Debit {
                user,
                amount,
                by_admin,
            } => {
                let caller: &Address = if *by_admin { &admin } else { &non_admin };
                let accepted = *by_admin
                    && !model.paused
                    && is_valid_amount(*amount)
                    && model.balances[*user] >= *amount;

                let result = client.try_debit(caller, &users[*user], amount);
                prop_assert_eq!(
                    result.is_ok(),
                    accepted,
                    "debit {} by_admin {} paused {} balance {}",
                    amount,
                    by_admin,
                    model.paused,
                    model.balances[*user]
                );

                if accepted {
                    model.balances[*user] -= *amount;
                    model.total_debited += *amount;
                }
            }
        }
        check_state(&client, &users, &model)?;
    }

    Ok(())
}

// ── Properties ───────────────────────────────────────────────────────────────

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    /// Conservation, non-negative balances, admin-only mutation and pause gating
    /// hold after every step of a random mix of operations.
    #[test]
    fn ledger_invariants_hold_after_every_step(
        ops in prop::collection::vec(any_op_strategy(), 1..40)
    ) {
        run_sequence(&ops, false)?;
    }

    /// A non-admin caller can never move funds, whatever the amount.
    #[test]
    fn non_admin_never_changes_balances(
        ops in prop::collection::vec(mutation_strategy(false), 1..30)
    ) {
        run_sequence(&ops, false)?;
    }

    /// While paused, no credit or debit succeeds.
    #[test]
    fn paused_wallet_rejects_all_mutations(
        ops in prop::collection::vec(mutation_strategy(true), 1..30)
    ) {
        run_sequence(&ops, true)?;
    }
}

/// Credits at the upper bound accumulate exactly, and one unit above the bound is
/// rejected without changing the balance.
#[test]
fn max_amount_credits_accumulate_exactly() {
    let env = Env::default();
    let (client, admin, _non_admin, users) = setup(&env);
    let user = &users[0];

    for _ in 0..50 {
        client.credit(&admin, user, &MAX_AMOUNT);
    }
    assert_eq!(client.balance(user), 50 * MAX_AMOUNT);

    assert!(client.try_credit(&admin, user, &(MAX_AMOUNT + 1)).is_err());
    assert_eq!(client.balance(user), 50 * MAX_AMOUNT);
}
