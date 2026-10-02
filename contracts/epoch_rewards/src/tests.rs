extern crate std;

use crate::{ContractError, EpochRewards, EpochRewardsClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env,
};

fn setup(env: &Env, duration: u64) -> (Address, EpochRewardsClient<'_>) {
    env.mock_all_auths();
    let id = env.register(EpochRewards, ());
    let client = EpochRewardsClient::new(env, &id);
    let admin = Address::generate(env);
    client.init(&admin, &duration);
    (admin, client)
}

#[test]
#[should_panic]
fn init_requires_admin_auth() {
    let env = Env::default();
    let id = env.register(EpochRewards, ());
    let client = EpochRewardsClient::new(&env, &id);
    let admin = Address::generate(&env);

    client.init(&admin, &100u64);
}

// ── 1. Happy path ─────────────────────────────────────────────────────────────

#[test]
fn happy_path_stake_fund_seal_claim() {
    let env = Env::default();
    let duration = 100u64;
    let (admin, client) = setup(&env, duration);

    let user = Address::generate(&env);
    client.stake(&user, &1_000);
    client.fund_epoch_rewards(&admin, &500);

    env.ledger().with_mut(|li| li.timestamp = duration + 1);
    client.seal_epoch(&admin, &1, &100);

    let claimable = client.get_claimable(&user);
    assert!(claimable > 0, "user should have claimable rewards");

    let claimed = client.claim(&user);
    assert_eq!(claimed, claimable);
    assert_eq!(client.get_claimable(&user), 0);
}

// ── 2. Pro-rata distribution ──────────────────────────────────────────────────

#[test]
fn pro_rata_three_stakers() {
    let env = Env::default();
    let duration = 100u64;
    let (admin, client) = setup(&env, duration);

    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);

    // Stakes: 500, 300, 200 → total 1000
    client.stake(&a, &500);
    client.stake(&b, &300);
    client.stake(&c, &200);

    let total_reward: i128 = 1_000;
    client.fund_epoch_rewards(&admin, &total_reward);

    env.ledger().with_mut(|li| li.timestamp = duration + 1);
    client.seal_epoch(&admin, &1, &100);

    let ra = client.get_claimable(&a);
    let rb = client.get_claimable(&b);
    let rc = client.get_claimable(&c);

    // Expected: 500, 300, 200 (±1 stroop tolerance)
    assert!((ra - 500).abs() <= 1, "a expected ~500, got {}", ra);
    assert!((rb - 300).abs() <= 1, "b expected ~300, got {}", rb);
    assert!((rc - 200).abs() <= 1, "c expected ~200, got {}", rc);

    // Conservation: sum of claimable must not exceed funded
    assert!(
        ra + rb + rc <= total_reward,
        "conservation violated: {} + {} + {} > {}",
        ra,
        rb,
        rc,
        total_reward
    );
}

// ── 3. Late joiner ────────────────────────────────────────────────────────────

#[test]
fn late_joiner_earns_less() {
    let env = Env::default();
    let duration = 100u64;
    let (admin, client) = setup(&env, duration);

    let early = Address::generate(&env);
    client.stake(&early, &1_000);
    // Fund half the rewards before late joiner
    client.fund_epoch_rewards(&admin, &500);

    // Late joiner stakes after first funding
    let late = Address::generate(&env);
    client.stake(&late, &1_000);
    // Fund second half after late joiner
    client.fund_epoch_rewards(&admin, &500);

    env.ledger().with_mut(|li| li.timestamp = duration + 1);
    client.seal_epoch(&admin, &1, &100);

    let early_rewards = client.get_claimable(&early);
    let late_rewards = client.get_claimable(&late);

    // Early staker should earn more than late joiner
    assert!(
        early_rewards > late_rewards,
        "early={} should > late={}",
        early_rewards,
        late_rewards
    );
    // Late joiner should still earn something (from second funding)
    assert!(late_rewards > 0);

    // Conservation invariant
    assert!(
        early_rewards + late_rewards <= 1_000i128,
        "conservation violated: {} + {} > 1000",
        early_rewards,
        late_rewards
    );
}

// ── 4. Zero stakers ───────────────────────────────────────────────────────────

