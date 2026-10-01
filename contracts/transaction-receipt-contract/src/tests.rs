#![cfg(test)]

extern crate alloc;
extern crate std;

use crate::{
    ContractError, Receipt, ReceiptInput, TransactionReceiptContract,
    TransactionReceiptContractClient,
};
use alloc::format;
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger as _},
    Address, BytesN, Env, String, Symbol, TryFromVal,
};

fn bytes_to_hex_string(env: &Env, bytes: &BytesN<32>) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let arr = bytes.to_array();
    let mut out = [0u8; 64];
    for (idx, b) in arr.iter().enumerate() {
        out[idx * 2] = HEX[(b >> 4) as usize];
        out[idx * 2 + 1] = HEX[(b & 0x0f) as usize];
    }
    let std_str = std::string::String::from_utf8(out.to_vec()).unwrap();
    String::from_str(env, &std_str)
}

#[test]
fn test_happy_path_issue_receipt() {
    let env = Env::default();
    let contract_id = env.register(TransactionReceiptContract, ());
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    client.init(&admin, &operator);

    env.mock_all_auths();

    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);

    let input = ReceiptInput {
        external_ref_source: Symbol::new(&env, "stellar"),
        external_ref: String::from_str(&env, "ref_happy_path"),
        tx_type: Symbol::new(&env, "TENANT_REPAYMENT"),
        amount_usdc: 150_0000000i128,
        token: token.clone(),
        deal_id: String::from_str(&env, "deal_happy"),
        listing_id: Some(String::from_str(&env, "list_happy")),
        from: Some(payer.clone()),
        to: Some(recipient.clone()),
        amount_ngn: None,
        fx_rate_ngn_per_usdc: None,
        fx_provider: None,
        metadata_hash: None,
    };

    let tx_id = client.record_receipt(&operator, &input);
    assert_eq!(tx_id.len(), 32);

    let receipt = client.get_receipt(&tx_id).unwrap();
    assert_eq!(receipt.tx_id, tx_id);
    assert_eq!(receipt.amount_usdc, 150_0000000i128);
    assert_eq!(receipt.from, Some(payer));
    assert_eq!(receipt.to, Some(recipient));
    assert_eq!(receipt.token, token);
    assert_eq!(receipt.timestamp, env.ledger().timestamp());
}

#[test]
fn test_receipt_immutability() {
    let env = Env::default();
    let contract_id = env.register(TransactionReceiptContract, ());
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    client.init(&admin, &operator);

    env.mock_all_auths();

    let token = Address::generate(&env);
    let input = ReceiptInput {
        external_ref_source: Symbol::new(&env, "stellar"),
        external_ref: String::from_str(&env, "ref_immutability"),
        tx_type: Symbol::new(&env, "TENANT_REPAYMENT"),
        amount_usdc: 100_0000000i128,
        token: token.clone(),
        deal_id: String::from_str(&env, "deal_immutability"),
        listing_id: None,
        from: None,
        to: None,
        amount_ngn: None,
        fx_rate_ngn_per_usdc: None,
        fx_provider: None,
        metadata_hash: None,
    };

    // First issuance succeeds
    let res1 = client.try_record_receipt(&operator, &input);
    assert!(res1.is_ok());

    // Second issuance with same ID should fail
    let res2 = client.try_record_receipt(&operator, &input);
    assert!(res2.is_err());
    assert_eq!(
        res2.unwrap_err().unwrap(),
        ContractError::DuplicateTransaction
    );
}

#[test]
fn test_retrieve_receipt() {
    let env = Env::default();
    let contract_id = env.register(TransactionReceiptContract, ());
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    client.init(&admin, &operator);

    env.mock_all_auths();

    let token = Address::generate(&env);
    let input = ReceiptInput {
        external_ref_source: Symbol::new(&env, "stellar"),
        external_ref: String::from_str(&env, "ref_retrieve"),
        tx_type: Symbol::new(&env, "TENANT_REPAYMENT"),
        amount_usdc: 200_0000000i128,
        token: token.clone(),
        deal_id: String::from_str(&env, "deal_retrieve"),
        listing_id: None,
        from: None,
        to: None,
        amount_ngn: None,
        fx_rate_ngn_per_usdc: None,
        fx_provider: None,
        metadata_hash: None,
    };

    let tx_id = client.record_receipt(&operator, &input);
    let receipt = client.get_receipt(&tx_id).unwrap();
    assert_eq!(receipt.tx_id, tx_id);
    assert_eq!(receipt.amount_usdc, 200_0000000i128);
    assert_eq!(receipt.deal_id, String::from_str(&env, "deal_retrieve"));
}

