#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, Symbol};

// ── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Operator,
    /// Monotonically incrementing epoch counter
    CurrentEpoch,
    /// Epoch metadata keyed by epoch number
    Epoch(u64),
    /// Unclaimed reward balance per user (carries forward across epochs)
    UnclaimedRewards(Address),
    /// Reward index snapshot at the time of each epoch seal
    EpochRewardIndex(u64),
    /// Global reward index (scaled by SCALE)
    RewardIndex,
    /// Total staked across all users
    TotalStaked,
    /// Per-user stake info
    UserStake(Address),
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SCALE: i128 = 1_000_000_000;

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    InvalidAmount = 3,
    /// Epoch is already sealed
    EpochAlreadySealed = 4,
    /// Attempted to seal an epoch that does not exist
    EpochNotFound = 5,
    /// Epoch seal attempted out of expected order
    OutOfOrderSealing = 6,
    /// Epoch duration has not elapsed yet
    EpochNotExpired = 7,
}

// ── Data Structures ───────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct EpochInfo {
    pub epoch_number: u64,
    pub start_ts: u64,
    /// Minimum duration in seconds before this epoch can be sealed
    pub duration_secs: u64,
    pub end_ts: u64,  // 0 until sealed
    pub seal_ts: u64, // 0 until sealed
    pub sealed: bool,
    /// Total rewards allocated in this epoch
    pub total_rewards: i128,
    /// Unclaimed rewards carried in from previous epoch
    pub carried_forward: i128,
    /// Reward index snapshot at seal time
    pub reward_index_at_seal: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct UserStake {
    pub amount: i128,
    pub user_reward_index: i128,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct EpochRewards;

#[contractimpl]
impl EpochRewards {
    // ── Init ──────────────────────────────────────────────────────────────────

    /// Initialize the contract and start epoch 1.
    pub fn init(env: Env, admin: Address, epoch_duration_secs: u64) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::CurrentEpoch, &1u64);
        env.storage()
            .persistent()
            .set(&DataKey::RewardIndex, &0i128);
        env.storage()
            .persistent()
            .set(&DataKey::TotalStaked, &0i128);

        // Initialise epoch 1
        let epoch1 = EpochInfo {
            epoch_number: 1,
            start_ts: env.ledger().timestamp(),
            duration_secs: epoch_duration_secs,
            end_ts: 0,
            seal_ts: 0,
            sealed: false,
            total_rewards: 0,
            carried_forward: 0,
            reward_index_at_seal: 0,
        };
        env.storage().persistent().set(&DataKey::Epoch(1), &epoch1);

        env.events().publish(
            (
                Symbol::new(&env, "epoch_rewards"),
                Symbol::new(&env, "init"),
            ),
            (admin, epoch_duration_secs),
        );
        Ok(())
    }

    // ── Admin helpers ─────────────────────────────────────────────────────────

    fn require_admin(env: &Env, caller: &Address) -> Result<(), ContractError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotAuthorized)?;
        caller.require_auth();
        if caller != &admin {
            return Err(ContractError::NotAuthorized);
        }
        Ok(())
    }

    pub fn set_operator(env: Env, admin: Address, operator: Address) -> Result<(), ContractError> {
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Operator, &operator);
        Ok(())
    }

    fn require_operator_or_admin(env: &Env, caller: &Address) -> Result<(), ContractError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotAuthorized)?;
        if caller == &admin {
            caller.require_auth();
            return Ok(());
        }
        let operator: Option<Address> = env.storage().instance().get(&DataKey::Operator);
        if let Some(op) = operator {
            if caller == &op {
                caller.require_auth();
                return Ok(());
            }
        }
        Err(ContractError::NotAuthorized)
    }

    // ── Staking interface ─────────────────────────────────────────────────────

    pub fn stake(env: Env, user: Address, amount: i128) -> Result<(), ContractError> {
        user.require_auth();
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let reward_index = Self::get_reward_index(&env);
        let mut stake = Self::get_user_stake(&env, &user);

        // Settle any pending rewards before updating stake
        let pending = Self::calc_pending(&stake, reward_index);
        if pending > 0 {
            let prev: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::UnclaimedRewards(user.clone()))
                .unwrap_or(0);
            env.storage()
                .persistent()
                .set(&DataKey::UnclaimedRewards(user.clone()), &(prev + pending));
        }

        stake.amount += amount;
        stake.user_reward_index = reward_index;
        env.storage()
            .persistent()
            .set(&DataKey::UserStake(user.clone()), &stake);

        let total = Self::get_total_staked(&env);
        env.storage()
            .persistent()
            .set(&DataKey::TotalStaked, &(total + amount));

        env.events().publish(
            (
                Symbol::new(&env, "epoch_rewards"),
                Symbol::new(&env, "stake"),
                user,
            ),
            amount,
        );
        Ok(())
    }

    pub fn unstake(env: Env, user: Address, amount: i128) -> Result<(), ContractError> {
        user.require_auth();
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let reward_index = Self::get_reward_index(&env);
        let mut stake = Self::get_user_stake(&env, &user);

        if stake.amount < amount {
            return Err(ContractError::InvalidAmount);
        }

        // Settle pending rewards
        let pending = Self::calc_pending(&stake, reward_index);
        if pending > 0 {
            let prev: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::UnclaimedRewards(user.clone()))
                .unwrap_or(0);
            env.storage()
                .persistent()
                .set(&DataKey::UnclaimedRewards(user.clone()), &(prev + pending));
        }

        stake.amount -= amount;
        stake.user_reward_index = reward_index;
        env.storage()
            .persistent()
            .set(&DataKey::UserStake(user.clone()), &stake);

        let total = Self::get_total_staked(&env);
        env.storage()
            .persistent()
            .set(&DataKey::TotalStaked, &(total - amount));

        env.events().publish(
            (
                Symbol::new(&env, "epoch_rewards"),
                Symbol::new(&env, "unstake"),
                user,
            ),
            amount,
        );
        Ok(())
    }

    // ── Reward funding ────────────────────────────────────────────────────────

    /// Fund rewards for the current epoch (operator or admin only).
    pub fn fund_epoch_rewards(
        env: Env,
        caller: Address,
        amount: i128,
    ) -> Result<(), ContractError> {
        Self::require_operator_or_admin(&env, &caller)?;
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let total = Self::get_total_staked(&env);
        if total > 0 {
            let reward_index = Self::get_reward_index(&env);
            let new_index = reward_index + (amount * SCALE / total);
            env.storage()
                .persistent()
                .set(&DataKey::RewardIndex, &new_index);
        }

        // Track total rewards for the current epoch
        let current_epoch: u64 = env
            .storage()
            .instance()
            .get(&DataKey::CurrentEpoch)
            .unwrap_or(1);
        if let Some(mut epoch) = env
            .storage()
            .persistent()
            .get::<_, EpochInfo>(&DataKey::Epoch(current_epoch))
        {
            epoch.total_rewards += amount;
            env.storage()
                .persistent()
                .set(&DataKey::Epoch(current_epoch), &epoch);
        }

        env.events().publish(
            (
                Symbol::new(&env, "epoch_rewards"),
                Symbol::new(&env, "fund"),
            ),
            (caller, amount),
        );
        Ok(())
    }

    // ── Epoch sealing ─────────────────────────────────────────────────────────

    /// Seal the current epoch (or catch up missed epochs).
    ///
    /// `target_epoch` must be the current unsealed epoch. Call repeatedly to
    /// catch up if the keeper missed a sealing window.
    pub fn seal_epoch(
        env: Env,
        caller: Address,
        target_epoch: u64,
        next_epoch_duration_secs: u64,
    ) -> Result<(), ContractError> {
        Self::require_operator_or_admin(&env, &caller)?;

        let current_epoch: u64 = env
            .storage()
            .instance()
            .get(&DataKey::CurrentEpoch)
            .unwrap_or(1);

        if target_epoch != current_epoch {
            return Err(ContractError::OutOfOrderSealing);
        }

        let mut epoch: EpochInfo = env
            .storage()
            .persistent()
            .get(&DataKey::Epoch(target_epoch))
            .ok_or(ContractError::EpochNotFound)?;

        if epoch.sealed {
            return Err(ContractError::EpochAlreadySealed);
        }

        let now = env.ledger().timestamp();
        if now < epoch.start_ts + epoch.duration_secs {
            return Err(ContractError::EpochNotExpired);
        }

        // Snapshot reward index at seal time
        let reward_index_at_seal = Self::get_reward_index(&env);

        // Determine unclaimed rewards to carry forward.
        // "Unclaimed" in the rewards index model means the global index accumulated
        // rewards that are owed to stakers but not yet claimed.  We carry the epoch's
        // total_rewards that were funded but not yet claimed by summing epoch state.
        // Simplified: carry_forward = previously carried + this epoch total_rewards
        // (actual per-user accounting is lazy via reward index).
        let carry_forward = epoch.carried_forward + epoch.total_rewards;

        // Seal this epoch
        epoch.end_ts = now;
        epoch.seal_ts = now;
        epoch.sealed = true;
        epoch.reward_index_at_seal = reward_index_at_seal;
        env.storage()
            .persistent()
            .set(&DataKey::Epoch(target_epoch), &epoch);

        // Advance epoch counter and open next epoch
        let next_epoch = current_epoch + 1;
        env.storage()
            .instance()
            .set(&DataKey::CurrentEpoch, &next_epoch);

        let next_epoch_info = EpochInfo {
            epoch_number: next_epoch,
            start_ts: epoch.start_ts + epoch.duration_secs,
            duration_secs: next_epoch_duration_secs,
            end_ts: 0,
            seal_ts: 0,
            sealed: false,
            total_rewards: 0,
            carried_forward: carry_forward,
            reward_index_at_seal: 0,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Epoch(next_epoch), &next_epoch_info);

        // Emit epoch-sealed event
        env.events().publish(
            (
                Symbol::new(&env, "epoch_rewards"),
                Symbol::new(&env, "epoch_sealed"),
            ),
            (target_epoch, now, reward_index_at_seal, epoch.total_rewards),
        );

        // Emit carry-forward event if non-zero
        if carry_forward > 0 {
            env.events().publish(
                (
                    Symbol::new(&env, "epoch_rewards"),
                    Symbol::new(&env, "carry_forward"),
                ),
                (target_epoch, next_epoch, carry_forward),
            );
        }

        Ok(())
    }

    // ── Claim ─────────────────────────────────────────────────────────────────

    pub fn claim(env: Env, user: Address) -> Result<i128, ContractError> {
        user.require_auth();

        let reward_index = Self::get_reward_index(&env);
        let mut stake = Self::get_user_stake(&env, &user);

        let live_pending = Self::calc_pending(&stake, reward_index);
        let banked: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UnclaimedRewards(user.clone()))
            .unwrap_or(0);

        let total_claimable = live_pending + banked;

        // Reset user index and clear banked rewards
        stake.user_reward_index = reward_index;
        env.storage()
            .persistent()
            .set(&DataKey::UserStake(user.clone()), &stake);
        env.storage()
            .persistent()
            .set(&DataKey::UnclaimedRewards(user.clone()), &0i128);

        env.events().publish(
            (
                Symbol::new(&env, "epoch_rewards"),
                Symbol::new(&env, "claim"),
                user,
            ),
            total_claimable,
        );

        Ok(total_claimable)
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    pub fn get_claimable(env: Env, user: Address) -> i128 {
        let reward_index = Self::get_reward_index(&env);
        let stake = Self::get_user_stake(&env, &user);
        let live = Self::calc_pending(&stake, reward_index);
        let banked: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UnclaimedRewards(user))
            .unwrap_or(0);
        live + banked
    }

    pub fn get_epoch(env: Env, epoch_number: u64) -> Option<EpochInfo> {
        env.storage()
            .persistent()
            .get(&DataKey::Epoch(epoch_number))
    }

    pub fn current_epoch(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::CurrentEpoch)
            .unwrap_or(1)
    }

    pub fn total_staked(env: Env) -> i128 {
        Self::get_total_staked(&env)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn get_reward_index(env: &Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::RewardIndex)
            .unwrap_or(0)
    }

    fn get_total_staked(env: &Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::TotalStaked)
            .unwrap_or(0)
    }

    fn get_user_stake(env: &Env, user: &Address) -> UserStake {
        env.storage()
            .persistent()
            .get(&DataKey::UserStake(user.clone()))
            .unwrap_or(UserStake {
                amount: 0,
                user_reward_index: 0,
            })
    }

    fn calc_pending(stake: &UserStake, reward_index: i128) -> i128 {
        if stake.amount == 0 {
            return 0;
        }
        stake.amount * (reward_index - stake.user_reward_index) / SCALE
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    extern crate std;

    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        Env,
    };

    fn setup(env: &Env, duration: u64) -> (Address, EpochRewardsClient<'_>) {
        env.mock_all_auths();
        let id = env.register(EpochRewards, ());
        let client = EpochRewardsClient::new(env, &id);
        let admin = Address::generate(env);
        client.init(&admin, &duration);
        (admin, client)
    }

    // ── Normal sealing ────────────────────────────────────────────────────────

    #[test]
    fn normal_epoch_seal() {
        let env = Env::default();
        let duration = 100u64;
        let (admin, client) = setup(&env, duration);

        let user = Address::generate(&env);
        client.stake(&user, &1_000);
        client.fund_epoch_rewards(&admin, &500);

        // Advance time past epoch duration
        env.ledger().with_mut(|li| li.timestamp = duration + 1);

        assert_eq!(client.current_epoch(), 1);
        client.seal_epoch(&admin, &1, &200);
        assert_eq!(client.current_epoch(), 2);

        let epoch1 = client.get_epoch(&1).unwrap();
        assert!(epoch1.sealed);
        assert_eq!(epoch1.total_rewards, 500);

        // Rewards are still claimable via reward index
        assert!(client.get_claimable(&user) > 0);
    }

    // ── Carry-forward ─────────────────────────────────────────────────────────

    #[test]
    fn unclaimed_rewards_carry_forward() {
        let env = Env::default();
        let duration = 100u64;
        let (admin, client) = setup(&env, duration);

        let user = Address::generate(&env);
        client.stake(&user, &1_000);
        client.fund_epoch_rewards(&admin, &1_000);

        env.ledger().with_mut(|li| li.timestamp = duration + 1);
        client.seal_epoch(&admin, &1, &100);

        let epoch2 = client.get_epoch(&2).unwrap();
        // Carry forward should be 1_000 (epoch 1 total_rewards)
        assert_eq!(epoch2.carried_forward, 1_000);
    }

    // ── Missed epoch catch-up ─────────────────────────────────────────────────

    #[test]
    fn missed_epoch_catchup() {
        let env = Env::default();
        let duration = 50u64;
        let (admin, client) = setup(&env, duration);

        let user = Address::generate(&env);
        client.stake(&user, &1_000);

        // Jump past two epoch windows (keeper missed epoch 1)
        env.ledger().with_mut(|li| li.timestamp = duration * 3);

        // Keeper catches up epoch 1 first
        client.seal_epoch(&admin, &1, &duration);
        // Then epoch 2
        env.ledger().with_mut(|li| li.timestamp = duration * 3 + 1);
        client.seal_epoch(&admin, &2, &duration);

        assert_eq!(client.current_epoch(), 3);
        // No fund corruption: total_staked unchanged
        assert_eq!(client.total_staked(), 1_000);
    }

    // ── Out-of-order sealing rejected ─────────────────────────────────────────

    #[test]
    fn out_of_order_sealing_rejected() {
        let env = Env::default();
        let (admin, client) = setup(&env, 100);

        env.ledger().with_mut(|li| li.timestamp = 200);

        // Cannot seal epoch 2 while epoch 1 is current
        let result = client.try_seal_epoch(&admin, &2, &100);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::OutOfOrderSealing
        );
    }

    // ── Already-sealed rejection ──────────────────────────────────────────────

    #[test]
    fn already_sealed_epoch_rejected() {
        let env = Env::default();
        let (admin, client) = setup(&env, 100);
        env.ledger().with_mut(|li| li.timestamp = 200);

        client.seal_epoch(&admin, &1, &100);

        // Move to epoch 2, then try to seal epoch 1 again (would be out-of-order)
        let result = client.try_seal_epoch(&admin, &1, &100);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::OutOfOrderSealing
        );
    }
}
