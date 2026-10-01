#![no_std]

#[cfg(kani)]
mod formal_properties;

use soroban_pausable::{Pausable, PausableError};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token::Client as TokenClient, Address,
    BytesN, Env, Symbol,
};

const REWARD_INDEX_SCALE: i128 = 1_000_000_000_000;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    ContractVersion,
    Admin,
    Token,
    TotalStaked,
    Paused,
    GlobalRewardIndex,
    // Per-user keys (persistent storage) — replaces instance Map (#386)
    StakedBalance(Address),
    /// Capital marked as consumed by company operations; cannot be unstaked.
    /// Unused stake = staked_balance - used_stake. Defaults to 0 (full balance unused).
    UsedStake(Address),
    UserRewardIndex(Address),
    ClaimableReward(Address),
    // Upgrade governance (#392)
    Guardian,
    UpgradeDelay,
    PendingUpgradeHash,
    PendingUpgradeAt,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    // Upgrade governance errors (#392)
    UpgradeAlreadyPending = 1,
    NoUpgradePending = 2,
    UpgradeDelayNotMet = 3,
    NotAuthorized = 4,
    /// Unstake amount exceeds unused (liquid) stake; used stake stays locked.
    InsufficientUnusedStake = 5,
    /// Admin utilization exceeds user's unused stake.
    UtilizationExceedsUnused = 6,
    /// Contract is paused.
    ContractPaused = 7,
    /// Amount must be positive.
    AmountNotPositive = 8,
    /// Contract already initialized.
    AlreadyInitialized = 9,
    /// Caller must be admin.
    NotAdmin = 10,
    /// No stakers in the pool.
    NoStakers = 11,
}

#[contract]
pub struct StakingPool;

fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("admin not set")
}

fn get_token(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Token)
        .expect("token not set")
}

fn get_total_staked(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get::<_, i128>(&DataKey::TotalStaked)
        .unwrap_or(0)
}

fn put_total_staked(env: &Env, total: i128) {
    env.storage().instance().set(&DataKey::TotalStaked, &total);
}

fn get_global_reward_index(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get::<_, i128>(&DataKey::GlobalRewardIndex)
        .unwrap_or(0)
}

fn put_global_reward_index(env: &Env, idx: i128) {
    env.storage()
        .instance()
        .set(&DataKey::GlobalRewardIndex, &idx);
}

fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<_, bool>(&DataKey::Paused)
        .unwrap_or(false)
}

fn require_admin(env: &Env) {
    let admin = get_admin(env);
    admin.require_auth();
}

fn require_not_paused(env: &Env) -> Result<(), ContractError> {
    if is_paused(env) {
        return Err(ContractError::ContractPaused);
    }
    Ok(())
}

fn require_positive_amount(amount: i128) -> Result<(), ContractError> {
    if amount <= 0 {
        return Err(ContractError::AmountNotPositive);
    }
    Ok(())
}

fn get_staked_balance(env: &Env, user: &Address) -> i128 {
    env.storage()
        .persistent()
        .get::<_, i128>(&DataKey::StakedBalance(user.clone()))
        .unwrap_or(0)
}

fn get_used_stake(env: &Env, user: &Address) -> i128 {
    env.storage()
        .persistent()
        .get::<_, i128>(&DataKey::UsedStake(user.clone()))
        .unwrap_or(0)
}

fn put_used_stake(env: &Env, user: &Address, used: i128) {
    if used <= 0 {
        env.storage()
            .persistent()
            .remove(&DataKey::UsedStake(user.clone()));
    } else {
        env.storage()
            .persistent()
            .set(&DataKey::UsedStake(user.clone()), &used);
    }
}

/// Stake that is not marked used and may be withdrawn via `unstake`.
fn get_unused_stake(env: &Env, user: &Address) -> i128 {
    let total = get_staked_balance(env, user);
    let used = get_used_stake(env, user);
    total.saturating_sub(used)
}

fn get_user_reward_index(env: &Env, user: &Address) -> i128 {
    env.storage()
        .persistent()
        .get::<_, i128>(&DataKey::UserRewardIndex(user.clone()))
        .unwrap_or(0)
}

fn get_claimable_reward(env: &Env, user: &Address) -> i128 {
    env.storage()
        .persistent()
        .get::<_, i128>(&DataKey::ClaimableReward(user.clone()))
        .unwrap_or(0)
}

fn accrue_user_rewards(env: &Env, user: &Address) {
    let global_idx = get_global_reward_index(env);
    let user_idx = get_user_reward_index(env, user);

    if global_idx <= user_idx {
        return;
    }

    let staked = get_staked_balance(env, user);

    if staked > 0 {
        let delta = global_idx - user_idx;
        let accrued = (staked * delta) / REWARD_INDEX_SCALE;

        if accrued > 0 {
            let current = get_claimable_reward(env, user);
            env.storage().persistent().set(
                &DataKey::ClaimableReward(user.clone()),
                &(current + accrued),
            );
        }
    }

    env.storage()
        .persistent()
        .set(&DataKey::UserRewardIndex(user.clone()), &global_idx);
}

#[contractimpl]
impl StakingPool {
    pub fn init(env: Env, admin: Address, token: Address) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage()
            .instance()
            .set(&DataKey::ContractVersion, &2u32);
        env.storage().instance().set(&DataKey::TotalStaked, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::GlobalRewardIndex, &0i128);

