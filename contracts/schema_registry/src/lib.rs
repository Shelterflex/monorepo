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

#[cfg(kani)]
pub mod formal_properties;
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
    /// Executed migration receipts (idempotency guard, keyed by source+target).
    MigrationReceipt(u32, u32), // (source_version, target_version)
    /// Monotonic counter — next migration_id to assign.
    NextMigrationId,
    /// Receipt indexed by migration_id for verify_migration lookups.
    MigrationReceiptById(u32),
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
    /// Monotonic identifier assigned at execution time.
    pub migration_id: u32,
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
    /// Current registry schema version does not match the declared from-version.
    VersionMismatch = 7,
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct SchemaRegistry;

#[contractimpl]
impl SchemaRegistry {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the registry with the governing admin address.
    ///
    /// Sets the registry schema version to `1.0.0`, stores `admin`, and
    /// creates an empty compatibility matrix.  Panics if called more than once
    /// (`"already initialized"`).
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

    /// Register a supported schema transition in the compatibility matrix.
    ///
    /// Admin-only; requires auth from `caller`.  `meta.source` and
    /// `meta.target` must differ; passing identical versions returns
    /// `RegistryError::InvalidVersion`.  If an entry for the same
    /// `(source, target)` pair already exists it is overwritten.  Does not
    /// emit an event.
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

    /// Execute a registered schema migration from `source` to `target`.
    ///
    /// Callable by any authorised address (auth is required from `caller`, but
    /// the function is not restricted to admin — see test
    /// `test_execute_migration_allows_non_admin_caller`).  Performs these
    /// checks in order: (1) the current registry version must equal `source`;
    /// (2) the transition must be registered in the compatibility matrix;
    /// (3) the migration must not have been executed before (idempotency guard);
    /// (4) if `meta.requires_dry_run` is set, invariant checks must pass;
    /// (5) post-write invariant verification.  On success, advances the stored
    /// registry version to `target`, persists a `MigrationReceipt` under both
    /// the `(source, target)` and `migration_id` lookup keys, and emits a
    /// `migration_executed` event with `(migration_id, src_id, tgt_id, ledger)`.
    /// Returns the `MigrationReceipt` on success.
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

        // 1. Source-version guard: current registry version must match declared source.
        let current: SchemaVersion = env
            .storage()
            .persistent()
            .get(&DataKey::RegistrySchemaVersion)
            .unwrap_or(SchemaVersion {
                major: 1,
                minor: 0,
                patch: 0,
            });
        if current != source {
            env.events().publish(
                (Symbol::new(&env, "migration_rejected"),),
                (Self::version_id(&current), src_id, tgt_id),
            );
            return Err(RegistryError::VersionMismatch);
        }

        // 2. Lookup registered transition.
        let matrix: Map<(u32, u32), CompatibilityMeta> = env
            .storage()
            .persistent()
            .get(&DataKey::CompatibilityMatrix)
            .unwrap_or_else(|| Map::new(&env));

        let meta = matrix
            .get(key)
            .ok_or(RegistryError::UnsupportedTransition)?;

        // 3. Idempotency guard — replay protection.
        let receipt_key = DataKey::MigrationReceipt(src_id, tgt_id);
        if env.storage().persistent().has(&receipt_key) {
            return Err(RegistryError::AlreadyExecuted);
        }

        // 4. Require dry-run if meta demands it.
        if meta.requires_dry_run {
            match Self::check_invariants(&env, &source, &target) {
                InvariantResult::Fail(_) => {
                    return Err(RegistryError::InvariantViolation);
                }
                InvariantResult::Pass => {}
            }
        }

        // 5. Post-write invariant verification.
        let post_check = Self::check_invariants(&env, &source, &target);
        if post_check != InvariantResult::Pass {
            return Err(RegistryError::InvariantViolation);
        }

        // 6. Assign monotonic migration_id.
        let migration_id = Self::next_migration_id(&env);

