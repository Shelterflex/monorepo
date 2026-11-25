//! Property-based tests for the reward money logic.
//!
//! Each case builds a fresh Soroban environment and runs a random sequence of
//! operator allocations, full claims and partial claims. After every step the
//! invariants below are checked against the public getters and the token
//! balances, and against a small model that tracks every credit and payment.
//!
//! Invariants:
//! 1. Claimable balance never exceeds the funded balance: the sum of
//!    `claimable` over all (whistleblower, listing) pairs is at most the
//!    contract's token balance.
//! 2. A full claim pays exactly the claimable amount reported just before it,
//!    leaves `claimable` at zero, and a second full claim is rejected with
//!    `NothingToClaim`.
//! 3. Credits are conserved: for every (whistleblower, listing) pair,
//!    `credited == paid + claimable`. The contract balance equals total funded
//!    minus total paid out, and each wallet holds exactly what it was paid.
//!
//! Funding model: `allocate` does not check or move tokens, so the generator
//! mints the same amount to the contract before every allocation. This keeps
//! invariant 1 meaningful. See the PR description for the unfunded-allocation
//! gap this leaves open.
//!
//! Hold window is 0, so every allocation is claimable immediately. Amounts are
//! capped at 1e12 so that sums over a whole sequence stay far from `i128`
//! overflow.

extern crate std;

use super::{ContractError, WhistleblowerRewards, WhistleblowerRewardsClient};
use proptest::prelude::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{token, Address, Env, String};

const USERS: usize = 3;
const LISTINGS: usize = 2;

#[derive(Clone, Debug)]
enum Op {
    /// Fund the contract with `amount`, then allocate `amount` to `user` on `listing`.
    Allocate {
        user: usize,
        listing: usize,
        amount: i128,
    },
    /// Attempt a zero-amount allocation. It must fail and change nothing.
    AllocateZero { user: usize, listing: usize },
    /// Claim everything currently claimable.
    ClaimAll { user: usize, listing: usize },
    /// Claim `pct` percent of the claimable amount (at least 1 unit).
    ClaimPart {
        user: usize,
        listing: usize,
        pct: u8,
    },
}

fn op_strategy() -> impl Strategy<Value = Op> {
    prop_oneof![
        4 => (0..USERS, 0..LISTINGS, 1i128..=1_000_000_000_000i128).prop_map(
            |(user, listing, amount)| Op::Allocate { user, listing, amount }
        ),
        1 => (0..USERS, 0..LISTINGS)
            .prop_map(|(user, listing)| Op::AllocateZero { user, listing }),
        2 => (0..USERS, 0..LISTINGS)
            .prop_map(|(user, listing)| Op::ClaimAll { user, listing }),
        2 => (0..USERS, 0..LISTINGS, 1u8..=100u8).prop_map(|(user, listing, pct)| {
            Op::ClaimPart { user, listing, pct }
        }),
    ]
}

/// Ground truth kept alongside the contract, updated only by successful operations.
#[derive(Default)]
struct Model {
    funded: i128,
    credited: [[i128; LISTINGS]; USERS],
    paid: [[i128; LISTINGS]; USERS],
}

struct Harness<'a> {
    env: &'a Env,
    contract_id: Address,
    client: WhistleblowerRewardsClient<'a>,
    token_id: Address,
    operator: Address,
    users: [Address; USERS],
    listings: [String; LISTINGS],
    deal: String,
}

impl<'a> Harness<'a> {
    fn new(env: &'a Env) -> Self {
        env.mock_all_auths();
        let contract_id = env.register(WhistleblowerRewards, ());
        let client = WhistleblowerRewardsClient::new(env, &contract_id);

        let admin = Address::generate(env);
        let operator = Address::generate(env);
        let token_admin = Address::generate(env);
        let token_id = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();

        // hold_window = 0: allocations are claimable immediately.
        client.init(&admin, &operator, &token_id, &0u64);

        Harness {
            env,
            contract_id,
            client,
            token_id,
            operator,
            users: [
                Address::generate(env),
                Address::generate(env),
                Address::generate(env),
            ],
            listings: [
                String::from_str(env, "listing_a"),
                String::from_str(env, "listing_b"),
            ],
            deal: String::from_str(env, "deal_1"),
        }
    }

