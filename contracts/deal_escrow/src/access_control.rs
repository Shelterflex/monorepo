//! Access-control helpers for the `deal_escrow` contract.
//!
//! This module standardises role-based permission checking for all public
//! functions in `deal_escrow`.  It maps directly to the permissions defined
//! in the `contract_access` library.
//!
//! ## Role → Permission mapping (deal_escrow)
//! | Function          | Required caller       | Permission       |
//! |-------------------|-----------------------|------------------|
//! | init              | none (unchecked)      | Initialize       |
//! | deposit           | any authenticated     | TransferFunds    |
//! | release           | admin or operator     | DebitFunds       |
//! | pause / unpause   | admin                 | PauseContract    |
//! | propose_upgrade   | admin                 | UpgradeContract  |
//! | execute_upgrade   | admin                 | UpgradeContract  |
//! | emergency_upgrade | admin                 | UpgradeContract  |
//! | cancel_upgrade    | admin                 | UpgradeContract  |
//! | set_guardian      | admin                 | AssignRole       |
//! | set_upgrade_delay | admin                 | AssignRole       |
//!
//! ## Event topics
//! All authorization failures emit an `access_control::unauthorized` event
//! before returning `Err(ContractError::NotAuthorized)`.
//!
//! ## Closes: #383 (access-control integration for deal_escrow)

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

/// Require that `caller` is either the `admin` OR the `operator`.
pub fn require_admin_or_operator_permission(
    env: &Env,
    admin: &Address,
    operator: &Address,
    caller: &Address,
    operation: &str,
) -> Result<(), ContractError> {
    soroban_access_control::require_admin_or_operator_permission(
        env,
        admin,
        Some(operator),
        caller,
        operation,
        ContractError::NotAuthorized,
    )
}
