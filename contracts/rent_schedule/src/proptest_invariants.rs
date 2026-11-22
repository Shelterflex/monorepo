#![cfg(test)]
//! Property-based invariant tests for rent_schedule.
//!
//! ## Invariants tested
//!
//! 1. **Stored schedule matches the model**: after every step, `get_schedule`
//!    returns the instalments the model accepted, in ascending number order.
//! 2. **Bounded payments**: `0 <= amount_paid <= amount_due`, and
//!    `instalment_remaining == amount_due - amount_paid`.
//! 3. **Status agrees with payment**: a non-waived instalment is `Paid` exactly when
//!    `amount_paid == amount_due`. Payments to a `Paid` or `Waived` instalment are
//!    rejected.
//! 4. **Due dates strictly increase** within a schedule created in increasing order.
//! 5. **Waiver audit**: a waiver record exists exactly for waived instalments, and
//!    its amount equals the balance that was outstanding when it was waived.
//! 6. **Pause gating**: while paused, payments and overdue marks are rejected.
//!
//! `create_schedule` does not validate its input, so the due-date property is tested
//! over schedules built in increasing order. The gap is in an ignored test at the
//! bottom of this file.
//!
//! ## Running the tests
//!
//! ```bash
//! cargo test --package rent_schedule proptest
//! ```

extern crate std;

use std::vec::Vec as StdVec;

use crate::{
    InstalmentStatus, RentSchedule, RentScheduleClient, ScheduledInstalment, WaiverReason,
};
use proptest::prelude::*;
use proptest::test_runner::TestCaseError;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, BytesN, Env, String as SString, Vec as SVec};

const DEALS: usize = 3;
const DEAL_IDS: [&str; DEALS] = ["deal-a", "deal-b", "deal-c"];
const BASE_DUE: u64 = 10_000;
const DUE_STEP: u64 = 100;
const PAID_AT: u64 = 1_000;

// ── Model types ──────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq)]
enum Status {
    Pending,
    Paid,
    Overdue,
    Waived,
}

#[derive(Clone, Debug)]
struct Inst {
    number: u32,
    due: u64,
    amount_due: i128,
    paid: i128,
    status: Status,
}

#[derive(Default)]
struct Deal {
    schedule: Option<StdVec<Inst>>,
    /// (instalment number, amount outstanding when waived)
    waived: StdVec<(u32, i128)>,
}

struct Model {
    deals: StdVec<Deal>,
    paused: bool,
}

// ── Operations ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
enum Op {
    Create {
        deal: usize,
        amounts: StdVec<i128>,
    },
    Pay {
        deal: usize,
        number: u32,
        amount: i128,
    },
    Overdue {
        deal: usize,
        number: u32,
    },
    Waive {
        deal: usize,
        number: u32,
        reason: WaiverReason,
    },
    Pause,
    Unpause,
}

fn amounts_strategy() -> impl Strategy<Value = StdVec<i128>> {
    prop::collection::vec(1i128..=1_000, 0..=4)
}

fn number_strategy() -> impl Strategy<Value = u32> {
    1u32..=5
}

fn pay_amount_strategy() -> impl Strategy<Value = i128> {
    prop_oneof![
        6 => 1i128..=1_000,
        1 => Just(0i128),
        1 => Just(-1i128),
        1 => Just(i128::MAX),
    ]
}

fn reason_strategy() -> impl Strategy<Value = WaiverReason> {
    prop_oneof![
        Just(WaiverReason::Hardship),
        Just(WaiverReason::DisputeResolved),
        Just(WaiverReason::AdminAdjustment),
        Just(WaiverReason::Promotional),
    ]
}

