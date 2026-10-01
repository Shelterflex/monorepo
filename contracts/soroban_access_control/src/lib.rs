#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, Symbol};

#[cfg(kani)]
mod formal_properties;

/// Extends the TTL (time-to-live) of a persistent storage entry.
///
/// On Soroban, persistent storage entries have a limited lifetime based on the ledger TTL.
/// If entries are never extended, they eventually get archived or expire, causing reads to fail.
/// This helper should be called after writing to persistent storage to ensure the entry remains accessible.
///
/// The standard approach is to extend TTL on every write to a persistent key, which is
/// the simplest and most robust method to ensure data remains accessible.
///
/// # Arguments
/// * `env` - The environment
/// * `key` - The storage key to extend TTL for
///
/// # Example
/// ```ignore
/// env.storage().persistent().set(&key, &value);
/// extend_storage_ttl(&env, &key);
/// ```
#[inline]
pub fn extend_storage_ttl(env: &Env, key: &soroban_sdk::Val) {
    // Extend TTL if it's below threshold (10,000 ledgers) to 500,000 ledgers (~58 days at 10s per ledger)
    // This is a conservative extension that balances cost with data safety
    env.storage().persistent().extend_ttl(key, 10_000, 500_000);
}

/// Emit a standardized unauthorized-access event and return the provided contract error.
#[inline]
pub fn deny<E>(env: &Env, caller: &Address, operation: &str, err: E) -> E {
    env.events().publish(
        (
            Symbol::new(env, "access_control"),
            Symbol::new(env, "unauthorized"),
            caller.clone(),
        ),
        Symbol::new(env, operation),
    );
    err
}

/// Require that `caller` is the current `admin`.
#[inline]
pub fn require_admin_permission<E: Copy>(
    env: &Env,
    admin: &Address,
    caller: &Address,
    operation: &str,
    not_authorized: E,
) -> Result<(), E> {
    caller.require_auth();
    if caller != admin {
        return Err(deny(env, caller, operation, not_authorized));
    }
    Ok(())
}

/// Require that `caller` is either `admin` OR an optional operator.
#[inline]
pub fn require_admin_or_operator_permission<E: Copy>(
    env: &Env,
    admin: &Address,
    operator: Option<&Address>,
    caller: &Address,
    operation: &str,
    not_authorized: E,
) -> Result<(), E> {
    caller.require_auth();
    if caller == admin {
        return Ok(());
    }
    if let Some(op) = operator {
        if caller == op {
            return Ok(());
        }
    }

    Err(deny(env, caller, operation, not_authorized))
}

// ── Test Harness Contract ─────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TestError {
    NotAuthorized = 4001,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Operator,
}

#[contract]
pub struct TestAccessControlContract;

#[contractimpl]
impl TestAccessControlContract {
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    pub fn set_operator(env: Env, caller: Address, operator: Address) -> Result<(), TestError> {
        let admin = Self::get_admin(&env);
        require_admin_permission(
            &env,
            &admin,
            &caller,
            "set_operator",
            TestError::NotAuthorized,
        )?;
        env.storage().instance().set(&DataKey::Operator, &operator);
        Ok(())
    }

    pub fn admin_only_operation(env: Env, caller: Address) -> Result<(), TestError> {
        let admin = Self::get_admin(&env);
        require_admin_permission(
            &env,
            &admin,
            &caller,
            "admin_only_operation",
            TestError::NotAuthorized,
        )?;
        Ok(())
    }

    pub fn admin_or_operator_operation(env: Env, caller: Address) -> Result<(), TestError> {
        let admin = Self::get_admin(&env);
        let operator = Self::get_operator(&env);
        require_admin_or_operator_permission(
            &env,
            &admin,
            operator.as_ref(),
            &caller,
            "admin_or_operator_operation",
            TestError::NotAuthorized,
        )?;
        Ok(())
    }

