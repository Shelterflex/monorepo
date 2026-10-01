#![no_std]

#[cfg(kani)]
pub mod formal_properties;
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, Symbol};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PausableError {
    Paused = 3001,
    NotAuthorized = 3002,
}

pub trait Pausable {
    /// Pause the contract. Only an authorized admin should be able to trigger this.
    fn pause(env: Env, admin: Address) -> Result<(), PausableError>;

    /// Unpause the contract. Only an authorized admin should be able to trigger this.
    fn unpause(env: Env, admin: Address) -> Result<(), PausableError>;

    /// Check if the contract is paused.
    fn is_paused(env: Env) -> bool;
}

// ── Test Harness Contract ─────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Paused,
}

#[contract]
pub struct TestPausableContract;

#[contractimpl]
impl TestPausableContract {
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
    }

    pub fn guarded_operation(env: Env) -> Result<(), PausableError> {
        if Self::is_paused(env.clone()) {
            return Err(PausableError::Paused);
        }
        Ok(())
    }

    fn get_admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set")
    }
}

#[contractimpl]
impl Pausable for TestPausableContract {
    fn pause(env: Env, admin: Address) -> Result<(), PausableError> {
        let stored_admin = Self::get_admin(&env);
        admin.require_auth();
        if admin != stored_admin {
            return Err(PausableError::NotAuthorized);
        }
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish(
            (Symbol::new(&env, "Pausable"), Symbol::new(&env, "pause")),
            (),
        );
        Ok(())
    }

    fn unpause(env: Env, admin: Address) -> Result<(), PausableError> {
        let stored_admin = Self::get_admin(&env);
        admin.require_auth();
        if admin != stored_admin {
            return Err(PausableError::NotAuthorized);
        }
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events().publish(
            (Symbol::new(&env, "Pausable"), Symbol::new(&env, "unpause")),
            (),
        );
        Ok(())
    }

    fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get::<_, bool>(&DataKey::Paused)
            .unwrap_or(false)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::{PausableError, TestPausableContract, TestPausableContractClient};
    use soroban_sdk::testutils::{Address as _, Events, MockAuth, MockAuthInvoke};
    use soroban_sdk::{Address, Env, IntoVal, Symbol, TryIntoVal};

    fn setup(env: &Env) -> (Address, TestPausableContractClient<'_>) {
        let contract_id = env.register(TestPausableContract, ());
        let client = TestPausableContractClient::new(env, &contract_id);
        let admin = Address::generate(env);
        client.init(&admin);
        (admin, client)
    }

    #[test]
    fn guarded_operation_succeeds_when_unpaused() {
        let env = Env::default();
        let (_admin, client) = setup(&env);

        let result = client.try_guarded_operation();
        assert!(
            result.is_ok(),
            "guarded operation should succeed when unpaused"
        );
    }

    #[test]
    fn guarded_operation_rejected_when_paused() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "pause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_pause(&admin).unwrap().unwrap();