fn op_strategy() -> impl Strategy<Value = Op> {
    prop_oneof![
        2 => (0..DEALS, amounts_strategy())
            .prop_map(|(deal, amounts)| Op::Create { deal, amounts }),
        6 => (0..DEALS, number_strategy(), pay_amount_strategy())
            .prop_map(|(deal, number, amount)| Op::Pay { deal, number, amount }),
        2 => (0..DEALS, number_strategy())
            .prop_map(|(deal, number)| Op::Overdue { deal, number }),
        2 => (0..DEALS, number_strategy(), reason_strategy())
            .prop_map(|(deal, number, reason)| Op::Waive { deal, number, reason }),
        1 => Just(Op::Pause),
        1 => Just(Op::Unpause),
    ]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Builds the schedule for `amounts`: numbers 1..=n, due dates strictly increasing.
fn build_schedule(env: &Env, amounts: &[i128]) -> SVec<ScheduledInstalment> {
    let mut schedule = SVec::new(env);
    for (i, amount) in amounts.iter().enumerate() {
        schedule.push_back(ScheduledInstalment {
            instalment_number: i as u32 + 1,
            due_timestamp: BASE_DUE + DUE_STEP * i as u64,
            amount_due: *amount,
            amount_paid: 0,
            status: InstalmentStatus::Pending,
            paid_at: None,
            last_tx_id: None,
        });
    }
    schedule
}

fn model_schedule(amounts: &[i128]) -> StdVec<Inst> {
    amounts
        .iter()
        .enumerate()
        .map(|(i, amount)| Inst {
            number: i as u32 + 1,
            due: BASE_DUE + DUE_STEP * i as u64,
            amount_due: *amount,
            paid: 0,
            status: Status::Pending,
        })
        .collect()
}

fn status_of(status: &InstalmentStatus) -> Status {
    match status {
        InstalmentStatus::Pending => Status::Pending,
        InstalmentStatus::Paid => Status::Paid,
        InstalmentStatus::Overdue => Status::Overdue,
        InstalmentStatus::Waived => Status::Waived,
    }
}

fn find<'a>(model: &'a Model, deal: usize, number: u32) -> Option<&'a Inst> {
    model.deals[deal]
        .schedule
        .as_ref()
        .and_then(|s| s.iter().find(|i| i.number == number))
}

fn find_mut(model: &mut Model, deal: usize, number: u32) -> Option<&mut Inst> {
    model.deals[deal]
        .schedule
        .as_mut()
        .and_then(|s| s.iter_mut().find(|i| i.number == number))
}

// ── Harness ──────────────────────────────────────────────────────────────────

fn check_state(
    client: &RentScheduleClient<'_>,
    deal_ids: &[SString],
    model: &Model,
) -> Result<(), TestCaseError> {
    prop_assert_eq!(client.is_paused(), model.paused);

    for (d, deal) in model.deals.iter().enumerate() {
        let stored = client.get_schedule(&deal_ids[d]);
        let expected: &[Inst] = deal.schedule.as_deref().unwrap_or(&[]);
        prop_assert_eq!(stored.len() as usize, expected.len());

        let mut last_due: Option<u64> = None;
        for (i, want) in expected.iter().enumerate() {
            let got = stored.get(i as u32).unwrap();
            prop_assert_eq!(got.instalment_number, want.number);
            prop_assert_eq!(got.due_timestamp, want.due);
            prop_assert_eq!(got.amount_due, want.amount_due);
            prop_assert_eq!(got.amount_paid, want.paid);
            let status = status_of(&got.status);
            prop_assert_eq!(status, want.status);

            prop_assert!(
                got.amount_paid >= 0 && got.amount_paid <= got.amount_due,
                "amount_paid {} outside [0, {}]",
                got.amount_paid,
                got.amount_due
            );
            if status != Status::Waived {
                prop_assert_eq!(got.amount_paid == got.amount_due, status == Status::Paid);
            }

            if let Some(prev) = last_due {
                prop_assert!(
                    got.due_timestamp > prev,
                    "due dates not strictly increasing"
                );
            }
            last_due = Some(got.due_timestamp);

            prop_assert_eq!(
                client.instalment_remaining(&deal_ids[d], &want.number),
                want.amount_due - want.paid
            );

            let waiver = client.get_waiver(&deal_ids[d], &want.number);
            let expected_waiver = deal.waived.iter().find(|(n, _)| *n == want.number);
            prop_assert_eq!(waiver.is_some(), expected_waiver.is_some());
            if let (Some(audit), Some((_, amount))) = (waiver, expected_waiver) {
                prop_assert_eq!(audit.amount_waived, *amount);
            }
        }
    }
    Ok(())
}

