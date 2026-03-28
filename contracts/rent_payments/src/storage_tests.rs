extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    Address, Env, IntoVal,
};
use std::println;

fn setup(env: &Env) -> (Address, RentPaymentsClient<'_>, Address) {
    let contract_id = env.register(RentPayments, ());
    let client = RentPaymentsClient::new(env, &contract_id);
    let admin = Address::generate(env);
    client.init(&admin);
    (admin, client, contract_id)
}

#[test]
fn test_storage_size_limit_discovery() {
    let env = Env::default();
    let (admin, client, contract_id) = setup(&env);
    let deal_id = 1u64;
    let payer = Address::generate(&env);

    // 64KB limit / ~100B ≈ 650 records.
    println!("--- Starting Storage Size Bound Test ---");
    let mut reached_limit = false;

    for i in 1..=2000 {
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "create_receipt",
                args: (deal_id, 1000i128, payer.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let result = client.try_create_receipt(&deal_id, &1000i128, &payer);

        if result.is_err() {
            println!("FAILURE: Reached storage limit at {} receipts.", i);
            reached_limit = true;
            break;
        }

        if i % 100 == 0 {
            println!("Inserted {} receipts successfully...", i);
        }
    }

    if !reached_limit {
        println!(
            "SUCCESS (?): Contract handled 2000 receipts without hitting storage size limits."
        );
    }
}

#[test]
fn test_gas_exhaustion_on_sorting() {
    let env = Env::default();
    let (admin, client, contract_id) = setup(&env);
    let deal_id = 2u64;
    let payer = Address::generate(&env);

    println!("--- Starting Gas Exhaustion (Sorting) Test ---");

    // Insert 500 receipts. Insertion sort (O(n^2)) will hit CPU limits eventually.
    for i in 1..=500 {
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "create_receipt",
                args: (deal_id, 1000i128, payer.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        client.create_receipt(&deal_id, &1000i128, &payer);

        if i % 100 == 0 {
            // Measure CPU cost for listing at this scale
            let start_cpu = env.cost_estimate().budget().cpu_instruction_cost();
            let _ = client.list_receipts_by_deal(&deal_id, &10u32, &None);
            let end_cpu = env.cost_estimate().budget().cpu_instruction_cost();
            println!(
                "Pagination CPU cost at {} receipts: {} instructions",
                i,
                end_cpu - start_cpu
            );
        }
    }
}

#[test]
fn test_large_deal_id_isolation() {
    let env = Env::default();
    let (admin, client, contract_id) = setup(&env);
    let payer = Address::generate(&env);

    // Test if using u64::MAX as deal_id (used for global counter) interferes with normal deals
    let deal_id = u64::MAX - 1;

    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "create_receipt",
            args: (deal_id, 1000i128, payer.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    let receipt = client.create_receipt(&deal_id, &1000i128, &payer);
    assert_eq!(receipt.deal_id, deal_id);
    assert_eq!(client.receipt_count(&deal_id), 1);
}
