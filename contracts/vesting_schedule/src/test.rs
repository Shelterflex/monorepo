#[test]
fn test_vested_amount_before_cliff() {
    let total = 1000i128;
    let start = 100u64;
    let cliff = 200u64;
    let end = 300u64;

    // Before cliff
    assert_eq!(super::vested_amount(total, start, cliff, end, 150), 0);
}

#[test]
fn test_vested_amount_at_cliff() {
    let total = 1000i128;
    let start = 100u64;
    let cliff = 200u64;
    let end = 300u64;

    // At cliff - vested is calculated from start, but not claimable
    // Duration = 200, elapsed = 100, so 50% vested = 500
    assert_eq!(super::vested_amount(total, start, cliff, end, 200), 500);
}

#[test]
fn test_vested_amount_linear() {
    let total = 1000i128;
    let start = 100u64;
    let cliff = 200u64;
    let end = 300u64;

    // Midway through total vesting period (start + (end - start) / 2)
    let mid = 250u64;
    let vested = super::vested_amount(total, start, cliff, end, mid);
    // Total duration is 200 (end - start), elapsed is 150, so 75% vested = 750
    assert_eq!(vested, 750);
}

#[test]
fn test_vested_amount_at_end() {
    let total = 1000i128;
    let start = 100u64;
    let cliff = 200u64;
    let end = 300u64;

    // At end - full amount
    assert_eq!(super::vested_amount(total, start, cliff, end, 300), 1000);
}

#[test]
fn test_vested_amount_after_end() {
    let total = 1000i128;
    let start = 100u64;
    let cliff = 200u64;
    let end = 300u64;

    // After end - still full amount
    assert_eq!(super::vested_amount(total, start, cliff, end, 400), 1000);
}

#[test]
fn test_vested_amount_never_exceeds_total() {
    let total = 100i128;
    let start = 0u64;
    let cliff = 0u64;
    let end = 100u64;

    for t in 0..=200u64 {
        let vested = super::vested_amount(total, start, cliff, end, t);
        assert!(
            vested <= total,
            "vested {vested} exceeds total {total} at time {t}"
        );
    }
}

#[test]
fn test_vested_amount_rounding_down() {
    // Test that rounding always goes down, never exceeds total
    let total = 7i128; // Prime number to test rounding
    let start = 0u64;
    let cliff = 0u64;
    let end = 10u64;

    let mut total_vested = 0i128;
    for t in 0..=20u64 {
        let vested = super::vested_amount(total, start, cliff, end, t);
        assert!(vested >= total_vested, "vesting should be monotonic");
        total_vested = vested;
    }
    assert_eq!(total_vested, total);
}

#[test]
fn test_vested_amount_monotonic() {
    let total = 1000i128;
    let start = 100u64;
    let cliff = 200u64;
    let end = 300u64;

    let mut prev = 0i128;
    for t in 150..=350u64 {
        let vested = super::vested_amount(total, start, cliff, end, t);
        assert!(
            vested >= prev,
            "vesting should be monotonic: {prev} < {vested} at time {t}"
        );
        prev = vested;
    }
}

#[test]
fn test_vested_amount_zero_total() {
    assert_eq!(super::vested_amount(0, 0, 0, 100, 50), 0);
}

#[test]
fn test_vested_amount_negative_total() {
    assert_eq!(super::vested_amount(-100, 0, 0, 100, 50), 0);
}

#[test]
fn test_claimable_at() {
    let schedule = crate::VestingSchedule {
        total_amount: 1000,
        claimed_amount: 200,
        start_time: 100,
        cliff_time: 200,
        end_time: 300,
        revocable: true,
        revoked: false,
    };

    // Before cliff - nothing claimable
    assert_eq!(super::claimable_at(&schedule, 150), 0);

    // At mid-point - 750 vested (75% of 1000), 200 claimed, so 550 claimable
    assert_eq!(super::claimable_at(&schedule, 250), 550);

    // After end - 1000 vested, 200 claimed, so 800 claimable
    assert_eq!(super::claimable_at(&schedule, 400), 800);
}

#[test]
fn test_claimable_at_claimed_exceeds_vested() {
    let schedule = crate::VestingSchedule {
        total_amount: 1000,
        claimed_amount: 500,
        start_time: 100,
        cliff_time: 200,
        end_time: 300,
        revocable: true,
        revoked: false,
    };

    // After end - 1000 vested, but 500 already claimed, so 500 claimable
    assert_eq!(super::claimable_at(&schedule, 400), 500);
}

#[test]
fn test_claimable_at_max_zero() {
    let schedule = crate::VestingSchedule {
        total_amount: 1000,
        claimed_amount: 1000,
        start_time: 100,
        cliff_time: 200,
        end_time: 300,
        revocable: true,
        revoked: false,
    };

    // Fully claimed
    assert_eq!(super::claimable_at(&schedule, 400), 0);
}
