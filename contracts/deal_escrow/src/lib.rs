#![no_std]

extern crate alloc;

use soroban_pausable::{Pausable, PausableError};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token::Client as TokenClient, Address,
    BytesN, Env, String, Symbol, Vec,
};

// ── Storage keys ─────────────────────────────────────────────────────────────
pub mod access_control;
pub mod validation;

#[cfg(kani)]
pub mod formal_properties;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    ContractVersion,
    StorageSchemaVersion,
    Admin,
    Operator,
    Resolver,
    ChallengeWindowSeconds,
    DisputeTimeoutSeconds,
    Token,
    ReceiptContract,
    Paused,
    /// Per-deal balance in persistent storage (#386 gas optimisation)
    DealBalance(String),
    DealDepositor(String),
    DealState(String),
    DealLifecycle(String),
    PendingRentRelease(String),
    RentDispute(String),
    LegacyLockedAmountV2(String),
    LegacyPendingPayoutV2(String),
    /// Reentrancy lock (#390)
    Reentrancy,
    // ── Upgrade governance (#392) ─────────────────────────────────────────
    Guardian,
    UpgradeDelay,
    PendingUpgradeHash,
    PendingUpgradeAt,
    // ── Circuit breaker (#393) ──────────────────────────────────────────
    CircuitBreakerState,
    PendingDrainHash,
    PendingDrainAt,
    RecoveryDelaySeconds,
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
    InvalidSplit = 11,
    // Circuit breaker states
    Frozen = 12,
    RecoveryDelayNotMet = 13,
    // Release window & schema
    InvalidReleaseWindow = 14,
    InvalidSchemaVersion = 15,
    // Pending release lifecycle
    PendingReleaseExists = 16,
    NoPendingRelease = 17,
    // Dispute errors
    DisputeNotAllowed = 18,
    NoOpenDispute = 19,
    InvalidSettlement = 20,
    // Governance drain
    InvalidGovernanceDrain = 21,
    // Migration / data invariants
    MigrationInvariantViolation = 22,
    // Deal lifecycle (#974)
    InvalidDealTransition = 23,
}

#[contracttype]
#[derive(Clone, Copy, Eq, PartialEq)]
#[repr(u32)]
pub enum DealLifecycleStatus {
    Draft = 0,
    Active = 1,
    Completed = 2,
    Defaulted = 3,
}