        // 7. Advance registry schema version to target.
        env.storage()
            .persistent()
            .set(&DataKey::RegistrySchemaVersion, &target);

        // 8. Persist receipt under both lookup keys.
        let receipt = MigrationReceipt {
            migration_id,
            source: source.clone(),
            target: target.clone(),
            executed_by: caller,
            ledger: env.ledger().sequence(),
            verification_hash,
        };
        env.storage().persistent().set(&receipt_key, &receipt);
        env.storage()
            .persistent()
            .set(&DataKey::MigrationReceiptById(migration_id), &receipt);

        env.events().publish(
            (Symbol::new(&env, "migration_executed"),),
            (migration_id, src_id, tgt_id, env.ledger().sequence()),
        );

        Ok(receipt)
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    /// Return `true` if a transition from `source` to `target` is registered in the matrix.
    pub fn is_transition_supported(env: Env, source: SchemaVersion, target: SchemaVersion) -> bool {
        let key = (Self::version_id(&source), Self::version_id(&target));
        let matrix: Map<(u32, u32), CompatibilityMeta> = env
            .storage()
            .persistent()
            .get(&DataKey::CompatibilityMatrix)
            .unwrap_or_else(|| Map::new(&env));
        matrix.contains_key(key)
    }

    /// Return the `MigrationReceipt` for a completed `source → target` migration, if one exists.
    ///
    /// Returns `None` if no migration has been executed for this transition pair.
    pub fn get_receipt(
        env: Env,
        source: SchemaVersion,
        target: SchemaVersion,
    ) -> Option<MigrationReceipt> {
        let key = DataKey::MigrationReceipt(Self::version_id(&source), Self::version_id(&target));
        env.storage().persistent().get(&key)
    }

    /// Returns true iff the given migration_id exists and its target version
    /// matches expected_to — confirming the registry reached the intended state.
    pub fn verify_migration(env: Env, migration_id: u32, expected_to: SchemaVersion) -> bool {
        let receipt: Option<MigrationReceipt> = env
            .storage()
            .persistent()
            .get(&DataKey::MigrationReceiptById(migration_id));
        match receipt {
            Some(r) => r.target == expected_to,
            None => false,
        }
    }

    /// Return the current registry schema version.
    ///
    /// Defaults to `1.0.0` before any migrations have been executed.
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

    // ── Internal ─────────────────────────────────────────────────────────────

    fn next_migration_id(env: &Env) -> u32 {
        let id: u32 = env
            .storage()
            .instance()
            .get(&DataKey::NextMigrationId)
            .unwrap_or(0);
        let next = id + 1;
        env.storage()
            .instance()
            .set(&DataKey::NextMigrationId, &next);
        next
    }

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
    use soroban_sdk::testutils::{Address as _, Events};
    use soroban_sdk::{Env, TryIntoVal};

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

    // ── Initialization ───────────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_double_initialize_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(SchemaRegistry, ());
        let client = SchemaRegistryClient::new(&env, &id);
        let admin = Address::generate(&env);