    fn get_admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set")
    }

    fn get_operator(env: &Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Operator)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::{TestAccessControlContract, TestAccessControlContractClient, TestError};
    use soroban_sdk::testutils::{Address as _, Events, MockAuth, MockAuthInvoke};
    use soroban_sdk::{Address, Env, IntoVal, Symbol, TryIntoVal};

    fn setup(env: &Env) -> (Address, TestAccessControlContractClient<'_>) {
        let contract_id = env.register(TestAccessControlContract, ());
        let client = TestAccessControlContractClient::new(env, &contract_id);
        let admin = Address::generate(env);
        client.init(&admin);
        (admin, client)
    }

    #[test]
    fn admin_passes_admin_permission_check() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "admin_only_operation",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let result = client.try_admin_only_operation(&admin);
        assert!(result.is_ok(), "admin should pass admin permission check");
    }

    #[test]
    fn non_admin_denied_admin_permission_check() {
        let env = Env::default();
        let (_admin, client) = setup(&env);

        let attacker = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "admin_only_operation",
                args: (attacker.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let result = client.try_admin_only_operation(&attacker);
        assert_eq!(
            result.unwrap_err().unwrap(),
            TestError::NotAuthorized,
            "non-admin should be denied"
        );
    }

    #[test]
    fn operator_not_mistaken_for_admin() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        let operator = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "set_operator",
                args: (admin.clone(), operator.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_set_operator(&admin, &operator).unwrap().unwrap();

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "admin_only_operation",
                args: (operator.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let result = client.try_admin_only_operation(&operator);
        assert_eq!(
            result.unwrap_err().unwrap(),
            TestError::NotAuthorized,
            "operator should not pass admin-only check"
        );
    }

    #[test]
    fn admin_passes_admin_or_operator_permission_check() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "admin_or_operator_operation",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let result = client.try_admin_or_operator_operation(&admin);
        assert!(
            result.is_ok(),
            "admin should pass admin_or_operator permission check"
        );
    }

    #[test]
    fn operator_passes_admin_or_operator_permission_check() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        let operator = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "set_operator",
                args: (admin.clone(), operator.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_set_operator(&admin, &operator).unwrap().unwrap();

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "admin_or_operator_operation",
                args: (operator.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let result = client.try_admin_or_operator_operation(&operator);
        assert!(
            result.is_ok(),
            "operator should pass admin_or_operator permission check"
        );
    }

    #[test]
    fn non_admin_non_operator_denied_admin_or_operator_permission_check() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        let operator = Address::generate(&env);
        let attacker = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "set_operator",
                args: (admin.clone(), operator.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_set_operator(&admin, &operator).unwrap().unwrap();

        env.mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "admin_or_operator_operation",
                args: (attacker.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let result = client.try_admin_or_operator_operation(&attacker);
        assert_eq!(
            result.unwrap_err().unwrap(),
            TestError::NotAuthorized,
            "non-admin/non-operator should be denied"
        );
    }

    #[test]
    fn unauthorized_access_emits_expected_event() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        let attacker = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "admin_only_operation",
                args: (attacker.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let result = client.try_admin_only_operation(&attacker);
        assert_eq!(result.unwrap_err().unwrap(), TestError::NotAuthorized);

        let events = env.events().all();
        assert!(!events.is_empty(), "should emit unauthorized access event");
    }

    // ── Initialization ───────────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "already initialized")]
    fn double_init_panics() {
        let env = Env::default();
        let contract_id = env.register(TestAccessControlContract, ());
        let client = TestAccessControlContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.init(&admin);
        client.init(&admin);
    }

    #[test]
    #[should_panic(expected = "admin not set")]
    fn call_before_init_panics() {
        let env = Env::default();
        let contract_id = env.register(TestAccessControlContract, ());
        let client = TestAccessControlContractClient::new(&env, &contract_id);
        let caller = Address::generate(&env);

        client.admin_only_operation(&caller);
    }

    #[test]
    #[should_panic]
    fn admin_only_operation_without_any_mocked_auth_fails() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        // No mock_auths / mock_all_auths configured — require_auth() must
        // reject the call since no authorization was actually provided,
        // proving the auth check is real and not just a logic-level compare.
        client.admin_only_operation(&admin);
    }

    // ── set_operator authorization / overwrite ──────────────────────────────

    #[test]
    fn set_operator_unauthorized_fails() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let attacker = Address::generate(&env);
        let target_operator = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "set_operator",
                args: (attacker.clone(), target_operator.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let result = client.try_set_operator(&attacker, &target_operator);
        assert_eq!(
            result.unwrap_err().unwrap(),
            TestError::NotAuthorized,
            "non-admin should not be able to set the operator"
        );
    }

    #[test]
    fn set_operator_overwrite_replaces_previous_operator() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let operator1 = Address::generate(&env);
        let operator2 = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "set_operator",
                args: (admin.clone(), operator1.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_set_operator(&admin, &operator1)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "set_operator",
                args: (admin.clone(), operator2.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_set_operator(&admin, &operator2)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &operator1,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "admin_or_operator_operation",
                args: (operator1.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let stale_operator_result = client.try_admin_or_operator_operation(&operator1);
        assert_eq!(
            stale_operator_result.unwrap_err().unwrap(),
            TestError::NotAuthorized,
            "replaced operator must lose operator privileges"
        );

        env.mock_auths(&[MockAuth {
            address: &operator2,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "admin_or_operator_operation",
                args: (operator2.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let new_operator_result = client.try_admin_or_operator_operation(&operator2);
        assert!(
            new_operator_result.is_ok(),
            "new operator must gain operator privileges"
        );
    }

    #[test]
    fn admin_or_operator_denied_when_no_operator_ever_set() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let stranger = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "admin_or_operator_operation",
                args: (stranger.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let result = client.try_admin_or_operator_operation(&stranger);
        assert_eq!(result.unwrap_err().unwrap(), TestError::NotAuthorized);
    }

    // ── Events ────────────────────────────────────────────────────────────────

    #[test]
    fn unauthorized_set_operator_emits_event_with_operation_name() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let attacker = Address::generate(&env);
        let target_operator = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "set_operator",
                args: (attacker.clone(), target_operator.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_set_operator(&attacker, &target_operator);
        assert_eq!(result.unwrap_err().unwrap(), TestError::NotAuthorized);

        let events = env.events().all();
        let last = events.last().unwrap();
        let topics: soroban_sdk::Vec<soroban_sdk::Val> = last.1.clone();
        assert_eq!(topics.len(), 3);
        let category: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(category, Symbol::new(&env, "access_control"));
        let kind: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(kind, Symbol::new(&env, "unauthorized"));
        let denied_caller: Address = topics.get(2).unwrap().try_into_val(&env).unwrap();
        assert_eq!(denied_caller, attacker);
        let operation: Symbol = last.2.clone().try_into_val(&env).unwrap();
        assert_eq!(operation, Symbol::new(&env, "set_operator"));
    }
}
