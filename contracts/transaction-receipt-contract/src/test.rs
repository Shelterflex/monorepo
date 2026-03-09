#![cfg(test)]

extern crate std;

extern crate alloc;
use alloc::format;
use alloc::string::ToString;

use crate::{
    generate_tx_id, validate_tx_type, ContractError, Receipt, ReceiptInput, StorageKey,
    TransactionReceiptContract, TransactionReceiptContractClient, ALLOWED_SOURCES,
    ALLOWED_TX_TYPES,
};
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String, Symbol};
use std::string::String as StdString;

#[test]
fn test_allowed_sources_constant() {
    // Verify ALLOWED_SOURCES contains expected values
    assert_eq!(ALLOWED_SOURCES.len(), 8);
    assert!(ALLOWED_SOURCES.contains(&"paystack"));
    assert!(ALLOWED_SOURCES.contains(&"flutterwave"));
    assert!(ALLOWED_SOURCES.contains(&"bank_transfer"));
    assert!(ALLOWED_SOURCES.contains(&"stellar"));
    assert!(ALLOWED_SOURCES.contains(&"onramp"));
    assert!(ALLOWED_SOURCES.contains(&"offramp"));
    assert!(ALLOWED_SOURCES.contains(&"manual"));
    assert!(ALLOWED_SOURCES.contains(&"manual_admin"));
}

#[test]
fn test_generate_tx_id_golden_vector_v1() {
    let env = Env::default();
    let source = Symbol::new(&env, "PAYSTACK");
    let reference = String::from_str(&env, "  ref_12345  ");

    let tx_id = generate_tx_id(&env, &source, &reference).unwrap();

    let canonical = "v1|source=paystack|ref=ref_12345";
    let expected: BytesN<32> = env
        .crypto()
        .sha256(&soroban_sdk::Bytes::from_slice(&env, canonical.as_bytes()))
        .into();

    assert_eq!(tx_id, expected);
}

#[test]
fn test_metadata_hash_golden_vector_v1() {
    let env = Env::default();
    let contract_id = env.register(TransactionReceiptContract, ());
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    client.try_init(&admin, &operator).unwrap();
    env.mock_all_auths();

    let token = Address::generate(&env);
    let token_str: std::string::String = token.to_string().to_string();

    let input = ReceiptInput {
        external_ref_source: Symbol::new(&env, "PayStack"),
        external_ref: String::from_str(&env, "  ref_12345  "),
        tx_type: Symbol::new(&env, "CONVERSION"),
        amount_usdc: 1_000_000i128,
        token: token.clone(),
        deal_id: String::from_str(&env, "deal_001"),
        listing_id: None,
        from: None,
        to: None,
        amount_ngn: Some(1_500_000_000i128),
        fx_rate_ngn_per_usdc: Some(1500i128),
        fx_provider: Some(String::from_str(&env, "provider_x")),
        metadata_hash: None,
    };

    let canonical = format!(
        "v1|external_ref_source=paystack|external_ref=ref_12345|tx_type=CONVERSION|amount_usdc=1000000|token={}|deal_id=deal_001|amount_ngn=1500000000|fx_rate_ngn_per_usdc=1500|fx_provider=provider_x",
        token_str,
    );

    let expected: BytesN<32> = env
        .crypto()
        .sha256(&soroban_sdk::Bytes::from_slice(&env, canonical.as_bytes()))
        .into();

    let mut input_with_hash = input.clone();
    input_with_hash.metadata_hash = Some(expected.clone());

    let res = client
        .try_record_receipt(&operator, &input_with_hash)
        .unwrap()
        .unwrap();
    assert_eq!(res.len(), 32);
}

#[test]
fn test_metadata_hash_invalid_rejected() {
    let env = Env::default();
    let contract_id = env.register(TransactionReceiptContract, ());
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    client.try_init(&admin, &operator).unwrap();
    env.mock_all_auths();

    let token = Address::generate(&env);

    let mut bad_hash_bytes = [0u8; 32];
    bad_hash_bytes[0] = 1u8;
    let bad_hash = BytesN::from_array(&env, &bad_hash_bytes);

    let input = ReceiptInput {
        external_ref_source: Symbol::new(&env, "paystack"),
        external_ref: String::from_str(&env, "ref_999"),
        tx_type: Symbol::new(&env, "CONVERSION"),
        amount_usdc: 1_000_000i128,
        token: token.clone(),
        deal_id: String::from_str(&env, "deal_002"),
        listing_id: None,
        from: None,
        to: None,
        amount_ngn: None,
        fx_rate_ngn_per_usdc: None,
        fx_provider: None,
        metadata_hash: Some(bad_hash),
    };

    let err = client
        .try_record_receipt(&operator, &input)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::InvalidMetadataHash);
}

