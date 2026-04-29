use soroban_sdk::{contracterror, Address, Env};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum AccessControlError {
    NotAuthorized = 1,
}

/// Helper: require that `caller` is the expected admin; otherwise error.
pub fn require_admin_permission(
    _env: &Env,
    expected_admin: &Address,
    caller: &Address,
    _fn_name: &str,
) -> Result<(), AccessControlError> {
    caller.require_auth();
    if caller != expected_admin {
        return Err(AccessControlError::NotAuthorized);
    }
    Ok(())
}
