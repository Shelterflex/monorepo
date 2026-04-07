//! Validation helpers for the `staking_pool` contract inputs.
//!
//! Closes: #385

use crate::ContractError;

/// Validates that amount is strictly positive and within reasonable bounds.
pub fn require_valid_amount(amount: i128) -> Result<(), ContractError> {
    if amount <= 0 {
        return Err(ContractError::InvalidAmount);
    }
    Ok(())
}

/// Validates that lock_period is greater than 0 and less than a maximum limit (e.g. 52 weeks in seconds: 31449600)
pub fn require_valid_lock_period(lock_period: u64) -> Result<(), ContractError> {
    // 0 means "no lock".
    if lock_period > 31_536_000 {
        return Err(ContractError::InvalidLockPeriod);
    }
    Ok(())
}
