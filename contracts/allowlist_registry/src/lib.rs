//! # Allowlist Registry  (#685)
//!
//! On-chain permissioned address registry with:
//! - Per-entry metadata and expiry timestamps
//! - Governance/admin-only add and remove
//! - Atomic bulk operations
//! - Composable `is_member` check for other contracts
//! - Add, Remove, Expire, and BulkAdd events for off-chain indexing

#![no_std]

#[cfg(kani)]
pub mod formal_properties;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Env, Map, String, Symbol, Vec,
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct Entry {
    /// Human-readable label (role, tier, etc.)
    pub label: String,
    /// Unix timestamp (seconds) after which the entry is considered expired.
    /// 0 means no expiry.
    pub expires_at: u64,
    /// When this entry was added (ledger sequence number for auditability).
    pub added_at: u32,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Registry,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    EntryNotFound = 4,
    AlreadyExists = 5,
    InvalidExpiry = 6,
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

fn admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)
}

fn registry(env: &Env) -> Map<Address, Entry> {
    env.storage()
        .instance()
        .get(&DataKey::Registry)
        .unwrap_or_else(|| Map::new(env))
}

fn save_registry(env: &Env, reg: &Map<Address, Entry>) {
    env.storage().instance().set(&DataKey::Registry, reg);
}

fn now_secs(env: &Env) -> u64 {
    env.ledger().timestamp()
}

fn is_expired(entry: &Entry, now: u64) -> bool {
    entry.expires_at != 0 && entry.expires_at <= now
}

// ─────────────────────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────────────────────

#[contract]
pub struct AllowlistRegistry;

