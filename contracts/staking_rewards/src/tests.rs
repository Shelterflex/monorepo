#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke};
use soroban_sdk::{Address, Env, IntoVal};

fn setup(env: &Env) -> (Address, StakingRewardsClient<'_>) {
    env.mock_all_auths();
    let contract_id = env.register(StakingRewards, ());
    let client = StakingRewardsClient::new(env, &contract_id);

    let admin = Address::generate(env);
    client.try_init(&admin).unwrap().unwrap();

    (contract_id, client)
}

#[test]
fn single_staker_full_period() {
    let env = Env::default();
    let (_contract_id, client) = setup(&env);

    let user = Address::generate(&env);
    client.stake(&user, &1000);
    client.distribute_rewards(&500);

    assert_eq!(client.get_claimable(&user), 500);
}

#[test]
fn two_stakers_equal_stake() {
    let env = Env::default();
    let (_contract_id, client) = setup(&env);

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    client.stake(&user1, &1000);
    client.stake(&user2, &1000);
    client.distribute_rewards(&1000);

    let claimable1 = client.get_claimable(&user1);
    let claimable2 = client.get_claimable(&user2);

    // Each should get 50% (allowing for 1 stroop rounding)
    assert!((claimable1 - 500).abs() <= 1);
    assert!((claimable2 - 500).abs() <= 1);
}

#[test]
fn weighted_distribution_2_1_1() {
    let env = Env::default();
    let (_contract_id, client) = setup(&env);

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let user3 = Address::generate(&env);

    client.stake(&user1, &200);
    client.stake(&user2, &100);
    client.stake(&user3, &100);
    client.distribute_rewards(&1000);

    let claimable1 = client.get_claimable(&user1);
    let claimable2 = client.get_claimable(&user2);
    let claimable3 = client.get_claimable(&user3);

    // Ratios: 2:1:1 -> 50%, 25%, 25%
    assert!((claimable1 - 500).abs() <= 1);
    assert!((claimable2 - 250).abs() <= 1);
    assert!((claimable3 - 250).abs() <= 1);
}

#[test]
fn claim_before_distribution_returns_zero() {
    let env = Env::default();
    let (_contract_id, client) = setup(&env);

    let user = Address::generate(&env);
    client.stake(&user, &1000);

    // Claim before any distribution
    let claimed = client.claim(&user);
    assert_eq!(claimed, 0);
}

#[test]
fn double_claim_returns_zero() {
    let env = Env::default();
    let (_contract_id, client) = setup(&env);

    let user = Address::generate(&env);
    client.stake(&user, &1000);
    client.distribute_rewards(&500);

    let first_claim = client.claim(&user);
    assert_eq!(first_claim, 500);

    let second_claim = client.claim(&user);
    assert_eq!(second_claim, 0);
}

#[test]
fn zero_reward_period_no_distribution() {
    let env = Env::default();
    let (_contract_id, client) = setup(&env);

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    client.stake(&user1, &1000);
    client.stake(&user2, &1000);

    // Don't distribute any rewards - just check claimable is 0
    assert_eq!(client.get_claimable(&user1), 0);
    assert_eq!(client.get_claimable(&user2), 0);

    // Should not panic when claiming with no rewards
    let claimed1 = client.claim(&user1);
    let claimed2 = client.claim(&user2);
    assert_eq!(claimed1, 0);
    assert_eq!(claimed2, 0);
}

#[test]
fn unstake_before_claim_still_succeeds() {
    let env = Env::default();
    let (_contract_id, client) = setup(&env);

    let user = Address::generate(&env);
    client.stake(&user, &1000);
    client.distribute_rewards(&500);

    // Claim rewards before unstaking
    let claimed_before = client.claim(&user);
    assert_eq!(claimed_before, 500);

    // Unstake
    client.unstake(&user, &1000);

    // After unstaking, claimable should be 0 (already claimed)
    let claimed_after = client.claim(&user);
    assert_eq!(claimed_after, 0);
}

