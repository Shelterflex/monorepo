// Monthly spending cap module for RentWallet.
//
// To integrate this module, add the following to lib.rs:
//
//   pub mod monthly_cap;
//
// And extend the DataKey enum with:
//
//   MonthlyCapDefault,
//   MonthlyCapOverride(Address),
//   MonthlySpent(Address, u32),
//
// And extend ContractError with:
//
//   MonthlyCapExceeded = 17,
//
// Then add the public functions below to the RentWallet contractimpl block
// and call `monthly_cap::check_and_record_debit` from `debit()` before
// updating the balance.
//
// Month key formula: ledger_timestamp / 2_592_000 gives an approximate
// 30-day month number. This is a documented approximation — actual calendar
// months vary in length, but the 30-day window is consistent and sufficient
// for spending-cap enforcement.

use soroban_sdk::{Address, Env, Symbol};

const SECONDS_PER_MONTH: u64 = 2_592_000; // 30 × 24 × 60 × 60

pub fn current_month_key(env: &Env) -> u32 {
    (env.ledger().timestamp() / SECONDS_PER_MONTH) as u32
}

pub fn get_monthly_cap_default(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get::<_, i128>(&crate::DataKey::MonthlyCapDefault)
        .unwrap_or(0)
}

pub fn get_monthly_cap_override(env: &Env, user: &Address) -> Option<i128> {
    env.storage()
        .instance()
        .get::<_, i128>(&crate::DataKey::MonthlyCapOverride(user.clone()))
}

pub fn effective_cap(env: &Env, user: &Address) -> i128 {
    get_monthly_cap_override(env, user).unwrap_or_else(|| get_monthly_cap_default(env))
}

pub fn get_monthly_spent(env: &Env, user: &Address) -> i128 {
    let key = current_month_key(env);
    env.storage()
        .persistent()
        .get::<_, i128>(&crate::DataKey::MonthlySpent(user.clone(), key))
        .unwrap_or(0)
}

pub fn record_monthly_spent(env: &Env, user: &Address, additional: i128) {
    let key = current_month_key(env);
    let current = env
        .storage()
        .persistent()
        .get::<_, i128>(&crate::DataKey::MonthlySpent(user.clone(), key))
        .unwrap_or(0);
    env.storage().persistent().set(
        &crate::DataKey::MonthlySpent(user.clone(), key),
        &(current + additional),
    );
}

/// Called from `debit()` before the balance is modified.
/// Returns Err(MonthlyCapExceeded) if the debit would push the user over
/// their effective monthly cap. A cap of 0 (unset default) means no cap —
/// all debits are allowed.
pub fn check_and_record_debit(
    env: &Env,
    user: &Address,
    amount: i128,
) -> Result<(), crate::ContractError> {
    let cap = effective_cap(env, user);
    if cap == 0 {
        // No cap configured — backward-compatible pass-through
        return Ok(());
    }
    let spent = get_monthly_spent(env, user);
    if spent + amount > cap {
        return Err(crate::ContractError::MonthlyCapExceeded);
    }
    record_monthly_spent(env, user, amount);
    Ok(())
}

pub fn emit_monthly_cap_set(env: &Env, user: Option<Address>, cap: i128) {
    env.events().publish(
        (
            Symbol::new(env, "monthly_cap"),
            Symbol::new(env, "monthly_cap_set"),
        ),
        (user, cap),
    );
}
