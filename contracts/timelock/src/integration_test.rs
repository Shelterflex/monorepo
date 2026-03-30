#[cfg(test)]
mod integration_test {
    use crate::{Timelock, TimelockClient, TimelockError};
    // We need to import StakingPool to register it in the test environment
    // Since StakingPool is in a different crate, we need to add it as a dev-dependency
    // but in this monorepo, we can just use the source if we're in the same workspace.
    // However, for testing, it's easier to use a mock contract if we just want to test cross-contract calls.
    // Let's use a simple mock contract.

    use soroban_sdk::{
        contract, contractimpl,
        testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke},
        Address, Env, IntoVal, Symbol, Vec,
    };

    #[contract]
    pub struct MockTarget;

    #[contractimpl]
    impl MockTarget {
        pub fn admin_op(env: Env, admin: Address) {
            admin.require_auth();
            env.storage()
                .instance()
                .set(&Symbol::new(&env, "done"), &true);
        }

        pub fn is_done(env: Env) -> bool {
            env.storage()
                .instance()
                .get(&Symbol::new(&env, "done"))
                .unwrap_or(false)
        }
    }

    fn setup(env: &Env) -> (TimelockClient<'_>, Address, Address, Address) {
        let timelock_id = env.register(Timelock, ());
        let timelock_client = TimelockClient::new(env, &timelock_id);

        let target_id = env.register(MockTarget, ());
        let target_client = MockTargetClient::new(env, &target_id);

        let admin = Address::generate(env);
        let multisig_member = Address::generate(env);
        let mut members = Vec::new(env);
        members.push_back(multisig_member.clone());
        members.push_back(multisig_member.clone()); // Simplification

        timelock_client.init(&admin, &3600, &86400, &members);

        (timelock_client, target_id, admin, multisig_member)
    }

    #[test]
    fn test_integration_timelock_executes_on_target() {
        let env = Env::default();
        let (timelock, target_id, admin, _) = setup(&env);
        let function = Symbol::new(&env, "admin_op");
        let mut args = Vec::new(&env);
        args.push_back(timelock.address.to_val()); // target expects admin=timelock

        let delay = 3601;

        // 1. Queue
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &timelock.address,
                fn_name: "queue",
                args: (
                    admin.clone(),
                    target_id.clone(),
                    function.clone(),
                    args.clone(),
                    delay,
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        timelock.queue(&admin, &target_id, &function, &args, &delay);
        let eta = env.ledger().timestamp() + delay;

        // 2. Wait
        env.ledger().set_timestamp(eta + 1);

        // 3. Execute
        // No auth needed for execute itself, but timelock WILL authorize sub-invocation
        timelock.execute(&target_id, &function, &args, &eta);

        // 4. Verify target state
        let target_client = MockTargetClient::new(&env, &target_id);
        assert!(target_client.is_done());
    }
}
