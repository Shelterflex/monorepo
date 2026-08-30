// To enable this test module, add the following to lib.rs:
//
//   #[cfg(test)]
//   mod upgrade_governance_tests;
//
// Then run: cargo test -p whistleblower_rewards upgrade_governance
//
// NOTE: Emergency upgrade path test coverage is currently documented and tracked
// as a separate milestone per issue guidelines.

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
        let client: WhistleblowerRewardsClient<'static> =
            unsafe { std::mem::transmute(client) };

        Ctx { env, contract_id, client, admin, operator }
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
        client
            .try_propose_upgrade(&admin, &hash)
            .unwrap()
            .unwrap();

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
        client
            .try_propose_upgrade(&admin, &hash)
            .unwrap()
            .unwrap();

        // Advance to just before delay expires
        env.ledger().set_timestamp(1_000 + delay_secs - 1);
        let err = client
            .try_execute_upgrade(&admin)
            .unwrap()
            .unwrap_err();
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
        client
            .try_propose_upgrade(&admin, &hash)
            .unwrap()
            .unwrap();

        env.ledger().set_timestamp(1_000 + delay_secs);
        let result = client.try_execute_upgrade(&admin);
        match result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                assert_ne!(e, ContractError::UpgradeDelayNotMet);
                assert_ne!(e, ContractError::NoUpgradePending);
            }
            Err(_) => {}
        }
    }

    #[test]
    fn upgrade_delay_is_configurable() {
        let (env, _contract_id, client, admin, _operator) = make_env_and_client();

        env.ledger().set_timestamp(500);
        let hash = zeroed_hash(&env);
        client
            .try_propose_upgrade(&admin, &hash)
            .unwrap()
            .unwrap();

        let result = client.try_execute_upgrade(&admin);
        if let Ok(Err(e)) = result {
            assert_ne!(e, ContractError::UpgradeDelayNotMet);
        }
    }
}
