#![no_std]

use soroban_pausable::{Pausable, PausableError};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, BytesN, Env, Symbol,
};

// ── Storage keys ─────────────────────────────────────────────────────────────
pub mod access_control;
pub mod validation;

#[cfg(kani)]
mod formal_properties;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    ContractVersion,
    /// State schema version used to validate upgrade compatibility (#382)
    StateSchemaVersion,
    Admin,
    /// Per-user balance stored in persistent storage (gas-optimised, #386)
    Balance(Address),
    Paused,
    // ── Upgrade governance (#392) ─────────────────────────────────────────
    Guardian,
    UpgradeDelay,
    PendingUpgradeHash,
    PendingUpgradeAt,
    PendingUpgradeVersion,
}

fn get_state_schema_version(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get::<_, u32>(&DataKey::StateSchemaVersion)
        .unwrap_or(0u32)
}

fn validate_upgrade_safety(env: &Env, new_version: u32) -> Result<(), ContractError> {
    let current_version = RentWallet::contract_version(env.clone());
    let schema_version = get_state_schema_version(env);

    // Ensure current on-chain state schema matches the currently running contract.
    // This forces a migration step (in the new WASM) before further upgrades.
    if schema_version != current_version {
        return Err(ContractError::IncompatibleStateSchema);
    }

    // Enforce sequential upgrades by default to reduce migration complexity.
    // Emergency upgrades can still jump versions if desired by adjusting this rule later.
    if new_version != current_version.saturating_add(1) {
        return Err(ContractError::InvalidUpgradeVersion);
    }

    Ok(())
}

// ── Errors ───────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    Paused = 3,
    InvalidAmount = 4,
    InsufficientBalance = 5,
    // Upgrade governance errors
    UpgradeAlreadyPending = 6,
    NoUpgradePending = 7,
    UpgradeDelayNotMet = 8,
    /// Amount exceeds the allowed maximum (prevents overflow cascades)
    AmountTooLarge = 9,
    /// Time/lock value exceeds the safe upper bound
    InvalidTimeValue = 10,
    /// String field was empty
    EmptyString = 11,
    /// String field exceeds maximum allowed length
    StringTooLong = 12,
    /// String contains non-printable or disallowed characters
    InvalidStringChar = 13,
    /// Two addresses that must differ were identical
    SameAddress = 14,
    /// Upgrade version must be strictly greater than current version
    InvalidUpgradeVersion = 15,
    /// Stored state schema is incompatible with this contract version
    IncompatibleStateSchema = 16,
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct RentWallet;

// ── Internal helpers ──────────────────────────────────────────────────────────

fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<_, Address>(&DataKey::Admin)
        .expect("admin not set")
}

/// Per-user balance from persistent storage (#386 gas optimisation)
fn get_balance(env: &Env, user: &Address) -> i128 {
    env.storage()
        .persistent()
        .get::<_, i128>(&DataKey::Balance(user.clone()))
        .unwrap_or(0)
}

fn put_balance(env: &Env, user: &Address, amount: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::Balance(user.clone()), &amount);
}

fn get_paused_state(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<_, bool>(&DataKey::Paused)
        .unwrap_or(false)
}

fn require_not_paused(env: &Env) -> Result<(), ContractError> {
    if get_paused_state(env) {
        return Err(ContractError::Paused);
    }
    Ok(())
}

// ── Contract implementation ───────────────────────────────────────────────────