#[test]
fn zero_stakers_distribute_does_not_panic() {
    let env = Env::default();
    let duration = 100u64;
    let (admin, client) = setup(&env, duration);

    // Fund with no stakers — should not panic
    let result = client.try_fund_epoch_rewards(&admin, &1_000);
    assert!(result.is_ok());

    env.ledger().with_mut(|li| li.timestamp = duration + 1);
    client.seal_epoch(&admin, &1, &100);

    // Epoch sealed, rewards unallocated (reward index stays 0)
    let epoch = client.get_epoch(&1).unwrap();
    assert!(epoch.sealed);
    assert_eq!(epoch.total_rewards, 1_000);
    // All funded amount is dust since no stakers received it
    assert_eq!(epoch.dust, 1_000);
}

// ── 5. Epoch boundary ─────────────────────────────────────────────────────────

#[test]
fn seal_before_epoch_end_returns_error() {
    let env = Env::default();
    let duration = 100u64;
    let (admin, client) = setup(&env, duration);

    // Timestamp is 0, epoch not expired
    let result = client.try_seal_epoch(&admin, &1, &100);
    assert_eq!(result.unwrap_err().unwrap(), ContractError::EpochNotExpired);
}

// ── 6. Double claim ───────────────────────────────────────────────────────────

#[test]
fn double_claim_second_returns_zero() {
    let env = Env::default();
    let duration = 100u64;
    let (admin, client) = setup(&env, duration);

    let user = Address::generate(&env);
    client.stake(&user, &1_000);
    client.fund_epoch_rewards(&admin, &1_000);

    env.ledger().with_mut(|li| li.timestamp = duration + 1);
    client.seal_epoch(&admin, &1, &100);

    let first = client.claim(&user);
    assert!(first > 0);

    let second = client.claim(&user);
    assert_eq!(second, 0, "second claim should return 0");
}

// ── 7. Admin controls ─────────────────────────────────────────────────────────

#[test]
fn non_admin_cannot_seal_epoch() {
    let env = Env::default();
    let duration = 100u64;
    let (_admin, client) = setup(&env, duration);

    let attacker = Address::generate(&env);
    env.ledger().with_mut(|li| li.timestamp = duration + 1);

    let result = client.try_seal_epoch(&attacker, &1, &100);
    assert_eq!(result.unwrap_err().unwrap(), ContractError::NotAuthorized);
}

#[test]
fn non_admin_cannot_fund_rewards() {
    let env = Env::default();
    let (_admin, client) = setup(&env, 100);

    let attacker = Address::generate(&env);
    let result = client.try_fund_epoch_rewards(&attacker, &1_000);
    assert_eq!(result.unwrap_err().unwrap(), ContractError::NotAuthorized);
}

#[test]
fn operator_can_fund_and_seal() {
    let env = Env::default();
    let duration = 100u64;
    let (admin, client) = setup(&env, duration);

    let operator = Address::generate(&env);
    client.set_operator(&admin, &operator);

    let user = Address::generate(&env);
    client.stake(&user, &1_000);
    client.fund_epoch_rewards(&operator, &500);

    env.ledger().with_mut(|li| li.timestamp = duration + 1);
    client.seal_epoch(&operator, &1, &100);

    assert_eq!(client.current_epoch(), 2);
}

// ── 8. Large numbers (100 stakers) ───────────────────────────────────────────

#[test]
fn large_numbers_100_stakers_no_overflow() {
    let env = Env::default();
    let duration = 100u64;
    let (admin, client) = setup(&env, duration);

    let mut stakers = std::vec::Vec::new();
    for _ in 0..100 {
        let addr = Address::generate(&env);
        client.stake(&addr, &1_000_000);
        stakers.push(addr);
    }

    // Fund large reward
    client.fund_epoch_rewards(&admin, &100_000_000);

    env.ledger().with_mut(|li| li.timestamp = duration + 1);
    client.seal_epoch(&admin, &1, &100);

    // Each staker should have equal share ≈ 1_000_000 (±1)
    let mut total_claimed: i128 = 0;
    for staker in &stakers {
        let r = client.get_claimable(staker);
        assert!(
            (r - 1_000_000).abs() <= 1,
            "staker reward {} out of range",
            r
        );
        total_claimed += r;
    }
    // Total claimed should be close to total funded (rounding losses ≤ 100)
    assert!((total_claimed - 100_000_000).abs() <= 100);
    // Conservation: total claimed must never exceed funded
    assert!(
        total_claimed <= 100_000_000,
        "over-distribution: {} > 100_000_000",
        total_claimed
    );
}

