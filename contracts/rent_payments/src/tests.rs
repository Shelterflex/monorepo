use soroban_sdk::{
    testutils::{Address as _, Events, Ledger, MockAuth, MockAuthInvoke},
    Address, BytesN, Env, IntoVal, Symbol, TryIntoVal,
};

use super::{ContractError, RentPayments, RentPaymentsClient};

fn setup(env: &Env) -> (Address, RentPaymentsClient<'_>, soroban_sdk::Address) {
    env.mock_all_auths();
    let contract_id = env.register(RentPayments, ());
    let client = RentPaymentsClient::new(env, &contract_id);
    let admin = Address::generate(env);
    client.init(&admin);
    (admin, client, contract_id)
}

fn generate_reference(env: &Env, seed: u64) -> BytesN<32> {
    let mut bytes = [0u8; 32];
    let seed_bytes = seed.to_be_bytes();
    for i in 0..8 {
        bytes[i] = seed_bytes[i];
    }
    BytesN::from_array(env, &bytes)
}

#[test]
fn test_record_payment_happy_path() {
    let env = Env::default();
    let (admin, client, contract_id) = setup(&env);
    let deal_id = 1u64;
    let payer = Address::generate(&env);
    let amount = 1000i128;

    // Set ledger timestamp to ensure timestamp is recorded
    env.ledger().set_timestamp(12345);

    let reference = generate_reference(&env, 1);
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "create_receipt",
            args: (deal_id, amount, payer.clone(), reference.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    let receipt = client.create_receipt(&deal_id, &amount, &payer, &reference);

    assert_eq!(receipt.deal_id, deal_id);
    assert_eq!(receipt.amount, amount);
    assert_eq!(receipt.payer, payer);
    assert!(receipt.timestamp > 0);

    // Verify receipt is stored
    let page = client.list_receipts_by_deal(&deal_id, &10u32, &None);
    assert_eq!(page.receipts.len(), 1);
}

#[test]
fn test_zero_amount_guard() {
    let env = Env::default();
    let (admin, client, contract_id) = setup(&env);
    let deal_id = 1u64;
    let payer = Address::generate(&env);

    let reference = generate_reference(&env, 1);
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "create_receipt",
            args: (deal_id, 0i128, payer.clone(), reference.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    let err = client
        .try_create_receipt(&deal_id, &0i128, &payer, &reference)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::InvalidAmount);
}

#[test]
fn test_negative_amount_guard() {
    let env = Env::default();
    let (admin, client, contract_id) = setup(&env);
    let deal_id = 1u64;
    let payer = Address::generate(&env);

    let reference = generate_reference(&env, 1);
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "create_receipt",
            args: (deal_id, -100i128, payer.clone(), reference.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    let err = client
        .try_create_receipt(&deal_id, &-100i128, &payer, &reference)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::InvalidAmount);
}

#[test]
#[should_panic]
fn test_unauthorized_caller() {
    let env = Env::default();
    let (_admin, client, contract_id) = setup(&env);
    let deal_id = 1u64;
    let payer = Address::generate(&env);
    let non_admin = Address::generate(&env);

    let reference = generate_reference(&env, 1);
    env.mock_auths(&[MockAuth {
        address: &non_admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "create_receipt",
            args: (deal_id, 1000i128, payer.clone(), reference.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    client.create_receipt(&deal_id, &1000i128, &payer, &reference);
}

#[test]
fn test_pause_behaviour() {
    let env = Env::default();
    let (admin, client, contract_id) = setup(&env);
    let deal_id = 1u64;
    let payer = Address::generate(&env);

    // Pause the contract
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "pause",
            args: (admin.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.pause(&admin);

    assert!(client.is_paused());

    // Try to create a receipt while paused
    let reference = generate_reference(&env, 1);
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "create_receipt",
            args: (deal_id, 1000i128, payer.clone(), reference.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    let err = client
        .try_create_receipt(&deal_id, &1000i128, &payer, &reference)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::Paused);
}

#[test]
fn test_multi_deal_isolation() {
    let env = Env::default();
    let (admin, client, contract_id) = setup(&env);
    let deal_id_1 = 1u64;
    let deal_id_2 = 2u64;
    let payer = Address::generate(&env);

    let reference1 = generate_reference(&env, 1);
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "create_receipt",
            args: (deal_id_1, 1000i128, payer.clone(), reference1.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.create_receipt(&deal_id_1, &1000i128, &payer, &reference1);

    // Create receipt for deal 2
    let reference2 = generate_reference(&env, 2);
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "create_receipt",
            args: (deal_id_2, 2000i128, payer.clone(), reference2.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.create_receipt(&deal_id_2, &2000i128, &payer, &reference2);

    // Verify isolation
    assert_eq!(client.receipt_count(&deal_id_1), 1u64);
    assert_eq!(client.receipt_count(&deal_id_2), 1u64);

    let page_1 = client.list_receipts_by_deal(&deal_id_1, &10u32, &None);
    let page_2 = client.list_receipts_by_deal(&deal_id_2, &10u32, &None);

    assert_eq!(page_1.receipts.len(), 1);
    assert_eq!(page_2.receipts.len(), 1);
    assert_eq!(page_1.receipts.get(0).unwrap().amount, 1000i128);
    assert_eq!(page_2.receipts.get(0).unwrap().amount, 2000i128);
}

#[test]
fn test_payment_recorded_event_emitted() {
    let env = Env::default();
    let (admin, client, contract_id) = setup(&env);
    let deal_id = 1u64;
    let payer = Address::generate(&env);
    let amount = 1000i128;

    let reference = generate_reference(&env, 1);
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "create_receipt",
            args: (deal_id, amount, payer.clone(), reference.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    client.create_receipt(&deal_id, &amount, &payer, &reference);

    let events = env.events().all();
    // The last event should be receipt_created
    let last = events.last().unwrap();
    let topics: soroban_sdk::Vec<soroban_sdk::Val> = last.1.clone();
    let action: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    assert_eq!(action, Symbol::new(&env, "receipt_created"));
}

#[test]
fn test_multiple_payments_for_same_deal() {
    let env = Env::default();
    let (admin, client, contract_id) = setup(&env);
    let deal_id = 1u64;
    let payer = Address::generate(&env);

    // Create multiple payments for the same deal
    for i in 1..=3 {
        let reference = generate_reference(&env, i);
        let amount = i as i128 * 1000i128;
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "create_receipt",
                args: (deal_id, amount, payer.clone(), reference.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.create_receipt(&deal_id, &amount, &payer, &reference);
    }

    assert_eq!(client.receipt_count(&deal_id), 3u64);

    let page = client.list_receipts_by_deal(&deal_id, &10u32, &None);
    assert_eq!(page.receipts.len(), 3);
}

#[test]
fn test_payment_with_different_payers() {
    let env = Env::default();
    let (admin, client, contract_id) = setup(&env);
    let deal_id = 1u64;
    let payer1 = Address::generate(&env);
    let payer2 = Address::generate(&env);

    let reference1 = generate_reference(&env, 1);
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "create_receipt",
            args: (deal_id, 1000i128, payer1.clone(), reference1.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.create_receipt(&deal_id, &1000i128, &payer1, &reference1);

    // Payment from payer2
    let reference2 = generate_reference(&env, 2);
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "create_receipt",
            args: (deal_id, 2000i128, payer2.clone(), reference2.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.create_receipt(&deal_id, &2000i128, &payer2, &reference2);

    assert_eq!(client.receipt_count(&deal_id), 2u64);

    let page = client.list_receipts_by_deal(&deal_id, &10u32, &None);
    assert_eq!(page.receipts.len(), 2);

    let mut found_payer1 = false;
    let mut found_payer2 = false;
    for receipt in page.receipts.iter() {
        if receipt.payer == payer1 {
            found_payer1 = true;
            assert_eq!(receipt.amount, 1000i128);
        }
        if receipt.payer == payer2 {
            found_payer2 = true;
            assert_eq!(receipt.amount, 2000i128);
        }
    }
    assert!(found_payer1);
    assert!(found_payer2);
}

#[test]
fn test_receipt_pagination() {
    let env = Env::default();
    let (admin, client, contract_id) = setup(&env);
    let deal_id = 1u64;
    let payer = Address::generate(&env);

    // Create 15 receipts
    for i in 1..=15 {
        let reference = generate_reference(&env, i);
        let amount = i as i128 * 1000i128;
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "create_receipt",
                args: (deal_id, amount, payer.clone(), reference.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.create_receipt(&deal_id, &amount, &payer, &reference);
    }

    // First page: 10 receipts
    let page1 = client.list_receipts_by_deal(&deal_id, &10u32, &None);
    assert_eq!(page1.receipts.len(), 10);
    assert!(page1.has_next);

    // Second page: remaining 5 receipts
    let cursor1 = page1.next_cursor.clone();
    let page2 = client.list_receipts_by_deal(&deal_id, &10u32, &Some(cursor1));
    assert_eq!(page2.receipts.len(), 5);
    assert!(!page2.has_next);
}

#[test]
fn test_invalid_limit_zero() {
    let env = Env::default();
    let (_admin, client, _contract_id) = setup(&env);
    let deal_id = 1u64;

    let err = client
        .try_list_receipts_by_deal(&deal_id, &0u32, &None)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::InvalidLimit);
}

#[test]
fn test_invalid_limit_too_large() {
    let env = Env::default();
    let (_admin, client, _contract_id) = setup(&env);
    let deal_id = 1u64;

    let err = client
        .try_list_receipts_by_deal(&deal_id, &101u32, &None)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::InvalidLimit);
}