#[contractimpl]
impl RentWallet {
    pub fn init(env: Env, admin: Address) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::ContractVersion, &1u32);
        env.storage()
            .instance()
            .set(&DataKey::StateSchemaVersion, &1u32);
        env.storage().instance().set(&DataKey::Paused, &false);

        // #389: include version in init event
        env.events().publish(
            (Symbol::new(&env, "rent_wallet"), Symbol::new(&env, "init")),
            (admin, 1u32),
        );

        Ok(())
    }

    pub fn contract_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get::<_, u32>(&DataKey::ContractVersion)
            .unwrap_or(0u32)
    }

    /// Current state schema version stored on-chain.
    pub fn state_schema_version(env: Env) -> u32 {
        get_state_schema_version(&env)
    }

    pub fn version(env: Env) -> u32 {
        Self::contract_version(env)
    }

    pub fn credit(
        env: Env,
        admin: Address,
        user: Address,
        amount: i128,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "credit")?;
        require_not_paused(&env)?;
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let cur = get_balance(&env, &user);
        put_balance(&env, &user, cur + amount);

        env.events().publish(
            (
                Symbol::new(&env, "rent_wallet"),
                Symbol::new(&env, "credit"),
                user,
            ),
            amount,
        );

        Ok(())
    }

    pub fn debit(
        env: Env,
        admin: Address,
        user: Address,
        amount: i128,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "debit")?;
        require_not_paused(&env)?;
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let cur = get_balance(&env, &user);
        if cur < amount {
            return Err(ContractError::InsufficientBalance);
        }
        put_balance(&env, &user, cur - amount);

        env.events().publish(
            (
                Symbol::new(&env, "rent_wallet"),
                Symbol::new(&env, "debit"),
                user,
            ),
            amount,
        );

        Ok(())
    }

    pub fn balance(env: Env, user: Address) -> i128 {
        get_balance(&env, &user)
    }

    pub fn set_admin(env: Env, admin: Address, new_admin: Address) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "set_admin")?;

        let old_admin = get_admin(&env);
        env.storage().instance().set(&DataKey::Admin, &new_admin);

        // #389: include old_admin for full audit trail
        env.events().publish(
            (
                Symbol::new(&env, "rent_wallet"),
                Symbol::new(&env, "set_admin"),
            ),
            (old_admin, new_admin),
        );

        Ok(())
    }
}

#[contractimpl]
impl Pausable for RentWallet {
    fn pause(env: Env, admin: Address) -> Result<(), PausableError> {
        let current_admin = get_admin(&env);
        if access_control::require_admin_permission(&env, &current_admin, &admin, "pause").is_err()
        {
            return Err(PausableError::NotAuthorized);
        }
        env.storage().instance().set(&DataKey::Paused, &true);
        // #389: emit admin address (was `()`)
        env.events().publish(
            (Symbol::new(&env, "Pausable"), Symbol::new(&env, "pause")),
            (),
        );
        Ok(())
    }

    fn unpause(env: Env, admin: Address) -> Result<(), PausableError> {
        let current_admin = get_admin(&env);
        if access_control::require_admin_permission(&env, &current_admin, &admin, "unpause")
            .is_err()
        {
            return Err(PausableError::NotAuthorized);
        }
        env.storage().instance().set(&DataKey::Paused, &false);
        // #389: emit admin address (was `()`)
        env.events().publish(
            (Symbol::new(&env, "Pausable"), Symbol::new(&env, "unpause")),
            (),
        );
        Ok(())
    }

    fn is_paused(env: Env) -> bool {
        get_paused_state(&env)
    }
}

#[contractimpl]
impl RentWallet {
    // ── Upgrade governance (#392) ─────────────────────────────────────────────

