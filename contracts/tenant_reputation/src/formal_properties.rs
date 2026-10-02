#![cfg(kani)]

use super::*;
use soroban_sdk::{Address, Env, Symbol};

// The harness below exercises the contract's public update path so the proof
// covers the validation and score calculation actually used on-chain.
#[kani::proof]
pub fn verify_tenant_reputation_init_and_update() {
    let env = Env::default();
    let contract_id = env.register(TenantReputation, ());
    let client = TenantReputationClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    let tenant = Address::generate(&env);
    env.mock_all_auths();

    client.init(&admin, &operator).unwrap();

    client
        .update_reputation(
            &operator,
            &tenant,
            &800,
            &850,
            &900,
            &750,
            &Symbol::new(&env, "payment_on_time"),
        )
        .unwrap();

    let record = client.get_reputation(&tenant).unwrap();
    assert_eq!(record.composite_score, 800);
    assert_eq!(record.total_ratings, 1);
}
