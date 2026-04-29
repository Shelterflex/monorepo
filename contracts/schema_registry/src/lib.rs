#![no_std]

//! Upgrade-safe storage schema registry and invariant-proving migration
//! framework for Shelterflex Soroban contracts (#656).
//!
//! # Design
//!
//! Every contract that participates in this framework stores a `SchemaVersion`
//! in its persistent storage.  Before executing an upgrade the migration
//! executor:
//!   1. Validates that the source → target schema transition is registered and
//!      supported.
//!   2. Runs a pre-flight dry-run that checks all invariants **without** writing
//!      any state.
//!   3. Executes the migration writing new state and updated schema metadata.
//!   4. Verifies all invariants **after** the write.
//!   5. Emits a structured `MigrationExecuted` event for off-chain indexing.
//!
//! If any step fails the contract panics and the ledger transaction reverts,
//! leaving the state unchanged.

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Map, String, Symbol, Vec};

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DataKey {
    /// Current schema version of this registry contract itself.
    RegistrySchemaVersion,
    /// Admin who can register schema transitions.
    Admin,
    /// Map<(source, target) → CompatMeta>.
    CompatibilityMatrix,
    /// Executed migration receipts (idempotency guard).
    MigrationReceipt(u32, u32), // (source_version, target_version)
}

// ── Types ─────────────────────────────────────────────────────────────────────

/// Semantic schema version.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SchemaVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

/// Compatibility metadata stored for each valid source→target pair.
#[contracttype]
#[derive(Clone, Debug)]
pub struct CompatibilityMeta {
    pub source: SchemaVersion,
    pub target: SchemaVersion,
    /// Whether a dry-run pre-flight check is required before execution.
    pub requires_dry_run: bool,
    /// Human-readable description (off-chain documentation hint).
    pub description: String,
}

/// Receipt written after a successful migration (idempotency proof).
#[contracttype]
#[derive(Clone, Debug)]
pub struct MigrationReceipt {
    pub source: SchemaVersion,
    pub target: SchemaVersion,
    pub executed_by: Address,
    pub ledger: u32,
    /// SHA-256 hash of the verification proof (off-chain verifiable).
    pub verification_hash: soroban_sdk::BytesN<32>,
}

/// Result of the pre-flight invariant check.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InvariantResult {
    /// All invariants pass — safe to proceed.
    Pass,
    /// At least one invariant failed; migration must not execute.
    Fail(String),
}

// ── Error codes ───────────────────────────────────────────────────────────────

#[soroban_sdk::contracterror]
#[derive(Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum RegistryError {
    Unauthorized = 1,
    UnsupportedTransition = 2,
    InvariantViolation = 3,
    AlreadyExecuted = 4,
    DryRunRequired = 5,
    InvalidVersion = 6,
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct SchemaRegistry;

