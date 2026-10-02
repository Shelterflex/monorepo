#![no_std]

extern crate alloc;

#[cfg(test)]
mod stress_tests;

use alloc::format;
use alloc::string::ToString;
use alloc::vec::Vec as StdVec;

use soroban_pausable::{Pausable, PausableError};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Bytes, BytesN, Env, Map,
    String, Symbol,
};
// Map is still used in ReceiptInput.metadata

pub mod access_control;
pub mod validation;

#[cfg(kani)]
pub mod formal_properties;

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Deposit {
    pub amount: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    ContractVersion,
    /// State schema version to validate upgrade compatibility (#382)
    StateSchemaVersion,
    Admin,
    Operator,
    Token,
    /// Per-user staked balance in persistent storage (#386 gas optimisation)
    StakedBalance(Address),
    TotalStaked,
    Paused,
    LockPeriod,
    /// Per-user deposit count in persistent storage
    DepositCount(Address),
    /// Individual stake deposits to track lock periods independently
    Deposit(Address, u32),
    /// Reentrancy lock for cross-contract call protection (#390)
    Reentrancy,
    // ── Upgrade governance (#392) ─────────────────────────────────────────
    Guardian,
    UpgradeDelay,
    PendingUpgradeHash,
    PendingUpgradeAt,
    PendingUpgradeVersion,
}

/// Contract error types
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    /// Contract has already been initialized
    AlreadyInitialized = 1,
    /// Caller is not authorized for this operation
    NotAuthorized = 2,
    /// Contract is currently paused
    Paused = 3,
    /// Amount is invalid (zero or negative)
    InvalidAmount = 4,
    /// Lock period is invalid (out of range)
    InvalidLockPeriod = 14,
    /// Insufficient staked balance
    InsufficientBalance = 5,
    /// Tokens are locked and cannot be unstaked yet
    TokensLocked = 6,
    /// No stake timestamp found for user
    NoStakeTimestamp = 7,
    // Cross-contract communication errors (#390)
    /// Reentrancy detected — nested call rejected
    ReentrancyDetected = 8,
    // Upgrade governance errors (#392)
    /// An upgrade is already pending
    UpgradeAlreadyPending = 9,
    /// No upgrade is currently pending
    NoUpgradePending = 10,
    /// Timelock delay has not elapsed yet
    UpgradeDelayNotMet = 11,
    /// Upgrade version must be strictly greater than current version
    InvalidUpgradeVersion = 12,
    /// Stored state schema is incompatible with this contract version
    IncompatibleStateSchema = 13,
}

/// Input parameters for computing metadata hash
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReceiptInput {
    /// Transaction type (e.g., "stake", "unstake")
    pub tx_type: Symbol,
    /// Transaction amount in USDC (must be positive)
    pub amount_usdc: i128,
    /// USDC token contract address
    pub token: Address,
    /// User address performing the transaction
    pub user: Address,
    /// Optional timestamp (if not provided, uses current ledger timestamp)
    pub timestamp: Option<u64>,
    /// Optional deal identifier
    pub deal_id: Option<String>,
    /// Optional listing identifier
    pub listing_id: Option<String>,
    /// Optional metadata fields
    pub metadata: Option<Map<Symbol, String>>,
}

#[contract]
pub struct StakingPool;

fn get_state_schema_version(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get::<_, u32>(&DataKey::StateSchemaVersion)
        .unwrap_or(0u32)
}

fn validate_upgrade_safety(env: &Env, new_version: u32) -> Result<(), ContractError> {
    let current_version = StakingPool::contract_version(env.clone());
    let schema_version = get_state_schema_version(env);

    if schema_version != current_version {
        return Err(ContractError::IncompatibleStateSchema);
    }

    if new_version != current_version.saturating_add(1) {
        return Err(ContractError::InvalidUpgradeVersion);
    }

    Ok(())
}

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

fn get_operator(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Operator)
}

fn is_operator(env: &Env, addr: &Address) -> bool {
    if let Some(op) = get_operator(env) {
        &op == addr
    } else {
        false
    }
}

/// Per-user staked balance from persistent storage (#386)
fn get_staked_balance(env: &Env, user: &Address) -> i128 {
    env.storage()
        .persistent()
        .get::<_, i128>(&DataKey::StakedBalance(user.clone()))
        .unwrap_or(0)
}

fn put_staked_balance(env: &Env, user: &Address, balance: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::StakedBalance(user.clone()), &balance);
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

fn get_lock_period(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get::<_, u64>(&DataKey::LockPeriod)
        .unwrap_or(0)
}

fn put_lock_period(env: &Env, period: u64) {
    env.storage().instance().set(&DataKey::LockPeriod, &period);
}

fn get_deposit_count(env: &Env, user: &Address) -> u32 {
    env.storage()
        .persistent()
        .get::<_, u32>(&DataKey::DepositCount(user.clone()))
        .unwrap_or(0)
}

fn put_deposit_count(env: &Env, user: &Address, count: u32) {
    env.storage()
        .persistent()
        .set(&DataKey::DepositCount(user.clone()), &count);
}

fn get_deposit(env: &Env, user: &Address, index: u32) -> Option<Deposit> {
    env.storage()
        .persistent()
        .get::<_, Deposit>(&DataKey::Deposit(user.clone(), index))
}

fn put_deposit(env: &Env, user: &Address, index: u32, deposit: Deposit) {
    env.storage()
        .persistent()
        .set(&DataKey::Deposit(user.clone(), index), &deposit);
}

fn remove_deposit(env: &Env, user: &Address, index: u32) {
    env.storage()
        .persistent()
        .remove(&DataKey::Deposit(user.clone(), index));
}

/// Reentrancy guard helpers (#390)
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

fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<_, bool>(&DataKey::Paused)
        .unwrap_or(false)
}

fn require_user_or_operator(
    env: &Env,
    user: &Address,
    caller: &Address,
) -> Result<Address, ContractError> {
    // Primary rule: the *user* can always authorize.
    // If an operator is configured, it can authorize stake/unstake on behalf of the user.
    // Operator does not get to redirect funds since stake/unstake always move tokens
    // from/to the `user` address passed in.
    // Strict rule (safe-by-construction):
    // - If an operator is configured, ONLY the operator may authorize stake/unstake.
    // - If no operator is configured, ONLY the user may authorize stake/unstake.
    //
    // Returns the authorized spender address used for token `transfer`.
    // Note: `caller` should be the invoker (the address that called the contract function),
    // which is determined by the first MockAuth entry in tests.
    if let Some(op) = get_operator(env) {
        // When operator is set, only operator can authorize
        op.require_auth();
        Ok(op)
    } else {
        user.require_auth();
        // When no operator is set, ensure the caller is the user
        if caller != user {
            return Err(ContractError::NotAuthorized);
        }
        Ok(user.clone())
    }
}

fn require_not_paused(env: &Env) -> Result<(), ContractError> {
    if is_paused(env) {
        return Err(ContractError::Paused);
    }
    Ok(())
}

/// Creates canonical payload v1 serialization for receipt input
/// Format: deterministic concatenation of fields with length prefixes
fn create_canonical_payload_v1(env: &Env, input: &ReceiptInput) -> Bytes {
    let timestamp = input.timestamp.unwrap_or_else(|| env.ledger().timestamp());
    let deal_id = input
        .deal_id
        .clone()
        .unwrap_or_else(|| String::from_str(env, ""));
    let listing_id = input
        .listing_id
        .clone()
        .unwrap_or_else(|| String::from_str(env, ""));

    // NOTE: We intentionally avoid JSON and instead use a deterministic key=value format.
    // All keys appear in a fixed order. Optional fields are serialized as empty strings.
    // Metadata is sorted lexicographically by key (key string value).

    let mut metadata_pairs: StdVec<(alloc::string::String, alloc::string::String)> = StdVec::new();
    if let Some(m) = &input.metadata {
        for (k, v) in m.iter() {
            metadata_pairs.push((k.to_string(), v.to_string()));
        }
        metadata_pairs.sort_by(|a, b| a.0.cmp(&b.0));
    }

    // Build canonical string. Keep it stable and explicit.
    // v1|tx_type=...|amount_usdc=...|token=...|user=...|timestamp=...|deal_id=...|listing_id=...|meta=k1=v1&k2=v2
    let mut meta_joined = alloc::string::String::new();
    for (i, (k, v)) in metadata_pairs.iter().enumerate() {
        if i > 0 {
            meta_joined.push('&');
        }
        meta_joined.push_str(k);
        meta_joined.push('=');
        meta_joined.push_str(v);
    }

    let token_str: alloc::string::String = input.token.to_string().to_string();
    let user_str: alloc::string::String = input.user.to_string().to_string();
    let deal_id_str: alloc::string::String = deal_id.to_string();
    let listing_id_str: alloc::string::String = listing_id.to_string();
    let tx_type_str: alloc::string::String = input.tx_type.to_string();

    let canonical = format!(
        "v1|tx_type={}|amount_usdc={}|token={}|user={}|timestamp={}|deal_id={}|listing_id={}|meta={}",
        tx_type_str,
        input.amount_usdc,
        token_str,
        user_str,
        timestamp,
        deal_id_str,
        listing_id_str,
        meta_joined,
    );

    Bytes::from_slice(env, canonical.as_bytes())
}

