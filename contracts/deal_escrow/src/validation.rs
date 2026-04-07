//! Validation helpers for the `deal_escrow` contract inputs.
//!
//! Closes: #385

use soroban_sdk::{Env, String};

use crate::ContractError;

/// Validates that an amount is strictly positive.
pub fn require_valid_amount(amount: i128) -> Result<(), ContractError> {
    if amount <= 0 {
        return Err(ContractError::InvalidAmount);
    }
    Ok(())
}

/// Validates that a string is not empty.
pub fn require_non_empty_string(_env: &Env, s: &String) -> Result<(), ContractError> {
    if s.len() == 0 {
        return Err(ContractError::EmptyString);
    }
    Ok(())
}