#[test]
fn test_contract_error_codes() {
    // Verify error codes match specification
    assert_eq!(ContractError::AlreadyInitialized as u32, 1);
    assert_eq!(ContractError::NotAuthorized as u32, 2);
    assert_eq!(ContractError::Paused as u32, 3);
    assert_eq!(ContractError::DuplicateTransaction as u32, 4);
    assert_eq!(ContractError::InvalidAmount as u32, 5);
    assert_eq!(ContractError::InvalidExternalRefSource as u32, 6);
    assert_eq!(ContractError::InvalidExternalRef as u32, 7);
    assert_eq!(ContractError::InvalidTimestamp as u32, 8);
    assert_eq!(ContractError::InvalidTxType as u32, 9);
    assert_eq!(ContractError::InvalidMetadataHash as u32, 10);
}

#[test]
fn test_receipt_struct_creation() {
    let env = Env::default();

    let tx_id = BytesN::from_array(&env, &[0u8; 32]);
    let token = Address::generate(&env);
    let deal_id = String::from_str(&env, "deal_123");

    let receipt = Receipt {
        tx_id: tx_id.clone(),
        tx_type: Symbol::new(&env, "rent_payment"),
        amount_usdc: 1000_0000000, // 1000 USDC (7 decimals)
        token: token.clone(),
        deal_id: deal_id.clone(),
        listing_id: None,
        from: None,
        to: None,
        external_ref: tx_id.clone(),
        amount_ngn: None,
        fx_rate_ngn_per_usdc: None,
        fx_provider: None,
        metadata_hash: None,
        timestamp: 1234567890,
    };

    // Verify receipt fields
    assert_eq!(receipt.tx_id, tx_id);
    assert_eq!(receipt.external_ref, tx_id);
    assert_eq!(receipt.amount_usdc, 1000_0000000);
    assert_eq!(receipt.timestamp, 1234567890);
}

#[test]
fn test_storage_key_variants() {
    let env = Env::default();

    // Test that all StorageKey variants can be created
    let _admin_key = StorageKey::Admin;
    let _operator_key = StorageKey::Operator;
    let _paused_key = StorageKey::Paused;

    let tx_id = BytesN::from_array(&env, &[1u8; 32]);
    let _receipt_key = StorageKey::Receipt(tx_id);

    let deal_id = String::from_str(&env, "deal_456");
    let _deal_index_key = StorageKey::DealIndex(deal_id.clone(), 0);
    let _deal_count_key = StorageKey::DealCount(deal_id);
}

// Tests for generate_tx_id function

#[test]
fn test_generate_tx_id_valid_input() {
    let env = Env::default();
    let source = Symbol::new(&env, "paystack");
    let reference = String::from_str(&env, "ref_12345");

    let result = generate_tx_id(&env, &source, &reference);
    assert!(result.is_ok());

    let tx_id = result.unwrap();
    // Verify it's a 32-byte hash
    assert_eq!(tx_id.len(), 32);
}

#[test]
fn test_generate_tx_id_all_allowed_sources() {
    let env = Env::default();
    let reference = String::from_str(&env, "test_ref");

    for source_str in ALLOWED_SOURCES.iter() {
        let source = Symbol::new(&env, source_str);
        let result = generate_tx_id(&env, &source, &reference);
        assert!(result.is_ok(), "Failed for source: {}", source_str);
    }
}

#[test]
fn test_generate_tx_id_invalid_source() {
    let env = Env::default();
    let source = Symbol::new(&env, "invalid_source");
    let reference = String::from_str(&env, "ref_12345");

    let result = generate_tx_id(&env, &source, &reference);
    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), ContractError::InvalidExternalRefSource);
}

#[test]
fn test_generate_tx_id_empty_reference() {
    let env = Env::default();
    let source = Symbol::new(&env, "paystack");
    let reference = String::from_str(&env, "");

    let result = generate_tx_id(&env, &source, &reference);
    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), ContractError::InvalidExternalRef);
}

