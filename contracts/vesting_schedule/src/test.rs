use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env};

use crate::{calculate_claimable_amount, calculate_vested_amount, VestingSchedule};

#[test]
fn test_calculate_vested_amount() {
    let schedule = VestingSchedule {
        beneficiary: Address::generate(&Env::default()),
        total_amount: 1000,
        claimed_amount: 0,
        start_time: 1000,
        end_time: 2000,
        cliff_time: 1200,
        revocable: true,
        revoked: false,
    };

    // Before start
    assert_eq!(calculate_vested_amount(&schedule, 900), 0);

    // At start
    assert_eq!(calculate_vested_amount(&schedule, 1000), 0);

    // Before cliff (vesting accrues from start)
    assert_eq!(calculate_vested_amount(&schedule, 1100), 100);

    // At cliff
    assert_eq!(calculate_vested_amount(&schedule, 1200), 200);

    // Halfway
    assert_eq!(calculate_vested_amount(&schedule, 1500), 500);

    // After end
    assert_eq!(calculate_vested_amount(&schedule, 2500), 1000);
}

#[test]
fn test_calculate_claimable_amount() {
    let schedule = VestingSchedule {
        beneficiary: Address::generate(&Env::default()),
        total_amount: 1000,
        claimed_amount: 200,
        start_time: 1000,
        end_time: 2000,
        cliff_time: 1200,
        revocable: true,
        revoked: false,
    };

    // Halfway, already claimed 200
    assert_eq!(calculate_claimable_amount(&schedule, 1500), 300);
}