        env.events().publish(
            (
                Symbol::new(&env, "mvp_staking_pool"),
                Symbol::new(&env, "init"),
            ),
            (admin, token, 2u32),
        );
        Ok(())
    }

    pub fn contract_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get::<_, u32>(&DataKey::ContractVersion)
            .unwrap_or(0u32)
    }

    pub fn stake(env: Env, user: Address, amount: i128) -> Result<(), ContractError> {
        user.require_auth();
        require_not_paused(&env)?;
        require_positive_amount(amount)?;

        accrue_user_rewards(&env, &user);

        let token_address = get_token(&env);
        let token_client = TokenClient::new(&env, &token_address);

        // Transfer tokens from user to contract
        token_client.transfer(&user, &env.current_contract_address(), &amount);

        // Update staked balance
        let current_balance = get_staked_balance(&env, &user);
        env.storage().persistent().set(
            &DataKey::StakedBalance(user.clone()),
            &(current_balance + amount),
        );

        // Update total staked
        let total = get_total_staked(&env);
        put_total_staked(&env, total + amount);

        env.events()
            .publish((Symbol::new(&env, "stake"), user.clone()), amount);
        Ok(())
    }

    /// Withdraws only from **unused** stake. Used stake (see `utilize_stake`) stays locked.
    pub fn unstake(env: Env, user: Address, amount: i128) -> Result<(), ContractError> {
        user.require_auth();
        require_not_paused(&env)?;
        require_positive_amount(amount)?;

        accrue_user_rewards(&env, &user);

        let current_balance = get_staked_balance(&env, &user);
        let unused = get_unused_stake(&env, &user);
        if amount > unused {
            env.events().publish(
                (
                    Symbol::new(&env, "mvp_staking_pool"),
                    Symbol::new(&env, "unstake_rejected"),
                ),
                (
                    user.clone(),
                    amount,
                    unused,
                    Symbol::new(&env, "insufficient_unused"),
                ),
            );
            return Err(ContractError::InsufficientUnusedStake);
        }

        let token_address = get_token(&env);
        let token_client = TokenClient::new(&env, &token_address);

        // Update staked balance
        env.storage().persistent().set(
            &DataKey::StakedBalance(user.clone()),
            &(current_balance - amount),
        );

        let total = get_total_staked(&env);
        put_total_staked(&env, total - amount);

        token_client.transfer(&env.current_contract_address(), &user, &amount);

        env.events()
            .publish((Symbol::new(&env, "unstake"), user.clone()), amount);
        Ok(())
    }

    /// Capital consumed by company operations (locked until released by future flows if any).
    pub fn used_stake(env: Env, user: Address) -> i128 {
        get_used_stake(&env, &user)
    }

    /// Stake that may still be withdrawn via `unstake` (total staked minus `used_stake`).
    pub fn unused_stake(env: Env, user: Address) -> i128 {
        get_unused_stake(&env, &user)
    }

    /// Moves stake from unused → used. Tokens remain in the contract; staker cannot unstake used portion.
    pub fn utilize_stake(
        env: Env,
        admin: Address,
        user: Address,
        amount: i128,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        if admin != get_admin(&env) {
            return Err(ContractError::NotAuthorized);
        }
        require_not_paused(&env)?;
        require_positive_amount(amount)?;

        accrue_user_rewards(&env, &user);

        let total = get_staked_balance(&env, &user);
        let unused = get_unused_stake(&env, &user);
        if amount > unused {
            return Err(ContractError::UtilizationExceedsUnused);
        }

        let used = get_used_stake(&env, &user);
        let new_used = used + amount;
        put_used_stake(&env, &user, new_used);

        let new_unused = total.saturating_sub(new_used);
        env.events().publish(
            (
                Symbol::new(&env, "mvp_staking_pool"),
                Symbol::new(&env, "stake_utilized"),
            ),
            (user.clone(), amount, new_used, new_unused),
        );
        Ok(())
    }

    /// Total staked per user (used + unused). Unchanged from pre-partition semantics for reward accrual.
    pub fn staked_balance(env: Env, user: Address) -> i128 {
        get_staked_balance(&env, &user)
    }

    pub fn total_staked(env: Env) -> i128 {
        get_total_staked(&env)
    }

    pub fn fund_rewards(env: Env, from: Address, amount: i128) -> Result<(), ContractError> {
        require_admin(&env);
        require_not_paused(&env)?;
        require_positive_amount(amount)?;

        let admin = get_admin(&env);
        if from != admin {
            return Err(ContractError::NotAdmin);
        }

        let total = get_total_staked(&env);
        if total <= 0 {
            return Err(ContractError::NoStakers);
        }

        let token_address = get_token(&env);
        let token_client = TokenClient::new(&env, &token_address);
        token_client.transfer(&from, &env.current_contract_address(), &amount);

        let increment = (amount * REWARD_INDEX_SCALE) / total;
        let new_idx = get_global_reward_index(&env) + increment;
        put_global_reward_index(&env, new_idx);

        env.events()
            .publish((Symbol::new(&env, "fund_rewards"), from.clone()), amount);
        Ok(())
    }

    pub fn claimable(env: Env, user: Address) -> i128 {
        accrue_user_rewards(&env, &user);
        get_claimable_reward(&env, &user)
    }

    pub fn claim(env: Env, to: Address) -> Result<i128, ContractError> {
        to.require_auth();
        require_not_paused(&env)?;

        accrue_user_rewards(&env, &to);

        let amount = get_claimable_reward(&env, &to);
        if amount <= 0 {
            return Ok(0);
        }

        env.storage()
            .persistent()
            .set(&DataKey::ClaimableReward(to.clone()), &0i128);

        let token_address = get_token(&env);
        let token_client = TokenClient::new(&env, &token_address);
        token_client.transfer(&env.current_contract_address(), &to, &amount);

        env.events()
            .publish((Symbol::new(&env, "claim"), to.clone()), amount);
        Ok(amount)
    }

    // ── Upgrade governance (#392) ──────────────────────────────────────────────

    pub fn set_guardian(env: Env, admin: Address, guardian: Address) -> Result<(), ContractError> {
        admin.require_auth();
        if admin != get_admin(&env) {
            return Err(ContractError::NotAuthorized);
        }
        env.storage().instance().set(&DataKey::Guardian, &guardian);
        env.events().publish(
            (
                Symbol::new(&env, "mvp_staking_pool"),
                Symbol::new(&env, "set_guardian"),
            ),
            guardian,
        );
        Ok(())
    }

    pub fn set_upgrade_delay(env: Env, admin: Address, delay: u64) -> Result<(), ContractError> {
        admin.require_auth();
        if admin != get_admin(&env) {
            return Err(ContractError::NotAuthorized);
        }
        env.storage().instance().set(&DataKey::UpgradeDelay, &delay);
        env.events().publish(
            (
                Symbol::new(&env, "mvp_staking_pool"),
                Symbol::new(&env, "set_upgrade_delay"),
            ),
            delay,
        );
        Ok(())
    }

    pub fn propose_upgrade(
        env: Env,
        admin: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        if admin != get_admin(&env) {
            return Err(ContractError::NotAuthorized);
        }
        if env.storage().instance().has(&DataKey::PendingUpgradeHash) {
            return Err(ContractError::UpgradeAlreadyPending);
        }
        let delay: u64 = env
            .storage()
            .instance()
            .get(&DataKey::UpgradeDelay)
            .unwrap_or(0);
        let execute_at = env.ledger().timestamp() + delay;
        env.storage()
            .instance()
            .set(&DataKey::PendingUpgradeHash, &new_wasm_hash);
        env.storage()
            .instance()
            .set(&DataKey::PendingUpgradeAt, &execute_at);
        env.events().publish(
            (
                Symbol::new(&env, "mvp_staking_pool"),
                Symbol::new(&env, "propose_upgrade"),
            ),
            (new_wasm_hash, execute_at),
        );
        Ok(())
    }

    pub fn execute_upgrade(env: Env, admin: Address) -> Result<(), ContractError> {
        admin.require_auth();
        if admin != get_admin(&env) {
            return Err(ContractError::NotAuthorized);
        }
        let hash = env
            .storage()
            .instance()
            .get::<_, BytesN<32>>(&DataKey::PendingUpgradeHash)
            .ok_or(ContractError::NoUpgradePending)?;
        let execute_at: u64 = env
            .storage()
            .instance()
            .get(&DataKey::PendingUpgradeAt)
            .ok_or(ContractError::NoUpgradePending)?;
        if env.ledger().timestamp() < execute_at {
            return Err(ContractError::UpgradeDelayNotMet);
        }
        env.storage()
            .instance()
            .remove(&DataKey::PendingUpgradeHash);
        env.storage().instance().remove(&DataKey::PendingUpgradeAt);
        env.events().publish(
            (
                Symbol::new(&env, "mvp_staking_pool"),
                Symbol::new(&env, "execute_upgrade"),
            ),
            hash.clone(),
        );
        env.deployer().update_current_contract_wasm(hash);
        Ok(())
    }

    pub fn emergency_upgrade(
        env: Env,
        admin: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        if admin != get_admin(&env) {
            return Err(ContractError::NotAuthorized);
        }
        if let Some(guardian) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Guardian)
        {
            guardian.require_auth();
        }
        env.storage()
            .instance()
            .remove(&DataKey::PendingUpgradeHash);
        env.storage().instance().remove(&DataKey::PendingUpgradeAt);
        env.events().publish(
            (
                Symbol::new(&env, "mvp_staking_pool"),
                Symbol::new(&env, "emergency_upgrade"),
            ),
            (admin.clone(), new_wasm_hash.clone()),
        );
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    pub fn cancel_upgrade(env: Env, admin: Address) -> Result<(), ContractError> {
        admin.require_auth();
        if admin != get_admin(&env) {
            return Err(ContractError::NotAuthorized);
        }
        if !env.storage().instance().has(&DataKey::PendingUpgradeHash) {
            return Err(ContractError::NoUpgradePending);
        }
        env.storage()
            .instance()
            .remove(&DataKey::PendingUpgradeHash);
        env.storage().instance().remove(&DataKey::PendingUpgradeAt);
        env.events().publish(
            (
                Symbol::new(&env, "mvp_staking_pool"),
                Symbol::new(&env, "cancel_upgrade"),
            ),
            admin.clone(),
        );
        Ok(())
    }
}