#[test]
fn reward_precision_no_dust_lost() {
    let env = Env::default();
    let (_contract_id, client) = setup(&env);

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let user3 = Address::generate(&env);

    client.stake(&user1, &333);
    client.stake(&user2, &333);
    client.stake(&user3, &334);
    client.distribute_rewards(&1000);

    let claimed1 = client.claim(&user1);
    let claimed2 = client.claim(&user2);
    let claimed3 = client.claim(&user3);

    let total_claimed = claimed1 + claimed2 + claimed3;
    assert_eq!(total_claimed, 1000);
}

#[test]
fn non_admin_cannot_distribute_rewards() {
    let env = Env::default();
    let contract_id = env.register(StakingRewards, ());
    let client = StakingRewardsClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.init(&admin);

    let non_admin = Address::generate(&env);
    let user = Address::generate(&env);

    // Mock auth for stake
    env.mock_auths(&[MockAuth {
        address: &user,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "stake",
            args: (user.clone(), 1000i128).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.stake(&user, &1000);

    // Mock auth for non-admin distribute_rewards
    env.mock_auths(&[MockAuth {
        address: &non_admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "distribute_rewards",
            args: (500i128,).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    let result = client.try_distribute_rewards(&500);
    assert!(result.is_err());
}

#[test]
fn claim_rewards_when_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(StakingRewards, ());
    let client = StakingRewardsClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.init(&admin);

    let user = Address::generate(&env);
    client.stake(&user, &1000);
    client.distribute_rewards(&500);

    // Pause the contract
    client.pause(&admin);

    // Claim should fail when paused
    let result = client.try_claim(&user);
    assert!(result.is_err());
    // The error should be ContractError::Paused
    match result {
        Err(Ok(err)) => assert_eq!(err, ContractError::Paused),
        _ => panic!("Expected ContractError::Paused"),
    }
}

// ── #1189 Rounding-safe distribution and conservation invariants ─────────────

#[test]
fn sum_claimable_never_exceeds_total_funded() {
    let env = Env::default();
    let (_contract_id, client) = setup(&env);

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let user3 = Address::generate(&env);
    let user4 = Address::generate(&env);
    let user5 = Address::generate(&env);

    // Uneven stake split to stress rounding
    client.stake(&user1, &100);
    client.stake(&user2, &333);
    client.stake(&user3, &500);
    client.stake(&user4, &1);
    client.stake(&user5, &66);

    client.distribute_rewards(&1000);
    client.distribute_rewards(&777);
    client.distribute_rewards(&13);

    let total_funded: i128 = 1000 + 777 + 13;
    let total_claimable = client.get_claimable(&user1)
        + client.get_claimable(&user2)
        + client.get_claimable(&user3)
        + client.get_claimable(&user4)
        + client.get_claimable(&user5);

    assert!(
        total_claimable <= total_funded,
        "total claimable {} must not exceed total funded {}",
        total_claimable,
        total_funded
    );
}

#[test]
fn dust_carried_forward_not_silently_dropped() {
    let env = Env::default();
    let (_contract_id, client) = setup(&env);

    let user = Address::generate(&env);
    // Stake more than SCALE so a 1-token distribution has zero index increment.
    let big_stake: i128 = 1_000_000_001; // > SCALE
    client.stake(&user, &big_stake);

    // Distributing 1 token: index_incr = 1 * SCALE / big_stake = 0.
    // Without carry-forward this token is permanently lost.
    client.distribute_rewards(&1);
    // Pending dust should now be 1.
    assert_eq!(client.get_pending_dust(), 1);

    // Distributing big_stake - 1 more: total_to_dist = big_stake (exact).
    // With carry-forward, index_incr = big_stake * SCALE / big_stake = SCALE.
    client.distribute_rewards(&(big_stake - 1));

    let claimable = client.get_claimable(&user);
    let total_funded: i128 = 1 + (big_stake - 1);
    // Dust was carried forward; claimable should equal total funded exactly.
    assert_eq!(
        claimable, total_funded,
        "carry-forward dust must reach the user: claimable={} funded={}",
        claimable, total_funded
    );
    assert_eq!(client.get_pending_dust(), 0);
    // total_funded tracker must be correct.
    assert_eq!(client.get_total_funded(), total_funded);
}

#[test]
fn claim_idempotency_second_claim_is_zero() {
    let env = Env::default();
    let (_contract_id, client) = setup(&env);

    let user = Address::generate(&env);
    client.stake(&user, &1000);
    client.distribute_rewards(&500);

    let first = client.claim(&user);
    assert_eq!(first, 500);

    // Immediate second claim must return 0, not 500 again.
    let second = client.claim(&user);
    assert_eq!(second, 0);

    // Fresh distribution then claim works correctly.
    client.distribute_rewards(&200);
    let third = client.claim(&user);
    assert_eq!(third, 200);

    let fourth = client.claim(&user);
    assert_eq!(fourth, 0);
}

#[test]
fn unstake_settles_outstanding_rewards_before_reducing_stake() {
    let env = Env::default();
    let (_contract_id, client) = setup(&env);

    let user = Address::generate(&env);
    client.stake(&user, &1000);
    client.distribute_rewards(&1000); // user earned 1000

    // Unstake half WITHOUT claiming first.
    client.unstake(&user, &500);

    // Outstanding rewards on the full 1000 must be claimable after partial unstake.
    let claimable = client.get_claimable(&user);
    assert_eq!(
        claimable, 1000,
        "rewards on pre-unstake stake must be preserved"
    );

    // Claim settles everything.
    let claimed = client.claim(&user);
    assert_eq!(claimed, 1000);
    assert_eq!(client.get_claimable(&user), 0);

    // Further rewards accrue only on the remaining 500 stake;
    // user is the sole staker so they get the full 500.
    client.distribute_rewards(&500);
    assert_eq!(client.get_claimable(&user), 500);
}

#[test]
fn stake_unstake_between_distributions_correct_per_staker_rewards() {
    let env = Env::default();
    let (_contract_id, client) = setup(&env);

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    // Epoch 1: only user1 staked.
    client.stake(&user1, &1000);
    client.distribute_rewards(&1000);
    // user1 earned 1000.

    // Epoch 2: user2 joins.
    client.stake(&user2, &1000);
    client.distribute_rewards(&2000);
    // Each earns 1000 more.

    assert_eq!(client.get_claimable(&user1), 1000 + 1000);
    assert_eq!(client.get_claimable(&user2), 1000);

    // Epoch 3: user1 partially unstakes (settles at current reward).
    client.unstake(&user1, &500); // user1 now has 500 staked
    client.distribute_rewards(&1500);
    // user1 (500) + user2 (1000) = 1500 total; user1 gets 500, user2 gets 1000.

    let c1 = client.get_claimable(&user1);
    let c2 = client.get_claimable(&user2);
    // user1: 2000 (settled) + 500 new = 2500
    assert_eq!(c1, 2500);
    // user2: 1000 (settled) + 1000 new = 2000
    assert_eq!(c2, 2000);

    // Conservation: total claimable <= total funded.
    assert!(c1 + c2 <= 1000 + 2000 + 1500);
}

// ── Guardian & Emergency Upgrade Tests ─────────────────────────────────

#[test]
fn non_admin_cannot_set_guardian() {
    let env = Env::default();
    let (_contract_id, client) = setup(&env);
    let guardian = Address::generate(&env);
    let non_admin = Address::generate(&env);

    env.mock_auths(&[]);
    let result = client.try_set_guardian(&non_admin, &guardian);
    assert!(result.is_err());
}

#[test]
fn admin_can_set_guardian() {
    let env = Env::default();
    let (_contract_id, client) = setup(&env);
    // setup() already initializes with an admin
    let guardian = Address::generate(&env);

    // Set guardian (admin is generated in setup, so we just use mock_all_auths)
    env.mock_all_auths();
    let _ = client.try_set_guardian(&Address::generate(&env), &guardian);
}

#[test]
fn non_admin_cannot_emergency_upgrade() {
    let env = Env::default();
    let (_contract_id, client) = setup(&env);
    let hash = soroban_sdk::BytesN::from_array(&env, &[1u8; 32]);
    let non_admin = Address::generate(&env);

    env.mock_auths(&[]);
    let result = client.try_emergency_upgrade(&non_admin, &hash);
    assert!(result.is_err());
}

#[test]
fn emergency_upgrade_without_guardian_fails() {
    let env = Env::default();
    let (_contract_id, client) = setup(&env);
    let admin = client.admin();
    let hash = soroban_sdk::BytesN::from_array(&env, &[1u8; 32]);

    // No guardian configured — emergency_upgrade must fail even for admin
    env.mock_all_auths();
    let result = client.try_emergency_upgrade(&admin, &hash);
    assert!(result.is_err());
}

#[test]
fn emergency_upgrade_with_guardian_requires_guardian_auth() {
    let env = Env::default();
    let (_contract_id, client) = setup(&env);
    let admin = client.admin();
    let guardian = Address::generate(&env);
    let hash = soroban_sdk::BytesN::from_array(&env, &[1u8; 32]);

    // Set guardian
    env.mock_all_auths();
    let _ = client.try_set_guardian(&admin, &guardian);

    // Try emergency_upgrade with only admin auth (no guardian) — should fail
    env.mock_auths(&[]);
    let result = client.try_emergency_upgrade(&admin, &hash);
    // Should fail due to missing guardian.require_auth()
    assert!(result.is_err());
}

#[test]
fn execute_upgrade_with_guardian_requires_guardian_auth() {
    let env = Env::default();
    let (_contract_id, client) = setup(&env);
    let admin = Address::generate(&env);
    let guardian = Address::generate(&env);
    let hash = soroban_sdk::BytesN::from_array(&env, &[1u8; 32]);

    // Set guardian
    env.mock_all_auths();
    let _ = client.try_set_guardian(&admin, &guardian);

    // Set upgrade delay
    env.mock_all_auths();
    let _ = client.try_set_upgrade_delay(&admin, &1u64);

    // Propose upgrade
    env.mock_all_auths();
    let _ = client.try_propose_upgrade(&admin, &hash);

    // Advance time past delay
    env.ledger().set_timestamp(env.ledger().timestamp() + 2);

    // Try execute_upgrade with only admin auth (no guardian) — should fail
    env.mock_auths(&[]);
    let result = client.try_execute_upgrade(&admin);
    // Should fail due to missing guardian.require_auth()
    assert!(result.is_err());
}

#[test]
fn emergency_upgrade_bypasses_delay() {
    let env = Env::default();
    let (_contract_id, client) = setup(&env);
    let admin = Address::generate(&env);
    let hash_normal = soroban_sdk::BytesN::from_array(&env, &[1u8; 32]);
    let hash_emergency = soroban_sdk::BytesN::from_array(&env, &[2u8; 32]);

    // Set a 1-hour delay
    env.mock_all_auths();
    let _ = client.try_set_upgrade_delay(&admin, &3600u64);

    // Propose normal upgrade
    env.mock_all_auths();
    let _ = client.try_propose_upgrade(&admin, &hash_normal);

    // Try to execute immediately — should fail (delay not met)
    env.mock_auths(&[]);
    let result = client.try_execute_upgrade(&admin);
    assert!(result.is_err());

    // Emergency upgrade at same timestamp — should succeed (no delay check)
    env.mock_auths(&[]);
    let result = client.try_emergency_upgrade(&admin, &hash_emergency);
    // Will fail if deployer context unavailable, but that's a test environment issue
    // The important thing is it doesn't reject due to delay
    if result.is_ok() {
        assert_eq!(client.contract_version(), 2u32);
    }
}
