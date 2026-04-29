#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, Symbol, Vec};

// ── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
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
}

const SCALE: i128 = 1_000_000_000;

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    InvalidAmount = 3,
    /// Delegation to self is treated uniformly (allowed, same as direct stake)
    DelegationNotFound = 4,
    /// Partial delegation amounts exceed stake
    InsufficientStake = 5,
    /// Revocation requested in same epoch – must wait for epoch boundary
    RevocationTooEarly = 6,
    /// Delegatee is the same as delegator (self-delegation allowed, not errored)
    AlreadyDelegated = 7,
}

// ── Data Structures ───────────────────────────────────────────────────────────

/// A single delegation entry: delegator → delegatee for `amount` tokens.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Delegation {
    pub delegatee: Address,
    pub amount: i128,
    /// Epoch in which this delegation was activated
    pub activated_epoch: u64,
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
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::EpochDuration, &epoch_duration_secs);
        env.storage().instance().set(&DataKey::CurrentEpoch, &1u64);
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

    /// Admin bumps the epoch counter (or it can be driven by an epoch_rewards contract).
    pub fn advance_epoch(env: Env, admin: Address) -> Result<u64, ContractError> {
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

    // ── Staking ───────────────────────────────────────────────────────────────

    pub fn stake(env: Env, from: Address, amount: i128) -> Result<(), ContractError> {
        from.require_auth();
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        // Settle pending rewards for the delegatees before changing balance.
        Self::settle_all_delegates(&env, &from);

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

        // Delegated amounts reduce available unstakeable balance.
        let delegated = Self::total_delegated(&env, &from);
        let free = bal - delegated;
        if free < amount {
            return Err(ContractError::InsufficientStake);
        }

        Self::settle_all_delegates(&env, &from);

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

    /// Delegate `amount` of staked tokens to `delegatee`.
    /// Self-delegation is treated identically to direct staking.
    /// Partial delegation across multiple delegatees is supported.
    pub fn delegate(
        env: Env,
        delegator: Address,
        delegatee: Address,
        amount: i128,
    ) -> Result<(), ContractError> {
        delegator.require_auth();
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        // Check delegator has enough free (undelegated) stake
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

        // Settle existing delegatee pending rewards before updating
        Self::settle_pending_for(&env, &delegatee, reward_index);

        // Update delegatee stake
        let current_stake = Self::get_delegatee_stake(&env, &delegatee);
        env.storage().persistent().set(
            &DataKey::DelegateeStake(delegatee.clone()),
            &(current_stake + amount),
        );

        // Add to delegations list
        let delegations: Vec<Delegation> = env
            .storage()
            .persistent()
            .get(&DataKey::Delegations(delegator.clone()))
            .unwrap_or_else(|| Vec::new(&env));

        // Check for existing delegation to same delegatee
        let mut found = false;
        let mut new_delegations = Vec::new(&env);
        for d in delegations.iter() {
            if d.delegatee == delegatee {
                // Accumulate into existing entry
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

        // Emit reward-routing event
        env.events().publish(
            (
                Symbol::new(&env, "delegation"),
                Symbol::new(&env, "reward_routing"),
            ),
            (delegator, delegatee, amount),
        );

        Ok(())
    }

    /// Request revocation of a delegation. The revocation is enforced at the
    /// next epoch boundary to prevent mid-epoch gaming.
    pub fn request_revocation(
        env: Env,
        delegator: Address,
        delegatee: Address,
    ) -> Result<(), ContractError> {
        delegator.require_auth();

        // Verify delegation exists
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
        // Record the epoch of the revocation request (enforces boundary)
        env.storage().persistent().set(
            &DataKey::RevocationRequest(delegator.clone(), delegatee.clone()),
            &current_epoch,
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

    /// Finalize a revocation that was requested in a previous epoch.
    pub fn finalize_revocation(
        env: Env,
        delegator: Address,
        delegatee: Address,
    ) -> Result<(), ContractError> {
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

        // Must have crossed an epoch boundary
        if current_epoch <= requested_epoch {
            return Err(ContractError::RevocationTooEarly);
        }

        let reward_index = Self::get_reward_index(&env);
        Self::settle_pending_for(&env, &delegatee, reward_index);

        // Find delegation amount to remove
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

        // Remove delegation
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

        // Clear revocation request
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

    // ── Reward distribution ───────────────────────────────────────────────────

    pub fn fund_rewards(env: Env, admin: Address, amount: i128) -> Result<(), ContractError> {
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

    /// Claim rewards as a delegatee (rewards are credited to delegatee, not delegator).
    pub fn claim_delegatee_rewards(env: Env, delegatee: Address) -> Result<i128, ContractError> {
        delegatee.require_auth();

        let reward_index = Self::get_reward_index(&env);
        Self::settle_pending_for(&env, &delegatee, reward_index);

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

    pub fn get_delegatee_claimable(env: Env, delegatee: Address) -> i128 {
        let reward_index = Self::get_reward_index(&env);
        let delegatee_stake = Self::get_delegatee_stake(&env, &delegatee);
        let delegatee_index = Self::get_delegatee_index(&env, &delegatee);
        let mut live = 0;
        if delegatee_stake > 0 && reward_index > delegatee_index {
            live = delegatee_stake * (reward_index - delegatee_index) / SCALE;
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

    /// Settle pending reward index for a specific address.
    fn settle_pending_for(env: &Env, addr: &Address, current_reward_index: i128) {
        let delegatee_stake = Self::get_delegatee_stake(env, addr);
        let delegatee_index = Self::get_delegatee_index(env, addr);
        if delegatee_stake > 0 && current_reward_index > delegatee_index {
            let live_pending = delegatee_stake * (current_reward_index - delegatee_index) / SCALE;
            if live_pending > 0 {
                let banked: i128 = env
                    .storage()
                    .persistent()
                    .get(&DataKey::PendingRewards(addr.clone()))
                    .unwrap_or(0);
                env.storage().persistent().set(
                    &DataKey::PendingRewards(addr.clone()),
                    &(banked + live_pending),
                );
            }
        }
        env.storage().persistent().set(
            &DataKey::DelegateeRewardIndex(addr.clone()),
            &current_reward_index,
        );
    }

    /// Settle all delegatees of a delegator (called before stake changes).
    fn settle_all_delegates(env: &Env, delegator: &Address) {
        let reward_index = Self::get_reward_index(env);
        let delegations: Vec<Delegation> = env
            .storage()
            .persistent()
            .get(&DataKey::Delegations(delegator.clone()))
            .unwrap_or_else(|| Vec::new(env));
        for d in delegations.iter() {
            Self::settle_pending_for(env, &d.delegatee, reward_index);
        }
    }

    /// Sum of all active delegated amounts from a delegator.
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
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    extern crate std;

    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    fn setup(env: &Env) -> (Address, StakeDelegationClient<'_>) {
        env.mock_all_auths();
        let id = env.register(StakeDelegation, ());
        let client = StakeDelegationClient::new(env, &id);
        let admin = Address::generate(env);
        client.init(&admin, &100u64);
        (admin, client)
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

        // Cannot delegate more than free balance
        let result = client.try_delegate(&delegator, &d1, &400); // would exceed 1000 total
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

        // Stake and delegate
        client.stake(&delegator, &1_000);
        client.delegate(&delegator, &delegatee, &1_000);

        // Fund rewards
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

        // Request revocation in epoch 1
        client.request_revocation(&delegator, &delegatee);

        // Finalize in same epoch must fail
        let result = client.try_finalize_revocation(&delegator, &delegatee);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::RevocationTooEarly
        );

        // Advance epoch
        client.advance_epoch(&admin);

        // Now finalize should succeed
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
        // Self-delegation is valid
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
        assert_eq!(second, 0); // already consumed
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

        // Delegator's pending banked rewards should be 0 (rewards go to delegatee)
        assert_eq!(client.get_delegatee_claimable(&delegator), 0);
    }
}