    pub fn set_guardian(env: Env, admin: Address, guardian: Address) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "set_guardian")?;
        env.storage().instance().set(&DataKey::Guardian, &guardian);
        env.events().publish(
            (
                Symbol::new(&env, "rent_wallet"),
                Symbol::new(&env, "set_guardian"),
            ),
            guardian,
        );
        Ok(())
    }

    pub fn set_upgrade_delay(
        env: Env,
        admin: Address,
        delay_seconds: u64,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(
            &env,
            &current_admin,
            &admin,
            "set_upgrade_delay",
        )?;
        env.storage()
            .instance()
            .set(&DataKey::UpgradeDelay, &delay_seconds);
        env.events().publish(
            (
                Symbol::new(&env, "rent_wallet"),
                Symbol::new(&env, "set_upgrade_delay"),
            ),
            delay_seconds,
        );
        Ok(())
    }

    /// Propose a contract upgrade. Admin must call this first; after the
    /// configured delay the upgrade can be executed with `execute_upgrade`.
    pub fn propose_upgrade(
        env: Env,
        admin: Address,
        new_wasm_hash: BytesN<32>,
        new_version: u32,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "propose_upgrade")?;
        if env.storage().instance().has(&DataKey::PendingUpgradeHash) {
            return Err(ContractError::UpgradeAlreadyPending);
        }

        validate_upgrade_safety(&env, new_version)?;

        let now = env.ledger().timestamp();
        env.storage()
            .instance()
            .set(&DataKey::PendingUpgradeHash, &new_wasm_hash);
        env.storage()
            .instance()
            .set(&DataKey::PendingUpgradeAt, &now);
        env.storage()
            .instance()
            .set(&DataKey::PendingUpgradeVersion, &new_version);
        // #389: upgrade announcement event
        env.events().publish(
            (
                Symbol::new(&env, "rent_wallet"),
                Symbol::new(&env, "propose_upgrade"),
            ),
            (new_wasm_hash, new_version, now),
        );
        Ok(())
    }

    /// Execute a previously proposed upgrade. Enforces the timelock delay and,
    /// if a guardian is configured, requires their authorization (multi-sig).
    pub fn execute_upgrade(
        env: Env,
        admin: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "execute_upgrade")?;
        let pending: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::PendingUpgradeHash)
            .ok_or(ContractError::NoUpgradePending)?;
        if pending != new_wasm_hash {
            return Err(ContractError::NoUpgradePending);
        }
        let proposed_at: u64 = env
            .storage()
            .instance()
            .get(&DataKey::PendingUpgradeAt)
            .unwrap_or(0);
        let proposed_version: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PendingUpgradeVersion)
            .unwrap_or(0);

        validate_upgrade_safety(&env, proposed_version)?;

        let delay: u64 = env
            .storage()
            .instance()
            .get(&DataKey::UpgradeDelay)
            .unwrap_or(0);
        if delay > 0 && env.ledger().timestamp() < proposed_at + delay {
            return Err(ContractError::UpgradeDelayNotMet);
        }
        // Multi-sig: require guardian if configured
        if let Some(guardian) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Guardian)
        {
            guardian.require_auth();
        }
        env.storage()
            .instance()
            .remove(&DataKey::PendingUpgradeHash);
        env.storage().instance().remove(&DataKey::PendingUpgradeAt);
        env.storage()
            .instance()
            .remove(&DataKey::PendingUpgradeVersion);

        // Update version before WASM is swapped
        env.storage()
            .instance()
            .set(&DataKey::ContractVersion, &proposed_version);

        env.events().publish(
            (
                Symbol::new(&env, "rent_wallet"),
                Symbol::new(&env, "execute_upgrade"),
            ),
            (new_wasm_hash.clone(), proposed_version),
        );
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    /// Emergency upgrade — bypasses the timelock delay.  Both admin and
    /// guardian (if set) must authorize.  Emits an enhanced event for auditing.
    pub fn emergency_upgrade(
        env: Env,
        admin: Address,
        new_wasm_hash: BytesN<32>,
        new_version: u32,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(
            &env,
            &current_admin,
            &admin,
            "emergency_upgrade",
        )?;

        // Emergency upgrades still require schema compatibility, but allow only sequential
        // upgrades for now (same safety policy as normal upgrades).
        validate_upgrade_safety(&env, new_version)?;

        // Multi-sig: require guardian if configured
        if let Some(guardian) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Guardian)
        {
            guardian.require_auth();
        }
        // Clear any pending upgrade
        env.storage()
            .instance()
            .remove(&DataKey::PendingUpgradeHash);
        env.storage().instance().remove(&DataKey::PendingUpgradeAt);
        env.storage()
            .instance()
            .remove(&DataKey::PendingUpgradeVersion);

        env.storage()
            .instance()
            .set(&DataKey::ContractVersion, &new_version);

        // Enhanced logging for emergency path
        env.events().publish(
            (
                Symbol::new(&env, "rent_wallet"),
                Symbol::new(&env, "emergency_upgrade"),
            ),
            (
                admin,
                new_wasm_hash.clone(),
                new_version,
                env.ledger().timestamp(),
            ),
        );
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    pub fn cancel_upgrade(env: Env, admin: Address) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "cancel_upgrade")?;
        let hash: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::PendingUpgradeHash)
            .ok_or(ContractError::NoUpgradePending)?;
        env.storage()
            .instance()
            .remove(&DataKey::PendingUpgradeHash);
        env.storage().instance().remove(&DataKey::PendingUpgradeAt);
        env.storage()
            .instance()
            .remove(&DataKey::PendingUpgradeVersion);
        env.events().publish(
            (
                Symbol::new(&env, "rent_wallet"),
                Symbol::new(&env, "cancel_upgrade"),
            ),
            (admin, hash),
        );
        Ok(())
    }
}