#[test]
fn test_generate_tx_id_whitespace_only_reference() {
    let env = Env::default();
    let source = Symbol::new(&env, "paystack");
    let reference = String::from_str(&env, "   ");

    let result = generate_tx_id(&env, &source, &reference);
    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), ContractError::InvalidExternalRef);
}

#[test]
fn test_generate_tx_id_reference_with_pipe() {
    let env = Env::default();
    let source = Symbol::new(&env, "paystack");
    let reference = String::from_str(&env, "ref|12345");

    let result = generate_tx_id(&env, &source, &reference);
    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), ContractError::InvalidExternalRef);
}

#[test]
fn test_generate_tx_id_reference_too_long() {
    let env = Env::default();
    let source = Symbol::new(&env, "paystack");
    // Create a string with 257 characters
    let long_ref = "a".repeat(257);
    let reference = String::from_str(&env, &long_ref);

    let result = generate_tx_id(&env, &source, &reference);
    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), ContractError::InvalidExternalRef);
}

#[test]
fn test_generate_tx_id_reference_exactly_256_chars() {
    let env = Env::default();
    let source = Symbol::new(&env, "paystack");
    // Create a string with exactly 256 characters
    let max_ref = "a".repeat(256);
    let reference = String::from_str(&env, &max_ref);

    let result = generate_tx_id(&env, &source, &reference);
    assert!(result.is_ok());
}

#[test]
fn test_generate_tx_id_source_case_insensitive() {
    let env = Env::default();
    let reference = String::from_str(&env, "ref_12345");

    let source_lower = Symbol::new(&env, "paystack");
    let source_upper = Symbol::new(&env, "PAYSTACK");
    let source_mixed = Symbol::new(&env, "PayStack");

    let result_lower = generate_tx_id(&env, &source_lower, &reference).unwrap();
    let result_upper = generate_tx_id(&env, &source_upper, &reference).unwrap();
    let result_mixed = generate_tx_id(&env, &source_mixed, &reference).unwrap();

    // All should produce the same tx_id
    assert_eq!(result_lower, result_upper);
    assert_eq!(result_lower, result_mixed);
}

#[test]
fn test_generate_tx_id_reference_case_sensitive() {
    let env = Env::default();
    let source = Symbol::new(&env, "paystack");

    let ref_lower = String::from_str(&env, "ref_12345");
    let ref_upper = String::from_str(&env, "REF_12345");

    let result_lower = generate_tx_id(&env, &source, &ref_lower).unwrap();
    let result_upper = generate_tx_id(&env, &source, &ref_upper).unwrap();

    // Should produce different tx_ids (case-sensitive)
    assert_ne!(result_lower, result_upper);
}

#[test]
fn test_generate_tx_id_trimming() {
    let env = Env::default();
    // Note: Symbols cannot contain spaces, so we test reference trimming only
    let source = Symbol::new(&env, "paystack");
    let reference = String::from_str(&env, "  ref_12345  ");

    let reference_clean = String::from_str(&env, "ref_12345");

    let result_trimmed = generate_tx_id(&env, &source, &reference).unwrap();
    let result_clean = generate_tx_id(&env, &source, &reference_clean).unwrap();

    // Should produce the same tx_id after trimming
    assert_eq!(result_trimmed, result_clean);
}

#[test]
fn test_generate_tx_id_deterministic() {
    let env = Env::default();
    let source = Symbol::new(&env, "paystack");
    let reference = String::from_str(&env, "ref_12345");

    let result1 = generate_tx_id(&env, &source, &reference).unwrap();
    let result2 = generate_tx_id(&env, &source, &reference).unwrap();

    // Should produce the same tx_id for the same inputs
    assert_eq!(result1, result2);
}

#[test]
fn test_generate_tx_id_different_sources_different_hashes() {
    let env = Env::default();
    let reference = String::from_str(&env, "ref_12345");

    let source1 = Symbol::new(&env, "paystack");
    let source2 = Symbol::new(&env, "flutterwave");

    let result1 = generate_tx_id(&env, &source1, &reference).unwrap();
    let result2 = generate_tx_id(&env, &source2, &reference).unwrap();

    // Different sources should produce different tx_ids
    assert_ne!(result1, result2);
}

#[test]
fn test_generate_tx_id_different_references_different_hashes() {
    let env = Env::default();
    let source = Symbol::new(&env, "paystack");

    let ref1 = String::from_str(&env, "ref_12345");
    let ref2 = String::from_str(&env, "ref_67890");

    let result1 = generate_tx_id(&env, &source, &ref1).unwrap();
    let result2 = generate_tx_id(&env, &source, &ref2).unwrap();

    // Different references should produce different tx_ids
    assert_ne!(result1, result2);
}

