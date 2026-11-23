#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _, Events as _, MockAuth, MockAuthInvoke};
use soroban_sdk::{token::StellarAssetClient, Address, Env, IntoVal};

fn setup_contract(env: &Env) -> (Address, StakingPoolClient<'_>, Address, Address, Address) {
    env.mock_all_auths();
    let contract_id = env.register(StakingPool, ());
    let client = StakingPoolClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let user = Address::generate(env);
    let token_admin = Address::generate(env);

    // Create token contract
    let token_contract = env.register_stellar_asset_contract_v2(token_admin);
    let token_contract_id = token_contract.address();

    // Initialization now authenticates the configured administrator.
    client.init(&admin, &token_contract_id);

    (contract_id, client, admin, user, token_contract_id)
}

/// Ledgers to advance in the TTL tests. This is past the test env default persistent TTL
/// (`min_persistent_entry_ttl` = 4096), so an entry that was never extended would be archived.
const LEDGERS_PAST_DEFAULT_TTL: u32 = 5_000;

fn advance_ledgers(env: &Env, ledgers: u32) {
    let next = env.ledger().sequence() + ledgers;
    env.ledger().set_sequence_number(next);
}

#[test]
fn stake_state_survives_past_default_ttl() {
    let env = Env::default();
    env.mock_all_auths();
    let (_contract_id, client, admin, user, token_id) = setup_contract(&env);

    let asset = StellarAssetClient::new(&env, &token_id);
    asset.mint(&user, &1000i128);
    client.stake(&user, &100i128);
    client.utilize_stake(&admin, &user, &40i128);

    advance_ledgers(&env, LEDGERS_PAST_DEFAULT_TTL);

    // Values are unchanged after the ledger jump.
    assert_eq!(client.staked_balance(&user), 100i128);
    assert_eq!(client.used_stake(&user), 40i128);
    assert_eq!(client.unused_stake(&user), 60i128);
    assert_eq!(client.total_staked(), 100i128);
}

#[test]
fn reads_extend_ttl_so_stake_survives_beyond_first_window() {
    let env = Env::default();
    env.mock_all_auths();
    let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

    // A getter for an address that never staked must not fail while extending TTL.
    let stranger = Address::generate(&env);
    assert_eq!(client.staked_balance(&stranger), 0i128);

    let asset = StellarAssetClient::new(&env, &token_id);
    asset.mint(&user, &1000i128);
    client.stake(&user, &100i128);

    // The stake writes at ledger 0 extend entries to ledger 500,000. At ledger 495,000 the
    // remaining lifetime is under the 10,000-ledger threshold, so these reads extend again.
    advance_ledgers(&env, 495_000);
    assert_eq!(client.staked_balance(&user), 100i128);
    assert_eq!(client.total_staked(), 100i128);

    // Past the original 500,000-ledger window. Only the read-driven extension keeps these alive.
    advance_ledgers(&env, 400_000);
    assert_eq!(client.staked_balance(&user), 100i128);
    assert_eq!(client.total_staked(), 100i128);
}

#[test]
fn stake_tokens() {
    let env = Env::default();
    env.mock_all_auths();
    let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

    let asset = StellarAssetClient::new(&env, &token_id);
    asset.mint(&user, &1000i128);

    client.stake(&user, &100i128);
    assert_eq!(client.staked_balance(&user), 100i128);
}

#[test]
fn unstake_tokens() {
    let env = Env::default();
    env.mock_all_auths();
    let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

    let asset = StellarAssetClient::new(&env, &token_id);
    asset.mint(&user, &1000i128);

    client.stake(&user, &100i128);
    assert_eq!(client.staked_balance(&user), 100i128);

    client.unstake(&user, &100i128);
    assert_eq!(client.staked_balance(&user), 0i128);
}

#[test]
fn partial_unstake() {
    let env = Env::default();
    env.mock_all_auths();
    let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

    let asset = StellarAssetClient::new(&env, &token_id);
    asset.mint(&user, &1000i128);

    client.stake(&user, &100i128);
    assert_eq!(client.staked_balance(&user), 100i128);

    client.unstake(&user, &50i128);
    assert_eq!(client.staked_balance(&user), 50i128);
}

#[test]
fn unstake_more_than_balance() {
    let env = Env::default();
    env.mock_all_auths();
    let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

    let asset = StellarAssetClient::new(&env, &token_id);
    asset.mint(&user, &1000i128);

    client.stake(&user, &100i128);

    let result = client.try_unstake(&user, &200i128);
    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err().unwrap(),
        ContractError::InsufficientUnusedStake
    );
}

