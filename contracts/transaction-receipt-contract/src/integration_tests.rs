#![cfg(test)]

extern crate alloc;
use crate::{
    ContractError, ReceiptInput, TransactionReceiptContract, TransactionReceiptContractClient,
};
use alloc::format;
use soroban_sdk::{testutils::Address as _, Address, Env, String, Symbol};

// Integration: init -> record multiple receipts -> query
#[test]
fn test_integration_init_record_query() {
    let env = Env::default();
    let contract_id = env.register(TransactionReceiptContract, ());
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);

    let _ = client.try_init(&admin, &operator).unwrap();

    // Allow require_auth to succeed for our mock calls
    env.mock_all_auths();

    let token = Address::generate(&env);

    // Record two receipts for deal "dealA" and one for "dealB"
    let deal_a = String::from_str(&env, "dealA");
    let deal_b = String::from_str(&env, "dealB");

    let input_a1 = ReceiptInput {
        external_ref_source: Symbol::new(&env, "manual_admin"),
        external_ref: String::from_str(&env, "a_ref_1"),
        tx_type: Symbol::new(&env, "TENANT_REPAYMENT"),
        amount_usdc: 10_000_000_000_i128,
        token: token.clone(),
        deal_id: deal_a.clone(),
        listing_id: None,
        from: None,
        to: None,
        amount_ngn: None,
        fx_rate_ngn_per_usdc: None,
        fx_provider: None,
        metadata_hash: None,
    };

    let input_a2 = ReceiptInput {
        external_ref_source: Symbol::new(&env, "manual_admin"),
        external_ref: String::from_str(&env, "a_ref_2"),
        tx_type: Symbol::new(&env, "LANDLORD_PAYOUT"),
        amount_usdc: 20_000_000_000_i128,
        token: token.clone(),
        deal_id: deal_a.clone(),
        listing_id: None,
        from: None,
        to: None,
        amount_ngn: None,
        fx_rate_ngn_per_usdc: None,
        fx_provider: None,
        metadata_hash: None,
    };

    let input_b1 = ReceiptInput {
        external_ref_source: Symbol::new(&env, "manual_admin"),
        external_ref: String::from_str(&env, "b_ref_1"),
        tx_type: Symbol::new(&env, "WHISTLEBLOWER_REWARD"),
        amount_usdc: 30_000_000_000_i128,
        token: token.clone(),
        deal_id: deal_b.clone(),
        listing_id: None,
        from: None,
        to: None,
        amount_ngn: None,
        fx_rate_ngn_per_usdc: None,
        fx_provider: None,
        metadata_hash: None,
    };

    let tx_a1 = client
        .try_record_receipt(&operator, &input_a1)
        .unwrap()
        .unwrap();
    let _tx_a2 = client
        .try_record_receipt(&operator, &input_a2)
        .unwrap()
        .unwrap();
    let _tx_b1 = client
        .try_record_receipt(&operator, &input_b1)
        .unwrap()
        .unwrap();

    // Query by tx id
    let got_a1 = client.get_receipt(&tx_a1);
    assert!(got_a1.is_some());
    let got = got_a1.unwrap();
    assert_eq!(got.tx_id, tx_a1);
    assert_eq!(got.deal_id, deal_a);

    // List receipts by deal A
    let list_a = client.list_receipts_by_deal(&deal_a, &10u32, &Option::<u32>::None);
    assert_eq!(list_a.len(), 2);

    // List receipts by deal B
    let list_b = client.list_receipts_by_deal(&deal_b, &10u32, &Option::<u32>::None);
    assert_eq!(list_b.len(), 1);

    // Pagination: limit 1 should return first element only
    let page1 = client.list_receipts_by_deal(&deal_a, &1u32, &Option::<u32>::None);
    assert_eq!(page1.len(), 1);

    let page2 = client.list_receipts_by_deal(&deal_a, &1u32, &Some(1u32));
    assert_eq!(page2.len(), 1);
}

// Integration: authorization flow (init -> set_operator -> record with new operator)
#[test]
fn test_integration_authorization_flow() {
    let env = Env::default();
    let contract_id = env.register(TransactionReceiptContract, ());
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator1 = Address::generate(&env);
    let operator2 = Address::generate(&env);

    let _ = client.try_init(&admin, &operator1).unwrap();

    env.mock_all_auths();

    // Admin rotates operator to operator2
    let _ = client.try_set_operator(&admin, &operator2).unwrap();

    let token = Address::generate(&env);
    let deal = String::from_str(&env, "auth_deal");

    let input = ReceiptInput {
        external_ref_source: Symbol::new(&env, "manual_admin"),
        external_ref: String::from_str(&env, "auth_ref"),
        tx_type: Symbol::new(&env, "STAKE"),
        amount_usdc: 50_000_000_000_i128,
        token: token.clone(),
        deal_id: deal.clone(),
        listing_id: None,
        from: None,
        to: None,
        amount_ngn: None,
        fx_rate_ngn_per_usdc: None,
        fx_provider: None,
        metadata_hash: None,
    };

    // Recording with new operator should succeed
    let _tx = client
        .try_record_receipt(&operator2, &input)
        .unwrap()
        .unwrap();

    // Recording with old operator should fail
    let input2 = ReceiptInput {
        external_ref: String::from_str(&env, "auth_ref2"),
        ..input
    };
    let res_err = client.try_record_receipt(&operator1, &input2);
    assert!(res_err.is_err());
    assert_eq!(res_err.unwrap_err().unwrap(), ContractError::NotAuthorized);
}

