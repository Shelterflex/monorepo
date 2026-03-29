//! Input validation and sanitization for the rent_wallet contract.
//!
//! Every public function that accepts user-supplied data must call the
//! appropriate validator before acting on the input.  Validators return
//! descriptive `ContractError` variants so callers know exactly what failed.

use soroban_sdk::{Address, Env, String};

use crate::ContractError;

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/// Maximum characters allowed in a free-text String field.
pub const MAX_STRING_LEN: u32 = 256;

/// Maximum absolute value of any single credit or debit.
/// Prevents integer-overflow cascades and limits blast-radius.
pub const MAX_AMOUNT: i128 = 1_000_000_000_000_000_000; // 1 quintillion

/// Minimum positive amount (must be > 0).
pub const MIN_AMOUNT: i128 = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Numeric validation
// ─────────────────────────────────────────────────────────────────────────────

/// Validates that `amount` is a positive value within the allowed range.
///
/// Rejects: zero, negative, or values exceeding `MAX_AMOUNT`.
pub fn validate_amount(amount: i128) -> Result<(), ContractError> {
    if amount < MIN_AMOUNT {
        return Err(ContractError::InvalidAmount);
    }
    if amount > MAX_AMOUNT {
        return Err(ContractError::AmountTooLarge);
    }
    Ok(())
}

/// Validates a u64 time-based value (e.g., lock period in seconds).
///
/// Zero is accepted (means "no lock").  Upper bound prevents overflow when
/// added to a ledger timestamp.
pub fn validate_time_value(value: u64) -> Result<(), ContractError> {
    // Max lock ~136 years — prevents timestamp arithmetic overflow
    const MAX_LOCK_SECS: u64 = 136 * 365 * 24 * 3600;
    if value > MAX_LOCK_SECS {
        return Err(ContractError::InvalidTimeValue);
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// String sanitization
// ─────────────────────────────────────────────────────────────────────────────

/// Validates a Soroban `String`:
/// - must not be empty
/// - must not exceed `MAX_STRING_LEN` characters
/// - must contain only printable ASCII (0x20–0x7E)
pub fn validate_string(_env: &Env, s: &String) -> Result<(), ContractError> {
    let len = s.len();
    if len == 0 {
        return Err(ContractError::EmptyString);
    }
    if len > MAX_STRING_LEN {
        return Err(ContractError::StringTooLong);
    }

    // Byte-level inspection — Soroban Strings are UTF-8; we allow only ASCII
    // printable range (0x20..=0x7E) to prevent control-character injection.
    let mut buf = [0u8; 256];
    let copy_len = len.min(256) as usize;
    s.copy_into_slice(&mut buf[..copy_len]);
    for &byte in &buf[..copy_len] {
        if !(0x20..=0x7E).contains(&byte) {
            return Err(ContractError::InvalidStringChar);
        }
    }

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Address validation
// ─────────────────────────────────────────────────────────────────────────────

/// Validates that two addresses are not identical.
///
/// Used to prevent e.g. self-transfer or assigning an admin to itself when a
/// distinct new admin is required.
pub fn validate_distinct_addresses(a: &Address, b: &Address) -> Result<(), ContractError> {
    if a == b {
        return Err(ContractError::SameAddress);
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env, String};

    // ── amount ───────────────────────────────────────────────────────────────

    #[test]
    fn valid_amount_passes() {
        assert!(validate_amount(1).is_ok());
        assert!(validate_amount(1_000).is_ok());
        assert!(validate_amount(MAX_AMOUNT).is_ok());
    }

    #[test]
    fn zero_amount_rejected() {
        assert_eq!(validate_amount(0), Err(ContractError::InvalidAmount));
    }

    #[test]
    fn negative_amount_rejected() {
        assert_eq!(validate_amount(-1), Err(ContractError::InvalidAmount));
        assert_eq!(
            validate_amount(i128::MIN),
            Err(ContractError::InvalidAmount)
        );
    }

    #[test]
    fn amount_above_max_rejected() {
        assert_eq!(
            validate_amount(MAX_AMOUNT + 1),
            Err(ContractError::AmountTooLarge)
        );
    }

    // ── time value ───────────────────────────────────────────────────────────

    #[test]
    fn valid_time_values_pass() {
        assert!(validate_time_value(0).is_ok());
        assert!(validate_time_value(3600).is_ok()); // 1 hour
        assert!(validate_time_value(86400 * 365).is_ok()); // 1 year
    }

    #[test]
    fn excessive_time_value_rejected() {
        let too_large = 136u64 * 365 * 24 * 3600 + 1;
        assert_eq!(
            validate_time_value(too_large),
            Err(ContractError::InvalidTimeValue)
        );
    }

    // ── string ───────────────────────────────────────────────────────────────

    #[test]
    fn valid_string_passes() {
        let env = Env::default();
        let s = String::from_str(&env, "hello world");
        assert!(validate_string(&env, &s).is_ok());
    }

    #[test]
    fn empty_string_rejected() {
        let env = Env::default();
        let s = String::from_str(&env, "");
        assert_eq!(validate_string(&env, &s), Err(ContractError::EmptyString));
    }

    #[test]
    fn string_at_max_length_passes() {
        let env = Env::default();
        let long: std::string::String = "a".repeat(MAX_STRING_LEN as usize);
        let s = String::from_str(&env, &long);
        assert!(validate_string(&env, &s).is_ok());
    }

    #[test]
    fn string_over_max_length_rejected() {
        let env = Env::default();
        let too_long: std::string::String = "a".repeat(MAX_STRING_LEN as usize + 1);
        let s = String::from_str(&env, &too_long);
        assert_eq!(validate_string(&env, &s), Err(ContractError::StringTooLong));
    }

    // ── address ──────────────────────────────────────────────────────────────

    #[test]
    fn distinct_addresses_pass() {
        let env = Env::default();
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        assert!(validate_distinct_addresses(&a, &b).is_ok());
    }

    #[test]
    fn same_address_rejected() {
        let env = Env::default();
        let a = Address::generate(&env);
        assert_eq!(
            validate_distinct_addresses(&a, &a),
            Err(ContractError::SameAddress)
        );
    }
}
