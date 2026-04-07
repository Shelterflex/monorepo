#![no_std]

extern crate alloc;

use soroban_pausable::{Pausable, PausableError};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token::Client as TokenClient, Address,
    BytesN, Env, String, Symbol,
};

// ── Storage keys ─────────────────────────────────────────────────────────────
pub mod access_control;
pub mod validation;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    ContractVersion,
    Admin,
    Operator,
    Token,
    ReceiptContract,
    Paused,
    /// Per-deal balance in persistent storage (#386 gas optimisation)
    DealBalance(String),
    /// Reentrancy lock (#390)
    Reentrancy,
    // ── Upgrade governance (#392) ─────────────────────────────────────────
    Guardian,
    UpgradeDelay,
    PendingUpgradeHash,
    PendingUpgradeAt,
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
    EmptyString = 10,
    // Cross-contract communication errors (#390)
    /// Reentrancy detected
    ReentrancyDetected = 6,
    // Upgrade governance errors (#392)
    UpgradeAlreadyPending = 7,
    NoUpgradePending = 8,
    UpgradeDelayNotMet = 9,
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct DealEscrow;

// ── Internal helpers ──────────────────────────────────────────────────────────

fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<_, Address>(&DataKey::Admin)
        .expect("admin not set")
}

fn get_operator(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<_, Address>(&DataKey::Operator)
        .expect("operator not set")
}

fn get_token(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<_, Address>(&DataKey::Token)
        .expect("token not set")
}

fn get_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<_, bool>(&DataKey::Paused)
        .unwrap_or(false)
}

fn require_not_paused(env: &Env) -> Result<(), ContractError> {
    if get_paused(env) {
        return Err(ContractError::Paused);
    }
    Ok(())
}

/// Per-deal balance from persistent storage (#386)
fn get_deal_balance(env: &Env, deal_id: &String) -> i128 {
    env.storage()
        .persistent()
        .get::<_, i128>(&DataKey::DealBalance(deal_id.clone()))
        .unwrap_or(0)
}

fn put_deal_balance(env: &Env, deal_id: &String, amount: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::DealBalance(deal_id.clone()), &amount);
}

/// Reentrancy guard (#390)
fn enter_nonreentrant(env: &Env) -> Result<(), ContractError> {
    if env
        .storage()
        .instance()
        .get::<_, bool>(&DataKey::Reentrancy)
        .unwrap_or(false)
    {
        return Err(ContractError::ReentrancyDetected);
    }
    env.storage().instance().set(&DataKey::Reentrancy, &true);
    Ok(())
}

fn exit_nonreentrant(env: &Env) {
    env.storage().instance().set(&DataKey::Reentrancy, &false);
}

fn generate_tx_id(env: &Env, external_ref_source: &Symbol, external_ref: &String) -> BytesN<32> {
    use alloc::string::ToString;
    use soroban_sdk::Bytes;
    let source_str = external_ref_source.to_string();
    let source_trimmed = source_str.trim();
    let source_lower = {
        let mut s = alloc::string::String::new();
        for c in source_trimmed.chars() {
            for lower in c.to_lowercase() {
                s.push(lower);
            }
        }
        s
    };
    let ref_str = external_ref.to_string();
    let ref_trimmed = ref_str.trim();
    let canonical = {
        use alloc::format;
        format!("v1|source={}|ref={}", source_lower, ref_trimmed)
    };
    let canonical_bytes = Bytes::from_slice(env, canonical.as_bytes());
    let hash = env.crypto().sha256(&canonical_bytes);
    hash.into()
}

// ── Contract implementation ───────────────────────────────────────────────────

