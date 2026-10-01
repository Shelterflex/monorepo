use soroban_sdk::{contracterror, Address, Env};

/// Emit a standardized unauthorized-access event and return the error.
#[inline]
pub fn deny(env: &Env, caller: &Address, operation: &str) -> AccessControlError {
    soroban_access_control::deny(env, caller, operation, AccessControlError::NotAuthorized)
}

/// Require that `caller` is the current `admin`.
pub fn require_admin_permission(
    env: &Env,
    expected_admin: &Address,
    caller: &Address,
    fn_name: &str,
) -> Result<(), AccessControlError> {
    soroban_access_control::require_admin_permission(
        env,
        expected_admin,
        caller,
        fn_name,
        AccessControlError::NotAuthorized,
    )
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum AccessControlError {
    NotAuthorized = 1,
}