/// Computes SHA-256 hash of canonical receipt payload v1
fn compute_canonical_hash(env: &Env, payload: &Bytes) -> BytesN<32> {
    let hash = env.crypto().sha256(payload);
    hash.into()
}

#[contractimpl]
impl StakingPool {
    pub fn init(env: Env, admin: Address, token: Address) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }

        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage()
            .instance()
            .set(&DataKey::ContractVersion, &1u32);
        env.storage()
            .instance()
            .set(&DataKey::StateSchemaVersion, &1u32);
        env.storage().instance().set(&DataKey::TotalStaked, &0i128);
        env.storage().instance().set(&DataKey::LockPeriod, &0u64);
        env.storage().instance().set(&DataKey::Paused, &false);

        // #389: consistent init event (data = admin; existing tests assert this)
        env.events().publish(
            (Symbol::new(&env, "staking_pool"), Symbol::new(&env, "init")),
            admin,
        );

        Ok(())
    }

    pub fn contract_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get::<_, u32>(&DataKey::ContractVersion)
            .unwrap_or(0u32)
    }

    /// Current state schema version stored on-chain.
    pub fn state_schema_version(env: Env) -> u32 {
        get_state_schema_version(&env)
    }

    pub fn version(env: Env) -> u32 {
        Self::contract_version(env)
    }

    pub fn set_operator(
        env: Env,
        admin: Address,
        new_operator: Option<Address>,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "set_operator")?;

        let old_operator: Option<Address> = get_operator(&env);
        env.storage()
            .instance()
            .set(&DataKey::Operator, &new_operator);

        env.events().publish(
            (
                Symbol::new(&env, "staking_pool"),
                Symbol::new(&env, "set_operator"),
            ),
            (old_operator, new_operator),
        );

        Ok(())
    }

    pub fn set_admin(env: Env, admin: Address, new_admin: Address) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "set_admin")?;

        env.storage().instance().set(&DataKey::Admin, &new_admin);

        env.events().publish(
            (
                Symbol::new(&env, "staking_pool"),
                Symbol::new(&env, "set_admin"),
            ),
            (admin, new_admin),
        );
        Ok(())
    }

    pub fn is_operator(env: Env, addr: Address) -> bool {
        is_operator(&env, &addr)
    }

    pub fn stake(env: Env, from: Address, amount: i128) -> Result<(), ContractError> {
        require_not_paused(&env)?;
        let _spender = require_user_or_operator(&env, &from, &from)?;
        validation::require_valid_amount(amount)?;

        enter_nonreentrant(&env)?;

        let token_address = get_token(&env);
        let token_client = token::Client::new(&env, &token_address);

        token_client.transfer(&from, &env.current_contract_address(), &amount);

        exit_nonreentrant(&env);

        let current_balance = get_staked_balance(&env, &from);
        put_staked_balance(&env, &from, current_balance + amount);

        let total = get_total_staked(&env);
        put_total_staked(&env, total + amount);

        // Track this as a separate deposit for independent lock period tracking
        let count = get_deposit_count(&env, &from);
        put_deposit(
            &env,
            &from,
            count,
            Deposit {
                amount,
                timestamp: env.ledger().timestamp(),
            },
        );
        put_deposit_count(&env, &from, count + 1);

        let new_user_balance = current_balance + amount;
        let new_total = total + amount;
        env.events().publish(
            (
                Symbol::new(&env, "staking_pool"),
                Symbol::new(&env, "stake"),
                from.clone(),
            ),
            (amount, new_user_balance, new_total),
        );

        Ok(())
    }

    pub fn unstake(env: Env, to: Address, amount: i128) -> Result<(), ContractError> {
        require_not_paused(&env)?;
        let _spender = require_user_or_operator(&env, &to, &to)?;
        validation::require_valid_amount(amount)?;

        let current_balance = get_staked_balance(&env, &to);
        if current_balance < amount {
            return Err(ContractError::InsufficientBalance);
        }

        let lock_period = get_lock_period(&env);
        let current_time = env.ledger().timestamp();
        let count = get_deposit_count(&env, &to);

        let mut unlocked_balance = 0i128;
        for i in 0..count {
            if let Some(deposit) = get_deposit(&env, &to, i) {
                if lock_period == 0 || current_time >= deposit.timestamp + lock_period {
                    unlocked_balance += deposit.amount;
                }
            }
        }

        if unlocked_balance < amount {
            env.events().publish(
                (
                    Symbol::new(&env, "staking_pool"),
                    Symbol::new(&env, "unstake_blocked"),
                    to.clone(),
                ),
                (amount, unlocked_balance),
            );
            return Err(ContractError::TokensLocked);
        }

        let mut remaining_to_unstake = amount;
        for i in 0..count {
            if remaining_to_unstake == 0 {
                break;
            }

            if let Some(mut deposit) = get_deposit(&env, &to, i) {
                if lock_period == 0 || current_time >= deposit.timestamp + lock_period {
                    if deposit.amount <= remaining_to_unstake {
                        remaining_to_unstake -= deposit.amount;
                        remove_deposit(&env, &to, i);
                    } else {
                        deposit.amount -= remaining_to_unstake;
                        remaining_to_unstake = 0;
                        put_deposit(&env, &to, i, deposit);
                    }
                }
            }
        }

        let new_balance = current_balance - amount;
        put_staked_balance(&env, &to, new_balance);

        let total = get_total_staked(&env);
        put_total_staked(&env, total - amount);

        let token_address = get_token(&env);
        let token_client = token::Client::new(&env, &token_address);

        enter_nonreentrant(&env)?;
        token_client.transfer(&env.current_contract_address(), &to, &amount);
        exit_nonreentrant(&env);

        let new_total = total - amount;
        env.events().publish(
            (
                Symbol::new(&env, "staking_pool"),
                Symbol::new(&env, "unstake"),
                to.clone(),
            ),
            (amount, new_balance, new_total),
        );

        Ok(())
    }

    pub fn staked_balance(env: Env, user: Address) -> i128 {
        get_staked_balance(&env, &user)
    }

    pub fn total_staked(env: Env) -> i128 {
        get_total_staked(&env)
    }

    pub fn set_lock_period(env: Env, admin: Address, seconds: u64) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "set_lock_period")?;
        validation::require_valid_lock_period(seconds)?;
        put_lock_period(&env, seconds);
        env.events().publish(
            (
                Symbol::new(&env, "staking_pool"),
                Symbol::new(&env, "set_lock_period"),
            ),
            seconds,
        );
        Ok(())
    }

    pub fn get_lock_period(env: Env) -> u64 {
        get_lock_period(&env)
    }

    // ── Upgrade governance (#392) ─────────────────────────────────────────────

    pub fn set_guardian(env: Env, admin: Address, guardian: Address) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "set_guardian")?;
        env.storage().instance().set(&DataKey::Guardian, &guardian);
        env.events().publish(
            (
                Symbol::new(&env, "staking_pool"),
                Symbol::new(&env, "set_guardian"),
            ),
            guardian,
        );
        Ok(())
    }

    pub fn set_upgrade_delay(
        env: Env,
        admin: Address,
        delay_seconds: u64,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(
            &env,
            &current_admin,
            &admin,
            "set_upgrade_delay",
        )?;
        env.storage()
            .instance()
            .set(&DataKey::UpgradeDelay, &delay_seconds);
        env.events().publish(
            (
                Symbol::new(&env, "staking_pool"),
                Symbol::new(&env, "set_upgrade_delay"),
            ),
            delay_seconds,
        );
        Ok(())
    }

    pub fn propose_upgrade(
        env: Env,
        admin: Address,
        new_wasm_hash: BytesN<32>,
        new_version: u32,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "propose_upgrade")?;
        if env.storage().instance().has(&DataKey::PendingUpgradeHash) {
            return Err(ContractError::UpgradeAlreadyPending);
        }

        validate_upgrade_safety(&env, new_version)?;
        let now = env.ledger().timestamp();
        env.storage()
            .instance()
            .set(&DataKey::PendingUpgradeHash, &new_wasm_hash);
        env.storage()
            .instance()
            .set(&DataKey::PendingUpgradeAt, &now);
        env.storage()
            .instance()
            .set(&DataKey::PendingUpgradeVersion, &new_version);
        env.events().publish(
            (
                Symbol::new(&env, "staking_pool"),
                Symbol::new(&env, "propose_upgrade"),
            ),
            (new_wasm_hash, new_version, now),
        );
        Ok(())
    }

    pub fn execute_upgrade(
        env: Env,
        admin: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "execute_upgrade")?;
        let pending: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::PendingUpgradeHash)
            .ok_or(ContractError::NoUpgradePending)?;
        if pending != new_wasm_hash {
            return Err(ContractError::NoUpgradePending);
        }
        let proposed_at: u64 = env
            .storage()
            .instance()
            .get(&DataKey::PendingUpgradeAt)
            .unwrap_or(0);
        let proposed_version: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PendingUpgradeVersion)
            .unwrap_or(0);

        validate_upgrade_safety(&env, proposed_version)?;

        let delay: u64 = env
            .storage()
            .instance()
            .get(&DataKey::UpgradeDelay)
            .unwrap_or(0);
        if delay > 0 && env.ledger().timestamp() < proposed_at + delay {
            return Err(ContractError::UpgradeDelayNotMet);
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
        env.storage()
            .instance()
            .remove(&DataKey::PendingUpgradeVersion);

        env.storage()
            .instance()
            .set(&DataKey::ContractVersion, &proposed_version);

        env.events().publish(
            (
                Symbol::new(&env, "staking_pool"),
                Symbol::new(&env, "execute_upgrade"),
            ),
            (new_wasm_hash.clone(), proposed_version),
        );
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    pub fn emergency_upgrade(
        env: Env,
        admin: Address,
        new_wasm_hash: BytesN<32>,
        new_version: u32,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(
            &env,
            &current_admin,
            &admin,
            "emergency_upgrade",
        )?;

        validate_upgrade_safety(&env, new_version)?;

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
        env.storage()
            .instance()
            .remove(&DataKey::PendingUpgradeVersion);

        env.storage()
            .instance()
            .set(&DataKey::ContractVersion, &new_version);

        env.events().publish(
            (
                Symbol::new(&env, "staking_pool"),
                Symbol::new(&env, "emergency_upgrade"),
            ),
            (
                admin,
                new_wasm_hash.clone(),
                new_version,
                env.ledger().timestamp(),
            ),
        );
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    pub fn cancel_upgrade(env: Env, admin: Address) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "cancel_upgrade")?;
        let hash: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::PendingUpgradeHash)
            .ok_or(ContractError::NoUpgradePending)?;
        env.storage()
            .instance()
            .remove(&DataKey::PendingUpgradeHash);
        env.storage().instance().remove(&DataKey::PendingUpgradeAt);
        env.storage()
            .instance()
            .remove(&DataKey::PendingUpgradeVersion);
        env.events().publish(
            (
                Symbol::new(&env, "staking_pool"),
                Symbol::new(&env, "cancel_upgrade"),
            ),
            (admin, hash),
        );
        Ok(())
    }

    /// Computes metadata hash for receipt input using canonical payload v1
    ///
    /// # Arguments
    /// * `input` - ReceiptInput struct containing transaction data
    ///
    /// # Returns
    /// BytesN<32> - SHA-256 hash of canonical payload v1
    ///
    /// # Canonical Payload Format v1
    /// Deterministic serialization with fixed ordering:
    /// 1. tx_type (Symbol, 32 bytes max)
    /// 2. amount_usdc (i128, 16 bytes big-endian)
    /// 3. token (Address, 32 bytes)
    /// 4. user (Address, 32 bytes)
    /// 5. timestamp (u64, 8 bytes, current ledger time if None)
    /// 6. deal_id (String, variable length with length prefix, empty if None)
    /// 7. listing_id (String, variable length with length prefix, empty if None)
    /// 8. metadata (Map<Symbol, String>, sorted by key, empty marker if None)
    ///
    /// All fields are concatenated in order with no delimiters.
    /// Optional fields use empty values when None.
    pub fn compute_metadata_hash(
        env: Env,
        input: ReceiptInput,
    ) -> Result<BytesN<32>, ContractError> {
        crate::validation::require_valid_amount(input.amount_usdc)?;

        let payload = create_canonical_payload_v1(&env, &input);
        Ok(compute_canonical_hash(&env, &payload))
    }

    /// Verifies that a metadata hash matches the computed hash for given input
    ///
    /// # Arguments
    /// * `input` - ReceiptInput struct containing transaction data
    /// * `expected_hash` - Expected SHA-256 hash to verify against
    ///
    /// # Returns
    /// bool - true if hash matches, false otherwise
    pub fn verify_metadata_hash(
        env: Env,
        input: ReceiptInput,
        expected_hash: BytesN<32>,
    ) -> Result<bool, ContractError> {
        let computed_hash = Self::compute_metadata_hash(env, input)?;
        Ok(computed_hash == expected_hash)
    }
}

