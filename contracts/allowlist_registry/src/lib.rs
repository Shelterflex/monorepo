//! # Allowlist Registry  (#685)
//!
//! On-chain permissioned address registry with:
//! - Per-entry metadata and expiry timestamps
//! - Governance/admin-only add and remove
//! - Atomic bulk operations
//! - Composable `is_member` check for other contracts
//! - Add, Remove, Expire, and BulkAdd events for off-chain indexing

#![no_std]

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
    use soroban_sdk::testutils::{Address as _, Ledger as _};
    use soroban_sdk::{vec, Env, String};

    fn deploy(env: &Env) -> (AllowlistRegistryClient, Address) {
        let id = env.register(AllowlistRegistry, ());
        let client = AllowlistRegistryClient::new(env, &id);
        let admin = Address::generate(env);
        env.mock_all_auths();
        client.initialize(&admin);
        (client, admin)
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
}