// ── 9. Paused state ───────────────────────────────────────────────────────────

#[test]
fn distribute_rewards_fails_when_paused() {
    let env = Env::default();
    let duration = 100u64;
    let (admin, client) = setup(&env, duration);

    client.pause(&admin);
    assert!(client.is_paused());

    let result = client.try_fund_epoch_rewards(&admin, &1_000);
    assert_eq!(result.unwrap_err().unwrap(), ContractError::Paused);

    // Unpause and verify it works again
    client.unpause(&admin);
    assert!(!client.is_paused());
    assert!(client.try_fund_epoch_rewards(&admin, &1_000).is_ok());
}

// ── 10. Conservation: uneven stake split ─────────────────────────────────────

#[test]
fn conservation_uneven_split_sum_never_exceeds_funded() {
    let env = Env::default();
    let duration = 100u64;
    let (admin, client) = setup(&env, duration);

    // Stake amounts that don't divide evenly into the reward
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);

    client.stake(&a, &7);
    client.stake(&b, &3);
    client.stake(&c, &1);

    let funded: i128 = 11;
    client.fund_epoch_rewards(&admin, &funded);

    env.ledger().with_mut(|li| li.timestamp = duration + 1);
    client.seal_epoch(&admin, &1, &100);

    let ra = client.get_claimable(&a);
    let rb = client.get_claimable(&b);
    let rc = client.get_claimable(&c);

    // Core invariant: no over-distribution
    assert!(
        ra + rb + rc <= funded,
        "conservation violated: {} + {} + {} = {} > {}",
        ra,
        rb,
        rc,
        ra + rb + rc,
        funded
    );

    // Dust must be non-negative and equal funded - sum_claimable
    let epoch = client.get_epoch(&1).unwrap();
    let dust = epoch.dust;
    assert!(dust >= 0, "dust should be non-negative, got {}", dust);
    assert_eq!(
        dust,
        funded - ra - rb - rc,
        "dust mismatch: epoch.dust={} funded-sum={}",
        dust,
        funded - ra - rb - rc
    );
    assert_eq!(
        epoch.total_claimable_at_seal,
        ra + rb + rc,
        "total_claimable_at_seal should match sum of claimable"
    );
}

// ── 11. Dust carry: funded dust is tracked, not silently lost ────────────────

#[test]
fn dust_tracked_in_epoch_info() {
    let env = Env::default();
    let duration = 100u64;
    let (admin, client) = setup(&env, duration);

    // 3 stakers, total 10 units. Fund 11 → remainder 1 distributes unevenly.
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);
    client.stake(&a, &4);
    client.stake(&b, &3);
    client.stake(&c, &3);

    let funded: i128 = 11;
    client.fund_epoch_rewards(&admin, &funded);

    env.ledger().with_mut(|li| li.timestamp = duration + 1);
    client.seal_epoch(&admin, &1, &100);

    let epoch = client.get_epoch(&1).unwrap();
    assert!(epoch.sealed);
    // dust must be explicitly tracked
    assert!(epoch.dust >= 0);
    // funded = claimable + dust (no funds disappear)
    assert_eq!(epoch.total_claimable_at_seal + epoch.dust, funded);

    // Next epoch carries the full funded amount (including dust)
    let epoch2 = client.get_epoch(&2).unwrap();
    assert_eq!(epoch2.carried_forward, funded);
}

// ── 12. Claim idempotency ─────────────────────────────────────────────────────

#[test]
fn claim_is_idempotent() {
    let env = Env::default();
    let duration = 100u64;
    let (admin, client) = setup(&env, duration);

    let user = Address::generate(&env);
    client.stake(&user, &1_000);
    client.fund_epoch_rewards(&admin, &500);

    env.ledger().with_mut(|li| li.timestamp = duration + 1);
    client.seal_epoch(&admin, &1, &100);

    let first = client.claim(&user);
    assert!(first > 0);

    // Second claim: must return 0 (idempotent, not double-paying)
    let second = client.claim(&user);
    assert_eq!(second, 0, "second claim must be 0");

    // Third claim: still 0
    let third = client.claim(&user);
    assert_eq!(third, 0, "third claim must be 0");
}

// ── 13. Claim before seal rejected ───────────────────────────────────────────

