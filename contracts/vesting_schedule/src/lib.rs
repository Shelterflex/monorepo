#![no_std]
// Soroban contractimpl methods often need >7 args (e.g. all the fields of a
// vesting schedule). The auto-generated client mirrors each signature, so the
// allow has to cover the whole crate rather than a single function.
#![allow(clippy::too_many_arguments)]

#[cfg(kani)]
mod formal_properties;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env,
};

// ── Storage keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    ContractVersion,
    Admin,
    Paused,
    /// Vesting schedule for a beneficiary
    VestingSchedule(Address),
    /// Token address being vested
    Token,
    /// Reentrancy lock for cross-contract call protection
    Reentrancy,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VestingSchedule {
    /// Beneficiary address
    pub beneficiary: Address,
    /// Total amount to vest
    pub total_amount: i128,
    /// Amount already claimed
    pub claimed_amount: i128,
    /// Start timestamp (in seconds)
    pub start_time: u64,
    /// End timestamp (in seconds)
    pub end_time: u64,
    /// Cliff timestamp (in seconds) - before this, no tokens can be claimed
    pub cliff_time: u64,
    /// Whether the schedule is revocable
    pub revocable: bool,
    /// Whether the schedule has been revoked
    pub revoked: bool,
}

// ── Errors ───────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    Paused = 3,
    InvalidAmount = 4,
    InsufficientBalance = 5,
    /// Vesting schedule does not exist
    ScheduleNotFound = 6,
    /// Vesting schedule already exists for beneficiary
    ScheduleAlreadyExists = 7,
    /// Invalid time parameters (end_time <= start_time)
    InvalidTimeParameters = 8,
    /// Cliff time must be between start and end time
    InvalidCliffTime = 9,
    /// Cannot claim before cliff time
    CliffNotReached = 10,
    /// Schedule is not revocable
    NotRevocable = 11,
    /// Schedule already revoked
    AlreadyRevoked = 12,
    /// Token not set
    TokenNotSet = 13,
    /// Schedule has been revoked; cannot claim
    Revoked = 14,
    /// Nothing left to claim
    NothingToClaim = 15,
    /// Reentrancy detected — nested call rejected
    ReentrancyDetected = 16,
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct VestingScheduleContract;

// ── Internal helpers ──────────────────────────────────────────────────────────

fn get_admin(env: &Env) -> Result<Address, ContractError> {
    env.storage()
        .instance()
        .get::<_, Address>(&DataKey::Admin)
        .ok_or(ContractError::NotAuthorized)
}

fn require_admin(env: &Env, caller: &Address) -> Result<(), ContractError> {
    let admin = get_admin(env)?;
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

/// Reentrancy guard helpers
fn enter_nonreentrant(env: &Env) -> Result<(), ContractError> {
    if env
        .storage()
        .instance()
        .get::<_, bool>(&DataKey::Reentrancy)
        .unwrap_or(false)
    {
        return Err(ContractError::ReentrancyDetected);
    }
    env.storage().instance().set(&DataKey::Reentrancy, &true);
    Ok(())
}

fn exit_nonreentrant(env: &Env) {
    env.storage().instance().set(&DataKey::Reentrancy, &false);
}

/// Scope guard that ensures reentrancy lock is released on drop
struct ReentrancyGuard<'a> {
    env: &'a Env,
}

impl<'a> ReentrancyGuard<'a> {
    fn new(env: &'a Env) -> Result<Self, ContractError> {
        enter_nonreentrant(env)?;
        Ok(ReentrancyGuard { env })
    }
}

impl<'a> Drop for ReentrancyGuard<'a> {
    fn drop(&mut self) {
        exit_nonreentrant(self.env);
    }
}

fn get_vesting_schedule(env: &Env, beneficiary: &Address) -> Option<VestingSchedule> {
    env.storage()
        .instance()
        .get::<_, VestingSchedule>(&DataKey::VestingSchedule(beneficiary.clone()))
}

fn set_vesting_schedule(env: &Env, beneficiary: &Address, schedule: &VestingSchedule) {
    env.storage()
        .instance()
        .set(&DataKey::VestingSchedule(beneficiary.clone()), schedule);
}

/// Calculate the vested amount at a given timestamp.
///
/// Vesting accrues linearly from start_time to end_time. The cliff is enforced
/// at the *claim* layer — before the cliff is reached, no tokens are claimable
/// even though vesting has technically started accruing.
pub fn calculate_vested_amount(schedule: &VestingSchedule, current_time: u64) -> i128 {
    if current_time < schedule.start_time {
        return 0;
    }
    if current_time >= schedule.end_time {
        return schedule.total_amount;
    }
    if schedule.end_time <= schedule.start_time {
        return 0;
    }

    let elapsed = current_time - schedule.start_time;
    let total_duration = schedule.end_time - schedule.start_time;

    let vested = (elapsed as i128) * schedule.total_amount / (total_duration as i128);
    vested.min(schedule.total_amount)
}

/// Calculate the claimable amount (vested - already claimed). Returns 0
/// before the cliff is reached.
pub fn calculate_claimable_amount(schedule: &VestingSchedule, current_time: u64) -> i128 {
    if current_time < schedule.cliff_time {
        return 0;
    }
    let vested = calculate_vested_amount(schedule, current_time);
    vested.saturating_sub(schedule.claimed_amount)
}

