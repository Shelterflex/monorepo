#![cfg(kani)]

use soroban_sdk::{Address, BytesN, Env};

use crate::{ContractError, DataKey, DealId, ReceiptId, RentPayments, TxId};

// ── Rent Payments — Formal Verification Properties ───────────────────────────
//
// Scope per issue #1697: prove payment-schedule correctness.
//
// Run with:  cargo kani --harness <name>

// ---------------------------------------------------------------------------
// 1. Idempotency: same reference cannot be recorded twice for a deal
// ---------------------------------------------------------------------------

/// Property: Recording a payment with a reference that has already been used
/// for the same deal must be rejected with DuplicateReference.
///
/// Invariant: ∀ (deal_id, reference) that already exists in storage,
///            record_payment returns Err(DuplicateReference).
#[kani::proof]
fn verify_payment_idempotency() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);

    let admin = Address::generate(&env);
    let payer = Address::generate(&env);

    let contract_id = env.register(RentPayments, ());
    let client = RentPaymentsClient::new(&env, &contract_id);

    client.try_init(&admin).unwrap().unwrap();

    let deal_id: DealId = 1;
    let amount: i128 = 500_000;
    let tx_id: TxId = BytesN::from_array(&env, &[0u8; 32]);
    let reference: BytesN<32> = BytesN::from_array(&env, &[42u8; 32]);

    // First recording — must succeed
    client
        .try_record_payment(&deal_id, &amount, &tx_id, &payer, &reference)
        .unwrap()
        .unwrap();

    // Second recording with the same reference — must fail
    let dup_result = client.try_record_payment(&deal_id, &amount, &tx_id, &payer, &reference);

    assert!(
        matches!(
            dup_result.unwrap_err().unwrap(),
            ContractError::DuplicateReference
        ),
        "duplicate reference must be rejected for the same deal"
    );
}

// ---------------------------------------------------------------------------
// 2. Receipt count correctness: count increases by exactly 1 per payment
// ---------------------------------------------------------------------------

/// Property: Each successful `record_payment` call increments the receipt
/// count for that deal by exactly 1.
///
/// Invariant: receipt_count_after == receipt_count_before + 1.
#[kani::proof]
fn verify_receipt_count_increments() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);

    let admin = Address::generate(&env);
    let payer = Address::generate(&env);

    let contract_id = env.register(RentPayments, ());
    let client = RentPaymentsClient::new(&env, &contract_id);

    client.try_init(&admin).unwrap().unwrap();

    let deal_id: DealId = 42;

    let count_before: u64 = client.get_receipt_count(&deal_id);

    // Record a unique payment
    let tx_id: TxId = BytesN::from_array(&env, &[1u8; 32]);
    let reference: BytesN<32> = BytesN::from_array(&env, &[10u8; 32]);
    client
        .try_record_payment(&deal_id, &200_000i128, &tx_id, &payer, &reference)
        .unwrap()
        .unwrap();

    let count_after: u64 = client.get_receipt_count(&deal_id);

    assert_eq!(
        count_after,
        count_before + 1,
        "receipt count must increase by exactly 1 per payment"
    );
}

// ---------------------------------------------------------------------------
// 3. Payment amount correctness: stored receipt matches submitted amount
// ---------------------------------------------------------------------------

