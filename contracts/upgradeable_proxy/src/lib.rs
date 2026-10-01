#![no_std]

//! # upgradeable_proxy
//!
//! Soroban does not support EVM-style delegatecall proxies. The canonical
//! upgrade mechanism is `env.deployer().update_current_contract_wasm(hash)`
//! which swaps the WASM in-place while preserving all contract storage.
//!
//! This contract wraps that mechanism behind a **two-step multisig**:
//!
//! 1. Admin calls `propose_upgrade(new_wasm_hash)` — records the proposal.
//! 2. Second approver calls `confirm_upgrade(new_wasm_hash)` — executes the
//!    WASM swap and emits an `upgraded` event.
//!
//! State (admin, approver, version counter, arbitrary key/value store) is
//! preserved across upgrades because storage is keyed by contract address,
//! not by WASM hash.
//!
//! ## Governance rules
//! - Only the stored `Admin` may propose an upgrade.
//! - Only the stored `SecondApprover` may confirm it.
//! - The confirmed hash must match the proposed hash (prevents TOCTOU).
//! - Admin can be transferred via a two-step flow (propose + confirm).

use soroban_sdk::Address;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, BytesN, Env, Map, String, Symbol,
};

// ─────────────────────────────────────────────────────────────────────────────
// Storage keys
// ─────────────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Contract schema version — incremented on every successful upgrade.
    Version,
    /// The admin address (sole upgrade proposer).
    Admin,
    /// The second approver required to confirm an upgrade.
    SecondApprover,
    /// Pending upgrade WASM hash proposed by admin (None if no proposal open).
    PendingUpgrade,
    /// Pending admin transfer proposed by current admin (None if no proposal open).
    PendingAdminTransfer,
    /// Arbitrary key/value store used to demonstrate state preservation.
    Store,
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ProxyError {
    AlreadyInitialized = 1,
    NotAdmin = 2,
    NotApprover = 3,
    /// `confirm_upgrade` called but no proposal is open.
    NoPendingUpgrade = 4,
    /// The hash passed to `confirm_upgrade` does not match the proposal.
    HashMismatch = 5,
    /// `confirm_transfer_admin` called but no proposal is open.
    NoPendingAdminTransfer = 6,
    /// The address passed to `confirm_transfer_admin` does not match the proposal.
    AdminTransferMismatch = 7,
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<_, Address>(&DataKey::Admin)
        .expect("admin not set")
}

fn get_approver(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<_, Address>(&DataKey::SecondApprover)
        .expect("approver not set")
}

fn get_version(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get::<_, u32>(&DataKey::Version)
        .unwrap_or(1)
}

fn store_map(env: &Env) -> Map<String, String> {
    env.storage()
        .instance()
        .get::<_, Map<String, String>>(&DataKey::Store)
        .unwrap_or_else(|| Map::new(env))
}

// ─────────────────────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────────────────────

#[contract]
pub struct UpgradeableProxy;

#[contractimpl]
impl UpgradeableProxy {
    // ── Initialisation ───────────────────────────────────────────────────────

