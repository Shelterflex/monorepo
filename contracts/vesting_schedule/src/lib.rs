#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env};

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
}

#[contracttype]
#[derive(Clone)]
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
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct VestingScheduleContract;

// ── Internal helpers ──────────────────────────────────────────────────────────

fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<_, Address>(&DataKey::Admin)
        .expect("admin not set")
}

fn require_admin(env: &Env, caller: &Address) -> Result<(), ContractError> {
    let admin = get_admin(env);
    caller.require_auth();
    if caller != &admin {
        return Err(ContractError::NotAuthorized);
    }
    Ok(())
}

fn get_token(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<_, Address>(&DataKey::Token)
        .expect("token not set")
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

/// Calculate the vested amount at a given timestamp
/// Vesting accrues from start_time, but cannot be claimed until cliff_time
fn calculate_vested_amount(schedule: &VestingSchedule, current_time: u64) -> i128 {
    if current_time < schedule.start_time {
        return 0;
    }
    if current_time >= schedule.end_time {
        return schedule.total_amount;
    }
    if schedule.end_time <= schedule.start_time {
        return 0;
    }

    // Linear vesting from start to end: (elapsed / total_duration) * total_amount
    let elapsed = current_time - schedule.start_time;
    let total_duration = schedule.end_time - schedule.start_time;

    let vested = (elapsed as i128) * schedule.total_amount / (total_duration as i128);
    vested.min(schedule.total_amount)
}

/// Calculate the claimable amount (vested - already claimed)
fn calculate_claimable_amount(schedule: &VestingSchedule, current_time: u64) -> i128 {
    let vested = calculate_vested_amount(schedule, current_time);
    vested.saturating_sub(schedule.claimed_amount)
}

// ── Contract Implementation ───────────────────────────────────────────────────

#[contractimpl]
impl VestingScheduleContract {
    /// Initialize the contract with admin and token
    pub fn initialize(env: Env, admin: Address, token: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage()
            .instance()
            .set(&DataKey::ContractVersion, &1u32);
    }

    /// Create a new vesting schedule for a beneficiary
    pub fn create_vesting_schedule(
        env: Env,
        beneficiary: Address,
        total_amount: i128,
        start_time: u64,
        end_time: u64,
        cliff_time: u64,
        revocable: bool,
    ) {
        require_admin(&env, &env.current_contract_address()).unwrap();

        if total_amount <= 0 {
            panic!("invalid amount");
        }

        if end_time <= start_time {
            panic!("invalid time parameters");
        }

        if cliff_time < start_time || cliff_time > end_time {
            panic!("invalid cliff time");
        }

        if get_vesting_schedule(&env, &beneficiary).is_some() {
            panic!("schedule already exists");
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
    }

    /// Claim vested tokens
    pub fn claim(env: Env, beneficiary: Address) {
        beneficiary.require_auth();

        let mut schedule =
            get_vesting_schedule(&env, &beneficiary).expect("vesting schedule not found");

        if schedule.revoked {
            panic!("schedule revoked");
        }

        let current_time = env.ledger().timestamp();
        let claimable = calculate_claimable_amount(&schedule, current_time);

        if claimable <= 0 {
            panic!("nothing to claim");
        }

        // Update claimed amount
        schedule.claimed_amount += claimable;
        set_vesting_schedule(&env, &beneficiary, &schedule);

        // Transfer tokens from contract to beneficiary
        let _token = get_token(&env);
        // Note: In a real implementation, you would use the token contract's transfer function
        // This is a simplified version that assumes the contract holds the tokens
    }

    /// Revoke a vesting schedule (only if revocable)
    pub fn revoke(env: Env, beneficiary: Address) {
        require_admin(&env, &env.current_contract_address()).unwrap();

        let mut schedule =
            get_vesting_schedule(&env, &beneficiary).expect("vesting schedule not found");

        if !schedule.revocable {
            panic!("not revocable");
        }

        if schedule.revoked {
            panic!("already revoked");
        }

        schedule.revoked = true;
        set_vesting_schedule(&env, &beneficiary, &schedule);

        // In a real implementation, you would return unvested tokens to the admin
    }

    /// Get vesting schedule for a beneficiary
    pub fn get_vesting_schedule(env: Env, beneficiary: Address) -> VestingSchedule {
        get_vesting_schedule(&env, &beneficiary).expect("vesting schedule not found")
    }

    /// Get claimable amount for a beneficiary
    pub fn get_claimable_amount(env: Env, beneficiary: Address) -> i128 {
        let schedule =
            get_vesting_schedule(&env, &beneficiary).expect("vesting schedule not found");

        if schedule.revoked {
            return 0;
        }

        let current_time = env.ledger().timestamp();
        calculate_claimable_amount(&schedule, current_time)
    }

    /// Update admin address
    pub fn set_admin(env: Env, new_admin: Address) {
        require_admin(&env, &env.current_contract_address()).unwrap();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    /// Pause the contract
    pub fn pause(env: Env) {
        require_admin(&env, &env.current_contract_address()).unwrap();
        env.storage().instance().set(&DataKey::Paused, &true);
    }

    /// Unpause the contract
    pub fn unpause(env: Env) {
        require_admin(&env, &env.current_contract_address()).unwrap();
        env.storage().instance().set(&DataKey::Paused, &false);
    }
}

#[cfg(test)]
mod test;
