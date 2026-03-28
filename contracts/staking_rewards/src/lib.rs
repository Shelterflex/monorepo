#![no_std]
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, Symbol};

#[contracttype]
#[derive(Clone)]
pub enum StorageKey {
    ContractVersion,
    Admin,
    Operator,
    Paused,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    Paused = 3,
}

#[contracttype]
#[derive(Clone)]
pub struct UserStake {
    pub amount: i128,
    pub user_index: i128,
}

const REWARD_INDEX: &str = "REWARD_IDX";
const TOTAL_STAKED: &str = "TOTAL_STK";
const SCALE: i128 = 1_000_000_000;

#[contract]
pub struct StakingRewards;

#[contractimpl]
impl StakingRewards {
    pub fn init(env: Env, admin: Address) -> Result<(), ContractError> {
        if env.storage().instance().has(&StorageKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }

        env.storage().instance().set(&StorageKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&StorageKey::ContractVersion, &1u32);
        env.storage().instance().set(&StorageKey::Paused, &false);

        Ok(())
    }

    pub fn contract_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get::<_, u32>(&StorageKey::ContractVersion)
            .unwrap_or(0u32)
    }

    pub fn version(env: Env) -> u32 {
        Self::contract_version(env)
    }

    pub fn admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get::<_, Address>(&StorageKey::Admin)
            .unwrap()
    }

    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), ContractError> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&StorageKey::Admin, &new_admin);
        Ok(())
    }

    pub fn add_operator(env: Env, operator: Address) -> Result<(), ContractError> {
        Self::require_admin(&env)?;
        env.storage()
            .instance()
            .set(&StorageKey::Operator, &operator);

        env.events().publish(
            (
                Symbol::new(&env, "staking_rewards"),
                Symbol::new(&env, "add_operator"),
            ),
            operator,
        );

        Ok(())
    }

    pub fn remove_operator(env: Env) -> Result<(), ContractError> {
        Self::require_admin(&env)?;
        let operator = env
            .storage()
            .instance()
            .get::<_, Address>(&StorageKey::Operator);
        env.storage().instance().remove(&StorageKey::Operator);

        if let Some(op) = operator {
            env.events().publish(
                (
                    Symbol::new(&env, "staking_rewards"),
                    Symbol::new(&env, "remove_operator"),
                ),
                op,
            );
        }

        Ok(())
    }

    pub fn is_operator(env: Env, address: Address) -> bool {
        env.storage()
            .instance()
            .get::<_, Address>(&StorageKey::Operator)
            .map(|op| op == address)
            .unwrap_or(false)
    }

    pub fn pause(env: Env) -> Result<(), ContractError> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&StorageKey::Paused, &true);

        env.events().publish(
            (
                Symbol::new(&env, "staking_rewards"),
                Symbol::new(&env, "pause"),
            ),
            (),
        );

        Ok(())
    }

    pub fn unpause(env: Env) -> Result<(), ContractError> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&StorageKey::Paused, &false);

        env.events().publish(
            (
                Symbol::new(&env, "staking_rewards"),
                Symbol::new(&env, "unpause"),
            ),
            (),
        );

        Ok(())
    }

    pub fn is_paused(env: &Env) -> bool {
        env.storage()
            .instance()
            .get::<_, bool>(&StorageKey::Paused)
            .unwrap_or(false)
    }

    fn require_admin(env: &Env) -> Result<(), ContractError> {
        let admin = env
            .storage()
            .instance()
            .get::<_, Address>(&StorageKey::Admin);

        if let Some(admin_addr) = admin {
            admin_addr.require_auth();
            Ok(())
        } else {
            Err(ContractError::NotAuthorized)
        }
    }

    fn require_operator(env: &Env) -> Result<(), ContractError> {
        let operator = env
            .storage()
            .instance()
            .get::<_, Address>(&StorageKey::Operator);

        if let Some(op_addr) = operator {
            op_addr.require_auth();
            Ok(())
        } else {
            Err(ContractError::NotAuthorized)
        }
    }

    fn require_not_paused(env: &Env) -> Result<(), ContractError> {
        if Self::is_paused(env) {
            Err(ContractError::Paused)
        } else {
            Ok(())
        }
    }

    pub fn stake(env: Env, user: Address, amount: i128) -> Result<(), ContractError> {
        Self::require_not_paused(&env)?;
        user.require_auth();

        let mut user_stake = Self::get_user_stake(&env, &user);
        let reward_index = Self::get_reward_index(&env);

        user_stake.amount += amount;
        user_stake.user_index = reward_index;

        env.storage().persistent().set(&user, &user_stake);

        let total = Self::get_total_staked(&env);
        env.storage()
            .persistent()
            .set(&TOTAL_STAKED, &(total + amount));

        env.events().publish(
            (
                Symbol::new(&env, "staking_rewards"),
                Symbol::new(&env, "stake"),
            ),
            (user, amount),
        );

        Ok(())
    }

    pub fn unstake(env: Env, user: Address, amount: i128) -> Result<(), ContractError> {
        Self::require_not_paused(&env)?;
        user.require_auth();

        let mut user_stake = Self::get_user_stake(&env, &user);

        if user_stake.amount < amount {
            panic!("Insufficient staked amount");
        }

        user_stake.amount -= amount;

        env.storage().persistent().set(&user, &user_stake);

        let total = Self::get_total_staked(&env);
        env.storage()
            .persistent()
            .set(&TOTAL_STAKED, &(total - amount));

        env.events().publish(
            (
                Symbol::new(&env, "staking_rewards"),
                Symbol::new(&env, "unstake"),
            ),
            (user, amount),
        );

        Ok(())
    }

    pub fn fund_rewards(env: Env, amount: i128) -> Result<(), ContractError> {
        Self::require_not_paused(&env)?;
        Self::require_operator(&env)?;

        let total = Self::get_total_staked(&env);
        if total == 0 {
            return Ok(());
        }

        let reward_index = Self::get_reward_index(&env);
        let new_index = reward_index + (amount * SCALE / total);
        env.storage().persistent().set(&REWARD_INDEX, &new_index);

        env.events().publish(
            (
                Symbol::new(&env, "staking_rewards"),
                Symbol::new(&env, "fund_rewards"),
            ),
            amount,
        );

        Ok(())
    }

    pub fn distribute_rewards(env: Env, amount: i128) -> Result<(), ContractError> {
        Self::require_not_paused(&env)?;
        Self::require_admin(&env)?;

        let total = Self::get_total_staked(&env);
        if total == 0 {
            return Ok(());
        }

        let reward_index = Self::get_reward_index(&env);
        let new_index = reward_index + (amount * SCALE / total);
        env.storage().persistent().set(&REWARD_INDEX, &new_index);

        env.events().publish(
            (
                Symbol::new(&env, "staking_rewards"),
                Symbol::new(&env, "distribute_rewards"),
            ),
            amount,
        );

        Ok(())
    }

    pub fn claim(env: Env, user: Address) -> Result<i128, ContractError> {
        Self::require_not_paused(&env)?;
        user.require_auth();

        let mut user_stake = Self::get_user_stake(&env, &user);
        let reward_index = Self::get_reward_index(&env);

        let claimable = Self::calc_pending(&user_stake, reward_index);
        user_stake.user_index = reward_index;

        env.storage().persistent().set(&user, &user_stake);

        env.events().publish(
            (
                Symbol::new(&env, "staking_rewards"),
                Symbol::new(&env, "claim"),
            ),
            (user, claimable),
        );

        Ok(claimable)
    }

    pub fn get_claimable(env: Env, user: Address) -> i128 {
        let user_stake = Self::get_user_stake(&env, &user);
        let reward_index = Self::get_reward_index(&env);
        Self::calc_pending(&user_stake, reward_index)
    }

    fn calc_pending(user_stake: &UserStake, reward_index: i128) -> i128 {
        user_stake.amount * (reward_index - user_stake.user_index) / SCALE
    }

    fn get_user_stake(env: &Env, user: &Address) -> UserStake {
        env.storage().persistent().get(user).unwrap_or(UserStake {
            amount: 0,
            user_index: 0,
        })
    }

    fn get_reward_index(env: &Env) -> i128 {
        env.storage().persistent().get(&REWARD_INDEX).unwrap_or(0)
    }

    fn get_total_staked(env: &Env) -> i128 {
        env.storage().persistent().get(&TOTAL_STAKED).unwrap_or(0)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env, IntoVal};

    fn setup(env: &Env) -> (soroban_sdk::Address, StakingRewardsClient<'_>) {
        env.mock_all_auths();
        let contract_id = env.register(StakingRewards, ());
        let client = StakingRewardsClient::new(env, &contract_id);

        let admin = Address::generate(env);
        client.try_init(&admin).unwrap().unwrap();

        assert_eq!(client.contract_version(), 1u32);

        (contract_id, client)
    }

    #[test]
    fn version_matches_contract_version() {
        let env = Env::default();
        let (_contract_id, client) = setup(&env);
        assert_eq!(client.version(), 1u32);
        assert_eq!(client.version(), client.contract_version());
    }

    #[test]
    fn test_two_users_different_times() {
        let env = Env::default();
        let (_contract_id, client) = setup(&env);

        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);

        client.stake(&user1, &1000);
        client.distribute_rewards(&500);
        client.stake(&user2, &1000);
        client.distribute_rewards(&1000);

        assert_eq!(client.get_claimable(&user1), 1000);
        assert_eq!(client.get_claimable(&user2), 500);
    }

    #[test]
    fn test_claim_does_not_affect_others() {
        let env = Env::default();
        let (_contract_id, client) = setup(&env);

        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);

        client.stake(&user1, &1000);
        client.stake(&user2, &1000);
        client.distribute_rewards(&1000);

        let before = client.get_claimable(&user2);
        client.claim(&user1);
        let after = client.get_claimable(&user2);

        assert_eq!(before, 500);
        assert_eq!(after, 500);
    }

    #[test]
    fn test_rewards_distributed_fairly() {
        let env = Env::default();
        let (_contract_id, client) = setup(&env);

        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);

        client.stake(&user1, &3000);
        client.stake(&user2, &1000);
        client.distribute_rewards(&4000);

        assert_eq!(client.get_claimable(&user1), 3000);
        assert_eq!(client.get_claimable(&user2), 1000);
    }

    #[test]
    fn admin_can_set_admin() {
        let env = Env::default();
        env.mock_all_auths(); // Initial setup uses mock_all_auths in init
        let contract_id = env.register(StakingRewards, ());
        let client = StakingRewardsClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.init(&admin);
        let new_admin = Address::generate(&env);

        env.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &admin,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_admin",
                args: (new_admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.set_admin(&new_admin);
        assert_eq!(client.admin(), new_admin);

        env.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &new_admin,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &contract_id,
                fn_name: "pause",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.pause();
        assert!(client.is_paused());
    }

    #[test]
    #[should_panic(expected = "HostError")]
    fn old_admin_loses_permissions() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(StakingRewards, ());
        let client = StakingRewardsClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.init(&admin);
        let new_admin = Address::generate(&env);

        env.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &admin,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_admin",
                args: (new_admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.set_admin(&new_admin);

        // Old admin should lose permissions
        env.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &admin,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &contract_id,
                fn_name: "unpause",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.unpause();
    }

    #[test]
    #[should_panic(expected = "HostError")]
    fn non_admin_cannot_add_operator() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(StakingRewards, ());
        let client = StakingRewardsClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.init(&admin);

        let non_admin = Address::generate(&env);
        let operator = Address::generate(&env);

        env.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &non_admin,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &contract_id,
                fn_name: "add_operator",
                args: (operator.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.add_operator(&operator);
    }

    #[test]
    fn admin_can_add_operator() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(StakingRewards, ());
        let client = StakingRewardsClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.init(&admin);

        let operator = Address::generate(&env);

        env.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &admin,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &contract_id,
                fn_name: "add_operator",
                args: (operator.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.add_operator(&operator);
        assert!(client.is_operator(&operator));
    }

    #[test]
    fn admin_can_remove_operator() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(StakingRewards, ());
        let client = StakingRewardsClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.init(&admin);

        let operator = Address::generate(&env);

        // Add operator first
        env.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &admin,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &contract_id,
                fn_name: "add_operator",
                args: (operator.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.add_operator(&operator);
        assert!(client.is_operator(&operator));

        // Now remove operator
        env.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &admin,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &contract_id,
                fn_name: "remove_operator",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.remove_operator();
        assert!(!client.is_operator(&operator));
    }

    #[test]
    #[should_panic(expected = "HostError")]
    fn non_admin_cannot_remove_operator() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(StakingRewards, ());
        let client = StakingRewardsClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.init(&admin);

        let non_admin = Address::generate(&env);
        let operator = Address::generate(&env);

        // Add operator first
        env.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &admin,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &contract_id,
                fn_name: "add_operator",
                args: (operator.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.add_operator(&operator);

        // Try to remove with non-admin
        env.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &non_admin,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &contract_id,
                fn_name: "remove_operator",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.remove_operator();
    }

    #[test]
    fn operator_can_fund_rewards() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(StakingRewards, ());
        let client = StakingRewardsClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.init(&admin);

        let operator = Address::generate(&env);
        let user = Address::generate(&env);

        // Add operator
        env.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &admin,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &contract_id,
                fn_name: "add_operator",
                args: (operator.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.add_operator(&operator);

        // Stake some tokens
        env.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &user,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &contract_id,
                fn_name: "stake",
                args: (user.clone(), 1000i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.stake(&user, &1000);

        // Operator funds rewards
        env.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &operator,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &contract_id,
                fn_name: "fund_rewards",
                args: (500i128,).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.fund_rewards(&500);

        // Verify rewards were added
        assert_eq!(client.get_claimable(&user), 500);
    }

    #[test]
    #[should_panic(expected = "HostError")]
    fn non_operator_cannot_fund_rewards() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(StakingRewards, ());
        let client = StakingRewardsClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.init(&admin);

        let non_operator = Address::generate(&env);
        let user = Address::generate(&env);

        // Stake some tokens
        client.stake(&user, &1000);

        // Non-operator tries to fund rewards
        env.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &non_operator,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &contract_id,
                fn_name: "fund_rewards",
                args: (500i128,).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.fund_rewards(&500);
    }

    #[test]
    #[should_panic(expected = "HostError")]
    fn removed_operator_cannot_fund_rewards() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(StakingRewards, ());
        let client = StakingRewardsClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.init(&admin);

        let operator = Address::generate(&env);
        let user = Address::generate(&env);

        // Add operator
        env.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &admin,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &contract_id,
                fn_name: "add_operator",
                args: (operator.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.add_operator(&operator);

        // Remove operator
        env.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &admin,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &contract_id,
                fn_name: "remove_operator",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.remove_operator();

        // Stake some tokens
        client.stake(&user, &1000);

        // Removed operator tries to fund rewards
        env.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &operator,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &contract_id,
                fn_name: "fund_rewards",
                args: (500i128,).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.fund_rewards(&500);
    }
}