#[contractimpl]
impl DealEscrow {
    pub fn init(
        env: Env,
        admin: Address,
        operator: Address,
        token: Address,
        receipt_contract: Address,
    ) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Operator, &operator);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage()
            .instance()
            .set(&DataKey::ContractVersion, &1u32);
        env.storage()
            .instance()
            .set(&DataKey::ReceiptContract, &receipt_contract);
        env.storage().instance().set(&DataKey::Paused, &false);
        // #389: consistent init event with version
        env.events().publish(
            (Symbol::new(&env, "deal_escrow"), Symbol::new(&env, "init")),
            (admin, operator, token, receipt_contract, 1u32),
        );
        Ok(())
    }

    pub fn contract_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get::<_, u32>(&DataKey::ContractVersion)
            .unwrap_or(0u32)
    }

    pub fn deposit(
        env: Env,
        from: Address,
        deal_id: String,
        amount: i128,
    ) -> Result<(), ContractError> {
        require_not_paused(&env)?;
        validation::require_valid_amount(amount)?;
        validation::require_non_empty_string(&env, &deal_id)?;
        from.require_auth();
        let token_addr = get_token(&env);
        let token_client = TokenClient::new(&env, &token_addr);

        // #390: reentrancy guard before external token call
        enter_nonreentrant(&env)?;
        token_client.transfer(&from, &env.current_contract_address(), &amount);
        exit_nonreentrant(&env);

        // #386: per-key persistent storage
        let cur = get_deal_balance(&env, &deal_id);
        put_deal_balance(&env, &deal_id, cur + amount);

        env.events().publish(
            (
                Symbol::new(&env, "deal_escrow"),
                Symbol::new(&env, "deposit"),
            ),
            (deal_id, from, amount),
        );
        Ok(())
    }

    pub fn release(
        env: Env,
        caller: Address,
        deal_id: String,
        to: Address,
        external_ref_source: Symbol,
        external_ref: String,
    ) -> Result<i128, ContractError> {
        require_not_paused(&env)?;
        validation::require_non_empty_string(&env, &deal_id)?;
        validation::require_non_empty_string(&env, &external_ref)?;
        let admin = get_admin(&env);
        let operator = get_operator(&env);
        access_control::require_admin_or_operator_permission(
            &env, &admin, &operator, &caller, "release",
        )?;

        // #386: per-key persistent storage
        let cur = get_deal_balance(&env, &deal_id);
        if cur <= 0 {
            return Err(ContractError::InsufficientBalance);
        }
        let token_addr = get_token(&env);
        let token_client = TokenClient::new(&env, &token_addr);

        put_deal_balance(&env, &deal_id, 0);

        let tx_id = generate_tx_id(&env, &external_ref_source, &external_ref);

        // #390: reentrancy guard before external token call
        enter_nonreentrant(&env)?;
        token_client.transfer(&env.current_contract_address(), &to, &cur);
        exit_nonreentrant(&env);

        env.events().publish(
            (
                Symbol::new(&env, "deal_escrow"),
                Symbol::new(&env, "release"),
            ),
            (deal_id, to, cur, external_ref_source, tx_id),
        );
        Ok(cur)
    }

    pub fn balance(env: Env, deal_id: String) -> i128 {
        get_deal_balance(&env, &deal_id)
    }
}

#[contractimpl]
impl Pausable for DealEscrow {
    fn pause(env: Env, _admin: Address) -> Result<(), PausableError> {
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        if access_control::require_admin_permission(&env, &stored, &_admin, "pause").is_err() {
            return Err(PausableError::NotAuthorized);
        }
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish(
            (Symbol::new(&env, "Pausable"), Symbol::new(&env, "pause")),
            (),
        );
        Ok(())
    }

    fn unpause(env: Env, _admin: Address) -> Result<(), PausableError> {
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        if access_control::require_admin_permission(&env, &stored, &_admin, "unpause").is_err() {
            return Err(PausableError::NotAuthorized);
        }
        env.storage().instance().set(&DataKey::Paused, &false);
        // #389: emit admin address (was `()`)
        env.events().publish(
            (
                Symbol::new(&env, "deal_escrow"),
                Symbol::new(&env, "unpause"),
            ),
            _admin,
        );
        Ok(())
    }

    fn is_paused(env: Env) -> bool {
        get_paused(&env)
    }
}

