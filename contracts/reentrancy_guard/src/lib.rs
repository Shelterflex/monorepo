#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, BytesN, Env, Symbol,
};

pub mod access_control;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    GuardActive(Address),
    CallDepth(Address, BytesN<32>),
    MaxCallDepth,
    AllowedPattern(BytesN<32>),
    ContractVersion,
    Locked(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CallDepthInfo {
    pub depth: u32,
    pub entry_point: BytesN<32>,
    pub caller: Address,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    ReentrancyDetected = 3,
    MaxDepthExceeded = 4,
    InvalidEntryPoint = 5,
    PatternAlreadyAllowed = 6,
    PatternNotAllowed = 7,
    GuardNotActive = 8,
    InvalidMaxDepth = 9,
}

impl From<access_control::AccessControlError> for ContractError {
    fn from(_err: access_control::AccessControlError) -> Self {
        ContractError::NotAuthorized
    }
}

#[contract]
pub struct ReentrancyGuard;

fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("admin not set")
}

fn get_contract_version(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::ContractVersion)
        .unwrap_or(1u32)
}

fn get_max_call_depth(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::MaxCallDepth)
        .unwrap_or(5u32)
}

fn is_guard_active(env: &Env, contract: &Address) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::GuardActive(contract.clone()))
        .unwrap_or(false)
}

fn is_pattern_allowed(env: &Env, pattern_hash: &BytesN<32>) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::AllowedPattern(pattern_hash.clone()))
        .unwrap_or(false)
}

fn get_call_depth(env: &Env, contract: &Address, entry_point: &BytesN<32>) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::CallDepth(contract.clone(), entry_point.clone()))
        .unwrap_or(0u32)
}

fn set_call_depth(env: &Env, contract: &Address, entry_point: &BytesN<32>, depth: u32) {
    env.storage().instance().set(
        &DataKey::CallDepth(contract.clone(), entry_point.clone()),
        &depth,
    );
}

fn is_locked(env: &Env, contract: &Address) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Locked(contract.clone()))
        .unwrap_or(false)
}

fn set_locked(env: &Env, contract: &Address, locked: bool) {
    env.storage()
        .instance()
        .set(&DataKey::Locked(contract.clone()), &locked);
}