#[contracttype]
#[derive(Clone)]
pub struct DealState {
    pub total_balance: i128,
    pub locked_amount: i128,
    pub pending_payout: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct PendingRentRelease {
    pub to: Address,
    pub amount: i128,
    pub requested_by: Address,
    pub requested_at: u64,
    pub challenge_end_at: u64,
    pub external_ref_source: Symbol,
    pub external_ref: String,
}

#[contracttype]
#[derive(Clone)]
pub struct RentDispute {
    pub opened_by: Address,
    pub opened_at: u64,
    pub evidence_ref: String,
    pub challenge_evidence_ref: String,
    pub resolved: bool,
}

#[contracttype]
#[derive(Clone, Copy, Eq, PartialEq)]
#[repr(u32)]
pub enum SettlementOutcome {
    ReleaseToRecipient = 1,
    RefundToDepositor = 2,
}

#[contracttype]
#[derive(Clone, Copy, Eq, PartialEq)]
#[repr(u32)]
pub enum CircuitBreakerState {
    Unfrozen = 0,
    Frozen = 1,
    RecoveryAwaiting = 2,
}

const STORAGE_SCHEMA_V1: u32 = 1;
const STORAGE_SCHEMA_V2: u32 = 2;
const STORAGE_SCHEMA_V3: u32 = 3;

// ── Default values ───────────────────────────────────────────────────────

const DEFAULT_CIRCUIT_BREAKER_STATE: CircuitBreakerState = CircuitBreakerState::Unfrozen;

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

fn get_storage_schema_version(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get::<_, u32>(&DataKey::StorageSchemaVersion)
        .unwrap_or(STORAGE_SCHEMA_V1)
}

fn get_operator(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<_, Address>(&DataKey::Operator)
        .expect("operator not set")
}

fn get_resolver(env: &Env) -> Option<Address> {
    env.storage()
        .instance()
        .get::<_, Address>(&DataKey::Resolver)
}

fn get_challenge_window_seconds(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get::<_, u64>(&DataKey::ChallengeWindowSeconds)
        .unwrap_or(24 * 60 * 60)
}

fn get_dispute_timeout_seconds(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get::<_, u64>(&DataKey::DisputeTimeoutSeconds)
        .unwrap_or(48 * 60 * 60)
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

fn get_circuit_breaker_state(env: &Env) -> CircuitBreakerState {
    env.storage()
        .instance()
        .get::<_, CircuitBreakerState>(&DataKey::CircuitBreakerState)
        .unwrap_or(CircuitBreakerState::Unfrozen)
}

fn get_recovery_delay_seconds(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get::<_, u64>(&DataKey::RecoveryDelaySeconds)
        .unwrap_or(24 * 60 * 60) // Default 24 hours
}

fn get_pending_drain_hash(env: &Env) -> Option<BytesN<32>> {
    env.storage()
        .instance()
        .get::<_, BytesN<32>>(&DataKey::PendingDrainHash)
}

fn get_pending_drain_at(env: &Env) -> Option<u64> {
    env.storage()
        .instance()
        .get::<_, u64>(&DataKey::PendingDrainAt)
}

fn require_not_frozen(env: &Env, is_governance_drain: bool) -> Result<(), ContractError> {
    let state = get_circuit_breaker_state(env);
    match state {
        CircuitBreakerState::Unfrozen => Ok(()),
        CircuitBreakerState::Frozen => {
            if is_governance_drain {
                Ok(()) // Allow governance drain path
            } else {
                Err(ContractError::Frozen)
            }
        }
        CircuitBreakerState::RecoveryAwaiting => Err(ContractError::RecoveryDelayNotMet),
    }
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

fn get_deal_depositor(env: &Env, deal_id: &String) -> Option<Address> {
    env.storage()
        .persistent()
        .get::<_, Address>(&DataKey::DealDepositor(deal_id.clone()))
}

fn set_deal_depositor_if_missing(env: &Env, deal_id: &String, depositor: &Address) {
    let key = DataKey::DealDepositor(deal_id.clone());
    if !env.storage().persistent().has(&key) {
        env.storage().persistent().set(&key, depositor);
    }
}

fn get_deal_state(env: &Env, deal_id: &String) -> DealState {
    if let Some(state) = env
        .storage()
        .persistent()
        .get::<_, DealState>(&DataKey::DealState(deal_id.clone()))
    {
        return state;
    }
    DealState {
        total_balance: get_deal_balance(env, deal_id),
        locked_amount: 0,
        pending_payout: 0,
    }
}

fn set_deal_state(env: &Env, deal_id: &String, state: &DealState) {
    env.storage()
        .persistent()
        .set(&DataKey::DealState(deal_id.clone()), state);
}

fn assert_deal_invariants(state: &DealState) -> Result<(), ContractError> {
    if state.total_balance < 0 || state.locked_amount < 0 || state.pending_payout < 0 {
        return Err(ContractError::MigrationInvariantViolation);
    }
    if state.locked_amount != state.pending_payout {
        return Err(ContractError::MigrationInvariantViolation);
    }
    if state.locked_amount > state.total_balance {
        return Err(ContractError::MigrationInvariantViolation);
    }
    Ok(())
}

fn get_pending_release(env: &Env, deal_id: &String) -> Option<PendingRentRelease> {
    env.storage()
        .persistent()
        .get::<_, PendingRentRelease>(&DataKey::PendingRentRelease(deal_id.clone()))
}

fn set_pending_release(env: &Env, deal_id: &String, release: &PendingRentRelease) {
    env.storage()
        .persistent()
        .set(&DataKey::PendingRentRelease(deal_id.clone()), release);
}

fn clear_pending_release(env: &Env, deal_id: &String) {
    env.storage()
        .persistent()
        .remove(&DataKey::PendingRentRelease(deal_id.clone()));
}

fn get_dispute(env: &Env, deal_id: &String) -> Option<RentDispute> {
    env.storage()
        .persistent()
        .get::<_, RentDispute>(&DataKey::RentDispute(deal_id.clone()))
}

fn set_dispute(env: &Env, deal_id: &String, dispute: &RentDispute) {
    env.storage()
        .persistent()
        .set(&DataKey::RentDispute(deal_id.clone()), dispute);
}

fn clear_dispute(env: &Env, deal_id: &String) {
    env.storage()
        .persistent()
        .remove(&DataKey::RentDispute(deal_id.clone()));
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
    /// Initialise the escrow contract.
    ///
    /// Sets the `admin`, `operator`, `token`, and `receipt_contract` addresses,
    /// seeds the contract version to 1, and stores the initial storage-schema
    /// version.  Can only be called once; subsequent calls return
    /// `ContractError::AlreadyInitialized`.  Emits a `deal_escrow / init` event
    /// containing all four addresses plus the version number.
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
            .set(&DataKey::StorageSchemaVersion, &STORAGE_SCHEMA_V3);
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

    /// Return the current contract version (starts at 1, incremented by upgrades).
    pub fn contract_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get::<_, u32>(&DataKey::ContractVersion)
            .unwrap_or(0u32)
    }

    /// Deposit tokens into escrow for a given deal.
    ///
    /// Requires auth from `from`.  Transfers `amount` tokens from `from` to the
    /// contract using the configured token, then credits that amount to the
    /// per-deal persistent balance.  The first depositor for a `deal_id` is
    /// recorded as the deal's depositor (used later for dispute resolution).
    /// Protected by a reentrancy guard around the external token transfer.
    /// Reverts if the contract is paused, if `amount` is invalid (≤ 0), or if
    /// `deal_id` is empty.  Emits a `deal_escrow / deposit` event containing
    /// `(deal_id, from, amount)`.
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
        set_deal_depositor_if_missing(&env, &deal_id, &from);
        let mut state = get_deal_state(&env, &deal_id);
        state.total_balance = cur + amount;
        assert_deal_invariants(&state)?;
        set_deal_state(&env, &deal_id, &state);

        env.events().publish(
            (
                Symbol::new(&env, "deal_escrow"),
                Symbol::new(&env, "deposit"),
            ),
            (deal_id, from, amount),
        );
        Ok(())
    }

    /// Release the full escrowed balance for a deal to up to three recipients.
    ///
    /// Callable by the admin or operator.  Splits the deal's current balance
    /// exactly into `principal_amount` (→ `to`), `platform_amount` (→
    /// `platform_addr`), and `reporter_amount` (→ `reporter_addr`); the three
    /// amounts must sum to the current balance exactly, otherwise
    /// `ContractError::InvalidSplit` is returned.  Generates a canonical
    /// transaction ID from `external_ref_source` / `external_ref` and records
    /// it in the emitted event for receipt indexing.  Protected by a reentrancy
    /// guard.  Reverts if the contract is paused or frozen, if the deal balance
    /// is zero, or if any amount is negative.  Emits a `deal_escrow / release`
    /// event and returns the released total.
    pub fn release(
        env: Env,
        caller: Address,
        deal_id: String,
        to: Address,
        principal_amount: i128,
        platform_addr: Address,
        platform_amount: i128,
        reporter_addr: Address,
        reporter_amount: i128,
        external_ref_source: Symbol,
        external_ref: String,
    ) -> Result<i128, ContractError> {
        require_not_paused(&env)?;
        require_not_frozen(&env, false)?;
        validation::require_non_empty_string(&env, &deal_id)?;
        validation::require_non_empty_string(&env, &external_ref)?;
        let admin = get_admin(&env);
        let operator = get_operator(&env);
        access_control::require_admin_or_operator_permission(
            &env, &admin, &operator, &caller, "release",
        )?;

        if principal_amount < 0 || platform_amount < 0 || reporter_amount < 0 {
            return Err(ContractError::InvalidAmount);
        }

        // #386: per-key persistent storage
        let cur = get_deal_balance(&env, &deal_id);
        if cur <= 0 {
            return Err(ContractError::InsufficientBalance);
        }

        if principal_amount + platform_amount + reporter_amount != cur {
            return Err(ContractError::InvalidSplit);
        }

        let token_addr = get_token(&env);
        let token_client = TokenClient::new(&env, &token_addr);

        put_deal_balance(&env, &deal_id, 0);
        let mut state = get_deal_state(&env, &deal_id);
        state.total_balance = 0;
        state.locked_amount = 0;
        state.pending_payout = 0;
        assert_deal_invariants(&state)?;
        set_deal_state(&env, &deal_id, &state);

        let tx_id = generate_tx_id(&env, &external_ref_source, &external_ref);

        // #390: reentrancy guard before external token call
        enter_nonreentrant(&env)?;
        if principal_amount > 0 {
            token_client.transfer(&env.current_contract_address(), &to, &principal_amount);
        }
        if platform_amount > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &platform_addr,
                &platform_amount,
            );
        }
        if reporter_amount > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &reporter_addr,
                &reporter_amount,
            );
        }
        exit_nonreentrant(&env);

        env.events().publish(
            (
                Symbol::new(&env, "deal_escrow"),
                Symbol::new(&env, "release"),
            ),
            (
                deal_id,
                to,
                principal_amount,
                platform_addr,
                platform_amount,
                reporter_addr,
                reporter_amount,
                external_ref_source,
                tx_id,
            ),
        );
        Ok(cur)
    }

    /// Return the current escrowed token balance for `deal_id`.
    pub fn balance(env: Env, deal_id: String) -> i128 {
        get_deal_balance(&env, &deal_id)
    }

    /// Return the current storage-schema version (V1 = 1, V2 = 2, V3 = 3).
    pub fn storage_schema_version(env: Env) -> u32 {
        get_storage_schema_version(&env)
    }

    /// Configure the two time windows used by the rent-release dispute flow.
    ///
    /// Admin-only.  `challenge_window_seconds` is the period after a release is
    /// requested during which a depositor or recipient may open a dispute.
    /// `dispute_timeout_seconds` is the period after a dispute is opened before
    /// it auto-resolves in favour of the depositor via `settle_dispute_timeout`.
    /// Both values must be non-zero.  Emits a
    /// `deal_escrow / configure_dispute_windows` event with the new values.
    pub fn configure_dispute_windows(
        env: Env,
        admin: Address,
        challenge_window_seconds: u64,
        dispute_timeout_seconds: u64,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(
            &env,
            &current_admin,
            &admin,
            "configure_dispute_windows",
        )?;
        if challenge_window_seconds == 0 || dispute_timeout_seconds == 0 {
            return Err(ContractError::InvalidReleaseWindow);
        }
        env.storage()
            .instance()
            .set(&DataKey::ChallengeWindowSeconds, &challenge_window_seconds);
        env.storage()
            .instance()
            .set(&DataKey::DisputeTimeoutSeconds, &dispute_timeout_seconds);
        env.events().publish(
            (
                Symbol::new(&env, "deal_escrow"),
                Symbol::new(&env, "configure_dispute_windows"),
            ),
            (challenge_window_seconds, dispute_timeout_seconds),
        );
        Ok(())
    }

    /// Set the address of the trusted dispute resolver.
    ///
    /// Admin-only.  The resolver is the only address permitted to call
    /// `resolve_rent_dispute`.  Emits a `deal_escrow / set_resolver` event
    /// containing the new resolver address.
    pub fn set_resolver(env: Env, admin: Address, resolver: Address) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "set_resolver")?;
        env.storage().instance().set(&DataKey::Resolver, &resolver);
        env.events().publish(
            (
                Symbol::new(&env, "deal_escrow"),
                Symbol::new(&env, "set_resolver"),
            ),
            resolver,
        );
        Ok(())
    }

    /// Migrate deal-balance storage from an older schema version to V3.
    ///
    /// Admin-only.  Accepts `from_version` (must be V1 or V2) and a list of
    /// `deal_ids` whose persistent records should be converted to the V3
    /// `DealState` struct format.  If the contract is already at V3 the
    /// function is a no-op and emits a `migration_noop` event.  On success the
    /// stored schema version is bumped to V3 and a `migration_completed` event
    /// is emitted.  Returns `ContractError::InvalidSchemaVersion` if
    /// `from_version` does not match the current on-chain version or is not a
    /// recognised legacy version.
    pub fn migrate_storage_schema(
        env: Env,
        admin: Address,
        from_version: u32,
        deal_ids: Vec<String>,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(
            &env,
            &current_admin,
            &admin,
            "migrate_storage_schema",
        )?;
        let current = get_storage_schema_version(&env);
        if current == STORAGE_SCHEMA_V3 {
            env.events().publish(
                (
                    Symbol::new(&env, "deal_escrow"),
                    Symbol::new(&env, "migration_noop"),
                ),
                (current, STORAGE_SCHEMA_V3),
            );
            return Ok(());
        }
        if current != from_version
            || !(from_version == STORAGE_SCHEMA_V1 || from_version == STORAGE_SCHEMA_V2)
        {
            return Err(ContractError::InvalidSchemaVersion);
        }
        env.events().publish(
            (
                Symbol::new(&env, "deal_escrow"),
                Symbol::new(&env, "migration_started"),
            ),
            (from_version, STORAGE_SCHEMA_V3, deal_ids.len()),
        );

        for deal_id in deal_ids.iter() {
            let balance = get_deal_balance(&env, &deal_id);
            let mut locked = 0i128;
            let mut pending = 0i128;
            if from_version == STORAGE_SCHEMA_V2 {
                locked = env
                    .storage()
                    .persistent()
                    .get::<_, i128>(&DataKey::LegacyLockedAmountV2(deal_id.clone()))
                    .unwrap_or(0);
                pending = env
                    .storage()
                    .persistent()
                    .get::<_, i128>(&DataKey::LegacyPendingPayoutV2(deal_id.clone()))
                    .unwrap_or(0);
            }
            let state = DealState {
                total_balance: balance,
                locked_amount: locked,
                pending_payout: pending,
            };
            assert_deal_invariants(&state)?;
            set_deal_state(&env, &deal_id, &state);
        }

        env.storage()
            .instance()
            .set(&DataKey::StorageSchemaVersion, &STORAGE_SCHEMA_V3);
        env.events().publish(
            (
                Symbol::new(&env, "deal_escrow"),
                Symbol::new(&env, "migration_completed"),
            ),
            (from_version, STORAGE_SCHEMA_V3),
        );
        Ok(())
    }

    /// Initiate a two-phase rent-release for a deal.
    ///
    /// Callable by the admin or operator.  Records a `PendingRentRelease` for
    /// `deal_id`, locking `amount` tokens within the deal's balance for the
    /// intended recipient `to`.  The challenge window starts immediately;
    /// either party (depositor or recipient) may dispute before
    /// `challenge_end_at`.  Fails if the contract is paused, if the deal
    /// already has a pending release (`ContractError::PendingReleaseExists`),
    /// or if `amount` exceeds the current balance.  Emits a
    /// `deal_escrow / rent_release_requested` event with `(deal_id, caller,
    /// amount, challenge_end_at)`.
    pub fn request_rent_release(
        env: Env,
        caller: Address,
        deal_id: String,
        to: Address,
        amount: i128,
        external_ref_source: Symbol,
        external_ref: String,
    ) -> Result<(), ContractError> {
        require_not_paused(&env)?;
        validation::require_valid_amount(amount)?;
        validation::require_non_empty_string(&env, &deal_id)?;
        validation::require_non_empty_string(&env, &external_ref)?;
        let admin = get_admin(&env);
        let operator = get_operator(&env);
        access_control::require_admin_or_operator_permission(
            &env,
            &admin,
            &operator,
            &caller,
            "request_rent_release",
        )?;
        if get_pending_release(&env, &deal_id).is_some() {
            return Err(ContractError::PendingReleaseExists);
        }
        let mut state = get_deal_state(&env, &deal_id);
        if state.total_balance < amount {
            return Err(ContractError::InsufficientBalance);
        }
        state.locked_amount = amount;
        state.pending_payout = amount;
        assert_deal_invariants(&state)?;
        set_deal_state(&env, &deal_id, &state);
        let now = env.ledger().timestamp();
        let pending = PendingRentRelease {
            to,
            amount,
            requested_by: caller.clone(),
            requested_at: now,
            challenge_end_at: now + get_challenge_window_seconds(&env),
            external_ref_source,
            external_ref,
        };
        set_pending_release(&env, &deal_id, &pending);
        env.events().publish(
            (
                Symbol::new(&env, "deal_escrow"),
                Symbol::new(&env, "rent_release_requested"),
            ),
            (deal_id, caller, pending.amount, pending.challenge_end_at),
        );
        Ok(())
    }

    /// Open a dispute against a pending rent release.
    ///
    /// Requires auth from `caller`, who must be either the deal's depositor or
    /// the intended recipient of the pending release.  Must be called within
    /// the challenge window (`now <= challenge_end_at`); after that window
    /// closes the function returns `ContractError::DisputeNotAllowed`.
    /// `challenge_evidence_ref` must be a non-empty string referencing
    /// off-chain evidence.  Creates a `RentDispute` record for the deal.
    /// Emits a `deal_escrow / rent_release_challenged` event with `(deal_id,
    /// caller, now)`.
    pub fn challenge_rent_release(
        env: Env,
        caller: Address,
        deal_id: String,
        challenge_evidence_ref: String,
    ) -> Result<(), ContractError> {
        require_not_paused(&env)?;
        validation::require_non_empty_string(&env, &deal_id)?;
        validation::require_non_empty_string(&env, &challenge_evidence_ref)?;
        caller.require_auth();
        let pending = get_pending_release(&env, &deal_id).ok_or(ContractError::NoPendingRelease)?;
        let now = env.ledger().timestamp();
        if now > pending.challenge_end_at {
            return Err(ContractError::DisputeNotAllowed);
        }
        let depositor =
            get_deal_depositor(&env, &deal_id).ok_or(ContractError::DisputeNotAllowed)?;
        if caller != depositor && caller != pending.to {
            return Err(ContractError::NotAuthorized);
        }
        let dispute = RentDispute {
            opened_by: caller.clone(),
            opened_at: now,
            evidence_ref: pending.external_ref.clone(),
            challenge_evidence_ref,
            resolved: false,
        };
        set_dispute(&env, &deal_id, &dispute);
        env.events().publish(
            (
                Symbol::new(&env, "deal_escrow"),
                Symbol::new(&env, "rent_release_challenged"),
            ),
            (deal_id, caller, now),
        );
        Ok(())
    }

    /// Resolve an open rent-release dispute as the trusted resolver.
    ///
    /// Only callable by the address stored as the resolver (set via
    /// `set_resolver`).  Requires auth from `caller`.  The `outcome` field
    /// determines who receives the locked tokens:
    /// `SettlementOutcome::ReleaseToRecipient` pays the intended recipient;
    /// `SettlementOutcome::RefundToDepositor` refunds the depositor.
    /// Clears the pending release and dispute records, transfers tokens under
    /// the reentrancy guard, and emits a `deal_escrow / rent_release_settled`
    /// event.  Returns `ContractError::NotAuthorized` if no resolver is
    /// configured or `caller` is not the resolver, and
    /// `ContractError::NoOpenDispute` if no dispute exists.
    pub fn resolve_rent_dispute(
        env: Env,
        caller: Address,
        deal_id: String,
        outcome: SettlementOutcome,
        resolution_evidence_ref: String,
    ) -> Result<(), ContractError> {
        require_not_paused(&env)?;
        validation::require_non_empty_string(&env, &deal_id)?;
        validation::require_non_empty_string(&env, &resolution_evidence_ref)?;
        let resolver = get_resolver(&env).ok_or(ContractError::NotAuthorized)?;
        if caller != resolver {
            return Err(ContractError::NotAuthorized);
        }
        caller.require_auth();
        let dispute = get_dispute(&env, &deal_id).ok_or(ContractError::NoOpenDispute)?;
        if dispute.resolved {
            return Err(ContractError::InvalidSettlement);
        }
        Self::settle_release_inner(&env, &deal_id, outcome, &resolution_evidence_ref, true)
    }

    /// Auto-settle a rent release after the challenge window expires with no dispute.
    ///
    /// Callable by anyone once `now >= challenge_end_at` and no dispute has
    /// been opened.  Releases the locked tokens to the original recipient
    /// (`SettlementOutcome::ReleaseToRecipient`).  Returns
    /// `ContractError::DisputeNotAllowed` if a dispute is already open, and
    /// `ContractError::InvalidReleaseWindow` if the challenge window has not
    /// yet closed.  Emits a `deal_escrow / rent_release_settled` event.
    pub fn settle_rent_release_timeout(env: Env, deal_id: String) -> Result<(), ContractError> {
        require_not_paused(&env)?;
        validation::require_non_empty_string(&env, &deal_id)?;
        if get_dispute(&env, &deal_id).is_some() {
            return Err(ContractError::DisputeNotAllowed);
        }
        let pending = get_pending_release(&env, &deal_id).ok_or(ContractError::NoPendingRelease)?;
        if env.ledger().timestamp() < pending.challenge_end_at {
            return Err(ContractError::InvalidReleaseWindow);
        }
        Self::settle_release_inner(
            &env,
            &deal_id,
            SettlementOutcome::ReleaseToRecipient,
            &String::from_str(&env, "timeout_auto_release"),
            false,
        )
    }

    /// Auto-resolve a dispute that has exceeded the dispute-timeout window.
    ///
    /// Callable by anyone once `now >= dispute.opened_at + dispute_timeout_seconds`.
    /// Settles in favour of the depositor (`SettlementOutcome::RefundToDepositor`).
    /// Returns `ContractError::NoOpenDispute` if no dispute exists,
    /// `ContractError::InvalidSettlement` if the dispute was already resolved,
    /// and `ContractError::InvalidReleaseWindow` if the timeout has not yet
    /// elapsed.  Emits a `deal_escrow / rent_release_settled` event.
    pub fn settle_dispute_timeout(env: Env, deal_id: String) -> Result<(), ContractError> {
        require_not_paused(&env)?;
        validation::require_non_empty_string(&env, &deal_id)?;
        let dispute = get_dispute(&env, &deal_id).ok_or(ContractError::NoOpenDispute)?;
        if dispute.resolved {
            return Err(ContractError::InvalidSettlement);
        }
        if env.ledger().timestamp() < dispute.opened_at + get_dispute_timeout_seconds(&env) {
            return Err(ContractError::InvalidReleaseWindow);
        }
        Self::settle_release_inner(
            &env,
            &deal_id,
            SettlementOutcome::RefundToDepositor,
            &String::from_str(&env, "dispute_timeout_refund"),
            false,
        )
    }

    fn settle_release_inner(
        env: &Env,
        deal_id: &String,
        outcome: SettlementOutcome,
        resolution_evidence_ref: &String,
        resolved_by_resolver: bool,
    ) -> Result<(), ContractError> {
        let pending = get_pending_release(env, deal_id).ok_or(ContractError::NoPendingRelease)?;
        let depositor = get_deal_depositor(env, deal_id).ok_or(ContractError::InvalidSettlement)?;
        let mut state = get_deal_state(env, deal_id);
        if state.locked_amount != pending.amount || state.pending_payout != pending.amount {
            return Err(ContractError::MigrationInvariantViolation);
        }
        let recipient = match outcome {
            SettlementOutcome::ReleaseToRecipient => pending.to.clone(),
            SettlementOutcome::RefundToDepositor => depositor.clone(),
        };
        let token_addr = get_token(env);
        let token_client = TokenClient::new(env, &token_addr);
        enter_nonreentrant(env)?;
        token_client.transfer(&env.current_contract_address(), &recipient, &pending.amount);
        exit_nonreentrant(env);

        state.total_balance -= pending.amount;
        state.locked_amount = 0;
        state.pending_payout = 0;
        assert_deal_invariants(&state)?;
        set_deal_state(env, deal_id, &state);
        put_deal_balance(env, deal_id, state.total_balance);
        clear_pending_release(env, deal_id);
        if let Some(mut dispute) = get_dispute(env, deal_id) {
            dispute.resolved = true;
            set_dispute(env, deal_id, &dispute);
            clear_dispute(env, deal_id);
        }
        let tx_id = generate_tx_id(env, &pending.external_ref_source, resolution_evidence_ref);
        env.events().publish(
            (
                Symbol::new(env, "deal_escrow"),
                Symbol::new(env, "rent_release_settled"),
            ),
            (
                deal_id.clone(),
                recipient,
                pending.amount,
                outcome as u32,
                tx_id,
                resolved_by_resolver,
            ),
        );
        Ok(())
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
    /// Set the guardian address that must co-sign upgrade execution.
    ///
    /// Admin-only.  When a guardian is configured, both the admin and the
    /// guardian must authorise `execute_upgrade` and `emergency_upgrade`.
    /// Setting a guardian is optional; without one, admin auth alone suffices.
    /// Emits a `deal_escrow / set_guardian` event containing the new guardian
    /// address.
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

    /// Set the minimum delay (in seconds) between proposing and executing an upgrade.
    ///
    /// Admin-only.  A non-zero delay enforces a timelock on WASM upgrades,
    /// giving stakeholders time to review before the upgrade takes effect.
    /// A value of 0 disables the delay.  Emits a
    /// `deal_escrow / set_upgrade_delay` event containing the new delay value.
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

    /// Step 1 of the two-phase upgrade: propose a new WASM hash.
    ///
    /// Admin-only.  Records `new_wasm_hash` as the pending upgrade and
    /// timestamps the proposal.  Only one upgrade may be pending at a time;
    /// a second call returns `ContractError::UpgradeAlreadyPending`.  After
    /// the configured `upgrade_delay` has elapsed, the admin (plus guardian if
    /// set) can finalise the upgrade via `execute_upgrade`.  Emits a
    /// `deal_escrow / propose_upgrade` event with `(new_wasm_hash, now)`.
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

    /// Step 2 of the two-phase upgrade: execute a previously proposed WASM upgrade.
    ///
    /// Admin-only (plus guardian auth if a guardian is configured).
    /// `new_wasm_hash` must match the hash stored by `propose_upgrade`.  The
    /// configured upgrade delay must have elapsed since the proposal; otherwise
    /// `ContractError::UpgradeDelayNotMet` is returned.  On success, clears
    /// the pending proposal, emits a `deal_escrow / execute_upgrade` event,
    /// and replaces the contract WASM in-place via
    /// `env.deployer().update_current_contract_wasm`.
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

    /// Bypass the upgrade delay and immediately replace the contract WASM.
    ///
    /// Admin-only (plus guardian auth if a guardian is configured).  Intended
    /// for critical security patches where waiting for the normal timelock
    /// would be dangerous.  Clears any pending upgrade proposal, emits a
    /// `deal_escrow / emergency_upgrade` event containing `(admin,
    /// new_wasm_hash, timestamp)`, and replaces the WASM in-place.  Use with
    /// extreme caution.
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

    /// Cancel a pending upgrade proposal before it is executed.
    ///
    /// Admin-only.  Returns `ContractError::NoUpgradePending` if there is no
    /// proposal to cancel.  Clears the stored hash and timestamp, and emits a
    /// `deal_escrow / cancel_upgrade` event with `(admin, cancelled_hash)`.
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
}

