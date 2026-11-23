#![no_std]

use soroban_access_control::extend_storage_ttl;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Env, IntoVal, String, Symbol, Vec,
};

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    NotAuthorized = 6001,
    NotFound = 6002,
    BulkSizeExceeded = 6003,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AllowlistEntry {
    pub label: String,
    pub expires_at: u64,
    pub added_at: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Entry(Address),
    MemberCount,
}

const MAX_BULK_SIZE: u32 = 100;

// ────────────────────────────────────────────────────────────────────────────
// Contract
// ────────────────────────────────────────────────────────────────────────────

// Ledger TTL policy. These match `soroban_access_control::extend_storage_ttl`, which
// extends persistent entries: an entry below 10,000 remaining ledgers is extended to
// 500,000 ledgers (about 29 days at a 5 second ledger close). Instance storage (admin,
// member count) uses the same values.
const TTL_THRESHOLD_LEDGERS: u32 = 10_000;
const TTL_EXTEND_TO_LEDGERS: u32 = 500_000;

/// Extends the TTL of the contract instance (admin and member count).
fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD_LEDGERS, TTL_EXTEND_TO_LEDGERS);
}

/// Extends the TTL of a persistent entry when it exists. Extending a missing key is a
/// host error, so reads of absent keys are skipped.
fn extend_persistent_if_present(env: &Env, key: &DataKey) {
    if env.storage().persistent().has(key) {
        extend_storage_ttl(env, &key.into_val(env));
    }
}

#[contract]
pub struct AllowlistRegistry;