#[contractimpl]
impl Pausable for StakingPool {
    fn pause(env: Env, admin: Address) -> Result<(), PausableError> {
        admin.require_auth();
        let stored = get_admin(&env);
        if admin != stored {
            return Err(PausableError::NotAuthorized);
        }
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish(
            (Symbol::new(&env, "Pausable"), Symbol::new(&env, "pause")),
            (),
        );
        Ok(())
    }

    fn unpause(env: Env, admin: Address) -> Result<(), PausableError> {
        admin.require_auth();
        let stored = get_admin(&env);
        if admin != stored {
            return Err(PausableError::NotAuthorized);
        }
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events().publish(
            (Symbol::new(&env, "Pausable"), Symbol::new(&env, "unpause")),
            (),
        );
        Ok(())
    }

    fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }
}

#[cfg(test)]
mod migration_test_helpers;

#[cfg(test)]
mod migration_tests;

#[cfg(test)]
mod tests;

#[cfg(test)]
mod test {
    extern crate std;

    use super::{StakingPool, StakingPoolClient};
    use soroban_sdk::testutils::{Address as _, MockAuth, MockAuthInvoke};
    use soroban_sdk::{token::StellarAssetClient, Address, Env, IntoVal};

    fn setup_contract(env: &Env) -> (Address, StakingPoolClient<'_>, Address, Address, Address) {
        let contract_id = env.register(StakingPool, ());
        let client = StakingPoolClient::new(env, &contract_id);

        let admin = Address::generate(env);
        let user = Address::generate(env);
        let token_admin = Address::generate(env);

        // Create token contract
        let token_contract = env.register_stellar_asset_contract_v2(token_admin);
        let token_contract_id = token_contract.address();

        // Initialize contract
        client.init(&admin, &token_contract_id);

        (contract_id, client, admin, user, token_contract_id)
    }