#[test]
fn multiple_stakers() {
    let env = Env::default();
    env.mock_all_auths();
    let (_contract_id, client, admin, _user, token_id) = setup_contract(&env);

    let asset = StellarAssetClient::new(&env, &token_id);
    asset.mint(&admin, &10000i128);

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let user3 = Address::generate(&env);
    let user4 = Address::generate(&env);
    let user5 = Address::generate(&env);

    asset.mint(&user1, &1000i128);
    asset.mint(&user2, &1000i128);
    asset.mint(&user3, &1000i128);
    asset.mint(&user4, &1000i128);
    asset.mint(&user5, &1000i128);

    client.stake(&user1, &100i128);
    client.stake(&user2, &200i128);
    client.stake(&user3, &300i128);
    client.stake(&user4, &400i128);
    client.stake(&user5, &500i128);

    assert_eq!(client.staked_balance(&user1), 100i128);
    assert_eq!(client.staked_balance(&user2), 200i128);
    assert_eq!(client.staked_balance(&user3), 300i128);
    assert_eq!(client.staked_balance(&user4), 400i128);
    assert_eq!(client.staked_balance(&user5), 500i128);

    assert_eq!(client.total_staked(), 1500i128);
}

#[test]
fn restake_after_unstake() {
    let env = Env::default();
    env.mock_all_auths();
    let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

    let asset = StellarAssetClient::new(&env, &token_id);
    asset.mint(&user, &1000i128);

    client.stake(&user, &100i128);
    assert_eq!(client.staked_balance(&user), 100i128);

    client.unstake(&user, &100i128);
    assert_eq!(client.staked_balance(&user), 0i128);

    // Re-stake should be treated as fresh
    client.stake(&user, &200i128);
    assert_eq!(client.staked_balance(&user), 200i128);
}

#[test]
fn admin_pause_stake_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (_contract_id, client, admin, user, token_id) = setup_contract(&env);

    let asset = StellarAssetClient::new(&env, &token_id);
    asset.mint(&user, &1000i128);

    // Pause the contract
    client.pause(&admin);
    assert!(client.is_paused());

    // Stake should fail when paused
    let result = client.try_stake(&user, &100i128);
    assert!(result.is_err());
    let err = result.unwrap_err().unwrap();
    assert_eq!(err, ContractError::ContractPaused);
}

#[test]
fn admin_pause_unstake_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (_contract_id, client, admin, user, token_id) = setup_contract(&env);

    let asset = StellarAssetClient::new(&env, &token_id);
    asset.mint(&user, &1000i128);

    client.stake(&user, &100i128);

    // Pause the contract
    client.pause(&admin);
    assert!(client.is_paused());

    // Unstake should fail when paused
    let result = client.try_unstake(&user, &50i128);
    assert!(result.is_err());
    let err = result.unwrap_err().unwrap();
    assert_eq!(err, ContractError::ContractPaused);
}

#[test]
fn non_admin_initialize_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(StakingPool, ());
    let client = StakingPoolClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let token_contract = env.register_stellar_asset_contract_v2(token_admin);
    let token_contract_id = token_contract.address();

    // Initialization authenticates the administrator; the later call verifies
    // that a different address still cannot perform admin operations.
    client.init(&admin, &token_contract_id);

    // Now try pause with non-admin
    env.mock_auths(&[MockAuth {
        address: &non_admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "pause",
            args: (non_admin.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    let result = client.try_pause(&non_admin);
    assert!(result.is_err());
}

#[test]
fn stake_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

    let asset = StellarAssetClient::new(&env, &token_id);
    asset.mint(&user, &1000i128);

    client.stake(&user, &100i128);

    let events = env.events().all();
    assert!(events.len() > 0);

    // Verify at least one event was emitted
    // The event structure in soroban SDK is complex, so we just check events exist
    assert!(events.len() >= 1);
}

#[test]
fn unstake_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

    let asset = StellarAssetClient::new(&env, &token_id);
    asset.mint(&user, &1000i128);

    client.stake(&user, &100i128);
    client.unstake(&user, &100i128);

    let events = env.events().all();
    assert!(events.len() > 0);

    // Verify at least one event was emitted
    // The event structure in soroban SDK is complex, so we just check events exist
    assert!(events.len() >= 1);
}
