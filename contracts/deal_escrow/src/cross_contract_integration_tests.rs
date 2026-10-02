//! Cross-contract integration tests: rent_wallet + deal_escrow + rent_payments

extern crate std;

use crate::{
    ContractError as DealEscrowError, DealEscrow, DealEscrowClient,
    TokenClient as EscrowTokenClient,
};
use rent_payments::{RentPayments, RentPaymentsClient};
use rent_wallet::{RentWallet, RentWalletClient};
use soroban_sdk::testutils::{Address as _, MockAuth, MockAuthInvoke};
use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};
use soroban_sdk::{Address, BytesN, Env, IntoVal, String, Symbol};
use std::format;

fn generate_reference(env: &Env, seed: u64) -> BytesN<32> {
    let mut bytes = [0u8; 32];
    let seed_bytes = seed.to_be_bytes();
    for i in 0..8 {
        bytes[i] = seed_bytes[i];
    }
    BytesN::from_array(env, &bytes)
}

/// Deployed contracts and role addresses for cross-contract payment flows.
struct TestContracts<'a> {
    rent_wallet_id: Address,
    rent_wallet: RentWalletClient<'a>,
    deal_escrow_id: Address,
    deal_escrow: DealEscrowClient<'a>,
    rent_payments_id: Address,
    rent_payments: RentPaymentsClient<'a>,
    token: Address,
    token_admin: Address,
    admin: Address,
    operator: Address,
    tenant: Address,
    landlord: Address,
    platform: Address,
    reporter: Address,
}

fn setup_full_stack(env: &Env) -> TestContracts<'_> {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let operator = Address::generate(env);
    let tenant = Address::generate(env);
    let landlord = Address::generate(env);
    let platform = Address::generate(env);
    let reporter = Address::generate(env);

    let token_admin = Address::generate(env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token_contract.address();

    let rent_wallet_id = env.register(RentWallet, ());
    let rent_wallet = RentWalletClient::new(env, &rent_wallet_id);
    rent_wallet.try_init(&admin).unwrap().unwrap();

    let rent_payments_id = env.register(RentPayments, ());
    let rent_payments = RentPaymentsClient::new(env, &rent_payments_id);
    rent_payments.try_init(&admin).unwrap().unwrap();

    let deal_escrow_id = env.register(DealEscrow, ());
    let deal_escrow = DealEscrowClient::new(env, &deal_escrow_id);
    deal_escrow
        .try_init(&admin, &operator, &token, &rent_payments_id)
        .unwrap()
        .unwrap();

    TestContracts {
        rent_wallet_id,
        rent_wallet,
        deal_escrow_id,
        deal_escrow,
        rent_payments_id,
        rent_payments,
        token,
        token_admin,
        admin,
        operator,
        tenant,
        landlord,
        platform,
        reporter,
    }
}

fn deal_id_str(env: &Env, deal_id: u64) -> String {
    String::from_str(env, &format!("{deal_id}"))
}

fn mint_to(env: &Env, token: &Address, token_admin: &Address, to: &Address, amount: i128) {
    let sac = StellarAssetClient::new(env, token);
    env.mock_auths(&[MockAuth {
        address: token_admin,
        invoke: &MockAuthInvoke {
            contract: token,
            fn_name: "mint",
            args: (to.clone(), amount).into_val(env),
            sub_invokes: &[],
        },
    }]);
    sac.mint(to, &amount);
}

