//! Access-control helpers for the `schema_registry` contract.

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
