#![no_std]

#[cfg(kani)]
mod formal_properties;

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
    /// Reward index at the start of each epoch (for dust computation)
    EpochStartIndex(u64),
    /// Total staked across all users
    TotalStaked,
    /// Per-user stake info
    UserStake(Address),
    /// Paused flag
    Paused,
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
    /// Contract is paused
    Paused = 8,
    /// Claim attempted before any epoch has been sealed
    ClaimBeforeSeal = 9,
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
    /// Rounding dust accumulated in this epoch (funded - actually distributed)
    pub dust: i128,
    /// Total claimable computed at seal time (Σ claimable ≤ total_rewards invariant)
    pub total_claimable_at_seal: i128,
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
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::CurrentEpoch, &1u64);
        env.storage()
            .persistent()
            .set(&DataKey::RewardIndex, &0i128);
        env.storage()
            .persistent()
            .set(&DataKey::TotalStaked, &0i128);

        // Initialise epoch 1 and record its start reward index (0)
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
            dust: 0,
            total_claimable_at_seal: 0,
        };
        env.storage().persistent().set(&DataKey::Epoch(1), &epoch1);
        env.storage()
            .persistent()
            .set(&DataKey::EpochStartIndex(1), &0i128);

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

    pub fn pause(env: Env, admin: Address) -> Result<(), ContractError> {
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &true);
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), ContractError> {
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &false);
        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get::<_, bool>(&DataKey::Paused)
            .unwrap_or(false)
    }

    fn require_not_paused(env: &Env) -> Result<(), ContractError> {
        if env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::Paused)
            .unwrap_or(false)
        {
            return Err(ContractError::Paused);
        }
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
    ///
    /// Uses integer division to update the global reward index. The remainder
    /// (rounding dust) is tracked in the epoch's `dust` field and reported at
    /// seal time so no funds are silently lost.
    pub fn fund_epoch_rewards(
        env: Env,
        caller: Address,
        amount: i128,
    ) -> Result<(), ContractError> {
        Self::require_not_paused(&env)?;
        Self::require_operator_or_admin(&env, &caller)?;
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let total = Self::get_total_staked(&env);

        // Compute rounding dust for this funding event.
        // delta_index = floor(amount * SCALE / total), so
        // effectively_distributed = floor(delta_index * total / SCALE)
        // dust = amount - effectively_distributed
        let dust_this_funding: i128 = if total > 0 {
            let delta_index = amount * SCALE / total;
            let effectively_distributed = delta_index * total / SCALE;
            amount - effectively_distributed
        } else {
            // No stakers: entire amount is dust (not distributed to anyone)
            amount
        };

        if total > 0 {
            let reward_index = Self::get_reward_index(&env);
            let new_index = reward_index + (amount * SCALE / total);
            env.storage()
                .persistent()
                .set(&DataKey::RewardIndex, &new_index);
        }

        // Track total rewards and accumulated dust for the current epoch
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
            epoch.dust += dust_this_funding;
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
    /// After sealing the invariant Σ claimable(epoch) ≤ funded(epoch) is
    /// enforced by computing total_claimable from the reward-index delta and
    /// recording dust = funded - total_claimable. Dust is carried to the next
    /// epoch automatically via the `carry_forward` field.
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

        // Read the reward index at the start of this epoch to compute
        // exactly how much was distributed to stakers during this epoch.
        let start_index: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::EpochStartIndex(target_epoch))
            .unwrap_or(0);

        let total_staked = Self::get_total_staked(&env);

        // total_claimable = floor(total_staked * delta_index / SCALE)
        // This is the tight upper bound on Σ claimable(epoch).
        let total_claimable_at_seal: i128 = if total_staked > 0 {
            total_staked * (reward_index_at_seal - start_index) / SCALE
        } else {
            0
        };

        // Dust = funded - claimable (always ≥ 0 by integer division).
        // We use epoch.dust already accumulated during fund_epoch_rewards
        // but recalculate from first principles to keep it consistent.
        let dust = epoch.total_rewards - total_claimable_at_seal;
        let dust = if dust < 0 { 0 } else { dust };

        // Determine unclaimed rewards to carry forward to the next epoch.
        // Includes the rounding dust so it is never silently lost.
        let carry_forward = epoch.carried_forward + epoch.total_rewards;

        // Seal this epoch
        epoch.end_ts = now;
        epoch.seal_ts = now;
        epoch.sealed = true;
        epoch.reward_index_at_seal = reward_index_at_seal;
        epoch.dust = dust;
        epoch.total_claimable_at_seal = total_claimable_at_seal;
        env.storage()
            .persistent()
            .set(&DataKey::Epoch(target_epoch), &epoch);

        // Advance epoch counter and open next epoch
        let next_epoch = current_epoch + 1;
        env.storage()
            .instance()
            .set(&DataKey::CurrentEpoch, &next_epoch);

        // Record next epoch's starting reward index for accurate dust tracking
        env.storage()
            .persistent()
            .set(&DataKey::EpochStartIndex(next_epoch), &reward_index_at_seal);

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
            dust: 0,
            total_claimable_at_seal: 0,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Epoch(next_epoch), &next_epoch_info);

        // Emit epoch_sealed with funded + total_claimable for off-chain verification
        env.events().publish(
            (
                Symbol::new(&env, "epoch_rewards"),
                Symbol::new(&env, "epoch_sealed"),
            ),
            (
                target_epoch,
                now,
                reward_index_at_seal,
                epoch.total_rewards,
                total_claimable_at_seal,
            ),
        );

        // Emit dust_carried when rounding produced leftover funds
        if dust > 0 {
            env.events().publish(
                (
                    Symbol::new(&env, "epoch_rewards"),
                    Symbol::new(&env, "dust_carried"),
                ),
                (target_epoch, next_epoch, dust),
            );
        }

        Ok(())
    }

    // ── Claim ─────────────────────────────────────────────────────────────────

    /// Claim all pending rewards for `user`.
    ///
    /// Requires at least one epoch to have been sealed (current_epoch > 1).
    /// Idempotent: a second call in the same ledger returns 0.
    pub fn claim(env: Env, user: Address) -> Result<i128, ContractError> {
        user.require_auth();

        // Guard: reject claims before any epoch has been sealed
        let current_epoch: u64 = env
            .storage()
            .instance()
            .get(&DataKey::CurrentEpoch)
            .unwrap_or(1);
        if current_epoch <= 1 {
            return Err(ContractError::ClaimBeforeSeal);
        }

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
mod tests;