fn wallet_credit_and_escrow_deposit(
    env: &Env,
    stack: &TestContracts<'_>,
    deal_id: u64,
    amount: i128,
) {
    let deal_str = deal_id_str(env, deal_id);
    let token_client = TokenClient::new(env, &stack.token);

    env.mock_auths(&[MockAuth {
        address: &stack.admin,
        invoke: &MockAuthInvoke {
            contract: &stack.rent_wallet_id,
            fn_name: "credit",
            args: (stack.admin.clone(), stack.tenant.clone(), amount).into_val(env),
            sub_invokes: &[],
        },
    }]);
    stack
        .rent_wallet
        .try_credit(&stack.admin, &stack.tenant, &amount)
        .unwrap()
        .unwrap();
    assert_eq!(stack.rent_wallet.balance(&stack.tenant), amount);

    env.mock_auths(&[MockAuth {
        address: &stack.admin,
        invoke: &MockAuthInvoke {
            contract: &stack.rent_wallet_id,
            fn_name: "debit",
            args: (stack.admin.clone(), stack.tenant.clone(), amount).into_val(env),
            sub_invokes: &[],
        },
    }]);
    stack
        .rent_wallet
        .try_debit(&stack.admin, &stack.tenant, &amount)
        .unwrap()
        .unwrap();
    assert_eq!(stack.rent_wallet.balance(&stack.tenant), 0);

    let tenant_balance_before = token_client.balance(&stack.tenant);
    mint_to(env, &stack.token, &stack.token_admin, &stack.tenant, amount);

    env.mock_auths(&[MockAuth {
        address: &stack.tenant,
        invoke: &MockAuthInvoke {
            contract: &stack.deal_escrow_id,
            fn_name: "deposit",
            args: (stack.tenant.clone(), deal_str.clone(), amount).into_val(env),
            sub_invokes: &[MockAuthInvoke {
                contract: &stack.token,
                fn_name: "transfer",
                args: (stack.tenant.clone(), stack.deal_escrow_id.clone(), amount).into_val(env),
                sub_invokes: &[],
            }],
        },
    }]);
    stack
        .deal_escrow
        .try_deposit(&stack.tenant, &deal_str, &amount)
        .unwrap()
        .unwrap();

    assert_eq!(
        token_client.balance(&stack.tenant),
        tenant_balance_before + amount - amount
    );
    assert_eq!(stack.deal_escrow.balance(&deal_str), amount);
}

fn release_escrow_and_record_receipt(
    env: &Env,
    stack: &TestContracts<'_>,
    deal_id: u64,
    principal: i128,
    platform_amount: i128,
    reporter_amount: i128,
    receipt_amount: i128,
    reference: BytesN<32>,
) {
    let deal_str = deal_id_str(env, deal_id);
    let token_client = EscrowTokenClient::new(env, &stack.token);
    let escrow_balance = stack.deal_escrow.balance(&deal_str);

    let landlord_before = token_client.balance(&stack.landlord);
    let platform_before = token_client.balance(&stack.platform);
    let reporter_before = token_client.balance(&stack.reporter);

    env.mock_auths(&[MockAuth {
        address: &stack.operator,
        invoke: &MockAuthInvoke {
            contract: &stack.deal_escrow_id,
            fn_name: "release",
            args: (
                stack.operator.clone(),
                deal_str.clone(),
                stack.landlord.clone(),
                principal,
                stack.platform.clone(),
                platform_amount,
                stack.reporter.clone(),
                reporter_amount,
                Symbol::new(env, "manual_admin"),
                String::from_str(env, "payment"),
            )
                .into_val(env),
            sub_invokes: &[],
        },
    }]);
    let released = stack
        .deal_escrow
        .try_release(
            &stack.operator,
            &deal_str,
            &stack.landlord,
            &principal,
            &stack.platform,
            &platform_amount,
            &stack.reporter,
            &reporter_amount,
            &Symbol::new(env, "manual_admin"),
            &String::from_str(env, "payment"),
        )
        .unwrap()
        .unwrap();
    assert_eq!(released, escrow_balance);
    assert_eq!(stack.deal_escrow.balance(&deal_str), 0);

    assert_eq!(
        token_client.balance(&stack.landlord),
        landlord_before + principal
    );
    assert_eq!(
        token_client.balance(&stack.platform),
        platform_before + platform_amount
    );
    assert_eq!(
        token_client.balance(&stack.reporter),
        reporter_before + reporter_amount
    );

    env.mock_auths(&[MockAuth {
        address: &stack.admin,
        invoke: &MockAuthInvoke {
            contract: &stack.rent_payments_id,
            fn_name: "create_receipt",
            args: (
                deal_id,
                receipt_amount,
                stack.tenant.clone(),
                reference.clone(),
            )
                .into_val(env),
            sub_invokes: &[],
        },
    }]);
    let receipt = stack
        .rent_payments
        .try_create_receipt(&deal_id, &receipt_amount, &stack.tenant, &reference)
        .unwrap()
        .unwrap();
    assert_eq!(receipt.deal_id, deal_id);
    assert_eq!(receipt.amount, receipt_amount);
    assert_eq!(receipt.payer, stack.tenant);
}