fn run_sequence(ops: &[Op]) -> Result<(), TestCaseError> {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(RentSchedule, ());
    let client = RentScheduleClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    client.init(&admin, &operator);

    let deal_ids: StdVec<SString> = DEAL_IDS
        .iter()
        .map(|d| SString::from_str(&env, *d))
        .collect();
    let tx_id = BytesN::from_array(&env, &[7u8; 32]);

    let mut model = Model {
        deals: (0..DEALS).map(|_| Deal::default()).collect(),
        paused: false,
    };

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
            Op::Create { deal, amounts } => {
                let accepted = model.deals[*deal].schedule.is_none();
                let schedule = build_schedule(&env, amounts);

                let result = client.try_create_schedule(&admin, &deal_ids[*deal], &schedule);
                prop_assert_eq!(result.is_ok(), accepted, "create deal {}", deal);

                if accepted {
                    model.deals[*deal].schedule = Some(model_schedule(amounts));
                }
            }
            Op::Pay {
                deal,
                number,
                amount,
            } => {
                let accepted = !model.paused
                    && *amount > 0
                    && find(&model, *deal, *number).is_some_and(|i| {
                        !matches!(i.status, Status::Paid | Status::Waived)
                            && *amount <= i.amount_due - i.paid
                    });

                let result = client.try_record_payment(
                    &admin,
                    &deal_ids[*deal],
                    number,
                    amount,
                    &tx_id,
                    &PAID_AT,
                );
                prop_assert_eq!(
                    result.is_ok(),
                    accepted,
                    "pay deal {} number {} amount {} paused {}",
                    deal,
                    number,
                    amount,
                    model.paused
                );

                if accepted {
                    let inst = find_mut(&mut model, *deal, *number).unwrap();
                    inst.paid += *amount;
                    if inst.paid == inst.amount_due {
                        inst.status = Status::Paid;
                    }
                }
            }
            Op::Overdue { deal, number } => {
                let accepted = !model.paused
                    && find(&model, *deal, *number).is_some_and(|i| {
                        !matches!(i.status, Status::Paid | Status::Waived)
                            && i.amount_due - i.paid > 0
                    });

                let result = client.try_mark_overdue(&admin, &deal_ids[*deal], number);
                prop_assert_eq!(
                    result.is_ok(),
                    accepted,
                    "overdue deal {} number {} paused {}",
                    deal,
                    number,
                    model.paused
                );

                if accepted {
                    find_mut(&mut model, *deal, *number).unwrap().status = Status::Overdue;
                }
            }
            Op::Waive {
                deal,
                number,
                reason,
            } => {
                let target = find(&model, *deal, *number);
                let accepted =
                    target.is_some_and(|i| !matches!(i.status, Status::Waived | Status::Paid));
                let outstanding = target.map(|i| i.amount_due - i.paid);

                let result = client.try_waive_instalment(&admin, &deal_ids[*deal], number, reason);
                prop_assert_eq!(
                    result.is_ok(),
                    accepted,
                    "waive deal {} number {}",
                    deal,
                    number
                );

                if accepted {
                    let inst = find_mut(&mut model, *deal, *number).unwrap();
                    inst.status = Status::Waived;
                    model.deals[*deal]
                        .waived
                        .push((*number, outstanding.unwrap()));
                }
            }
        }
        check_state(&client, &deal_ids, &model)?;
    }

    Ok(())
}

// ── Properties ───────────────────────────────────────────────────────────────

proptest! {
    #![proptest_config(ProptestConfig::with_cases(48))]

    /// The stored schedule, payments, statuses, waivers and pause gating match the
    /// model after every step of a random mix of operations.
    #[test]
    fn schedule_invariants_hold_after_every_step(
        ops in prop::collection::vec(op_strategy(), 1..40)
    ) {
        run_sequence(&ops)?;
    }
}

// ── Deterministic edge cases ─────────────────────────────────────────────────