#[contractimpl]
impl ReentrancyGuard {
    pub fn init(env: Env, admin: Address) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::ContractVersion, &1u32);
        env.storage().instance().set(&DataKey::MaxCallDepth, &5u32);

        env.events().publish(
            (
                Symbol::new(&env, "reentrancy_guard"),
                Symbol::new(&env, "init"),
            ),
            admin,
        );

        Ok(())
    }

    pub fn contract_version(env: Env) -> u32 {
        get_contract_version(&env)
    }

    pub fn set_admin(env: Env, admin: Address, new_admin: Address) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "set_admin")?;

        env.storage().instance().set(&DataKey::Admin, &new_admin);

        env.events().publish(
            (
                Symbol::new(&env, "reentrancy_guard"),
                Symbol::new(&env, "set_admin"),
            ),
            (admin, new_admin),
        );
        Ok(())
    }

    pub fn set_max_call_depth(
        env: Env,
        admin: Address,
        max_depth: u32,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(
            &env,
            &current_admin,
            &admin,
            "set_max_call_depth",
        )?;

        if max_depth == 0 || max_depth > 20 {
            return Err(ContractError::InvalidMaxDepth);
        }

        env.storage()
            .instance()
            .set(&DataKey::MaxCallDepth, &max_depth);

        env.events().publish(
            (
                Symbol::new(&env, "reentrancy_guard"),
                Symbol::new(&env, "set_max_call_depth"),
            ),
            max_depth,
        );

        Ok(())
    }

    pub fn activate_guard(
        env: Env,
        admin: Address,
        contract: Address,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "activate_guard")?;

        env.storage()
            .instance()
            .set(&DataKey::GuardActive(contract.clone()), &true);

        env.events().publish(
            (
                Symbol::new(&env, "reentrancy_guard"),
                Symbol::new(&env, "guard_activated"),
            ),
            contract,
        );

        Ok(())
    }

    pub fn deactivate_guard(
        env: Env,
        admin: Address,
        contract: Address,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "deactivate_guard")?;

        env.storage()
            .instance()
            .set(&DataKey::GuardActive(contract.clone()), &false);

        env.events().publish(
            (
                Symbol::new(&env, "reentrancy_guard"),
                Symbol::new(&env, "guard_deactivated"),
            ),
            contract,
        );

        Ok(())
    }

    pub fn allow_pattern(
        env: Env,
        admin: Address,
        pattern_hash: BytesN<32>,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "allow_pattern")?;

        if is_pattern_allowed(&env, &pattern_hash) {
            return Err(ContractError::PatternAlreadyAllowed);
        }

        env.storage()
            .instance()
            .set(&DataKey::AllowedPattern(pattern_hash.clone()), &true);

        env.events().publish(
            (
                Symbol::new(&env, "reentrancy_guard"),
                Symbol::new(&env, "pattern_allowed"),
            ),
            pattern_hash,
        );

        Ok(())
    }

    pub fn disallow_pattern(
        env: Env,
        admin: Address,
        pattern_hash: BytesN<32>,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "disallow_pattern")?;

        env.storage()
            .instance()
            .set(&DataKey::AllowedPattern(pattern_hash.clone()), &false);

        env.events().publish(
            (
                Symbol::new(&env, "reentrancy_guard"),
                Symbol::new(&env, "pattern_disallowed"),
            ),
            pattern_hash,
        );

        Ok(())
    }

    pub fn enter(
        env: Env,
        contract: Address,
        entry_point: BytesN<32>,
    ) -> Result<(), ContractError> {
        if !is_guard_active(&env, &contract) {
            return Err(ContractError::GuardNotActive);
        }

        if is_locked(&env, &contract) {
            return Err(ContractError::ReentrancyDetected);
        }

        if is_pattern_allowed(&env, &entry_point) {
            return Ok(());
        }

        let depth = get_call_depth(&env, &contract, &entry_point);
        let max_depth = get_max_call_depth(&env);

        if depth >= max_depth {
            env.events().publish(
                (
                    Symbol::new(&env, "reentrancy_guard"),
                    Symbol::new(&env, "max_depth_exceeded"),
                    contract.clone(),
                ),
                (entry_point.clone(), depth, max_depth),
            );
            return Err(ContractError::MaxDepthExceeded);
        }

        set_locked(&env, &contract, true);
        set_call_depth(&env, &contract, &entry_point, depth + 1);

        env.events().publish(
            (
                Symbol::new(&env, "reentrancy_guard"),
                Symbol::new(&env, "entered"),
                contract.clone(),
            ),
            (entry_point.clone(), depth + 1),
        );

        Ok(())
    }

    pub fn exit(env: Env, contract: Address, entry_point: BytesN<32>) -> Result<(), ContractError> {
        if !is_guard_active(&env, &contract) {
            return Err(ContractError::GuardNotActive);
        }

        if is_pattern_allowed(&env, &entry_point) {
            return Ok(());
        }

        let depth = get_call_depth(&env, &contract, &entry_point);
        if depth > 0 {
            set_call_depth(&env, &contract, &entry_point, depth - 1);
        }

        if depth <= 1 {
            set_locked(&env, &contract, false);
        }

        env.events().publish(
            (
                Symbol::new(&env, "reentrancy_guard"),
                Symbol::new(&env, "exited"),
                contract.clone(),
            ),
            (entry_point.clone(), depth.saturating_sub(1)),
        );

        Ok(())
    }

    pub fn check_reentrancy(env: Env, contract: Address) -> bool {
        is_locked(&env, &contract)
    }

    pub fn get_call_depth(env: Env, contract: Address, entry_point: BytesN<32>) -> u32 {
        get_call_depth(&env, &contract, &entry_point)
    }

    pub fn is_guard_active(env: Env, contract: Address) -> bool {
        is_guard_active(&env, &contract)
    }

    pub fn is_pattern_allowed(env: Env, pattern_hash: BytesN<32>) -> bool {
        is_pattern_allowed(&env, &pattern_hash)
    }

    pub fn get_max_call_depth(env: Env) -> u32 {
        get_max_call_depth(&env)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{BytesN, Env};

    fn setup_contract(env: &Env) -> (ReentrancyGuardClient<'_>, Address) {
        let contract_id = env.register(ReentrancyGuard, ());
        let client = ReentrancyGuardClient::new(env, &contract_id);

        let admin = Address::generate(env);

        // Initialize with mock_all_auths
        env.mock_all_auths();

        client.try_init(&admin).unwrap().unwrap();

        (client, admin)
    }

    fn create_entry_point(env: &Env, name: &str) -> BytesN<32> {
        let mut bytes = [0u8; 32];
        let name_bytes = name.as_bytes();
        let len = name_bytes.len().min(32);
        bytes[..len].copy_from_slice(&name_bytes[..len]);
        BytesN::from_array(env, &bytes)
    }

    #[test]
    fn init_succeeds() {
        let env = Env::default();
        let (client, _admin) = setup_contract(&env);

        assert_eq!(client.contract_version(), 1u32);
        assert_eq!(client.get_max_call_depth(), 5u32);
    }

    #[test]
    fn activate_guard_succeeds() {
        let env = Env::default();
        let (client, admin) = setup_contract(&env);

        let guarded_contract = Address::generate(&env);

        client
            .try_activate_guard(&admin, &guarded_contract)
            .unwrap()
            .unwrap();

        assert!(client.is_guard_active(&guarded_contract));
    }

    #[test]
    fn guard_not_active_error() {
        let env = Env::default();
        let (client, _admin) = setup_contract(&env);

        let guarded_contract = Address::generate(&env);
        let entry_point = create_entry_point(&env, "transfer");

        let err = client
            .try_enter(&guarded_contract, &entry_point)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::GuardNotActive);
    }
}