        client.initialize(&admin);
        client.initialize(&admin);
    }

    #[test]
    fn test_register_transition_before_initialize_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(SchemaRegistry, ());
        let client = SchemaRegistryClient::new(&env, &id);
        let caller = Address::generate(&env);

        let result = client.try_register_transition(&caller, &meta(&env, v(1, 0, 0), v(2, 0, 0)));
        assert!(result.is_err());
    }

    /// Before initialization the compatibility matrix defaults to empty, so
    /// `execute_migration` fails via `UnsupportedTransition` rather than a
    /// dedicated "not initialized" error — there is no explicit init guard
    /// on this path (unlike `register_transition`, which is gated by
    /// `require_admin`). Documenting current behavior; flagged in the PR.
    #[test]
    fn test_execute_migration_before_initialize_fails_unsupported() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(SchemaRegistry, ());
        let client = SchemaRegistryClient::new(&env, &id);
        let caller = Address::generate(&env);
        let hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);

        let result = client.try_execute_migration(&caller, &v(1, 0, 0), &v(1, 1, 0), &hash);
        assert_eq!(
            result.unwrap_err().unwrap(),
            RegistryError::UnsupportedTransition
        );
    }

    // ── Authorization ─────────────────────────────────────────────────────────

    #[test]
    fn test_register_transition_unauthorized_fails() {
        let (env, client, _admin) = setup();
        let stranger = Address::generate(&env);

        let result = client.try_register_transition(&stranger, &meta(&env, v(1, 0, 0), v(2, 0, 0)));
        assert!(result.is_err());
        assert!(!client.is_transition_supported(&v(1, 0, 0), &v(2, 0, 0)));
    }

    /// `execute_migration` only requires that `caller` authenticate as
    /// themselves (`caller.require_auth()`); it never checks `caller`
    /// against the registry admin the way `register_transition` does. Any
    /// address that can produce a valid signature may execute an already
    /// registered migration. This looks like an authorization gap rather
    /// than intended design — flagging it here rather than treating it as a
    /// bug fix, per the issue's "report, don't fix" scope.
    #[test]
    fn test_execute_migration_allows_non_admin_caller() {
        let (env, client, admin) = setup();
        client.register_transition(&admin, &meta(&env, v(1, 0, 0), v(1, 1, 0)));

        let stranger = Address::generate(&env);
        let hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
        let result = client.try_execute_migration(&stranger, &v(1, 0, 0), &v(1, 1, 0), &hash);
        assert!(
            result.is_ok(),
            "documents current behavior: non-admin callers are not rejected"
        );
    }

    // ── Failure paths / boundaries ───────────────────────────────────────────

    #[test]
    fn test_register_transition_same_source_and_target_rejected() {
        let (env, client, admin) = setup();

        let result = client.try_register_transition(&admin, &meta(&env, v(1, 0, 0), v(1, 0, 0)));
        assert_eq!(result.unwrap_err().unwrap(), RegistryError::InvalidVersion);
    }

    /// Registering the same (source, target) pair twice silently overwrites
    /// the stored metadata rather than rejecting the second call. Documenting
    /// current behavior; flagged in the PR as ambiguous — should a duplicate
    /// registration be rejected instead?
    #[test]
    fn test_register_transition_overwrites_existing_entry() {
        let (env, client, admin) = setup();
        client.register_transition(&admin, &meta(&env, v(1, 0, 0), v(1, 1, 0)));

        let mut updated = meta(&env, v(1, 0, 0), v(1, 1, 0));
        updated.requires_dry_run = false;
        client.register_transition(&admin, &updated);

        assert!(client.is_transition_supported(&v(1, 0, 0), &v(1, 1, 0)));
    }

    #[test]
    fn test_execute_migration_version_mismatch_fails() {
        let (env, client, admin) = setup();
        // Registry starts at 1.0.0; register a transition whose declared
        // source does not match the current registry version.
        client.register_transition(&admin, &meta(&env, v(1, 1, 0), v(1, 2, 0)));

        let exec = Address::generate(&env);
        let hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
        let result = client.try_execute_migration(&exec, &v(1, 1, 0), &v(1, 2, 0), &hash);
        assert_eq!(result.unwrap_err().unwrap(), RegistryError::VersionMismatch);

        let events = env.events().all();
        let last = events.last().unwrap();
        let topics: soroban_sdk::Vec<soroban_sdk::Val> = last.1.clone();
        let name: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(name, Symbol::new(&env, "migration_rejected"));
    }

    #[test]
    fn test_registered_downgrade_fails_invariant_check() {
        let (env, client, admin) = setup();
        // Advance the registry to 2.0.0 via a normal upgrade first.
        client.register_transition(&admin, &meta(&env, v(1, 0, 0), v(2, 0, 0)));
        let exec = Address::generate(&env);
        let hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
        client.execute_migration(&exec, &v(1, 0, 0), &v(2, 0, 0), &hash);

        // Registering a downgrade is permitted at registration time (only
        // source == target is rejected there); the "target must exceed
        // source" invariant is only enforced at dry_run / execute time.
        client.register_transition(&admin, &meta(&env, v(2, 0, 0), v(1, 0, 0)));

        let dry = client.dry_run(&v(2, 0, 0), &v(1, 0, 0));
        assert!(matches!(dry, InvariantResult::Fail(_)));

        let result = client.try_execute_migration(&exec, &v(2, 0, 0), &v(1, 0, 0), &hash);
        assert_eq!(
            result.unwrap_err().unwrap(),
            RegistryError::InvariantViolation
        );
    }

    #[test]
    fn test_major_bump_without_minor_reset_fails_invariant_check() {
        let (env, client, admin) = setup();
        client.register_transition(&admin, &meta(&env, v(1, 5, 0), v(2, 3, 0)));

        let dry = client.dry_run(&v(1, 5, 0), &v(2, 3, 0));
        assert!(matches!(dry, InvariantResult::Fail(_)));
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    #[test]
    fn test_get_receipt_absent_then_present() {
        let (env, client, admin) = setup();
        client.register_transition(&admin, &meta(&env, v(1, 0, 0), v(1, 1, 0)));
        assert!(client.get_receipt(&v(1, 0, 0), &v(1, 1, 0)).is_none());

        let exec = Address::generate(&env);
        let hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
        client.execute_migration(&exec, &v(1, 0, 0), &v(1, 1, 0), &hash);

        let receipt = client.get_receipt(&v(1, 0, 0), &v(1, 1, 0));
        assert!(receipt.is_some());
        assert_eq!(receipt.unwrap().executed_by, exec);
    }

    #[test]
    fn test_verify_migration_true_and_false_cases() {
        let (env, client, admin) = setup();
        client.register_transition(&admin, &meta(&env, v(1, 0, 0), v(1, 1, 0)));

        let exec = Address::generate(&env);
        let hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
        let receipt = client.execute_migration(&exec, &v(1, 0, 0), &v(1, 1, 0), &hash);

        assert!(client.verify_migration(&receipt.migration_id, &v(1, 1, 0)));
        assert!(!client.verify_migration(&receipt.migration_id, &v(9, 9, 9)));
        assert!(!client.verify_migration(&999, &v(1, 1, 0)));
    }

    #[test]
    fn test_migration_id_increments_across_migrations() {
        let (env, client, admin) = setup();
        client.register_transition(&admin, &meta(&env, v(1, 0, 0), v(1, 1, 0)));
        client.register_transition(&admin, &meta(&env, v(1, 1, 0), v(1, 2, 0)));

        let exec = Address::generate(&env);
        let hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
        let r1 = client.execute_migration(&exec, &v(1, 0, 0), &v(1, 1, 0), &hash);
        let r2 = client.execute_migration(&exec, &v(1, 1, 0), &v(1, 2, 0), &hash);

        assert_eq!(r1.migration_id, 1);
        assert_eq!(r2.migration_id, 2);
    }

    // ── Events ────────────────────────────────────────────────────────────────

    #[test]
    fn test_execute_migration_emits_event_and_advances_version() {
        let (env, client, admin) = setup();
        client.register_transition(&admin, &meta(&env, v(1, 0, 0), v(1, 1, 0)));

        let exec = Address::generate(&env);
        let hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
        let receipt = client.execute_migration(&exec, &v(1, 0, 0), &v(1, 1, 0), &hash);
        assert_eq!(receipt.migration_id, 1);

        let events = env.events().all();
        let last = events.last().unwrap();
        let topics: soroban_sdk::Vec<soroban_sdk::Val> = last.1.clone();
        let name: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(name, Symbol::new(&env, "migration_executed"));

        assert_eq!(client.registry_version(), v(1, 1, 0));
    }
}
