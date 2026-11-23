#![no_std]

//! Linear token vesting with an optional cliff and admin revocation.
//!
//! The admin funds a schedule by transferring `total_amount` of the configured
//! token into this contract. Nothing vests before `cliff_time`. From
//! `start_time` to `end_time` the allocation vests linearly, and the
//! beneficiary withdraws the vested-but-unclaimed amount with `claim`.
//!
//! `revoke` is only available on schedules created as revocable. It pays the
//! beneficiary whatever has vested so far and returns the unvested remainder
//! to the admin. The schedule is then truncated at the revocation time, so
//! nothing further vests.

use soroban_access_control::{extend_storage_ttl, require_admin_permission};
use soroban_pausable::{Pausable, PausableError};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Env, IntoVal, Symbol,
};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Token,
    Paused,
    Schedule(Address),
}

/// A beneficiary's vesting allocation.
///
/// Revocation truncates the schedule: `total_amount` and `claimed_amount` are
/// set to the amount vested at the revocation time, and `end_time` is set to
/// that time (or to `start_time` if revoked before it).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VestingSchedule {
    pub total_amount: i128,
    pub claimed_amount: i128,
    pub start_time: u64,
    pub cliff_time: u64,
    pub end_time: u64,
    pub revocable: bool,
    pub revoked: bool,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAuthorized = 3,
    Paused = 4,
    InvalidAmount = 5,
    InvalidSchedule = 6,
    ScheduleExists = 7,
    ScheduleNotFound = 8,
    NotRevocable = 9,
    AlreadyRevoked = 10,
    NothingToClaim = 11,
}

/// Amount of an allocation that has vested at `now`.
///
/// Returns 0 before the cliff. Returns `total` at or after `end`. In between,
/// vesting is linear from `start` to `end`, rounded down to ensure the beneficiary
/// can never claim more than `total`.
pub fn vested_amount(total: i128, start: u64, cliff: u64, end: u64, now: u64) -> i128 {
    if total <= 0 || now < cliff {
        return 0;
    }
    if now >= end {
        return total;
    }
    // Here start <= cliff <= now < end, so the duration is positive.
    let duration = (end - start) as i128;
    let elapsed = (now - start) as i128;
    // Split total = q * duration + r. Then total * elapsed / duration equals
    // q * elapsed + floor(r * elapsed / duration) exactly. q * elapsed never
    // exceeds total, and r * elapsed is computed in u128 because both factors
    // can be close to 2^64.
    let q = total / duration;
    let r = total % duration;
    let remainder_share = ((r as u128) * (elapsed as u128) / (duration as u128)) as i128;
    q * elapsed + remainder_share
}

fn claimable_at(schedule: &VestingSchedule, now: u64) -> i128 {
    let vested = vested_amount(
        schedule.total_amount,
        schedule.start_time,
        schedule.cliff_time,
        schedule.end_time,
        now,
    );
    (vested - schedule.claimed_amount).max(0)
}

fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(10_000, 500_000);
}

fn get_admin(env: &Env) -> Result<Address, ContractError> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(ContractError::NotInitialized)
}

fn get_token(env: &Env) -> Result<Address, ContractError> {
    env.storage()
        .instance()
        .get(&DataKey::Token)
        .ok_or(ContractError::NotInitialized)
}

fn require_admin(env: &Env, caller: &Address, operation: &str) -> Result<(), ContractError> {
    let admin = get_admin(env)?;
    require_admin_permission(env, &admin, caller, operation, ContractError::NotAuthorized)
}

fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<_, bool>(&DataKey::Paused)
        .unwrap_or(false)
}

fn require_not_paused(env: &Env) -> Result<(), ContractError> {
    if is_paused(env) {
        return Err(ContractError::Paused);
    }
    Ok(())
}

fn get_schedule(env: &Env, beneficiary: &Address) -> Option<VestingSchedule> {
    env.storage()
        .persistent()
        .get(&DataKey::Schedule(beneficiary.clone()))
}

fn put_schedule(env: &Env, beneficiary: &Address, schedule: &VestingSchedule) {
    let key = DataKey::Schedule(beneficiary.clone());
    env.storage().persistent().set(&key, schedule);
    extend_storage_ttl(env, &key.into_val(env));
}

#[contract]
pub struct VestingScheduleContract;

#[contractimpl]
impl Pausable for VestingScheduleContract {
    fn pause(env: Env, admin: Address) -> Result<(), PausableError> {
        require_admin(&env, &admin, "pause").map_err(|_| PausableError::NotAuthorized)?;
        env.storage().instance().set(&DataKey::Paused, &true);
        bump_instance(&env);
        env.events().publish(
            (Symbol::new(&env, "vesting"), Symbol::new(&env, "paused")),
            admin,
        );
        Ok(())
    }

    fn unpause(env: Env, admin: Address) -> Result<(), PausableError> {
        require_admin(&env, &admin, "unpause").map_err(|_| PausableError::NotAuthorized)?;
        env.storage().instance().set(&DataKey::Paused, &false);
        bump_instance(&env);
        env.events().publish(
            (Symbol::new(&env, "vesting"), Symbol::new(&env, "unpaused")),
            admin,
        );
        Ok(())
    }

    fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }
}