#[contractimpl]
impl AllowlistRegistry {
    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /// Initialise the registry with the governing admin address.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        Ok(())
    }

    // ── Governance operations ─────────────────────────────────────────────────

    /// Add a single address to the allowlist.
    /// `expires_at` = 0 means no expiry.
    pub fn add(
        env: Env,
        caller: Address,
        address: Address,
        label: String,
        expires_at: u64,
    ) -> Result<(), Error> {
        caller.require_auth();
        let adm = admin(&env)?;
        if caller != adm {
            return Err(Error::Unauthorized);
        }
        if expires_at != 0 && expires_at <= now_secs(&env) {
            return Err(Error::InvalidExpiry);
        }

        let mut reg = registry(&env);
        if reg.contains_key(address.clone()) {
            return Err(Error::AlreadyExists);
        }
        let entry = Entry {
            label: label.clone(),
            expires_at,
            added_at: env.ledger().sequence(),
        };
        reg.set(address.clone(), entry);
        save_registry(&env, &reg);

        env.events().publish(
            (Symbol::new(&env, "add"), address.clone()),
            (label, expires_at),
        );
        Ok(())
    }

    /// Remove an address from the allowlist.
    pub fn remove(env: Env, caller: Address, address: Address) -> Result<(), Error> {
        caller.require_auth();
        let adm = admin(&env)?;
        if caller != adm {
            return Err(Error::Unauthorized);
        }

        let mut reg = registry(&env);
        if !reg.contains_key(address.clone()) {
            return Err(Error::EntryNotFound);
        }
        reg.remove(address.clone());
        save_registry(&env, &reg);

        env.events()
            .publish((Symbol::new(&env, "remove"), address), ());
        Ok(())
    }

    /// Atomically add multiple addresses (initial population or periodic refresh).
    /// The entire batch is applied or nothing changes on auth failure.
    pub fn bulk_add(
        env: Env,
        caller: Address,
        entries: Vec<(Address, String, u64)>,
    ) -> Result<u32, Error> {
        caller.require_auth();
        let adm = admin(&env)?;
        if caller != adm {
            return Err(Error::Unauthorized);
        }

        let now = now_secs(&env);
        let mut reg = registry(&env);
        let mut count: u32 = 0;

        for (address, label, expires_at) in entries.iter() {
            if expires_at != 0 && expires_at <= now {
                continue; // skip already-expired entries
            }
            let entry = Entry {
                label: label.clone(),
                expires_at,
                added_at: env.ledger().sequence(),
            };
            reg.set(address.clone(), entry);
            count += 1;
        }

        save_registry(&env, &reg);
        env.events()
            .publish((Symbol::new(&env, "bulk_add"),), count);
        Ok(count)
    }

    // ── Composable membership check ───────────────────────────────────────────

    /// Returns true iff `address` is on the allowlist and has not expired.
    /// Safe to call from other contracts as a composable guard.
    pub fn is_member(env: Env, address: Address) -> bool {
        let reg = registry(&env);
        match reg.get(address) {
            None => false,
            Some(entry) => !is_expired(&entry, now_secs(&env)),
        }
    }

    /// Return the entry for `address`, or an error if absent or expired.
    pub fn get_entry(env: Env, address: Address) -> Result<Entry, Error> {
        let reg = registry(&env);
        match reg.get(address) {
            None => Err(Error::EntryNotFound),
            Some(entry) => {
                if is_expired(&entry, now_secs(&env)) {
                    Err(Error::EntryNotFound)
                } else {
                    Ok(entry)
                }
            }
        }
    }

    /// Return the total count of non-expired entries.
    pub fn member_count(env: Env) -> u32 {
        let reg = registry(&env);
        let now = now_secs(&env);
        reg.iter()
            .filter(|(_, entry)| !is_expired(entry, now))
            .count() as u32
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Events, Ledger as _};
    use soroban_sdk::{vec, Env, String, TryIntoVal};

    fn deploy(env: &Env) -> (AllowlistRegistryClient, Address) {
        let id = env.register(AllowlistRegistry, ());
        let client = AllowlistRegistryClient::new(env, &id);
        let admin = Address::generate(env);
        env.mock_all_auths();
        client.initialize(&admin);
        (client, admin)
    }

    #[test]
    #[should_panic]
    fn initialize_requires_admin_auth() {
        let env = Env::default();
        let id = env.register(AllowlistRegistry, ());
        let client = AllowlistRegistryClient::new(&env, &id);
        let admin = Address::generate(&env);

        client.initialize(&admin);
    }

    #[test]
    fn test_add_and_is_member() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env);
        let member = Address::generate(&env);

        client.add(&admin, &member, &String::from_str(&env, "verified"), &0);
        assert!(client.is_member(&member));
    }

    #[test]
    fn test_remove() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env);
        let member = Address::generate(&env);

        client.add(&admin, &member, &String::from_str(&env, "verified"), &0);
        client.remove(&admin, &member);
        assert!(!client.is_member(&member));
    }

    #[test]
    fn test_expired_entry_fails_membership_check() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env);
        let member = Address::generate(&env);

        // Set expiry to 1 second in the future
        let expiry = env.ledger().timestamp() + 1;
        client.add(&admin, &member, &String::from_str(&env, "temp"), &expiry);

        // Advance ledger past expiry
        env.ledger().with_mut(|l| l.timestamp += 10);
        assert!(!client.is_member(&member));
    }

    #[test]
    fn test_bulk_add() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env);

        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let entries = vec![
            &env,
            (a.clone(), String::from_str(&env, "role_a"), 0u64),
            (b.clone(), String::from_str(&env, "role_b"), 0u64),
        ];
        let count = client.bulk_add(&admin, &entries);
        assert_eq!(count, 2);
        assert!(client.is_member(&a));
        assert!(client.is_member(&b));
        assert_eq!(client.member_count(), 2);
    }

    #[test]
    fn test_unauthorized_add_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _admin) = deploy(&env);
        let stranger = Address::generate(&env);
        let target = Address::generate(&env);

        let result = client.try_add(&stranger, &target, &String::from_str(&env, "x"), &0);
        assert!(result.is_err());
    }

    #[test]
    fn test_remove_nonexistent_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env);
        let ghost = Address::generate(&env);

        let result = client.try_remove(&admin, &ghost);
        assert!(result.is_err());
    }

    // ── Initialization ───────────────────────────────────────────────────────

    #[test]
    fn test_double_initialize_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env);

        let result = client.try_initialize(&admin);
        assert!(result.is_err());
    }

    /// `initialize` rejects an admin address that has not authorized the call.
    #[test]
    fn test_initialize_fails_without_any_mocked_auth() {
        let env = Env::default();
        let id = env.register(AllowlistRegistry, ());
        let client = AllowlistRegistryClient::new(&env, &id);
        let admin = Address::generate(&env);

        assert!(client.try_initialize(&admin).is_err());
    }

    #[test]
    fn test_add_before_initialize_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(AllowlistRegistry, ());
        let client = AllowlistRegistryClient::new(&env, &id);
        let caller = Address::generate(&env);
        let target = Address::generate(&env);

        let result = client.try_add(&caller, &target, &String::from_str(&env, "x"), &0);
        assert!(result.is_err());
    }

    #[test]
    fn test_remove_before_initialize_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(AllowlistRegistry, ());
        let client = AllowlistRegistryClient::new(&env, &id);
        let caller = Address::generate(&env);
        let target = Address::generate(&env);

        let result = client.try_remove(&caller, &target);
        assert!(result.is_err());
    }

    #[test]
    fn test_bulk_add_before_initialize_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(AllowlistRegistry, ());
        let client = AllowlistRegistryClient::new(&env, &id);
        let caller = Address::generate(&env);
        let a = Address::generate(&env);
        let entries = vec![&env, (a.clone(), String::from_str(&env, "role_a"), 0u64)];

        let result = client.try_bulk_add(&caller, &entries);
        assert!(result.is_err());
    }

    #[test]
    fn test_queries_before_initialize_do_not_panic() {
        let env = Env::default();
        let id = env.register(AllowlistRegistry, ());
        let client = AllowlistRegistryClient::new(&env, &id);
        let target = Address::generate(&env);

        assert!(!client.is_member(&target));
        assert!(client.try_get_entry(&target).is_err());
        assert_eq!(client.member_count(), 0);
    }

    // ── Authorization ─────────────────────────────────────────────────────────

    #[test]
    fn test_remove_unauthorized_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env);
        let stranger = Address::generate(&env);
        let member = Address::generate(&env);
        client.add(&admin, &member, &String::from_str(&env, "verified"), &0);

        let result = client.try_remove(&stranger, &member);
        assert!(result.is_err());
        assert!(
            client.is_member(&member),
            "entry must survive a rejected unauthorized removal"
        );
    }

    #[test]
    fn test_bulk_add_unauthorized_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _admin) = deploy(&env);
        let stranger = Address::generate(&env);
        let a = Address::generate(&env);
        let entries = vec![&env, (a.clone(), String::from_str(&env, "role_a"), 0u64)];

        let result = client.try_bulk_add(&stranger, &entries);
        assert!(result.is_err());
        assert!(!client.is_member(&a));
    }

    // ── Duplicate / boundary behavior ────────────────────────────────────────

    /// `add` on an address that is already registered is rejected with
    /// `AlreadyExists` error.
    #[test]
    fn test_add_duplicate_rejected_with_error() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env);
        let member = Address::generate(&env);

        client.add(&admin, &member, &String::from_str(&env, "tier1"), &0);
        let result = client.try_add(&admin, &member, &String::from_str(&env, "tier2"), &0);
        assert!(result.is_err());
        let err = result.unwrap_err().unwrap();
        assert_eq!(err, Error::AlreadyExists);

        // Verify the original entry is unchanged
        let entry = client.get_entry(&member);
        assert_eq!(entry.label, String::from_str(&env, "tier1"));
    }

    #[test]
    fn test_add_expiry_equal_to_now_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env);
        env.ledger().with_mut(|l| l.timestamp = 1000);
        let member = Address::generate(&env);
        let now = env.ledger().timestamp();

        let result = client.try_add(&admin, &member, &String::from_str(&env, "x"), &now);
        assert!(result.is_err());
    }

    #[test]
    fn test_add_expiry_one_second_in_future_accepted() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env);
        env.ledger().with_mut(|l| l.timestamp = 1000);
        let member = Address::generate(&env);
        let now = env.ledger().timestamp();

        client.add(&admin, &member, &String::from_str(&env, "x"), &(now + 1));
        assert!(client.is_member(&member));
    }

    #[test]
    fn test_bulk_add_skips_already_expired_entries() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env);
        env.ledger().with_mut(|l| l.timestamp = 1000);
        let now = env.ledger().timestamp();

        let live = Address::generate(&env);
        let expired = Address::generate(&env);
        let entries = vec![
            &env,
            (live.clone(), String::from_str(&env, "live"), 0u64),
            (expired.clone(), String::from_str(&env, "expired"), now),
        ];

        let count = client.bulk_add(&admin, &entries);
        assert_eq!(count, 1);
        assert!(client.is_member(&live));
        assert!(!client.is_member(&expired));
    }

    #[test]
    fn test_get_entry_on_expired_returns_not_found() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env);
        let member = Address::generate(&env);
        let expiry = env.ledger().timestamp() + 1;
        client.add(&admin, &member, &String::from_str(&env, "temp"), &expiry);

        env.ledger().with_mut(|l| l.timestamp += 10);
        let result = client.try_get_entry(&member);
        assert!(result.is_err());
    }

    #[test]
    fn test_member_count_excludes_expired_entries() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env);
        let live = Address::generate(&env);
        let expiring = Address::generate(&env);
        let expiry = env.ledger().timestamp() + 1;

        client.add(&admin, &live, &String::from_str(&env, "live"), &0);
        client.add(
            &admin,
            &expiring,
            &String::from_str(&env, "expiring"),
            &expiry,
        );
        assert_eq!(client.member_count(), 2);

        env.ledger().with_mut(|l| l.timestamp += 10);
        assert_eq!(client.member_count(), 1);
    }

    #[test]
    fn test_remove_same_address_twice_fails_second_time() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env);
        let member = Address::generate(&env);
        client.add(&admin, &member, &String::from_str(&env, "verified"), &0);

        client.remove(&admin, &member);
        let result = client.try_remove(&admin, &member);
        assert!(result.is_err());
    }

    // ── Events ────────────────────────────────────────────────────────────────

    #[test]
    fn test_add_emits_event() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env);
        let member = Address::generate(&env);

        client.add(&admin, &member, &String::from_str(&env, "verified"), &0);

        let events = env.events().all();
        let last = events.last().unwrap();
        let topics: soroban_sdk::Vec<soroban_sdk::Val> = last.1.clone();
        let name: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(name, Symbol::new(&env, "add"));
        let event_address: Address = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(event_address, member);
    }

    #[test]
    fn test_remove_emits_event() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env);
        let member = Address::generate(&env);
        client.add(&admin, &member, &String::from_str(&env, "verified"), &0);

        client.remove(&admin, &member);

        let events = env.events().all();
        let last = events.last().unwrap();
        let topics: soroban_sdk::Vec<soroban_sdk::Val> = last.1.clone();
        let name: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(name, Symbol::new(&env, "remove"));
        let event_address: Address = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(event_address, member);
    }

    #[test]
    fn test_bulk_add_emits_event_with_count() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env);
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let entries = vec![
            &env,
            (a.clone(), String::from_str(&env, "a"), 0u64),
            (b.clone(), String::from_str(&env, "b"), 0u64),
        ];

        client.bulk_add(&admin, &entries);

        let events = env.events().all();
        let last = events.last().unwrap();
        let topics: soroban_sdk::Vec<soroban_sdk::Val> = last.1.clone();
        let name: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(name, Symbol::new(&env, "bulk_add"));
        let count: u32 = last.2.clone().try_into_val(&env).unwrap();
        assert_eq!(count, 2);
    }
}