#[test]
fn claim_before_any_seal_is_rejected() {
    let env = Env::default();
    let duration = 100u64;
    let (admin, client) = setup(&env, duration);

    let user = Address::generate(&env);
    client.stake(&user, &1_000);
    client.fund_epoch_rewards(&admin, &500);

    // No seal yet — current_epoch is still 1
    let result = client.try_claim(&user);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ContractError::ClaimBeforeSeal,
        "claim before any seal must be rejected"
    );
}

// ── 14. Full-claim conservation across multiple epochs ───────────────────────

#[test]
fn full_claim_conservation_multi_epoch() {
    let env = Env::default();
    let duration = 100u64;
    let (admin, client) = setup(&env, duration);

    let a = Address::generate(&env);
    let b = Address::generate(&env);

    client.stake(&a, &600);
    client.stake(&b, &400);

    let funded_e1: i128 = 1_000;
    client.fund_epoch_rewards(&admin, &funded_e1);

    // Seal epoch 1
    env.ledger().with_mut(|li| li.timestamp = duration + 1);
    client.seal_epoch(&admin, &1, &100);

    // Epoch 2 funding
    let funded_e2: i128 = 500;
    client.fund_epoch_rewards(&admin, &funded_e2);

    // Seal epoch 2
    env.ledger().with_mut(|li| li.timestamp = 2 * duration + 2);
    client.seal_epoch(&admin, &2, &100);

    // Both users claim
    let ra = client.claim(&a);
    let rb = client.claim(&b);

    let total_funded = funded_e1 + funded_e2;
    assert!(
        ra + rb <= total_funded,
        "over-distribution across epochs: {} + {} = {} > {}",
        ra,
        rb,
        ra + rb,
        total_funded
    );
}

// ── 15. Unstake during active epoch: reward accounting policy ───────────────
//
// Policy: When a staker unstakes during an active (unsealed) epoch, they earn
// rewards proportional to their stake duration up to the unstake timestamp.
// Their pending rewards are settled and banked at unstake time. The remaining
// rewards for the epoch are distributed only to stakers who remain staked.
// This ensures conservation: Σ claimable ≤ funded, with no stranded or
// double-counted rewards.

#[test]
fn unstake_during_active_epoch_settles_pending_rewards() {
    let env = Env::default();
    let duration = 100u64;
    let (admin, client) = setup(&env, duration);

    let user = Address::generate(&env);
    client.stake(&user, &1_000);

    // Fund rewards for the epoch
    let funded: i128 = 500;
    client.fund_epoch_rewards(&admin, &funded);

    // User unstakes during active epoch (before seal)
    client.unstake(&user, &1_000);

    // User should have claimable rewards from their time staked
    let claimable = client.get_claimable(&user);
    assert!(claimable > 0, "unstaker should have earned rewards");

    // Seal the epoch
    env.ledger().with_mut(|li| li.timestamp = duration + 1);
    client.seal_epoch(&admin, &1, &100);

    // User can claim their rewards
    let claimed = client.claim(&user);
    assert_eq!(claimed, claimable);
}

#[test]
fn unstake_during_active_epoch_conservation_holds() {
    let env = Env::default();
    let duration = 100u64;
    let (admin, client) = setup(&env, duration);

    let a = Address::generate(&env);
    let b = Address::generate(&env);

    // Both stake initially
    client.stake(&a, &600);
    client.stake(&b, &400);

    // Fund rewards
    let funded: i128 = 1_000;
    client.fund_epoch_rewards(&admin, &funded);

    // A unstakes during active epoch
    client.unstake(&a, &600);

    // Seal the epoch
    env.ledger().with_mut(|li| li.timestamp = duration + 1);
    client.seal_epoch(&admin, &1, &100);

    // Check claimable amounts
    let claimable_a = client.get_claimable(&a);
    let claimable_b = client.get_claimable(&b);

    // Conservation: total claimable must not exceed funded
    assert!(
        claimable_a + claimable_b <= funded,
        "conservation violated: {} + {} > {}",
        claimable_a,
        claimable_b,
        funded
    );

    // A should have earned something (proportional to time staked)
    assert!(claimable_a > 0, "unstaker should have earned rewards");

    // B should also have earned something (continued staking after A left)
    assert!(
        claimable_b > 0,
        "remaining staker should have earned rewards"
    );
}

