//! Access-control helpers for the `staking_pool` contract.
//!
//! This module standardises role-based permission checking for all public
//! functions in `staking_pool`.  It maps directly to the permissions defined
//! in the `contract_access` library.
//!
//! ## Role → Permission mapping (staking_pool)
//! | Function          | Required caller       | Permission       |
//! |-------------------|-----------------------|------------------|
//! | init              | none (unchecked)      | Initialize       |
//! | stake             | user or operator      | Stake            |
//! | unstake           | user or operator      | Unstake          |
//! | set_lock_period   | admin                 | SetLockPeriod    |
//! | set_operator      | admin                 | AssignRole       |
//! | set_admin         | admin                 | TransferAdmin    |
//! | pause / unpause   | admin                 | PauseContract    |
//! | propose_upgrade   | admin                 | UpgradeContract  |
//! | execute_upgrade   | admin                 | UpgradeContract  |
//!
//! ## Event topics
//! All authorization failures emit an `access_control::unauthorized` event
//! before returning `Err(ContractError::NotAuthorized)`.
//!
//! ## Closes: #383 (access-control integration for staking_pool)

use soroban_sdk::{Address, Env};

use crate::ContractError;

/// Emit a standardized unauthorized-access event and return the error.
#[inline]
pub fn deny(env: &Env, caller: &Address, operation: &str) -> ContractError {
    soroban_access_control::deny(env, caller, operation, ContractError::NotAuthorized)
}

/// Require that `caller` is the current `admin`.
pub fn require_admin_permission(
    env: &Env,
    admin: &Address,
    caller: &Address,
    operation: &str,
) -> Result<(), ContractError> {
    soroban_access_control::require_admin_permission(
        env,
        admin,
        caller,
        operation,
        ContractError::NotAuthorized,
    )
}

/// Require that `caller` is either the `admin` OR an optional `operator`.
pub fn require_admin_or_operator_permission(
    env: &Env,
    admin: &Address,
    operator: Option<&Address>,
    caller: &Address,
    operation: &str,
) -> Result<(), ContractError> {
    soroban_access_control::require_admin_or_operator_permission(
        env,
        admin,
        operator,
        caller,
        operation,
        ContractError::NotAuthorized,
    )
}
