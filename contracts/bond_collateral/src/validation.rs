//! Input validation and sanitization for the bond_collateral contract.

use crate::ContractError;

/// Maximum absolute value of any single amount.
pub const MAX_AMOUNT: i128 = 1_000_000_000_000_000_000;

/// Minimum positive amount (must be > 0).
pub const MIN_AMOUNT: i128 = 1;

/// Validates that `amount` is a positive value within the allowed range.
pub fn validate_amount(amount: i128) -> Result<(), ContractError> {
    if amount < MIN_AMOUNT {
        return Err(ContractError::InvalidAmount);
    }
    if amount > MAX_AMOUNT {
        return Err(ContractError::BalanceOverflow);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;

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
    }

    #[test]
    fn amount_above_max_rejected() {
        assert_eq!(
            validate_amount(MAX_AMOUNT + 1),
            Err(ContractError::BalanceOverflow)
        );
    }
}
