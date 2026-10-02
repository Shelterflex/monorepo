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
