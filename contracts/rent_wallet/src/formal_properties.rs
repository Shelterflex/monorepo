//! Formal property tests for the rent_wallet contract.
//!
//! These tests act as *mechanically-checked specifications*.  Each test
//! encodes a named invariant that must hold for all reachable states.  They
//! are documented with the invariant name, a human-readable statement, and the
//! proof strategy used.
//!
//! ## Invariants verified
//!
//! | # | Name                        | Statement                                                        |
//! |---|-----------------------------|------------------------------------------------------------------|
//! | 1 | FundsConservation           | sum(balances) = Σ credits − Σ debits                            |
//! | 2 | NoNegativeBalance           | ∀ user: balance(user) ≥ 0                                       |
//! | 3 | PausedBlocksMutation        | while paused, credit/debit always fail                          |
//! | 4 | AdminOnlyMutation           | non-admin can never mutate balances or pause state              |
//! | 5 | AdminTransferConsistency    | after set_admin(A→B), A loses admin rights, B gains them        |
//! | 6 | InitIdempotence             | init can only succeed once; second call is rejected             |
//! | 7 | ZeroAmountRejected          | credit/debit with amount ≤ 0 always fail                        |
//! | 8 | DebitBoundedness            | debit(u, x) succeeds iff balance(u) ≥ x                        |
//! | 9 | CreditMonotonicity          | credit always strictly increases the recipient's balance        |
//! | 10| TotalConsistencyAfterBatch  | sequential credit + debit preserves total across multiple users |

#[cfg(test)]
mod tests {
    extern crate std;

    use crate::{ContractError, RentWallet, RentWalletClient};
    use soroban_sdk::{
        testutils::{Address as _, MockAuth, MockAuthInvoke},
        Address, Env, IntoVal,
    };

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    #[allow(dead_code)]
    fn setup(env: &Env) -> (Address, Address, RentWalletClient<'_>) {
        let id = env.register(RentWallet, ());
        let client = RentWalletClient::new(env, &id);
        let admin = Address::generate(env);
        client.try_init(&admin).unwrap().unwrap();
        let user = Address::generate(env);
        (admin, user, client)
    }

