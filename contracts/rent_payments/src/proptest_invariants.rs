#![cfg(test)]
//! Property-based invariant tests for rent_payments.
//!
//! ## Invariants tested
//!
//! 1. **Recorded at most once per reference**: a `(deal, reference)` pair is
//!    recorded at most once. The contract keys idempotency on the reference, not on
//!    a payment period, so this file tests the contract as it is written.
//! 2. **Ledger matches model**: after every step, `receipt_count` and the receipts
//!    returned by `list_receipts_by_deal` equal what the model accepted for each deal.
//! 3. **Totals match**: the checked sum of listed amounts equals the checked sum of
//!    accepted amounts. Amounts at `i128::MAX` are accepted and listed exactly.
//! 4. **Amount floor**: zero and negative amounts are rejected.
//! 5. **Pause gating**: while paused, no receipt is created.
//!
//! ## Running the tests
//!
//! ```bash
//! cargo test --package rent_payments proptest
//! ```

extern crate std;

use std::vec::Vec as StdVec;

use crate::{Cursor, RentPayments, RentPaymentsClient};
use proptest::prelude::*;
use proptest::test_runner::TestCaseError;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, BytesN, Env};

/// Deal ids are 1..=DEALS.
const DEALS: u64 = 3;
/// Reference seeds are 0..REFERENCES, small enough that duplicates are common.
const REFERENCES: u8 = 6;

// ── Operations ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
enum Op {
    Create {
        deal: u64,
        amount: i128,
        reference: u8,
    },
    Pause,
    Unpause,
}

fn amount_strategy() -> impl Strategy<Value = i128> {
    prop_oneof![
        6 => 1i128..=1_000_000i128,
        1 => Just(0i128),
        1 => Just(-1i128),
        1 => Just(i128::MIN),
        1 => Just(i128::MAX),
    ]
}

fn create_strategy() -> impl Strategy<Value = Op> {
    (1..=DEALS, amount_strategy(), 0..REFERENCES).prop_map(|(deal, amount, reference)| Op::Create {
        deal,
        amount,
        reference,
    })
}

fn op_strategy() -> impl Strategy<Value = Op> {
    prop_oneof![
        8 => create_strategy(),
        1 => Just(Op::Pause),
        1 => Just(Op::Unpause),
    ]
}

// ── Model and harness ────────────────────────────────────────────────────────

struct Model {
    /// Index `deal - 1`; each entry is `(reference, amount)` in insertion order.
    accepted: StdVec<StdVec<(u8, i128)>>,
    paused: bool,
}

fn checked_sum(amounts: impl Iterator<Item = i128>) -> Option<i128> {
    amounts.try_fold(0i128, |acc, a| acc.checked_add(a))
}

fn check_deal(
    client: &RentPaymentsClient<'_>,
    deal: u64,
    expected: &[(u8, i128)],
) -> Result<(), TestCaseError> {
    prop_assert_eq!(client.receipt_count(&deal), expected.len() as u64);

    let page = client.list_receipts_by_deal(&deal, &100u32, &None::<Cursor>);
    prop_assert!(!page.has_next);

    let mut listed: StdVec<(u8, i128)> = StdVec::new();
    for receipt in page.receipts.iter() {
        prop_assert_eq!(receipt.deal_id, deal);
        listed.push((receipt.reference.to_array()[0], receipt.amount));
    }

    // Compare as multisets: this catches duplicates and missing entries at once.
    let mut want = expected.to_vec();
    want.sort();
    listed.sort();
    prop_assert_eq!(&listed, &want);

    let want_total = checked_sum(expected.iter().map(|(_, a)| *a));
    let listed_total = checked_sum(listed.iter().map(|(_, a)| *a));
    prop_assert_eq!(listed_total, want_total);

    Ok(())
}

fn run_sequence(ops: &[Op], start_paused: bool) -> Result<(), TestCaseError> {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(RentPayments, ());
    let client = RentPaymentsClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.init(&admin);

    let mut model = Model {
        accepted: (0..DEALS).map(|_| StdVec::new()).collect(),
        paused: false,
    };

    if start_paused {
        client.pause(&admin);
        model.paused = true;
    }

    for op in ops {
        match op {
            Op::Pause => {
                client.pause(&admin);
                model.paused = true;
            }
            Op::Unpause => {
                client.unpause(&admin);
                model.paused = false;
            }
            Op::Create {
                deal,
                amount,
                reference,
            } => {
                let index = (*deal - 1) as usize;
                let reference_bytes = BytesN::from_array(&env, &[*reference; 32]);
                let duplicate = model.accepted[index]
                    .iter()
                    .any(|(seen, _)| seen == reference);
                let accepted = !model.paused && *amount > 0 && !duplicate;

                let payer = Address::generate(&env);
                let result = client.try_create_receipt(deal, amount, &payer, &reference_bytes);
                prop_assert_eq!(
                    result.is_ok(),
                    accepted,
                    "create deal {} amount {} reference {} paused {} duplicate {}",
                    deal,
                    amount,
                    reference,
                    model.paused,
                    duplicate
                );

                if accepted {
                    model.accepted[index].push((*reference, *amount));
                }
            }
        }

        for d in 1..=DEALS {
            check_deal(&client, d, &model.accepted[(d - 1) as usize])?;
        }
        prop_assert_eq!(client.is_paused(), model.paused);
    }

    Ok(())
}

// ── Properties ───────────────────────────────────────────────────────────────

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    /// Each (deal, reference) is recorded at most once, and the listed receipts and
    /// totals match the accepted operations after every step.
    #[test]
    fn receipts_recorded_once_per_reference_and_totals_match(
        ops in prop::collection::vec(op_strategy(), 1..40)
    ) {
        run_sequence(&ops, false)?;
    }

    /// While paused, no receipt is created.
    #[test]
    fn paused_contract_records_nothing(
        ops in prop::collection::vec(create_strategy(), 1..20)
    ) {
        run_sequence(&ops, true)?;
    }
}

/// A receipt at the top of the i128 range is stored and listed exactly.
#[test]
fn max_amount_receipt_is_listed_exactly() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(RentPayments, ());
    let client = RentPaymentsClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let payer = Address::generate(&env);
    client.init(&admin);

    let reference = BytesN::from_array(&env, &[1u8; 32]);
    let receipt = client.create_receipt(&1u64, &i128::MAX, &payer, &reference);
    assert_eq!(receipt.amount, i128::MAX);

    let page = client.list_receipts_by_deal(&1u64, &100u32, &None::<Cursor>);
    assert_eq!(page.receipts.len(), 1);
    assert_eq!(page.receipts.get(0).unwrap().amount, i128::MAX);
}