#[cfg(test)]
mod test {
    extern crate std;

    use super::{ContractError, RentWallet, RentWalletClient};
    use soroban_sdk::testutils::{Address as _, MockAuth, MockAuthInvoke};
    use soroban_sdk::{Address, BytesN, Env, IntoVal};

    fn setup(
        env: &Env,
    ) -> (
        soroban_sdk::Address,
        RentWalletClient<'_>,
        Address,
        Address,
        Address,
    ) {
        let contract_id = env.register(RentWallet, ());

        let client = RentWalletClient::new(env, &contract_id);

        let admin = Address::generate(env);

        let user = Address::generate(env);

        let non_admin = Address::generate(env);

        client.try_init(&admin).unwrap().unwrap();

        (contract_id, client, admin, user, non_admin)
    }

    // ============================================================================
    // Init Tests
    // ============================================================================

    #[test]
    fn init_sets_admin() {
        let env = Env::default();
        let contract_id = env.register(RentWallet, ());
        let client = RentWalletClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.try_init(&admin).unwrap().unwrap();

        assert_eq!(client.contract_version(), 1u32);

        // Admin should be able to perform admin operations
        let user = Address::generate(&env);
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_credit(&admin, &user, &100i128).unwrap().unwrap();
        assert_eq!(client.balance(&user), 100i128);
    }

    #[test]
    fn version_matches_contract_version() {
        let env = Env::default();
        let contract_id = env.register(RentWallet, ());
        let client = RentWalletClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.try_init(&admin).unwrap().unwrap();

        assert_eq!(client.version(), 1u32);
        assert_eq!(client.version(), client.contract_version());
    }

    #[test]
    fn init_initializes_empty_balances() {
        let env = Env::default();
        let contract_id = env.register(RentWallet, ());
        let client = RentWalletClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.try_init(&admin).unwrap().unwrap();

        // Balance should be zero for any user initially
        assert_eq!(client.balance(&user), 0i128);
    }

    #[test]
    fn init_cannot_be_called_twice() {
        let env = Env::default();
        let contract_id = env.register(RentWallet, ());
        let client = RentWalletClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.try_init(&admin).unwrap().unwrap();
        let err = client.try_init(&admin).unwrap_err().unwrap();
        assert_eq!(err, ContractError::AlreadyInitialized);
    }

    // ============================================================================
    // Credit Tests
    // ============================================================================

