// Required Kani toolchain version: kani 0.55.0 (cargo-kani 0.55.0)
// Run with: cargo kani --harness <harness_name>
//
// Formal verification properties for allowlist_registry.

#[cfg(kani)]
mod formal_properties {
    use crate::{AllowlistRegistry, AllowlistRegistryClient, Error};
    use soroban_sdk::{Address, Env};

    #[kani::proof]
    fn proof_only_admin_can_add_to_allowlist() {
        let env = Env::default();
        let contract_id = env.register(AllowlistRegistry, ());
        let client = AllowlistRegistryClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let non_admin = Address::generate(&env);
        kani::assume(non_admin != admin);

        let user = Address::generate(&env);

        env.mock_all_auths();
        client.init(&admin);

        let result = client.try_add(&non_admin, &user);
        assert!(result.is_err(), "non-admin cannot add to allowlist");
    }

    #[kani::proof]
    fn proof_allowlist_membership_consistency() {
        let env = Env::default();
        let contract_id = env.register(AllowlistRegistry, ());
        let client = AllowlistRegistryClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        env.mock_all_auths();
        client.init(&admin);

        let is_allowed_before = client.is_allowed(&user);
        assert!(!is_allowed_before, "user should not be allowed initially");

        client.add(&admin, &user);
        let is_allowed_after = client.is_allowed(&user);
        assert!(is_allowed_after, "user must be allowed after add()");

        client.remove(&admin, &user);
        let is_allowed_removed = client.is_allowed(&user);
        assert!(
            !is_allowed_removed,
            "user must not be allowed after remove()"
        );
    }
}
