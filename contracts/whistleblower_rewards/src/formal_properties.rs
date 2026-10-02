#![cfg(kani)]

use super::*;
use soroban_sdk::{Address, BytesN, Env, String, Symbol};

// This harness calls the public lifecycle methods instead of reimplementing
// the reward arithmetic, so Kani verifies the contract path itself.
#[kani::proof]
pub fn verify_whistleblower_reward_lifecycle() {
    let env = Env::default();
    let contract_id = env.register(WhistleblowerRewards, ());
    let client = WhistleblowerRewardsClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let reporter = Address::generate(&env);
    env.mock_all_auths();

    client.init(&admin);

    let report_id = BytesN::from_array(&env, &[2u8; 32]);
    let listing_id = String::from_str(&env, "listing_99");
    client.submit_report(
        &reporter,
        &report_id,
        &listing_id,
        &Symbol::new(&env, "fraud"),
        &String::from_str(&env, "evidence"),
    );

    let report = client.get_report(&report_id).unwrap();
    assert_eq!(report.reporter, reporter);

    client.evaluate_report(&admin, &report_id, &true, &500);
    let evaluated_report = client.get_report(&report_id).unwrap();
    assert!(matches!(evaluated_report.status, ReportStatus::Verified));
}