// Tests for init function

#[test]
fn test_init_success() {
    let env = Env::default();
    let contract_id = env.register(TransactionReceiptContract, ());
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);

    // Initialize the contract
    client.try_init(&admin, &operator).unwrap();

    // Verify admin is stored by checking storage directly
    let stored_admin: Address = env.as_contract(&contract_id, || {
        env.storage().instance().get(&StorageKey::Admin).unwrap()
    });
    assert_eq!(stored_admin, admin);

    // Verify operator is stored
    let stored_operator: Address = env.as_contract(&contract_id, || {
        env.storage().instance().get(&StorageKey::Operator).unwrap()
    });
    assert_eq!(stored_operator, operator);

    // Verify paused state is false
    let paused: bool = env.as_contract(&contract_id, || {
        env.storage().instance().get(&StorageKey::Paused).unwrap()
    });
    assert_eq!(paused, false);

    // Verify contract version is set
    let version: u32 = env.as_contract(&contract_id, || {
        env.storage()
            .instance()
            .get(&StorageKey::ContractVersion)
            .unwrap()
    });
    assert_eq!(version, 1u32);
}

#[test]
fn test_init_already_initialized() {
    let env = Env::default();
    let contract_id = env.register(TransactionReceiptContract, ());
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);

    // Initialize the contract first time
    client.try_init(&admin, &operator).unwrap();

    // Try to initialize again
    let admin2 = Address::generate(&env);
    let operator2 = Address::generate(&env);
    let result2 = client.try_init(&admin2, &operator2);

    // Should fail with AlreadyInitialized error
    assert!(result2.is_err());
    assert_eq!(
        result2.unwrap_err().unwrap(),
        ContractError::AlreadyInitialized
    );

    // Verify original admin and operator are still stored
    let stored_admin: Address = env.as_contract(&contract_id, || {
        env.storage().instance().get(&StorageKey::Admin).unwrap()
    });
    assert_eq!(stored_admin, admin);

    let stored_operator: Address = env.as_contract(&contract_id, || {
        env.storage().instance().get(&StorageKey::Operator).unwrap()
    });
    assert_eq!(stored_operator, operator);
}

#[test]
fn test_init_with_same_admin_and_operator() {
    let env = Env::default();
    let contract_id = env.register(TransactionReceiptContract, ());
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let address = Address::generate(&env);

    // Initialize with same address for both admin and operator
    client.try_init(&address, &address).unwrap();

    // Verify both are stored correctly
    let stored_admin: Address = env.as_contract(&contract_id, || {
        env.storage().instance().get(&StorageKey::Admin).unwrap()
    });
    assert_eq!(stored_admin, address);

    let stored_operator: Address = env.as_contract(&contract_id, || {
        env.storage().instance().get(&StorageKey::Operator).unwrap()
    });
    assert_eq!(stored_operator, address);
}

// Tests for pause and unpause functions

#[test]
fn test_pause_success() {
    let env = Env::default();
    let contract_id = env.register(TransactionReceiptContract, ());
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);

    // Initialize the contract
    client.try_init(&admin, &operator).unwrap();

    // Mock admin authentication
    env.mock_all_auths();

    // Pause the contract
    client.try_pause(&admin).unwrap();

    // Verify paused state is true
    let paused: bool = env.as_contract(&contract_id, || {
        env.storage().instance().get(&StorageKey::Paused).unwrap()
    });
    assert_eq!(paused, true);
}

#[test]
fn test_pause_not_authorized() {
    let env = Env::default();
    let contract_id = env.register(TransactionReceiptContract, ());
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    let unauthorized = Address::generate(&env);

    // Initialize the contract
    client.try_init(&admin, &operator).unwrap();

    // Mock authentication for unauthorized address
    env.mock_all_auths();

    // Try to pause with unauthorized address
    let result = client.try_pause(&unauthorized);

    // Should fail with NotAuthorized error
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().unwrap(), ContractError::NotAuthorized);

    // Verify paused state is still false
    let paused: bool = env.as_contract(&contract_id, || {
        env.storage().instance().get(&StorageKey::Paused).unwrap()
    });
    assert_eq!(paused, false);
}

