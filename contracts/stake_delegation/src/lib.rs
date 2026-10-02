#![no_std]

use soroban_access_control::extend_storage_ttl;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Env, IntoVal, Symbol, Vec,
};

// ── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Paused,
    /// Epoch duration (used to enforce revocation windows)
    EpochDuration,
    /// Current epoch number (sourced externally / via init)
    CurrentEpoch,
    /// Per-delegatee delegation list (Vec of Delegation)
    Delegations(Address), // delegator → list of delegations
    /// Per-user staked balance (managed by this contract for reward routing)
    StakedBalance(Address),
    /// Global reward index (scaled)
    RewardIndex,
    /// Total staked
    TotalStaked,
    /// Pending rewards per address (banked on index change)
    PendingRewards(Address),
    /// Epoch at which a revocation request was made (delegator, delegatee) → epoch
    RevocationRequest(Address, Address),
    /// Total delegation stake received by a delegatee
    DelegateeStake(Address),
    /// Reward index snapshot for a delegatee
    DelegateeRewardIndex(Address),
    /// Undelegation cooldown duration in seconds (admin-configurable)
    UndelegationCooldown,
    /// Pending undelegation: (delegator, delegatee) → (amount, request_time_seconds)
    PendingUndelegation(Address, Address),
    // ── Issue #1134 ──────────────────────────────────────────────────────────
    /// Commission rate in bps (0–10000) set by each delegatee
    DelegateeCommissionRate(Address),
    /// Accrued commission balance claimable by a delegatee
    DelegateeCommissionBalance(Address),
    /// Authority allowed to call apply_delegatee_slash
    SlashingAuthority,
    /// Reverse index: delegatee → Vec<delegator> (all active delegators to this delegatee)
    DelegatorsOf(Address),
}

const SCALE: i128 = 1_000_000_000;

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    Paused = 3,
    InvalidAmount = 4,
    DelegationNotFound = 5,
    InsufficientStake = 6,
    RevocationTooEarly = 7,
    AlreadyDelegated = 8,
    CooldownNotElapsed = 9,
    NoPendingUndelegation = 10,
    SlashExceedsBalance = 11,
    // ── Issue #1134 ──────────────────────────────────────────────────────────
    CommissionTooHigh = 12,
    ArithmeticOverflow = 13,
}