#[contractimpl]
impl VestingScheduleContract {
    /// Set the admin and the token that vests. Can only run once.
    pub fn initialize(env: Env, admin: Address, token: Address) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Paused, &false);
        bump_instance(&env);
        env.events().publish(
            (
                Symbol::new(&env, "vesting"),
                Symbol::new(&env, "initialized"),
            ),
            (admin, token),
        );
        Ok(())
    }

    /// Hand the admin role to `new_admin`. Only the current admin may call this.
    pub fn set_admin(env: Env, caller: Address, new_admin: Address) -> Result<(), ContractError> {
        require_admin(&env, &caller, "set_admin")?;
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        bump_instance(&env);
        env.events().publish(
            (Symbol::new(&env, "vesting"), Symbol::new(&env, "admin_set")),
            new_admin,
        );
        Ok(())
    }

    /// Fund a vesting schedule for `beneficiary` by transferring `total_amount`
    /// from the admin into this contract. Each beneficiary may hold one schedule.
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
        require_admin(&env, &admin, "create_vesting_schedule")?;

        if total_amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }
        if !(start_time < end_time && start_time <= cliff_time && cliff_time <= end_time) {
            return Err(ContractError::InvalidSchedule);
        }
        if get_schedule(&env, &beneficiary).is_some() {
            return Err(ContractError::ScheduleExists);
        }

        let token_client = token::Client::new(&env, &get_token(&env)?);
        token_client.transfer(&admin, &env.current_contract_address(), &total_amount);

        let schedule = VestingSchedule {
            total_amount,
            claimed_amount: 0,
            start_time,
            cliff_time,
            end_time,
            revocable,
            revoked: false,
        };
        put_schedule(&env, &beneficiary, &schedule);
        bump_instance(&env);

        env.events().publish(
            (
                Symbol::new(&env, "vesting"),
                Symbol::new(&env, "created"),
                beneficiary,
            ),
            (total_amount, start_time, cliff_time, end_time, revocable),
        );
        Ok(())
    }

    /// Transfer the vested-but-unclaimed amount to the beneficiary and return it.
    pub fn claim(env: Env, beneficiary: Address) -> Result<i128, ContractError> {
        beneficiary.require_auth();
        require_not_paused(&env)?;

        let mut schedule =
            get_schedule(&env, &beneficiary).ok_or(ContractError::ScheduleNotFound)?;
        let claimable = claimable_at(&schedule, env.ledger().timestamp());
        if claimable <= 0 {
            return Err(ContractError::NothingToClaim);
        }

        schedule.claimed_amount += claimable;
        put_schedule(&env, &beneficiary, &schedule);
        bump_instance(&env);

        let token_client = token::Client::new(&env, &get_token(&env)?);
        token_client.transfer(&env.current_contract_address(), &beneficiary, &claimable);

        env.events().publish(
            (
                Symbol::new(&env, "vesting"),
                Symbol::new(&env, "claimed"),
                beneficiary,
            ),
            claimable,
        );
        Ok(claimable)
    }

    /// Revoke a revocable schedule. The beneficiary receives the vested amount
    /// they have not yet claimed, the admin receives the unvested remainder,
    /// and the schedule is truncated at the current time. Returns the amount
    /// returned to the admin.
    pub fn revoke(env: Env, admin: Address, beneficiary: Address) -> Result<i128, ContractError> {
        require_admin(&env, &admin, "revoke")?;

        let mut schedule =
            get_schedule(&env, &beneficiary).ok_or(ContractError::ScheduleNotFound)?;
        if !schedule.revocable {
            return Err(ContractError::NotRevocable);
        }
        if schedule.revoked {
            return Err(ContractError::AlreadyRevoked);
        }

        let now = env.ledger().timestamp();
        let vested = vested_amount(
            schedule.total_amount,
            schedule.start_time,
            schedule.cliff_time,
            schedule.end_time,
            now,
        );
        // Vesting is monotonic, so anything already claimed is at most `vested`.
        let to_beneficiary = vested - schedule.claimed_amount;
        let to_admin = schedule.total_amount - vested;

        // Freeze the schedule at `vested`. Its end moves to the revocation time
        // (never before start), so the linear formula returns `vested` from then on.
        let cutoff = now.max(schedule.start_time);
        schedule.total_amount = vested;
        schedule.claimed_amount = vested;
        schedule.end_time = cutoff;
        schedule.cliff_time = schedule.cliff_time.min(cutoff);
        schedule.revoked = true;
        put_schedule(&env, &beneficiary, &schedule);
        bump_instance(&env);

        let token_client = token::Client::new(&env, &get_token(&env)?);
        let contract = env.current_contract_address();
        if to_beneficiary > 0 {
            token_client.transfer(&contract, &beneficiary, &to_beneficiary);
        }
        if to_admin > 0 {
            token_client.transfer(&contract, &admin, &to_admin);
        }

        env.events().publish(
            (
                Symbol::new(&env, "vesting"),
                Symbol::new(&env, "revoked"),
                beneficiary,
            ),
            (to_beneficiary, to_admin),
        );
        Ok(to_admin)
    }

    /// The schedule for `beneficiary`, or `None` if there is none.
    pub fn get_vesting_schedule(env: Env, beneficiary: Address) -> Option<VestingSchedule> {
        get_schedule(&env, &beneficiary)
    }

    /// Vested-but-unclaimed amount for `beneficiary` at the current ledger time.
    /// Returns 0 when there is no schedule.
    pub fn get_claimable_amount(env: Env, beneficiary: Address) -> i128 {
        let now = env.ledger().timestamp();
        get_schedule(&env, &beneficiary)
            .map(|schedule| claimable_at(&schedule, now))
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod test;