/// Once an instalment is paid, a second payment and an overdue mark are both rejected.
#[test]
fn paid_instalment_rejects_second_payment() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(RentSchedule, ());
    let client = RentScheduleClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    client.init(&admin, &operator);

    let deal = SString::from_str(&env, "deal-a");
    let tx_id = BytesN::from_array(&env, &[9u8; 32]);
    client.create_schedule(&admin, &deal, &build_schedule(&env, &[100]));

    client.record_payment(&admin, &deal, &1u32, &100i128, &tx_id, &PAID_AT);
    assert!(client
        .try_record_payment(&admin, &deal, &1u32, &1i128, &tx_id, &PAID_AT)
        .is_err());
    assert!(client.try_mark_overdue(&admin, &deal, &1u32).is_err());

    let inst = client.get_instalment(&deal, &1u32);
    assert!(matches!(inst.status, InstalmentStatus::Paid));
    assert_eq!(inst.amount_paid, 100);
}

/// A single instalment can be paid in two parts; the final part marks it Paid and
/// any further payment is rejected.
#[test]
fn single_instalment_pays_in_two_parts() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(RentSchedule, ());
    let client = RentScheduleClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    client.init(&admin, &operator);

    let deal = SString::from_str(&env, "deal-a");
    let tx_id = BytesN::from_array(&env, &[3u8; 32]);
    client.create_schedule(&admin, &deal, &build_schedule(&env, &[50]));

    client.record_payment(&admin, &deal, &1u32, &20i128, &tx_id, &PAID_AT);
    assert_eq!(client.instalment_remaining(&deal, &1u32), 30);
    assert!(client
        .try_record_payment(&admin, &deal, &1u32, &31i128, &tx_id, &PAID_AT)
        .is_err());

    client.record_payment(&admin, &deal, &1u32, &30i128, &tx_id, &PAID_AT);
    assert_eq!(client.instalment_remaining(&deal, &1u32), 0);
    assert!(matches!(
        client.get_instalment(&deal, &1u32).status,
        InstalmentStatus::Paid
    ));
}

/// An empty schedule is stored as empty, and no instalment can be paid on it.
#[test]
fn zero_instalment_schedule_is_empty_and_unpayable() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(RentSchedule, ());
    let client = RentScheduleClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    client.init(&admin, &operator);

    let deal = SString::from_str(&env, "deal-a");
    let tx_id = BytesN::from_array(&env, &[5u8; 32]);
    client.create_schedule(&admin, &deal, &build_schedule(&env, &[]));

    assert_eq!(client.get_schedule(&deal).len(), 0);
    assert!(client
        .try_record_payment(&admin, &deal, &1u32, &1i128, &tx_id, &PAID_AT)
        .is_err());
}

/// While paused, payments and overdue marks are rejected. Both resume after unpause.
#[test]
fn pause_blocks_payment_and_overdue_until_unpaused() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(RentSchedule, ());
    let client = RentScheduleClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    client.init(&admin, &operator);

    let deal = SString::from_str(&env, "deal-a");
    let tx_id = BytesN::from_array(&env, &[4u8; 32]);
    client.create_schedule(&admin, &deal, &build_schedule(&env, &[100]));

    client.pause(&admin);
    assert!(client
        .try_record_payment(&admin, &deal, &1u32, &10i128, &tx_id, &PAID_AT)
        .is_err());
    assert!(client.try_mark_overdue(&admin, &deal, &1u32).is_err());

    client.unpause(&admin);
    client.record_payment(&admin, &deal, &1u32, &10i128, &tx_id, &PAID_AT);
    assert_eq!(client.instalment_remaining(&deal, &1u32), 90);
}

/// Known gap, reported in the PR. `create_schedule` accepts instalments whose due
/// dates are not strictly increasing. This test asserts the behaviour the issue asks
/// for, so it fails until the contract validates its input.
#[test]
#[ignore = "known gap: create_schedule accepts non-increasing due dates (see PR)"]
fn create_schedule_rejects_non_increasing_due_dates() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(RentSchedule, ());
    let client = RentScheduleClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    client.init(&admin, &operator);

    let deal = SString::from_str(&env, "deal-a");
    let mut schedule: SVec<ScheduledInstalment> = SVec::new(&env);
    for (number, due) in [(1u32, 2_000u64), (2u32, 1_000u64)] {
        schedule.push_back(ScheduledInstalment {
            instalment_number: number,
            due_timestamp: due,
            amount_due: 100,
            amount_paid: 0,
            status: InstalmentStatus::Pending,
            paid_at: None,
            last_tx_id: None,
        });
    }

    assert!(client
        .try_create_schedule(&admin, &deal, &schedule)
        .is_err());
}