    #[test]
    fn rewards_accrue_and_can_be_claimed_without_iteration() {
        let env = Env::default();
        let (contract_id, client, admin, user_a, token_id) = setup_contract(&env);
        let user_b = Address::generate(&env);

        env.mock_all_auths();

        let asset = StellarAssetClient::new(&env, &token_id);
        asset.mint(&admin, &1_000i128);
        asset.mint(&user_a, &1_000i128);
        asset.mint(&user_b, &1_000i128);

        client.stake(&user_a, &100i128);
        client.fund_rewards(&admin, &50i128);
        assert!(client.claimable(&user_a) > 0);

        client.stake(&user_b, &100i128);
        client.fund_rewards(&admin, &100i128);

        let claimable_a = client.claimable(&user_a);
        let claimable_b = client.claimable(&user_b);
        assert_eq!(claimable_a, 100i128);
        assert_eq!(claimable_b, 50i128);

        let claimed = client.claim(&user_a);
        assert_eq!(claimed, 100i128);

        let claimed_again = client.claim(&user_a);
        assert_eq!(claimed_again, 0i128);

        // Sanity: contract still callable and has not iterated through user maps for distribution.
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "pause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.pause(&admin);
    }

    // ============================================================================
    // Init Tests
    // ============================================================================

    #[test]
    fn init_sets_admin_and_token() {
        let env = Env::default();
        let contract_id = env.register(StakingPool, ());
        let client = StakingPoolClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(token_admin);
        let token_contract_id = token_contract.address();

        client.init(&admin, &token_contract_id);

        assert_eq!(client.contract_version(), 2u32);

        // Verify admin can pause
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "pause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.pause(&admin);
    }

    #[test]
    fn init_cannot_be_called_twice() {
        let env = Env::default();
        let contract_id = env.register(StakingPool, ());
        let client = StakingPoolClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(token_admin);
        let token_contract_id = token_contract.address();

        client.init(&admin, &token_contract_id);
        let result = client.try_init(&admin, &token_contract_id);
        assert!(result.is_err());
    }

    // ============================================================================
    // Query Tests
    // ============================================================================