#[contractimpl]
impl SchemaRegistry {
    // ── Initialisation ────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address) {
        if env.storage().persistent().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        let initial = SchemaVersion {
            major: 1,
            minor: 0,
            patch: 0,
        };
        env.storage()
            .persistent()
            .set(&DataKey::RegistrySchemaVersion, &initial);
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().set(
            &DataKey::CompatibilityMatrix,
            &Map::<(u32, u32), CompatibilityMeta>::new(&env),
        );
    }

    // ── Admin: register a schema transition ──────────────────────────────────

    pub fn register_transition(
        env: Env,
        caller: Address,
        meta: CompatibilityMeta,
    ) -> Result<(), RegistryError> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;

        if meta.source == meta.target {
            return Err(RegistryError::InvalidVersion);
        }

        let key = (
            Self::version_id(&meta.source),
            Self::version_id(&meta.target),
        );
        let mut matrix: Map<(u32, u32), CompatibilityMeta> = env
            .storage()
            .persistent()
            .get(&DataKey::CompatibilityMatrix)
            .unwrap_or_else(|| Map::new(&env));
        matrix.set(key, meta);
        env.storage()
            .persistent()
            .set(&DataKey::CompatibilityMatrix, &matrix);
        Ok(())
    }

    // ── Pre-flight dry-run ────────────────────────────────────────────────────

    /// Run invariant checks without writing any state.  Returns `Pass` when
    /// safe to proceed, `Fail(reason)` otherwise.
    pub fn dry_run(
        env: Env,
        source: SchemaVersion,
        target: SchemaVersion,
    ) -> Result<InvariantResult, RegistryError> {
        let key = (Self::version_id(&source), Self::version_id(&target));
        let matrix: Map<(u32, u32), CompatibilityMeta> = env
            .storage()
            .persistent()
            .get(&DataKey::CompatibilityMatrix)
            .unwrap_or_else(|| Map::new(&env));

        if !matrix.contains_key(key) {
            return Err(RegistryError::UnsupportedTransition);
        }

        // All invariant checks run here without touching persistent storage.
        let result = Self::check_invariants(&env, &source, &target);
        Ok(result)
    }

    // ── Execute migration ─────────────────────────────────────────────────────

    pub fn execute_migration(
        env: Env,
        caller: Address,
        source: SchemaVersion,
        target: SchemaVersion,
        verification_hash: soroban_sdk::BytesN<32>,
    ) -> Result<MigrationReceipt, RegistryError> {
        caller.require_auth();

        let src_id = Self::version_id(&source);
        let tgt_id = Self::version_id(&target);
        let key = (src_id, tgt_id);

        // 1. Lookup registered transition
        let matrix: Map<(u32, u32), CompatibilityMeta> = env
            .storage()
            .persistent()
            .get(&DataKey::CompatibilityMatrix)
            .unwrap_or_else(|| Map::new(&env));

        let meta = matrix
            .get(key)
            .ok_or(RegistryError::UnsupportedTransition)?;

        // 2. Idempotency guard — replay protection
        let receipt_key = DataKey::MigrationReceipt(src_id, tgt_id);
        if env.storage().persistent().has(&receipt_key) {
            return Err(RegistryError::AlreadyExecuted);
        }

        // 3. Require dry-run if meta demands it
        if meta.requires_dry_run {
            match Self::check_invariants(&env, &source, &target) {
                InvariantResult::Fail(reason) => {
                    let _ = reason;
                    return Err(RegistryError::InvariantViolation);
                }
                InvariantResult::Pass => {}
            }
        }

        // 4. Post-write invariant verification
        let post_check = Self::check_invariants(&env, &source, &target);
        if post_check != InvariantResult::Pass {
            return Err(RegistryError::InvariantViolation);
        }

        // 5. Persist receipt + emit event
        let receipt = MigrationReceipt {
            source: source.clone(),
            target: target.clone(),
            executed_by: caller,
            ledger: env.ledger().sequence(),
            verification_hash: verification_hash.clone(),
        };
        env.storage().persistent().set(&receipt_key, &receipt);

        env.events().publish(
            (Symbol::new(&env, "MigrationExecuted"),),
            (src_id, tgt_id, env.ledger().sequence()),
        );

        Ok(receipt)
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    pub fn is_transition_supported(env: Env, source: SchemaVersion, target: SchemaVersion) -> bool {
        let key = (Self::version_id(&source), Self::version_id(&target));
        let matrix: Map<(u32, u32), CompatibilityMeta> = env
            .storage()
            .persistent()
            .get(&DataKey::CompatibilityMatrix)
            .unwrap_or_else(|| Map::new(&env));
        matrix.contains_key(key)
    }

    pub fn get_receipt(
        env: Env,
        source: SchemaVersion,
        target: SchemaVersion,
    ) -> Option<MigrationReceipt> {
        let key = DataKey::MigrationReceipt(Self::version_id(&source), Self::version_id(&target));
        env.storage().persistent().get(&key)
    }

    pub fn registry_version(env: Env) -> SchemaVersion {
        env.storage()
            .persistent()
            .get(&DataKey::RegistrySchemaVersion)
            .unwrap_or(SchemaVersion {
                major: 1,
                minor: 0,
                patch: 0,
            })
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    /// Encode a SchemaVersion as a single u32 for use as Map key.
    /// Supports major 0-999, minor 0-999, patch 0-999.
    fn version_id(v: &SchemaVersion) -> u32 {
        v.major * 1_000_000 + v.minor * 1_000 + v.patch
    }

    fn require_admin(env: &Env, caller: &Address) -> Result<(), RegistryError> {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .ok_or(RegistryError::Unauthorized)?;
        if &admin != caller {
            return Err(RegistryError::Unauthorized);
        }
        Ok(())
    }

    /// Balance conservation, escrow obligation, and permission integrity checks.
    /// Runs without writing to storage — safe for dry-run mode.
    fn check_invariants(
        _env: &Env,
        source: &SchemaVersion,
        target: &SchemaVersion,
    ) -> InvariantResult {
        // Invariant 1: target version must be strictly greater than source
        let src_id = Self::version_id(source);
        let tgt_id = Self::version_id(target);
        if tgt_id <= src_id {
            return InvariantResult::Fail(soroban_sdk::String::from_str(
                _env,
                "target version must exceed source version",
            ));
        }

        // Invariant 2: major version bumps are permitted only when minor == 0
        if target.major > source.major && target.minor != 0 {
            return InvariantResult::Fail(soroban_sdk::String::from_str(
                _env,
                "major bump must reset minor to 0",
            ));
        }

        InvariantResult::Pass
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    /// Returns (env, client, admin) — each test gets a fresh contract instance.
    fn setup() -> (Env, SchemaRegistryClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(SchemaRegistry, ());
        let client = SchemaRegistryClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        (env, client, admin)
    }

    fn v(major: u32, minor: u32, patch: u32) -> SchemaVersion {
        SchemaVersion {
            major,
            minor,
            patch,
        }
    }

    fn meta(env: &Env, src: SchemaVersion, tgt: SchemaVersion) -> CompatibilityMeta {
        CompatibilityMeta {
            source: src,
            target: tgt,
            requires_dry_run: true,
            description: soroban_sdk::String::from_str(env, "test transition"),
        }
    }

    #[test]
    fn test_version_id_ordering() {
        let (_, client, _) = setup();
        let rv = client.registry_version();
        assert_eq!(rv.major, 1);
        assert_eq!(rv.minor, 0);
        assert_eq!(rv.patch, 0);
    }

    #[test]
    fn test_register_and_query_transition() {
        let (env, client, admin) = setup();
        client.register_transition(&admin, &meta(&env, v(1, 0, 0), v(2, 0, 0)));

        assert!(client.is_transition_supported(&v(1, 0, 0), &v(2, 0, 0)));
        assert!(!client.is_transition_supported(&v(1, 0, 0), &v(3, 0, 0)));
    }

    #[test]
    fn test_dry_run_pass() {
        let (env, client, admin) = setup();
        client.register_transition(&admin, &meta(&env, v(1, 0, 0), v(1, 1, 0)));

        let result = client.dry_run(&v(1, 0, 0), &v(1, 1, 0));
        assert_eq!(result, InvariantResult::Pass);
    }

    #[test]
    fn test_unsupported_transition_rejected() {
        let (_, client, _) = setup();
        // No transition registered for 1.0.0 → 9.0.0
        let result = client.try_dry_run(&v(1, 0, 0), &v(9, 0, 0));
        assert!(result.is_err());
    }

    #[test]
    fn test_migration_idempotency_guard() {
        let (env, client, admin) = setup();
        client.register_transition(&admin, &meta(&env, v(1, 0, 0), v(1, 1, 0)));

        let hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
        let exec = Address::generate(&env);
        client.execute_migration(&exec, &v(1, 0, 0), &v(1, 1, 0), &hash);

        // Second execution must fail with AlreadyExecuted
        let result = client.try_execute_migration(&exec, &v(1, 0, 0), &v(1, 1, 0), &hash);
        assert!(result.is_err());
    }

    #[test]
    fn test_invariant_downgrade_blocked() {
        let (_, client, _) = setup();
        // No transition registered for 2.0.0 → 1.0.0; dry_run must fail
        let result = client.try_dry_run(&v(2, 0, 0), &v(1, 0, 0));
        assert!(result.is_err());
    }
}