#[test]
fn unstake_then_restake_within_same_epoch() {
    let env = Env::default();
    let duration = 100u64;
    let (admin, client) = setup(&env, duration);

    let user = Address::generate(&env);
    client.stake(&user, &1_000);

    // Fund rewards
    client.fund_epoch_rewards(&admin, &500);

    // Unstake
    client.unstake(&user, &1_000);

    // Re-stake in same epoch
    client.stake(&user, &1_000);

    // Fund more rewards
    client.fund_epoch_rewards(&admin, &500);

    // Seal the epoch
    env.ledger().with_mut(|li| li.timestamp = duration + 1);
    client.seal_epoch(&admin, &1, &100);

    // User should have claimable from both periods
    let claimable = client.get_claimable(&user);
    assert!(claimable > 0, "user should have earned rewards");

    // Conservation should still hold
    let epoch = client.get_epoch(&1).unwrap();
    assert!(
        epoch.total_claimable_at_seal <= 1_000,
        "total claimable should not exceed funded"
    );
}

#[test]
fn unstake_full_balance_during_active_epoch() {
    let env = Env::default();
    let duration = 100u64;
    let (admin, client) = setup(&env, duration);

    let user = Address::generate(&env);
    client.stake(&user, &1_000);

    client.fund_epoch_rewards(&admin, &500);

    // Unstake full balance
    client.unstake(&user, &1_000);

    // User should have claimable rewards
    let claimable = client.get_claimable(&user);
    assert!(claimable > 0);

    // Seal epoch
    env.ledger().with_mut(|li| li.timestamp = duration + 1);
    client.seal_epoch(&admin, &1, &100);

    // User can claim
    let claimed = client.claim(&user);
    assert_eq!(claimed, claimable);

    // User's stake should be 0
    assert_eq!(client.total_staked(), 0);
}

#[test]
fn unstake_by_only_staker_during_active_epoch() {
    let env = Env::default();
    let duration = 100u64;
    let (admin, client) = setup(&env, duration);

    let sole_staker = Address::generate(&env);
    client.stake(&sole_staker, &1_000);

    client.fund_epoch_rewards(&admin, &500);

    // Sole staker unstakes
    client.unstake(&sole_staker, &1_000);

    // Seal epoch
    env.ledger().with_mut(|li| li.timestamp = duration + 1);
    client.seal_epoch(&admin, &1, &100);

    // Sole staker should get all rewards (minus dust)
    let claimable = client.get_claimable(&sole_staker);
    assert!(claimable > 0);

    // Conservation: claimable should be close to funded (minus dust)
    let epoch = client.get_epoch(&1).unwrap();
    assert_eq!(
        epoch.total_claimable_at_seal + epoch.dust,
        500,
        "claimable + dust should equal funded"
    );
}

#[test]
fn unstake_after_seal_does_not_affect_sealed_epoch() {
    let env = Env::default();
    let duration = 100u64;
    let (admin, client) = setup(&env, duration);

    let user = Address::generate(&env);
    client.stake(&user, &1_000);

    client.fund_epoch_rewards(&admin, &500);

    // Seal epoch 1
    env.ledger().with_mut(|li| li.timestamp = duration + 1);
    client.seal_epoch(&admin, &1, &100);

    // Get claimable before unstake
    let claimable_before = client.get_claimable(&user);

    // Unstake after seal
    client.unstake(&user, &1_000);

    // Claimable should not change (sealed epoch rewards are fixed)
    let claimable_after = client.get_claimable(&user);
    assert_eq!(
        claimable_before, claimable_after,
        "unstake after seal should not affect claimable"
    );

    // User can still claim the same amount
    let claimed = client.claim(&user);
    assert_eq!(claimed, claimable_before);
}

#[test]
fn unstake_partial_during_active_epoch() {
    let env = Env::default();
    let duration = 100u64;
    let (admin, client) = setup(&env, duration);

    let user = Address::generate(&env);
    client.stake(&user, &1_000);

    client.fund_epoch_rewards(&admin, &500);

    // Unstake partial amount
    client.unstake(&user, &400);

    // User should have claimable rewards
    let claimable = client.get_claimable(&user);
    assert!(claimable > 0);

    // Remaining stake should be 600
    assert_eq!(client.total_staked(), 600);

    // Seal epoch
    env.ledger().with_mut(|li| li.timestamp = duration + 1);
    client.seal_epoch(&admin, &1, &100);

    // User can claim
    let claimed = client.claim(&user);
    assert_eq!(claimed, claimable);
}
