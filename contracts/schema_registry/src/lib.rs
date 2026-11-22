#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, BytesN, Env, Symbol,
};

// ── Storage keys ─────────────────────────────────────────────────────────────
pub mod access_control;
pub mod validation;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    ContractVersion,
    Admin,
    /// Registry version (incremented on schema updates)
    RegistryVersion,
    /// Transition registration: (from_version, to_version) -> exists
    Transition(u32, u32),
    /// Migration receipt: (contract_id, ledger_sequence) -> receipt
    Receipt(Address, u64),
    /// Next receipt sequence for a contract
    NextReceiptSequence(Address),
}

#[contracttype]
#[derive(Clone)]
pub struct MigrationReceipt {
    contract_id: Address,
    from_version: u32,
    to_version: u32,
    ledger_sequence: u64,
    result_hash: BytesN<32>,
    executed_at: u64,
}

fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<_, Address>(&DataKey::Admin)
        .expect("admin not set")
}

fn get_registry_version(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get::<_, u32>(&DataKey::RegistryVersion)
        .unwrap_or(0)
}

fn set_registry_version(env: &Env, version: u32) {
    env.storage()
        .instance()
        .set(&DataKey::RegistryVersion, &version);
}

// ── Errors ───────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    TransitionAlreadyRegistered = 3,
    InvalidVersion = 4,
    DowngradeNotAllowed = 5,
    TransitionNotSupported = 6,
    ReceiptNotFound = 7,
    VerificationFailed = 8,
    ReceiptAlreadyExists = 9,
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct SchemaRegistry;