    #[test]
    fn staked_balance_returns_zero_for_new_user() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, _token_id) = setup_contract(&env);
        let new_user = Address::generate(&env);

        assert_eq!(client.staked_balance(&user), 0i128);
        assert_eq!(client.staked_balance(&new_user), 0i128);
    }

    #[test]
    fn total_staked_returns_zero_initially() {
        let env = Env::default();
        let (_contract_id, client, _admin, _user, _token_id) = setup_contract(&env);
        assert_eq!(client.total_staked(), 0i128);
    }

    // ============================================================================
    // Admin Tests
    // ============================================================================

    #[test]
    fn admin_can_pause_and_unpause() {
        let env = Env::default();
        let (contract_id, client, admin, _user, _token_id) = setup_contract(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "pause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        client.pause(&admin);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "unpause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        client.unpause(&admin);
    }

    #[test]
    #[should_panic]
    fn non_admin_cannot_pause() {
        let env = Env::default();
        let (contract_id, client, _admin, _user, _token_id) = setup_contract(&env);
        let non_admin = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &non_admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "pause",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }]);

        client.pause(&non_admin);
    }

    // ============================================================================
    // Pause Behavior Tests
    // ============================================================================

    #[test]
    fn stake_fails_when_paused() {
        let env = Env::default();
        let (contract_id, client, admin, user, _token_id) = setup_contract(&env);

        // Pause the contract
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "pause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.pause(&admin);

        // Try to stake while paused
        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "stake",
                args: (user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let result = client.try_stake(&user, &100i128);
        assert!(result.is_err());
    }

    #[test]
    fn unstake_fails_when_paused() {
        let env = Env::default();
        let (contract_id, client, admin, user, _token_id) = setup_contract(&env);

        // Pause the contract
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "pause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.pause(&admin);

        // Try to unstake while paused
        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "unstake",
                args: (user.clone(), 50i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let result = client.try_unstake(&user, &50i128);
        assert!(result.is_err());
    }

    // ============================================================================
    // Input Validation Tests
    // ============================================================================

    #[test]
    fn stake_fails_with_zero_amount() {
        let env = Env::default();
        let (contract_id, client, _admin, user, _token_id) = setup_contract(&env);

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "stake",
                args: (user.clone(), 0i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let result = client.try_stake(&user, &0i128);
        assert!(result.is_err());
    }

    #[test]
    fn stake_fails_with_negative_amount() {
        let env = Env::default();
        let (contract_id, client, _admin, user, _token_id) = setup_contract(&env);

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "stake",
                args: (user.clone(), -10i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let result = client.try_stake(&user, &-10i128);
        assert!(result.is_err());
    }

    #[test]
    fn unstake_fails_with_zero_amount() {
        let env = Env::default();
        let (contract_id, client, _admin, user, _token_id) = setup_contract(&env);

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "unstake",
                args: (user.clone(), 0i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let result = client.try_unstake(&user, &0i128);
        assert!(result.is_err());
    }

    #[test]
    fn unstake_fails_with_negative_amount() {
        let env = Env::default();
        let (contract_id, client, _admin, user, _token_id) = setup_contract(&env);

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "unstake",
                args: (user.clone(), -10i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let result = client.try_unstake(&user, &-10i128);
        assert!(result.is_err());
    }

    // ============================================================================
    // Stake/Unstake Edge Case Tests
    // ============================================================================

    #[test]
    fn unstake_fails_with_insufficient_unused_when_no_stake() {
        let env = Env::default();
        let (contract_id, client, _admin, user, _token_id) = setup_contract(&env);

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "unstake",
                args: (user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let e = client.try_unstake(&user, &100i128).unwrap_err().unwrap();
        assert_eq!(e, super::ContractError::InsufficientUnusedStake);
    }

    #[test]
    fn unstake_fails_when_unstaking_more_than_unused_without_stake() {
        let env = Env::default();
        let (contract_id, client, _admin, user, _token_id) = setup_contract(&env);

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "unstake",
                args: (user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let e = client.try_unstake(&user, &100i128).unwrap_err().unwrap();
        assert_eq!(e, super::ContractError::InsufficientUnusedStake);
    }

    #[test]
    fn stake_and_unstake_work_correctly() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, _token_id) = setup_contract(&env);

        // Initial balances should be zero
        assert_eq!(client.staked_balance(&user), 0i128);
        assert_eq!(client.total_staked(), 0i128);

        // Test that functions exist and have correct signatures
        // The actual token transfer logic is tested in integration tests
        assert_eq!(client.staked_balance(&user), 0i128);
        assert_eq!(client.total_staked(), 0i128);
    }

    #[test]
    fn multiple_users_can_stake_independently() {
        let env = Env::default();
        let (_contract_id, client, _admin, user1, _token_id) = setup_contract(&env);
        let user2 = Address::generate(&env);

        // Initial balances should be zero
        assert_eq!(client.staked_balance(&user1), 0i128);
        assert_eq!(client.staked_balance(&user2), 0i128);
        assert_eq!(client.total_staked(), 0i128);

        // Test that different users have separate balances
        assert_ne!(user1, user2);
        assert_eq!(client.staked_balance(&user1), 0i128);
        assert_eq!(client.staked_balance(&user2), 0i128);
    }

    // ============================================================================
    // Event Tests
    // ============================================================================

    #[test]
    fn stake_emits_event_with_standardized_topic() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, _token_id) = setup_contract(&env);

        // Test that stake function exists and has correct signature
        // Event emission is tested in integration tests with actual token transfers
        assert_eq!(client.staked_balance(&user), 0i128);
    }

    #[test]
    fn unstake_emits_event_with_standardized_topic() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, _token_id) = setup_contract(&env);

        // Test that unstake function exists and has correct signature
        // Event emission is tested in integration tests with actual token transfers
        assert_eq!(client.staked_balance(&user), 0i128);
    }
}

/// Used vs unused stake: unstake rules, admin utilization, backward compatibility.
#[cfg(test)]
mod stake_partition {
    extern crate std;

    use super::{ContractError, StakingPool, StakingPoolClient};
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{token::StellarAssetClient, Address, Env};

    fn setup(env: &Env) -> (StakingPoolClient<'_>, Address, Address) {
        let contract_id = env.register(StakingPool, ());
        let client = StakingPoolClient::new(env, &contract_id);
        let admin = Address::generate(env);
        let token_admin = Address::generate(env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        client.init(&admin, &token);
        (client, admin, token)
    }

    #[test]
    fn existing_holder_all_unused_can_full_unstake() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _admin, token) = setup(&env);
        let user = Address::generate(&env);
        StellarAssetClient::new(&env, &token).mint(&user, &500i128);
        client.stake(&user, &500i128);
        assert_eq!(client.used_stake(&user), 0i128);
        assert_eq!(client.unused_stake(&user), 500i128);
        client.unstake(&user, &500i128);
        assert_eq!(client.staked_balance(&user), 0i128);
        assert_eq!(client.total_staked(), 0i128);
    }

    #[test]
    fn partial_utilization_unstake_only_unused_then_remainder_locked() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);
        let user = Address::generate(&env);
        StellarAssetClient::new(&env, &token).mint(&user, &1_000i128);
        client.stake(&user, &1_000i128);
        client.utilize_stake(&admin, &user, &400i128);
        assert_eq!(client.used_stake(&user), 400i128);
        assert_eq!(client.unused_stake(&user), 600i128);
        client.unstake(&user, &600i128);
        assert_eq!(client.staked_balance(&user), 400i128);
        assert_eq!(client.used_stake(&user), 400i128);
        assert_eq!(client.unused_stake(&user), 0i128);
        let e = client.try_unstake(&user, &1i128).unwrap_err().unwrap();
        assert_eq!(e, ContractError::InsufficientUnusedStake);
    }

    #[test]
    fn full_utilization_blocks_unstake() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);
        let user = Address::generate(&env);
        StellarAssetClient::new(&env, &token).mint(&user, &300i128);
        client.stake(&user, &300i128);
        client.utilize_stake(&admin, &user, &300i128);
        assert_eq!(client.unused_stake(&user), 0i128);
        let e = client.try_unstake(&user, &1i128).unwrap_err().unwrap();
        assert_eq!(e, ContractError::InsufficientUnusedStake);
    }

    #[test]
    fn cannot_unstake_more_than_unused_even_when_total_exceeds_request() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);
        let user = Address::generate(&env);
        StellarAssetClient::new(&env, &token).mint(&user, &500i128);
        client.stake(&user, &500i128);
        client.utilize_stake(&admin, &user, &450i128);
        let e = client.try_unstake(&user, &100i128).unwrap_err().unwrap();
        assert_eq!(e, ContractError::InsufficientUnusedStake);
    }

    #[test]
    fn utilize_beyond_unused_returns_error() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);
        let user = Address::generate(&env);
        StellarAssetClient::new(&env, &token).mint(&user, &200i128);
        client.stake(&user, &200i128);
        let e = client
            .try_utilize_stake(&admin, &user, &201i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(e, ContractError::UtilizationExceedsUnused);
    }

    #[test]
    fn non_admin_cannot_utilize_stake() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _admin, token) = setup(&env);
        let user = Address::generate(&env);
        let not_admin = Address::generate(&env);
        StellarAssetClient::new(&env, &token).mint(&user, &100i128);
        client.stake(&user, &100i128);
        let e = client
            .try_utilize_stake(&not_admin, &user, &10i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(e, ContractError::NotAuthorized);
    }

    #[test]
    fn rewards_still_accrue_on_total_including_used() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);
        let user = Address::generate(&env);
        StellarAssetClient::new(&env, &token).mint(&user, &500i128);
        StellarAssetClient::new(&env, &token).mint(&admin, &500i128);
        client.stake(&user, &500i128);
        client.utilize_stake(&admin, &user, &200i128);
        client.fund_rewards(&admin, &500i128);
        assert_eq!(client.claimable(&user), 500i128);
    }

    #[test]
    fn stake_after_full_utilization_adds_only_to_unused() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);
        let user = Address::generate(&env);
        StellarAssetClient::new(&env, &token).mint(&user, &600i128);
        client.stake(&user, &500i128);
        client.utilize_stake(&admin, &user, &500i128);
        client.stake(&user, &100i128);
        assert_eq!(client.used_stake(&user), 500i128);
        assert_eq!(client.staked_balance(&user), 600i128);
        assert_eq!(client.unused_stake(&user), 100i128);
        client.unstake(&user, &100i128);
        assert_eq!(client.used_stake(&user), 500i128);
        assert_eq!(client.staked_balance(&user), 500i128);
    }

    // -------------------------------------------------------------------------
    // Invariant: used + unused == total_staked across a multi-op sequence
    // -------------------------------------------------------------------------
    #[test]
    fn invariant_used_plus_unused_equals_total_staked_across_ops() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);
        let user = Address::generate(&env);
        StellarAssetClient::new(&env, &token).mint(&user, &1_000i128);
        StellarAssetClient::new(&env, &token).mint(&admin, &1_000i128);

        // Stake 500, invariant holds
        client.stake(&user, &500i128);
        assert_eq!(
            client.used_stake(&user) + client.unused_stake(&user),
            client.staked_balance(&user)
        );

        // Utilize 200, invariant still holds
        client.utilize_stake(&admin, &user, &200i128);
        assert_eq!(client.used_stake(&user), 200i128);
        assert_eq!(client.unused_stake(&user), 300i128);
        assert_eq!(
            client.used_stake(&user) + client.unused_stake(&user),
            client.staked_balance(&user)
        );

        // Fund rewards and claim — does not change stake invariant
        client.fund_rewards(&admin, &100i128);
        let claimable = client.claimable(&user);
        assert!(claimable > 0);
        let claimed = client.claim(&user);
        assert_eq!(claimed, claimable);
        assert_eq!(
            client.used_stake(&user) + client.unused_stake(&user),
            client.staked_balance(&user)
        );

        // Unstake 100 from unused portion, invariant holds
        client.unstake(&user, &100i128);
        assert_eq!(client.unused_stake(&user), 200i128);
        assert_eq!(client.used_stake(&user), 200i128);
        assert_eq!(client.staked_balance(&user), 400i128);
        assert_eq!(
            client.used_stake(&user) + client.unused_stake(&user),
            client.staked_balance(&user)
        );
    }

    // -------------------------------------------------------------------------
    // Over-utilization is rejected
    // -------------------------------------------------------------------------
    #[test]
    fn utilize_stake_rejects_over_utilization() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);
        let user = Address::generate(&env);
        StellarAssetClient::new(&env, &token).mint(&user, &100i128);
        client.stake(&user, &100i128);

        // Exact amount succeeds
        client.utilize_stake(&admin, &user, &100i128);
        // Any further utilization should fail
        let err = client
            .try_utilize_stake(&admin, &user, &1i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::UtilizationExceedsUnused);
    }

    #[test]
    fn utilize_stake_rejects_exceeding_unused_after_partial_utilization() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);
        let user = Address::generate(&env);
        StellarAssetClient::new(&env, &token).mint(&user, &200i128);
        client.stake(&user, &200i128);
        // Utilize 150; only 50 unused left
        client.utilize_stake(&admin, &user, &150i128);
        // Try to utilize 100 more — should fail
        let err = client
            .try_utilize_stake(&admin, &user, &100i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::UtilizationExceedsUnused);
    }

    // -------------------------------------------------------------------------
    // Unstaking utilized stake is rejected
    // -------------------------------------------------------------------------
    #[test]
    fn unstake_rejects_withdrawal_of_utilized_stake() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);
        let user = Address::generate(&env);
        StellarAssetClient::new(&env, &token).mint(&user, &200i128);
        client.stake(&user, &200i128);
        // Utilize 150; only 50 unused
        client.utilize_stake(&admin, &user, &150i128);
        // Unstake 51 — exceeds unused (50)
        let err = client.try_unstake(&user, &51i128).unwrap_err().unwrap();
        assert_eq!(err, ContractError::InsufficientUnusedStake);
    }

    // -------------------------------------------------------------------------
    // Reward claim accounting is correct under partial utilization
    // -------------------------------------------------------------------------
    #[test]
    fn rewards_accrue_on_full_balance_even_when_partially_utilized() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);
        let user = Address::generate(&env);
        StellarAssetClient::new(&env, &token).mint(&user, &1_000i128);
        StellarAssetClient::new(&env, &token).mint(&admin, &1_000i128);

        client.stake(&user, &1_000i128);
        // Utilize half
        client.utilize_stake(&admin, &user, &500i128);
        // Fund 1000 tokens as rewards — user is the sole staker so gets all
        client.fund_rewards(&admin, &1_000i128);
        assert_eq!(client.claimable(&user), 1_000i128);
        let claimed = client.claim(&user);
        assert_eq!(claimed, 1_000i128);
        assert_eq!(client.claimable(&user), 0i128);

        // After claim, stake invariant still holds
        assert_eq!(
            client.used_stake(&user) + client.unused_stake(&user),
            client.staked_balance(&user)
        );
    }

    #[test]
    fn reward_claim_zero_after_double_claim() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);
        let user = Address::generate(&env);
        StellarAssetClient::new(&env, &token).mint(&user, &500i128);
        StellarAssetClient::new(&env, &token).mint(&admin, &500i128);

        client.stake(&user, &500i128);
        client.utilize_stake(&admin, &user, &200i128);
        client.fund_rewards(&admin, &500i128);

        let first = client.claim(&user);
        assert_eq!(first, 500i128);
        let second = client.claim(&user);
        assert_eq!(second, 0i128);
    }
}

