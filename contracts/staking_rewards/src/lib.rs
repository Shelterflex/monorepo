#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

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
    pub fn stake(env: Env, user: Address, amount: i128) {
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
    }

    pub fn distribute_rewards(env: Env, amount: i128) {
        let total = Self::get_total_staked(&env);
        if total == 0 {
            return;
        }

        let reward_index = Self::get_reward_index(&env);
        let new_index = reward_index + (amount * SCALE / total);
        env.storage().persistent().set(&REWARD_INDEX, &new_index);
    }

    pub fn claim(env: Env, user: Address) -> i128 {
        user.require_auth();

        let mut user_stake = Self::get_user_stake(&env, &user);
        let reward_index = Self::get_reward_index(&env);

        let claimable = Self::calc_pending(&user_stake, reward_index);
        user_stake.user_index = reward_index;

        env.storage().persistent().set(&user, &user_stake);
        claimable
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
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_two_users_different_times() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(StakingRewards, ());
        let client = StakingRewardsClient::new(&env, &contract_id);

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
        env.mock_all_auths();
        let contract_id = env.register(StakingRewards, ());
        let client = StakingRewardsClient::new(&env, &contract_id);

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
        env.mock_all_auths();
        let contract_id = env.register(StakingRewards, ());
        let client = StakingRewardsClient::new(&env, &contract_id);

        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);

        client.stake(&user1, &3000);
        client.stake(&user2, &1000);
        client.distribute_rewards(&4000);

        assert_eq!(client.get_claimable(&user1), 3000);
        assert_eq!(client.get_claimable(&user2), 1000);
    }
}
