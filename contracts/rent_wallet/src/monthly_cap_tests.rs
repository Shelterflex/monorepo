// Monthly cap tests for RentWallet.
//
// To enable: add to lib.rs
//   #[cfg(test)]
//   mod monthly_cap_tests;
//
// Run with: cargo test -p rent_wallet monthly_cap

#[cfg(test)]
mod monthly_cap_tests {
    extern crate std;

    use crate::{ContractError, RentWallet, RentWalletClient};
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::{Address, Env, IntoVal};

    // 30-day month in seconds (same constant as monthly_cap.rs)
    const MONTH_SECS: u64 = 2_592_000;

    fn make() -> (Env, Address, RentWalletClient<'static>, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(RentWallet, ());
        let client: RentWalletClient<'static> =
            unsafe { std::mem::transmute(RentWalletClient::new(&env, &contract_id)) };

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.try_init(&admin).unwrap().unwrap();
        env.ledger().set_timestamp(MONTH_SECS); // put us in month 1

        // Fund user
        client
            .try_credit(&admin, &user, &10_000i128)
            .unwrap()
            .unwrap();

        (env, contract_id, client, admin, user)
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Debit within cap
    // ══════════════════════════════════════════════════════════════════════════

    #[test]
    fn debit_within_cap_succeeds() {
        let (env, _id, client, admin, user) = make();
        client
            .try_set_default_monthly_cap(&admin, &5_000i128)
            .unwrap()
            .unwrap();

        client
            .try_debit(&admin, &user, &4_000i128)
            .expect("debit within cap must succeed")
            .expect("inner Ok");

        assert_eq!(client.balance(&user), 6_000i128);
        assert_eq!(client.get_monthly_spent(&user), 4_000i128);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Debit exceeds cap
    // ══════════════════════════════════════════════════════════════════════════

    #[test]
    fn debit_exceeding_cap_fails_with_monthly_cap_exceeded() {
        let (env, _id, client, admin, user) = make();
        client
            .try_set_default_monthly_cap(&admin, &1_000i128)
            .unwrap()
            .unwrap();

        let err = client
            .try_debit(&admin, &user, &1_001i128)
            .unwrap()
            .unwrap_err();
        assert_eq!(err, ContractError::MonthlyCapExceeded);
        // Balance must be unchanged after a rejected debit
        assert_eq!(client.balance(&user), 10_000i128);
    }

    #[test]
    fn cumulative_debits_respect_cap() {
        let (_env, _id, client, admin, user) = make();
        client
            .try_set_default_monthly_cap(&admin, &1_500i128)
            .unwrap()
            .unwrap();

        client
            .try_debit(&admin, &user, &1_000i128)
            .unwrap()
            .unwrap();
        // 1000 spent, 500 remaining
        client.try_debit(&admin, &user, &500i128).unwrap().unwrap();
        // 1500 spent — exactly at cap; next debit must fail
        let err = client
            .try_debit(&admin, &user, &1i128)
            .unwrap()
            .unwrap_err();
        assert_eq!(err, ContractError::MonthlyCapExceeded);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Cap resets on new month
    // ══════════════════════════════════════════════════════════════════════════

    #[test]
    fn monthly_spend_resets_at_start_of_new_month() {
        let (env, _id, client, admin, user) = make();
        client
            .try_set_default_monthly_cap(&admin, &500i128)
            .unwrap()
            .unwrap();

        // Exhaust cap in month 1
        env.ledger().set_timestamp(MONTH_SECS);
        client.try_debit(&admin, &user, &500i128).unwrap().unwrap();
        let err = client
            .try_debit(&admin, &user, &1i128)
            .unwrap()
            .unwrap_err();
        assert_eq!(err, ContractError::MonthlyCapExceeded);

        // Advance to month 2 — cap counter resets
        env.ledger().set_timestamp(MONTH_SECS * 2 + 1);
        client
            .try_debit(&admin, &user, &500i128)
            .expect("new month should reset the spend counter")
            .expect("inner Ok");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Per-user override takes precedence
    // ══════════════════════════════════════════════════════════════════════════

    #[test]
    fn per_user_override_cap_takes_precedence_over_default() {
        let (env, _id, client, admin, user) = make();
        // Default cap is 500, but user has a higher override of 2_000
        client
            .try_set_default_monthly_cap(&admin, &500i128)
            .unwrap()
            .unwrap();
        client
            .try_set_user_monthly_cap(&admin, &user, &2_000i128)
            .unwrap()
            .unwrap();

        // 1_000 would fail against the 500 default but pass against the 2_000 override
        client
            .try_debit(&admin, &user, &1_000i128)
            .expect("per-user override should allow larger debit")
            .expect("inner Ok");

        assert_eq!(client.get_monthly_cap(&user), 2_000i128);
    }

    #[test]
    fn per_user_override_can_restrict_below_default() {
        let (env, _id, client, admin, user) = make();
        client
            .try_set_default_monthly_cap(&admin, &5_000i128)
            .unwrap()
            .unwrap();
        // Override is smaller than the default
        client
            .try_set_user_monthly_cap(&admin, &user, &100i128)
            .unwrap()
            .unwrap();

        let err = client
            .try_debit(&admin, &user, &101i128)
            .unwrap()
            .unwrap_err();
        assert_eq!(err, ContractError::MonthlyCapExceeded);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Zero default cap (no cap — backward-compatible)
    // ══════════════════════════════════════════════════════════════════════════

    #[test]
    fn zero_default_cap_means_no_cap_enforced() {
        // If default has never been set (or is 0), debits should succeed as before.
        let (_env, _id, client, admin, user) = make();
        // No set_default_monthly_cap call → cap is 0 → no enforcement
        client
            .try_debit(&admin, &user, &9_000i128)
            .expect("zero default cap must not block debits")
            .expect("inner Ok");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // get_monthly_spent and get_monthly_cap helpers
    // ══════════════════════════════════════════════════════════════════════════

    #[test]
    fn get_monthly_spent_is_zero_before_any_debit() {
        let (_env, _id, client, _admin, user) = make();
        assert_eq!(client.get_monthly_spent(&user), 0i128);
    }

    #[test]
    fn get_monthly_cap_returns_default_when_no_override_set() {
        let (_env, _id, client, admin, user) = make();
        client
            .try_set_default_monthly_cap(&admin, &3_000i128)
            .unwrap()
            .unwrap();
        assert_eq!(client.get_monthly_cap(&user), 3_000i128);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Admin-only functions
    // ══════════════════════════════════════════════════════════════════════════

    #[test]
    fn non_admin_cannot_set_default_monthly_cap() {
        let (env, _id, client, _admin, _user) = make();
        let rogue = Address::generate(&env);
        let err = client
            .try_set_default_monthly_cap(&rogue, &1_000i128)
            .unwrap()
            .unwrap_err();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    #[test]
    fn non_admin_cannot_set_user_monthly_cap() {
        let (env, _id, client, _admin, user) = make();
        let rogue = Address::generate(&env);
        let err = client
            .try_set_user_monthly_cap(&rogue, &user, &1_000i128)
            .unwrap()
            .unwrap_err();
        assert_eq!(err, ContractError::NotAuthorized);
    }
}