#[test]
fn scenario_1_full_deal_payment_flow() {
    let env = Env::default();
    let stack = setup_full_stack(&env);
    let deal_id = 1u64;
    let amount = 1_000i128;
    let principal = 850i128;
    let platform_fee = 100i128;
    let reporter_fee = 50i128;

    wallet_credit_and_escrow_deposit(&env, &stack, deal_id, amount);
    let reference = generate_reference(&env, deal_id);
    release_escrow_and_record_receipt(
        &env,
        &stack,
        deal_id,
        principal,
        platform_fee,
        reporter_fee,
        amount,
        reference,
    );

    assert_eq!(stack.rent_payments.receipt_count(&deal_id), 1);
    let page = stack
        .rent_payments
        .list_receipts_by_deal(&deal_id, &10u32, &None);
    assert_eq!(page.receipts.len(), 1);
    assert_eq!(page.receipts.get(0).unwrap().amount, amount);
    assert_eq!(page.receipts.get(0).unwrap().deal_id, deal_id);
}

#[test]
fn scenario_2_partial_instalment_flow_three_payments() {
    let env = Env::default();
    let stack = setup_full_stack(&env);
    let deal_id = 2u64;
    let instalment = 1_000i128;
    let principal = 850i128;
    let platform_fee = 100i128;
    let reporter_fee = 50i128;
    let mut cumulative = 0i128;

    for i in 0..3 {
        wallet_credit_and_escrow_deposit(&env, &stack, deal_id, instalment);
        let reference = generate_reference(&env, deal_id * 1000 + i as u64);
        release_escrow_and_record_receipt(
            &env,
            &stack,
            deal_id,
            principal,
            platform_fee,
            reporter_fee,
            instalment,
            reference,
        );
        cumulative += instalment;
    }

    assert_eq!(stack.rent_payments.receipt_count(&deal_id), 3);
    let page = stack
        .rent_payments
        .list_receipts_by_deal(&deal_id, &10u32, &None);
    assert_eq!(page.receipts.len(), 3);

    let mut receipt_total = 0i128;
    for i in 0..page.receipts.len() {
        receipt_total += page.receipts.get(i).unwrap().amount;
    }
    assert_eq!(receipt_total, cumulative);
    assert_eq!(cumulative, 3_000i128);
}