        let result = client.try_guarded_operation();
        assert_eq!(
            result.unwrap_err().unwrap(),
            PausableError::Paused,
            "guarded operation should be rejected when paused"
        );
    }

    #[test]
    fn pause_authorization_enforced() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        let attacker = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "pause",
                args: (attacker.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let result = client.try_pause(&attacker);
        assert_eq!(
            result.unwrap_err().unwrap(),
            PausableError::NotAuthorized,
            "unauthorized pause should be rejected"
        );

        assert!(!client.is_paused(), "contract should remain unpaused");
    }

    #[test]
    fn unpause_authorization_enforced() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "pause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_pause(&admin).unwrap().unwrap();

        let attacker = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "unpause",
                args: (attacker.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let result = client.try_unpause(&attacker);
        assert_eq!(
            result.unwrap_err().unwrap(),
            PausableError::NotAuthorized,
            "unauthorized unpause should be rejected"
        );

        assert!(client.is_paused(), "contract should remain paused");
    }

    #[test]
    fn admin_can_pause_and_unpause() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "pause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_pause(&admin).unwrap().unwrap();
        assert!(client.is_paused());

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "unpause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_unpause(&admin).unwrap().unwrap();
        assert!(!client.is_paused());
    }

    #[test]
    fn pause_while_already_paused_is_idempotent() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "pause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_pause(&admin).unwrap().unwrap();
        assert!(client.is_paused());

        // Pause again while already paused
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "pause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_pause(&admin);
        assert!(result.is_ok(), "pause while already paused should succeed");
        assert!(client.is_paused());
    }

    #[test]
    fn unpause_while_not_paused_is_idempotent() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        assert!(!client.is_paused());

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "unpause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_unpause(&admin);
        assert!(result.is_ok(), "unpause while not paused should succeed");
        assert!(!client.is_paused());
    }

    #[test]
    fn is_paused_reflects_state_accurately() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        assert!(!client.is_paused(), "should be unpaused initially");

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "pause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_pause(&admin).unwrap().unwrap();
        assert!(client.is_paused(), "should be paused after pause");

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "unpause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_unpause(&admin).unwrap().unwrap();
        assert!(!client.is_paused(), "should be unpaused after unpause");
    }

    // ── Initialization ───────────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "already initialized")]
    fn double_init_panics() {
        let env = Env::default();
        let contract_id = env.register(TestPausableContract, ());
        let client = TestPausableContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.init(&admin);
        client.init(&admin);
    }

    #[test]
    #[should_panic(expected = "admin not set")]
    fn pause_before_init_panics() {
        let env = Env::default();
        let contract_id = env.register(TestPausableContract, ());
        let client = TestPausableContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.pause(&admin);
    }

    #[test]
    fn is_paused_before_init_defaults_to_false() {
        let env = Env::default();
        let contract_id = env.register(TestPausableContract, ());
        let client = TestPausableContractClient::new(&env, &contract_id);

        assert!(!client.is_paused());
    }

    #[test]
    #[should_panic]
    fn pause_without_any_mocked_auth_fails() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        // No mock_auths / mock_all_auths configured — require_auth() must
        // reject the call, proving pause is gated by real authorization and
        // not just an address-equality check.
        client.pause(&admin);
    }

    #[test]
    #[should_panic]
    fn unpause_without_any_mocked_auth_fails() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "pause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_pause(&admin).unwrap().unwrap();

        client.unpause(&admin);
    }

    // ── Pause / unpause cycling ──────────────────────────────────────────────

    #[test]
    fn pause_unpause_cycles_repeatedly() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        for _ in 0..3 {
            env.mock_auths(&[MockAuth {
                address: &admin,
                invoke: &MockAuthInvoke {
                    contract: &client.address,
                    fn_name: "pause",
                    args: (admin.clone(),).into_val(&env),
                    sub_invokes: &[],
                },
            }]);
            client.try_pause(&admin).unwrap().unwrap();
            assert!(client.is_paused());
            assert_eq!(
                client.try_guarded_operation().unwrap_err().unwrap(),
                PausableError::Paused
            );

            env.mock_auths(&[MockAuth {
                address: &admin,
                invoke: &MockAuthInvoke {
                    contract: &client.address,
                    fn_name: "unpause",
                    args: (admin.clone(),).into_val(&env),
                    sub_invokes: &[],
                },
            }]);
            client.try_unpause(&admin).unwrap().unwrap();
            assert!(!client.is_paused());
            assert!(client.try_guarded_operation().is_ok());
        }
    }

    // ── Events ────────────────────────────────────────────────────────────────

    #[test]
    fn pause_emits_event() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "pause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_pause(&admin).unwrap().unwrap();

        let events = env.events().all();
        let last = events.last().unwrap();
        let topics: soroban_sdk::Vec<soroban_sdk::Val> = last.1.clone();
        assert_eq!(topics.len(), 2);
        let category: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(category, Symbol::new(&env, "Pausable"));
        let action: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(action, Symbol::new(&env, "pause"));
    }

    #[test]
    fn unpause_emits_event() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "pause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_pause(&admin).unwrap().unwrap();

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "unpause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_unpause(&admin).unwrap().unwrap();

        let events = env.events().all();
        let last = events.last().unwrap();
        let topics: soroban_sdk::Vec<soroban_sdk::Val> = last.1.clone();
        assert_eq!(topics.len(), 2);
        let category: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(category, Symbol::new(&env, "Pausable"));
        let action: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(action, Symbol::new(&env, "unpause"));
    }
}