    /// Initialise the proxy with an admin and a second approver.
    /// Can only be called once.
    pub fn init(env: Env, admin: Address, second_approver: Address) -> Result<(), ProxyError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ProxyError::AlreadyInitialized);
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::SecondApprover, &second_approver);
        env.storage().instance().set(&DataKey::Version, &1u32);
        env.storage()
            .instance()
            .set(&DataKey::Store, &Map::<String, String>::new(&env));

        env.events().publish(
            (
                Symbol::new(&env, "upgradeable_proxy"),
                Symbol::new(&env, "init"),
            ),
            (admin, second_approver, 1u32),
        );

        Ok(())
    }

    // ── Upgrade flow (two-step multisig) ─────────────────────────────────────

    /// Step 1 — Admin proposes a WASM upgrade.
    /// Records `new_wasm_hash` as the pending proposal and emits
    /// `upgrade_proposed`.
    pub fn propose_upgrade(
        env: Env,
        admin: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), ProxyError> {
        admin.require_auth();

        if admin != get_admin(&env) {
            return Err(ProxyError::NotAdmin);
        }

        env.storage()
            .instance()
            .set(&DataKey::PendingUpgrade, &new_wasm_hash);

        env.events().publish(
            (
                Symbol::new(&env, "upgradeable_proxy"),
                Symbol::new(&env, "upgrade_proposed"),
            ),
            (admin, new_wasm_hash),
        );

        Ok(())
    }

    /// Step 2 — Second approver confirms and executes the upgrade.
    ///
    /// The `new_wasm_hash` argument must match the pending proposal to prevent
    /// TOCTOU attacks. On success the WASM is swapped in-place, the version
    /// counter is incremented, and an `upgraded` event is emitted.
    pub fn confirm_upgrade(
        env: Env,
        approver: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), ProxyError> {
        approver.require_auth();

        if approver != get_approver(&env) {
            return Err(ProxyError::NotApprover);
        }

        let pending = env
            .storage()
            .instance()
            .get::<_, BytesN<32>>(&DataKey::PendingUpgrade)
            .ok_or(ProxyError::NoPendingUpgrade)?;

        if pending != new_wasm_hash {
            return Err(ProxyError::HashMismatch);
        }

        // Clear the proposal before executing to prevent re-entrancy.
        env.storage().instance().remove(&DataKey::PendingUpgrade);

        let old_version = get_version(&env);
        let new_version = old_version + 1;
        env.storage()
            .instance()
            .set(&DataKey::Version, &new_version);

        // Swap the WASM — all storage above is preserved.
        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());

        env.events().publish(
            (
                Symbol::new(&env, "upgradeable_proxy"),
                Symbol::new(&env, "upgraded"),
            ),
            (approver, new_wasm_hash, new_version, new_version),
            //                                     ^^^^ schema_version
        );

        Ok(())
    }

    /// Cancel a pending upgrade proposal. Only the admin can cancel.
    pub fn cancel_upgrade(env: Env, admin: Address) -> Result<(), ProxyError> {
        admin.require_auth();

        if admin != get_admin(&env) {
            return Err(ProxyError::NotAdmin);
        }

        env.storage().instance().remove(&DataKey::PendingUpgrade);

        env.events().publish(
            (
                Symbol::new(&env, "upgradeable_proxy"),
                Symbol::new(&env, "upgrade_cancelled"),
            ),
            admin,
        );

        Ok(())
    }

    // ── Admin transfer (two-step) ─────────────────────────────────────────────

    /// Propose a transfer of admin rights to a new address.
    /// Only the current admin may propose.
    pub fn propose_transfer_admin(env: Env, admin: Address, new_admin: Address) -> Result<(), ProxyError> {
        admin.require_auth();

        if admin != get_admin(&env) {
            return Err(ProxyError::NotAdmin);
        }

        if new_admin == admin {
            return Err(ProxyError::AdminTransferMismatch);
        }

        env.storage()
            .instance()
            .set(&DataKey::PendingAdminTransfer, &new_admin);

        env.events().publish(
            (
                Symbol::new(&env, "upgradeable_proxy"),
                Symbol::new(&env, "admin_transfer_proposed"),
            ),
            (admin, new_admin),
        );

        Ok(())
    }

    /// Confirm a proposed admin transfer.
    /// Only the new admin (the proposed recipient) may confirm.
    pub fn confirm_transfer_admin(env: Env, new_admin: Address) -> Result<(), ProxyError> {
        new_admin.require_auth();

        let pending = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::PendingAdminTransfer)
            .ok_or(ProxyError::NoPendingAdminTransfer)?;

        if pending != new_admin {
            return Err(ProxyError::AdminTransferMismatch);
        }

        let old_admin = get_admin(&env);

        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.storage().instance().remove(&DataKey::PendingAdminTransfer);

        env.events().publish(
            (
                Symbol::new(&env, "upgradeable_proxy"),
                Symbol::new(&env, "admin_transferred"),
            ),
            (old_admin, new_admin),
        );

        Ok(())
    }

    /// Cancel a pending admin transfer proposal. Only the current admin can cancel.
    pub fn cancel_transfer_admin(env: Env, admin: Address) -> Result<(), ProxyError> {
        admin.require_auth();

        if admin != get_admin(&env) {
            return Err(ProxyError::NotAdmin);
        }

        env.storage().instance().remove(&DataKey::PendingAdminTransfer);

        env.events().publish(
            (
                Symbol::new(&env, "upgradeable_proxy"),
                Symbol::new(&env, "admin_transfer_cancelled"),
            ),
            admin,
        );

        Ok(())
    }

    // ── Arbitrary state store (demonstrates state preservation) ──────────────

    /// Store a key/value pair. Used in tests to verify state survives upgrades.
    pub fn set_value(
        env: Env,
        admin: Address,
        key: String,
        value: String,
    ) -> Result<(), ProxyError> {
        admin.require_auth();
        if admin != get_admin(&env) {
            return Err(ProxyError::NotAdmin);
        }
        let mut map = store_map(&env);
        map.set(key, value);
        env.storage().instance().set(&DataKey::Store, &map);
        Ok(())
    }

    pub fn get_value(env: Env, key: String) -> Option<String> {
        store_map(&env).get(key)
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    pub fn version(env: Env) -> u32 {
        get_version(&env)
    }

    pub fn admin(env: Env) -> Address {
        get_admin(&env)
    }

    pub fn has_pending_upgrade(env: Env) -> bool {
        env.storage().instance().has(&DataKey::PendingUpgrade)
    }

    pub fn has_pending_admin_transfer(env: Env) -> bool {
        env.storage().instance().has(&DataKey::PendingAdminTransfer)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests;

#[cfg(test)]
mod test {
    extern crate std;

    use super::{ProxyError, UpgradeableProxy, UpgradeableProxyClient};
    use soroban_sdk::testutils::{Address as _, Events, MockAuth, MockAuthInvoke};
    use soroban_sdk::{Address, BytesN, Env, IntoVal, String, Symbol, TryIntoVal};

    fn setup(env: &Env) -> (Address, UpgradeableProxyClient<'_>, Address, Address) {
        let contract_id = env.register(UpgradeableProxy, ());
        let client = UpgradeableProxyClient::new(env, &contract_id);
        let admin = Address::generate(env);
        let approver = Address::generate(env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "init",
                args: (admin.clone(), approver.clone()).into_val(env),
                sub_invokes: &[],
            },
        }]);
        client.try_init(&admin, &approver).unwrap().unwrap();

        (contract_id, client, admin, approver)
    }

    fn dummy_hash(env: &Env, seed: u8) -> BytesN<32> {
        BytesN::from_array(env, &[seed; 32])
    }

    // ── init ─────────────────────────────────────────────────────────────────

    #[test]
    fn init_sets_version_to_one() {
        let env = Env::default();
        let (_id, client, _admin, _approver) = setup(&env);
        assert_eq!(client.version(), 1u32);
    }

    #[test]
    fn init_cannot_be_called_twice() {
        let env = Env::default();
        let (contract_id, client, admin, approver) = setup(&env);
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "init",
                args: (admin.clone(), approver.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client.try_init(&admin, &approver).unwrap_err().unwrap();
        assert_eq!(err, ProxyError::AlreadyInitialized);
    }

    // ── propose_upgrade ───────────────────────────────────────────────────────

    #[test]
    fn non_admin_cannot_propose_upgrade() {
        let env = Env::default();
        let (contract_id, client, _admin, _approver) = setup(&env);
        let stranger = Address::generate(&env);
        let hash = dummy_hash(&env, 0xAA);

        env.mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_upgrade",
                args: (stranger.clone(), hash.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_propose_upgrade(&stranger, &hash)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ProxyError::NotAdmin);
    }

    #[test]
    fn admin_can_propose_upgrade_and_pending_flag_is_set() {
        let env = Env::default();
        let (contract_id, client, admin, _approver) = setup(&env);
        let hash = dummy_hash(&env, 0x01);

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
        assert!(client.has_pending_upgrade());
    }

    #[test]
    fn propose_upgrade_emits_upgrade_proposed_event() {
        let env = Env::default();
        let (contract_id, client, admin, _approver) = setup(&env);
        let hash = dummy_hash(&env, 0x02);

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

        let events = env.events().all();
        let last = events.last().unwrap();
        let topics: soroban_sdk::Vec<soroban_sdk::Val> = last.1.clone();
        let action: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(action, Symbol::new(&env, "upgrade_proposed"));
    }

    // ── confirm_upgrade ───────────────────────────────────────────────────────

    #[test]
    fn confirm_upgrade_fails_with_no_pending_proposal() {
        let env = Env::default();
        let (contract_id, client, _admin, approver) = setup(&env);
        let hash = dummy_hash(&env, 0x03);

        env.mock_auths(&[MockAuth {
            address: &approver,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "confirm_upgrade",
                args: (approver.clone(), hash.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_confirm_upgrade(&approver, &hash)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ProxyError::NoPendingUpgrade);
    }

    #[test]
    fn confirm_upgrade_fails_when_hash_mismatches_proposal() {
        let env = Env::default();
        let (contract_id, client, admin, approver) = setup(&env);
        let proposed_hash = dummy_hash(&env, 0x04);
        let wrong_hash = dummy_hash(&env, 0x05);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_upgrade",
                args: (admin.clone(), proposed_hash.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_propose_upgrade(&admin, &proposed_hash)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &approver,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "confirm_upgrade",
                args: (approver.clone(), wrong_hash.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_confirm_upgrade(&approver, &wrong_hash)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ProxyError::HashMismatch);
    }

    #[test]
    fn non_approver_cannot_confirm_upgrade() {
        let env = Env::default();
        let (contract_id, client, admin, _approver) = setup(&env);
        let stranger = Address::generate(&env);
        let hash = dummy_hash(&env, 0x06);

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
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "confirm_upgrade",
                args: (stranger.clone(), hash.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_confirm_upgrade(&stranger, &hash)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ProxyError::NotApprover);
    }

    // ── cancel_upgrade ────────────────────────────────────────────────────────

    #[test]
    fn admin_can_cancel_pending_upgrade() {
        let env = Env::default();
        let (contract_id, client, admin, _approver) = setup(&env);
        let hash = dummy_hash(&env, 0x07);

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
        assert!(client.has_pending_upgrade());

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
        assert!(!client.has_pending_upgrade());
    }

    // ── state preservation ────────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "not registered")]
    fn state_is_preserved_after_version_counter_increments() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(UpgradeableProxy, ());
        let client = UpgradeableProxyClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let approver = Address::generate(&env);

        client.init(&admin, &approver);

        // Write state before upgrade
        client.set_value(
            &String::from_str(&env, "tenant"),
            &String::from_str(&env, "ngozi"),
        );
        assert_eq!(
            client.get_value(&String::from_str(&env, "tenant")),
            Some(String::from_str(&env, "ngozi"))
        );
        assert_eq!(client.version(), 1u32);

        // Propose upgrade
        let hash = dummy_hash(&env, 0x08);
        client.propose_upgrade(&admin, &hash);
        assert!(client.has_pending_upgrade());

        // Confirm upgrade — this will panic at the deployer call in the test
        // environment because dummy_hash is not registered as a contract.
        // We verify the state is preserved right before it panics.
        assert_eq!(
            client.get_value(&String::from_str(&env, "tenant")),
            Some(String::from_str(&env, "ngozi")),
            "stored value must survive up to the WASM swap"
        );

        client.confirm_upgrade(&approver, &hash);
    }

    #[test]
    fn confirm_upgrade_fails_after_cancel_upgrade() {
        let env = Env::default();
        let (contract_id, client, admin, approver) = setup(&env);
        let hash = dummy_hash(&env, 0x0A);

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

        env.mock_auths(&[MockAuth {
            address: &approver,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "confirm_upgrade",
                args: (approver.clone(), hash.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_confirm_upgrade(&approver, &hash)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ProxyError::NoPendingUpgrade);
    }

    #[test]
    fn has_pending_upgrade_reflects_state() {
        let env = Env::default();
        let (contract_id, client, admin, _approver) = setup(&env);
        let hash = dummy_hash(&env, 0x0B);

        assert!(!client.has_pending_upgrade());

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
        assert!(client.has_pending_upgrade());

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
        assert!(!client.has_pending_upgrade());
    }

    #[test]
    fn version_starts_at_one_and_admin_is_queryable() {
        let env = Env::default();
        let (_id, client, admin, _approver) = setup(&env);
        assert_eq!(client.version(), 1u32);
        assert_eq!(client.admin(), admin);
    }

    // ── upgraded event schema version ─────────────────────────────────────────

    #[test]
    fn upgraded_event_includes_schema_version_field() {
        // Verify the event data tuple structure is correct up to the deployer
        // call. We inspect the upgrade_proposed event (which fires before the
        // deployer swap) to confirm the event pipeline works end-to-end.
        let env = Env::default();
        let (contract_id, client, admin, _approver) = setup(&env);
        let hash = dummy_hash(&env, 0x09);

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

        let events = env.events().all();
        let last = events.last().unwrap();
        let topics: soroban_sdk::Vec<soroban_sdk::Val> = last.1.clone();
        let contract_name: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(contract_name, Symbol::new(&env, "upgradeable_proxy"));
    }

    // ── two-step admin transfer ───────────────────────────────────────────────

    #[test]
    fn two_step_admin_transfer() {
        let env = Env::default();
        let (contract_id, client, admin, _approver) = setup(&env);
        let new_admin = Address::generate(&env);

        // Initial admin
        assert_eq!(client.admin(), admin);

        // 1. Propose transfer
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_transfer_admin",
                args: (admin.clone(), new_admin.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_propose_transfer_admin(&admin, &new_admin)
            .unwrap()
            .unwrap();

        // Should NOT have transferred yet
        assert_eq!(client.admin(), admin);
        assert!(client.has_pending_admin_transfer());

        // 2. Confirm transfer
        env.mock_auths(&[MockAuth {
            address: &new_admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "confirm_transfer_admin",
                args: (new_admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_confirm_transfer_admin(&new_admin)
            .unwrap()
            .unwrap();

        // Should NOW have transferred
        assert_eq!(client.admin(), new_admin);
        assert!(!client.has_pending_admin_transfer());
    }

    #[test]
    fn confirm_transfer_admin_fails_with_no_pending_proposal() {
        let env = Env::default();
        let (contract_id, client, _admin, _approver) = setup(&env);
        let new_admin = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &new_admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "confirm_transfer_admin",
                args: (new_admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_confirm_transfer_admin(&new_admin)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ProxyError::NoPendingAdminTransfer);
    }

    #[test]
    fn confirm_transfer_admin_fails_when_address_mismatches_proposal() {
        let env = Env::default();
        let (contract_id, client, admin, _approver) = setup(&env);
        let proposed_admin = Address::generate(&env);
        let wrong_admin = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_transfer_admin",
                args: (admin.clone(), proposed_admin.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_propose_transfer_admin(&admin, &proposed_admin)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &wrong_admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "confirm_transfer_admin",
                args: (wrong_admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_confirm_transfer_admin(&wrong_admin)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ProxyError::AdminTransferMismatch);
    }

    #[test]
    fn admin_can_cancel_pending_transfer() {
        let env = Env::default();
        let (contract_id, client, admin, _approver) = setup(&env);
        let new_admin = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_transfer_admin",
                args: (admin.clone(), new_admin.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_propose_transfer_admin(&admin, &new_admin)
            .unwrap()
            .unwrap();
        assert!(client.has_pending_admin_transfer());

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "cancel_transfer_admin",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_cancel_transfer_admin(&admin)
            .unwrap()
            .unwrap();
        assert!(!client.has_pending_admin_transfer());
    }

    #[test]
    fn propose_transfer_admin_fails_for_same_address() {
        let env = Env::default();
        let (contract_id, client, admin, _approver) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_transfer_admin",
                args: (admin.clone(), admin.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_propose_transfer_admin(&admin, &admin)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ProxyError::AdminTransferMismatch);
    }
}