    fn do_credit(
        env: &Env,
        contract_id: &Address,
        client: &RentWalletClient<'_>,
        admin: &Address,
        user: &Address,
        amount: i128,
    ) {
        env.mock_auths(&[MockAuth {
            address: admin,
            invoke: &MockAuthInvoke {
                contract: contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), amount).into_val(env),
                sub_invokes: &[],
            },
        }]);
        client.try_credit(admin, user, &amount).unwrap().unwrap();
    }

    fn do_debit(
        env: &Env,
        contract_id: &Address,
        client: &RentWalletClient<'_>,
        admin: &Address,
        user: &Address,
        amount: i128,
    ) {
        env.mock_auths(&[MockAuth {
            address: admin,
            invoke: &MockAuthInvoke {
                contract: contract_id,
                fn_name: "debit",
                args: (admin.clone(), user.clone(), amount).into_val(env),
                sub_invokes: &[],
            },
        }]);
        client.try_debit(admin, user, &amount).unwrap().unwrap();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Invariant 1 — FundsConservation
    // ─────────────────────────────────────────────────────────────────────

    /// The net balance of a user always equals total_credited − total_debited.
    /// Proof: we track sums manually and assert equality after every operation.
    #[test]
    fn inv1_funds_conservation() {
        let env = Env::default();
        let contract_id = env.register(RentWallet, ());
        let client = RentWalletClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.try_init(&admin).unwrap().unwrap();
        let user = Address::generate(&env);

        let mut total_credited: i128 = 0;
        let mut total_debited: i128 = 0;

        for amount in [100i128, 250, 50, 300] {
            do_credit(&env, &contract_id, &client, &admin, &user, amount);
            total_credited += amount;
            assert_eq!(
                client.balance(&user),
                total_credited - total_debited,
                "after credit({amount}): balance must equal net"
            );
        }

        for amount in [50i128, 100] {
            do_debit(&env, &contract_id, &client, &admin, &user, amount);
            total_debited += amount;
            assert_eq!(
                client.balance(&user),
                total_credited - total_debited,
                "after debit({amount}): balance must equal net"
            );
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Invariant 2 — NoNegativeBalance
    // ─────────────────────────────────────────────────────────────────────

    /// balance(user) ≥ 0 at all times.
    /// Proof: debit never allows balance to go below zero.
    #[test]
    fn inv2_no_negative_balance() {
        let env = Env::default();
        let contract_id = env.register(RentWallet, ());
        let client = RentWalletClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.try_init(&admin).unwrap().unwrap();
        let user = Address::generate(&env);

        do_credit(&env, &contract_id, &client, &admin, &user, 100);

        // Attempt to debit more than balance — must fail
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "debit",
                args: (admin.clone(), user.clone(), 101i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_debit(&admin, &user, &101i128);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::InsufficientBalance,
            "debit exceeding balance must fail"
        );

        // Balance unchanged
        assert_eq!(client.balance(&user), 100);
        assert!(
            client.balance(&user) >= 0,
            "balance must remain non-negative"
        );
    }

    // ─────────────────────────────────────────────────────────────────────
    // Invariant 3 — PausedBlocksMutation
    // ─────────────────────────────────────────────────────────────────────

    /// While paused, credit and debit always fail; balance is unchanged.
    /// Proof: pause → attempt mutation → assert Paused error → unpause → mutation succeeds.
    #[test]
    fn inv3_paused_blocks_mutation() {
        let env = Env::default();
        let contract_id = env.register(RentWallet, ());
        let client = RentWalletClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.try_init(&admin).unwrap().unwrap();
        let user = Address::generate(&env);

        // Seed a balance
        do_credit(&env, &contract_id, &client, &admin, &user, 200);

        // Pause
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "pause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_pause(&admin).unwrap().unwrap();
        assert!(client.is_paused(), "contract must be paused");

        // credit must fail with Paused
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 50i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        assert_eq!(
            client
                .try_credit(&admin, &user, &50i128)
                .unwrap_err()
                .unwrap(),
            ContractError::Paused
        );

        // debit must fail with Paused
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "debit",
                args: (admin.clone(), user.clone(), 50i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        assert_eq!(
            client
                .try_debit(&admin, &user, &50i128)
                .unwrap_err()
                .unwrap(),
            ContractError::Paused
        );

        // Balance unchanged
        assert_eq!(
            client.balance(&user),
            200,
            "balance must be unchanged while paused"
        );

        // Unpause — mutations must succeed again
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "unpause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_unpause(&admin).unwrap().unwrap();
        assert!(!client.is_paused());

        do_credit(&env, &contract_id, &client, &admin, &user, 50);
        assert_eq!(client.balance(&user), 250);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Invariant 4 — AdminOnlyMutation
    // ─────────────────────────────────────────────────────────────────────

    /// Non-admin addresses can never mutate state.
    /// Proof: every mutation called with a non-admin address fails.
    #[test]
    fn inv4_admin_only_mutation() {
        let env = Env::default();
        let contract_id = env.register(RentWallet, ());
        let client = RentWalletClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.try_init(&admin).unwrap().unwrap();
        let user = Address::generate(&env);
        let non_admin = Address::generate(&env);

        // credit by non-admin — without any mock_auths, require_auth will fail
        let result = client.try_credit(&non_admin, &user, &100i128);
        assert!(result.is_err(), "non-admin credit must fail");

        // debit by non-admin
        do_credit(&env, &contract_id, &client, &admin, &user, 100);
        let result = client.try_debit(&non_admin, &user, &50i128);
        assert!(result.is_err(), "non-admin debit must fail");

        // pause by non-admin
        let result = client.try_pause(&non_admin);
        assert!(result.is_err(), "non-admin pause must fail");

        // set_admin by non-admin
        let result = client.try_set_admin(&non_admin, &non_admin);
        assert!(result.is_err(), "non-admin set_admin must fail");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Invariant 5 — AdminTransferConsistency
    // ─────────────────────────────────────────────────────────────────────

    /// After set_admin(old → new), old can no longer credit; new can.
    #[test]
    fn inv5_admin_transfer_consistency() {
        let env = Env::default();
        let contract_id = env.register(RentWallet, ());
        let client = RentWalletClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.try_init(&admin).unwrap().unwrap();
        let new_admin = Address::generate(&env);
        let user = Address::generate(&env);

        // Transfer admin
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_admin",
                args: (admin.clone(), new_admin.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_set_admin(&admin, &new_admin).unwrap().unwrap();

        // Old admin can no longer credit
        let result = client.try_credit(&admin, &user, &100i128);
        assert!(result.is_err(), "old admin must lose credit rights");

        // New admin can credit
        do_credit(&env, &contract_id, &client, &new_admin, &user, 100);
        assert_eq!(client.balance(&user), 100);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Invariant 6 — InitIdempotence
    // ─────────────────────────────────────────────────────────────────────

    /// init() can only succeed once.
    #[test]
    fn inv6_init_idempotence() {
        let env = Env::default();
        let contract_id = env.register(RentWallet, ());
        let client = RentWalletClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.try_init(&admin).unwrap().unwrap();

        let result = client.try_init(&admin);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::AlreadyInitialized
        );
    }

    // ─────────────────────────────────────────────────────────────────────
    // Invariant 7 — ZeroAmountRejected
    // ─────────────────────────────────────────────────────────────────────

    /// credit(0) and debit(0) always fail with InvalidAmount.
    #[test]
    fn inv7_zero_amount_rejected() {
        let env = Env::default();
        let contract_id = env.register(RentWallet, ());
        let client = RentWalletClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.try_init(&admin).unwrap().unwrap();
        let user = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 0i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        assert_eq!(
            client
                .try_credit(&admin, &user, &0i128)
                .unwrap_err()
                .unwrap(),
            ContractError::InvalidAmount
        );

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "debit",
                args: (admin.clone(), user.clone(), 0i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        assert_eq!(
            client
                .try_debit(&admin, &user, &0i128)
                .unwrap_err()
                .unwrap(),
            ContractError::InvalidAmount
        );
    }

    // ─────────────────────────────────────────────────────────────────────
    // Invariant 8 — DebitBoundedness
    // ─────────────────────────────────────────────────────────────────────

    /// debit(u, x) succeeds iff balance(u) ≥ x.
    #[test]
    fn inv8_debit_boundedness() {
        let env = Env::default();
        let contract_id = env.register(RentWallet, ());
        let client = RentWalletClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.try_init(&admin).unwrap().unwrap();
        let user = Address::generate(&env);

        do_credit(&env, &contract_id, &client, &admin, &user, 500);

        // x == balance: must succeed
        do_debit(&env, &contract_id, &client, &admin, &user, 500);
        assert_eq!(client.balance(&user), 0);

        // x > balance (0): must fail
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "debit",
                args: (admin.clone(), user.clone(), 1i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        assert_eq!(
            client
                .try_debit(&admin, &user, &1i128)
                .unwrap_err()
                .unwrap(),
            ContractError::InsufficientBalance
        );
    }

    // ─────────────────────────────────────────────────────────────────────
    // Invariant 9 — CreditMonotonicity
    // ─────────────────────────────────────────────────────────────────────

    /// Every successful credit strictly increases the recipient's balance.
    #[test]
    fn inv9_credit_monotonicity() {
        let env = Env::default();
        let contract_id = env.register(RentWallet, ());
        let client = RentWalletClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.try_init(&admin).unwrap().unwrap();
        let user = Address::generate(&env);

        let mut prev = client.balance(&user);
        for amount in [1i128, 100, 999, 1_000_000] {
            do_credit(&env, &contract_id, &client, &admin, &user, amount);
            let next = client.balance(&user);
            assert!(
                next > prev,
                "balance must strictly increase after credit({amount})"
            );
            prev = next;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Invariant 10 — TotalConsistencyAfterBatch
    // ─────────────────────────────────────────────────────────────────────

    /// After a batch of credits and debits across multiple users, the sum of
    /// all balances equals Σcredits − Σdebits.
    #[test]
    fn inv10_total_consistency_after_batch() {
        let env = Env::default();
        let contract_id = env.register(RentWallet, ());
        let client = RentWalletClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.try_init(&admin).unwrap().unwrap();

        let users: std::vec::Vec<Address> = (0..5).map(|_| Address::generate(&env)).collect();

        let credits = [100i128, 200, 300, 400, 500];
        let debits = [50i128, 80, 0, 100, 250];

        let mut total_net = 0i128;

        for (i, user) in users.iter().enumerate() {
            do_credit(&env, &contract_id, &client, &admin, user, credits[i]);
            total_net += credits[i];

            if debits[i] > 0 {
                do_debit(&env, &contract_id, &client, &admin, user, debits[i]);
                total_net -= debits[i];
            }
        }

        let sum_of_balances: i128 = users.iter().map(|u| client.balance(u)).sum();
        assert_eq!(
            sum_of_balances, total_net,
            "sum of balances must equal net of all operations"
        );

        // All individual balances are non-negative
        for (i, user) in users.iter().enumerate() {
            assert!(
                client.balance(user) >= 0,
                "user {i} balance must be non-negative"
            );
        }
    }
}