// ── Contract Implementation ───────────────────────────────────────────────────

#[contractimpl]
impl VestingScheduleContract {
    /// Initialize the contract with admin and token. Idempotent — a second
    /// call returns `AlreadyInitialized`.
    pub fn initialize(env: Env, admin: Address, token: Address) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage()
            .instance()
            .set(&DataKey::ContractVersion, &1u32);

        Ok(())
    }

    /// Create a new vesting schedule for a beneficiary. Admin-only.
    pub fn create_vesting_schedule(
        env: Env,
        admin: Address,
        beneficiary: Address,
        total_amount: i128,
        start_time: u64,
        end_time: u64,
        cliff_time: u64,
        revocable: bool,
    ) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;

        if total_amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }
        if end_time <= start_time {
            return Err(ContractError::InvalidTimeParameters);
        }
        if cliff_time < start_time || cliff_time > end_time {
            return Err(ContractError::InvalidCliffTime);
        }
        if get_vesting_schedule(&env, &beneficiary).is_some() {
            return Err(ContractError::ScheduleAlreadyExists);
        }

        let schedule = VestingSchedule {
            beneficiary: beneficiary.clone(),
            total_amount,
            claimed_amount: 0,
            start_time,
            end_time,
            cliff_time,
            revocable,
            revoked: false,
        };

        set_vesting_schedule(&env, &beneficiary, &schedule);

        env.events().publish(
            (symbol_short!("vesting"), symbol_short!("created")),
            (
                beneficiary,
                total_amount,
                start_time,
                end_time,
                cliff_time,
                revocable,
            ),
        );

        Ok(())
    }

    /// Claim vested tokens for the beneficiary. Returns the amount actually
    /// claimed in this call. Honours pause, cliff, and revocation.
    pub fn claim(env: Env, beneficiary: Address) -> Result<i128, ContractError> {
        require_not_paused(&env)?;
        beneficiary.require_auth();

        let mut schedule =
            get_vesting_schedule(&env, &beneficiary).ok_or(ContractError::ScheduleNotFound)?;

        if schedule.revoked {
            return Err(ContractError::Revoked);
        }

        let current_time = env.ledger().timestamp();
        if current_time < schedule.cliff_time {
            return Err(ContractError::CliffNotReached);
        }

        let claimable = calculate_claimable_amount(&schedule, current_time);
        if claimable <= 0 {
            return Err(ContractError::NothingToClaim);
        }

        schedule.claimed_amount += claimable;
        set_vesting_schedule(&env, &beneficiary, &schedule);

        // Reentrancy guard before external operations - uses scope guard for automatic release
        let _guard = ReentrancyGuard::new(&env)?;

        env.events().publish(
            (symbol_short!("vesting"), symbol_short!("claimed")),
            (beneficiary, claimable, current_time),
        );

        Ok(claimable)
    }

    /// Revoke a vesting schedule (only if revocable). Admin-only. Returns the
    /// amount that would be returned to the admin (total - already claimed).
    pub fn revoke(env: Env, admin: Address, beneficiary: Address) -> Result<i128, ContractError> {
        require_admin(&env, &admin)?;

        let mut schedule =
            get_vesting_schedule(&env, &beneficiary).ok_or(ContractError::ScheduleNotFound)?;

        if !schedule.revocable {
            return Err(ContractError::NotRevocable);
        }
        if schedule.revoked {
            return Err(ContractError::AlreadyRevoked);
        }

        let unclaimed = schedule
            .total_amount
            .checked_sub(schedule.claimed_amount)
            .unwrap_or(0);
        schedule.revoked = true;
        set_vesting_schedule(&env, &beneficiary, &schedule);

        // Reentrancy guard before external operations - uses scope guard for automatic release
        let _guard = ReentrancyGuard::new(&env)?;

        env.events().publish(
            (symbol_short!("vesting"), symbol_short!("revoked")),
            (beneficiary, unclaimed),
        );

        Ok(unclaimed)
    }

    /// Get vesting schedule for a beneficiary
    pub fn get_vesting_schedule(
        env: Env,
        beneficiary: Address,
    ) -> Result<VestingSchedule, ContractError> {
        get_vesting_schedule(&env, &beneficiary).ok_or(ContractError::ScheduleNotFound)
    }

    /// Get claimable amount for a beneficiary
    pub fn get_claimable_amount(env: Env, beneficiary: Address) -> Result<i128, ContractError> {
        let schedule =
            get_vesting_schedule(&env, &beneficiary).ok_or(ContractError::ScheduleNotFound)?;

        if schedule.revoked {
            return Ok(0);
        }

        let current_time = env.ledger().timestamp();
        Ok(calculate_claimable_amount(&schedule, current_time))
    }

    /// Update admin address
    pub fn set_admin(env: Env, admin: Address, new_admin: Address) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        Ok(())
    }

    /// Pause the contract
    pub fn pause(env: Env, admin: Address) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &true);
        Ok(())
    }

    /// Unpause the contract
    pub fn unpause(env: Env, admin: Address) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &false);
        Ok(())
    }

    /// True iff the contract is currently paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get::<_, bool>(&DataKey::Paused)
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod test;