#[test]
fn test_pause_idempotent() {
    let env = Env::default();
    let contract_id = env.register(TransactionReceiptContract, ());
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);

    // Initialize the contract
    client.try_init(&admin, &operator).unwrap();

    // Mock admin authentication
    env.mock_all_auths();

    // Pause the contract first time
    client.try_pause(&admin).unwrap();

    // Verify paused state is true
    let paused: bool = env.as_contract(&contract_id, || {
        env.storage().instance().get(&StorageKey::Paused).unwrap()
    });
    assert_eq!(paused, true);

    // Pause again (should succeed without error)
    client.try_pause(&admin).unwrap();

    // Verify paused state is still true
    let paused: bool = env.as_contract(&contract_id, || {
        env.storage().instance().get(&StorageKey::Paused).unwrap()
    });
    assert_eq!(paused, true);
}

#[test]
fn test_unpause_success() {
    let env = Env::default();
    let contract_id = env.register(TransactionReceiptContract, ());
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);

    // Initialize the contract
    client.try_init(&admin, &operator).unwrap();

    // Mock admin authentication
    env.mock_all_auths();

    // Pause the contract first
    client.try_pause(&admin).unwrap();

    // Verify paused state is true
    let paused: bool = env.as_contract(&contract_id, || {
        env.storage().instance().get(&StorageKey::Paused).unwrap()
    });
    assert_eq!(paused, true);

    // Unpause the contract
    client.try_unpause(&admin).unwrap();

    // Verify paused state is false
    let paused: bool = env.as_contract(&contract_id, || {
        env.storage().instance().get(&StorageKey::Paused).unwrap()
    });
    assert_eq!(paused, false);
}

#[test]
fn test_unpause_not_authorized() {
    let env = Env::default();
    let contract_id = env.register(TransactionReceiptContract, ());
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    let unauthorized = Address::generate(&env);

    // Initialize the contract
    client.try_init(&admin, &operator).unwrap();

    // Mock authentication
    env.mock_all_auths();

    // Pause the contract first
    client.try_pause(&admin).unwrap();

    // Try to unpause with unauthorized address
    let result = client.try_unpause(&unauthorized);

    // Should fail with NotAuthorized error
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().unwrap(), ContractError::NotAuthorized);

    // Verify paused state is still true
    let paused: bool = env.as_contract(&contract_id, || {
        env.storage().instance().get(&StorageKey::Paused).unwrap()
    });
    assert_eq!(paused, true);
}

#[test]
fn test_unpause_idempotent() {
    let env = Env::default();
    let contract_id = env.register(TransactionReceiptContract, ());
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);

    // Initialize the contract
    client.try_init(&admin, &operator).unwrap();

    // Mock admin authentication
    env.mock_all_auths();

    // Contract starts unpaused, unpause should succeed
    client.try_unpause(&admin).unwrap();

    // Verify paused state is false
    let paused: bool = env.as_contract(&contract_id, || {
        env.storage().instance().get(&StorageKey::Paused).unwrap()
    });
    assert_eq!(paused, false);

    // Unpause again (should succeed without error)
    client.try_unpause(&admin).unwrap();

    // Verify paused state is still false
    let paused: bool = env.as_contract(&contract_id, || {
        env.storage().instance().get(&StorageKey::Paused).unwrap()
    });
    assert_eq!(paused, false);
}

#[test]
fn test_pause_unpause_cycle() {
    let env = Env::default();
    let contract_id = env.register(TransactionReceiptContract, ());
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);

    // Initialize the contract
    client.try_init(&admin, &operator).unwrap();

    // Mock admin authentication
    env.mock_all_auths();

    // Initial state should be unpaused
    let paused: bool = env.as_contract(&contract_id, || {
        env.storage().instance().get(&StorageKey::Paused).unwrap()
    });
    assert_eq!(paused, false);

    // Pause
    client.try_pause(&admin).unwrap();
    let paused: bool = env.as_contract(&contract_id, || {
        env.storage().instance().get(&StorageKey::Paused).unwrap()
    });
    assert_eq!(paused, true);

    // Unpause
    client.try_unpause(&admin).unwrap();
    let paused: bool = env.as_contract(&contract_id, || {
        env.storage().instance().get(&StorageKey::Paused).unwrap()
    });
    assert_eq!(paused, false);

    // Pause again
    client.try_pause(&admin).unwrap();
    let paused: bool = env.as_contract(&contract_id, || {
        env.storage().instance().get(&StorageKey::Paused).unwrap()
    });
    assert_eq!(paused, true);
}