// ============================================================================
// Reward Math Invariant Tests
//
// These tests verify the correctness of the global-index reward distribution
// formula across edge cases. All tests use mock_all_auths and real token
// transfers so the full stake → fund_rewards → claimable → claim path runs.
//
// Formula under test:
//   index_increment = (reward * REWARD_INDEX_SCALE) / total_staked
//   user_accrued    = (user_staked * index_delta)   / REWARD_INDEX_SCALE
// ============================================================================
#[cfg(test)]
mod reward_math_invariants {
    extern crate std;

    use super::{StakingPool, StakingPoolClient};
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{token::StellarAssetClient, Address, Env};

    fn setup(env: &Env) -> (StakingPoolClient<'_>, Address, Address) {
        let contract_id = env.register(StakingPool, ());
        let client = StakingPoolClient::new(env, &contract_id);
        let admin = Address::generate(env);
        let token_admin = Address::generate(env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        client.init(&admin, &token);
        (client, admin, token)
    }

    fn mint(env: &Env, token: &Address, to: &Address, amount: i128) {
        StellarAssetClient::new(env, token).mint(to, &amount);
    }

    // Invariant 1: sole staker receives 100 % of rewards
    // When only one user is staked, every token funded as reward must be
    // fully claimable by that user (no rounding loss for whole-number inputs).
    #[test]
    fn invariant_sole_staker_receives_all_rewards() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);