    fn mint_to_contract(&self, amount: i128) {
        token::StellarAssetClient::new(self.env, &self.token_id).mint(&self.contract_id, &amount);
    }

    fn apply(&self, m: &mut Model, op: Op) {
        match op {
            Op::Allocate {
                user,
                listing,
                amount,
            } => {
                self.mint_to_contract(amount);
                m.funded += amount;
                self.client.allocate(
                    &self.operator,
                    &self.users[user],
                    &self.listings[listing],
                    &self.deal,
                    &amount,
                );
                m.credited[user][listing] += amount;
            }
            Op::AllocateZero { user, listing } => {
                let r = self.client.try_allocate(
                    &self.operator,
                    &self.users[user],
                    &self.listings[listing],
                    &self.deal,
                    &0i128,
                );
                assert!(
                    matches!(r, Err(Ok(ContractError::InvalidAmount))),
                    "zero allocation must be rejected with InvalidAmount"
                );
            }
            Op::ClaimAll { user, listing } => {
                let who = &self.users[user];
                let lst = &self.listings[listing];
                let before = self.client.claimable(who, lst);
                let r = self.client.try_claim(who, lst, &None);
                if before == 0 {
                    assert!(matches!(r, Err(Ok(ContractError::NothingToClaim))));
                } else {
                    let paid = r.unwrap().unwrap();
                    assert_eq!(paid, before, "full claim must pay the reported claimable");
                    m.paid[user][listing] += paid;
                    assert_eq!(self.client.claimable(who, lst), 0);
                    // Exactly once: a second full claim has nothing to pay.
                    let again = self.client.try_claim(who, lst, &None);
                    assert!(matches!(again, Err(Ok(ContractError::NothingToClaim))));
                }
            }
            Op::ClaimPart { user, listing, pct } => {
                let who = &self.users[user];
                let lst = &self.listings[listing];
                let before = self.client.claimable(who, lst);
                if before == 0 {
                    let r = self.client.try_claim(who, lst, &Some(1i128));
                    assert!(matches!(r, Err(Ok(ContractError::NothingToClaim))));
                } else {
                    let amount = (before * i128::from(pct) / 100).max(1).min(before);
                    let paid = self.client.claim(who, lst, &Some(amount));
                    assert_eq!(paid, amount, "partial claim must pay the requested amount");
                    m.paid[user][listing] += paid;
                    assert_eq!(self.client.claimable(who, lst), before - amount);
                }
            }
        }
    }

    fn check(&self, m: &Model) {
        let token = token::Client::new(self.env, &self.token_id);
        let mut total_claimable: i128 = 0;
        let mut total_paid: i128 = 0;

        for (u, who) in self.users.iter().enumerate() {
            let mut user_paid: i128 = 0;
            for (l, lst) in self.listings.iter().enumerate() {
                let c = self.client.claimable(who, lst);
                assert!(c >= 0, "claimable must never be negative");
                // Invariant 3: credits are conserved per pair.
                assert_eq!(
                    m.credited[u][l],
                    m.paid[u][l] + c,
                    "credit conservation broke for user {u}, listing {l}"
                );
                total_claimable += c;
                user_paid += m.paid[u][l];
            }
            // Each wallet holds exactly what the contract paid it.
            assert_eq!(token.balance(who), user_paid);
            total_paid += user_paid;
        }

        let held = token.balance(&self.contract_id);
        // Invariant 3: the contract holds funded minus paid out.
        assert_eq!(held, m.funded - total_paid);
        // Invariant 1: claimable never exceeds the funded balance.
        assert!(
            total_claimable <= held,
            "claimable {total_claimable} exceeds funded balance {held}"
        );
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(32))]

    #[test]
    fn prop_reward_money_invariants(ops in prop::collection::vec(op_strategy(), 1..20)) {
        let env = Env::default();
        let harness = Harness::new(&env);
        let mut model = Model::default();
        for op in ops {
            harness.apply(&mut model, op);
            harness.check(&model);
        }
    }
}
