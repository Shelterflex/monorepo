// Required Kani toolchain version: kani 0.55.0 (cargo-kani 0.55.0)
// Run with: cargo kani --harness <harness_name>
//
// Formal verification properties for soroban_pausable.

#[cfg(kani)]
mod formal_properties {
    use crate::{Error, PausableContract, PausableContractClient};
    use soroban_sdk::{Address, Env};

    #[kani::proof]
    fn proof_only_admin_can_pause_and_unpause() {
        let env = Env::default();
        let contract_id = env.register(PausableContract, ());
        let client = PausableContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let non_admin = Address::generate(&env);
        kani::assume(non_admin != admin);

        env.mock_all_auths();
        client.init(&admin);

        let pause_result = client.try_pause(&non_admin);
        assert!(pause_result.is_err(), "non-admin cannot pause");

        client.pause(&admin);

        let unpause_result = client.try_unpause(&non_admin);
        assert!(unpause_result.is_err(), "non-admin cannot unpause");
    }

    #[kani::proof]
    fn proof_pause_state_consistency() {
        let env = Env::default();
        let contract_id = env.register(PausableContract, ());
        let client = PausableContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);

        env.mock_all_auths();
        client.init(&admin);

        let initial_paused = client.is_paused();
        assert!(!initial_paused, "contract should not be paused initially");

        client.pause(&admin);
        let paused_state = client.is_paused();
        assert!(paused_state, "contract must be paused after pause()");

        client.unpause(&admin);
        let unpaused_state = client.is_paused();
        assert!(!unpaused_state, "contract must be unpaused after unpause()");
    }
}
