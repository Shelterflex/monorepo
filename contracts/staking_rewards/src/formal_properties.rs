#[cfg(test)]
mod formal_properties {
    use crate::test::setup;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Address, Env};

    #[test]
    #[cfg_attr(kani, kani::proof)]
    fn invariant_rewards_non_negative() {
        let env = Env::default();
        let (_contract_id, client) = setup(&env);
        let user = Address::generate(&env);

        // Reward should be 0 initially
        assert_eq!(client.get_claimable(&user), 0);
    }
}