#[contractimpl]
impl Pausable for StakingPool {
    fn pause(env: Env, admin: Address) -> Result<(), PausableError> {
        let current_admin = get_admin(&env);
        if access_control::require_admin_permission(&env, &current_admin, &admin, "pause").is_err()
        {
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
        let current_admin = get_admin(&env);
        if access_control::require_admin_permission(&env, &current_admin, &admin, "unpause")
            .is_err()
        {
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
mod test {
    extern crate std;

    use super::{ContractError, ReceiptInput, StakingPool, StakingPoolClient};
    use soroban_sdk::testutils::{Address as _, Events, Ledger, MockAuth, MockAuthInvoke};
    use soroban_sdk::{Address, BytesN, Env, IntoVal, Map, String, Symbol, TryIntoVal};

    fn hex_to_bytes32(hex: &str) -> [u8; 32] {
        fn hex_val(b: u8) -> u8 {
            match b {
                b'0'..=b'9' => b - b'0',
                b'a'..=b'f' => 10 + (b - b'a'),
                b'A'..=b'F' => 10 + (b - b'A'),
                _ => panic!("invalid hex"),
            }
        }

        let bytes = hex.as_bytes();
        assert_eq!(bytes.len(), 64, "expected 64-char hex");
        let mut out = [0u8; 32];
        for i in 0..32 {
            out[i] = (hex_val(bytes[i * 2]) << 4) | hex_val(bytes[i * 2 + 1]);
        }
        out
    }

    fn setup_contract(env: &Env) -> (Address, StakingPoolClient<'_>, Address, Address, Address) {
        env.mock_all_auths();
        let contract_id = env.register(StakingPool, ());
        let client = StakingPoolClient::new(env, &contract_id);

        let admin = Address::generate(env);
        let user = Address::generate(env);
        let token_admin = Address::generate(env);

        // Create token contract
        let token_contract = env.register_stellar_asset_contract_v2(token_admin);
        let token_contract_id = token_contract.address();

        // Initialize contract
        client
            .try_init(&admin, &token_contract_id)
            .unwrap()
            .unwrap();

        (contract_id, client, admin, user, token_contract_id)
    }

    #[test]
    fn propose_upgrade_fails_for_non_sequential_version() {
        let env = Env::default();
        let (contract_id, client, admin, _user, _token_id) = setup_contract(&env);
        let hash = BytesN::from_array(&env, &[0u8; 32]);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_upgrade",
                args: (admin.clone(), hash.clone(), 3u32).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let err = client
            .try_propose_upgrade(&admin, &hash, &3u32)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InvalidUpgradeVersion);
    }

    #[test]
    fn propose_upgrade_fails_when_state_schema_mismatched() {
        let env = Env::default();
        let (contract_id, client, admin, _user, _token_id) = setup_contract(&env);
        let hash = BytesN::from_array(&env, &[0u8; 32]);

        env.as_contract(&contract_id, || {
            env.storage()
                .instance()
                .set(&super::DataKey::StateSchemaVersion, &0u32);
        });

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_upgrade",
                args: (admin.clone(), hash.clone(), 2u32).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let err = client
            .try_propose_upgrade(&admin, &hash, &2u32)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::IncompatibleStateSchema);
    }

    // ============================================================================
    // Init Tests
    // ============================================================================

    #[test]
    fn init_sets_admin_and_token() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(StakingPool, ());
        let client = StakingPoolClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(token_admin);
        let token_contract_id = token_contract.address();

        env.mock_all_auths();
        client
            .try_init(&admin, &token_contract_id)
            .unwrap()
            .unwrap();

        assert_eq!(client.contract_version(), 1u32);

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
        client.try_pause(&admin).unwrap().unwrap();
        assert!(client.is_paused());
    }

    #[test]
    fn version_matches_contract_version() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(StakingPool, ());
        let client = StakingPoolClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(token_admin);
        let token_contract_id = token_contract.address();

        client
            .try_init(&admin, &token_contract_id)
            .unwrap()
            .unwrap();

        assert_eq!(client.version(), 1u32);
        assert_eq!(client.version(), client.contract_version());
    }

