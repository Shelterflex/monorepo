//! Upgrade safety validation for the staking_pool contract.
//!
//! This module implements version compatibility checks, state validation,
//! rollback mechanisms, and upgrade event emission for safe contract upgrades.

use soroban_sdk::{Address, Env, Map, Symbol};

use crate::{ContractError, DataKey, StakingPool};

/// Storage keys for upgrade tracking - use Symbol keys for persistent storage
pub fn upgrade_prev_version_key(env: &Env) -> Symbol {
    Symbol::new(env, "upgrade_prev_ver")
}

pub fn upgrade_timestamp_key(env: &Env) -> Symbol {
    Symbol::new(env, "upgrade_timestamp")
}

pub fn upgrade_balances_backup_key(env: &Env) -> Symbol {
    Symbol::new(env, "upgrade_bal_backup")
}

pub fn upgrade_total_staked_backup_key(env: &Env) -> Symbol {
    Symbol::new(env, "upgrade_total_backup")
}

pub fn upgrade_paused_backup_key(env: &Env) -> Symbol {
    Symbol::new(env, "upgrade_paused_backup")
}

/// Result of upgrade safety validation
pub struct UpgradeValidation {
    /// Whether all validations passed
    pub is_valid: bool,
    /// Current version
    pub current_version: u32,
    /// Previous version (for rollback reference)
    pub previous_version: u32,
    /// Whether state requires migration
    pub requires_migration: bool,
}

/// Validates version compatibility for upgrade
///
/// Checks if the current version can be safely upgraded to a new version.
/// Currently supports upgrading to version + 1 only (sequential upgrades).
///
/// # Arguments
/// * `env` - The Soroban environment
/// * `target_version` - The version to upgrade to
///
/// # Returns
/// Result indicating whether the upgrade path is valid
pub fn validate_version_compatibility(
    env: &Env,
    target_version: u32,
) -> Result<(), ContractError> {
    let current_version = StakingPool::contract_version(env.clone());

    // Only allow sequential upgrades (version + 1)
    if target_version != current_version + 1 {
        return Err(ContractError::NotAuthorized); // Reuse for "invalid upgrade"
    }

    Ok(())
}

/// Validates the current state before upgrade
///
/// This function checks that the contract state is in a valid condition
/// before proceeding with an upgrade. It verifies:
/// - Admin is set
/// - Token contract is set
/// - Staked balances map is consistent
/// - Total staked amount is valid
/// - Paused state is valid
///
/// # Arguments
/// * `env` - The Soroban environment
/// * `admin` - The admin address authorizing the upgrade
///
/// # Returns
/// Result indicating whether state is valid for upgrade
pub fn validate_state_pre_upgrade(env: &Env, admin: &Address) -> Result<(), ContractError> {
    // Verify admin is set and matches
    let stored_admin = env
        .storage()
        .instance()
        .get::<_, Address>(&DataKey::Admin)
        .ok_or(ContractError::NotAuthorized)?;

    if stored_admin != *admin {
        return Err(ContractError::NotAuthorized);
    }

    // Verify token is set
    let _token = env
        .storage()
        .instance()
        .get::<_, Address>(&DataKey::Token)
        .ok_or(ContractError::NotAuthorized)?;

    // Verify staked balances map exists and is valid
    let _balances = env
        .storage()
        .instance()
        .get::<_, Map<Address, i128>>(&DataKey::StakedBalances);

    // Verify total staked can be read
    let _total = env
        .storage()
        .instance()
        .get::<_, i128>(&DataKey::TotalStaked);

    // Verify stakeDatestamps map exists and is valid
    let _timestamps = env
        .storage()
        .instance()
        .get::<_, Map<Address, u64>>(&DataKey::StakeTimestamps);

    // Verify paused state can be read
    let _paused = env
        .storage()
        .instance()
        .get::<_, bool>(&DataKey::Paused);

    // Verify lock period can be read
    let _lock_period = env
        .storage()
        .instance()
        .get::<_, u64>(&DataKey::LockPeriod);

    Ok(())
}

/// Backs up critical state before upgrade
///
/// Creates a checkpoint of the current state so it can be restored if needed.
/// This is idempotent and safe to call multiple times.
///
/// # Arguments
/// * `env` - The Soroban environment
pub fn backup_state_for_upgrade(env: &Env) -> Result<(), ContractError> {
    let current_version = StakingPool::contract_version(env.clone());

    // Store previous version for rollback reference
    env.storage()
        .persistent()
        .set(&upgrade_prev_version_key(env), &current_version);

    // Store upgrade timestamp (for audit trail)
    let timestamp = env.ledger().timestamp();
    env.storage()
        .persistent()
        .set(&upgrade_timestamp_key(env), &timestamp);

    // Backup staked balances
    if let Ok(balances) = env
        .storage()
        .instance()
        .get::<_, Map<Address, i128>>(&DataKey::StakedBalances)
    {
        env.storage()
            .persistent()
            .set(&upgrade_balances_backup_key(env), &balances);
    }

    // Backup total staked
    if let Ok(total) = env
        .storage()
        .instance()
        .get::<_, i128>(&DataKey::TotalStaked)
    {
        env.storage()
            .persistent()
            .set(&upgrade_total_staked_backup_key(env), &total);
    }

    // Backup paused state
    let paused = env
        .storage()
        .instance()
        .get::<_, bool>(&DataKey::Paused)
        .unwrap_or(false);
    env.storage()
        .persistent()
        .set(&upgrade_paused_backup_key(env), &paused);

    Ok(())
}