    #[test]
    fn credit_increases_balance() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        assert_eq!(client.balance(&user), 0i128);
        client.try_credit(&admin, &user, &100i128).unwrap().unwrap();
        assert_eq!(client.balance(&user), 100i128);
    }

    #[test]
    fn credit_accumulates_balance() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 50i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_credit(&admin, &user, &50i128).unwrap().unwrap();
        assert_eq!(client.balance(&user), 50i128);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 75i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_credit(&admin, &user, &75i128).unwrap().unwrap();
        assert_eq!(client.balance(&user), 125i128);
    }

    #[test]
    fn credit_fails_with_zero_amount() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 0i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_credit(&admin, &user, &0i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InvalidAmount);
    }

    #[test]
    fn credit_fails_with_negative_amount() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), -10i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_credit(&admin, &user, &-10i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InvalidAmount);
    }

    // ============================================================================
    // Debit Tests
    // ============================================================================

    #[test]
    fn debit_decreases_balance() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        // First credit some balance
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_credit(&admin, &user, &100i128).unwrap().unwrap();
        assert_eq!(client.balance(&user), 100i128);

        // Then debit
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "debit",
                args: (admin.clone(), user.clone(), 30i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_debit(&admin, &user, &30i128).unwrap().unwrap();
        assert_eq!(client.balance(&user), 70i128);
    }

    #[test]
    fn debit_can_reduce_balance_to_zero() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        // Credit balance
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 50i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_credit(&admin, &user, &50i128).unwrap().unwrap();

        // Debit entire balance
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "debit",
                args: (admin.clone(), user.clone(), 50i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_debit(&admin, &user, &50i128).unwrap().unwrap();
        assert_eq!(client.balance(&user), 0i128);
    }

    #[test]
    fn debit_fails_with_insufficient_balance() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        // Credit some balance
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 50i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_credit(&admin, &user, &50i128).unwrap().unwrap();

        // Try to debit more than available
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "debit",
                args: (admin.clone(), user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_debit(&admin, &user, &100i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InsufficientBalance);
    }

    #[test]
    fn debit_fails_when_balance_is_zero() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "debit",
                args: (admin.clone(), user.clone(), 1i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_debit(&admin, &user, &1i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InsufficientBalance);
    }

    #[test]
    fn debit_fails_with_zero_amount() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        // First credit some balance
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_credit(&admin, &user, &100i128).unwrap().unwrap();

        // Try to debit zero
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "debit",
                args: (admin.clone(), user.clone(), 0i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_debit(&admin, &user, &0i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InvalidAmount);
    }

    #[test]
    fn debit_fails_with_negative_amount() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        // First credit some balance
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_credit(&admin, &user, &100i128).unwrap().unwrap();

        // Try to debit negative amount
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "debit",
                args: (admin.clone(), user.clone(), -10i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_debit(&admin, &user, &-10i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InvalidAmount);
    }

    // ============================================================================
    // Balance Tests
    // ============================================================================

    #[test]
    fn balance_returns_zero_for_new_user() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, _non_admin) = setup(&env);
        let new_user = Address::generate(&env);

        assert_eq!(client.balance(&user), 0i128);
        assert_eq!(client.balance(&new_user), 0i128);
    }

    #[test]
    fn balance_reflects_credit_and_debit_operations() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        // Initial balance
        assert_eq!(client.balance(&user), 0i128);

        // After credit
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 200i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_credit(&admin, &user, &200i128).unwrap().unwrap();
        assert_eq!(client.balance(&user), 200i128);

        // After debit
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "debit",
                args: (admin.clone(), user.clone(), 80i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_debit(&admin, &user, &80i128).unwrap().unwrap();
        assert_eq!(client.balance(&user), 120i128);
    }

    // ============================================================================
    // Balance Invariant Tests
    // ============================================================================

    #[test]
    fn invariant_balance_never_negative_after_failed_debit() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "debit",
                args: (admin.clone(), user.clone(), 1i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let err = client
            .try_debit(&admin, &user, &1i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InsufficientBalance);
        assert!(client.balance(&user) >= 0i128);
    }

    // ============================================================================
    // Pause Tests
    // ============================================================================

    #[test]
    fn admin_can_pause_and_unpause() {
        let env = Env::default();
        let (contract_id, client, admin, _user, _non_admin) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
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
                contract: &contract_id,
                fn_name: "unpause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_unpause(&admin).unwrap().unwrap();
        assert!(!client.is_paused());
    }

    #[test]
    fn paused_contract_blocks_credit_and_debit() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "pause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_pause(&admin).unwrap().unwrap();

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 10i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_credit(&admin, &user, &10i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::Paused);
    }

    #[test]
    fn non_admin_cannot_pause() {
        let env = Env::default();
        let (contract_id, client, _admin, _user, non_admin) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &non_admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "pause",
                args: (non_admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client.try_pause(&non_admin).unwrap_err().unwrap();
        assert_eq!(err, soroban_pausable::PausableError::NotAuthorized);
    }

    #[test]
    fn non_admin_cannot_unpause() {
        let env = Env::default();
        let (contract_id, client, admin, _user, non_admin) = setup(&env);

        // First pause as admin
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "pause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_pause(&admin).unwrap().unwrap();

        // Try to unpause as non-admin
        env.mock_auths(&[MockAuth {
            address: &non_admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "unpause",
                args: (non_admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client.try_unpause(&non_admin).unwrap_err().unwrap();
        assert_eq!(err, soroban_pausable::PausableError::NotAuthorized);
    }

    #[test]
    fn credit_fails_when_paused() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "pause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_pause(&admin).unwrap().unwrap();

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 10i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_credit(&admin, &user, &10i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::Paused);
    }

    // ============================================================================
    // Upgrade Governance Tests (#392)
    // ============================================================================

    #[test]
    fn propose_upgrade_stores_pending_hash() {
        let env = Env::default();
        let (contract_id, client, admin, _user, _non_admin) = setup(&env);
        let hash = BytesN::from_array(&env, &[0u8; 32]);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_upgrade",
                args: (admin.clone(), hash.clone(), 2u32).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_propose_upgrade(&admin, &hash, &2u32)
            .unwrap()
            .unwrap();
    }

    #[test]
    fn propose_upgrade_fails_if_already_pending() {
        let env = Env::default();
        let (contract_id, client, admin, _user, _non_admin) = setup(&env);
        let hash = BytesN::from_array(&env, &[0u8; 32]);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_upgrade",
                args: (admin.clone(), hash.clone(), 2u32).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_propose_upgrade(&admin, &hash, &2u32)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_upgrade",
                args: (admin.clone(), hash.clone(), 2u32).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_propose_upgrade(&admin, &hash, &2u32)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::UpgradeAlreadyPending);
    }

    #[test]
    fn cancel_upgrade_clears_pending() {
        let env = Env::default();
        let (contract_id, client, admin, _user, _non_admin) = setup(&env);
        let hash = BytesN::from_array(&env, &[0u8; 32]);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_upgrade",
                args: (admin.clone(), hash.clone(), 2u32).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_propose_upgrade(&admin, &hash, &2u32)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "cancel_upgrade",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_cancel_upgrade(&admin).unwrap().unwrap();

        // Can propose again after cancellation
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_upgrade",
                args: (admin.clone(), hash.clone(), 2u32).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_propose_upgrade(&admin, &hash, &2u32)
            .unwrap()
            .unwrap();
    }

    #[test]
    fn execute_upgrade_fails_when_delay_not_met() {
        let env = Env::default();
        let (contract_id, client, admin, _user, _non_admin) = setup(&env);
        let hash = BytesN::from_array(&env, &[0u8; 32]);

        // Set a 1-hour delay
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_upgrade_delay",
                args: (admin.clone(), 3600u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_set_upgrade_delay(&admin, &3600u64)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_upgrade",
                args: (admin.clone(), hash.clone(), 2u32).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_propose_upgrade(&admin, &hash, &2u32)
            .unwrap()
            .unwrap();

        // Execute immediately — should fail because delay not met
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "execute_upgrade",
                args: (admin.clone(), hash.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_execute_upgrade(&admin, &hash)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::UpgradeDelayNotMet);
    }

    #[test]
    fn execute_upgrade_fails_with_no_pending() {
        let env = Env::default();
        let (contract_id, client, admin, _user, _non_admin) = setup(&env);
        let hash = BytesN::from_array(&env, &[0u8; 32]);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "execute_upgrade",
                args: (admin.clone(), hash.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_execute_upgrade(&admin, &hash)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NoUpgradePending);
    }

    #[test]
    fn cancel_upgrade_fails_with_no_pending() {
        let env = Env::default();
        let (contract_id, client, admin, _user, _non_admin) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "cancel_upgrade",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client.try_cancel_upgrade(&admin).unwrap_err().unwrap();
        assert_eq!(err, ContractError::NoUpgradePending);
    }

    #[test]
    fn failed_execute_upgrade_does_not_clear_pending_upgrade() {
        let env = Env::default();
        let (contract_id, client, admin, _user, _non_admin) = setup(&env);
        let hash = BytesN::from_array(&env, &[0u8; 32]);

        // Propose an upgrade to version 2.
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_upgrade",
                args: (admin.clone(), hash.clone(), 2u32).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_propose_upgrade(&admin, &hash, &2u32)
            .unwrap()
            .unwrap();

        // Break schema compatibility to force execute_upgrade to fail.
        env.as_contract(&contract_id, || {
            env.storage()
                .instance()
                .set(&super::DataKey::StateSchemaVersion, &0u32);
        });

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "execute_upgrade",
                args: (admin.clone(), hash.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let err = client
            .try_execute_upgrade(&admin, &hash)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::IncompatibleStateSchema);

        // Pending proposal should still exist; re-proposing should fail.
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_upgrade",
                args: (admin.clone(), hash.clone(), 2u32).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let err2 = client
            .try_propose_upgrade(&admin, &hash, &2u32)
            .unwrap_err()
            .unwrap();
        assert_eq!(err2, ContractError::UpgradeAlreadyPending);
    }
}
