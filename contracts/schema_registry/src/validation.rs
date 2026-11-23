//! Input validation and sanitization for the schema_registry contract.

use crate::ContractError;

/// Validates that a version is non-zero.
pub fn validate_version(version: u32) -> Result<(), ContractError> {
    if version == 0 {
        return Err(ContractError::InvalidVersion);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;

    #[test]
    fn valid_version_passes() {
        assert!(validate_version(1).is_ok());
        assert!(validate_version(100).is_ok());
    }

    #[test]
    fn zero_version_rejected() {
        assert_eq!(validate_version(0), Err(ContractError::InvalidVersion));
    }
}