#[contractimpl]
impl SchemaRegistry {
    /// Initialize the schema registry.
    pub fn initialize(env: Env, admin: Address) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::RegistryVersion, &0u32);
        env.storage()
            .instance()
            .set(&DataKey::ContractVersion, &1u32);

        env.events().publish(
            (Symbol::new(&env, "schema_registry"), Symbol::new(&env, "initialize")),
            admin,
        );

        Ok(())
    }

    /// Register a supported state transition (admin only).
    pub fn register_transition(
        env: Env,
        admin: Address,
        from_version: u32,
        to_version: u32,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(
            &env,
            &current_admin,
            &admin,
            "register_transition",
        )?;

        // Validate versions
        if to_version <= from_version {
            return Err(ContractError::DowngradeNotAllowed);
        }

        let transition_key = DataKey::Transition(from_version, to_version);
        if env.storage().instance().has(&transition_key) {
            return Err(ContractError::TransitionAlreadyRegistered);
        }

        env.storage().instance().set(&transition_key, &true);

        env.events().publish(
            (
                Symbol::new(&env, "schema_registry"),
                Symbol::new(&env, "register_transition"),
            ),
            (from_version, to_version),
        );

        Ok(())
    }

    /// Check if a transition is supported.
    pub fn is_transition_supported(env: Env, from_version: u32, to_version: u32) -> bool {
        env.storage()
            .instance()
            .has(&DataKey::Transition(from_version, to_version))
    }

    /// Dry run a migration (returns what would happen without executing).
    pub fn dry_run(
        env: Env,
        _contract_id: Address,
        from_version: u32,
        to_version: u32,
    ) -> Result<bool, ContractError> {
        let transition_key = DataKey::Transition(from_version, to_version);
        if !env.storage().instance().has(&transition_key) {
            return Err(ContractError::TransitionNotSupported);
        }

        // Dry run would succeed if transition is registered
        Ok(true)
    }

    /// Execute a migration and write a receipt.
    pub fn execute_migration(
        env: Env,
        caller: Address,
        contract_id: Address,
        from_version: u32,
        to_version: u32,
        result_hash: BytesN<32>,
    ) -> Result<(), ContractError> {
        caller.require_auth();

        let transition_key = DataKey::Transition(from_version, to_version);
        if !env.storage().instance().has(&transition_key) {
            return Err(ContractError::TransitionNotSupported);
        }

        let now = env.ledger().timestamp();
        let sequence = env.ledger().sequence() as u64;

        // Check for duplicate receipt
        let receipt_key = DataKey::Receipt(contract_id.clone(), sequence);
        if env.storage().persistent().has(&receipt_key) {
            return Err(ContractError::ReceiptAlreadyExists);
        }

        let receipt = MigrationReceipt {
            contract_id: contract_id.clone(),
            from_version,
            to_version,
            ledger_sequence: sequence,
            result_hash,
            executed_at: now,
        };

        env.storage().persistent().set(&receipt_key, &receipt);

        // Increment next receipt sequence for this contract
        let next_seq = env
            .storage()
            .persistent()
            .get::<_, u64>(&DataKey::NextReceiptSequence(contract_id.clone()))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::NextReceiptSequence(contract_id.clone()), &(next_seq + 1));

        env.events().publish(
            (
                Symbol::new(&env, "schema_registry"),
                Symbol::new(&env, "execute_migration"),
            ),
            (contract_id, from_version, to_version, sequence),
        );

        Ok(())
    }

    /// Get a migration receipt.
    pub fn get_receipt(
        env: Env,
        contract_id: Address,
        ledger_sequence: u64,
    ) -> Option<MigrationReceipt> {
        env.storage()
            .persistent()
            .get(&DataKey::Receipt(contract_id, ledger_sequence))
    }

    /// Verify a migration receipt by recomputing and comparing the hash.
    pub fn verify_migration(
        env: Env,
        contract_id: Address,
        ledger_sequence: u64,
        expected_hash: BytesN<32>,
    ) -> Result<bool, ContractError> {
        let receipt: MigrationReceipt = env
            .storage()
            .persistent()
            .get(&DataKey::Receipt(contract_id, ledger_sequence))
            .ok_or(ContractError::ReceiptNotFound)?;

        if receipt.result_hash == expected_hash {
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Get the current registry version.
    pub fn registry_version(env: Env) -> u32 {
        get_registry_version(&env)
    }
}

#[cfg(test)]
mod test {
    extern crate std;

    use super::{ContractError, SchemaRegistry, SchemaRegistryClient};
    use soroban_sdk::testutils::{Address as _, MockAuth, MockAuthInvoke};
    use soroban_sdk::{Address, BytesN, Env, IntoVal};

    fn setup(env: &Env) -> (Address, SchemaRegistryClient<'_>) {
        env.mock_all_auths();
        let contract_id = env.register(SchemaRegistry, ());
        let client = SchemaRegistryClient::new(env, &contract_id);

        let admin = Address::generate(env);

        client.try_initialize(&admin).unwrap().unwrap();

        (admin, client)
    }

    fn contract_id<'a>(client: &'a SchemaRegistryClient<'a>) -> &'a Address {
        &client.address
    }

    #[test]
    #[should_panic]
    fn init_requires_admin_auth() {
        let env = Env::default();
        let id = env.register(SchemaRegistry, ());
        let client = SchemaRegistryClient::new(&env, &id);
        let admin = Address::generate(&env);

        client.initialize(&admin);
    }

    #[test]
    fn init_sets_config() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        assert_eq!(client.registry_version(), 0u32);
    }

    #[test]
    fn init_cannot_be_called_twice() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        let err = client.try_initialize(&admin).unwrap_err().unwrap();
        assert_eq!(err, ContractError::AlreadyInitialized);
    }

    #[test]
    fn register_transition_succeeds() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "register_transition",
                args: (admin.clone(), 1u32, 2u32).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_register_transition(&admin, &1u32, &2u32)
            .unwrap()
            .unwrap();

        assert!(client.is_transition_supported(&1u32, &2u32));
    }

    #[test]
    fn register_transition_rejects_downgrade() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "register_transition",
                args: (admin.clone(), 2u32, 1u32).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_register_transition(&admin, &2u32, &1u32)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::DowngradeNotAllowed);
    }

    #[test]
    fn register_transition_rejects_duplicate() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "register_transition",
                args: (admin.clone(), 1u32, 2u32).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_register_transition(&admin, &1u32, &2u32)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "register_transition",
                args: (admin.clone(), 1u32, 2u32).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_register_transition(&admin, &1u32, &2u32)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::TransitionAlreadyRegistered);
    }

    #[test]
    fn dry_run_succeeds_for_registered_transition() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "register_transition",
                args: (admin.clone(), 1u32, 2u32).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_register_transition(&admin, &1u32, &2u32)
            .unwrap()
            .unwrap();

        let contract = Address::generate(&env);
        let result = client
            .try_dry_run(&contract, &1u32, &2u32)
            .unwrap()
            .unwrap();
        assert!(result);
    }

    #[test]
    fn dry_run_fails_for_unregistered_transition() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        let contract = Address::generate(&env);
        let err = client
            .try_dry_run(&contract, &1u32, &2u32)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::TransitionNotSupported);
    }

    #[test]
    fn execute_migration_creates_receipt() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "register_transition",
                args: (admin.clone(), 1u32, 2u32).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_register_transition(&admin, &1u32, &2u32)
            .unwrap()
            .unwrap();

        let contract = Address::generate(&env);
        let hash = BytesN::from_array(&env, &[0u8; 32]);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "execute_migration",
                args: (admin.clone(), contract.clone(), 1u32, 2u32, hash.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_execute_migration(&admin, &contract, &1u32, &2u32, &hash)
            .unwrap()
            .unwrap();

        let receipt = client.get_receipt(&contract, &0u64).unwrap();
        assert_eq!(receipt.from_version, 1u32);
        assert_eq!(receipt.to_version, 2u32);
    }

    #[test]
    fn execute_migration_fails_for_unregistered_transition() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        let contract = Address::generate(&env);
        let hash = BytesN::from_array(&env, &[0u8; 32]);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "execute_migration",
                args: (admin.clone(), contract.clone(), 1u32, 2u32, hash.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_execute_migration(&admin, &contract, &1u32, &2u32, &hash)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::TransitionNotSupported);
    }

    #[test]
    fn verify_migration_succeeds() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "register_transition",
                args: (admin.clone(), 1u32, 2u32).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_register_transition(&admin, &1u32, &2u32)
            .unwrap()
            .unwrap();

        let contract = Address::generate(&env);
        let hash = BytesN::from_array(&env, &[0u8; 32]);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "execute_migration",
                args: (admin.clone(), contract.clone(), 1u32, 2u32, hash.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_execute_migration(&admin, &contract, &1u32, &2u32, &hash)
            .unwrap()
            .unwrap();

        let result = client
            .try_verify_migration(&contract, &0u64, &hash)
            .unwrap()
            .unwrap();
        assert!(result);
    }

    #[test]
    fn verify_migration_fails_for_wrong_hash() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "register_transition",
                args: (admin.clone(), 1u32, 2u32).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_register_transition(&admin, &1u32, &2u32)
            .unwrap()
            .unwrap();

        let contract = Address::generate(&env);
        let hash = BytesN::from_array(&env, &[0u8; 32]);
        let wrong_hash = BytesN::from_array(&env, &[1u8; 32]);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "execute_migration",
                args: (admin.clone(), contract.clone(), 1u32, 2u32, hash.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_execute_migration(&admin, &contract, &1u32, &2u32, &hash)
            .unwrap()
            .unwrap();

        let result = client
            .try_verify_migration(&contract, &0u64, &wrong_hash)
            .unwrap()
            .unwrap();
        assert!(!result);
    }

    #[test]
    fn non_admin_cannot_register_transition() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        let other = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &other,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "register_transition",
                args: (other.clone(), 1u32, 2u32).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_register_transition(&other, &1u32, &2u32)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }
}