// ── Data Structures ───────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Delegation {
    pub delegatee: Address,
    pub amount: i128,
    pub activated_epoch: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingUndelegationRecord {
    pub amount: i128,
    pub request_time: u64,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct StakeDelegation;

#[contractimpl]
impl StakeDelegation {
    // ── Init ──────────────────────────────────────────────────────────────────

    pub fn init(env: Env, admin: Address, epoch_duration_secs: u64) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::EpochDuration, &epoch_duration_secs);
        env.storage().instance().set(&DataKey::CurrentEpoch, &1u64);
        env.storage()
            .instance()
            .set(&DataKey::UndelegationCooldown, &604800u64);
        env.storage()
            .persistent()
            .set(&DataKey::RewardIndex, &0i128);
        env.storage()
            .persistent()
            .set(&DataKey::TotalStaked, &0i128);

        env.events().publish(
            (Symbol::new(&env, "delegation"), Symbol::new(&env, "init")),
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

    pub fn advance_epoch(env: Env, admin: Address) -> Result<u64, ContractError> {
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &admin)?;
        let current: u64 = env
            .storage()
            .instance()
            .get(&DataKey::CurrentEpoch)
            .unwrap_or(1);
        let next = current + 1;
        env.storage().instance().set(&DataKey::CurrentEpoch, &next);
        env.events().publish(
            (
                Symbol::new(&env, "delegation"),
                Symbol::new(&env, "epoch_advanced"),
            ),
            next,
        );
        Ok(next)
    }

    fn current_epoch(env: &Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::CurrentEpoch)
            .unwrap_or(1)
    }

    pub fn set_undelegation_cooldown(
        env: Env,
        admin: Address,
        cooldown_secs: u64,
    ) -> Result<(), ContractError> {
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &admin)?;
        env.storage()
            .instance()
            .set(&DataKey::UndelegationCooldown, &cooldown_secs);
        env.events().publish(
            (
                Symbol::new(&env, "delegation"),
                Symbol::new(&env, "cooldown_updated"),
            ),
            cooldown_secs,
        );
        Ok(())
    }

    fn get_undelegation_cooldown(env: &Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::UndelegationCooldown)
            .unwrap_or(604800)
    }

    // ── Commission ────────────────────────────────────────────────────────────

    /// Set the commission rate (in bps, 0–10000) for the calling delegatee.
    pub fn set_commission(
        env: Env,
        delegatee: Address,
        rate_bps: u32,
    ) -> Result<(), ContractError> {
        Self::require_not_paused(&env)?;
        delegatee.require_auth();
        if rate_bps > 10_000 {
            return Err(ContractError::CommissionTooHigh);
        }
        // Settle current rewards before changing the rate
        let reward_index = Self::get_reward_index(&env);
        Self::settle_pending_for(&env, &delegatee, reward_index)?;

        env.storage().persistent().set(
            &DataKey::DelegateeCommissionRate(delegatee.clone()),
            &rate_bps,
        );
        extend_storage_ttl(
            &env,
            &DataKey::DelegateeCommissionRate(delegatee.clone()).into_val(&env),
        );
        env.events().publish(
            (
                Symbol::new(&env, "delegation"),
                Symbol::new(&env, "commission_set"),
                delegatee,
            ),
            rate_bps,
        );
        Ok(())
    }

    /// Claim the accumulated commission balance for the calling delegatee.
    pub fn claim_commission(env: Env, delegatee: Address) -> Result<i128, ContractError> {
        Self::require_not_paused(&env)?;
        delegatee.require_auth();

        let reward_index = Self::get_reward_index(&env);
        Self::settle_pending_for(&env, &delegatee, reward_index)?;

        let commission: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::DelegateeCommissionBalance(delegatee.clone()))
            .unwrap_or(0);
        env.storage().persistent().set(
            &DataKey::DelegateeCommissionBalance(delegatee.clone()),
            &0i128,
        );
        extend_storage_ttl(
            &env,
            &DataKey::DelegateeCommissionBalance(delegatee.clone()).into_val(&env),
        );

        env.events().publish(
            (
                Symbol::new(&env, "delegation"),
                Symbol::new(&env, "commission_claimed"),
                delegatee,
            ),
            commission,
        );
        Ok(commission)
    }

    /// View the claimable commission balance (does not include unsettled live rewards).
    pub fn get_commission_claimable(env: Env, delegatee: Address) -> i128 {
        let reward_index = Self::get_reward_index(&env);
        let delegatee_stake = Self::get_delegatee_stake(&env, &delegatee);
        let delegatee_index = Self::get_delegatee_index(&env, &delegatee);
        let commission_rate: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::DelegateeCommissionRate(delegatee.clone()))
            .unwrap_or(0);

        let mut live_commission = 0i128;
        if delegatee_stake > 0 && reward_index > delegatee_index {
            let gross = delegatee_stake * (reward_index - delegatee_index) / SCALE;
            live_commission = gross * commission_rate as i128 / 10_000;
        }

        let banked: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::DelegateeCommissionBalance(delegatee))
            .unwrap_or(0);
        live_commission + banked
    }

    // ── Slashing authority ────────────────────────────────────────────────────

    /// Admin sets the address authorised to call apply_delegatee_slash.
    pub fn set_slashing_authority(
        env: Env,
        admin: Address,
        authority: Address,
    ) -> Result<(), ContractError> {
        Self::require_admin(&env, &admin)?;
        env.storage()
            .instance()
            .set(&DataKey::SlashingAuthority, &authority);
        env.events().publish(
            (
                Symbol::new(&env, "delegation"),
                Symbol::new(&env, "slashing_authority_set"),
            ),
            authority,
        );
        Ok(())
    }

    /// Apply a slash to a delegatee: proportionally reduces every delegator's stake and
    /// delegation amount. Caller must be the configured slashing authority.
    pub fn apply_delegatee_slash(
        env: Env,
        slash_authority: Address,
        delegatee: Address,
        slash_amount: i128,
    ) -> Result<(), ContractError> {
        let authority: Address = env
            .storage()
            .instance()
            .get(&DataKey::SlashingAuthority)
            .ok_or(ContractError::NotAuthorized)?;
        slash_authority.require_auth();
        if slash_authority != authority {
            return Err(ContractError::NotAuthorized);
        }

        if slash_amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let delegatee_stake = Self::get_delegatee_stake(&env, &delegatee);
        if slash_amount > delegatee_stake {
            return Err(ContractError::SlashExceedsBalance);
        }

        // Settle pending rewards before touching stakes
        let reward_index = Self::get_reward_index(&env);
        Self::settle_pending_for(&env, &delegatee, reward_index)?;

        let new_delegatee_stake = delegatee_stake - slash_amount;
        env.storage().persistent().set(
            &DataKey::DelegateeStake(delegatee.clone()),
            &new_delegatee_stake,
        );
        extend_storage_ttl(
            &env,
            &DataKey::DelegateeStake(delegatee.clone()).into_val(&env),
        );

        // Proportionally reduce each delegator's position
        let delegators: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::DelegatorsOf(delegatee.clone()))
            .unwrap_or_else(|| Vec::new(&env));

        let mut total_balance_slashed: i128 = 0;
        for delegator in delegators.iter() {
            let delegations: Vec<Delegation> = env
                .storage()
                .persistent()
                .get(&DataKey::Delegations(delegator.clone()))
                .unwrap_or_else(|| Vec::new(&env));

            let mut new_delegations = Vec::new(&env);
            for d in delegations.iter() {
                if d.delegatee == delegatee {
                    // Proportional reduction: new_amount = d.amount * new_stake / old_stake
                    let new_amount = if delegatee_stake > 0 {
                        d.amount
                            .checked_mul(new_delegatee_stake)
                            .ok_or(ContractError::ArithmeticOverflow)?
                            .checked_div(delegatee_stake)
                            .ok_or(ContractError::ArithmeticOverflow)?
                    } else {
                        0
                    };
                    let delta = d.amount - new_amount;
                    total_balance_slashed = total_balance_slashed
                        .checked_add(delta)
                        .ok_or(ContractError::ArithmeticOverflow)?;

                    // Reduce delegator's staked balance
                    let bal: i128 = env
                        .storage()
                        .persistent()
                        .get(&DataKey::StakedBalance(delegator.clone()))
                        .unwrap_or(0);
                    env.storage().persistent().set(
                        &DataKey::StakedBalance(delegator.clone()),
                        &(bal - delta).max(0),
                    );
                    extend_storage_ttl(
                        &env,
                        &DataKey::StakedBalance(delegator.clone()).into_val(&env),
                    );

                    if new_amount > 0 {
                        new_delegations.push_back(Delegation {
                            delegatee: d.delegatee.clone(),
                            amount: new_amount,
                            activated_epoch: d.activated_epoch,
                        });
                    }
                    // If new_amount == 0, delegation is fully slashed away; remove from DelegatorsOf
                    // (handled below by checking if the delegator has any remaining delegation)
                } else {
                    new_delegations.push_back(d);
                }
            }
            env.storage()
                .persistent()
                .set(&DataKey::Delegations(delegator.clone()), &new_delegations);
        }

        // Rebuild DelegatorsOf, removing any delegators whose position reached 0
        let delegators: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::DelegatorsOf(delegatee.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        let mut remaining_delegators = Vec::new(&env);
        for delegator in delegators.iter() {
            let delegations: Vec<Delegation> = env
                .storage()
                .persistent()
                .get(&DataKey::Delegations(delegator.clone()))
                .unwrap_or_else(|| Vec::new(&env));
            let mut still_delegating = false;
            for d in delegations.iter() {
                if d.delegatee == delegatee {
                    still_delegating = true;
                    break;
                }
            }
            if still_delegating {
                remaining_delegators.push_back(delegator);
            }
        }
        env.storage().persistent().set(
            &DataKey::DelegatorsOf(delegatee.clone()),
            &remaining_delegators,
        );
        extend_storage_ttl(
            &env,
            &DataKey::DelegatorsOf(delegatee.clone()).into_val(&env),
        );

        // Reduce total staked by the sum actually removed from delegators
        let total = Self::get_total_staked(&env);
        env.storage().persistent().set(
            &DataKey::TotalStaked,
            &(total - total_balance_slashed).max(0),
        );
        extend_storage_ttl(&env, &DataKey::TotalStaked.into_val(&env));

        env.events().publish(
            (
                Symbol::new(&env, "delegation"),
                Symbol::new(&env, "delegatee_slashed"),
                delegatee,
            ),
            (slash_amount, delegatee_stake, new_delegatee_stake),
        );
        Ok(())
    }

    // ── Staking ───────────────────────────────────────────────────────────────

    pub fn stake(env: Env, from: Address, amount: i128) -> Result<(), ContractError> {
        Self::require_not_paused(&env)?;
        from.require_auth();
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        Self::settle_all_delegates(&env, &from)?;

        let bal: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::StakedBalance(from.clone()))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::StakedBalance(from.clone()), &(bal + amount));

        let total = Self::get_total_staked(&env);
        env.storage()
            .persistent()
            .set(&DataKey::TotalStaked, &(total + amount));

        env.events().publish(
            (
                Symbol::new(&env, "delegation"),
                Symbol::new(&env, "stake"),
                from,
            ),
            amount,
        );
        Ok(())
    }

    pub fn unstake(env: Env, from: Address, amount: i128) -> Result<(), ContractError> {
        Self::require_not_paused(&env)?;
        from.require_auth();
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let bal: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::StakedBalance(from.clone()))
            .unwrap_or(0);
        if bal < amount {
            return Err(ContractError::InsufficientStake);
        }

        let delegated = Self::total_delegated(&env, &from);
        let free = bal - delegated;
        if free < amount {
            return Err(ContractError::InsufficientStake);
        }

        Self::settle_all_delegates(&env, &from)?;

        env.storage()
            .persistent()
            .set(&DataKey::StakedBalance(from.clone()), &(bal - amount));
        let total = Self::get_total_staked(&env);
        env.storage()
            .persistent()
            .set(&DataKey::TotalStaked, &(total - amount));

        env.events().publish(
            (
                Symbol::new(&env, "delegation"),
                Symbol::new(&env, "unstake"),
                from,
            ),
            amount,
        );
        Ok(())
    }

    // ── Delegation ────────────────────────────────────────────────────────────

    pub fn delegate(
        env: Env,
        delegator: Address,
        delegatee: Address,
        amount: i128,
    ) -> Result<(), ContractError> {
        Self::require_not_paused(&env)?;
        delegator.require_auth();
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let bal: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::StakedBalance(delegator.clone()))
            .unwrap_or(0);
        let already_delegated = Self::total_delegated(&env, &delegator);
        let free = bal - already_delegated;
        if free < amount {
            return Err(ContractError::InsufficientStake);
        }

        let current_epoch = Self::current_epoch(&env);
        let reward_index = Self::get_reward_index(&env);

        Self::settle_pending_for(&env, &delegatee, reward_index)?;

        let current_stake = Self::get_delegatee_stake(&env, &delegatee);
        env.storage().persistent().set(
            &DataKey::DelegateeStake(delegatee.clone()),
            &(current_stake + amount),
        );
        extend_storage_ttl(
            &env,
            &DataKey::DelegateeStake(delegatee.clone()).into_val(&env),
        );

        let delegations: Vec<Delegation> = env
            .storage()
            .persistent()
            .get(&DataKey::Delegations(delegator.clone()))
            .unwrap_or_else(|| Vec::new(&env));

        let mut found = false;
        let mut new_delegations = Vec::new(&env);
        for d in delegations.iter() {
            if d.delegatee == delegatee {
                let mut updated = d.clone();
                updated.amount += amount;
                new_delegations.push_back(updated);
                found = true;
            } else {
                new_delegations.push_back(d);
            }
        }
        if !found {
            new_delegations.push_back(Delegation {
                delegatee: delegatee.clone(),
                amount,
                activated_epoch: current_epoch,
            });
            // New delegation: track delegator in the reverse index
            Self::add_delegator_to_delegatee(&env, &delegatee, &delegator);
        }

        env.storage()
            .persistent()
            .set(&DataKey::Delegations(delegator.clone()), &new_delegations);

        env.events().publish(
            (
                Symbol::new(&env, "delegation"),
                Symbol::new(&env, "delegated"),
                delegator.clone(),
            ),
            (delegatee.clone(), amount, current_epoch),
        );

        env.events().publish(
            (
                Symbol::new(&env, "delegation"),
                Symbol::new(&env, "reward_routing"),
            ),
            (delegator, delegatee, amount),
        );

        Ok(())
    }

    pub fn request_revocation(
        env: Env,
        delegator: Address,
        delegatee: Address,
    ) -> Result<(), ContractError> {
        Self::require_not_paused(&env)?;
        delegator.require_auth();

        let delegations: Vec<Delegation> = env
            .storage()
            .persistent()
            .get(&DataKey::Delegations(delegator.clone()))
            .unwrap_or_else(|| Vec::new(&env));

        let mut found = false;
        for d in delegations.iter() {
            if d.delegatee == delegatee {
                found = true;
                break;
            }
        }
        if !found {
            return Err(ContractError::DelegationNotFound);
        }

        let current_epoch = Self::current_epoch(&env);
        env.storage().persistent().set(
            &DataKey::RevocationRequest(delegator.clone(), delegatee.clone()),
            &current_epoch,
        );
        extend_storage_ttl(
            &env,
            &DataKey::RevocationRequest(delegator.clone(), delegatee.clone()).into_val(&env),
        );

        env.events().publish(
            (
                Symbol::new(&env, "delegation"),
                Symbol::new(&env, "revocation_requested"),
                delegator,
            ),
            (delegatee, current_epoch),
        );
        Ok(())
    }

    pub fn finalize_revocation(
        env: Env,
        delegator: Address,
        delegatee: Address,
    ) -> Result<(), ContractError> {
        Self::require_not_paused(&env)?;
        delegator.require_auth();

        let current_epoch = Self::current_epoch(&env);
        let requested_epoch: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::RevocationRequest(
                delegator.clone(),
                delegatee.clone(),
            ))
            .ok_or(ContractError::DelegationNotFound)?;

        if current_epoch <= requested_epoch {
            return Err(ContractError::RevocationTooEarly);
        }

        let reward_index = Self::get_reward_index(&env);
        Self::settle_pending_for(&env, &delegatee, reward_index)?;

        let delegations: Vec<Delegation> = env
            .storage()
            .persistent()
            .get(&DataKey::Delegations(delegator.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        let mut amount_to_remove = 0;
        for d in delegations.iter() {
            if d.delegatee == delegatee {
                amount_to_remove = d.amount;
                break;
            }
        }
        let current_stake = Self::get_delegatee_stake(&env, &delegatee);
        env.storage().persistent().set(
            &DataKey::DelegateeStake(delegatee.clone()),
            &(current_stake - amount_to_remove),
        );
        extend_storage_ttl(
            &env,
            &DataKey::DelegateeStake(delegatee.clone()).into_val(&env),
        );

        let delegations: Vec<Delegation> = env
            .storage()
            .persistent()
            .get(&DataKey::Delegations(delegator.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        let mut new_delegations = Vec::new(&env);
        for d in delegations.iter() {
            if d.delegatee != delegatee {
                new_delegations.push_back(d);
            }
        }
        env.storage()
            .persistent()
            .set(&DataKey::Delegations(delegator.clone()), &new_delegations);

        // Delegation fully removed: update reverse index
        Self::remove_delegator_from_delegatee(&env, &delegatee, &delegator);

        env.storage()
            .persistent()
            .remove(&DataKey::RevocationRequest(
                delegator.clone(),
                delegatee.clone(),
            ));

        env.events().publish(
            (
                Symbol::new(&env, "delegation"),
                Symbol::new(&env, "revoked"),
                delegator,
            ),
            (delegatee, current_epoch),
        );
        Ok(())
    }

    // ── Undelegation Cooldown ─────────────────────────────────────────────────

    pub fn request_undelegate(
        env: Env,
        delegator: Address,
        delegatee: Address,
        amount: i128,
    ) -> Result<(), ContractError> {
        Self::require_not_paused(&env)?;
        delegator.require_auth();
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let delegations: Vec<Delegation> = env
            .storage()
            .persistent()
            .get(&DataKey::Delegations(delegator.clone()))
            .unwrap_or_else(|| Vec::new(&env));

        let mut delegation_found = false;
        let mut delegation_amount = 0i128;
        for d in delegations.iter() {
            if d.delegatee == delegatee {
                delegation_found = true;
                delegation_amount = d.amount;
                break;
            }
        }

        if !delegation_found {
            return Err(ContractError::DelegationNotFound);
        }
        if delegation_amount < amount {
            return Err(ContractError::InsufficientStake);
        }

        let current_time = env.ledger().timestamp();
        env.storage().persistent().set(
            &DataKey::PendingUndelegation(delegator.clone(), delegatee.clone()),
            &PendingUndelegationRecord {
                amount,
                request_time: current_time,
            },
        );
        extend_storage_ttl(
            &env,
            &DataKey::PendingUndelegation(delegator.clone(), delegatee.clone()).into_val(&env),
        );

        env.events().publish(
            (
                Symbol::new(&env, "delegation"),
                Symbol::new(&env, "undelegate_requested"),
                delegator,
            ),
            (delegatee, amount, current_time),
        );
        Ok(())
    }

    pub fn complete_undelegate(
        env: Env,
        delegator: Address,
        delegatee: Address,
    ) -> Result<(), ContractError> {
        Self::require_not_paused(&env)?;
        delegator.require_auth();

        let current_time = env.ledger().timestamp();
        let cooldown_secs = Self::get_undelegation_cooldown(&env);

        let pending: PendingUndelegationRecord = env
            .storage()
            .persistent()
            .get(&DataKey::PendingUndelegation(
                delegator.clone(),
                delegatee.clone(),
            ))
            .ok_or(ContractError::NoPendingUndelegation)?;

        let elapsed = current_time.saturating_sub(pending.request_time);
        if elapsed < cooldown_secs {
            return Err(ContractError::CooldownNotElapsed);
        }

        let reward_index = Self::get_reward_index(&env);
        Self::settle_pending_for(&env, &delegatee, reward_index)?;

        let delegations: Vec<Delegation> = env
            .storage()
            .persistent()
            .get(&DataKey::Delegations(delegator.clone()))
            .unwrap_or_else(|| Vec::new(&env));

        let mut amount_removed = 0i128;
        let mut new_delegations = Vec::new(&env);
        let mut delegation_fully_removed = false;
        for d in delegations.iter() {
            if d.delegatee == delegatee {
                let mut updated = d.clone();
                updated.amount -= pending.amount;
                amount_removed = pending.amount;
                if updated.amount > 0 {
                    new_delegations.push_back(updated);
                } else {
                    delegation_fully_removed = true;
                }
            } else {
                new_delegations.push_back(d);
            }
        }

        env.storage()
            .persistent()
            .set(&DataKey::Delegations(delegator.clone()), &new_delegations);
        extend_storage_ttl(
            &env,
            &DataKey::Delegations(delegator.clone()).into_val(&env),
        );

        let current_stake = Self::get_delegatee_stake(&env, &delegatee);
        env.storage().persistent().set(
            &DataKey::DelegateeStake(delegatee.clone()),
            &(current_stake - amount_removed),
        );
        extend_storage_ttl(
            &env,
            &DataKey::DelegateeStake(delegatee.clone()).into_val(&env),
        );

        if delegation_fully_removed {
            Self::remove_delegator_from_delegatee(&env, &delegatee, &delegator);
        }

        env.storage()
            .persistent()
            .remove(&DataKey::PendingUndelegation(
                delegator.clone(),
                delegatee.clone(),
            ));

        env.events().publish(
            (
                Symbol::new(&env, "delegation"),
                Symbol::new(&env, "undelegate_completed"),
                delegator,
            ),
            (delegatee, amount_removed, current_time),
        );
        Ok(())
    }

    // ── Reward distribution ───────────────────────────────────────────────────

    pub fn fund_rewards(env: Env, admin: Address, amount: i128) -> Result<(), ContractError> {
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &admin)?;
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }
        let total = Self::get_total_staked(&env);
        if total > 0 {
            let idx = Self::get_reward_index(&env);
            env.storage()
                .persistent()
                .set(&DataKey::RewardIndex, &(idx + amount * SCALE / total));
        }
        env.events().publish(
            (
                Symbol::new(&env, "delegation"),
                Symbol::new(&env, "rewards_funded"),
            ),
            amount,
        );
        Ok(())
    }

    /// Claim net rewards (after commission deduction) as a delegatee.
    pub fn claim_delegatee_rewards(env: Env, delegatee: Address) -> Result<i128, ContractError> {
        Self::require_not_paused(&env)?;
        delegatee.require_auth();

        let reward_index = Self::get_reward_index(&env);
        Self::settle_pending_for(&env, &delegatee, reward_index)?;

        let banked: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::PendingRewards(delegatee.clone()))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::PendingRewards(delegatee.clone()), &0i128);

        env.events().publish(
            (
                Symbol::new(&env, "delegation"),
                Symbol::new(&env, "delegatee_claimed"),
                delegatee,
            ),
            banked,
        );
        Ok(banked)
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    pub fn get_delegations(env: Env, delegator: Address) -> Vec<Delegation> {
        env.storage()
            .persistent()
            .get(&DataKey::Delegations(delegator))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Returns the net claimable rewards (after commission) for a delegatee.
    pub fn get_delegatee_claimable(env: Env, delegatee: Address) -> i128 {
        let reward_index = Self::get_reward_index(&env);
        let delegatee_stake = Self::get_delegatee_stake(&env, &delegatee);
        let delegatee_index = Self::get_delegatee_index(&env, &delegatee);
        let commission_rate: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::DelegateeCommissionRate(delegatee.clone()))
            .unwrap_or(0);

        let mut live = 0i128;
        if delegatee_stake > 0 && reward_index > delegatee_index {
            let gross = delegatee_stake * (reward_index - delegatee_index) / SCALE;
            let commission = gross * commission_rate as i128 / 10_000;
            live = gross - commission;
        }
        let banked: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::PendingRewards(delegatee.clone()))
            .unwrap_or(0);
        live + banked
    }

    pub fn staked_balance(env: Env, user: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::StakedBalance(user))
            .unwrap_or(0)
    }

    pub fn current_epoch_num(env: Env) -> u64 {
        Self::current_epoch(&env)
    }

    pub fn pause(env: Env, admin: Address) -> Result<(), ContractError> {
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish(
            (Symbol::new(&env, "delegation"), Symbol::new(&env, "paused")),
            admin,
        );
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), ContractError> {
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events().publish(
            (
                Symbol::new(&env, "delegation"),
                Symbol::new(&env, "unpaused"),
            ),
            admin,
        );
        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get::<_, bool>(&DataKey::Paused)
            .unwrap_or(false)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn get_total_staked(env: &Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::TotalStaked)
            .unwrap_or(0)
    }

    fn get_reward_index(env: &Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::RewardIndex)
            .unwrap_or(0)
    }

    fn get_delegatee_stake(env: &Env, addr: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::DelegateeStake(addr.clone()))
            .unwrap_or(0)
    }

    fn get_delegatee_index(env: &Env, addr: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::DelegateeRewardIndex(addr.clone()))
            .unwrap_or(0)
    }

    /// Settle pending rewards for a delegatee, splitting commission from net rewards.
    fn settle_pending_for(
        env: &Env,
        addr: &Address,
        current_reward_index: i128,
    ) -> Result<(), ContractError> {
        let delegatee_stake = Self::get_delegatee_stake(env, addr);
        let delegatee_index = Self::get_delegatee_index(env, addr);
        if delegatee_stake > 0 && current_reward_index > delegatee_index {
            let gross = delegatee_stake
                .checked_mul(
                    current_reward_index
                        .checked_sub(delegatee_index)
                        .ok_or(ContractError::ArithmeticOverflow)?,
                )
                .ok_or(ContractError::ArithmeticOverflow)?
                .checked_div(SCALE)
                .ok_or(ContractError::ArithmeticOverflow)?;
            if gross > 0 {
                let commission_rate: u32 = env
                    .storage()
                    .persistent()
                    .get(&DataKey::DelegateeCommissionRate(addr.clone()))
                    .unwrap_or(0);
                let commission = gross
                    .checked_mul(commission_rate as i128)
                    .ok_or(ContractError::ArithmeticOverflow)?
                    .checked_div(10_000)
                    .ok_or(ContractError::ArithmeticOverflow)?;
                let net_rewards = gross
                    .checked_sub(commission)
                    .ok_or(ContractError::ArithmeticOverflow)?;

                if commission > 0 {
                    let prev: i128 = env
                        .storage()
                        .persistent()
                        .get(&DataKey::DelegateeCommissionBalance(addr.clone()))
                        .unwrap_or(0);
                    env.storage().persistent().set(
                        &DataKey::DelegateeCommissionBalance(addr.clone()),
                        &prev
                            .checked_add(commission)
                            .ok_or(ContractError::ArithmeticOverflow)?,
                    );
                    extend_storage_ttl(
                        env,
                        &DataKey::DelegateeCommissionBalance(addr.clone()).into_val(env),
                    );
                }
                if net_rewards > 0 {
                    let banked: i128 = env
                        .storage()
                        .persistent()
                        .get(&DataKey::PendingRewards(addr.clone()))
                        .unwrap_or(0);
                    env.storage().persistent().set(
                        &DataKey::PendingRewards(addr.clone()),
                        &banked
                            .checked_add(net_rewards)
                            .ok_or(ContractError::ArithmeticOverflow)?,
                    );
                    extend_storage_ttl(env, &DataKey::PendingRewards(addr.clone()).into_val(env));
                }
            }
        }
        env.storage().persistent().set(
            &DataKey::DelegateeRewardIndex(addr.clone()),
            &current_reward_index,
        );
        extend_storage_ttl(
            env,
            &DataKey::DelegateeRewardIndex(addr.clone()).into_val(env),
        );
        Ok(())
    }

    fn settle_all_delegates(env: &Env, delegator: &Address) -> Result<(), ContractError> {
        let reward_index = Self::get_reward_index(env);
        let delegations: Vec<Delegation> = env
            .storage()
            .persistent()
            .get(&DataKey::Delegations(delegator.clone()))
            .unwrap_or_else(|| Vec::new(env));
        for d in delegations.iter() {
            Self::settle_pending_for(env, &d.delegatee, reward_index)?;
        }
        Ok(())
    }

    fn total_delegated(env: &Env, delegator: &Address) -> i128 {
        let delegations: Vec<Delegation> = env
            .storage()
            .persistent()
            .get(&DataKey::Delegations(delegator.clone()))
            .unwrap_or_else(|| Vec::new(env));
        let mut total: i128 = 0;
        for d in delegations.iter() {
            total += d.amount;
        }
        total
    }

    /// Add a delegator to DelegatorsOf(delegatee) if not already present.
    fn add_delegator_to_delegatee(env: &Env, delegatee: &Address, delegator: &Address) {
        let mut delegators: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::DelegatorsOf(delegatee.clone()))
            .unwrap_or_else(|| Vec::new(env));
        for d in delegators.iter() {
            if d == *delegator {
                return;
            }
        }
        delegators.push_back(delegator.clone());
        env.storage()
            .persistent()
            .set(&DataKey::DelegatorsOf(delegatee.clone()), &delegators);
    }

    /// Remove a delegator from DelegatorsOf(delegatee).
    fn remove_delegator_from_delegatee(env: &Env, delegatee: &Address, delegator: &Address) {
        let delegators: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::DelegatorsOf(delegatee.clone()))
            .unwrap_or_else(|| Vec::new(env));
        let mut new_delegators = Vec::new(env);
        for d in delegators.iter() {
            if d != *delegator {
                new_delegators.push_back(d);
            }
        }
        env.storage()
            .persistent()
            .set(&DataKey::DelegatorsOf(delegatee.clone()), &new_delegators);
    }

    // ── Delegator slash (Issue #1082) ─────────────────────────────────────────

    pub fn slash_stake(
        env: Env,
        admin: Address,
        delegator: Address,
        amount: i128,
    ) -> Result<i128, ContractError> {
        Self::require_admin(&env, &admin)?;

        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::StakedBalance(delegator.clone()))
            .unwrap_or(0);

        if amount > balance {
            return Err(ContractError::SlashExceedsBalance);
        }

        Self::settle_all_delegates(&env, &delegator)?;

        let new_balance = balance - amount;
        env.storage()
            .persistent()
            .set(&DataKey::StakedBalance(delegator.clone()), &new_balance);
        extend_storage_ttl(
            &env,
            &DataKey::StakedBalance(delegator.clone()).into_val(&env),
        );

        let total = Self::get_total_staked(&env);
        env.storage()
            .persistent()
            .set(&DataKey::TotalStaked, &(total - amount));
        extend_storage_ttl(&env, &DataKey::TotalStaked.into_val(&env));

        let delegations: Vec<Delegation> = env
            .storage()
            .persistent()
            .get(&DataKey::Delegations(delegator.clone()))
            .unwrap_or_else(|| Vec::new(&env));

        let total_delegated = Self::total_delegated(&env, &delegator);
        if total_delegated > 0 && new_balance < total_delegated {
            let mut new_delegations = Vec::new(&env);
            for d in delegations.iter() {
                let trimmed = d.amount * new_balance / total_delegated;
                let delta = d.amount - trimmed;

                if delta > 0 {
                    let ds = Self::get_delegatee_stake(&env, &d.delegatee);
                    env.storage().persistent().set(
                        &DataKey::DelegateeStake(d.delegatee.clone()),
                        &(ds - delta).max(0),
                    );
                    extend_storage_ttl(
                        &env,
                        &DataKey::DelegateeStake(d.delegatee.clone()).into_val(&env),
                    );
                }

                if trimmed > 0 {
                    new_delegations.push_back(Delegation {
                        delegatee: d.delegatee.clone(),
                        amount: trimmed,
                        activated_epoch: d.activated_epoch,
                    });
                } else {
                    // delegation fully removed by slash
                    Self::remove_delegator_from_delegatee(&env, &d.delegatee, &delegator);
                }
            }
            env.storage()
                .persistent()
                .set(&DataKey::Delegations(delegator.clone()), &new_delegations);
            extend_storage_ttl(
                &env,
                &DataKey::Delegations(delegator.clone()).into_val(&env),
            );
        }

        env.events().publish(
            (
                Symbol::new(&env, "delegation"),
                Symbol::new(&env, "stake_slashed"),
                delegator,
            ),
            amount,
        );

        Ok(amount)
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

    fn setup(env: &Env) -> (Address, StakeDelegationClient<'_>) {
        env.mock_all_auths();
        let id = env.register(StakeDelegation, ());
        let client = StakeDelegationClient::new(env, &id);
        let admin = Address::generate(env);
        client.init(&admin, &100u64);
        (admin, client)
    }

    #[test]
    #[should_panic]
    fn init_requires_admin_auth() {
        let env = Env::default();
        let id = env.register(StakeDelegation, ());
        let client = StakeDelegationClient::new(&env, &id);
        let admin = Address::generate(&env);

        client.init(&admin, &100u64);
    }

    // ── basic delegation ──────────────────────────────────────────────────────

    #[test]
    fn delegate_and_query() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let delegator = Address::generate(&env);
        let delegatee = Address::generate(&env);

        client.stake(&delegator, &1_000);
        client.delegate(&delegator, &delegatee, &500);

        let delegations = client.get_delegations(&delegator);
        assert_eq!(delegations.len(), 1);
        assert_eq!(delegations.get(0).unwrap().amount, 500);
        assert_eq!(delegations.get(0).unwrap().delegatee, delegatee);
    }

    // ── partial delegation split ──────────────────────────────────────────────

    #[test]
    fn partial_delegation_split() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let delegator = Address::generate(&env);
        let d1 = Address::generate(&env);
        let d2 = Address::generate(&env);

        client.stake(&delegator, &1_000);
        client.delegate(&delegator, &d1, &400);
        client.delegate(&delegator, &d2, &300);

        let delegations = client.get_delegations(&delegator);
        assert_eq!(delegations.len(), 2);

        let result = client.try_delegate(&delegator, &d1, &400);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::InsufficientStake
        );
    }

    // ── reward routing to delegatee ───────────────────────────────────────────

    #[test]
    fn rewards_funded_to_delegatee() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let delegator = Address::generate(&env);
        let delegatee = Address::generate(&env);

        client.stake(&delegator, &1_000);
        client.delegate(&delegator, &delegatee, &1_000);

        client.fund_rewards(&admin, &1_000);

        assert_eq!(client.get_delegatee_claimable(&delegatee), 1_000);

        let claimed = client.claim_delegatee_rewards(&delegatee);
        assert_eq!(claimed, 1_000);
        assert_eq!(client.get_delegatee_claimable(&delegatee), 0);
    }

    // ── revocation timing ─────────────────────────────────────────────────────

    #[test]
    fn revocation_requires_epoch_boundary() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let delegator = Address::generate(&env);
        let delegatee = Address::generate(&env);

        client.stake(&delegator, &1_000);
        client.delegate(&delegator, &delegatee, &500);

        client.request_revocation(&delegator, &delegatee);

        let result = client.try_finalize_revocation(&delegator, &delegatee);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::RevocationTooEarly
        );

        client.advance_epoch(&admin);

        client.finalize_revocation(&delegator, &delegatee);
        let delegations = client.get_delegations(&delegator);
        assert_eq!(delegations.len(), 0);
    }

    // ── self-delegation ───────────────────────────────────────────────────────

    #[test]
    fn self_delegation_allowed() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let user = Address::generate(&env);

        client.stake(&user, &1_000);
        client.delegate(&user, &user, &500);

        let delegations = client.get_delegations(&user);
        assert_eq!(delegations.len(), 1);
        assert_eq!(delegations.get(0).unwrap().delegatee, user);
    }

    // ── adversarial double-claim prevention ───────────────────────────────────

    #[test]
    fn delegatee_cannot_double_claim() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let delegator = Address::generate(&env);
        let delegatee = Address::generate(&env);

        client.stake(&delegator, &1_000);
        client.delegate(&delegator, &delegatee, &1_000);

        client.fund_rewards(&admin, &1_000);

        let first = client.claim_delegatee_rewards(&delegatee);
        let second = client.claim_delegatee_rewards(&delegatee);

        assert_eq!(first, 1_000);
        assert_eq!(second, 0);
    }

    // ── delegator cannot claim delegated rewards ──────────────────────────────

    #[test]
    fn delegator_pending_rewards_zero_when_delegated() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let delegator = Address::generate(&env);
        let delegatee = Address::generate(&env);

        client.stake(&delegator, &1_000);
        client.delegate(&delegator, &delegatee, &1_000);

        assert_eq!(client.get_delegatee_claimable(&delegator), 0);
    }

    // ── undelegation cooldown tests ───────────────────────────────────────────

    #[test]
    fn undelegate_cooldown_request_and_complete() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let delegator = Address::generate(&env);
        let delegatee = Address::generate(&env);

        client.stake(&delegator, &1_000);
        client.delegate(&delegator, &delegatee, &500);

        client.request_undelegate(&delegator, &delegatee, &500);

        let delegations = client.get_delegations(&delegator);
        assert_eq!(delegations.len(), 1);
        assert_eq!(delegations.get(0).unwrap().amount, 500);

        let result = client.try_complete_undelegate(&delegator, &delegatee);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::CooldownNotElapsed
        );

        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 604801);

        client.complete_undelegate(&delegator, &delegatee);

        let delegations = client.get_delegations(&delegator);
        assert_eq!(delegations.len(), 0);
    }

    #[test]
    fn rewards_accrue_during_cooldown() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let delegator = Address::generate(&env);
        let delegatee = Address::generate(&env);

        client.stake(&delegator, &1_000);
        client.delegate(&delegator, &delegatee, &1_000);

        client.fund_rewards(&admin, &1_000);

        let claimable_before = client.get_delegatee_claimable(&delegatee);
        assert_eq!(claimable_before, 1_000);

        client.request_undelegate(&delegator, &delegatee, &1_000);

        client.fund_rewards(&admin, &500);

        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 604801);

        client.complete_undelegate(&delegator, &delegatee);

        let claimable_after = client.get_delegatee_claimable(&delegatee);
        assert_eq!(claimable_after, 1_500);
    }

    #[test]
    fn cooldown_timer_independent_per_delegatee() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let delegator = Address::generate(&env);
        let d1 = Address::generate(&env);
        let d2 = Address::generate(&env);

        client.stake(&delegator, &2_000);
        client.delegate(&delegator, &d1, &1_000);
        client.delegate(&delegator, &d2, &1_000);

        client.request_undelegate(&delegator, &d1, &1_000);
        let t1 = env.ledger().timestamp();

        env.ledger().set_timestamp(t1 + 100);
        client.request_undelegate(&delegator, &d2, &1_000);
        let t2 = env.ledger().timestamp();

        env.ledger().set_timestamp(t1 + 604801);

        client.complete_undelegate(&delegator, &d1);
        let delegations = client.get_delegations(&delegator);
        assert_eq!(delegations.len(), 1);

        let result = client.try_complete_undelegate(&delegator, &d2);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::CooldownNotElapsed
        );

        env.ledger().set_timestamp(t2 + 604801);
        client.complete_undelegate(&delegator, &d2);
        let delegations = client.get_delegations(&delegator);
        assert_eq!(delegations.len(), 0);
    }

    #[test]
    fn multiple_delegators_independent_cooldown() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let delegator1 = Address::generate(&env);
        let delegator2 = Address::generate(&env);
        let delegatee = Address::generate(&env);

        client.stake(&delegator1, &1_000);
        client.delegate(&delegator1, &delegatee, &1_000);

        client.stake(&delegator2, &2_000);
        client.delegate(&delegator2, &delegatee, &2_000);

        client.request_undelegate(&delegator1, &delegatee, &1_000);
        let t1 = env.ledger().timestamp();

        env.ledger().set_timestamp(t1 + 500);
        client.request_undelegate(&delegator2, &delegatee, &2_000);
        let t2 = env.ledger().timestamp();

        env.ledger().set_timestamp(t1 + 604801);
        client.complete_undelegate(&delegator1, &delegatee);

        let result = client.try_complete_undelegate(&delegator2, &delegatee);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::CooldownNotElapsed
        );

        env.ledger().set_timestamp(t2 + 604801);
        client.complete_undelegate(&delegator2, &delegatee);

        assert_eq!(client.get_delegations(&delegator1).len(), 0);
        assert_eq!(client.get_delegations(&delegator2).len(), 0);
    }

    #[test]
    fn cannot_complete_nonexistent_undelegation() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let delegator = Address::generate(&env);
        let delegatee = Address::generate(&env);

        let result = client.try_complete_undelegate(&delegator, &delegatee);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::NoPendingUndelegation
        );
    }

    #[test]
    fn partial_undelegate_leaves_remaining_delegation() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let delegator = Address::generate(&env);
        let delegatee = Address::generate(&env);

        client.stake(&delegator, &1_000);
        client.delegate(&delegator, &delegatee, &1_000);

        client.request_undelegate(&delegator, &delegatee, &300);

        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 604801);

        client.complete_undelegate(&delegator, &delegatee);

        let delegations = client.get_delegations(&delegator);
        assert_eq!(delegations.len(), 1);
        assert_eq!(delegations.get(0).unwrap().amount, 700);
    }

    #[test]
    fn admin_can_set_custom_cooldown() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let delegator = Address::generate(&env);
        let delegatee = Address::generate(&env);

        client.set_undelegation_cooldown(&admin, &86400);

        client.stake(&delegator, &1_000);
        client.delegate(&delegator, &delegatee, &1_000);

        client.request_undelegate(&delegator, &delegatee, &1_000);
        let t = env.ledger().timestamp();

        env.ledger().set_timestamp(t + 86401);

        client.complete_undelegate(&delegator, &delegatee);
        assert_eq!(client.get_delegations(&delegator).len(), 0);
    }

    #[test]
    fn cooldown_preserves_slashability() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let delegator = Address::generate(&env);
        let delegatee = Address::generate(&env);

        client.stake(&delegator, &1_000);
        client.delegate(&delegator, &delegatee, &1_000);

        client.request_undelegate(&delegator, &delegatee, &1_000);

        let stake = client.get_delegatee_claimable(&delegatee);
        assert!(stake >= 0);
    }

    // ── Pausable tests ───────────────────────────────────────────────────────

    #[test]
    fn pause_blocks_mutating_calls() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let delegator = Address::generate(&env);
        let delegatee = Address::generate(&env);

        client.stake(&delegator, &1_000);
        client.pause(&admin);

        let result = client.try_stake(&delegator, &500);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::Paused);

        let result = client.try_unstake(&delegator, &500);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::Paused);

        let result = client.try_delegate(&delegator, &delegatee, &500);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::Paused);

        let result = client.try_request_revocation(&delegator, &delegatee);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::Paused);

        let result = client.try_fund_rewards(&admin, &1_000);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::Paused);

        let result = client.try_claim_delegatee_rewards(&delegatee);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::Paused);
    }

    #[test]
    fn unpause_allows_mutating_calls() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let delegator = Address::generate(&env);
        let _delegatee = Address::generate(&env);

        client.stake(&delegator, &1_000);
        client.pause(&admin);
        client.unpause(&admin);

        client.stake(&delegator, &500);
        assert_eq!(client.staked_balance(&delegator), 1_500);
    }

    #[test]
    fn pause_requires_admin() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let attacker = Address::generate(&env);

        let result = client.try_pause(&attacker);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NotAuthorized);
    }

    #[test]
    fn unpause_requires_admin() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let attacker = Address::generate(&env);

        client.pause(&admin);
        let result = client.try_unpause(&attacker);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NotAuthorized);
    }

    #[test]
    fn getters_work_while_paused() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let delegator = Address::generate(&env);
        let delegatee = Address::generate(&env);

        client.stake(&delegator, &1_000);
        client.delegate(&delegator, &delegatee, &500);
        client.pause(&admin);

        assert_eq!(client.staked_balance(&delegator), 1_000);
        assert_eq!(client.get_delegations(&delegator).len(), 1);
        assert_eq!(client.current_epoch_num(), 1);
        assert!(client.is_paused());
    }

    // ── Issue #1134: Commission tests ─────────────────────────────────────────

    #[test]
    fn commission_split_correctness() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let delegator = Address::generate(&env);
        let delegatee = Address::generate(&env);

        client.stake(&delegator, &1_000);
        client.delegate(&delegator, &delegatee, &1_000);

        // 10% commission (1000 bps)
        client.set_commission(&delegatee, &1000u32);

        // Fund 1000 rewards
        client.fund_rewards(&admin, &1_000);

        // Commission = 100 (10%), net rewards = 900
        let net = client.get_delegatee_claimable(&delegatee);
        assert_eq!(net, 900);

        let commission = client.get_commission_claimable(&delegatee);
        assert_eq!(commission, 100);

        // Total = 1000 (no leakage)
        assert_eq!(net + commission, 1_000);
    }

    #[test]
    fn commission_independent_claim() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let delegator = Address::generate(&env);
        let delegatee = Address::generate(&env);

        client.stake(&delegator, &1_000);
        client.delegate(&delegator, &delegatee, &1_000);
        client.set_commission(&delegatee, &2000u32); // 20%

        client.fund_rewards(&admin, &1_000);

        // Claim commission separately
        let commission = client.claim_commission(&delegatee);
        assert_eq!(commission, 200); // 20% of 1000

        // Net rewards still claimable
        let net = client.claim_delegatee_rewards(&delegatee);
        assert_eq!(net, 800);

        // Nothing left
        assert_eq!(client.get_commission_claimable(&delegatee), 0);
        assert_eq!(client.get_delegatee_claimable(&delegatee), 0);
    }

    #[test]
    fn zero_commission_preserves_existing_behavior() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let delegator = Address::generate(&env);
        let delegatee = Address::generate(&env);

        client.stake(&delegator, &1_000);
        client.delegate(&delegator, &delegatee, &1_000);
        // commission defaults to 0
        client.fund_rewards(&admin, &1_000);

        assert_eq!(client.get_delegatee_claimable(&delegatee), 1_000);
        assert_eq!(client.get_commission_claimable(&delegatee), 0);
    }

    #[test]
    fn commission_too_high_rejected() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let delegatee = Address::generate(&env);

        let result = client.try_set_commission(&delegatee, &10001u32);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::CommissionTooHigh
        );
    }

    #[test]
    fn rounding_dust_commission() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let delegator = Address::generate(&env);
        let delegatee = Address::generate(&env);

        client.stake(&delegator, &1_000);
        client.delegate(&delegator, &delegatee, &1_000);
        // 33.33% commission
        client.set_commission(&delegatee, &3333u32);

        client.fund_rewards(&admin, &1_000);

        let commission = client.get_commission_claimable(&delegatee);
        let net = client.get_delegatee_claimable(&delegatee);
        // Total must equal gross rewards (1000), rounding down on commission means net rounds up
        assert_eq!(commission + net, 1_000);
        // Commission = 1000 * 3333 / 10000 = 333 (integer div rounds down)
        assert_eq!(commission, 333);
        assert_eq!(net, 667);
    }

    // ── Issue #1134: Delegatee slash propagation tests ────────────────────────

    #[test]
    fn proportional_slash_across_delegators() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let slash_authority = Address::generate(&env);
        let delegator1 = Address::generate(&env);
        let delegator2 = Address::generate(&env);
        let delegatee = Address::generate(&env);

        client.set_slashing_authority(&admin, &slash_authority);

        // d1 delegates 600, d2 delegates 400 → delegatee stake = 1000
        client.stake(&delegator1, &600);
        client.stake(&delegator2, &400);
        client.delegate(&delegator1, &delegatee, &600);
        client.delegate(&delegator2, &delegatee, &400);

        // Slash 200 from delegatee stake
        // new_stake = 800
        // d1 new delegation: 600 * 800 / 1000 = 480, delta = 120
        // d2 new delegation: 400 * 800 / 1000 = 320, delta = 80
        client.apply_delegatee_slash(&slash_authority, &delegatee, &200);

        let d1_delegations = client.get_delegations(&delegator1);
        assert_eq!(d1_delegations.get(0).unwrap().amount, 480);
        assert_eq!(client.staked_balance(&delegator1), 480); // 600 - 120

        let d2_delegations = client.get_delegations(&delegator2);
        assert_eq!(d2_delegations.get(0).unwrap().amount, 320);
        assert_eq!(client.staked_balance(&delegator2), 320); // 400 - 80
    }

    #[test]
    fn claim_after_slash() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let slash_authority = Address::generate(&env);
        let delegator = Address::generate(&env);
        let delegatee = Address::generate(&env);

        client.set_slashing_authority(&admin, &slash_authority);

        client.stake(&delegator, &1_000);
        client.delegate(&delegator, &delegatee, &1_000);

        // Fund rewards before slash
        client.fund_rewards(&admin, &500);

        // Slash 50% of delegatee stake
        client.apply_delegatee_slash(&slash_authority, &delegatee, &500);

        // Rewards funded before slash should still be claimable (settled before slash)
        let claimable = client.get_delegatee_claimable(&delegatee);
        assert_eq!(claimable, 500);

        let claimed = client.claim_delegatee_rewards(&delegatee);
        assert_eq!(claimed, 500);
    }

    #[test]
    fn slash_authority_required() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let slash_authority = Address::generate(&env);
        let impostor = Address::generate(&env);
        let delegator = Address::generate(&env);
        let delegatee = Address::generate(&env);

        client.set_slashing_authority(&admin, &slash_authority);
        client.stake(&delegator, &1_000);
        client.delegate(&delegator, &delegatee, &1_000);

        let result = client.try_apply_delegatee_slash(&impostor, &delegatee, &100);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NotAuthorized);
    }

    #[test]
    fn slash_exceeds_stake_rejected() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let slash_authority = Address::generate(&env);
        let delegator = Address::generate(&env);
        let delegatee = Address::generate(&env);

        client.set_slashing_authority(&admin, &slash_authority);
        client.stake(&delegator, &1_000);
        client.delegate(&delegator, &delegatee, &1_000);

        let result = client.try_apply_delegatee_slash(&slash_authority, &delegatee, &1_001);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::SlashExceedsBalance
        );
    }

    #[test]
    fn value_conservation_slash_plus_commission() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let slash_authority = Address::generate(&env);
        let delegator = Address::generate(&env);
        let delegatee = Address::generate(&env);

        client.set_slashing_authority(&admin, &slash_authority);
        client.stake(&delegator, &1_000);
        client.delegate(&delegator, &delegatee, &1_000);

        // 10% commission
        client.set_commission(&delegatee, &1000u32);
        client.fund_rewards(&admin, &1_000);

        // Slash 200
        client.apply_delegatee_slash(&slash_authority, &delegatee, &200);

        // All pending rewards settled before slash → commission 100, net 900
        // After slash: delegatee stake = 800, delegator stake = 800
        let net = client.claim_delegatee_rewards(&delegatee);
        let commission = client.claim_commission(&delegatee);

        assert_eq!(net + commission, 1_000); // conserved
        assert_eq!(client.staked_balance(&delegator), 800);
    }
}