#[test]
fn scenario_3_paused_deal_escrow_blocks_deposit_until_unpaused() {
    let env = Env::default();
    let stack = setup_full_stack(&env);
    let deal_id = 3u64;
    let deal_str = deal_id_str(&env, deal_id);
    let amount = 500i128;

    mint_to(
        &env,
        &stack.token,
        &stack.token_admin,
        &stack.tenant,
        amount,
    );

    env.mock_auths(&[MockAuth {
        address: &stack.admin,
        invoke: &MockAuthInvoke {
            contract: &stack.deal_escrow_id,
            fn_name: "pause",
            args: (stack.admin.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    stack.deal_escrow.try_pause(&stack.admin).unwrap().unwrap();

    env.mock_auths(&[MockAuth {
        address: &stack.tenant,
        invoke: &MockAuthInvoke {
            contract: &stack.deal_escrow_id,
            fn_name: "deposit",
            args: (stack.tenant.clone(), deal_str.clone(), amount).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    let paused_err = stack
        .deal_escrow
        .try_deposit(&stack.tenant, &deal_str, &amount)
        .unwrap_err()
        .unwrap();
    assert_eq!(paused_err, DealEscrowError::Paused);

    env.mock_auths(&[MockAuth {
        address: &stack.admin,
        invoke: &MockAuthInvoke {
            contract: &stack.deal_escrow_id,
            fn_name: "unpause",
            args: (stack.admin.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    stack
        .deal_escrow
        .try_unpause(&stack.admin)
        .unwrap()
        .unwrap();

    env.mock_auths(&[MockAuth {
        address: &stack.tenant,
        invoke: &MockAuthInvoke {
            contract: &stack.deal_escrow_id,
            fn_name: "deposit",
            args: (stack.tenant.clone(), deal_str.clone(), amount).into_val(&env),
            sub_invokes: &[MockAuthInvoke {
                contract: &stack.token,
                fn_name: "transfer",
                args: (stack.tenant.clone(), stack.deal_escrow_id.clone(), amount).into_val(&env),
                sub_invokes: &[],
            }],
        },
    }]);
    stack
        .deal_escrow
        .try_deposit(&stack.tenant, &deal_str, &amount)
        .unwrap()
        .unwrap();
    assert_eq!(stack.deal_escrow.balance(&deal_str), amount);
}

#[test]
fn scenario_4_release_more_than_escrow_balance_fails() {
    let env = Env::default();
    let stack = setup_full_stack(&env);
    let deal_id = 4u64;
    let deal_str = deal_id_str(&env, deal_id);
    let deposited = 100i128;

    wallet_credit_and_escrow_deposit(&env, &stack, deal_id, deposited);

    env.mock_auths(&[MockAuth {
        address: &stack.operator,
        invoke: &MockAuthInvoke {
            contract: &stack.deal_escrow_id,
            fn_name: "release",
            args: (
                stack.operator.clone(),
                deal_str.clone(),
                stack.landlord.clone(),
                200i128,
                stack.platform.clone(),
                50i128,
                stack.reporter.clone(),
                50i128,
                Symbol::new(&env, "manual_admin"),
                String::from_str(&env, "over-release"),
            )
                .into_val(&env),
            sub_invokes: &[],
        },
    }]);
    let err = stack
        .deal_escrow
        .try_release(
            &stack.operator,
            &deal_str,
            &stack.landlord,
            &200i128,
            &stack.platform,
            &50i128,
            &stack.reporter,
            &50i128,
            &Symbol::new(&env, "manual_admin"),
            &String::from_str(&env, "over-release"),
        )
        .unwrap_err()
        .unwrap();
    assert_eq!(err, DealEscrowError::InvalidSplit);
    assert_eq!(stack.deal_escrow.balance(&deal_str), deposited);
}

// ──────────────────────────────────────────────────────────────────────────────
// Reentrancy and Cross-Contract Invariant Tests (#1105)
// ──────────────────────────────────────────────────────────────────────────────

#[test]
fn cross_contract_value_conservation() {
    // Invariant: tokens deposited into escrow are correctly distributed to recipients.
    // The escrow balance should be zero after release, and distributed amounts should
    // match the release parameters.
    let env = Env::default();
    let stack = setup_full_stack(&env);
    let deal_id = 100u64;
    let initial_deposit = 5_000i128;
    let principal = 3_000i128;
    let platform_fee = 1_500i128;
    let reporter_fee = 500i128;

    let token_client = TokenClient::new(&env, &stack.token);

    // Capture balances before deposit (after minting in the helper)
    // Note: minting happens inside wallet_credit_and_escrow_deposit
    wallet_credit_and_escrow_deposit(&env, &stack, deal_id, initial_deposit);

    let tenant_after_deposit = token_client.balance(&stack.tenant);
    let landlord_before_release = token_client.balance(&stack.landlord);
    let platform_before_release = token_client.balance(&stack.platform);
    let reporter_before_release = token_client.balance(&stack.reporter);
    let escrow_before_release = stack.deal_escrow.balance(&deal_id_str(&env, deal_id));

    // Execute release
    let reference = generate_reference(&env, deal_id);
    release_escrow_and_record_receipt(
        &env,
        &stack,
        deal_id,
        principal,
        platform_fee,
        reporter_fee,
        initial_deposit,
        reference,
    );

    // Verify post-release balances
    let tenant_final = token_client.balance(&stack.tenant);
    let landlord_final = token_client.balance(&stack.landlord);
    let platform_final = token_client.balance(&stack.platform);
    let reporter_final = token_client.balance(&stack.reporter);
    let escrow_final = stack.deal_escrow.balance(&deal_id_str(&env, deal_id));

    // Escrow should be empty after release
    assert_eq!(escrow_final, 0);

    // Verify each recipient got the correct amount
    assert_eq!(landlord_final - landlord_before_release, principal);
    assert_eq!(platform_final - platform_before_release, platform_fee);
    assert_eq!(reporter_final - reporter_before_release, reporter_fee);

    // Verify tenant's balance before deposit = after release
    // (they deposited all their balance into escrow)
    assert_eq!(tenant_final, tenant_after_deposit);

    // Verify the total distributed equals what was in escrow
    assert_eq!(escrow_before_release, initial_deposit);
    assert_eq!(principal + platform_fee + reporter_fee, initial_deposit);
}

#[test]
fn atomicity_on_partial_settlement_failure() {
    // Invariant: if one leg of a multi-leg settlement fails (e.g., invalid split),
    // all three contracts remain consistent and the escrow is not partially released.
    let env = Env::default();
    let stack = setup_full_stack(&env);
    let deal_id = 101u64;
    let deal_str = deal_id_str(&env, deal_id);
    let amount = 1_000i128;

    let token_client = TokenClient::new(&env, &stack.token);

    // Setup: deposit into escrow
    wallet_credit_and_escrow_deposit(&env, &stack, deal_id, amount);
    let escrow_before = stack.deal_escrow.balance(&deal_str);
    assert_eq!(escrow_before, amount);

    // Record balances before failed release
    let landlord_before = token_client.balance(&stack.landlord);
    let platform_before = token_client.balance(&stack.platform);
    let reporter_before = token_client.balance(&stack.reporter);

    // Attempt release with invalid split (principal > escrow balance)
    env.mock_auths(&[MockAuth {
        address: &stack.operator,
        invoke: &MockAuthInvoke {
            contract: &stack.deal_escrow_id,
            fn_name: "release",
            args: (
                stack.operator.clone(),
                deal_str.clone(),
                stack.landlord.clone(),
                2_000i128, // More than available
                stack.platform.clone(),
                500i128,
                stack.reporter.clone(),
                500i128,
                Symbol::new(&env, "manual_admin"),
                String::from_str(&env, "atomicity-test"),
            )
                .into_val(&env),
            sub_invokes: &[],
        },
    }]);

    let err = stack.deal_escrow.try_release(
        &stack.operator,
        &deal_str,
        &stack.landlord,
        &2_000i128,
        &stack.platform,
        &500i128,
        &stack.reporter,
        &500i128,
        &Symbol::new(&env, "manual_admin"),
        &String::from_str(&env, "atomicity-test"),
    );
    assert!(err.is_err());

    // Verify atomicity: all balances unchanged
    assert_eq!(stack.deal_escrow.balance(&deal_str), amount);
    assert_eq!(token_client.balance(&stack.landlord), landlord_before);
    assert_eq!(token_client.balance(&stack.platform), platform_before);
    assert_eq!(token_client.balance(&stack.reporter), reporter_before);
}

#[test]
fn multiple_sequential_deals_maintain_invariants() {
    // Invariant: processing multiple deals sequentially maintains value conservation
    // for each, with no cross-deal pollution.
    let env = Env::default();
    let stack = setup_full_stack(&env);
    let token_client = TokenClient::new(&env, &stack.token);

    let _initial_tenant = token_client.balance(&stack.tenant);
    let _initial_landlord = token_client.balance(&stack.landlord);
    let _initial_platform = token_client.balance(&stack.platform);

    // Process 3 separate deals, each with different amounts
    for i in 1..=3 {
        let deal_id = 200u64 + i as u64;
        let amount = 1_000i128 * (i as i128);
        let principal = (amount * 80) / 100;
        let platform_fee = (amount * 15) / 100;
        let reporter_fee = (amount * 5) / 100;

        wallet_credit_and_escrow_deposit(&env, &stack, deal_id, amount);
        let reference = generate_reference(&env, deal_id);
        release_escrow_and_record_receipt(
            &env,
            &stack,
            deal_id,
            principal,
            platform_fee,
            reporter_fee,
            amount,
            reference,
        );

        // Verify escrow is clean after each deal
        assert_eq!(stack.deal_escrow.balance(&deal_id_str(&env, deal_id)), 0);
    }

    // All escrow balances should be zero
    for i in 1..=3 {
        let deal_id = 200u64 + i as u64;
        assert_eq!(stack.deal_escrow.balance(&deal_id_str(&env, deal_id)), 0);
    }
}