#[contractimpl]
impl AllowlistRegistry {
    /// Initialize the contract with an admin.
    pub fn initialize(env: Env, admin: Address) -> Result<(), ContractError> {
        extend_instance_ttl(&env);
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::NotAuthorized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::MemberCount, &0u32);
        env.events().publish(
            (
                Symbol::new(&env, "allowlist"),
                Symbol::new(&env, "initialized"),
            ),
            admin,
        );
        Ok(())
    }

    /// Add an address to the allowlist with a label and optional expiry.
    pub fn add(
        env: Env,
        address: Address,
        label: String,
        expires_at: u64,
    ) -> Result<(), ContractError> {
        extend_instance_ttl(&env);
        let admin = Self::get_admin(&env)?;
        admin.require_auth();

        let is_new = !Self::has_entry(&env, &address);
        let added_at = env.ledger().sequence();

        let entry = AllowlistEntry {
            label: label.clone(),
            expires_at,
            added_at,
        };

        let key = DataKey::Entry(address.clone());
        env.storage().persistent().set(&key, &entry);
        extend_storage_ttl(&env, &key.into_val(&env));

        if is_new {
            let count_key = DataKey::MemberCount;
            let current_count = Self::get_member_count(&env);
            env.storage()
                .instance()
                .set(&count_key, &(current_count + 1));
        }

        env.events().publish(
            (Symbol::new(&env, "allowlist"), Symbol::new(&env, "added")),
            (address, label, expires_at),
        );
        Ok(())
    }

    /// Remove an address from the allowlist.
    pub fn remove(env: Env, address: Address) -> Result<(), ContractError> {
        extend_instance_ttl(&env);
        let admin = Self::get_admin(&env)?;
        admin.require_auth();

        let key = DataKey::Entry(address.clone());
        if !env.storage().persistent().has(&key) {
            return Err(ContractError::NotFound);
        }

        env.storage().persistent().remove(&key);

        let count_key = DataKey::MemberCount;
        let current_count = Self::get_member_count(&env);
        if current_count > 0 {
            env.storage()
                .instance()
                .set(&count_key, &(current_count - 1));
        }

        env.events().publish(
            (Symbol::new(&env, "allowlist"), Symbol::new(&env, "removed")),
            address,
        );
        Ok(())
    }

    /// Check if an address is an active member (not expired).
    pub fn is_member(env: Env, address: Address) -> bool {
        extend_instance_ttl(&env);
        if let Some(entry) = Self::get_entry_internal(&env, &address) {
            let now = env.ledger().timestamp();
            if entry.expires_at == 0 {
                return true;
            }
            now <= entry.expires_at
        } else {
            false
        }
    }

    /// Get the allowlist entry for an address.
    pub fn get_entry(env: Env, address: Address) -> Result<AllowlistEntry, ContractError> {
        extend_instance_ttl(&env);
        Self::get_entry_internal(&env, &address).ok_or(ContractError::NotFound)
    }

    /// Add multiple entries in bulk.
    pub fn bulk_add(env: Env, entries: Vec<(Address, String, u64)>) -> Result<(), ContractError> {
        extend_instance_ttl(&env);
        let admin = Self::get_admin(&env)?;
        admin.require_auth();

        if entries.len() > MAX_BULK_SIZE {
            return Err(ContractError::BulkSizeExceeded);
        }

        let mut new_count = 0u32;
        for (address, label, expires_at) in entries.iter() {
            let is_new = !Self::has_entry(&env, &address);
            if is_new {
                new_count += 1;
            }

            let added_at = env.ledger().sequence();
            let entry = AllowlistEntry {
                label: label.clone(),
                expires_at,
                added_at,
            };

            let key = DataKey::Entry(address.clone());
            env.storage().persistent().set(&key, &entry);
            extend_storage_ttl(&env, &key.into_val(&env));

            env.events().publish(
                (Symbol::new(&env, "allowlist"), Symbol::new(&env, "added")),
                (address.clone(), label.clone(), expires_at),
            );
        }

        if new_count > 0 {
            let count_key = DataKey::MemberCount;
            let current_count = Self::get_member_count(&env);
            env.storage()
                .instance()
                .set(&count_key, &(current_count + new_count));
        }

        Ok(())
    }

    /// Get the total number of members.
    pub fn member_count(env: Env) -> u32 {
        extend_instance_ttl(&env);
        Self::get_member_count(&env)
    }

    // ────────────────────────────────────────────────────────────────────────
    // Helpers
    // ────────────────────────────────────────────────────────────────────────

    fn get_admin(env: &Env) -> Result<Address, ContractError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotAuthorized)
    }

    fn get_entry_internal(env: &Env, address: &Address) -> Option<AllowlistEntry> {
        let key = DataKey::Entry(address.clone());
        let entry = env.storage().persistent().get(&key);
        extend_persistent_if_present(env, &key);
        entry
    }

    fn has_entry(env: &Env, address: &Address) -> bool {
        let key = DataKey::Entry(address.clone());
        let present = env.storage().persistent().has(&key);
        extend_persistent_if_present(env, &key);
        present
    }

    fn get_member_count(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get::<_, u32>(&DataKey::MemberCount)
            .unwrap_or(0)
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};
    use soroban_sdk::vec;

    fn setup(env: &Env) -> (Address, AllowlistRegistryClient<'_>) {
        env.mock_all_auths();
        let contract_id = env.register(AllowlistRegistry, ());
        let client = AllowlistRegistryClient::new(env, &contract_id);
        let admin = Address::generate(env);
        client.initialize(&admin);
        (admin, client)
    }

    fn label(env: &Env, value: &str) -> String {
        String::from_str(env, value)
    }

    #[test]
    fn initialize_succeeds() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        assert_eq!(client.member_count(), 0);
    }

    #[test]
    fn initialize_twice_fails() {
        let env = Env::default();
        let (admin, client) = setup(&env);

        let result = client.try_initialize(&admin);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NotAuthorized);
    }

    #[test]
    fn add_requires_admin_auth() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let address = Address::generate(&env);

        // Drop the blanket auth mock: no one has authorized the call.
        env.set_auths(&[]);

        let result = client.try_add(&address, &label(&env, "test"), &0u64);
        assert!(result.is_err());
        assert!(!client.is_member(&address));
    }

    #[test]
    fn add_before_initialize_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AllowlistRegistry, ());
        let client = AllowlistRegistryClient::new(&env, &contract_id);
        let address = Address::generate(&env);

        let result = client.try_add(&address, &label(&env, "test"), &0u64);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NotAuthorized);
    }

    #[test]
    fn add_new_member() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let address = Address::generate(&env);

        client.add(&address, &label(&env, "verified"), &0u64);

        assert!(client.is_member(&address));
        assert_eq!(client.member_count(), 1);
    }

    #[test]
    fn add_updates_existing_member() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let address = Address::generate(&env);
        let label1 = label(&env, "kyc_level_1");
        let label2 = label(&env, "kyc_level_2");

        client.add(&address, &label1, &0u64);
        assert_eq!(client.get_entry(&address).label, label1);

        client.add(&address, &label2, &0u64);
        assert_eq!(client.get_entry(&address).label, label2);

        // Should still have only 1 member
        assert_eq!(client.member_count(), 1);
    }

    #[test]
    fn is_member_false_for_non_member() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let address = Address::generate(&env);

        assert!(!client.is_member(&address));
    }

    #[test]
    fn is_member_respects_expiry() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let address = Address::generate(&env);

        client.add(&address, &label(&env, "expiring"), &100u64);

        // Before expiry
        env.ledger().set_timestamp(50);
        assert!(client.is_member(&address));

        // At expiry boundary
        env.ledger().set_timestamp(100);
        assert!(client.is_member(&address));

        // After expiry
        env.ledger().set_timestamp(101);
        assert!(!client.is_member(&address));
    }

    #[test]
    fn is_member_true_for_no_expiry() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let address = Address::generate(&env);

        client.add(&address, &label(&env, "permanent"), &0u64);
        env.ledger().set_timestamp(1_000_000);

        assert!(client.is_member(&address));
    }

    #[test]
    fn get_entry_returns_correct_fields() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let address = Address::generate(&env);
        let entry_label = label(&env, "test_label");

        env.ledger().set_sequence_number(10);
        client.add(&address, &entry_label, &5000u64);

        let entry = client.get_entry(&address);
        assert_eq!(entry.label, entry_label);
        assert_eq!(entry.expires_at, 5000);
        assert_eq!(entry.added_at, 10);
    }

    #[test]
    fn get_entry_not_found() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let address = Address::generate(&env);

        let result = client.try_get_entry(&address);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NotFound);
    }

    #[test]
    fn remove_requires_admin_auth() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let address = Address::generate(&env);
        client.add(&address, &label(&env, "test"), &0u64);

        env.set_auths(&[]);

        let result = client.try_remove(&address);
        assert!(result.is_err());
        assert!(client.is_member(&address));
    }

    #[test]
    fn remove_succeeds() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let address = Address::generate(&env);

        client.add(&address, &label(&env, "test"), &0u64);
        assert!(client.is_member(&address));

        client.remove(&address);
        assert!(!client.is_member(&address));
        assert_eq!(client.member_count(), 0);
    }

    #[test]
    fn remove_not_found() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let address = Address::generate(&env);

        let result = client.try_remove(&address);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NotFound);
    }

    #[test]
    fn bulk_add_succeeds() {
        let env = Env::default();
        let (_admin, client) = setup(&env);

        let mut entries = vec![&env];
        for _ in 0..10 {
            entries.push_back((Address::generate(&env), label(&env, "bulk_member"), 0u64));
        }

        client.bulk_add(&entries);

        assert_eq!(client.member_count(), 10);
    }

    #[test]
    fn bulk_add_exceeds_limit() {
        let env = Env::default();
        let (_admin, client) = setup(&env);

        let mut entries = vec![&env];
        for _ in 0..101 {
            entries.push_back((Address::generate(&env), label(&env, "bulk_member"), 0u64));
        }

        let result = client.try_bulk_add(&entries);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::BulkSizeExceeded
        );
        assert_eq!(client.member_count(), 0);
    }

    #[test]
    fn member_count_accuracy() {
        let env = Env::default();
        let (_admin, client) = setup(&env);

        assert_eq!(client.member_count(), 0);

        for i in 0..5u32 {
            client.add(&Address::generate(&env), &label(&env, "member"), &0u64);
            assert_eq!(client.member_count(), i + 1);
        }

        let to_remove = Address::generate(&env);
        client.add(&to_remove, &label(&env, "member"), &0u64);
        assert_eq!(client.member_count(), 6);

        client.remove(&to_remove);
        assert_eq!(client.member_count(), 5);
    }

    #[test]
    fn add_emits_event() {
        let env = Env::default();
        let (_admin, client) = setup(&env);

        client.add(&Address::generate(&env), &label(&env, "test"), &0u64);

        assert!(!env.events().all().is_empty());
    }

    #[test]
    fn remove_emits_event() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let address = Address::generate(&env);
        client.add(&address, &label(&env, "test"), &0u64);

        client.remove(&address);

        assert!(!env.events().all().is_empty());
    }

    /// Ledgers advanced in the TTL test: beyond the test environment's default 4,096-ledger
    /// minimum persistent TTL, and below the 500,000-ledger extension the contract applies.
    const TTL_TEST_LEDGER_JUMP: u32 = 100_000;

    #[test]
    fn membership_and_count_survive_ledger_jump_past_default_ttl() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let member = Address::generate(&env);
        let label = String::from_str(&env, "tenant");
        client.add(&member, &label, &0u64);

        env.ledger()
            .with_mut(|li| li.sequence_number += TTL_TEST_LEDGER_JUMP);

        // The entry (persistent storage) and the member count (instance storage) are intact.
        assert!(client.is_member(&member));
        assert_eq!(client.get_entry(&member).label, label);
        assert_eq!(client.member_count(), 1);
    }
}