// Integration: pause flow (init -> record -> pause -> fail record -> unpause -> record)
#[test]
fn test_integration_pause_flow() {
    let env = Env::default();
    let contract_id = env.register(TransactionReceiptContract, ());
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);

    let _ = client.try_init(&admin, &operator).unwrap();

    env.mock_all_auths();

    let token = Address::generate(&env);
    let deal = String::from_str(&env, "pause_deal");

    let input = ReceiptInput {
        external_ref_source: Symbol::new(&env, "manual_admin"),
        external_ref: String::from_str(&env, "pause_ref"),
        tx_type: Symbol::new(&env, "STAKE"),
        amount_usdc: 100_000_000_000_i128,
        token: token.clone(),
        deal_id: deal.clone(),
        listing_id: None,
        from: None,
        to: None,
        amount_ngn: None,
        fx_rate_ngn_per_usdc: None,
        fx_provider: None,
        metadata_hash: None,
    };

    // Record should succeed before pause
    client
        .try_record_receipt(&operator, &input)
        .unwrap()
        .unwrap();

    // Pause contract
    let _ = client.try_pause(&admin).unwrap();

    // Recording while paused should fail
    let input2 = ReceiptInput {
        external_ref: String::from_str(&env, "pause_ref2"),
        ..input
    };
    let res = client.try_record_receipt(&operator, &input2);
    assert!(res.is_err());
    assert_eq!(res.unwrap_err().unwrap(), ContractError::Paused);

    // Unpause
    let _ = client.try_unpause(&admin).unwrap();

    // Now recording should succeed again
    let _tx2 = client
        .try_record_receipt(&operator, &input2)
        .unwrap()
        .unwrap();
}

// Integration: deal queries with multiple receipts and pagination across pages
#[test]
fn test_integration_deal_queries_and_pagination() {
    let env = Env::default();
    let contract_id = env.register(TransactionReceiptContract, ());
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);

    let _ = client.try_init(&admin, &operator).unwrap();
    env.mock_all_auths();

    let token = Address::generate(&env);
    let deal = String::from_str(&env, "paging_deal");

    // Create 5 receipts for the same deal
    for i in 0..5u8 {
        let ext = format!("p_ref_{}", i);
        let input = ReceiptInput {
            external_ref_source: Symbol::new(&env, "manual_admin"),
            external_ref: String::from_str(&env, &ext),
            tx_type: Symbol::new(&env, "STAKE"),
            amount_usdc: 10_000_000_000_i128 + (i as i128),
            token: token.clone(),
            deal_id: deal.clone(),
            listing_id: None,
            from: None,
            to: None,
            amount_ngn: None,
            fx_rate_ngn_per_usdc: None,
            fx_provider: None,
            metadata_hash: None,
        };
        client
            .try_record_receipt(&operator, &input)
            .unwrap()
            .unwrap();
    }

    // Page 0, limit 2
    let p0 = client.list_receipts_by_deal(&deal, &2u32, &Option::<u32>::None);
    assert_eq!(p0.len(), 2);

    // Page 1 (cursor 2), limit 2
    let p1 = client.list_receipts_by_deal(&deal, &2u32, &Some(2u32));
    assert_eq!(p1.len(), 2);

    // Page 2 (cursor 4), limit 2 -> should have 1
    let p2 = client.list_receipts_by_deal(&deal, &2u32, &Some(4u32));
    assert_eq!(p2.len(), 1);
}

#[test]
fn test_integration_invalid_tx_type_rejected() {
    let env = Env::default();
    let contract_id = env.register(TransactionReceiptContract, ());
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);

    let _ = client.try_init(&admin, &operator).unwrap();

    // Allow require_auth to succeed for our mock calls
    env.mock_all_auths();

    let token = Address::generate(&env);

    // Test invalid transaction type
    let invalid_input = ReceiptInput {
        external_ref_source: Symbol::new(&env, "manual_admin"),
        external_ref: String::from_str(&env, "invalid_ref"),
        tx_type: Symbol::new(&env, "INVALID_TYPE"), // Not in allowed list
        amount_usdc: 10_000_000_000_i128,
        token: token.clone(),
        deal_id: String::from_str(&env, "deal_invalid"),
        listing_id: None,
        from: None,
        to: None,
        amount_ngn: None,
        fx_rate_ngn_per_usdc: None,
        fx_provider: None,
        metadata_hash: None,
    };

    // Should fail with InvalidTxType error
    let result = client.try_record_receipt(&operator, &invalid_input);
    assert!(result.is_err(), "Invalid tx_type should be rejected");
    assert_eq!(result.unwrap_err().unwrap(), ContractError::InvalidTxType);

    // Test valid transaction type should succeed
    let valid_input = ReceiptInput {
        external_ref_source: Symbol::new(&env, "manual_admin"),
        external_ref: String::from_str(&env, "valid_ref"),
        tx_type: Symbol::new(&env, "TENANT_REPAYMENT"), // Valid type
        amount_usdc: 10_000_000_000_i128,
        token: token.clone(),
        deal_id: String::from_str(&env, "deal_valid"),
        listing_id: None,
        from: None,
        to: None,
        amount_ngn: None,
        fx_rate_ngn_per_usdc: None,
        fx_provider: None,
        metadata_hash: None,
    };

    // Should succeed
    let result = client.try_record_receipt(&operator, &valid_input);
    assert!(result.is_ok(), "Valid tx_type should be accepted");
}