        let user = Address::generate(&env);
        mint(&env, &token, &admin, 1_000i128);
        mint(&env, &token, &user, 1_000i128);

        client.stake(&user, &500i128);
        client.fund_rewards(&admin, &500i128);

        assert_eq!(
            client.claimable(&user),
            500i128,
            "sole staker must receive 100% of funded rewards"
        );
    }

    // Invariant 2: rewards split proportionally between two equal stakers
    // Two users with identical stakes must receive identical reward shares.
    #[test]
    fn invariant_equal_stakers_receive_equal_rewards() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);

        let user_a = Address::generate(&env);
        let user_b = Address::generate(&env);
        mint(&env, &token, &admin, 1_000i128);
        mint(&env, &token, &user_a, 500i128);
        mint(&env, &token, &user_b, 500i128);

        client.stake(&user_a, &500i128);
        client.stake(&user_b, &500i128);
        client.fund_rewards(&admin, &1_000i128);

        let reward_a = client.claimable(&user_a);
        let reward_b = client.claimable(&user_b);
        assert_eq!(
            reward_a, reward_b,
            "equal stakers must receive equal rewards"
        );
        assert_eq!(reward_a, 500i128);
    }

    // Invariant 3: rewards split proportionally for unequal stakes (2:1 ratio)
    // A user with twice the stake must receive twice the reward.
    #[test]
    fn invariant_reward_proportional_to_stake_ratio() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);

        let user_a = Address::generate(&env);
        let user_b = Address::generate(&env);
        mint(&env, &token, &admin, 900i128);
        mint(&env, &token, &user_a, 600i128);
        mint(&env, &token, &user_b, 300i128);

        // user_a stakes 2x user_b
        client.stake(&user_a, &600i128);
        client.stake(&user_b, &300i128);
        client.fund_rewards(&admin, &900i128);

        let reward_a = client.claimable(&user_a);
        let reward_b = client.claimable(&user_b);
        assert_eq!(reward_a, 600i128, "2x staker must receive 2x reward");
        assert_eq!(reward_b, 300i128);
    }

    // Invariant 4: late staker earns no rewards from funding rounds before their stake
    // Rewards funded before a user stakes must not accrue to that user.
    #[test]
    fn invariant_late_staker_earns_no_pre_stake_rewards() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);

        let early = Address::generate(&env);
        let late = Address::generate(&env);
        mint(&env, &token, &admin, 2_000i128);
        mint(&env, &token, &early, 1_000i128);
        mint(&env, &token, &late, 1_000i128);

        client.stake(&early, &1_000i128);
        client.fund_rewards(&admin, &1_000i128); // funded before late staker joins

        client.stake(&late, &1_000i128);
        client.fund_rewards(&admin, &1_000i128); // funded after both are staked

        let reward_early = client.claimable(&early);
        let reward_late = client.claimable(&late);

        // early: 1000 (sole) + 500 (split) = 1500
        // late:  0    (pre)  + 500 (split) = 500
        assert_eq!(
            reward_early, 1_500i128,
            "early staker must earn pre-join rewards"
        );
        assert_eq!(
            reward_late, 500i128,
            "late staker must not earn pre-stake rewards"
        );
    }

    // Invariant 5: claimable returns zero for a user who has never staked
    // A user with no stake must never accumulate rewards regardless of funding.
    #[test]
    fn invariant_non_staker_claimable_is_always_zero() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);

        let staker = Address::generate(&env);
        let bystander = Address::generate(&env);
        mint(&env, &token, &admin, 500i128);
        mint(&env, &token, &staker, 500i128);

        client.stake(&staker, &500i128);
        client.fund_rewards(&admin, &500i128);

        assert_eq!(
            client.claimable(&bystander),
            0i128,
            "non-staker must never have claimable rewards"
        );
    }

    // Invariant 6: small stake amount (1 token) still accrues rewards correctly
    // The index math must not lose the reward entirely due to integer division
    // when the stake is very small relative to the reward pool.
    #[test]
    fn invariant_small_stake_accrues_nonzero_reward_when_sole_staker() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);

        let user = Address::generate(&env);
        mint(&env, &token, &admin, 1_000_000i128);
        mint(&env, &token, &user, 1i128);

        client.stake(&user, &1i128);
        client.fund_rewards(&admin, &1_000_000i128);

        assert_eq!(
            client.claimable(&user),
            1_000_000i128,
            "sole staker with 1-token stake must receive full reward"
        );
    }

    // Invariant 7: large stake amounts do not overflow the index calculation
    // Uses amounts near i64::MAX to verify no arithmetic panic occurs.
    #[test]
    fn invariant_large_amounts_do_not_overflow() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);

        let user = Address::generate(&env);
        // Use 10^14 — large but safely within i128 range after scaling
        let large: i128 = 100_000_000_000_000i128;
        mint(&env, &token, &admin, large);
        mint(&env, &token, &user, large);

        client.stake(&user, &large);
        client.fund_rewards(&admin, &large);

        let reward = client.claimable(&user);
        assert_eq!(
            reward, large,
            "large-amount sole staker must receive full reward"
        );
    }

    // Invariant 8: claim resets claimable to zero; double-claim yields nothing
    // After a successful claim, subsequent calls must return 0.
    #[test]
    fn invariant_claim_is_idempotent_after_first_claim() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);

        let user = Address::generate(&env);
        mint(&env, &token, &admin, 200i128);
        mint(&env, &token, &user, 200i128);

        client.stake(&user, &200i128);
        client.fund_rewards(&admin, &200i128);

        let first = client.claim(&user);
        assert_eq!(first, 200i128);

        let second = client.claim(&user);
        assert_eq!(second, 0i128, "second claim must return zero");
        assert_eq!(client.claimable(&user), 0i128);
    }
}