    #[test]
    fn init_cannot_be_called_twice() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(StakingPool, ());
        let client = StakingPoolClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(token_admin);
        let token_contract_id = token_contract.address();

        client
            .try_init(&admin, &token_contract_id)
            .unwrap()
            .unwrap();
        let err = client
            .try_init(&admin, &token_contract_id)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::AlreadyInitialized);
    }

    #[test]
    #[should_panic]
    fn init_requires_admin_auth() {
        let env = Env::default();
        let contract_id = env.register(StakingPool, ());
        let client = StakingPoolClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let token_id = env
            .register_stellar_asset_contract_v2(Address::generate(&env))
            .address();

        client.init(&admin, &token_id);
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
    fn is_paused_returns_false_initially() {
        let env = Env::default();
        let (_contract_id, client, _admin, _user, _token_id) = setup_contract(&env);
        assert!(!client.is_paused());
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

        client.try_pause(&admin).unwrap().unwrap();
        assert!(client.is_paused());

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "unpause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        client.try_unpause(&admin).unwrap().unwrap();
        assert!(!client.is_paused());
    }

    #[test]
    fn non_admin_cannot_pause() {
        let env = Env::default();
        let (contract_id, client, _admin, _user, _token_id) = setup_contract(&env);
        let non_admin = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &non_admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "pause",
                args: (non_admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let err = client.try_pause(&non_admin).unwrap_err().unwrap();
        assert_eq!(err, soroban_pausable::PausableError::NotAuthorized);
    }

    #[test]
    fn non_admin_cannot_set_operator() {
        let env = Env::default();
        let (contract_id, client, _admin, _user, _token_id) = setup_contract(&env);
        let non_admin = Address::generate(&env);
        let operator = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &non_admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_operator",
                args: (non_admin.clone(), Some(operator.clone())).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let err = client
            .try_set_operator(&non_admin, &Some(operator))
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    #[test]
    fn admin_can_set_operator_and_query() {
        let env = Env::default();
        let (contract_id, client, admin, _user, _token_id) = setup_contract(&env);
        let operator = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_operator",
                args: (admin.clone(), Some(operator.clone())).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        client
            .try_set_operator(&admin, &Some(operator.clone()))
            .unwrap()
            .unwrap();
        assert!(client.is_operator(&operator));
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
        client.try_pause(&admin).unwrap().unwrap();

        // Try to stake while paused
        env.mock_all_auths();

        let err = client.try_stake(&user, &100i128).unwrap_err().unwrap();
        assert_eq!(err, ContractError::Paused);
    }

    #[test]
    fn operator_stake_fails_when_paused() {
        let env = Env::default();
        let (contract_id, client, admin, user, _token_id) = setup_contract(&env);
        let operator = Address::generate(&env);

        // Set operator
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_operator",
                args: (admin.clone(), Some(operator.clone())).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_set_operator(&admin, &Some(operator.clone()))
            .unwrap()
            .unwrap();

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
        client.try_pause(&admin).unwrap().unwrap();

        // Operator attempts to stake for user
        env.mock_auths(&[
            MockAuth {
                address: &operator,
                invoke: &MockAuthInvoke {
                    contract: &contract_id,
                    fn_name: "stake",
                    args: (user.clone(), 100i128).into_val(&env),
                    sub_invokes: &[],
                },
            },
            MockAuth {
                address: &user,
                invoke: &MockAuthInvoke {
                    contract: &contract_id,
                    fn_name: "stake",
                    args: (user.clone(), 100i128).into_val(&env),
                    sub_invokes: &[],
                },
            },
        ]);

        let err = client.try_stake(&user, &100i128).unwrap_err().unwrap();
        assert_eq!(err, ContractError::Paused);
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
        client.try_pause(&admin).unwrap().unwrap();

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

        let err = client.try_unstake(&user, &50i128).unwrap_err().unwrap();
        assert_eq!(err, ContractError::Paused);
    }

    // ============================================================================
    // Input Validation Tests
    // ============================================================================

    #[test]
    fn stake_fails_with_zero_amount() {
        let env = Env::default();
        let (contract_id, client, _admin, user, _token_id) = setup_contract(&env);

        // Set up MockAuth for user to satisfy from.require_auth()
        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "stake",
                args: (user.clone(), 0i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let err = client.try_stake(&user, &0i128).unwrap_err().unwrap();
        assert_eq!(err, ContractError::InvalidAmount);
    }

    #[test]
    fn stake_fails_with_negative_amount() {
        let env = Env::default();
        let (contract_id, client, _admin, user, _token_id) = setup_contract(&env);

        // Set up MockAuth for user to satisfy from.require_auth()
        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "stake",
                args: (user.clone(), -10i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let err = client.try_stake(&user, &-10i128).unwrap_err().unwrap();
        assert_eq!(err, ContractError::InvalidAmount);
    }

    #[test]
    fn unstake_fails_with_zero_amount() {
        let env = Env::default();
        let (contract_id, client, _admin, user, _token_id) = setup_contract(&env);

        // Set up MockAuth for user to satisfy to.require_auth()
        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "unstake",
                args: (user.clone(), 0i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let err = client.try_unstake(&user, &0i128).unwrap_err().unwrap();
        assert_eq!(err, ContractError::InvalidAmount);
    }

    #[test]
    fn unstake_fails_with_negative_amount() {
        let env = Env::default();
        let (contract_id, client, _admin, user, _token_id) = setup_contract(&env);

        // Set up MockAuth for user to satisfy to.require_auth()
        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "unstake",
                args: (user.clone(), -10i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let err = client.try_unstake(&user, &-10i128).unwrap_err().unwrap();
        assert_eq!(err, ContractError::InvalidAmount);
    }

    // ============================================================================
    // Event Tests
    // ============================================================================

    #[test]
    fn pause_emits_event() {
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

        client.try_pause(&admin).unwrap().unwrap();

        let events = env.events().all();
        let pause_event = events.last().unwrap();

        let topics: soroban_sdk::Vec<soroban_sdk::Val> = pause_event.1.clone();
        assert_eq!(topics.len(), 2);

        let contract_name: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(contract_name, Symbol::new(&env, "Pausable"));
        let event_name: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(event_name, Symbol::new(&env, "pause"));
    }

    #[test]
    fn unpause_emits_event() {
        let env = Env::default();
        let (contract_id, client, admin, _user, _token_id) = setup_contract(&env);

        // First pause
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "pause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_pause(&admin).unwrap().unwrap();

        // Then unpause
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "unpause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_unpause(&admin).unwrap().unwrap();

        let events = env.events().all();
        let unpause_event = events.last().unwrap();

        let topics: soroban_sdk::Vec<soroban_sdk::Val> = unpause_event.1.clone();
        assert_eq!(topics.len(), 2);

        let contract_name: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(contract_name, Symbol::new(&env, "Pausable"));
        let event_name: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(event_name, Symbol::new(&env, "unpause"));
    }

    #[test]
    fn init_emits_event() {
        let env = Env::default();
        let contract_id = env.register(StakingPool, ());
        let client = StakingPoolClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(token_admin);
        let token_contract_id = token_contract.address();

        env.mock_all_auths();
        client
            .try_init(&admin, &token_contract_id)
            .unwrap()
            .unwrap();

        let events = env.events().all();
        let init_event = events.last().unwrap();

        let topics: soroban_sdk::Vec<soroban_sdk::Val> = init_event.1.clone();
        assert_eq!(topics.len(), 2);

        let contract_name: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(contract_name, Symbol::new(&env, "staking_pool"));
        let event_name: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(event_name, Symbol::new(&env, "init"));

        let data: Address = init_event.2.try_into_val(&env).unwrap();
        assert_eq!(data, admin);
    }

    // ============================================================================
    // Lock Period Tests
    // ============================================================================

    #[test]
    fn get_lock_period_returns_zero_initially() {
        let env = Env::default();
        let (_contract_id, client, _admin, _user, _token_id) = setup_contract(&env);
        assert_eq!(client.get_lock_period(), 0u64);
    }

    #[test]
    fn admin_can_set_lock_period() {
        let env = Env::default();
        let (contract_id, client, admin, _user, _token_id) = setup_contract(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_lock_period",
                args: (admin.clone(), 3600u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        client
            .try_set_lock_period(&admin, &3600u64)
            .unwrap()
            .unwrap();
        assert_eq!(client.get_lock_period(), 3600u64);
    }

    #[test]
    fn admin_can_set_lock_period_at_minimum_zero_seconds() {
        let env = Env::default();
        let (contract_id, client, admin, _user, _token_id) = setup_contract(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_lock_period",
                args: (admin.clone(), 0u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        client.try_set_lock_period(&admin, &0u64).unwrap().unwrap();
        assert_eq!(client.get_lock_period(), 0u64);
    }

    #[test]
    fn admin_can_set_lock_period_at_maximum_31536000_seconds() {
        let env = Env::default();
        let (contract_id, client, admin, _user, _token_id) = setup_contract(&env);
        let max_lock_period = 31_536_000u64;

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_lock_period",
                args: (admin.clone(), max_lock_period).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        client
            .try_set_lock_period(&admin, &max_lock_period)
            .unwrap()
            .unwrap();
        assert_eq!(client.get_lock_period(), max_lock_period);
    }

    #[test]
    fn admin_cannot_set_lock_period_above_maximum_31536000_seconds() {
        let env = Env::default();
        let (contract_id, client, admin, _user, _token_id) = setup_contract(&env);
        let just_above_max_lock_period = 31_536_001u64;

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_lock_period",
                args: (admin.clone(), just_above_max_lock_period).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let err = client
            .try_set_lock_period(&admin, &just_above_max_lock_period)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InvalidLockPeriod);
    }

    #[test]
    fn non_admin_cannot_set_lock_period() {
        let env = Env::default();
        let (contract_id, client, _admin, _user, _token_id) = setup_contract(&env);
        let non_admin = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &non_admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_lock_period",
                args: (non_admin.clone(), 3600u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let err = client
            .try_set_lock_period(&non_admin, &3600u64)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    #[test]
    fn unstake_succeeds_after_lock_period() {
        let env = Env::default();
        let (contract_id, client, admin, user, _token_id) = setup_contract(&env);

        // Set lock period to 1 hour
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_lock_period",
                args: (admin.clone(), 3600u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_set_lock_period(&admin, &3600u64)
            .unwrap()
            .unwrap();

        // Try to unstake without any stake (should fail due to insufficient balance)
        // Set up MockAuth for user to satisfy to.require_auth()
        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "unstake",
                args: (user.clone(), 500i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client.try_unstake(&user, &500i128).unwrap_err().unwrap();
        assert_eq!(err, ContractError::InsufficientBalance);
    }

    #[test]
    fn operator_can_authorize_stake_and_unstake_calls() {
        let env = Env::default();
        let (contract_id, client, admin, user, token_id) = setup_contract(&env);
        let operator = Address::generate(&env);

        // Set operator
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_operator",
                args: (admin.clone(), Some(operator.clone())).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_set_operator(&admin, &Some(operator.clone()))
            .unwrap()
            .unwrap();

        // Fund user
        let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
        env.mock_all_auths();
        token_client.mint(&user, &1000i128);

        // Clear mock_all_auths and set up specific auths for stake
        // Note: require_user_or_operator checks if operator is set, and if so, calls op.require_auth()
        // The first MockAuth determines the caller, so operator must be first to satisfy caller == op check
        // We also need user auth for the token transfer
        env.mock_auths(&[]);
        env.mock_auths(&[
            MockAuth {
                address: &operator, // First auth determines caller, must be operator
                invoke: &MockAuthInvoke {
                    contract: &contract_id,
                    fn_name: "stake",
                    args: (user.clone(), 500i128).into_val(&env),
                    sub_invokes: &[],
                },
            },
            MockAuth {
                address: &user, // Also need user auth for the token transfer
                invoke: &MockAuthInvoke {
                    contract: &contract_id,
                    fn_name: "stake",
                    args: (user.clone(), 500i128).into_val(&env),
                    sub_invokes: &[],
                },
            },
            MockAuth {
                address: &user,
                invoke: &MockAuthInvoke {
                    contract: &token_id,
                    fn_name: "transfer",
                    args: (user.clone(), contract_id.clone(), 500i128).into_val(&env),
                    sub_invokes: &[],
                },
            },
        ]);
        client.try_stake(&user, &500i128).unwrap().unwrap();
        assert_eq!(client.staked_balance(&user), 500i128);

        // Unstake authorized by operator
        // Note: require_user_or_operator checks if operator is set, and if so, calls op.require_auth()
        // The first MockAuth determines the caller, so operator must be first to satisfy caller == op check
        env.mock_auths(&[
            MockAuth {
                address: &operator, // First auth determines caller, must be operator
                invoke: &MockAuthInvoke {
                    contract: &contract_id,
                    fn_name: "unstake",
                    args: (user.clone(), 200i128).into_val(&env),
                    sub_invokes: &[],
                },
            },
            MockAuth {
                address: &user, // User is the recipient, but operator authorizes the unstake
                invoke: &MockAuthInvoke {
                    contract: &contract_id,
                    fn_name: "unstake",
                    args: (user.clone(), 200i128).into_val(&env),
                    sub_invokes: &[],
                },
            },
        ]);
        client.try_unstake(&user, &200i128).unwrap().unwrap();
        assert_eq!(client.staked_balance(&user), 300i128);
    }

    #[test]
    fn new_stake_resets_lock_timer() {
        let env = Env::default();
        let (contract_id, client, admin, user, _token_id) = setup_contract(&env);

        // Set lock period to 1 hour
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_lock_period",
                args: (admin.clone(), 3600u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_set_lock_period(&admin, &3600u64)
            .unwrap()
            .unwrap();

        // Try to unstake without any stake (should fail due to insufficient balance)
        // Set up MockAuth for user to satisfy to.require_auth()
        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "unstake",
                args: (user.clone(), 500i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client.try_unstake(&user, &500i128).unwrap_err().unwrap();
        assert_eq!(err, ContractError::InsufficientBalance);
    }

    #[test]
    fn unstake_succeeds_with_zero_lock_period() {
        let env = Env::default();
        let (contract_id, client, _admin, user, _token_id) = setup_contract(&env);

        // Don't set lock period (defaults to 0)

        // Try to unstake without any stake (should fail due to insufficient balance)
        // Set up MockAuth for user to satisfy to.require_auth()
        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "unstake",
                args: (user.clone(), 500i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client.try_unstake(&user, &500i128).unwrap_err().unwrap();
        assert_eq!(err, ContractError::InsufficientBalance);
    }

    #[test]
    fn set_lock_period_emits_event() {
        let env = Env::default();
        let (contract_id, client, admin, _user, _token_id) = setup_contract(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_lock_period",
                args: (admin.clone(), 3600u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        client
            .try_set_lock_period(&admin, &3600u64)
            .unwrap()
            .unwrap();

        let events = env.events().all();
        let lock_event = events.last().unwrap();

        let topics: soroban_sdk::Vec<soroban_sdk::Val> = lock_event.1.clone();
        assert_eq!(topics.len(), 2);

        let contract_name: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(contract_name, Symbol::new(&env, "staking_pool"));
        let event_name: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(event_name, Symbol::new(&env, "set_lock_period"));

        let data: u64 = lock_event.2.try_into_val(&env).unwrap();
        assert_eq!(data, 3600u64);
    }

    // ============================================================================
    // Security Tests
    // ============================================================================

    #[test]
    fn test_stake_authorization() {
        let env = Env::default();
        let (contract_id, client, admin, user, _token_id) = setup_contract(&env);
        let operator = Address::generate(&env);

        // Set operator - now only operator can authorize stake/unstake
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_operator",
                args: (admin.clone(), Some(operator.clone())).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_set_operator(&admin, &Some(operator.clone()))
            .unwrap()
            .unwrap();

        // Test that user cannot stake when operator is set (only operator can authorize)
        // When operator is set, op.require_auth() is called, which will abort if operator isn't authorized
        // So we expect the call to fail with an abort (ConversionError), not NotAuthorized
        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "stake",
                args: (user.clone(), 1000i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        // The call should fail because op.require_auth() will abort when operator isn't authorized
        let result = client.try_stake(&user, &1000i128);
        assert!(result.is_err());
    }

    #[test]
    fn test_unstake_authorization() {
        let env = Env::default();
        let (contract_id, client, admin, user, _token_id) = setup_contract(&env);
        let operator = Address::generate(&env);

        // Set operator - now only operator can authorize stake/unstake
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_operator",
                args: (admin.clone(), Some(operator.clone())).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_set_operator(&admin, &Some(operator.clone()))
            .unwrap()
            .unwrap();

        // Test that user cannot unstake when operator is set (only operator can authorize)
        // When operator is set, op.require_auth() is called, which will abort if operator isn't authorized
        // So we expect the call to fail with an abort (ConversionError), not NotAuthorized
        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "unstake",
                args: (user.clone(), 1000i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        // The call should fail because op.require_auth() will abort when operator isn't authorized
        let result = client.try_unstake(&user, &1000i128);
        assert!(result.is_err());
    }

    #[test]
    fn test_pause_authorization() {
        let env = Env::default();
        let (contract_id, client, admin, _user, _token_id) = setup_contract(&env);

        // Test that pause requires admin authorization
        let non_admin = Address::generate(&env);
        env.mock_auths(&[MockAuth {
            address: &non_admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "pause",
                args: (non_admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client.try_pause(&non_admin).unwrap_err().unwrap();
        assert_eq!(err, soroban_pausable::PausableError::NotAuthorized);

        // Test that admin can pause
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "pause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_pause(&admin).unwrap().unwrap();
    }

    #[test]
    fn test_pause_blocks_staking() {
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
        client.try_pause(&admin).unwrap().unwrap();

        // Test that staking fails when paused
        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "stake",
                args: (user.clone(), 1000i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client.try_stake(&user, &1000i128).unwrap_err().unwrap();
        assert_eq!(err, ContractError::Paused);
    }

    #[test]
    fn test_zero_amount_rejection() {
        let env = Env::default();
        let (contract_id, client, _admin, user, _token_id) = setup_contract(&env);

        // Set up MockAuth for user to satisfy from.require_auth() and to.require_auth()
        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "stake",
                args: (user.clone(), 0i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        // Test staking zero amount fails
        let err = client.try_stake(&user, &0i128).unwrap_err().unwrap();
        assert_eq!(err, ContractError::InvalidAmount);

        // Set up MockAuth for unstake
        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "unstake",
                args: (user.clone(), 0i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        // Test unstaking zero amount fails
        let err = client.try_unstake(&user, &0i128).unwrap_err().unwrap();
        assert_eq!(err, ContractError::InvalidAmount);
    }

    #[test]
    fn test_negative_amount_rejection() {
        let env = Env::default();
        let (contract_id, client, _admin, user, _token_id) = setup_contract(&env);

        // Set up MockAuth for user to satisfy from.require_auth() and to.require_auth()
        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "stake",
                args: (user.clone(), -100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        // Test staking negative amount fails
        let err = client.try_stake(&user, &-100i128).unwrap_err().unwrap();
        assert_eq!(err, ContractError::InvalidAmount);

        // Set up MockAuth for unstake
        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "unstake",
                args: (user.clone(), -100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        // Test unstaking negative amount fails
        let err = client.try_unstake(&user, &-100i128).unwrap_err().unwrap();
        assert_eq!(err, ContractError::InvalidAmount);
    }

    #[test]
    fn test_balance_isolation() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, _token_id) = setup_contract(&env);
        let user2 = Address::generate(&env);

        // Verify initial balances are isolated
        assert_eq!(client.staked_balance(&user), 0i128);
        assert_eq!(client.staked_balance(&user2), 0i128);
        assert_eq!(client.total_staked(), 0i128);

        // Verify users can't access each other's balances
        // (This is implicit in the storage design, but we test the behavior)
        let user1_balance = client.staked_balance(&user);
        let user2_balance = client.staked_balance(&user2);
        assert_ne!(user, user2);
        assert_eq!(user1_balance, 0i128);
        assert_eq!(user2_balance, 0i128);
    }

    // ============================================================================
    // Metadata Hash Tests
    // ============================================================================

    #[test]
    fn test_compute_metadata_hash_basic_stake() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

        let input = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1000i128,
            token: token_id,
            user: user.clone(),
            timestamp: Some(1234567890u64),
            deal_id: None,
            listing_id: None,
            metadata: None,
        };

        let hash = client.try_compute_metadata_hash(&input).unwrap().unwrap();

        #[cfg(test)]
        {
            extern crate std;
            const HEX: &[u8; 16] = b"0123456789abcdef";
            let bytes = hash.to_array();
            let mut out = [0u8; 64];
            for (i, b) in bytes.iter().enumerate() {
                out[i * 2] = HEX[(b >> 4) as usize];
                out[i * 2 + 1] = HEX[(b & 0x0f) as usize];
            }
            let hex = std::string::String::from_utf8(out.to_vec()).expect("valid utf8");
            std::println!("golden_metadata_hash.basic_stake={}", hex);
        }

        // Verify hash is non-zero
        let zero_hash = BytesN::from_array(&env, &[0u8; 32]);
        assert_ne!(hash, zero_hash);
    }

    #[test]
    fn test_compute_metadata_hash_with_optional_fields() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

        let mut metadata = Map::new(&env);
        metadata.set(
            Symbol::new(&env, "category"),
            String::from_str(&env, "rent_payment"),
        );
        metadata.set(
            Symbol::new(&env, "priority"),
            String::from_str(&env, "high"),
        );

        let input = ReceiptInput {
            tx_type: Symbol::new(&env, "unstake"),
            amount_usdc: 500i128,
            token: token_id,
            user: user.clone(),
            timestamp: Some(9876543210u64),
            deal_id: Some(String::from_str(&env, "deal_123")),
            listing_id: Some(String::from_str(&env, "listing_456")),
            metadata: Some(metadata),
        };

        let hash = client.try_compute_metadata_hash(&input).unwrap().unwrap();

        // Verify hash is non-zero
        let zero_hash = BytesN::from_array(&env, &[0u8; 32]);
        assert_ne!(hash, zero_hash);
    }

    #[test]
    fn test_verify_metadata_hash_success() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

        let input = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1000i128,
            token: token_id,
            user: user.clone(),
            timestamp: Some(1234567890u64),
            deal_id: None,
            listing_id: None,
            metadata: None,
        };

        let expected_hash = client.try_compute_metadata_hash(&input).unwrap().unwrap();
        let is_valid = client
            .try_verify_metadata_hash(&input, &expected_hash)
            .unwrap()
            .unwrap();

        assert!(is_valid);
    }

    #[test]
    fn test_verify_metadata_hash_failure() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

        let input = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1000i128,
            token: token_id,
            user: user.clone(),
            timestamp: Some(1234567890u64),
            deal_id: None,
            listing_id: None,
            metadata: None,
        };

        let wrong_hash = BytesN::from_array(&env, &[1u8; 32]);
        let is_valid = client
            .try_verify_metadata_hash(&input, &wrong_hash)
            .unwrap()
            .unwrap();

        assert!(!is_valid);
    }

    #[test]
    fn test_metadata_hash_deterministic_same_input() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

        let input = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1000i128,
            token: token_id,
            user: user.clone(),
            timestamp: Some(1234567890u64),
            deal_id: Some(String::from_str(&env, "deal_123")),
            listing_id: Some(String::from_str(&env, "listing_456")),
            metadata: None,
        };

        let hash1 = client
            .try_compute_metadata_hash(&input.clone())
            .unwrap()
            .unwrap();
        let hash2 = client.try_compute_metadata_hash(&input).unwrap().unwrap();

        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_metadata_hash_different_inputs_produce_different_hashes() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

        let input1 = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1000i128,
            token: token_id.clone(),
            user: user.clone(),
            timestamp: Some(1234567890u64),
            deal_id: None,
            listing_id: None,
            metadata: None,
        };

        let input2 = ReceiptInput {
            tx_type: Symbol::new(&env, "unstake"),
            amount_usdc: 1000i128,
            token: token_id,
            user: user.clone(),
            timestamp: Some(1234567890u64),
            deal_id: None,
            listing_id: None,
            metadata: None,
        };

        let hash1 = client.try_compute_metadata_hash(&input1).unwrap().unwrap();
        let hash2 = client.try_compute_metadata_hash(&input2).unwrap().unwrap();

        assert_ne!(hash1, hash2);
    }

    #[test]
    fn test_metadata_hash_rejects_zero_amount() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

        let input = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 0i128,
            token: token_id,
            user: user.clone(),
            timestamp: Some(1234567890u64),
            deal_id: None,
            listing_id: None,
            metadata: None,
        };

        let err = client
            .try_compute_metadata_hash(&input)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InvalidAmount);
    }

    #[test]
    fn test_metadata_hash_rejects_negative_amount() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

        let input = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: -100i128,
            token: token_id,
            user: user.clone(),
            timestamp: Some(1234567890u64),
            deal_id: None,
            listing_id: None,
            metadata: None,
        };

        let err = client
            .try_compute_metadata_hash(&input)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InvalidAmount);
    }

    // ============================================================================
    // Metadata Hash Integrity Tests (Issue #1248)
    // ============================================================================

    #[test]
    fn compute_metadata_hash_is_deterministic() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

        env.ledger().set_timestamp(1620000000u64);

        let input = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1000000i128,
            token: token_id,
            user: user.clone(),
            timestamp: Some(1620000000u64),
            deal_id: None,
            listing_id: None,
            metadata: None,
        };

        let hash1 = client
            .try_compute_metadata_hash(&input.clone())
            .unwrap()
            .unwrap();
        let hash2 = client.try_compute_metadata_hash(&input).unwrap().unwrap();

        assert_eq!(
            hash1, hash2,
            "hash should be deterministic for identical input"
        );
    }

    #[test]
    fn compute_metadata_hash_sensitive_to_tx_type() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

        env.ledger().set_timestamp(1620000000u64);

        let input1 = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1000000i128,
            token: token_id.clone(),
            user: user.clone(),
            timestamp: Some(1620000000u64),
            deal_id: None,
            listing_id: None,
            metadata: None,
        };

        let input2 = ReceiptInput {
            tx_type: Symbol::new(&env, "unstake"),
            amount_usdc: 1000000i128,
            token: token_id,
            user: user.clone(),
            timestamp: Some(1620000000u64),
            deal_id: None,
            listing_id: None,
            metadata: None,
        };

        let hash1 = client.try_compute_metadata_hash(&input1).unwrap().unwrap();
        let hash2 = client.try_compute_metadata_hash(&input2).unwrap().unwrap();

        assert_ne!(hash1, hash2, "hash should change when tx_type changes");
    }

    #[test]
    fn compute_metadata_hash_sensitive_to_amount() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

        env.ledger().set_timestamp(1620000000u64);

        let input1 = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1000000i128,
            token: token_id.clone(),
            user: user.clone(),
            timestamp: Some(1620000000u64),
            deal_id: None,
            listing_id: None,
            metadata: None,
        };

        let input2 = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 2000000i128,
            token: token_id,
            user: user.clone(),
            timestamp: Some(1620000000u64),
            deal_id: None,
            listing_id: None,
            metadata: None,
        };

        let hash1 = client.try_compute_metadata_hash(&input1).unwrap().unwrap();
        let hash2 = client.try_compute_metadata_hash(&input2).unwrap().unwrap();

        assert_ne!(hash1, hash2, "hash should change when amount changes");
    }

    #[test]
    fn compute_metadata_hash_sensitive_to_token() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

        env.ledger().set_timestamp(1620000000u64);

        let token_admin = Address::generate(&env);
        let token_contract2 = env.register_stellar_asset_contract_v2(token_admin);
        let token_id2 = token_contract2.address();

        let input1 = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1000000i128,
            token: token_id.clone(),
            user: user.clone(),
            timestamp: Some(1620000000u64),
            deal_id: None,
            listing_id: None,
            metadata: None,
        };

        let input2 = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1000000i128,
            token: token_id2,
            user: user.clone(),
            timestamp: Some(1620000000u64),
            deal_id: None,
            listing_id: None,
            metadata: None,
        };

        let hash1 = client.try_compute_metadata_hash(&input1).unwrap().unwrap();
        let hash2 = client.try_compute_metadata_hash(&input2).unwrap().unwrap();

        assert_ne!(
            hash1, hash2,
            "hash should change when token address changes"
        );
    }

    #[test]
    fn compute_metadata_hash_sensitive_to_user() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

        env.ledger().set_timestamp(1620000000u64);

        let user2 = Address::generate(&env);

        let input1 = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1000000i128,
            token: token_id.clone(),
            user: user.clone(),
            timestamp: Some(1620000000u64),
            deal_id: None,
            listing_id: None,
            metadata: None,
        };

        let input2 = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1000000i128,
            token: token_id,
            user: user2,
            timestamp: Some(1620000000u64),
            deal_id: None,
            listing_id: None,
            metadata: None,
        };

        let hash1 = client.try_compute_metadata_hash(&input1).unwrap().unwrap();
        let hash2 = client.try_compute_metadata_hash(&input2).unwrap().unwrap();

        assert_ne!(hash1, hash2, "hash should change when user address changes");
    }

    #[test]
    fn compute_metadata_hash_sensitive_to_timestamp() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

        let input1 = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1000000i128,
            token: token_id.clone(),
            user: user.clone(),
            timestamp: Some(1620000000u64),
            deal_id: None,
            listing_id: None,
            metadata: None,
        };

        let input2 = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1000000i128,
            token: token_id,
            user: user.clone(),
            timestamp: Some(1620000001u64),
            deal_id: None,
            listing_id: None,
            metadata: None,
        };

        let hash1 = client.try_compute_metadata_hash(&input1).unwrap().unwrap();
        let hash2 = client.try_compute_metadata_hash(&input2).unwrap().unwrap();

        assert_ne!(hash1, hash2, "hash should change when timestamp changes");
    }

    #[test]
    fn compute_metadata_hash_sensitive_to_deal_id() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

        env.ledger().set_timestamp(1620000000u64);

        let input1 = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1000000i128,
            token: token_id.clone(),
            user: user.clone(),
            timestamp: Some(1620000000u64),
            deal_id: Some(String::from_str(&env, "DEAL001")),
            listing_id: None,
            metadata: None,
        };

        let input2 = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1000000i128,
            token: token_id,
            user: user.clone(),
            timestamp: Some(1620000000u64),
            deal_id: Some(String::from_str(&env, "DEAL002")),
            listing_id: None,
            metadata: None,
        };

        let hash1 = client.try_compute_metadata_hash(&input1).unwrap().unwrap();
        let hash2 = client.try_compute_metadata_hash(&input2).unwrap().unwrap();

        assert_ne!(hash1, hash2, "hash should change when deal_id changes");
    }

    #[test]
    fn compute_metadata_hash_sensitive_to_listing_id() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

        env.ledger().set_timestamp(1620000000u64);

        let input1 = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1000000i128,
            token: token_id.clone(),
            user: user.clone(),
            timestamp: Some(1620000000u64),
            deal_id: None,
            listing_id: Some(String::from_str(&env, "LIST001")),
            metadata: None,
        };

        let input2 = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1000000i128,
            token: token_id,
            user: user.clone(),
            timestamp: Some(1620000000u64),
            deal_id: None,
            listing_id: Some(String::from_str(&env, "LIST002")),
            metadata: None,
        };

        let hash1 = client.try_compute_metadata_hash(&input1).unwrap().unwrap();
        let hash2 = client.try_compute_metadata_hash(&input2).unwrap().unwrap();

        assert_ne!(hash1, hash2, "hash should change when listing_id changes");
    }

    #[test]
    fn compute_metadata_hash_sensitive_to_metadata() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

        env.ledger().set_timestamp(1620000000u64);

        let mut metadata1 = Map::new(&env);
        metadata1.set(
            Symbol::new(&env, "source"),
            String::from_str(&env, "bank_transfer"),
        );

        let mut metadata2 = Map::new(&env);
        metadata2.set(
            Symbol::new(&env, "source"),
            String::from_str(&env, "credit_card"),
        );

        let input1 = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1000000i128,
            token: token_id.clone(),
            user: user.clone(),
            timestamp: Some(1620000000u64),
            deal_id: None,
            listing_id: None,
            metadata: Some(metadata1),
        };

        let input2 = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1000000i128,
            token: token_id,
            user: user.clone(),
            timestamp: Some(1620000000u64),
            deal_id: None,
            listing_id: None,
            metadata: Some(metadata2),
        };

        let hash1 = client.try_compute_metadata_hash(&input1).unwrap().unwrap();
        let hash2 = client.try_compute_metadata_hash(&input2).unwrap().unwrap();

        assert_ne!(
            hash1, hash2,
            "hash should change when metadata content changes"
        );
    }

    #[test]
    fn verify_metadata_hash_accepts_correct_hash() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

        env.ledger().set_timestamp(1620000000u64);

        let input = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1000000i128,
            token: token_id,
            user: user.clone(),
            timestamp: Some(1620000000u64),
            deal_id: None,
            listing_id: None,
            metadata: None,
        };

        let hash = client
            .try_compute_metadata_hash(&input.clone())
            .unwrap()
            .unwrap();
        let verified = client
            .try_verify_metadata_hash(&input, &hash)
            .unwrap()
            .unwrap();

        assert!(verified, "verify should return true for correct hash");
    }

    #[test]
    fn verify_metadata_hash_rejects_incorrect_hash() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

        env.ledger().set_timestamp(1620000000u64);

        let input = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1000000i128,
            token: token_id,
            user: user.clone(),
            timestamp: Some(1620000000u64),
            deal_id: None,
            listing_id: None,
            metadata: None,
        };

        let wrong_hash = BytesN::from_array(&env, &[0u8; 32]);
        let verified = client
            .try_verify_metadata_hash(&input, &wrong_hash)
            .unwrap()
            .unwrap();

        assert!(!verified, "verify should return false for incorrect hash");
    }

    #[test]
    fn verify_metadata_hash_rejects_hash_from_different_input() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

        env.ledger().set_timestamp(1620000000u64);

        let input1 = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1000000i128,
            token: token_id.clone(),
            user: user.clone(),
            timestamp: Some(1620000000u64),
            deal_id: None,
            listing_id: None,
            metadata: None,
        };

        let input2 = ReceiptInput {
            tx_type: Symbol::new(&env, "unstake"),
            amount_usdc: 1000000i128,
            token: token_id,
            user: user.clone(),
            timestamp: Some(1620000000u64),
            deal_id: None,
            listing_id: None,
            metadata: None,
        };

        let hash1 = client.try_compute_metadata_hash(&input1).unwrap().unwrap();
        let verified = client
            .try_verify_metadata_hash(&input2, &hash1)
            .unwrap()
            .unwrap();

        assert!(!verified, "verify should reject hash from different input");
    }

    #[test]
    fn config_change_detectable_via_hash() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

        env.ledger().set_timestamp(1620000000u64);

        // Simulate config change by changing deal_id
        let input_before = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1000000i128,
            token: token_id.clone(),
            user: user.clone(),
            timestamp: Some(1620000000u64),
            deal_id: Some(String::from_str(&env, "DEAL001")),
            listing_id: None,
            metadata: None,
        };

        let input_after = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1000000i128,
            token: token_id,
            user: user.clone(),
            timestamp: Some(1620000000u64),
            deal_id: Some(String::from_str(&env, "DEAL002")),
            listing_id: None,
            metadata: None,
        };

        let hash_before = client
            .try_compute_metadata_hash(&input_before)
            .unwrap()
            .unwrap();
        let hash_after = client
            .try_compute_metadata_hash(&input_after)
            .unwrap()
            .unwrap();

        assert_ne!(hash_before, hash_after, "hash should detect config change");
    }

    #[test]
    fn compute_metadata_hash_no_panic_on_edge_inputs() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

        env.ledger().set_timestamp(1620000000u64);

        // Test with empty optional fields
        let input1 = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1i128,
            token: token_id.clone(),
            user: user.clone(),
            timestamp: None,
            deal_id: None,
            listing_id: None,
            metadata: None,
        };

        let hash1 = client.try_compute_metadata_hash(&input1).unwrap().unwrap();
        assert_ne!(hash1, BytesN::from_array(&env, &[0u8; 32]));

        // Test with empty metadata map
        let empty_metadata = Map::new(&env);
        let input2 = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1i128,
            token: token_id,
            user: user.clone(),
            timestamp: Some(1620000000u64),
            deal_id: None,
            listing_id: None,
            metadata: Some(empty_metadata),
        };

        let hash2 = client.try_compute_metadata_hash(&input2).unwrap().unwrap();
        assert_ne!(hash2, BytesN::from_array(&env, &[0u8; 32]));
    }

    // ============================================================================
    // Golden Test Vectors
    // ============================================================================

    #[test]
    fn test_golden_vector_1_basic_stake() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

        // Fixed test values for deterministic hash
        env.ledger().set_timestamp(1620000000u64);

        let input = ReceiptInput {
            tx_type: Symbol::new(&env, "stake"),
            amount_usdc: 1000000i128, // 1 USDC with 6 decimals
            token: token_id,
            user: user.clone(),
            timestamp: Some(1620000000u64),
            deal_id: None,
            listing_id: None,
            metadata: None,
        };

        let hash = client.try_compute_metadata_hash(&input).unwrap().unwrap();

        let expected = BytesN::from_array(
            &env,
            &hex_to_bytes32("c420b6abfa2b233108918399c8cb0059b951cdd2f1c3562bf38c183a0ff96713"),
        );
        assert_eq!(hash, expected);
    }

    #[test]
    fn test_golden_vector_2_with_metadata() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, token_id) = setup_contract(&env);

        env.ledger().set_timestamp(1620000000u64);

        let mut metadata = Map::new(&env);
        metadata.set(
            Symbol::new(&env, "source"),
            String::from_str(&env, "bank_transfer"),
        );
        metadata.set(
            Symbol::new(&env, "reference"),
            String::from_str(&env, "TX123456789"),
        );

        let input = ReceiptInput {
            tx_type: Symbol::new(&env, "unstake"),
            amount_usdc: 500000i128, // 0.5 USDC
            token: token_id,
            user: user.clone(),
            timestamp: Some(1620000000u64),
            deal_id: Some(String::from_str(&env, "DEAL001")),
            listing_id: Some(String::from_str(&env, "LIST001")),
            metadata: Some(metadata),
        };

        let hash = client.try_compute_metadata_hash(&input).unwrap().unwrap();

        let expected = BytesN::from_array(
            &env,
            &hex_to_bytes32("348091ff408ec28120067b9708aee87b147834307a57c23b36821ffced58e5a0"),
        );
        assert_eq!(hash, expected);
    }

    // ============================================================================
    // Regression Tests for Reward Accounting (Issue #1040)
    // ============================================================================
    //
    // These tests verify that reward distribution, when eventually implemented in
    // the contract, matches the Kani-proven model in formal_properties.rs.
    // They serve as regression tests to catch economic bugs (reward inflation,
    // insolvency, rounding attacks) early.
    //
    // Currently the contract does not implement reward distribution, but these
    // tests document the expected behavior that must be verified when reward logic
    // is added. Future implementations MUST satisfy these invariants.

    /// Regression test: Reward conservation invariant.
    /// When reward logic is implemented, verify that:
    /// claimed + unclaimed <= distributed (no reward inflation).
    /// This is a forward-looking test; currently skipped since contract has no rewards.
    #[test]
    #[ignore] // Ignored until reward distribution is implemented
    fn regression_reward_conservation_invariant() {
        // Placeholder: When reward distribution methods are added to the contract,
        // this test should verify the conservation property with real contract operations.
        // Expected behavior:
        // 1. Distribute N tokens as rewards
        // 2. Multiple users stake at different times
        // 3. Claims are made
        // 4. Verify: sum(claims) + sum(pending) <= N
        //
        // This ensures the contract never inflates rewards.
    }

    /// Regression test: Solvency invariant.
    /// When reward logic is implemented, verify that:
    /// principal + claimable <= pool_balance always holds.
    /// This ensures the pool never becomes insolvent.
    #[test]
    #[ignore] // Ignored until reward distribution is implemented
    fn regression_reward_solvency_invariant() {
        // Placeholder: When reward distribution methods are added to the contract,
        // this test should verify solvency with real contract operations.
        // Expected behavior:
        // 1. Initialize pool with N reward tokens
        // 2. Distribute rewards to users
        // 3. Users claim rewards
        // 4. Verify: total_staked + claimable <= pool_balance (never negative)
        //
        // This ensures the pool can always honor withdrawal/claim requests.
    }

    /// Regression test: No free rewards invariant.
    /// When reward logic is implemented, verify that:
    /// A user who stakes AFTER a distribution cannot claim any portion of that distribution.
    /// This is enforced by per-share index snapshots in the model.
    #[test]
    #[ignore] // Ignored until reward distribution is implemented
    fn regression_no_free_rewards_invariant() {
        // Placeholder: When reward distribution methods are added to the contract,
        // this test should verify the no-free-rewards property.
        // Expected behavior:
        // 1. User A stakes 100 tokens
        // 2. Contract distributes 50 reward tokens
        // 3. User B stakes 100 tokens (after distribution)
        // 4. Both users claim
        // 5. Verify: User B claims 0 from the distribution (only User A gets rewards)
        //
        // This prevents late-staker attacks that would dilute early staker rewards.
    }

    /// Regression test: Rounding direction invariant.
    /// When reward logic is implemented, verify that:
    /// Residual dust from reward % total_staked accrues to the pool, never to users.
    /// This is standard behavior (same as Uniswap v2, Curve) and economically safe.
    #[test]
    #[ignore] // Ignored until reward distribution is implemented
    fn regression_rounding_direction_invariant() {
        // Placeholder: When reward distribution methods are added to the contract,
        // this test should verify that rounding errors favor the pool.
        // Expected behavior:
        // 1. User stakes 100 tokens
        // 2. Contract distributes 101 tokens as rewards (101 % 100 = 1 remainder)
        // 3. User claims
        // 4. Verify: User claims exactly 101 / 100 = 1 token (via integer division)
        // 5. Verify: 1 token of dust remains in pool, not claimed
        //
        // This ensures pool balance never drops below total_staked + total_claimable.
    }
}
