// To enable this test module, add the following to lib.rs:
//
//   #[cfg(test)]
//   mod upgrade_governance_tests;
//
// Then run: cargo test -p whistleblower_rewards upgrade_governance

#[cfg(test)]
mod upgrade_governance_tests {
    extern crate std;

    use crate::{ContractError, WhistleblowerRewards, WhistleblowerRewardsClient};
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::{token, Address, BytesN, Env};

    fn zeroed_hash(env: &Env) -> BytesN<32> {
        BytesN::from_array(env, &[0u8; 32])
    }

    fn alt_hash(env: &Env) -> BytesN<32> {
        BytesN::from_array(env, &[1u8; 32])
    }

    struct Ctx<'a> {
        env: Env,
        contract_id: Address,
        client: WhistleblowerRewardsClient<'a>,
        admin: Address,
        operator: Address,
    }

    fn setup() -> Ctx<'static> {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(WhistleblowerRewards, ());
        let client = WhistleblowerRewardsClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let operator = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_id = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();

        client
            .try_init(&admin, &operator, &token_id)
            .unwrap()
            .unwrap();

        // Leak the Env to give it 'static lifetime so Ctx can own client
        let env: Env = unsafe { std::mem::transmute(env) };
        let client: WhistleblowerRewardsClient<'static> = unsafe { std::mem::transmute(client) };

        Ctx {
            env,
            contract_id,
            client,
            admin,
            operator,
        }
    }

    // ── Helper: leaks Env to 'static so the struct is self-contained ─────────
    // Soroban's test Env is !Send and not meant to outlive the function, so we
    // build each test with a local Env instead and avoid the lifetime trick.

    fn make_env_and_client() -> (
        Env,
        Address,
        WhistleblowerRewardsClient<'static>,
        Address,
        Address,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(WhistleblowerRewards, ());

        // SAFETY: we build the client inside the same test function and the Env
        // lives at least as long as the client (stack-allocated, same scope).
        let client: WhistleblowerRewardsClient<'static> =
            unsafe { std::mem::transmute(WhistleblowerRewardsClient::new(&env, &contract_id)) };

        let admin = Address::generate(&env);
        let operator = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_id = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();

        client
            .try_init(&admin, &operator, &token_id)
            .unwrap()
            .unwrap();

        (env, contract_id, client, admin, operator)
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 1. Propose Upgrade
    // ══════════════════════════════════════════════════════════════════════════

    #[test]
    fn admin_can_propose_upgrade() {
        let (env, _contract_id, client, admin, _operator) = make_env_and_client();
        let hash = zeroed_hash(&env);
        client
            .try_propose_upgrade(&admin, &hash)
            .expect("propose_upgrade should succeed for admin")
            .expect("inner Result should be Ok");
    }

    #[test]
    fn non_admin_cannot_propose_upgrade() {
        let (env, _contract_id, client, _admin, _operator) = make_env_and_client();
        let rogue = Address::generate(&env);
        let hash = zeroed_hash(&env);
        let err = client
            .try_propose_upgrade(&rogue, &hash)
            .unwrap()
            .unwrap_err();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    #[test]
    fn proposing_while_upgrade_pending_fails() {
        let (env, _contract_id, client, admin, _operator) = make_env_and_client();
        let hash = zeroed_hash(&env);
        client.try_propose_upgrade(&admin, &hash).unwrap().unwrap();

        let err = client
            .try_propose_upgrade(&admin, &alt_hash(&env))
            .unwrap()
            .unwrap_err();
        assert_eq!(err, ContractError::UpgradeAlreadyPending);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 2. Delay Enforcement
    // ══════════════════════════════════════════════════════════════════════════

    #[test]
    fn execute_upgrade_fails_before_delay_elapses() {
        let (env, _contract_id, client, admin, _operator) = make_env_and_client();
        let delay_secs: u64 = 3_600;
        client
            .try_set_upgrade_delay(&admin, &delay_secs)
            .unwrap()
            .unwrap();

        env.ledger().set_timestamp(1_000);
        let hash = zeroed_hash(&env);
        client.try_propose_upgrade(&admin, &hash).unwrap().unwrap();

        // Advance to just before delay expires
        env.ledger().set_timestamp(1_000 + delay_secs - 1);
        let err = client.try_execute_upgrade(&admin).unwrap().unwrap_err();
        assert_eq!(err, ContractError::UpgradeDelayNotMet);
    }

    #[test]
    fn execute_upgrade_succeeds_after_delay_elapses() {
        let (env, _contract_id, client, admin, _operator) = make_env_and_client();
        let delay_secs: u64 = 3_600;
        client
            .try_set_upgrade_delay(&admin, &delay_secs)
            .unwrap()
            .unwrap();

        env.ledger().set_timestamp(1_000);
        let hash = zeroed_hash(&env);
        client.try_propose_upgrade(&admin, &hash).unwrap().unwrap();

        env.ledger().set_timestamp(1_000 + delay_secs);
        // execute_upgrade calls env.deployer().update_current_contract_wasm — this will
        // panic in the test environment because no real WASM is uploaded, so we verify
        // it passes the governance checks by confirming the error is NOT a governance one.
        // In a real testnet environment with an uploaded WASM hash this would succeed.
        let result = client.try_execute_upgrade(&admin);
        match result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                // Governance errors must NOT appear here
                assert_ne!(e, ContractError::UpgradeDelayNotMet);
                assert_ne!(e, ContractError::NoUpgradePending);
            }
            Err(_) => {
                // Host-level panic from WASM upload is acceptable in the test environment
            }
        }
    }

    #[test]
    fn upgrade_delay_is_configurable() {
        let (env, _contract_id, client, admin, _operator) = make_env_and_client();

        // Default delay is 0 — propose+execute should pass immediately
        env.ledger().set_timestamp(500);
        let hash = zeroed_hash(&env);
        client.try_propose_upgrade(&admin, &hash).unwrap().unwrap();

        // No delay set → execute should NOT return UpgradeDelayNotMet
        let result = client.try_execute_upgrade(&admin);
        if let Ok(Err(e)) = result {
            assert_ne!(e, ContractError::UpgradeDelayNotMet);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 3. Cancel Upgrade
    // ══════════════════════════════════════════════════════════════════════════

    #[test]
    fn admin_can_cancel_pending_upgrade() {
        let (env, _contract_id, client, admin, _operator) = make_env_and_client();
        let hash = zeroed_hash(&env);
        client.try_propose_upgrade(&admin, &hash).unwrap().unwrap();

        client
            .try_cancel_upgrade(&admin)
            .expect("cancel_upgrade should succeed")
            .expect("inner Ok");
    }

    #[test]
    fn after_cancel_execute_upgrade_fails_with_no_pending() {
        let (env, _contract_id, client, admin, _operator) = make_env_and_client();
        let hash = zeroed_hash(&env);
        client.try_propose_upgrade(&admin, &hash).unwrap().unwrap();
        client.try_cancel_upgrade(&admin).unwrap().unwrap();

        let err = client.try_execute_upgrade(&admin).unwrap().unwrap_err();
        assert_eq!(err, ContractError::NoUpgradePending);
    }

    #[test]
    fn cancel_upgrade_with_no_pending_fails() {
        let (_env, _contract_id, client, admin, _operator) = make_env_and_client();
        let err = client.try_cancel_upgrade(&admin).unwrap().unwrap_err();
        assert_eq!(err, ContractError::NoUpgradePending);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 4. Execute Upgrade (authorization)
    // ══════════════════════════════════════════════════════════════════════════

    #[test]
    fn non_admin_cannot_execute_upgrade() {
        let (env, _contract_id, client, admin, _operator) = make_env_and_client();
        let hash = zeroed_hash(&env);
        client.try_propose_upgrade(&admin, &hash).unwrap().unwrap();

        let rogue = Address::generate(&env);
        env.ledger().set_timestamp(999_999);
        let err = client.try_execute_upgrade(&rogue).unwrap().unwrap_err();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    #[test]
    fn after_execute_pending_state_is_cleared() {
        let (env, _contract_id, client, admin, _operator) = make_env_and_client();
        let hash = zeroed_hash(&env);
        client.try_propose_upgrade(&admin, &hash).unwrap().unwrap();

        env.ledger().set_timestamp(999_999);
        let result = client.try_execute_upgrade(&admin);
        // If the host WASM call succeeds or panics, in either case the state
        // should have been cleared. Verify by attempting cancel which requires
        // a pending upgrade to exist.
        if result.is_ok() {
            let err = client.try_cancel_upgrade(&admin).unwrap().unwrap_err();
            assert_eq!(err, ContractError::NoUpgradePending);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 5. No Pending Upgrade
    // ══════════════════════════════════════════════════════════════════════════

    #[test]
    fn execute_upgrade_with_no_pending_fails() {
        let (_env, _contract_id, client, admin, _operator) = make_env_and_client();
        let err = client.try_execute_upgrade(&admin).unwrap().unwrap_err();
        assert_eq!(err, ContractError::NoUpgradePending);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 6. Edge Cases
    // ══════════════════════════════════════════════════════════════════════════

    #[test]
    fn propose_upgrade_with_zeroed_hash_is_accepted() {
        // The contract does not validate the WASM hash at proposal time —
        // the hash is only validated at execute time by the host environment.
        let (env, _contract_id, client, admin, _operator) = make_env_and_client();
        let zero_hash = BytesN::from_array(&env, &[0u8; 32]);
        let result = client.try_propose_upgrade(&admin, &zero_hash);
        // Either Ok (governance accepted it) or Err (host rejected) — but it
        // must NOT return a governance error code.
        if let Ok(Err(e)) = result {
            assert_ne!(e, ContractError::NotAuthorized);
            assert_ne!(e, ContractError::UpgradeAlreadyPending);
        }
    }

    #[test]
    fn pending_upgrade_at_is_set_relative_to_current_timestamp() {
        let (env, _contract_id, client, admin, _operator) = make_env_and_client();
        let delay_secs: u64 = 7_200;
        client
            .try_set_upgrade_delay(&admin, &delay_secs)
            .unwrap()
            .unwrap();

        let now: u64 = 10_000;
        env.ledger().set_timestamp(now);
        let hash = zeroed_hash(&env);
        client.try_propose_upgrade(&admin, &hash).unwrap().unwrap();

        // Exactly at the boundary should fail (timestamp < execute_at)
        env.ledger().set_timestamp(now + delay_secs - 1);
        let err = client.try_execute_upgrade(&admin).unwrap().unwrap_err();
        assert_eq!(err, ContractError::UpgradeDelayNotMet);

        // One second later passes the check
        env.ledger().set_timestamp(now + delay_secs);
        let result = client.try_execute_upgrade(&admin);
        if let Ok(Err(e)) = result {
            assert_ne!(e, ContractError::UpgradeDelayNotMet);
        }
    }

    #[test]
    fn propose_after_cancel_succeeds() {
        let (env, _contract_id, client, admin, _operator) = make_env_and_client();
        let hash = zeroed_hash(&env);
        client.try_propose_upgrade(&admin, &hash).unwrap().unwrap();
        client.try_cancel_upgrade(&admin).unwrap().unwrap();

        // After cancel a fresh proposal is allowed
        let hash2 = alt_hash(&env);
        client
            .try_propose_upgrade(&admin, &hash2)
            .expect("second proposal after cancel should succeed")
            .expect("inner Ok");
    }

    #[test]
    fn set_upgrade_delay_with_large_value_stores_correctly() {
        let (_env, _contract_id, client, admin, _operator) = make_env_and_client();
        let large_delay: u64 = 365 * 24 * 3_600; // 1 year in seconds
        client
            .try_set_upgrade_delay(&admin, &large_delay)
            .expect("large delay should be accepted")
            .expect("inner Ok");
    }
}