// Golden test vectors - shared with backend tests
#[test]
fn test_golden_vectors() {
    let env = Env::default();

    #[derive(serde::Deserialize)]
    struct VectorInput {
        source: StdString,
        #[serde(rename = "ref")]
        reference: StdString,
    }

    #[derive(serde::Deserialize)]
    struct GoldenVector {
        input: VectorInput,
        expected_canonical: Option<StdString>,
        expected_sha256: Option<StdString>,
        expected_error: Option<StdString>,
    }

    #[derive(serde::Deserialize)]
    struct GoldenVectorsFile {
        golden_test_vectors: std::vec::Vec<GoldenVector>,
    }

    fn bytesn32_to_hex(bytes: [u8; 32]) -> StdString {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let mut out = [0u8; 64];
        for (i, b) in bytes.iter().enumerate() {
            out[i * 2] = HEX[(b >> 4) as usize];
            out[i * 2 + 1] = HEX[(b & 0x0f) as usize];
        }
        StdString::from_utf8(out.to_vec()).expect("valid utf8")
    }

    let raw = include_str!("../../../test-vectors.json");
    let parsed: GoldenVectorsFile = serde_json::from_str(raw).expect("valid test-vectors.json");

    for (i, v) in parsed.golden_test_vectors.iter().enumerate() {
        let source = Symbol::new(&env, &v.input.source);
        let reference = String::from_str(&env, &v.input.reference);
        let result = generate_tx_id(&env, &source, &reference);

        if let Some(expected_error) = &v.expected_error {
            assert!(result.is_err(), "vector {} should fail", i);
            assert!(
                expected_error.contains("Ref cannot be empty")
                    || expected_error.contains("pipe")
                    || expected_error.contains("256")
                    || expected_error.contains("Source"),
                "vector {} expected_error should be a stable validation message",
                i
            );
        } else {
            let tx_id = result.expect("vector should succeed");
            let got_hex = bytesn32_to_hex(tx_id.to_array());
            let expected = v
                .expected_sha256
                .as_ref()
                .expect("expected_sha256 required for success vectors");
            assert_eq!(got_hex, *expected, "vector {} hash mismatch", i);
        }
    }
}

#[test]
fn test_allowed_tx_types_constant() {
    // Verify ALLOWED_TX_TYPES contains expected values
    assert_eq!(ALLOWED_TX_TYPES.len(), 7);
    assert!(ALLOWED_TX_TYPES.contains(&"TENANT_REPAYMENT"));
    assert!(ALLOWED_TX_TYPES.contains(&"LANDLORD_PAYOUT"));
    assert!(ALLOWED_TX_TYPES.contains(&"WHISTLEBLOWER_REWARD"));
    assert!(ALLOWED_TX_TYPES.contains(&"STAKE"));
    assert!(ALLOWED_TX_TYPES.contains(&"UNSTAKE"));
    assert!(ALLOWED_TX_TYPES.contains(&"STAKE_REWARD_CLAIM"));
    assert!(ALLOWED_TX_TYPES.contains(&"CONVERSION"));
}

#[test]
fn test_validate_tx_type_valid_types() {
    let env = Env::default();

    // Test all valid transaction types
    let valid_types = [
        "TENANT_REPAYMENT",
        "LANDLORD_PAYOUT",
        "WHISTLEBLOWER_REWARD",
        "STAKE",
        "UNSTAKE",
        "STAKE_REWARD_CLAIM",
    ];

    for tx_type_str in valid_types.iter() {
        let tx_type = Symbol::new(&env, tx_type_str);
        let result = validate_tx_type(&tx_type);
        assert!(
            result.is_ok(),
            "Transaction type '{}' should be valid",
            tx_type_str
        );
    }
}

#[test]
fn test_validate_tx_type_invalid_types() {
    let env = Env::default();

    // Test invalid transaction types
    let invalid_types = [
        "rent_payment",
        "deposit",
        "refund",
        "UNKNOWN_TYPE",
        "invalid",
        "",
        "TENANTREPAYMENT",  // Missing underscore
        "tenant_repayment", // lowercase
        "Stake",            // mixed case
    ];

    for tx_type_str in invalid_types.iter() {
        let tx_type = Symbol::new(&env, tx_type_str);
        let result = validate_tx_type(&tx_type);
        assert!(
            result.is_err(),
            "Transaction type '{}' should be invalid",
            tx_type_str
        );
        assert_eq!(result.unwrap_err(), ContractError::InvalidTxType);
    }
}