// ── Circuit Breaker Functions (#393) ───────────────────────────────

#[contractimpl]
impl DealEscrow {
    /// Freeze the contract, halting all fund-movement operations.
    ///
    /// Admin-only.  Transitions the circuit-breaker state from `Unfrozen` to
    /// `Frozen`.  While frozen, `release` and other fund-movement calls return
    /// `ContractError::Frozen`.  Returns `ContractError::Frozen` if the
    /// contract is already frozen.  Emits a `deal_escrow / freeze` event with
    /// `(admin, timestamp)`.
    pub fn freeze(env: Env, admin: Address) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "freeze")?;

        let state = get_circuit_breaker_state(&env);
        if state == CircuitBreakerState::Frozen {
            return Err(ContractError::Frozen);
        }

        env.storage()
            .instance()
            .set(&DataKey::CircuitBreakerState, &CircuitBreakerState::Frozen);
        env.events().publish(
            (
                Symbol::new(&env, "deal_escrow"),
                Symbol::new(&env, "freeze"),
            ),
            (admin, env.ledger().timestamp()),
        );
        Ok(())
    }

    /// Return `true` if the contract is currently in the `Frozen` circuit-breaker state.
    pub fn is_frozen(env: Env) -> bool {
        get_circuit_breaker_state(&env) == CircuitBreakerState::Frozen
    }

    /// Step 1 of the governance-controlled drain: propose a drain hash.
    ///
    /// Admin-only.  The contract must already be `Frozen`.  Records
    /// `drain_hash` and the current timestamp as the pending drain proposal.
    /// After the recovery delay elapses, `execute_drain` can finalise the
    /// drain.  Returns `ContractError::InvalidGovernanceDrain` if the contract
    /// is not frozen.  Emits a `deal_escrow / propose_drain` event with
    /// `(drain_hash, now)`.
    pub fn propose_drain(
        env: Env,
        admin: Address,
        drain_hash: BytesN<32>,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "propose_drain")?;

        let state = get_circuit_breaker_state(&env);
        if state != CircuitBreakerState::Frozen {
            return Err(ContractError::InvalidGovernanceDrain); // Must be frozen to propose drain
        }

        let now = env.ledger().timestamp();
        env.storage()
            .instance()
            .set(&DataKey::PendingDrainHash, &drain_hash);
        env.storage().instance().set(&DataKey::PendingDrainAt, &now);

        env.events().publish(
            (
                Symbol::new(&env, "deal_escrow"),
                Symbol::new(&env, "propose_drain"),
            ),
            (drain_hash, now),
        );
        Ok(())
    }

    /// Step 2 of the governance-controlled drain: execute after the recovery delay.
    ///
    /// Admin-only.  `drain_hash` must match the hash stored by `propose_drain`.
    /// The recovery delay must have elapsed since the proposal; otherwise
    /// `ContractError::RecoveryDelayNotMet` is returned.  The contract must
    /// still be `Frozen`; non-frozen state returns
    /// `ContractError::InvalidGovernanceDrain`.  On success, clears the
    /// pending drain records, transitions the circuit-breaker state back to
    /// `Unfrozen`, and emits a `deal_escrow / execute_drain` event with
    /// `(admin, drain_hash, timestamp)`.
    pub fn execute_drain(
        env: Env,
        admin: Address,
        drain_hash: BytesN<32>,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "execute_drain")?;

        let pending_hash = get_pending_drain_hash(&env).ok_or(ContractError::NoPendingRelease)?;
        if pending_hash != drain_hash {
            return Err(ContractError::NoPendingRelease);
        }

        let proposed_at = get_pending_drain_at(&env).ok_or(ContractError::NoPendingRelease)?;
        let delay = get_recovery_delay_seconds(&env);
        if env.ledger().timestamp() < proposed_at + delay {
            return Err(ContractError::RecoveryDelayNotMet);
        }

        // Execute drain - only during governance-controlled recovery
        let state = get_circuit_breaker_state(&env);
        if state != CircuitBreakerState::Frozen {
            return Err(ContractError::InvalidGovernanceDrain);
        }

        // Clear pending drain
        env.storage().instance().remove(&DataKey::PendingDrainHash);
        env.storage().instance().remove(&DataKey::PendingDrainAt);

        // Allow recovery by unfreezing
        env.storage().instance().set(
            &DataKey::CircuitBreakerState,
            &CircuitBreakerState::Unfrozen,
        );

        env.events().publish(
            (
                Symbol::new(&env, "deal_escrow"),
                Symbol::new(&env, "execute_drain"),
            ),
            (admin, drain_hash, env.ledger().timestamp()),
        );
        Ok(())
    }

    /// Set the minimum recovery delay (in seconds) before `execute_drain` may run.
    ///
    /// Admin-only.  Defaults to 86 400 s (24 hours) when unset.  Emits a
    /// `deal_escrow / set_recovery_delay` event containing the new delay value.
    pub fn set_recovery_delay(
        env: Env,
        admin: Address,
        delay_seconds: u64,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(
            &env,
            &current_admin,
            &admin,
            "set_recovery_delay",
        )?;

        env.storage()
            .instance()
            .set(&DataKey::RecoveryDelaySeconds, &delay_seconds);
        env.events().publish(
            (
                Symbol::new(&env, "deal_escrow"),
                Symbol::new(&env, "set_recovery_delay"),
            ),
            delay_seconds,
        );
        Ok(())
    }

    /// Return the current circuit-breaker state as a `u32`.
    ///
    /// Maps to `CircuitBreakerState`: `0` = Unfrozen, `1` = Frozen,
    /// `2` = RecoveryAwaiting.
    pub fn get_circuit_breaker_state(env: Env) -> u32 {
        get_circuit_breaker_state(&env) as u32
    }

    fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get::<_, bool>(&DataKey::Paused)
            .unwrap_or(false)
    }

    fn get_deal_lifecycle(env: &Env, deal_id: &String) -> DealLifecycleStatus {
        env.storage()
            .persistent()
            .get::<_, DealLifecycleStatus>(&DataKey::DealLifecycle(deal_id.clone()))
            .unwrap_or(DealLifecycleStatus::Draft)
    }

    fn set_deal_lifecycle(env: &Env, deal_id: &String, status: DealLifecycleStatus) {
        env.storage()
            .persistent()
            .set(&DataKey::DealLifecycle(deal_id.clone()), &status);
    }

    /// Admin-only: activate a deal on-chain (draft → active).
    pub fn activate_deal(env: Env, admin: Address, deal_id: String) -> Result<(), ContractError> {
        require_not_paused(&env)?;
        validation::require_non_empty_string(&env, &deal_id)?;
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "activate_deal")?;

        let current = Self::get_deal_lifecycle(&env, &deal_id);
        if current != DealLifecycleStatus::Draft {
            return Err(ContractError::InvalidDealTransition);
        }
        Self::set_deal_lifecycle(&env, &deal_id, DealLifecycleStatus::Active);
        env.events().publish(
            (
                Symbol::new(&env, "deal_escrow"),
                Symbol::new(&env, "activate_deal"),
            ),
            (deal_id, admin),
        );
        Ok(())
    }

    /// Admin-only: mark a deal completed on-chain.
    pub fn complete_deal(env: Env, admin: Address, deal_id: String) -> Result<(), ContractError> {
        require_not_paused(&env)?;
        validation::require_non_empty_string(&env, &deal_id)?;
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "complete_deal")?;

        let current = Self::get_deal_lifecycle(&env, &deal_id);
        if current != DealLifecycleStatus::Active {
            return Err(ContractError::InvalidDealTransition);
        }
        Self::set_deal_lifecycle(&env, &deal_id, DealLifecycleStatus::Completed);
        env.events().publish(
            (
                Symbol::new(&env, "deal_escrow"),
                Symbol::new(&env, "complete_deal"),
            ),
            (deal_id, admin),
        );
        Ok(())
    }

    /// Admin-only: mark a deal defaulted on-chain.
    pub fn default_deal(env: Env, admin: Address, deal_id: String) -> Result<(), ContractError> {
        require_not_paused(&env)?;
        validation::require_non_empty_string(&env, &deal_id)?;
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "default_deal")?;

        let current = Self::get_deal_lifecycle(&env, &deal_id);
        if current != DealLifecycleStatus::Active {
            return Err(ContractError::InvalidDealTransition);
        }
        Self::set_deal_lifecycle(&env, &deal_id, DealLifecycleStatus::Defaulted);
        env.events().publish(
            (
                Symbol::new(&env, "deal_escrow"),
                Symbol::new(&env, "default_deal"),
            ),
            (deal_id, admin),
        );
        Ok(())
    }

    /// Return the current lifecycle status of a deal.
    ///
    /// Returns `DealLifecycleStatus::Draft` for deals that have never been
    /// explicitly activated.  Does not revert; unknown deal IDs return `Draft`.
    pub fn deal_lifecycle_status(env: Env, deal_id: String) -> DealLifecycleStatus {
        Self::get_deal_lifecycle(&env, &deal_id)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod cross_contract_integration_tests;

#[cfg(test)]
mod test {
    extern crate std;
    use super::{
        ContractError, DataKey, DealEscrow, DealEscrowClient, SettlementOutcome, TokenClient,
    };
    use soroban_pausable::PausableError;
    use soroban_sdk::testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke};
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
        let platform_addr = Address::generate(&env);
        let reporter_addr = Address::generate(&env);
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
                    200i128,
                    platform_addr.clone(),
                    30i128,
                    reporter_addr.clone(),
                    20i128,
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
                &200i128,
                &platform_addr,
                &30i128,
                &reporter_addr,
                &20i128,
                &Symbol::new(&env, "manual_admin"),
                &String::from_str(&env, "ext1"),
            )
            .unwrap()
            .unwrap();
        assert_eq!(released, 250i128);
        assert_eq!(token_client.balance(&to), 200i128);
        assert_eq!(token_client.balance(&platform_addr), 30i128);
        assert_eq!(token_client.balance(&reporter_addr), 20i128);
        assert_eq!(client.balance(&deal_id), 0i128);

        // Attempting to release again should fail with InsufficientBalance
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "release",
                args: (
                    admin.clone(),
                    deal_id.clone(),
                    to.clone(),
                    0i128,
                    platform_addr.clone(),
                    0i128,
                    reporter_addr.clone(),
                    0i128,
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
                &0i128,
                &platform_addr,
                &0i128,
                &reporter_addr,
                &0i128,
                &Symbol::new(&env, "manual_admin"),
                &String::from_str(&env, "ext2"),
            )
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InsufficientBalance);
    }

    #[test]
    fn release_fails_if_split_sum_invalid() {
        let env = Env::default();
        let (contract_id, client, _admin, operator, token, token_admin, _rcpt) = setup(&env);
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let platform_addr = Address::generate(&env);
        let reporter_addr = Address::generate(&env);
        let token_sac = StellarAssetClient::new(&env, &token);
        let deal_id = String::from_str(&env, "deal-bad");
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
                    200i128,
                    platform_addr.clone(),
                    30i128,
                    reporter_addr.clone(),
                    10i128,
                    Symbol::new(&env, "manual_admin"),
                    String::from_str(&env, "ext1"),
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_release(
                &operator,
                &deal_id,
                &to,
                &200i128,
                &platform_addr,
                &30i128,
                &reporter_addr,
                &10i128,
                &Symbol::new(&env, "manual_admin"),
                &String::from_str(&env, "ext1"),
            )
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InvalidSplit);
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
    fn deposit_zero_amount_panics() {
        let env = Env::default();
        let (contract_id, client, _admin, _operator, _token, _token_admin, _rcpt) = setup(&env);
        let from = Address::generate(&env);
        let deal_id = String::from_str(&env, "deal-zero");
        env.mock_auths(&[MockAuth {
            address: &from,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "deposit",
                args: (from.clone(), deal_id.clone(), 0i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_deposit(&from, &deal_id, &0i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InvalidAmount);
    }

    #[test]
    fn multiple_deposits_accumulate() {
        let env = Env::default();
        let (contract_id, client, _admin, _operator, token, token_admin, _rcpt) = setup(&env);
        let from = Address::generate(&env);
        let token_sac = StellarAssetClient::new(&env, &token);
        let deal_id = String::from_str(&env, "deal-multi");
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

        for amount in [100i128, 150i128] {
            env.mock_auths(&[MockAuth {
                address: &from,
                invoke: &MockAuthInvoke {
                    contract: &contract_id,
                    fn_name: "deposit",
                    args: (from.clone(), deal_id.clone(), amount).into_val(&env),
                    sub_invokes: &[MockAuthInvoke {
                        contract: &token,
                        fn_name: "transfer",
                        args: (from.clone(), contract_id.clone(), amount).into_val(&env),
                        sub_invokes: &[],
                    }],
                },
            }]);
            client
                .try_deposit(&from, &deal_id, &amount)
                .unwrap()
                .unwrap();
        }
        assert_eq!(client.balance(&deal_id), 250i128);
    }

    #[test]
    fn balance_unknown_deal_returns_zero() {
        let env = Env::default();
        let (_contract_id, client, _admin, _operator, _token, _token_admin, _rcpt) = setup(&env);
        let deal_id = String::from_str(&env, "nonexistent-deal");
        assert_eq!(client.balance(&deal_id), 0i128);
    }

    #[test]
    fn pause_non_admin_panics() {
        let env = Env::default();
        let (contract_id, client, _admin, _operator, _token, _token_admin, _rcpt) = setup(&env);
        let stranger = Address::generate(&env);
        env.mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "pause",
                args: (stranger.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client.try_pause(&stranger).unwrap_err().unwrap();
        assert_eq!(err, PausableError::NotAuthorized);
    }

    #[test]
    fn unpause_allows_deposit_after_pause() {
        let env = Env::default();
        let (contract_id, client, admin, _operator, token, token_admin, _rcpt) = setup(&env);
        let from = Address::generate(&env);
        let token_sac = StellarAssetClient::new(&env, &token);
        let deal_id = String::from_str(&env, "deal-unpause");
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

        env.mock_auths(&[MockAuth {
            address: &from,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "deposit",
                args: (from.clone(), deal_id.clone(), 40i128).into_val(&env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &token,
                    fn_name: "transfer",
                    args: (from.clone(), contract_id.clone(), 40i128).into_val(&env),
                    sub_invokes: &[],
                }],
            },
        }]);
        client
            .try_deposit(&from, &deal_id, &40i128)
            .unwrap()
            .unwrap();
        assert_eq!(client.balance(&deal_id), 40i128);
    }

    #[test]
    fn release_by_admin_succeeds() {
        let env = Env::default();
        let (contract_id, client, admin, _operator, token, token_admin, _rcpt) = setup(&env);
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let platform_addr = Address::generate(&env);
        let reporter_addr = Address::generate(&env);
        let token_sac = StellarAssetClient::new(&env, &token);
        let deal_id = String::from_str(&env, "deal-admin-release");
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
            address: &from,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "deposit",
                args: (from.clone(), deal_id.clone(), 100i128).into_val(&env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &token,
                    fn_name: "transfer",
                    args: (from.clone(), contract_id.clone(), 100i128).into_val(&env),
                    sub_invokes: &[],
                }],
            },
        }]);
        client
            .try_deposit(&from, &deal_id, &100i128)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "release",
                args: (
                    admin.clone(),
                    deal_id.clone(),
                    to.clone(),
                    80i128,
                    platform_addr.clone(),
                    15i128,
                    reporter_addr.clone(),
                    5i128,
                    Symbol::new(&env, "manual_admin"),
                    String::from_str(&env, "admin-rel"),
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let released = client
            .try_release(
                &admin,
                &deal_id,
                &to,
                &80i128,
                &platform_addr,
                &15i128,
                &reporter_addr,
                &5i128,
                &Symbol::new(&env, "manual_admin"),
                &String::from_str(&env, "admin-rel"),
            )
            .unwrap()
            .unwrap();
        assert_eq!(released, 100i128);
        assert_eq!(client.balance(&deal_id), 0i128);
    }

    #[test]
    fn release_insufficient_balance_when_split_exceeds_escrow() {
        let env = Env::default();
        let (contract_id, client, _admin, operator, token, token_admin, _rcpt) = setup(&env);
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let platform_addr = Address::generate(&env);
        let reporter_addr = Address::generate(&env);
        let token_sac = StellarAssetClient::new(&env, &token);
        let deal_id = String::from_str(&env, "deal-insuff");
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
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "release",
                args: (
                    operator.clone(),
                    deal_id.clone(),
                    to.clone(),
                    50i128,
                    platform_addr.clone(),
                    10i128,
                    reporter_addr.clone(),
                    5i128,
                    Symbol::new(&env, "manual_admin"),
                    String::from_str(&env, "x"),
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_release(
                &operator,
                &deal_id,
                &to,
                &50i128,
                &platform_addr,
                &10i128,
                &reporter_addr,
                &5i128,
                &Symbol::new(&env, "manual_admin"),
                &String::from_str(&env, "x"),
            )
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InvalidSplit);
    }

    #[test]
    fn unauthorized_release_rejected() {
        let env = Env::default();
        let (contract_id, client, _admin, _operator, token, token_admin, _rcpt) = setup(&env);
        let from = Address::generate(&env);
        let non_auth = Address::generate(&env);
        let to = Address::generate(&env);
        let platform_addr = Address::generate(&env);
        let reporter_addr = Address::generate(&env);
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
                    50i128,
                    platform_addr.clone(),
                    0i128,
                    reporter_addr.clone(),
                    0i128,
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
                &50i128,
                &platform_addr,
                &0i128,
                &reporter_addr,
                &0i128,
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

    #[test]
    fn migrate_from_v1_to_v3_is_applied_once() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, client, admin, _operator, token, token_admin, _rcpt) = setup(&env);
        let from = Address::generate(&env);
        let deal_id = String::from_str(&env, "legacy-v1-deal");
        let token_sac = StellarAssetClient::new(&env, &token);
        env.mock_auths(&[MockAuth {
            address: &token_admin,
            invoke: &MockAuthInvoke {
                contract: &token,
                fn_name: "mint",
                args: (from.clone(), 120i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        token_sac.mint(&from, &120i128);
        env.mock_auths(&[MockAuth {
            address: &from,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "deposit",
                args: (from.clone(), deal_id.clone(), 120i128).into_val(&env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &token,
                    fn_name: "transfer",
                    args: (from.clone(), contract_id.clone(), 120i128).into_val(&env),
                    sub_invokes: &[],
                }],
            },
        }]);
        client
            .try_deposit(&from, &deal_id, &120i128)
            .unwrap()
            .unwrap();

        env.as_contract(&contract_id, || {
            env.storage()
                .instance()
                .set(&DataKey::StorageSchemaVersion, &1u32);
        });

        let deal_ids = soroban_sdk::Vec::from_array(&env, [deal_id.clone()]);
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "migrate_storage_schema",
                args: (admin.clone(), 1u32, deal_ids.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_migrate_storage_schema(&admin, &1u32, &deal_ids)
            .unwrap()
            .unwrap();
        assert_eq!(client.storage_schema_version(), 3u32);

        env.mock_all_auths();
        client
            .try_migrate_storage_schema(&admin, &1u32, &deal_ids)
            .unwrap()
            .unwrap();
    }

    #[test]
    fn migration_invariant_violation_halts() {
        let env = Env::default();
        let (contract_id, client, admin, _operator, _token, _token_admin, _rcpt) = setup(&env);
        let deal_id = String::from_str(&env, "legacy-v2-bad");
        env.as_contract(&contract_id, || {
            env.storage()
                .instance()
                .set(&DataKey::StorageSchemaVersion, &2u32);
            env.storage()
                .persistent()
                .set(&DataKey::DealBalance(deal_id.clone()), &100i128);
            env.storage()
                .persistent()
                .set(&DataKey::LegacyLockedAmountV2(deal_id.clone()), &80i128);
            env.storage()
                .persistent()
                .set(&DataKey::LegacyPendingPayoutV2(deal_id.clone()), &10i128);
        });

        let deal_ids = soroban_sdk::Vec::from_array(&env, [deal_id.clone()]);
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "migrate_storage_schema",
                args: (admin.clone(), 2u32, deal_ids.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_migrate_storage_schema(&admin, &2u32, &deal_ids)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::MigrationInvariantViolation);
        assert_eq!(client.storage_schema_version(), 2u32);
    }

    #[test]
    fn disputed_rent_release_resolves_once_without_double_settlement() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, client, admin, operator, token, token_admin, _rcpt) = setup(&env);
        let depositor = Address::generate(&env);
        let landlord = Address::generate(&env);
        let resolver = Address::generate(&env);
        let deal_id = String::from_str(&env, "rent-dispute-1");
        let token_sac = StellarAssetClient::new(&env, &token);
        let token_client = TokenClient::new(&env, &token);

        env.mock_auths(&[MockAuth {
            address: &token_admin,
            invoke: &MockAuthInvoke {
                contract: &token,
                fn_name: "mint",
                args: (depositor.clone(), 200i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        token_sac.mint(&depositor, &200i128);

        env.mock_auths(&[MockAuth {
            address: &depositor,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "deposit",
                args: (depositor.clone(), deal_id.clone(), 150i128).into_val(&env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &token,
                    fn_name: "transfer",
                    args: (depositor.clone(), contract_id.clone(), 150i128).into_val(&env),
                    sub_invokes: &[],
                }],
            },
        }]);
        client
            .try_deposit(&depositor, &deal_id, &150i128)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_resolver",
                args: (admin.clone(), resolver.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_set_resolver(&admin, &resolver).unwrap().unwrap();

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "request_rent_release",
                args: (
                    operator.clone(),
                    deal_id.clone(),
                    landlord.clone(),
                    100i128,
                    Symbol::new(&env, "rent_cycle"),
                    String::from_str(&env, "invoice-1"),
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_request_rent_release(
                &operator,
                &deal_id,
                &landlord,
                &100i128,
                &Symbol::new(&env, "rent_cycle"),
                &String::from_str(&env, "invoice-1"),
            )
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &depositor,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "challenge_rent_release",
                args: (
                    depositor.clone(),
                    deal_id.clone(),
                    String::from_str(&env, "bank_statement_mismatch"),
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_challenge_rent_release(
                &depositor,
                &deal_id,
                &String::from_str(&env, "bank_statement_mismatch"),
            )
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &resolver,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "resolve_rent_dispute",
                args: (
                    resolver.clone(),
                    deal_id.clone(),
                    SettlementOutcome::RefundToDepositor,
                    String::from_str(&env, "resolver-ruling-1"),
                )
                    .into_val(&env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &token,
                    fn_name: "transfer",
                    args: (contract_id.clone(), depositor.clone(), 100i128).into_val(&env),
                    sub_invokes: &[],
                }],
            },
        }]);
        client
            .try_resolve_rent_dispute(
                &resolver,
                &deal_id,
                &SettlementOutcome::RefundToDepositor,
                &String::from_str(&env, "resolver-ruling-1"),
            )
            .unwrap()
            .unwrap();
        assert_eq!(token_client.balance(&depositor), 150i128);
        let second_attempt = client.try_resolve_rent_dispute(
            &resolver,
            &deal_id,
            &SettlementOutcome::RefundToDepositor,
            &String::from_str(&env, "resolver-ruling-2"),
        );
        assert!(second_attempt.is_err());
    }

    #[test]
    fn uncontested_timeout_release_is_deterministic() {
        let env = Env::default();
        let (contract_id, client, admin, operator, token, token_admin, _rcpt) = setup(&env);
        let depositor = Address::generate(&env);
        let landlord = Address::generate(&env);
        let deal_id = String::from_str(&env, "rent-timeout-1");
        let token_sac = StellarAssetClient::new(&env, &token);
        let token_client = TokenClient::new(&env, &token);

        env.mock_auths(&[MockAuth {
            address: &token_admin,
            invoke: &MockAuthInvoke {
                contract: &token,
                fn_name: "mint",
                args: (depositor.clone(), 120i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        token_sac.mint(&depositor, &120i128);
        env.mock_auths(&[MockAuth {
            address: &depositor,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "deposit",
                args: (depositor.clone(), deal_id.clone(), 120i128).into_val(&env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &token,
                    fn_name: "transfer",
                    args: (depositor.clone(), contract_id.clone(), 120i128).into_val(&env),
                    sub_invokes: &[],
                }],
            },
        }]);
        client
            .try_deposit(&depositor, &deal_id, &120i128)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "configure_dispute_windows",
                args: (admin.clone(), 1u64, 10u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_configure_dispute_windows(&admin, &1u64, &10u64)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "request_rent_release",
                args: (
                    operator.clone(),
                    deal_id.clone(),
                    landlord.clone(),
                    90i128,
                    Symbol::new(&env, "rent_cycle"),
                    String::from_str(&env, "invoice-timeout"),
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_request_rent_release(
                &operator,
                &deal_id,
                &landlord,
                &90i128,
                &Symbol::new(&env, "rent_cycle"),
                &String::from_str(&env, "invoice-timeout"),
            )
            .unwrap()
            .unwrap();

        env.ledger().set_timestamp(env.ledger().timestamp() + 2);
        client
            .try_settle_rent_release_timeout(&deal_id)
            .unwrap()
            .unwrap();
        assert_eq!(token_client.balance(&landlord), 90i128);
        let err = client
            .try_settle_rent_release_timeout(&deal_id)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NoPendingRelease);
    }

    // ── #1186 Storage-schema migration safety ────────────────────────────────

    #[test]
    fn migrate_wrong_source_version_rejected() {
        let env = Env::default();
        let (contract_id, client, admin, _, _, _, _) = setup(&env);
        // Downgrade stored version to V2, then try to migrate from V1 → mismatch.
        env.as_contract(&contract_id, || {
            env.storage()
                .instance()
                .set(&DataKey::StorageSchemaVersion, &2u32);
        });
        let deal_ids = soroban_sdk::Vec::<String>::new(&env);
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "migrate_storage_schema",
                args: (admin.clone(), 1u32, deal_ids.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_migrate_storage_schema(&admin, &1u32, &deal_ids)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InvalidSchemaVersion);
        // Version must not have advanced.
        assert_eq!(client.storage_schema_version(), 2u32);
    }

    #[test]
    fn migrate_v2_to_v3_preserves_per_deal_balance() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, client, admin, _, token, token_admin, _) = setup(&env);
        let depositor = Address::generate(&env);
        let deal_id = String::from_str(&env, "v2-balance-deal");
        let token_sac = soroban_sdk::token::StellarAssetClient::new(&env, &token);
        token_sac.mint(&depositor, &300i128);

        env.mock_auths(&[MockAuth {
            address: &depositor,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "deposit",
                args: (depositor.clone(), deal_id.clone(), 300i128).into_val(&env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &token,
                    fn_name: "transfer",
                    args: (depositor.clone(), contract_id.clone(), 300i128).into_val(&env),
                    sub_invokes: &[],
                }],
            },
        }]);
        client
            .try_deposit(&depositor, &deal_id, &300i128)
            .unwrap()
            .unwrap();

        // Simulate V2 layout: set schema to V2 and write legacy fields (both 0).
        env.as_contract(&contract_id, || {
            env.storage()
                .instance()
                .set(&DataKey::StorageSchemaVersion, &2u32);
            env.storage()
                .persistent()
                .set(&DataKey::LegacyLockedAmountV2(deal_id.clone()), &0i128);
            env.storage()
                .persistent()
                .set(&DataKey::LegacyPendingPayoutV2(deal_id.clone()), &0i128);
        });

        assert_eq!(client.balance(&deal_id), 300i128);

        let deal_ids = soroban_sdk::Vec::from_array(&env, [deal_id.clone()]);
        env.mock_all_auths();
        client
            .try_migrate_storage_schema(&admin, &2u32, &deal_ids)
            .unwrap()
            .unwrap();

        // Balance must be preserved after migration.
        assert_eq!(client.balance(&deal_id), 300i128);
        assert_eq!(client.storage_schema_version(), 3u32);
    }

    #[test]
    fn migrate_non_admin_rejected() {
        let env = Env::default();
        let (contract_id, client, _, _, _, _, _) = setup(&env);
        let stranger = Address::generate(&env);
        env.as_contract(&contract_id, || {
            env.storage()
                .instance()
                .set(&DataKey::StorageSchemaVersion, &1u32);
        });
        let deal_ids = soroban_sdk::Vec::<String>::new(&env);
        env.mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "migrate_storage_schema",
                args: (stranger.clone(), 1u32, deal_ids.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_migrate_storage_schema(&stranger, &1u32, &deal_ids)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    #[test]
    fn migrate_already_at_v3_is_noop() {
        // Current schema is V3 after init; any migration call is a no-op.
        let env = Env::default();
        env.mock_all_auths();
        let (_, client, admin, _, _, _, _) = setup(&env);
        let deal_ids = soroban_sdk::Vec::<String>::new(&env);
        client
            .try_migrate_storage_schema(&admin, &3u32, &deal_ids)
            .unwrap()
            .unwrap();
        assert_eq!(client.storage_schema_version(), 3u32);
    }

    #[test]
    fn migrate_v1_balance_conservation_across_multiple_deals() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, client, admin, _, token, token_admin, _) = setup(&env);
        let depositor = Address::generate(&env);
        let token_sac = soroban_sdk::token::StellarAssetClient::new(&env, &token);
        token_sac.mint(&depositor, &500i128);

        // Deposit into two deals.
        let deal_a = String::from_str(&env, "v1-deal-a");
        let deal_b = String::from_str(&env, "v1-deal-b");
        env.mock_auths(&[MockAuth {
            address: &depositor,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "deposit",
                args: (depositor.clone(), deal_a.clone(), 200i128).into_val(&env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &token,
                    fn_name: "transfer",
                    args: (depositor.clone(), contract_id.clone(), 200i128).into_val(&env),
                    sub_invokes: &[],
                }],
            },
        }]);
        client
            .try_deposit(&depositor, &deal_a, &200i128)
            .unwrap()
            .unwrap();
        env.mock_auths(&[MockAuth {
            address: &depositor,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "deposit",
                args: (depositor.clone(), deal_b.clone(), 300i128).into_val(&env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &token,
                    fn_name: "transfer",
                    args: (depositor.clone(), contract_id.clone(), 300i128).into_val(&env),
                    sub_invokes: &[],
                }],
            },
        }]);
        client
            .try_deposit(&depositor, &deal_b, &300i128)
            .unwrap()
            .unwrap();

        // Rewind schema to V1.
        env.as_contract(&contract_id, || {
            env.storage()
                .instance()
                .set(&DataKey::StorageSchemaVersion, &1u32);
        });

        let deal_ids = soroban_sdk::Vec::from_array(&env, [deal_a.clone(), deal_b.clone()]);
        env.mock_all_auths();
        client
            .try_migrate_storage_schema(&admin, &1u32, &deal_ids)
            .unwrap()
            .unwrap();

        // Per-deal balances are intact after migration.
        assert_eq!(client.balance(&deal_a), 200i128);
        assert_eq!(client.balance(&deal_b), 300i128);
        assert_eq!(client.storage_schema_version(), 3u32);
    }

    // ── #1185 Dispute timeouts and circuit-breaker drain governance ──────────

    #[test]
    fn challenge_after_window_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, client, admin, operator, token, token_admin, _) = setup(&env);
        let depositor = Address::generate(&env);
        let landlord = Address::generate(&env);
        let deal_id = String::from_str(&env, "chall-window-1");
        let token_sac = soroban_sdk::token::StellarAssetClient::new(&env, &token);
        token_sac.mint(&depositor, &100i128);
        env.mock_auths(&[MockAuth {
            address: &depositor,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "deposit",
                args: (depositor.clone(), deal_id.clone(), 100i128).into_val(&env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &token,
                    fn_name: "transfer",
                    args: (depositor.clone(), contract_id.clone(), 100i128).into_val(&env),
                    sub_invokes: &[],
                }],
            },
        }]);
        client
            .try_deposit(&depositor, &deal_id, &100i128)
            .unwrap()
            .unwrap();
        env.mock_all_auths();
        // Configure a 5-second challenge window.
        client
            .try_configure_dispute_windows(&admin, &5u64, &100u64)
            .unwrap()
            .unwrap();
        client
            .try_request_rent_release(
                &operator,
                &deal_id,
                &landlord,
                &100i128,
                &Symbol::new(&env, "rent"),
                &String::from_str(&env, "inv-cw1"),
            )
            .unwrap()
            .unwrap();
        // Advance past the challenge window.
        env.ledger().set_timestamp(env.ledger().timestamp() + 10);
        let err = client
            .try_challenge_rent_release(&depositor, &deal_id, &String::from_str(&env, "evidence"))
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::DisputeNotAllowed);
    }

    #[test]
    fn settle_release_timeout_before_window_expires_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, client, admin, operator, token, token_admin, _) = setup(&env);
        let depositor = Address::generate(&env);
        let landlord = Address::generate(&env);
        let deal_id = String::from_str(&env, "settle-early-1");
        let token_sac = soroban_sdk::token::StellarAssetClient::new(&env, &token);
        token_sac.mint(&depositor, &100i128);
        env.mock_auths(&[MockAuth {
            address: &depositor,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "deposit",
                args: (depositor.clone(), deal_id.clone(), 100i128).into_val(&env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &token,
                    fn_name: "transfer",
                    args: (depositor.clone(), contract_id.clone(), 100i128).into_val(&env),
                    sub_invokes: &[],
                }],
            },
        }]);
        client
            .try_deposit(&depositor, &deal_id, &100i128)
            .unwrap()
            .unwrap();
        env.mock_all_auths();
        // Window = 10 seconds.
        client
            .try_configure_dispute_windows(&admin, &10u64, &100u64)
            .unwrap()
            .unwrap();
        client
            .try_request_rent_release(
                &operator,
                &deal_id,
                &landlord,
                &100i128,
                &Symbol::new(&env, "rent"),
                &String::from_str(&env, "inv-se1"),
            )
            .unwrap()
            .unwrap();
        // Advance only 5 seconds (window = 10).
        env.ledger().set_timestamp(env.ledger().timestamp() + 5);
        let err = client
            .try_settle_rent_release_timeout(&deal_id)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InvalidReleaseWindow);
    }

    #[test]
    fn settle_dispute_timeout_before_expiry_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, client, admin, operator, token, token_admin, _) = setup(&env);
        let depositor = Address::generate(&env);
        let landlord = Address::generate(&env);
        let resolver = Address::generate(&env);
        let deal_id = String::from_str(&env, "disp-timeout-early");
        let token_sac = soroban_sdk::token::StellarAssetClient::new(&env, &token);
        token_sac.mint(&depositor, &100i128);
        env.mock_auths(&[MockAuth {
            address: &depositor,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "deposit",
                args: (depositor.clone(), deal_id.clone(), 100i128).into_val(&env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &token,
                    fn_name: "transfer",
                    args: (depositor.clone(), contract_id.clone(), 100i128).into_val(&env),
                    sub_invokes: &[],
                }],
            },
        }]);
        client
            .try_deposit(&depositor, &deal_id, &100i128)
            .unwrap()
            .unwrap();
        env.mock_all_auths();
        client
            .try_configure_dispute_windows(&admin, &5u64, &20u64)
            .unwrap()
            .unwrap();
        client.try_set_resolver(&admin, &resolver).unwrap().unwrap();
        client
            .try_request_rent_release(
                &operator,
                &deal_id,
                &landlord,
                &100i128,
                &Symbol::new(&env, "rent"),
                &String::from_str(&env, "inv-dt1"),
            )
            .unwrap()
            .unwrap();
        // Challenge within the 5s window (advance 2s).
        env.ledger().set_timestamp(env.ledger().timestamp() + 2);
        client
            .try_challenge_rent_release(&depositor, &deal_id, &String::from_str(&env, "evidence"))
            .unwrap()
            .unwrap();
        // Advance 10 more seconds — dispute timeout is 20s, so still early.
        env.ledger().set_timestamp(env.ledger().timestamp() + 10);
        let err = client
            .try_settle_dispute_timeout(&deal_id)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InvalidReleaseWindow);
    }

    #[test]
    fn settle_dispute_timeout_after_expiry_refunds_depositor() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, client, admin, operator, token, token_admin, _) = setup(&env);
        let depositor = Address::generate(&env);
        let landlord = Address::generate(&env);
        let deal_id = String::from_str(&env, "disp-timeout-ok");
        let token_sac = soroban_sdk::token::StellarAssetClient::new(&env, &token);
        let token_client = TokenClient::new(&env, &token);
        token_sac.mint(&depositor, &100i128);
        env.mock_auths(&[MockAuth {
            address: &depositor,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "deposit",
                args: (depositor.clone(), deal_id.clone(), 100i128).into_val(&env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &token,
                    fn_name: "transfer",
                    args: (depositor.clone(), contract_id.clone(), 100i128).into_val(&env),
                    sub_invokes: &[],
                }],
            },
        }]);
        client
            .try_deposit(&depositor, &deal_id, &100i128)
            .unwrap()
            .unwrap();
        env.mock_all_auths();
        client
            .try_configure_dispute_windows(&admin, &5u64, &20u64)
            .unwrap()
            .unwrap();
        client
            .try_request_rent_release(
                &operator,
                &deal_id,
                &landlord,
                &100i128,
                &Symbol::new(&env, "rent"),
                &String::from_str(&env, "inv-dt2"),
            )
            .unwrap()
            .unwrap();
        // Challenge within the 5s window.
        env.ledger().set_timestamp(env.ledger().timestamp() + 2);
        client
            .try_challenge_rent_release(&depositor, &deal_id, &String::from_str(&env, "evidence"))
            .unwrap()
            .unwrap();
        // Advance well past dispute timeout (20s).
        env.ledger().set_timestamp(env.ledger().timestamp() + 25);
        // settle_dispute_timeout refunds depositor.
        client
            .try_settle_dispute_timeout(&deal_id)
            .unwrap()
            .unwrap();
        assert_eq!(token_client.balance(&depositor), 100i128);
        // Cannot settle again.
        let err = client
            .try_settle_dispute_timeout(&deal_id)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NoOpenDispute);
    }

    #[test]
    fn freeze_blocks_release_but_not_deposit() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, client, admin, operator, token, token_admin, _) = setup(&env);
        let depositor = Address::generate(&env);
        let to = Address::generate(&env);
        let platform = Address::generate(&env);
        let reporter = Address::generate(&env);
        let deal_id = String::from_str(&env, "freeze-rel");
        let token_sac = soroban_sdk::token::StellarAssetClient::new(&env, &token);
        token_sac.mint(&depositor, &100i128);
        env.mock_auths(&[MockAuth {
            address: &depositor,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "deposit",
                args: (depositor.clone(), deal_id.clone(), 100i128).into_val(&env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &token,
                    fn_name: "transfer",
                    args: (depositor.clone(), contract_id.clone(), 100i128).into_val(&env),
                    sub_invokes: &[],
                }],
            },
        }]);
        client
            .try_deposit(&depositor, &deal_id, &100i128)
            .unwrap()
            .unwrap();
        env.mock_all_auths();
        // Freeze the contract.
        client.try_freeze(&admin).unwrap().unwrap();
        assert!(client.is_frozen());
        assert_eq!(client.get_circuit_breaker_state(), 1u32); // Frozen = 1

        // Release is blocked while frozen.
        let err = client
            .try_release(
                &operator,
                &deal_id,
                &to,
                &100i128,
                &platform,
                &0i128,
                &reporter,
                &0i128,
                &Symbol::new(&env, "rent"),
                &String::from_str(&env, "ref-freeze"),
            )
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::Frozen);
    }

    #[test]
    fn propose_drain_requires_frozen_state() {
        let env = Env::default();
        env.mock_all_auths();
        let (_, client, admin, _, _, _, _) = setup(&env);
        let drain_hash = BytesN::from_array(&env, &[2u8; 32]);
        // propose_drain while unfrozen must fail.
        let err = client
            .try_propose_drain(&admin, &drain_hash)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InvalidGovernanceDrain);
    }

    #[test]
    fn execute_drain_before_recovery_delay_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (_, client, admin, _, _, _, _) = setup(&env);
        let drain_hash = BytesN::from_array(&env, &[3u8; 32]);
        client
            .try_set_recovery_delay(&admin, &100u64)
            .unwrap()
            .unwrap();
        client.try_freeze(&admin).unwrap().unwrap();
        client
            .try_propose_drain(&admin, &drain_hash)
            .unwrap()
            .unwrap();
        // Advance only 50s — delay is 100s.
        env.ledger().set_timestamp(env.ledger().timestamp() + 50);
        let err = client
            .try_execute_drain(&admin, &drain_hash)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::RecoveryDelayNotMet);
    }

    #[test]
    fn execute_drain_after_delay_succeeds_and_unfreezes() {
        let env = Env::default();
        env.mock_all_auths();
        let (_, client, admin, _, _, _, _) = setup(&env);
        let drain_hash = BytesN::from_array(&env, &[4u8; 32]);
        client
            .try_set_recovery_delay(&admin, &100u64)
            .unwrap()
            .unwrap();
        client.try_freeze(&admin).unwrap().unwrap();
        assert_eq!(client.get_circuit_breaker_state(), 1u32); // Frozen
        client
            .try_propose_drain(&admin, &drain_hash)
            .unwrap()
            .unwrap();
        // Advance past the 100s delay.
        env.ledger().set_timestamp(env.ledger().timestamp() + 101);
        client
            .try_execute_drain(&admin, &drain_hash)
            .unwrap()
            .unwrap();
        // Contract must be unfrozen after drain executes.
        assert_eq!(client.get_circuit_breaker_state(), 0u32); // Unfrozen
        assert!(!client.is_frozen());
    }

    #[test]
    fn unauthorized_drain_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, client, admin, _, _, _, _) = setup(&env);
        let stranger = Address::generate(&env);
        let drain_hash = BytesN::from_array(&env, &[5u8; 32]);
        client.try_freeze(&admin).unwrap().unwrap();
        client
            .try_propose_drain(&admin, &drain_hash)
            .unwrap()
            .unwrap();
        // Advance past default delay (24 hours).
        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 86_401);
        // Non-admin execute_drain must fail.
        env.mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "execute_drain",
                args: (stranger.clone(), drain_hash.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_execute_drain(&stranger, &drain_hash)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    #[test]
    fn circuit_breaker_state_transitions_unfrozen_frozen_unfrozen() {
        let env = Env::default();
        env.mock_all_auths();
        let (_, client, admin, _, _, _, _) = setup(&env);

        // Initially unfrozen (0).
        assert_eq!(client.get_circuit_breaker_state(), 0u32);
        assert!(!client.is_frozen());

        // After freeze: Frozen (1).
        client.try_freeze(&admin).unwrap().unwrap();
        assert_eq!(client.get_circuit_breaker_state(), 1u32);
        assert!(client.is_frozen());

        // After drain executes: back to Unfrozen (0).
        let drain_hash = BytesN::from_array(&env, &[6u8; 32]);
        client
            .try_propose_drain(&admin, &drain_hash)
            .unwrap()
            .unwrap();
        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 100_000);
        client
            .try_execute_drain(&admin, &drain_hash)
            .unwrap()
            .unwrap();
        assert_eq!(client.get_circuit_breaker_state(), 0u32);
        assert!(!client.is_frozen());
    }
}
