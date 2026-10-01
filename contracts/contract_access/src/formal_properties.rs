// Required Kani toolchain version: kani 0.55.0 (cargo-kani 0.55.0)
// Run with: cargo kani --harness <harness_name>
//
// Formal verification properties for contract_access.

#[cfg(kani)]
mod formal_properties {
    use crate::{ContractAccess, ContractAccessClient, DataKey, Error};
    use soroban_sdk::{Address, Env};

    #[kani::proof]
    fn proof_only_admin_can_set_access() {
        let env = Env::default();
        let contract_id = env.register(ContractAccess, ());
        let client = ContractAccessClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let non_admin = Address::generate(&env);
        kani::assume(non_admin != admin);

        let target_contract = Address::generate(&env);

        env.mock_all_auths();
        client.init(&admin);

        let result = client.try_set_access(&non_admin, &target_contract, &true);
        assert!(result.is_err(), "non-admin must be denied access update");
    }

    #[kani::proof]
    fn proof_admin_can_set_and_verify_access() {
        let env = Env::default();
        let contract_id = env.register(ContractAccess, ());
        let client = ContractAccessClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let target_contract = Address::generate(&env);

        env.mock_all_auths();
        client.init(&admin);

        let allowed_before = client.is_allowed(&target_contract);
        assert!(!allowed_before, "access should default to false");

        client.set_access(&admin, &target_contract, &true);

        let allowed_after = client.is_allowed(&target_contract);
        assert!(allowed_after, "access should be granted immediately");
    }
}