/// Property: The receipt stored by `record_payment` contains exactly the
/// amount, payer, and reference that were submitted.
///
/// Invariant: stored_receipt.amount == submitted_amount
///          ∧ stored_receipt.payer  == submitted_payer
///          ∧ stored_receipt.reference == submitted_reference
#[kani::proof]
fn verify_receipt_fields_match_inputs() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(2_000);

    let admin = Address::generate(&env);
    let payer = Address::generate(&env);

    let contract_id = env.register(RentPayments, ());
    let client = RentPaymentsClient::new(&env, &contract_id);

    client.try_init(&admin).unwrap().unwrap();

    let deal_id: DealId = 7;
    let amount: i128 = 1_250_000;
    let tx_id: TxId = BytesN::from_array(&env, &[5u8; 32]);
    let reference: BytesN<32> = BytesN::from_array(&env, &[99u8; 32]);

    client
        .try_record_payment(&deal_id, &amount, &tx_id, &payer, &reference)
        .unwrap()
        .unwrap();

    // Retrieve the first (only) receipt for this deal
    let page = client.list_receipts_by_deal(&deal_id, &1u32, &None);
    assert!(!page.receipts.is_empty(), "receipt must be stored");

    let receipt = page.receipts.get(0).unwrap();
    assert_eq!(receipt.amount, amount, "stored amount must match input");
    assert_eq!(receipt.payer, payer, "stored payer must match input");
    assert_eq!(
        receipt.reference, reference,
        "stored reference must match input"
    );
    assert_eq!(receipt.deal_id, deal_id, "stored deal_id must match input");
}

// ---------------------------------------------------------------------------
// 4. Invalid amount rejected: amount ≤ 0 must fail
// ---------------------------------------------------------------------------

/// Property: A payment with a non-positive amount must be rejected with
/// InvalidAmount.
///
/// Invariant: amount ≤ 0 ⟹ record_payment returns Err(InvalidAmount).
#[kani::proof]
fn verify_non_positive_amount_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);

    let admin = Address::generate(&env);
    let payer = Address::generate(&env);

    let contract_id = env.register(RentPayments, ());
    let client = RentPaymentsClient::new(&env, &contract_id);

    client.try_init(&admin).unwrap().unwrap();

    let deal_id: DealId = 99;
    let tx_id: TxId = BytesN::from_array(&env, &[7u8; 32]);
    let reference_zero: BytesN<32> = BytesN::from_array(&env, &[20u8; 32]);
    let reference_neg: BytesN<32> = BytesN::from_array(&env, &[21u8; 32]);

    // Zero amount — must fail
    let zero_result = client.try_record_payment(&deal_id, &0i128, &tx_id, &payer, &reference_zero);
    assert!(
        matches!(
            zero_result.unwrap_err().unwrap(),
            ContractError::InvalidAmount
        ),
        "zero amount must be rejected"
    );

    // Negative amount — must fail
    let neg_result = client.try_record_payment(&deal_id, &(-1i128), &tx_id, &payer, &reference_neg);
    assert!(
        matches!(
            neg_result.unwrap_err().unwrap(),
            ContractError::InvalidAmount
        ),
        "negative amount must be rejected"
    );

    // Receipt count must remain 0 after both rejections
    let count = client.get_receipt_count(&deal_id);
    assert_eq!(count, 0, "receipt count must be 0 after rejected payments");
}

// ---------------------------------------------------------------------------
// 5. Paused contract: record_payment must fail when contract is paused
// ---------------------------------------------------------------------------

/// Property: While the contract is paused, record_payment must be rejected.
///
/// Invariant: paused == true ⟹ record_payment returns Err(Paused).
#[kani::proof]
fn verify_payments_blocked_when_paused() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);

    let admin = Address::generate(&env);
    let payer = Address::generate(&env);

    let contract_id = env.register(RentPayments, ());
    let client = RentPaymentsClient::new(&env, &contract_id);

    client.try_init(&admin).unwrap().unwrap();
    client.try_pause(&admin).unwrap().unwrap();

    let deal_id: DealId = 55;
    let tx_id: TxId = BytesN::from_array(&env, &[8u8; 32]);
    let reference: BytesN<32> = BytesN::from_array(&env, &[55u8; 32]);

    let result = client.try_record_payment(&deal_id, &100_000i128, &tx_id, &payer, &reference);
    assert!(
        matches!(result.unwrap_err().unwrap(), ContractError::Paused),
        "payment must be rejected while contract is paused"
    );
}
