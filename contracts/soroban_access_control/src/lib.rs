#![no_std]

use soroban_sdk::{Address, Env, Symbol};

/// Emit a standardized unauthorized-access event and return the provided contract error.
#[inline]
pub fn deny<E>(env: &Env, caller: &Address, operation: &str, err: E) -> E {
    env.events().publish(
        (
            Symbol::new(env, "access_control"),
            Symbol::new(env, "unauthorized"),
            caller.clone(),
        ),
        Symbol::new(env, operation),
    );
    err
}

/// Require that `caller` is the current `admin`.
#[inline]
pub fn require_admin_permission<E: Copy>(
    env: &Env,
    admin: &Address,
    caller: &Address,
    operation: &str,
    not_authorized: E,
) -> Result<(), E> {
    caller.require_auth();
    if caller != admin {
        return Err(deny(env, caller, operation, not_authorized));
    }
    Ok(())
}

/// Require that `caller` is either `admin` OR an optional operator.
#[inline]
pub fn require_admin_or_operator_permission<E: Copy>(
    env: &Env,
    admin: &Address,
    operator: Option<&Address>,
    caller: &Address,
    operation: &str,
    not_authorized: E,
) -> Result<(), E> {
    caller.require_auth();
    if caller == admin {
        return Ok(());
    }
    if let Some(op) = operator {
        if caller == op {
            return Ok(());
        }
    }

    Err(deny(env, caller, operation, not_authorized))
}