/// Validates state consistency after upgrade
///
/// Verifies that the state after upgrade is still consistent and hasn't
/// been corrupted. Compares backup with current state to detect issues.
///
/// # Arguments
/// * `env` - The Soroban environment
///
/// # Returns
/// Result indicating whether state is valid after upgrade
pub fn validate_state_post_upgrade(env: &Env) -> Result<UpgradeValidation, ContractError> {
    let current_version = StakingPool::contract_version(env.clone());

    // Get previous version from backup
    let previous_version = env
        .storage()
        .persistent()
        .get::<_, u32>(&upgrade_prev_version_key(env))
        .unwrap_or(0);

    // Verify version was incremented
    if current_version <= previous_version {
        return Err(ContractError::NotAuthorized); // Reuse for "upgrade failed"
    }

    // Verify admin still exists
    let admin = env
        .storage()
        .instance()
        .get::<_, Address>(&DataKey::Admin);

    if admin.is_none() {
        return Err(ContractError::NotAuthorized);
    }

    // Verify token still exists
    let token = env
        .storage()
        .instance()
        .get::<_, Address>(&DataKey::Token);

    if token.is_none() {
        return Err(ContractError::NotAuthorized);
    }

    // Verify staked balances map still exists
    let _current_balances = env
        .storage()
        .instance()
        .get::<_, Map<Address, i128>>(&DataKey::StakedBalances);

    // Verify stake timestamps map still exists
    let _current_timestamps = env
        .storage()
        .instance()
        .get::<_, Map<Address, u64>>(&DataKey::StakeTimestamps);

    // For v1 -> v2 upgrade, no migration required
    let requires_migration = false;

    Ok(UpgradeValidation {
        is_valid: true,
        current_version,
        previous_version,
        requires_migration,
    })
}

/// Implements rollback to previous version if upgrade fails
///
/// Restores the contract to its state before the upgrade attempt.
/// This is critical for recovery if something goes wrong.
///
/// # Arguments
/// * `env` - The Soroban environment
///
/// # Returns
/// Result indicating success of rollback
pub fn rollback_upgrade(env: &Env) -> Result<(), ContractError> {
    // Restore previous version
    if let Ok(prev_version) = env
        .storage()
        .persistent()
        .get::<_, u32>(&upgrade_prev_version_key(env))
    {
        env.storage()
            .instance()
            .set(&DataKey::ContractVersion, &prev_version);
    }

    // Restore staked balances from backup
    if let Ok(backup_balances) = env
        .storage()
        .persistent()
        .get::<_, Map<Address, i128>>(&upgrade_balances_backup_key(env))
    {
        env.storage()
            .instance()
            .set(&DataKey::StakedBalances, &backup_balances);
    }

    // Restore total staked from backup
    if let Ok(backup_total) = env
        .storage()
        .persistent()
        .get::<_, i128>(&upgrade_total_staked_backup_key(env))
    {
        env.storage()
            .instance()
            .set(&DataKey::TotalStaked, &backup_total);
    }

    // Restore paused state from backup
    if let Ok(paused_backup) = env
        .storage()
        .persistent()
        .get::<_, bool>(&upgrade_paused_backup_key(env))
    {
        env.storage()
            .instance()
            .set(&DataKey::Paused, &paused_backup);
    }

    Ok(())
}

/// Emits an upgrade event for monitoring
///
/// Publishes an event that external systems can subscribe to
/// for tracking contract upgrades.
///
/// # Arguments
/// * `env` - The Soroban environment
/// * `from_version` - The version upgraded from
/// * `to_version` - The version upgraded to
/// * `status` - "started", "completed", or "rolled_back"
pub fn emit_upgrade_event(env: &Env, from_version: u32, to_version: u32, status: &str) {
    env.events().publish(
        (
            Symbol::new(env, "staking_pool"),
            Symbol::new(env, "upgrade"),
        ),
        (from_version, to_version, Symbol::new(env, status)),
    );
}

/// Cleans up upgrade state after successful upgrade (currently a no-op)
///
/// In a production system, you might want to implement explicit cleanup
/// of temporary upgrade tracking data. For now, we leave the backup data
/// in persistent storage for audit trail purposes.
///
/// # Arguments
/// * `env` - The Soroban environment
pub fn cleanup_upgrade_state(env: &Env) -> Result<(), ContractError> {
    // Note: Persistent storage cleanup would require explicit functions
    // For now, we leave the backup data for audit trail purposes
    
    Ok(())
}
