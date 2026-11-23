#![cfg(test)]
//! Property-based invariant tests for staking_pool stake and unstake accounting.
//!
//! ## Invariants tested
//!
//! 1. **Total equals the sum of user stakes**: after every step, `total_staked`
//!    equals the sum of `staked_balance` over all users.
//! 2. **No over-unstake**: a user can never unstake more than they staked. An
//!    unstake above the staked balance is rejected and changes nothing.
//! 3. **Stake then immediate unstake is exact**: staking and unstaking the same
//!    amount returns exactly that amount to the user's token balance.
//! 4. **Token conservation**: for every user, wallet tokens plus staked tokens equal
//!    the minted amount, and the pool holds exactly `total_staked` tokens.
//! 5. **Pause blocks stake and unstake**: while paused, both are rejected.
//!
//! The lock period is left at its default of zero, so every deposit is unlocked.
//! Lock-period behaviour is not covered here.
//!
//! ## Running the tests
//!
//! ```bash
//! cargo test --package staking_pool proptest
//! ```

extern crate std;

use std::vec::Vec as StdVec;

use crate::{StakingPool, StakingPoolClient};
use proptest::prelude::*;
use proptest::test_runner::TestCaseError;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{token, Address, Env};

const USERS: usize = 3;
/// Minted to every user at setup. Per-user conservation is checked against this.
const INITIAL_TOKENS: i128 = 1_000_000_000_000;

// ── Operations ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
enum Op {
    Stake { user: usize, amount: i128 },
    Unstake { user: usize, amount: i128 },
    Pause,
    Unpause,
}

fn amount_strategy() -> impl Strategy<Value = i128> {
    prop_oneof![
        6 => 1i128..=10_000_000_000i128,
        1 => Just(0i128),
        1 => Just(-1i128),
        1 => Just(i128::MIN),
        1 => Just(i128::MAX),
        1 => Just(INITIAL_TOKENS),
        1 => Just(INITIAL_TOKENS + 1),
    ]
}

fn mutation_strategy() -> impl Strategy<Value = Op> {
    (0..USERS, amount_strategy(), any::<bool>()).prop_map(|(user, amount, is_stake)| {
        if is_stake {
            Op::Stake { user, amount }
        } else {
            Op::Unstake { user, amount }
        }
    })
}

fn op_strategy() -> impl Strategy<Value = Op> {
    prop_oneof![
        8 => mutation_strategy(),
        1 => Just(Op::Pause),
        1 => Just(Op::Unpause),
    ]
}

// ── Model and harness ────────────────────────────────────────────────────────

struct Model {
    wallets: StdVec<i128>,
    staked: StdVec<i128>,
    paused: bool,
}

/// Returns (pool client, token address, pool address, admin, users).
fn setup(
    env: &Env,
) -> (
    StakingPoolClient<'_>,
    Address,
    Address,
    Address,
    StdVec<Address>,
) {
    env.mock_all_auths();
    let pool_id = env.register(StakingPool, ());
    let client = StakingPoolClient::new(env, &pool_id);

    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_id = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();

    client.init(&admin, &token_id);

    let users: StdVec<Address> = (0..USERS).map(|_| Address::generate(env)).collect();
    let token_admin_client = token::StellarAssetClient::new(env, &token_id);
    for user in &users {
        token_admin_client.mint(user, &INITIAL_TOKENS);
    }

    (client, token_id, pool_id, admin, users)
}

fn check_state(
    env: &Env,
    client: &StakingPoolClient<'_>,
    token_id: &Address,
    pool_id: &Address,
    users: &[Address],
    model: &Model,
) -> Result<(), TestCaseError> {
    let tokens = token::Client::new(env, token_id);

    let mut staked_sum: i128 = 0;
    for (i, user) in users.iter().enumerate() {
        let wallet = tokens.balance(user);
        let staked = client.staked_balance(user);

        prop_assert_eq!(wallet, model.wallets[i]);
        prop_assert_eq!(staked, model.staked[i]);
        prop_assert!(staked >= 0, "negative stake {} for user {}", staked, i);
        prop_assert_eq!(wallet + staked, INITIAL_TOKENS);

        staked_sum += staked;
    }

    prop_assert_eq!(client.total_staked(), staked_sum);
    prop_assert_eq!(tokens.balance(pool_id), staked_sum);
    prop_assert_eq!(client.is_paused(), model.paused);
    Ok(())
}

fn run_sequence(ops: &[Op], start_paused: bool) -> Result<(), TestCaseError> {
    let env = Env::default();
    let (client, token_id, pool_id, admin, users) = setup(&env);

    let mut model = Model {
        wallets: (0..USERS).map(|_| INITIAL_TOKENS).collect(),
        staked: (0..USERS).map(|_| 0).collect(),
        paused: false,
    };

    if start_paused {
        client.pause(&admin);
        model.paused = true;
    }
    check_state(&env, &client, &token_id, &pool_id, &users, &model)?;

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
            Op::Stake { user, amount } => {
                let accepted = !model.paused && *amount > 0 && model.wallets[*user] >= *amount;

                let result = client.try_stake(&users[*user], amount);
                prop_assert_eq!(
                    result.is_ok(),
                    accepted,
                    "stake {} paused {} wallet {}",
                    amount,
                    model.paused,
                    model.wallets[*user]
                );

                if accepted {
                    model.wallets[*user] -= *amount;
                    model.staked[*user] += *amount;
                }
            }
            Op::Unstake { user, amount } => {
                // Lock period is zero, so every staked token is unlocked.
                let accepted = !model.paused && *amount > 0 && model.staked[*user] >= *amount;

                let result = client.try_unstake(&users[*user], amount);
                prop_assert_eq!(
                    result.is_ok(),
                    accepted,
                    "unstake {} paused {} staked {}",
                    amount,
                    model.paused,
                    model.staked[*user]
                );

                if accepted {
                    model.staked[*user] -= *amount;
                    model.wallets[*user] += *amount;
                }
            }
        }
        check_state(&env, &client, &token_id, &pool_id, &users, &model)?;
    }

    Ok(())
}

// ── Properties ───────────────────────────────────────────────────────────────

proptest! {
    #![proptest_config(ProptestConfig::with_cases(48))]

    /// Totals, per-user balances and token conservation hold after every step.
    #[test]
    fn accounting_and_token_conservation_hold_after_every_step(
        ops in prop::collection::vec(op_strategy(), 1..30)
    ) {
        run_sequence(&ops, false)?;
    }

    /// While paused, neither stake nor unstake succeeds.
    #[test]
    fn paused_pool_rejects_stake_and_unstake(
        ops in prop::collection::vec(mutation_strategy(), 1..20)
    ) {
        run_sequence(&ops, true)?;
    }

    /// Staking and then unstaking the same amount returns exactly that amount.
    #[test]
    fn stake_then_immediate_unstake_returns_exact_amount(amount in 1i128..=INITIAL_TOKENS) {
        let env = Env::default();
        let (client, token_id, pool_id, _admin, users) = setup(&env);
        let user = &users[0];
        let tokens = token::Client::new(&env, &token_id);

        prop_assert!(client.try_stake(user, &amount).is_ok());
        prop_assert_eq!(client.staked_balance(user), amount);
        prop_assert!(client.try_unstake(user, &amount).is_ok());

        prop_assert_eq!(client.staked_balance(user), 0);
        prop_assert_eq!(client.total_staked(), 0);
        prop_assert_eq!(tokens.balance(user), INITIAL_TOKENS);
        prop_assert_eq!(tokens.balance(&pool_id), 0);
    }
}
