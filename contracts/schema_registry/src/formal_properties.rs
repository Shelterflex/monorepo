// Required Kani toolchain version: kani 0.55.0 (cargo-kani 0.55.0)
// Run with: cargo kani --harness <harness_name>
//
// Formal verification properties for schema_registry.

#[cfg(kani)]
mod formal_properties {
    use crate::{Error, SchemaRegistry, SchemaRegistryClient};
    use soroban_sdk::{Address, BytesN, Env, String};

    #[kani::proof]
    fn proof_only_admin_can_register_schema() {
        let env = Env::default();
        let contract_id = env.register(SchemaRegistry, ());
        let client = SchemaRegistryClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let non_admin = Address::generate(&env);
        kani::assume(non_admin != admin);

        let schema_id = BytesN::from_array(&env, &[1u8; 32]);
        let uri = String::from_str(&env, "https://example.com/schema");

        env.mock_all_auths();
        client.init(&admin);

        let result = client.try_register_schema(&non_admin, &schema_id, &uri);
        assert!(result.is_err(), "non-admin cannot register schema");
    }

    #[kani::proof]
    fn proof_schema_consistency_after_registration() {
        let env = Env::default();
        let contract_id = env.register(SchemaRegistry, ());
        let client = SchemaRegistryClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let schema_id = BytesN::from_array(&env, &[2u8; 32]);
        let uri = String::from_str(&env, "https://example.com/schema2");

        env.mock_all_auths();
        client.init(&admin);

        let has_before = client.has_schema(&schema_id);
        assert!(!has_before, "schema should not exist before registration");

        client.register_schema(&admin, &schema_id, &uri);

        let has_after = client.has_schema(&schema_id);
        assert!(has_after, "schema must exist after registration");

        let fetched_uri = client.get_schema(&schema_id);
        assert_eq!(fetched_uri, uri);
    }
}