#[test]
fn test_non_existent_receipt() {
    let env = Env::default();
    let contract_id = env.register(TransactionReceiptContract, ());
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    client.init(&admin, &operator);

    let unknown_id = BytesN::from_array(&env, &[9u8; 32]);
    let result = client.get_receipt(&unknown_id);
    assert!(result.is_none());
}

#[test]
fn test_unauthorized_issuance() {
    let env = Env::default();
    let contract_id = env.register(TransactionReceiptContract, ());
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    client.init(&admin, &operator);

    env.mock_all_auths();

    let unauthorized_caller = Address::generate(&env);
    let token = Address::generate(&env);
    let input = ReceiptInput {
        external_ref_source: Symbol::new(&env, "stellar"),
        external_ref: String::from_str(&env, "ref_unauthorized"),
        tx_type: Symbol::new(&env, "TENANT_REPAYMENT"),
        amount_usdc: 50_0000000i128,
        token: token.clone(),
        deal_id: String::from_str(&env, "deal_unauthorized"),
        listing_id: None,
        from: None,
        to: None,
        amount_ngn: None,
        fx_rate_ngn_per_usdc: None,
        fx_provider: None,
        metadata_hash: None,
    };

    let res = client.try_record_receipt(&unauthorized_caller, &input);
    assert!(res.is_err());
    assert_eq!(res.unwrap_err().unwrap(), ContractError::NotAuthorized);
}

#[test]
fn test_zero_amount_guard() {
    let env = Env::default();
    let contract_id = env.register(TransactionReceiptContract, ());
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    client.init(&admin, &operator);

    env.mock_all_auths();

    let token = Address::generate(&env);
    let input = ReceiptInput {
        external_ref_source: Symbol::new(&env, "stellar"),
        external_ref: String::from_str(&env, "ref_zero_amount"),
        tx_type: Symbol::new(&env, "TENANT_REPAYMENT"),
        amount_usdc: 0,
        token: token.clone(),
        deal_id: String::from_str(&env, "deal_zero"),
        listing_id: None,
        from: None,
        to: None,
        amount_ngn: None,
        fx_rate_ngn_per_usdc: None,
        fx_provider: None,
        metadata_hash: None,
    };

    let res = client.try_record_receipt(&operator, &input);
    assert!(res.is_err());
    assert_eq!(res.unwrap_err().unwrap(), ContractError::InvalidAmount);
}

#[test]
fn test_timestamp_accuracy() {
    let env = Env::default();
    let contract_id = env.register(TransactionReceiptContract, ());
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    client.init(&admin, &operator);

    env.mock_all_auths();
    env.ledger().set_timestamp(999999);

    let token = Address::generate(&env);
    let input = ReceiptInput {
        external_ref_source: Symbol::new(&env, "stellar"),
        external_ref: String::from_str(&env, "ref_timestamp"),
        tx_type: Symbol::new(&env, "TENANT_REPAYMENT"),
        amount_usdc: 300_0000000i128,
        token: token.clone(),
        deal_id: String::from_str(&env, "deal_timestamp"),
        listing_id: None,
        from: None,
        to: None,
        amount_ngn: None,
        fx_rate_ngn_per_usdc: None,
        fx_provider: None,
        metadata_hash: None,
    };

    let tx_id = client.record_receipt(&operator, &input);
    let receipt = client.get_receipt(&tx_id).unwrap();
    assert_eq!(receipt.timestamp, 999999);
    assert_eq!(receipt.timestamp, env.ledger().timestamp());
}

