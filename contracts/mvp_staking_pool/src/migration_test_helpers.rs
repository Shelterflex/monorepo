extern crate std;

use super::{
    get_claimable_reward, get_global_reward_index, get_staked_balance, get_total_staked,
    StakingPool, StakingPoolClient,
};
use soroban_sdk::{
    testutils::Address as _, token::StellarAssetClient, Address, Env, Map, String, Vec,
};
use std::format;

pub const MAX_CAPACITY_USERS: u32 = 1_000;
pub const EXTREME_STAKE_VALUE: i128 = i128::MAX / 32;

#[derive(Clone)]
pub struct TestData {
    pub users: Vec<Address>,
    pub stakes: Map<Address, i128>,
    pub claimable_rewards: Map<Address, i128>,
    pub total_staked: i128,
    pub global_reward_index: i128,
}

pub struct TestContract<'a> {
    pub contract_id: Address,
    pub client: StakingPoolClient<'a>,
    pub token: Address,
}

pub struct IntegrityReport {
    pub passed: bool,
    pub issues: Vec<String>,
    pub verification_time: u64,
    pub total_users_checked: u32,
    pub total_stake_verified: i128,
}

pub fn setup_test_contract(env: &Env) -> TestContract<'_> {
    create_test_contract(env, 2) // Default to version 2 for current tests
}

/// Creates a test contract with a specific version for migration scenarios.
/// This function allows migration tests to create contracts with different versions
/// to test version-specific migration logic.
pub fn create_test_contract(env: &Env, version: u32) -> TestContract<'_> {
    env.mock_all_auths();
    let contract_id = env.register(StakingPool, ());
    let client = StakingPoolClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();

    client.init(&admin, &token);

    // Set the contract version for migration testing
    env.as_contract(&contract_id, || {
        env.storage()
            .instance()
            .set(&super::DataKey::ContractVersion, &version);
    });

    TestContract {
        contract_id,
        client,
        token,
    }
}

pub fn seed_contract_with_data(env: &Env, contract: &TestContract<'_>, data: &TestData) {
    let token_client = StellarAssetClient::new(env, &contract.token);

    env.mock_all_auths();

    for user in data.users.iter() {
        let stake = data.stakes.get(user.clone()).unwrap_or(0);
        if stake > 0 {
            token_client.mint(&user, &stake);
            contract.client.stake(&user, &stake);
        }
    }
}

pub mod test_scenarios {
    use super::*;

    fn push_user(data: &mut TestData, user: Address, stake: i128) {
        data.users.push_back(user.clone());
        data.stakes.set(user, stake);
        data.total_staked = data
            .total_staked
            .checked_add(stake)
            .expect("test scenario total must not overflow");
    }

    pub fn create_empty_contract_scenario(env: &Env) -> TestData {
        TestData {
            users: Vec::new(env),
            stakes: Map::new(env),
            claimable_rewards: Map::new(env),
            total_staked: 0,
            global_reward_index: 0,
        }
    }

    pub fn create_single_user_scenario(env: &Env) -> TestData {
        let mut data = create_empty_contract_scenario(env);
        push_user(&mut data, Address::generate(env), 1_000);
        data
    }

    pub fn create_multi_user_scenario(env: &Env, num_users: u32) -> TestData {
        let mut data = create_empty_contract_scenario(env);

        for index in 0..num_users {
            let user = Address::generate(env);
            let stake_amount = (index as i128 + 1) * 1_000;
            push_user(&mut data, user, stake_amount);
        }

        data
    }

    pub fn create_max_capacity_scenario(env: &Env) -> TestData {
        create_multi_user_scenario(env, MAX_CAPACITY_USERS)
    }

    pub fn create_edge_case_scenario(env: &Env) -> TestData {
        let mut data = create_multi_user_scenario(env, 8);

        push_user(&mut data, Address::generate(env), 0);
        push_user(&mut data, Address::generate(env), 1);
        push_user(&mut data, Address::generate(env), EXTREME_STAKE_VALUE);

        data
    }
}

pub struct ContractStateSnapshot {
    pub total_staked: i128,
    pub global_reward_index: i128,
    pub user_stakes: Map<Address, i128>,
    pub user_rewards: Map<Address, i128>,
    pub ledger_timestamp: u64,
}

impl ContractStateSnapshot {
    pub fn capture(env: &Env, contract_id: &Address, users: &Vec<Address>) -> Self {
        let client = StakingPoolClient::new(env, contract_id);
        let total_staked = client.total_staked();
        let global_reward_index = env.as_contract(contract_id, || get_global_reward_index(env));

        let mut user_stakes = Map::new(env);
        let mut user_rewards = Map::new(env);

        for user in users.iter() {
            let stake = env.as_contract(contract_id, || get_staked_balance(env, &user));
            let reward = env.as_contract(contract_id, || get_claimable_reward(env, &user));
            user_stakes.set(user.clone(), stake);
            user_rewards.set(user.clone(), reward);
        }

        ContractStateSnapshot {
            total_staked,
            global_reward_index,
            user_stakes,
            user_rewards,
            ledger_timestamp: env.ledger().timestamp(),
        }
    }
}

