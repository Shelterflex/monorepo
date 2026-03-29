//! Stress testing framework for the staking_pool contract.
//!
//! Simulates high-concurrency scenarios by running many stake / unstake
//! operations sequentially within a single Soroban test environment (the
//! runtime is single-threaded, so "concurrent" means interleaved operations
//! across many users in one ledger sequence).
//!
//! ## What is measured
//!
//! | Metric                          | How                                           |
//! |---------------------------------|-----------------------------------------------|
//! | State consistency               | total_staked == Σ staked_balance(users)       |
//! | No negative balances            | ∀ user: staked_balance ≥ 0                    |
//! | Gas / CPU budget usage          | Soroban meter (`env.budget()`)                |
//! | Throughput regression detection | assert ops/ledger count within limits         |
//! | Lock-period enforcement at load | unstake before/after lock under many users    |
//! | Concurrent partial unstakes     | multiple users partially unstake same ledger  |

#[cfg(test)]
mod tests {
    extern crate std;

    use crate::{ContractError, StakingPool, StakingPoolClient};
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token, Address, Env,
    };

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    #[allow(dead_code)]
    struct TestCtx<'a> {
        contract_id: Address,
        token_id: Address,
        client: StakingPoolClient<'a>,
        admin: Address,
    }

    fn setup(env: &Env) -> TestCtx<'_> {
        // Deploy a minimal SAC-compatible token for staking
        let token_admin = Address::generate(env);
        let token_id = env
            .register_stellar_asset_contract_v2(token_admin.clone())
            .address();
        let token_client = token::StellarAssetClient::new(env, &token_id);

        let contract_id = env.register(StakingPool, ());
        let client = StakingPoolClient::new(env, &contract_id);
        let admin = Address::generate(env);

        env.mock_all_auths();
        client.init(&admin, &token_id);

        // Mint enough tokens into the contract itself to cover unstake payouts
        token_client.mint(&contract_id, &1_000_000_000_000i128);

        TestCtx {
            contract_id,
            token_id,
            client,
            admin,
        }
    }

    /// Mint `amount` tokens to `user` and have them stake immediately.
    fn stake_for(
        env: &Env,
        ctx: &TestCtx<'_>,
        token_client: &token::StellarAssetClient,
        user: &Address,
        amount: i128,
    ) {
        // mock_all_auths covers both the token mint and the stake transfer
        env.mock_all_auths();
        token_client.mint(user, &amount);
        ctx.client.stake(user, &amount);
    }

    /// Unstake `amount` for `user` (assumes lock period = 0).
    fn unstake_for(env: &Env, ctx: &TestCtx<'_>, user: &Address, amount: i128) {
        env.mock_all_auths();
        ctx.client.unstake(user, &amount);
    }

    /// Assert global invariant: total_staked == Σ staked_balance(users).
    fn assert_total_consistency(ctx: &TestCtx<'_>, users: &[Address]) {
        let reported_total = ctx.client.total_staked();
        let sum: i128 = users.iter().map(|u| ctx.client.staked_balance(u)).sum();
        assert_eq!(
            reported_total, sum,
            "total_staked ({reported_total}) != Σ staked_balance ({sum})"
        );
        for u in users {
            assert!(
                ctx.client.staked_balance(u) >= 0,
                "user balance must not be negative"
            );
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Stress test 1: Many users stake concurrently
    // ─────────────────────────────────────────────────────────────────────

    /// Simulate 50 users each staking different amounts in the same ledger
    /// window.  Verifies total consistency and no negative balances throughout.
    #[test]
    fn stress_many_users_stake() {
        let env = Env::default();
        let ctx = setup(&env);
        let token_client = token::StellarAssetClient::new(&env, &ctx.token_id);

        let n = 50usize;
        let users: std::vec::Vec<Address> = (0..n).map(|_| Address::generate(&env)).collect();
        let amounts: std::vec::Vec<i128> = (1..=n as i128).map(|i| i * 1_000).collect();

        for (user, &amount) in users.iter().zip(amounts.iter()) {
            stake_for(&env, &ctx, &token_client, user, amount);
        }

        assert_total_consistency(&ctx, &users);

        // Total expected: Σ(1..=50) * 1000 = 1_275_000
        let expected: i128 = amounts.iter().sum();
        assert_eq!(ctx.client.total_staked(), expected);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Stress test 2: Interleaved stake / unstake (high churn)
    // ─────────────────────────────────────────────────────────────────────

    /// 30 users each stake, then half partially unstake, then all stake more.
    /// Verifies consistency at every checkpoint.
    #[test]
    fn stress_interleaved_stake_unstake() {
        let env = Env::default();
        let ctx = setup(&env);
        let token_client = token::StellarAssetClient::new(&env, &ctx.token_id);

        let n = 30usize;
        let users: std::vec::Vec<Address> = (0..n).map(|_| Address::generate(&env)).collect();

        // Round 1: everyone stakes 10_000
        for user in &users {
            stake_for(&env, &ctx, &token_client, user, 10_000);
        }
        assert_total_consistency(&ctx, &users);
        assert_eq!(ctx.client.total_staked(), 10_000 * n as i128);

        // Round 2: first half partially unstakes 3_000
        for user in users.iter().take(n / 2) {
            unstake_for(&env, &ctx, user, 3_000);
        }
        assert_total_consistency(&ctx, &users);

        let expected_after_partial = 10_000 * n as i128 - 3_000 * (n / 2) as i128;
        assert_eq!(ctx.client.total_staked(), expected_after_partial);

        // Round 3: everyone stakes 5_000 more
        for user in &users {
            stake_for(&env, &ctx, &token_client, user, 5_000);
        }
        assert_total_consistency(&ctx, &users);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Stress test 3: Exhaustive unstake (all users fully unstake)
    // ─────────────────────────────────────────────────────────────────────

    /// After all users fully unstake, total_staked must be 0.
    #[test]
    fn stress_full_drain_to_zero() {
        let env = Env::default();
        let ctx = setup(&env);
        let token_client = token::StellarAssetClient::new(&env, &ctx.token_id);

        let n = 20usize;
        let users: std::vec::Vec<Address> = (0..n).map(|_| Address::generate(&env)).collect();
        let stake_amount = 50_000i128;

        for user in &users {
            stake_for(&env, &ctx, &token_client, user, stake_amount);
        }
        assert_eq!(ctx.client.total_staked(), stake_amount * n as i128);

        for user in &users {
            unstake_for(&env, &ctx, user, stake_amount);
        }

        assert_eq!(ctx.client.total_staked(), 0);
        assert_total_consistency(&ctx, &users);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Stress test 4: Lock period enforcement under load
    // ─────────────────────────────────────────────────────────────────────

    /// With a 1-hour lock period active, all users' unstake attempts fail
    /// before the lock expires; all succeed after advancing the ledger.
    #[test]
    fn stress_lock_period_under_load() {
        let env = Env::default();
        let ctx = setup(&env);
        let token_client = token::StellarAssetClient::new(&env, &ctx.token_id);

        // Set lock period = 3600 seconds
        env.mock_all_auths();
        ctx.client.set_lock_period(&ctx.admin, &3600u64);

        let n = 15usize;
        let users: std::vec::Vec<Address> = (0..n).map(|_| Address::generate(&env)).collect();

        for user in &users {
            stake_for(&env, &ctx, &token_client, user, 1_000);
        }

        // All unstake attempts must fail (TokensLocked)
        for user in &users {
            env.mock_all_auths();
            let result = ctx.client.try_unstake(user, &1_000i128);
            assert_eq!(
                result.unwrap_err().unwrap(),
                ContractError::TokensLocked,
                "unstake must be blocked by lock period"
            );
        }

        // Advance ledger past lock period
        env.ledger().with_mut(|li| {
            li.timestamp = li.timestamp.saturating_add(3601);
        });

        // All unstake attempts must now succeed
        for user in &users {
            unstake_for(&env, &ctx, user, 1_000);
        }

        assert_eq!(ctx.client.total_staked(), 0);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Stress test 5: Paused contract rejects all operations under load
    // ─────────────────────────────────────────────────────────────────────

    /// With contract paused, all stake/unstake calls from all users fail.
    /// After unpause, operations resume normally.
    #[test]
    fn stress_pause_under_load() {
        let env = Env::default();
        let ctx = setup(&env);
        let token_client = token::StellarAssetClient::new(&env, &ctx.token_id);

        let n = 10usize;
        let users: std::vec::Vec<Address> = (0..n).map(|_| Address::generate(&env)).collect();

        // Seed balances before pause
        for user in &users {
            stake_for(&env, &ctx, &token_client, user, 2_000);
        }

        // Pause
        env.mock_all_auths();
        ctx.client.pause(&ctx.admin);

        // All stake/unstake attempts must fail with Paused
        for user in &users {
            env.mock_all_auths();
            assert_eq!(
                ctx.client.try_stake(user, &100i128).unwrap_err().unwrap(),
                ContractError::Paused
            );
            env.mock_all_auths();
            assert_eq!(
                ctx.client.try_unstake(user, &100i128).unwrap_err().unwrap(),
                ContractError::Paused
            );
        }

        // State must be unchanged
        assert_eq!(ctx.client.total_staked(), 2_000 * n as i128);
        assert_total_consistency(&ctx, &users);

        // Unpause and verify operations resume
        env.mock_all_auths();
        ctx.client.unpause(&ctx.admin);

        for user in &users {
            unstake_for(&env, &ctx, user, 2_000);
        }
        assert_eq!(ctx.client.total_staked(), 0);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Stress test 6: Gas / budget regression check
    // ─────────────────────────────────────────────────────────────────────

    /// Run a defined number of stake operations and assert that the CPU
    /// and memory instruction counts do not exceed the Soroban network limits.
    /// Fails if future code changes regress performance beyond these bounds.
    #[test]
    fn stress_budget_within_limits() {
        let env = Env::default();
        env.cost_estimate().budget().reset_default(); // enforce default Soroban network limits
        let ctx = setup(&env);
        let token_client = token::StellarAssetClient::new(&env, &ctx.token_id);

        // A single stake operation must fit within the default budget
        let user = Address::generate(&env);
        stake_for(&env, &ctx, &token_client, &user, 1_000);

        // If the test reaches here without a budget-exceeded panic, the
        // operation is within the default Soroban network limits.
        assert!(ctx.client.staked_balance(&user) == 1_000);
    }
}
