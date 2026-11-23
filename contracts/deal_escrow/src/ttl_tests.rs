//! Storage TTL tests. Deal state has to stay readable after the ledger sequence moves
//! past the default persistent TTL, which is when entries that were never extended are
//! archived.

extern crate std;

use crate::{DealEscrow, DealEscrowClient, DealLifecycleStatus, TokenClient};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::{Address, Env, String, Symbol};

/// The testutils default minimum persistent TTL. An entry written without an extension is
/// archived once the ledger sequence has moved this far past the write.
const DEFAULT_PERSISTENT_TTL_LEDGERS: u32 = 4_096;

/// A gap that is longer than the default TTL, so only entries that were extended survive it.
const LEDGER_GAP: u32 = DEFAULT_PERSISTENT_TTL_LEDGERS + 6_000;

fn advance_ledgers(env: &Env, ledgers: u32) {
    let next = env.ledger().sequence() + ledgers;
    env.ledger().set_sequence_number(next);
}

/// Registers and initialises the escrow with a fresh stellar asset token.
fn setup(env: &Env) -> (DealEscrowClient<'_>, Address, Address, Address) {
    env.mock_all_auths();
    let contract_id = env.register(DealEscrow, ());
    let client = DealEscrowClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let operator = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin).address();
    let receipt_contract = Address::generate(env);
    client.init(&admin, &operator, &token_id, &receipt_contract);
    (client, admin, operator, token_id)
}

#[test]
fn deal_balance_and_release_survive_a_gap_past_the_default_ttl() {
    let env = Env::default();
    let (client, admin, _operator, token_id) = setup(&env);
    let depositor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let platform = Address::generate(&env);
    let reporter = Address::generate(&env);
    let deal_id = String::from_str(&env, "ttl-release");
    StellarAssetClient::new(&env, &token_id).mint(&depositor, &1_000i128);
    client.deposit(&depositor, &deal_id, &1_000i128);

    advance_ledgers(&env, LEDGER_GAP);

    assert_eq!(client.contract_version(), 1u32);
    assert_eq!(client.balance(&deal_id), 1_000i128);
    let released = client.release(
        &admin,
        &deal_id,
        &recipient,
        &1_000i128,
        &platform,
        &0i128,
        &reporter,
        &0i128,
        &Symbol::new(&env, "ttl_test"),
        &String::from_str(&env, "ext-release"),
    );
    assert_eq!(released, 1_000i128);
    assert_eq!(client.balance(&deal_id), 0i128);
    assert_eq!(TokenClient::new(&env, &token_id).balance(&recipient), 1_000i128);
}

#[test]
fn disputed_deal_refunds_depositor_after_gaps_past_the_default_ttl() {
    let env = Env::default();
    let (client, admin, _operator, token_id) = setup(&env);
    let token = TokenClient::new(&env, &token_id);
    let depositor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let deal_id = String::from_str(&env, "ttl-refund");
    StellarAssetClient::new(&env, &token_id).mint(&depositor, &500i128);
    client.deposit(&depositor, &deal_id, &500i128);

    // Ledger timestamps start at 0 in tests. The challenge window is 24 hours by default.
    client.request_rent_release(
        &admin,
        &deal_id,
        &recipient,
        &500i128,
        &Symbol::new(&env, "ttl_test"),
        &String::from_str(&env, "lease-ttl"),
    );

    advance_ledgers(&env, LEDGER_GAP);
    env.ledger().set_timestamp(3_600);
    let evidence = String::from_str(&env, "evidence-ttl");
    client.challenge_rent_release(&depositor, &deal_id, &evidence);

    advance_ledgers(&env, LEDGER_GAP);
    // The dispute opened at t = 3,600 and times out 48 hours later.
    env.ledger().set_timestamp(3_600 + 48 * 3_600);
    client.settle_dispute_timeout(&deal_id);

    assert_eq!(token.balance(&depositor), 500i128);
    assert_eq!(client.balance(&deal_id), 0i128);
}

#[test]
fn lifecycle_transitions_survive_a_gap_past_the_default_ttl() {
    let env = Env::default();
    let (client, admin, _operator, _token_id) = setup(&env);
    let deal_id = String::from_str(&env, "ttl-lifecycle");

    client.activate_deal(&admin, &deal_id);
    advance_ledgers(&env, LEDGER_GAP);
    client.complete_deal(&admin, &deal_id);

    assert!(client.deal_lifecycle_status(&deal_id) == DealLifecycleStatus::Completed);
}

#[test]
fn reads_of_unknown_deals_after_a_gap_return_defaults() {
    let env = Env::default();
    let (client, _admin, _operator, _token_id) = setup(&env);
    let deal_id = String::from_str(&env, "ttl-unused");

    advance_ledgers(&env, LEDGER_GAP);

    assert_eq!(client.balance(&deal_id), 0i128);
    assert!(client.deal_lifecycle_status(&deal_id) == DealLifecycleStatus::Draft);
}