pub fn verify_state_integrity(
    env: &Env,
    contract_id: &Address,
    expected: &ContractStateSnapshot,
) -> IntegrityReport {
    let actual = ContractStateSnapshot::capture(env, contract_id, &expected.user_stakes.keys());
    let mut issues = Vec::new(env);
    let mut total_verified = 0i128;
    let mut user_index = 0u32;

    for user in expected.user_stakes.keys().iter() {
        let exp_stake = expected.user_stakes.get(user.clone()).unwrap_or(0);
        let act_stake = actual.user_stakes.get(user.clone()).unwrap_or(0);
        if act_stake != exp_stake {
            let message = std::format!(
                "user {} stake mismatch: expected {}, found {}",
                user_index,
                exp_stake,
                act_stake
            );
            issues.push_back(String::from_str(env, &message));
        }

        total_verified = total_verified.checked_add(act_stake).unwrap_or_else(|| {
            issues.push_back(String::from_str(
                env,
                "stake total overflow in verify_state_integrity",
            ));
            total_verified
        });

        let exp_reward = expected.user_rewards.get(user.clone()).unwrap_or(0);
        let act_reward = actual.user_rewards.get(user.clone()).unwrap_or(0);
        if act_reward != exp_reward {
            let message = std::format!(
                "user {} reward mismatch: expected {}, found {}",
                user_index,
                exp_reward,
                act_reward
            );
            issues.push_back(String::from_str(env, &message));
        }

        user_index += 1;
    }

    if actual.total_staked != expected.total_staked {
        let message = std::format!(
            "total staked mismatch: expected {}, found {}",
            expected.total_staked,
            actual.total_staked
        );
        issues.push_back(String::from_str(env, &message));
    }

    if actual.global_reward_index != expected.global_reward_index {
        let message = std::format!(
            "global reward index mismatch: expected {}, found {}",
            expected.global_reward_index,
            actual.global_reward_index
        );
        issues.push_back(String::from_str(env, &message));
    }

    IntegrityReport {
        passed: issues.is_empty(),
        issues,
        verification_time: actual.ledger_timestamp,
        total_users_checked: user_index,
        total_stake_verified: total_verified,
    }
}

pub fn verify_storage_integrity(
    env: &Env,
    contract_id: &Address,
    expected_data: &TestData,
) -> IntegrityReport {
    let client = StakingPoolClient::new(env, contract_id);
    let mut issues = Vec::new(env);
    let mut seen_users = Map::new(env);
    let mut total_calculated = 0i128;
    let mut user_index = 0u32;

    let actual_total_staked = client.total_staked();
    let actual_global_reward_index = env.as_contract(contract_id, || get_global_reward_index(env));

    for user in expected_data.users.iter() {
        if seen_users.contains_key(user.clone()) {
            issues.push_back(String::from_str(
                env,
                "duplicate user found in migration scenario",
            ));
            continue;
        }
        seen_users.set(user.clone(), true);

        let expected_stake = expected_data.stakes.get(user.clone()).unwrap_or(0);
        let actual_stake = env.as_contract(contract_id, || get_staked_balance(env, &user));
        if actual_stake != expected_stake {
            let message = format!(
                "user {} stake mismatch: expected {}, found {}",
                user_index, expected_stake, actual_stake
            );
            issues.push_back(String::from_str(env, &message));
        }

        total_calculated = total_calculated
            .checked_add(expected_stake)
            .unwrap_or_else(|| {
                issues.push_back(String::from_str(
                    env,
                    "stake total overflow while verifying migration state",
                ));
                total_calculated
            });

        let expected_claimable = expected_data
            .claimable_rewards
            .get(user.clone())
            .unwrap_or(0);
        let actual_claimable = env.as_contract(contract_id, || get_claimable_reward(env, &user));
        if actual_claimable != expected_claimable {
            let message = format!(
                "user {} claimable mismatch: expected {}, found {}",
                user_index, expected_claimable, actual_claimable
            );
            issues.push_back(String::from_str(env, &message));
        }

        user_index += 1;
    }

    if total_calculated != expected_data.total_staked {
        let message = format!(
            "scenario total mismatch: expected {}, calculated {}",
            expected_data.total_staked, total_calculated
        );
        issues.push_back(String::from_str(env, &message));
    }

    if actual_total_staked != expected_data.total_staked {
        let message = format!(
            "contract total mismatch: expected {}, found {}",
            expected_data.total_staked, actual_total_staked
        );
        issues.push_back(String::from_str(env, &message));
    }

    let direct_total_staked = env.as_contract(contract_id, || get_total_staked(env));
    if direct_total_staked != actual_total_staked {
        let message = format!(
            "client/storage total mismatch: client {}, storage {}",
            actual_total_staked, direct_total_staked
        );
        issues.push_back(String::from_str(env, &message));
    }

    if actual_global_reward_index != expected_data.global_reward_index {
        let message = format!(
            "global reward index mismatch: expected {}, found {}",
            expected_data.global_reward_index, actual_global_reward_index
        );
        issues.push_back(String::from_str(env, &message));
    }

    IntegrityReport {
        passed: issues.is_empty(),
        issues,
        verification_time: env.ledger().timestamp(),
        total_users_checked: expected_data.users.len(),
        total_stake_verified: total_calculated,
    }
}