#[test]
fn test_event_emission() {
    let env = Env::default();
    let contract_id = env.register(TransactionReceiptContract, ());
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    client.init(&admin, &operator);

    env.mock_all_auths();

    let token = Address::generate(&env);
    let input = ReceiptInput {
        external_ref_source: Symbol::new(&env, "stellar"),
        external_ref: String::from_str(&env, "ref_event"),
        tx_type: Symbol::new(&env, "TENANT_REPAYMENT"),
        amount_usdc: 400_0000000i128,
        token: token.clone(),
        deal_id: String::from_str(&env, "deal_event"),
        listing_id: None,
        from: None,
        to: None,
        amount_ngn: None,
        fx_rate_ngn_per_usdc: None,
        fx_provider: None,
        metadata_hash: None,
    };

    let tx_id = client.record_receipt(&operator, &input);

    let events = env.events().all();
    let mut found = false;
    for (_, topics, val) in events.iter() {
        if let Some(t0) = topics.get(0) {
            if let Some(t1) = topics.get(1) {
                if let Some(t2) = topics.get(2) {
                    let topic1 = Symbol::try_from_val(&env, &t0).unwrap();
                    let topic2 = Symbol::try_from_val(&env, &t1).unwrap();
                    let topic3 = BytesN::<32>::try_from_val(&env, &t2).unwrap();
                    if topic1 == Symbol::new(&env, "transaction_receipt")
                        && topic2 == Symbol::new(&env, "receipt_recorded")
                        && topic3 == tx_id
                    {
                        let receipt: Receipt = TryFromVal::try_from_val(&env, &val).unwrap();
                        assert_eq!(receipt.amount_usdc, 400_0000000i128);
                        found = true;
                        break;
                    }
                }
            }
        }
    }
    assert!(found, "Receipt event not emitted");
}

#[test]
fn test_high_volume_isolation() {
    let env = Env::default();
    let contract_id = env.register(TransactionReceiptContract, ());
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    client.init(&admin, &operator);

    env.mock_all_auths();

    let token = Address::generate(&env);
    let mut tx_ids = std::vec::Vec::new();
    for i in 0..100 {
        let payment_id = BytesN::from_array(&env, &[i as u8; 32]);
        let ref_str = bytes_to_hex_string(&env, &payment_id);
        let input = ReceiptInput {
            external_ref_source: Symbol::new(&env, "stellar"),
            external_ref: ref_str,
            tx_type: Symbol::new(&env, "TENANT_REPAYMENT"),
            amount_usdc: 1000 + i as i128,
            token: token.clone(),
            deal_id: String::from_str(&env, &format!("deal_{}", i)),
            listing_id: None,
            from: None,
            to: None,
            amount_ngn: None,
            fx_rate_ngn_per_usdc: None,
            fx_provider: None,
            metadata_hash: None,
        };
        let tx_id = client.record_receipt(&operator, &input);
        tx_ids.push(tx_id);
    }
    for (i, tx_id) in tx_ids.iter().enumerate() {
        let receipt = client.get_receipt(tx_id).unwrap();
        assert_eq!(receipt.amount_usdc, 1000 + i as i128);
        assert_eq!(
            receipt.deal_id,
            String::from_str(&env, &format!("deal_{}", i))
        );
    }
}

#[test]
fn test_pagination_overflow_and_limit_cap() {
    let env = Env::default();
    let contract_id = env.register(TransactionReceiptContract, ());
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    client.init(&admin, &operator);

    env.mock_all_auths();

    let token = Address::generate(&env);
    let input = ReceiptInput {
        external_ref_source: Symbol::new(&env, "stellar"),
        external_ref: String::from_str(&env, "ref_pagination"),
        tx_type: Symbol::new(&env, "TENANT_REPAYMENT"),
        amount_usdc: 100_0000000i128,
        token: token.clone(),
        deal_id: String::from_str(&env, "deal_pagination"),
        listing_id: None,
        from: None,
        to: None,
        amount_ngn: None,
        fx_rate_ngn_per_usdc: None,
        fx_provider: None,
        metadata_hash: None,
    };
    client.record_receipt(&operator, &input);

    // Test that excessive limit and cursor values do not panic (should clamp/safely handle)
    let receipts_deal = client.list_receipts_by_deal(
        &String::from_str(&env, "deal_pagination"),
        &u32::MAX,
        &Some(1),
    );
    assert_eq!(receipts_deal.len(), 0);

    let user = Address::generate(&env);
    let receipts_user = client.list_receipts_by_user(&user, &u32::MAX, &Some(1));
    assert_eq!(receipts_user.len(), 0);
}