#[test]
fn test_conversion_receipt_with_metadata() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, TransactionReceiptContract);
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    let from_user = Address::generate(&env);
    let to_user = Address::generate(&env);
    let token = Address::generate(&env);

    client.init(&admin, &operator);

    let input = ReceiptInput {
        external_ref_source: Symbol::new(&env, "onramp"),
        external_ref: String::from_str(&env, "conv_12345"),
        tx_type: Symbol::new(&env, "CONVERSION"),
        amount_usdc: 1_000_000,
        token: token.clone(),
        deal_id: String::from_str(&env, "deal_001"),
        listing_id: None,
        from: Some(from_user.clone()),
        to: Some(to_user.clone()),
        amount_ngn: Some(1_500_000_000),
        fx_rate_ngn_per_usdc: Some(1_500),
        fx_provider: Some(String::from_str(&env, "provider_x")),
        metadata_hash: None,
    };

    let tx_id = client.record_receipt(&operator, &input);
    let receipt = client.get_receipt(&tx_id).unwrap();

    assert_eq!(receipt.tx_type, Symbol::new(&env, "CONVERSION"));
    assert_eq!(receipt.amount_usdc, 1_000_000);
    assert_eq!(receipt.amount_ngn, Some(1_500_000_000));
    assert_eq!(receipt.fx_rate_ngn_per_usdc, Some(1_500));
    assert_eq!(
        receipt.fx_provider,
        Some(String::from_str(&env, "provider_x"))
    );
}

#[test]
fn test_list_receipts_by_user() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, TransactionReceiptContract);
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    let token = Address::generate(&env);

    client.init(&admin, &operator);

    // Record 3 receipts with user_a as sender
    for i in 1..=3 {
        let input = ReceiptInput {
            external_ref_source: Symbol::new(&env, "stellar"),
            external_ref: String::from_str(&env, &alloc::format!("ref_a_{}", i)),
            tx_type: Symbol::new(&env, "CONVERSION"),
            amount_usdc: 100_000 * i as i128,
            token: token.clone(),
            deal_id: String::from_str(&env, "deal_001"),
            listing_id: None,
            from: Some(user_a.clone()),
            to: Some(user_b.clone()),
            amount_ngn: None,
            fx_rate_ngn_per_usdc: None,
            fx_provider: None,
            metadata_hash: None,
        };
        client.record_receipt(&operator, &input);
    }

    // Query receipts for user_a
    let receipts_a = client.list_receipts_by_user(&user_a, &10, &None);
    assert_eq!(receipts_a.len(), 3);

    // Query receipts for user_b (also appears in all 3 as recipient)
    let receipts_b = client.list_receipts_by_user(&user_b, &10, &None);
    assert_eq!(receipts_b.len(), 3);

    // Test pagination
    let page_1 = client.list_receipts_by_user(&user_a, &2, &None);
    assert_eq!(page_1.len(), 2);

    let page_2 = client.list_receipts_by_user(&user_a, &2, &Some(2));
    assert_eq!(page_2.len(), 1);
}

#[test]
fn test_conversion_idempotency() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, TransactionReceiptContract);
    let client = TransactionReceiptContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    let token = Address::generate(&env);

    client.init(&admin, &operator);

    let input = ReceiptInput {
        external_ref_source: Symbol::new(&env, "onramp"),
        external_ref: String::from_str(&env, "conv_duplicate_test"),
        tx_type: Symbol::new(&env, "CONVERSION"),
        amount_usdc: 500_000,
        token: token.clone(),
        deal_id: String::from_str(&env, "deal_002"),
        listing_id: None,
        from: None,
        to: None,
        amount_ngn: Some(750_000_000),
        fx_rate_ngn_per_usdc: Some(1_500),
        fx_provider: Some(String::from_str(&env, "provider_y")),
        metadata_hash: None,
    };

    let tx_id_1 = client.record_receipt(&operator, &input);

    // Attempt duplicate with same external ref
    let result = client.try_record_receipt(&operator, &input);
    assert_eq!(result, Err(Ok(ContractError::DuplicateTransaction)));

    // Verify only one receipt exists
    let receipt = client.get_receipt(&tx_id_1).unwrap();
    assert_eq!(receipt.amount_usdc, 500_000);
}