#[contractimpl]
impl DealEscrow {
    pub fn set_guardian(env: Env, admin: Address, guardian: Address) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "set_guardian")?;
        env.storage().instance().set(&DataKey::Guardian, &guardian);
        env.events().publish(
            (
                Symbol::new(&env, "deal_escrow"),
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
                Symbol::new(&env, "deal_escrow"),
                Symbol::new(&env, "set_upgrade_delay"),
            ),
            delay_seconds,
        );
        Ok(())
    }

    pub fn propose_upgrade(
        env: Env,
        admin: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "propose_upgrade")?;
        if env.storage().instance().has(&DataKey::PendingUpgradeHash) {
            return Err(ContractError::UpgradeAlreadyPending);
        }
        let now = env.ledger().timestamp();
        env.storage()
            .instance()
            .set(&DataKey::PendingUpgradeHash, &new_wasm_hash);
        env.storage()
            .instance()
            .set(&DataKey::PendingUpgradeAt, &now);
        env.events().publish(
            (
                Symbol::new(&env, "deal_escrow"),
                Symbol::new(&env, "propose_upgrade"),
            ),
            (new_wasm_hash, now),
        );
        Ok(())
    }

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
        let delay: u64 = env
            .storage()
            .instance()
            .get(&DataKey::UpgradeDelay)
            .unwrap_or(0);
        if delay > 0 && env.ledger().timestamp() < proposed_at + delay {
            return Err(ContractError::UpgradeDelayNotMet);
        }
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
        env.events().publish(
            (
                Symbol::new(&env, "deal_escrow"),
                Symbol::new(&env, "execute_upgrade"),
            ),
            new_wasm_hash.clone(),
        );
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    pub fn emergency_upgrade(
        env: Env,
        admin: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(
            &env,
            &current_admin,
            &admin,
            "emergency_upgrade",
        )?;
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
        env.events().publish(
            (
                Symbol::new(&env, "deal_escrow"),
                Symbol::new(&env, "emergency_upgrade"),
            ),
            (admin, new_wasm_hash.clone(), env.ledger().timestamp()),
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
        env.events().publish(
            (
                Symbol::new(&env, "deal_escrow"),
                Symbol::new(&env, "cancel_upgrade"),
            ),
            (admin, hash),
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
mod test {
    extern crate std;
    use super::{ContractError, DealEscrow, DealEscrowClient, TokenClient};
    use soroban_sdk::testutils::{Address as _, MockAuth, MockAuthInvoke};
    use soroban_sdk::token::StellarAssetClient;
    use soroban_sdk::{Address, BytesN, Env, IntoVal, String, Symbol};

    #[test]
    fn init_sets_version_to_one() {
        let env = Env::default();
        let contract_id = env.register(DealEscrow, ());
        let client = DealEscrowClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let operator = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_id = token_contract.address();
        let receipt = Address::generate(&env);
        client
            .try_init(&admin, &operator, &token_id, &receipt)
            .unwrap()
            .unwrap();
        assert_eq!(client.contract_version(), 1u32);
    }

    #[test]
    fn init_cannot_be_called_twice() {
        let env = Env::default();
        let contract_id = env.register(DealEscrow, ());
        let client = DealEscrowClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let operator = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_id = token_contract.address();
        let receipt = Address::generate(&env);
        client
            .try_init(&admin, &operator, &token_id, &receipt)
            .unwrap()
            .unwrap();
        let err = client
            .try_init(&admin, &operator, &token_id, &receipt)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::AlreadyInitialized);
    }

    fn setup(
        env: &Env,
    ) -> (
        Address,
        DealEscrowClient<'_>,
        Address,
        Address,
        Address,
        Address,
        Address,
    ) {
        let contract_id = env.register(DealEscrow, ());
        let client = DealEscrowClient::new(env, &contract_id);
        let admin = Address::generate(env);
        let operator = Address::generate(env);
        let token_admin = Address::generate(env);
        let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_contract_id = token_contract.address();
        let receipt_contract = Address::generate(env);
        client
            .try_init(&admin, &operator, &token_contract_id, &receipt_contract)
            .unwrap()
            .unwrap();
        (
            contract_id,
            client,
            admin,
            operator,
            token_contract_id,
            token_admin,
            receipt_contract,
        )
    }

    #[test]
    fn deposit_transfers_tokens_in_and_updates_balance() {
        let env = Env::default();
        let (contract_id, client, _admin, _operator, token, token_admin, _rcpt) = setup(&env);
        let from = Address::generate(&env);
        let token_client = TokenClient::new(&env, &token);
        let token_sac = StellarAssetClient::new(&env, &token);
        let deal_id = String::from_str(&env, "deal-1");
        env.mock_auths(&[MockAuth {
            address: &token_admin,
            invoke: &MockAuthInvoke {
                contract: &token,
                fn_name: "mint",
                args: (from.clone(), 500i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        token_sac.mint(&from, &500i128);
        assert_eq!(token_client.balance(&from), 500i128);
        env.mock_auths(&[MockAuth {
            address: &from,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "deposit",
                args: (from.clone(), deal_id.clone(), 200i128).into_val(&env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &token,
                    fn_name: "transfer",
                    args: (from.clone(), contract_id.clone(), 200i128).into_val(&env),
                    sub_invokes: &[],
                }],
            },
        }]);
        client
            .try_deposit(&from, &deal_id, &200i128)
            .unwrap()
            .unwrap();
        let contract_addr = contract_id.clone();
        assert_eq!(token_client.balance(&contract_addr), 200i128);
        assert_eq!(token_client.balance(&from), 300i128);
        assert_eq!(client.balance(&deal_id), 200i128);
    }

    #[test]
    fn release_transfers_out_full_balance_and_cannot_exceed() {
        let env = Env::default();
        let (contract_id, client, admin, operator, token, token_admin, _rcpt) = setup(&env);
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let token_client = TokenClient::new(&env, &token);
        let token_sac = StellarAssetClient::new(&env, &token);
        let deal_id = String::from_str(&env, "deal-2");
        env.mock_auths(&[MockAuth {
            address: &token_admin,
            invoke: &MockAuthInvoke {
                contract: &token,
                fn_name: "mint",
                args: (from.clone(), 300i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        token_sac.mint(&from, &300i128);
        env.mock_auths(&[MockAuth {
            address: &from,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "deposit",
                args: (from.clone(), deal_id.clone(), 250i128).into_val(&env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &token,
                    fn_name: "transfer",
                    args: (from.clone(), contract_id.clone(), 250i128).into_val(&env),
                    sub_invokes: &[],
                }],
            },
        }]);
        client
            .try_deposit(&from, &deal_id, &250i128)
            .unwrap()
            .unwrap();
        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "release",
                args: (
                    operator.clone(),
                    deal_id.clone(),
                    to.clone(),
                    Symbol::new(&env, "manual_admin"),
                    String::from_str(&env, "ext1"),
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let released = client
            .try_release(
                &operator,
                &deal_id,
                &to,
                &Symbol::new(&env, "manual_admin"),
                &String::from_str(&env, "ext1"),
            )
            .unwrap()
            .unwrap();
        assert_eq!(released, 250i128);
        assert_eq!(token_client.balance(&to), 250i128);
        assert_eq!(client.balance(&deal_id), 0i128);
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "release",
                args: (
                    admin.clone(),
                    deal_id.clone(),
                    to.clone(),
                    Symbol::new(&env, "manual_admin"),
                    String::from_str(&env, "ext2"),
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_release(
                &admin,
                &deal_id,
                &to,
                &Symbol::new(&env, "manual_admin"),
                &String::from_str(&env, "ext2"),
            )
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InsufficientBalance);
    }

    #[test]
    fn paused_blocks_operations() {
        let env = Env::default();
        let (contract_id, client, admin, _operator, token, token_admin, _rcpt) = setup(&env);
        let from = Address::generate(&env);
        let token_sac = StellarAssetClient::new(&env, &token);
        let deal_id = String::from_str(&env, "deal-3");
        env.mock_auths(&[MockAuth {
            address: &token_admin,
            invoke: &MockAuthInvoke {
                contract: &token,
                fn_name: "mint",
                args: (from.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        token_sac.mint(&from, &100i128);
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
            address: &from,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "deposit",
                args: (from.clone(), deal_id.clone(), 10i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_deposit(&from, &deal_id, &10i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::Paused);
    }

    #[test]
    fn unauthorized_release_rejected() {
        let env = Env::default();
        let (contract_id, client, _admin, _operator, token, token_admin, _rcpt) = setup(&env);
        let from = Address::generate(&env);
        let non_auth = Address::generate(&env);
        let to = Address::generate(&env);
        let token_sac = StellarAssetClient::new(&env, &token);
        let deal_id = String::from_str(&env, "deal-4");
        env.mock_auths(&[MockAuth {
            address: &token_admin,
            invoke: &MockAuthInvoke {
                contract: &token,
                fn_name: "mint",
                args: (from.clone(), 50i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        token_sac.mint(&from, &50i128);
        env.mock_auths(&[MockAuth {
            address: &from,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "deposit",
                args: (from.clone(), deal_id.clone(), 50i128).into_val(&env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &token,
                    fn_name: "transfer",
                    args: (from.clone(), contract_id.clone(), 50i128).into_val(&env),
                    sub_invokes: &[],
                }],
            },
        }]);
        client
            .try_deposit(&from, &deal_id, &50i128)
            .unwrap()
            .unwrap();
        env.mock_auths(&[MockAuth {
            address: &non_auth,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "release",
                args: (
                    non_auth.clone(),
                    deal_id.clone(),
                    to.clone(),
                    Symbol::new(&env, "manual_admin"),
                    String::from_str(&env, "ext3"),
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_release(
                &non_auth,
                &deal_id,
                &to,
                &Symbol::new(&env, "manual_admin"),
                &String::from_str(&env, "ext3"),
            )
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    // ── Upgrade governance tests (#392) ───────────────────────────────────────

    #[test]
    fn propose_upgrade_stores_pending() {
        let env = Env::default();
        let (contract_id, client, admin, _operator, _token, _token_admin, _rcpt) = setup(&env);
        let hash = BytesN::from_array(&env, &[1u8; 32]);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_upgrade",
                args: (admin.clone(), hash.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_propose_upgrade(&admin, &hash).unwrap().unwrap();
    }

    #[test]
    fn execute_upgrade_fails_when_delay_not_met() {
        let env = Env::default();
        let (contract_id, client, admin, _operator, _token, _token_admin, _rcpt) = setup(&env);
        let hash = BytesN::from_array(&env, &[1u8; 32]);

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
                args: (admin.clone(), hash.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_propose_upgrade(&admin, &hash).unwrap().unwrap();

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
    fn cancel_upgrade_clears_pending() {
        let env = Env::default();
        let (contract_id, client, admin, _operator, _token, _token_admin, _rcpt) = setup(&env);
        let hash = BytesN::from_array(&env, &[1u8; 32]);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_upgrade",
                args: (admin.clone(), hash.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_propose_upgrade(&admin, &hash).unwrap().unwrap();

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
    }
}
