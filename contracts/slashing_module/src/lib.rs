#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Bytes, BytesN, Env, String,
    Symbol, Vec,
};

/// Maximum reporter reward as a fraction of the slashed amount, in basis points.
/// A reporter who surfaces a valid slash earns at most this percentage of the
/// slashed tokens (issue #1199 — bounded reporter reward on finalized slash).
/// 500 bps = 5 %.
pub const MAX_REPORTER_REWARD_BPS: u32 = 500;

// ── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Paused,
    /// Authorized evidence submitters
    Submitter(Address),
    /// Slash record keyed by commitment hash (duplicate detection)
    SlashRecord(Bytes),
    /// Per-actor slash count (for indexing / audit)
    SlashCount(Address),
    /// Per-actor slash balance reduction total
    SlashedAmount(Address),
    /// Jailed actors → jailed = true
    Jailed(Address),
    /// Per-actor staked balance (managed externally; tracked here for slashing)
    StakedBalance(Address),
    /// Governance-approved unjail flag (set by admin; consumed on unjail)
    UnjailApproval(Address),

    // ── Inspector bond slashing (Issue #925) ─────────────────────────────
    /// Registered bond_collateral contract; only this address may call `slash`.
    BondContract,
    /// Slash history per inspector (append-only).
    InspectorSlashHistory(Address),

    // ── Two-Phase Slashing (Issue #1082) ──────────────────────────────────
    ChallengeWindow,
    NextSlashId,
    PendingSlash(u64),

    // ── Commit-Reveal (Issue #1131) ───────────────────────────────────────
    /// Whether the commitment for a slash has been validly revealed
    CommitmentRevealed(u64),

    // ── Configurable tier BPS (Issue #1131) ──────────────────────────────
    TierDoubleSignBps,
    TierDowntimeBps,
    TierInvalidBlockBps,
    /// Hard cap on slash fraction (in bps). No slash may exceed this.
    MaxSlashBps,
}

/// Single slash entry recorded against an inspector by the bond contract
/// (Issue #925). Distinct from `SlashEvidence`, which lives in the
/// validator-style evidence flow.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InspectorSlashRecord {
    pub inspection_id: String,
    pub amount: i128,
    pub reason: String,
    pub slashed_at: u64,
}

// ── Two-Phase Slashing Status and Struct ──────────────────────────────────────

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum SlashStatus {
    Pending = 0,
    Finalized = 1,
    Cancelled = 2,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingSlash {
    pub id: u64,
    pub actor: Address,
    pub amount: i128,
    pub deadline: u64,
    pub status: SlashStatus,
    pub is_validator: bool,
    /// Commitment hash (sha256 of evidence || salt) stored at commit time.
    pub evidence_hash: Option<Bytes>,
    pub offence: Offence,
    pub submitter: Option<Address>,
    pub penalty_bps: u32,
    pub inspection_id: Option<String>,
    pub reason: Option<String>,
}

// ── Slashable Offence Types ───────────────────────────────────────────────────

/// Default penalty ratios (bps). Overridden by `configure_tiers`.
pub const DEFAULT_DOUBLE_SIGN_BPS: u32 = 1_000; // 10%
pub const DEFAULT_DOWNTIME_BPS: u32 = 100; // 1%
pub const DEFAULT_INVALID_BLOCK_BPS: u32 = 500; // 5%
pub const DEFAULT_MAX_BPS: u32 = 10_000; // 100%

// Keep legacy exported names for backward compatibility
pub const OFFENCE_DOUBLE_SIGN_BPS: u32 = DEFAULT_DOUBLE_SIGN_BPS;
pub const OFFENCE_DOWNTIME_BPS: u32 = DEFAULT_DOWNTIME_BPS;
pub const OFFENCE_INVALID_BLOCK_BPS: u32 = DEFAULT_INVALID_BLOCK_BPS;
pub const MAX_BPS: u32 = DEFAULT_MAX_BPS;

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    /// Contract already initialized
    AlreadyInitialized = 1,
    /// Caller is not authorized
    NotAuthorized = 2,
    /// Contract is paused
    Paused = 3,
    /// Evidence was already processed (duplicate)
    DuplicateEvidence = 4,
    /// Slashed actor has no staked balance
    ZeroBalance = 5,
    /// Actor is already jailed
    AlreadyJailed = 6,
    /// Actor is not jailed (unjail attempted on unjailed actor)
    NotJailed = 7,
    /// No governance approval for unjail
    UnjailNotApproved = 8,
    /// Unknown offence type
    UnknownOffence = 9,
    /// Amount overflow or underflow
    ArithmeticError = 10,
    /// Slash ID not found
    SlashNotFound = 11,
    /// Try to finalize before the challenge window has elapsed
    ChallengeWindowNotElapsed = 12,
    /// Try to resolve or finalize an already resolved/finalized slash
    SlashAlreadyResolved = 13,
    /// Invalid slash amount (e.g. <= 0)
    InvalidAmount = 14,
    /// Evidence has not been revealed (commit-reveal not completed)
    CommitmentNotRevealed = 15,
    /// Revealed evidence does not match the stored commitment
    InvalidReveal = 16,
}

// ── Data Structures ───────────────────────────────────────────────────────────

/// Offence classification submitted with evidence
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Offence {
    DoubleSign,
    Downtime,
    InvalidBlock,
    None,
}

/// Full evidence record stored on-chain (keyed by commitment hash)
#[contracttype]
#[derive(Clone)]
pub struct SlashEvidence {
    /// The penalized actor
    pub actor: Address,
    /// Offence type
    pub offence: Offence,
    /// Evidence submitter
    pub submitter: Address,
    /// Ledger timestamp of submission
    pub submitted_at: u64,
    /// Basis-point penalty that was applied
    pub penalty_bps: u32,
    /// Token amount slashed
    pub slashed_amount: i128,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct SlashingModule;

#[contractimpl]
impl SlashingModule {
    // ── Initialization ────────────────────────────────────────────────────────

    pub fn init(env: Env, admin: Address) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.events().publish(
            (Symbol::new(&env, "slashing"), Symbol::new(&env, "init")),
            admin,
        );
        Ok(())
    }

    // ── Admin helpers ─────────────────────────────────────────────────────────

    fn require_admin(env: &Env, caller: &Address) -> Result<(), ContractError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotAuthorized)?;
        caller.require_auth();
        if caller != &admin {
            return Err(ContractError::NotAuthorized);
        }
        Ok(())
    }

    fn require_not_paused(env: &Env) -> Result<(), ContractError> {
        if env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::Paused)
            .unwrap_or(false)
        {
            return Err(ContractError::Paused);
        }
        Ok(())
    }

    /// Configure tier penalty BPS and global max. Admin-only.
    /// Call after `init` to override the hardcoded defaults.
    pub fn configure_tiers(
        env: Env,
        admin: Address,
        double_sign_bps: u32,
        downtime_bps: u32,
        invalid_block_bps: u32,
        max_slash_bps: u32,
    ) -> Result<(), ContractError> {
        Self::require_admin(&env, &admin)?;
        env.storage()
            .instance()
            .set(&DataKey::TierDoubleSignBps, &double_sign_bps);
        env.storage()
            .instance()
            .set(&DataKey::TierDowntimeBps, &downtime_bps);
        env.storage()
            .instance()
            .set(&DataKey::TierInvalidBlockBps, &invalid_block_bps);
        env.storage()
            .instance()
            .set(&DataKey::MaxSlashBps, &max_slash_bps);
        env.events().publish(
            (
                Symbol::new(&env, "slashing"),
                Symbol::new(&env, "tiers_configured"),
            ),
            (
                double_sign_bps,
                downtime_bps,
                invalid_block_bps,
                max_slash_bps,
            ),
        );
        Ok(())
    }

    fn get_tier_bps(env: &Env, offence: &Offence) -> u32 {
        match offence {
            Offence::DoubleSign => env
                .storage()
                .instance()
                .get(&DataKey::TierDoubleSignBps)
                .unwrap_or(DEFAULT_DOUBLE_SIGN_BPS),
            Offence::Downtime => env
                .storage()
                .instance()
                .get(&DataKey::TierDowntimeBps)
                .unwrap_or(DEFAULT_DOWNTIME_BPS),
            Offence::InvalidBlock => env
                .storage()
                .instance()
                .get(&DataKey::TierInvalidBlockBps)
                .unwrap_or(DEFAULT_INVALID_BLOCK_BPS),
            Offence::None => 0,
        }
    }

    fn get_max_slash_bps(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::MaxSlashBps)
            .unwrap_or(DEFAULT_MAX_BPS)
    }

    /// Register an authorized evidence submitter.
    pub fn set_submitter(
        env: Env,
        admin: Address,
        submitter: Address,
        enabled: bool,
    ) -> Result<(), ContractError> {
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &admin)?;
        env.storage()
            .instance()
            .set(&DataKey::Submitter(submitter.clone()), &enabled);
        env.events().publish(
            (
                Symbol::new(&env, "slashing"),
                Symbol::new(&env, "set_submitter"),
                submitter,
            ),
            enabled,
        );
        Ok(())
    }

    fn require_submitter(env: &Env, caller: &Address) -> Result<(), ContractError> {
        caller.require_auth();
        let enabled: bool = env
            .storage()
            .instance()
            .get(&DataKey::Submitter(caller.clone()))
            .unwrap_or(false);
        if !enabled {
            return Err(ContractError::NotAuthorized);
        }
        Ok(())
    }

    // ── Balance management ────────────────────────────────────────────────────

    /// Deposit / update an actor's staked balance (called by staking contracts or admin).
    pub fn set_staked_balance(
        env: Env,
        admin: Address,
        actor: Address,
        balance: i128,
    ) -> Result<(), ContractError> {
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &admin)?;
        env.storage()
            .persistent()
            .set(&DataKey::StakedBalance(actor), &balance);
        Ok(())
    }

    pub fn staked_balance(env: Env, actor: Address) -> i128 {
        env.storage()
            .persistent()
            .get::<_, i128>(&DataKey::StakedBalance(actor))
            .unwrap_or(0)
    }

    // ── Two-Phase Slashing Settings ──────────────────────────────────────────

    /// Configure the challenge window duration. Admin-only.
    pub fn set_challenge_window(
        env: Env,
        admin: Address,
        window_seconds: u64,
    ) -> Result<(), ContractError> {
        Self::require_admin(&env, &admin)?;
        env.storage()
            .instance()
            .set(&DataKey::ChallengeWindow, &window_seconds);
        env.events().publish(
            (
                Symbol::new(&env, "slashing"),
                Symbol::new(&env, "challenge_window_updated"),
            ),
            window_seconds,
        );
        Ok(())
    }

    /// Read the current challenge window duration.
    pub fn challenge_window(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::ChallengeWindow)
            .unwrap_or(604_800) // 7 days default
    }

    fn next_slash_id(env: &Env) -> u64 {
        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextSlashId)
            .unwrap_or(0);
        let next = id + 1;
        env.storage().instance().set(&DataKey::NextSlashId, &next);
        next
    }

    // ── Commit-Reveal helpers ─────────────────────────────────────────────────

    /// Compute sha256(evidence || salt) as a `Bytes` value suitable for
    /// comparison with the stored commitment.
    fn hash_commitment(env: &Env, evidence: &Bytes, salt: &Bytes) -> Bytes {
        let mut data = Bytes::new(env);
        data.append(evidence);
        data.append(salt);
        let hash: BytesN<32> = env.crypto().sha256(&data).into();
        Bytes::from(hash)
    }

    // ── Core: commit evidence ─────────────────────────────────────────────────

    /// Phase 1 of commit-reveal: submit the commitment hash of evidence.
    ///
    /// `commitment` must equal `sha256(evidence_bytes || salt_bytes)`.
    /// The actual evidence is only revealed in `reveal_evidence`, preventing
    /// front-running and griefing of evidence submission.
    pub fn submit_evidence(
        env: Env,
        submitter: Address,
        commitment: Bytes,
        actor: Address,
        offence: Offence,
    ) -> Result<u64, ContractError> {
        Self::require_submitter(&env, &submitter)?;

        // Duplicate commitment check (same commitment = same evidence+salt pair)
        if env
            .storage()
            .persistent()
            .has(&DataKey::SlashRecord(commitment.clone()))
        {
            return Err(ContractError::DuplicateEvidence);
        }

        // Actor must not already be jailed
        let already_jailed: bool = env
            .storage()
            .persistent()
            .get(&DataKey::Jailed(actor.clone()))
            .unwrap_or(false);
        if already_jailed {
            return Err(ContractError::AlreadyJailed);
        }

        // Determine penalty ratio from configurable tiers, bounded by max
        let raw_bps: u32 = Self::get_tier_bps(&env, &offence);
        if raw_bps == 0 {
            return Err(ContractError::UnknownOffence);
        }
        let max_bps = Self::get_max_slash_bps(&env);
        let penalty_bps = raw_bps.min(max_bps);

        // Load current staked balance
        let balance: i128 = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::StakedBalance(actor.clone()))
            .unwrap_or(0);

        if balance == 0 {
            return Err(ContractError::ZeroBalance);
        }

        // Proportional slash – saturating at full balance (no over-slash)
        let slash_amount = (balance * penalty_bps as i128) / MAX_BPS as i128;
        let slash_amount = slash_amount.min(balance);

        // Generate slash ID
        let slash_id = Self::next_slash_id(&env);
        let deadline = env.ledger().timestamp() + Self::challenge_window(env.clone());

        // Create PendingSlash; revealed = false until reveal_evidence succeeds
        let pending = PendingSlash {
            id: slash_id,
            actor: actor.clone(),
            amount: slash_amount,
            deadline,
            status: SlashStatus::Pending,
            is_validator: true,
            evidence_hash: Some(commitment.clone()),
            offence: offence.clone(),
            submitter: Some(submitter.clone()),
            penalty_bps,
            inspection_id: None,
            reason: None,
        };

        env.storage()
            .persistent()
            .set(&DataKey::PendingSlash(slash_id), &pending);

        // Mark commitment as pending (duplicate guard); store minimal evidence record
        let evidence_record = SlashEvidence {
            actor: actor.clone(),
            offence: offence.clone(),
            submitter: submitter.clone(),
            submitted_at: env.ledger().timestamp(),
            penalty_bps,
            slashed_amount: 0, // updated at finalization
        };
        env.storage()
            .persistent()
            .set(&DataKey::SlashRecord(commitment.clone()), &evidence_record);

        // CommitmentRevealed starts false
        env.storage()
            .persistent()
            .set(&DataKey::CommitmentRevealed(slash_id), &false);

        // Emit evidence_committed event
        env.events().publish(
            (
                Symbol::new(&env, "slashing"),
                Symbol::new(&env, "evidence_committed"),
                actor,
            ),
            (slash_id, slash_amount, deadline),
        );

        Ok(slash_id)
    }

    /// Phase 2 of commit-reveal: reveal evidence and salt.
    ///
    /// Computes `sha256(evidence || salt)` on-chain and verifies it matches
    /// the commitment stored at `submit_evidence` time. Must be called before
    /// `finalize_slash` for validator slashes.
    pub fn reveal_evidence(
        env: Env,
        submitter: Address,
        slash_id: u64,
        evidence: Bytes,
        salt: Bytes,
    ) -> Result<(), ContractError> {
        Self::require_submitter(&env, &submitter)?;

        let pending: PendingSlash = env
            .storage()
            .persistent()
            .get(&DataKey::PendingSlash(slash_id))
            .ok_or(ContractError::SlashNotFound)?;

        if pending.status != SlashStatus::Pending {
            return Err(ContractError::SlashAlreadyResolved);
        }

        // Check we haven't already revealed
        let already_revealed: bool = env
            .storage()
            .persistent()
            .get(&DataKey::CommitmentRevealed(slash_id))
            .unwrap_or(false);

        // If already revealed, it's a no-op (idempotent)
        if already_revealed {
            return Ok(());
        }

        let computed = Self::hash_commitment(&env, &evidence, &salt);

        let commitment = pending.evidence_hash.clone().unwrap_or(Bytes::new(&env));

        if computed != commitment {
            return Err(ContractError::InvalidReveal);
        }

        // Mark as revealed
        env.storage()
            .persistent()
            .set(&DataKey::CommitmentRevealed(slash_id), &true);

        // Emit evidence_revealed event
        env.events().publish(
            (
                Symbol::new(&env, "slashing"),
                Symbol::new(&env, "evidence_revealed"),
                pending.actor,
            ),
            (slash_id, pending.penalty_bps),
        );

        Ok(())
    }

    /// Propose a slash for an actor with a specific penalty tier (bps).
    ///
    /// The `penalty_bps` is bounded by the configured `max_slash_bps`.
    /// This flow does NOT require commit-reveal (non-validator slash).
    pub fn propose_slash(
        env: Env,
        submitter: Address,
        actor: Address,
        penalty_bps: u32,
    ) -> Result<u64, ContractError> {
        // Enforce authorization: caller must be Admin, authorized Submitter, or BondContract
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotAuthorized)?;

        let mut is_authorized = false;
        if submitter == admin {
            is_authorized = true;
        } else {
            let is_sub: bool = env
                .storage()
                .instance()
                .get(&DataKey::Submitter(submitter.clone()))
                .unwrap_or(false);
            let is_bond = Some(submitter.clone()) == Self::bond_contract(env.clone());
            if is_sub || is_bond {
                is_authorized = true;
            }
        }

        if !is_authorized {
            return Err(ContractError::NotAuthorized);
        }
        submitter.require_auth();

        let max_bps = Self::get_max_slash_bps(&env);
        let effective_bps = penalty_bps.min(max_bps);

        // Compute slash amount from the actor's staked balance
        let balance: i128 = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::StakedBalance(actor.clone()))
            .unwrap_or(0);

        if balance == 0 {
            return Err(ContractError::ZeroBalance);
        }

        let amount = (balance * effective_bps as i128) / MAX_BPS as i128;
        let amount = amount.min(balance);

        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let slash_id = Self::next_slash_id(&env);
        let deadline = env.ledger().timestamp() + Self::challenge_window(env.clone());

        let pending = PendingSlash {
            id: slash_id,
            actor: actor.clone(),
            amount,
            deadline,
            status: SlashStatus::Pending,
            is_validator: false,
            evidence_hash: None,
            offence: Offence::None,
            submitter: Some(submitter),
            penalty_bps: effective_bps,
            inspection_id: None,
            reason: None,
        };

        env.storage()
            .persistent()
            .set(&DataKey::PendingSlash(slash_id), &pending);

        env.events().publish(
            (
                Symbol::new(&env, "slashing"),
                Symbol::new(&env, "proposed"),
                actor,
            ),
            (slash_id, amount, deadline, effective_bps),
        );

        Ok(slash_id)
    }

    /// Finalize a pending slash after the challenge window has elapsed.
    ///
    /// For validator slashes (`is_validator = true`), the evidence commitment
    /// must have been validly revealed via `reveal_evidence` before this call.
    pub fn finalize_slash(env: Env, caller: Address, slash_id: u64) -> Result<(), ContractError> {
        // Enforce authorization: caller must be Admin, authorized Submitter, or BondContract
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotAuthorized)?;

        let mut is_authorized = false;
        if caller == admin {
            is_authorized = true;
        } else {
            let is_sub: bool = env
                .storage()
                .instance()
                .get(&DataKey::Submitter(caller.clone()))
                .unwrap_or(false);
            let is_bond = Some(caller.clone()) == Self::bond_contract(env.clone());
            if is_sub || is_bond {
                is_authorized = true;
            }
        }

        if !is_authorized {
            return Err(ContractError::NotAuthorized);
        }
        caller.require_auth();

        let mut pending: PendingSlash = env
            .storage()
            .persistent()
            .get(&DataKey::PendingSlash(slash_id))
            .ok_or(ContractError::SlashNotFound)?;

        if pending.status != SlashStatus::Pending {
            return Err(ContractError::SlashAlreadyResolved);
        }

        if env.ledger().timestamp() < pending.deadline {
            return Err(ContractError::ChallengeWindowNotElapsed);
        }

        // Validator slashes require a valid commit-reveal before finalization
        if pending.is_validator {
            let revealed: bool = env
                .storage()
                .persistent()
                .get(&DataKey::CommitmentRevealed(slash_id))
                .unwrap_or(false);
            if !revealed {
                return Err(ContractError::CommitmentNotRevealed);
            }
        }

        pending.status = SlashStatus::Finalized;
        env.storage()
            .persistent()
            .set(&DataKey::PendingSlash(slash_id), &pending);

        if pending.is_validator {
            // Apply validator slashing logic
            let actor = pending.actor.clone();
            let slash_amount = pending.amount;

            // Load current staked balance
            let balance: i128 = env
                .storage()
                .persistent()
                .get::<_, i128>(&DataKey::StakedBalance(actor.clone()))
                .unwrap_or(0);

            let actual_slash = slash_amount.min(balance);
            let new_balance = balance - actual_slash;

            // Apply balance reduction atomically
            env.storage()
                .persistent()
                .set(&DataKey::StakedBalance(actor.clone()), &new_balance);

            // Track cumulative slash amount per actor
            let prev_total: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::SlashedAmount(actor.clone()))
                .unwrap_or(0);
            env.storage().persistent().set(
                &DataKey::SlashedAmount(actor.clone()),
                &(prev_total + actual_slash),
            );

            // Increment slash count
            let prev_count: u32 = env
                .storage()
                .persistent()
                .get(&DataKey::SlashCount(actor.clone()))
                .unwrap_or(0);
            env.storage()
                .persistent()
                .set(&DataKey::SlashCount(actor.clone()), &(prev_count + 1));

            // Update slash record with finalized amount
            let evidence_record = SlashEvidence {
                actor: actor.clone(),
                offence: pending.offence.clone(),
                submitter: pending.submitter.clone().unwrap_or(caller.clone()),
                submitted_at: env.ledger().timestamp(),
                penalty_bps: pending.penalty_bps,
                slashed_amount: actual_slash,
            };

            if let Some(hash) = pending.evidence_hash.clone() {
                env.storage()
                    .persistent()
                    .set(&DataKey::SlashRecord(hash), &evidence_record);
            }

            // Emit slash event
            env.events().publish(
                (
                    Symbol::new(&env, "slashing"),
                    Symbol::new(&env, "slashed"),
                    actor.clone(),
                ),
                evidence_record.clone(),
            );

            // Jail the actor
            env.storage()
                .persistent()
                .set(&DataKey::Jailed(actor.clone()), &true);

            env.events().publish(
                (
                    Symbol::new(&env, "slashing"),
                    Symbol::new(&env, "jailed"),
                    actor.clone(),
                ),
                evidence_record,
            );
        } else {
            // Non-validator slash (propose_slash flow): reduce staked balance and track.
            let actor = pending.actor.clone();
            let slash_amount = pending.amount;
            if slash_amount > 0 {
                let balance: i128 = env
                    .storage()
                    .persistent()
                    .get::<_, i128>(&DataKey::StakedBalance(actor.clone()))
                    .unwrap_or(0);
                let actual_slash = slash_amount.min(balance);
                let new_balance = balance - actual_slash;
                env.storage()
                    .persistent()
                    .set(&DataKey::StakedBalance(actor.clone()), &new_balance);
                let prev_total: i128 = env
                    .storage()
                    .persistent()
                    .get(&DataKey::SlashedAmount(actor.clone()))
                    .unwrap_or(0);
                env.storage().persistent().set(
                    &DataKey::SlashedAmount(actor.clone()),
                    &(prev_total + actual_slash),
                );
            }
        }

        // Emit slash_finalized with tier and amount
        env.events().publish(
            (
                Symbol::new(&env, "slashing"),
                Symbol::new(&env, "slash_finalized"),
                pending.actor.clone(),
            ),
            (slash_id, pending.amount, pending.penalty_bps),
        );

        Ok(())
    }

    /// Cancel a pending slash during the challenge window.
    /// Only callable by the admin (arbiter).
    pub fn cancel_slash(env: Env, admin: Address, slash_id: u64) -> Result<(), ContractError> {
        Self::require_admin(&env, &admin)?;

        let mut pending: PendingSlash = env
            .storage()
            .persistent()
            .get(&DataKey::PendingSlash(slash_id))
            .ok_or(ContractError::SlashNotFound)?;

        if pending.status != SlashStatus::Pending {
            return Err(ContractError::SlashAlreadyResolved);
        }

        pending.status = SlashStatus::Cancelled;
        env.storage()
            .persistent()
            .set(&DataKey::PendingSlash(slash_id), &pending);

        // If it was a validator slash, remove the duplicate evidence guard
        // so the same commitment can be re-submitted after cancellation.
        if pending.is_validator {
            if let Some(hash) = pending.evidence_hash {
                env.storage()
                    .persistent()
                    .remove(&DataKey::SlashRecord(hash));
            }
        }

        // Clear the revealed flag
        env.storage()
            .persistent()
            .remove(&DataKey::CommitmentRevealed(slash_id));

        env.events().publish(
            (
                Symbol::new(&env, "slashing"),
                Symbol::new(&env, "cancelled"),
                pending.actor,
            ),
            slash_id,
        );

        Ok(())
    }

    /// Query the pending slash details.
    pub fn get_pending_slash(env: Env, slash_id: u64) -> Option<PendingSlash> {
        env.storage()
            .persistent()
            .get(&DataKey::PendingSlash(slash_id))
    }

    // ── Jailing queries ───────────────────────────────────────────────────────

    pub fn is_jailed(env: Env, actor: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Jailed(actor))
            .unwrap_or(false)
    }

    pub fn slash_count(env: Env, actor: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::SlashCount(actor))
            .unwrap_or(0)
    }

    pub fn total_slashed(env: Env, actor: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::SlashedAmount(actor))
            .unwrap_or(0)
    }

    // ── Governance unjail ─────────────────────────────────────────────────────

    /// Admin pre-approves unjail for an actor (governance step).
    pub fn approve_unjail(env: Env, admin: Address, actor: Address) -> Result<(), ContractError> {
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &admin)?;
        let jailed: bool = env
            .storage()
            .persistent()
            .get(&DataKey::Jailed(actor.clone()))
            .unwrap_or(false);
        if !jailed {
            return Err(ContractError::NotJailed);
        }
        env.storage()
            .instance()
            .set(&DataKey::UnjailApproval(actor.clone()), &true);
        env.events().publish(
            (
                Symbol::new(&env, "slashing"),
                Symbol::new(&env, "unjail_approved"),
            ),
            (admin, actor),
        );
        Ok(())
    }

    /// Actor claims their governance-approved unjail.
    pub fn unjail(env: Env, actor: Address) -> Result<(), ContractError> {
        Self::require_not_paused(&env)?;
        actor.require_auth();

        let jailed: bool = env
            .storage()
            .persistent()
            .get(&DataKey::Jailed(actor.clone()))
            .unwrap_or(false);
        if !jailed {
            return Err(ContractError::NotJailed);
        }

        let approved: bool = env
            .storage()
            .instance()
            .get(&DataKey::UnjailApproval(actor.clone()))
            .unwrap_or(false);
        if !approved {
            return Err(ContractError::UnjailNotApproved);
        }

        // Consume approval and lift jail
        env.storage()
            .instance()
            .remove(&DataKey::UnjailApproval(actor.clone()));
        env.storage()
            .persistent()
            .set(&DataKey::Jailed(actor.clone()), &false);

        env.events().publish(
            (
                Symbol::new(&env, "slashing"),
                Symbol::new(&env, "unjailed"),
                actor.clone(),
            ),
            env.ledger().timestamp(),
        );
        Ok(())
    }

    // ── Inspector bond slashing (Issue #925) ──────────────────────────────────

    /// Register the bond_collateral contract address authorised to call `slash`.
    pub fn set_bond_contract(
        env: Env,
        admin: Address,
        bond_contract: Address,
    ) -> Result<(), ContractError> {
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &admin)?;
        env.storage()
            .instance()
            .set(&DataKey::BondContract, &bond_contract);
        env.events().publish(
            (
                Symbol::new(&env, "slashing"),
                Symbol::new(&env, "set_bond_contract"),
            ),
            bond_contract,
        );
        Ok(())
    }

    /// Currently-registered bond contract, if any.
    pub fn bond_contract(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::BondContract)
    }

    /// Record a slash against an inspector for a specific inspection.
    pub fn slash(
        env: Env,
        caller: Address,
        inspector: Address,
        amount: i128,
        inspection_id: String,
        reason: String,
    ) -> Result<i128, ContractError> {
        Self::require_not_paused(&env)?;
        let registered: Address = env
            .storage()
            .instance()
            .get(&DataKey::BondContract)
            .ok_or(ContractError::NotAuthorized)?;
        if caller != registered {
            return Err(ContractError::NotAuthorized);
        }
        caller.require_auth();

        if amount <= 0 {
            return Err(ContractError::ArithmeticError);
        }

        let record = InspectorSlashRecord {
            inspection_id: inspection_id.clone(),
            amount,
            reason: reason.clone(),
            slashed_at: env.ledger().timestamp(),
        };

        let key = DataKey::InspectorSlashHistory(inspector.clone());
        let mut history: Vec<InspectorSlashRecord> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));
        history.push_back(record.clone());
        env.storage().persistent().set(&key, &history);

        env.events().publish(
            (
                Symbol::new(&env, "slashing"),
                Symbol::new(&env, "inspector_slashed"),
                inspector,
            ),
            (inspection_id, amount, reason),
        );

        Ok(amount)
    }

    /// Read the inspector's slash history (oldest first).
    pub fn get_slash_history(env: Env, inspector: Address) -> Vec<InspectorSlashRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::InspectorSlashHistory(inspector))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Pause the contract. Admin-only.
    pub fn pause(env: Env, admin: Address) -> Result<(), ContractError> {
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish(
            (Symbol::new(&env, "slashing"), Symbol::new(&env, "paused")),
            admin,
        );
        Ok(())
    }

    /// Unpause the contract. Admin-only.
    pub fn unpause(env: Env, admin: Address) -> Result<(), ContractError> {
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events().publish(
            (Symbol::new(&env, "slashing"), Symbol::new(&env, "unpaused")),
            admin,
        );
        Ok(())
    }

    /// True iff the contract is currently paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get::<_, bool>(&DataKey::Paused)
            .unwrap_or(false)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    extern crate std;

    use super::*;
    use soroban_sdk::{testutils::Address as _, testutils::Ledger, Bytes, Env};

    /// Build a sha256 commitment from raw tag string and a salt.
    fn make_commitment(env: &Env, evidence_tag: &str, salt_tag: &str) -> Bytes {
        let evidence = Bytes::from_slice(env, evidence_tag.as_bytes());
        let salt = Bytes::from_slice(env, salt_tag.as_bytes());
        let mut data = Bytes::new(env);
        data.append(&evidence);
        data.append(&salt);
        let hash: BytesN<32> = env.crypto().sha256(&data).into();
        Bytes::from(hash)
    }

    fn evidence_bytes(env: &Env, tag: &str) -> Bytes {
        Bytes::from_slice(env, tag.as_bytes())
    }

    fn salt_bytes(env: &Env, tag: &str) -> Bytes {
        Bytes::from_slice(env, tag.as_bytes())
    }

    fn setup(env: &Env) -> (Address, Address, SlashingModuleClient<'_>) {
        env.mock_all_auths();
        let id = env.register(SlashingModule, ());
        let client = SlashingModuleClient::new(env, &id);
        let admin = Address::generate(env);
        let submitter = Address::generate(env);
        client.init(&admin);
        client.set_submitter(&admin, &submitter, &true);
        (admin, submitter, client)
    }

    // Seed the actor's staked balance directly via admin helper.
    fn seed_balance(
        client: &SlashingModuleClient<'_>,
        admin: &Address,
        actor: &Address,
        amount: i128,
    ) {
        client.set_staked_balance(admin, actor, &amount);
    }

    /// Full commit-reveal helper: submit commitment then immediately reveal.
    fn commit_and_reveal(
        env: &Env,
        client: &SlashingModuleClient<'_>,
        submitter: &Address,
        evidence_tag: &str,
        salt_tag: &str,
        actor: &Address,
        offence: &Offence,
    ) -> u64 {
        let commitment = make_commitment(env, evidence_tag, salt_tag);
        let slash_id = client.submit_evidence(submitter, &commitment, actor, offence);
        let ev = evidence_bytes(env, evidence_tag);
        let salt = salt_bytes(env, salt_tag);
        client.reveal_evidence(submitter, &slash_id, &ev, &salt);
        slash_id
    }

    // ── happy-path slash ──────────────────────────────────────────────────────

    #[test]
    fn valid_slash_reduces_balance_and_jails() {
        let env = Env::default();
        let (admin, submitter, client) = setup(&env);
        let actor = Address::generate(&env);

        seed_balance(&client, &admin, &actor, 10_000);

        let slash_id = commit_and_reveal(
            &env,
            &client,
            &submitter,
            "ev1",
            "salt1",
            &actor,
            &Offence::DoubleSign,
        );

        // Funds not moved immediately
        assert_eq!(client.staked_balance(&actor), 10_000);
        assert_eq!(client.total_slashed(&actor), 0);
        assert!(!client.is_jailed(&actor));

        // Advance past challenge window (default 604_800 seconds)
        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 604_801);

        // Finalize
        client.finalize_slash(&submitter, &slash_id);

        // 10 % of 10_000 = 1_000 slashed → 9_000 remaining
        assert_eq!(client.staked_balance(&actor), 9_000);
        assert_eq!(client.total_slashed(&actor), 1_000);
        assert_eq!(client.slash_count(&actor), 1);
        assert!(client.is_jailed(&actor));
    }

    #[test]
    fn downtime_slash_correct_ratio() {
        let env = Env::default();
        let (admin, submitter, client) = setup(&env);
        let actor = Address::generate(&env);

        seed_balance(&client, &admin, &actor, 100_000);

        let slash_id = commit_and_reveal(
            &env,
            &client,
            &submitter,
            "ev2",
            "salt2",
            &actor,
            &Offence::Downtime,
        );

        // Advance time
        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 604_801);
        client.finalize_slash(&submitter, &slash_id);

        // 1 % of 100_000 = 1_000
        assert_eq!(client.staked_balance(&actor), 99_000);
    }

    // ── duplicate evidence ────────────────────────────────────────────────────

    #[test]
    fn duplicate_evidence_rejected() {
        let env = Env::default();
        let (admin, submitter, client) = setup(&env);
        let actor = Address::generate(&env);
        let actor2 = Address::generate(&env);

        seed_balance(&client, &admin, &actor, 10_000);
        seed_balance(&client, &admin, &actor2, 10_000);

        let commitment = make_commitment(&env, "same_evidence", "same_salt");
        client.submit_evidence(&submitter, &commitment, &actor, &Offence::Downtime);

        // Second submission with same commitment must fail
        let result =
            client.try_submit_evidence(&submitter, &commitment, &actor2, &Offence::Downtime);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::DuplicateEvidence
        );
    }

    // ── bad reveal rejected ───────────────────────────────────────────────────

    #[test]
    fn bad_reveal_rejected() {
        let env = Env::default();
        let (admin, submitter, client) = setup(&env);
        let actor = Address::generate(&env);

        seed_balance(&client, &admin, &actor, 10_000);

        let commitment = make_commitment(&env, "real_ev", "real_salt");
        let slash_id =
            client.submit_evidence(&submitter, &commitment, &actor, &Offence::DoubleSign);

        // Reveal with wrong salt → hash mismatch
        let wrong_salt = salt_bytes(&env, "wrong_salt");
        let real_ev = evidence_bytes(&env, "real_ev");
        let err = client
            .try_reveal_evidence(&submitter, &slash_id, &real_ev, &wrong_salt)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InvalidReveal);

        // Reveal with wrong evidence → hash mismatch
        let wrong_ev = evidence_bytes(&env, "wrong_ev");
        let real_salt = salt_bytes(&env, "real_salt");
        let err2 = client
            .try_reveal_evidence(&submitter, &slash_id, &wrong_ev, &real_salt)
            .unwrap_err()
            .unwrap();
        assert_eq!(err2, ContractError::InvalidReveal);
    }

    // ── finalize without reveal rejected ─────────────────────────────────────

    #[test]
    fn finalize_without_reveal_fails() {
        let env = Env::default();
        let (admin, submitter, client) = setup(&env);
        let actor = Address::generate(&env);

        seed_balance(&client, &admin, &actor, 10_000);

        let commitment = make_commitment(&env, "evX", "saltX");
        let slash_id =
            client.submit_evidence(&submitter, &commitment, &actor, &Offence::DoubleSign);

        // Advance past challenge window WITHOUT revealing
        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 604_801);

        let err = client
            .try_finalize_slash(&submitter, &slash_id)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::CommitmentNotRevealed);
    }

    // ── over-slash boundary ───────────────────────────────────────────────────

    #[test]
    fn slash_never_exceeds_balance() {
        let env = Env::default();
        let (admin, submitter, client) = setup(&env);
        let actor = Address::generate(&env);

        seed_balance(&client, &admin, &actor, 1); // tiny balance

        let slash_id = commit_and_reveal(
            &env,
            &client,
            &submitter,
            "tiny",
            "salttiny",
            &actor,
            &Offence::DoubleSign,
        );

        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 604_801);
        client.finalize_slash(&submitter, &slash_id);

        assert!(client.staked_balance(&actor) >= 0);
    }

    // ── jailed actor cannot be re-slashed ────────────────────────────────────

    #[test]
    fn jailed_actor_cannot_be_slashed_again() {
        let env = Env::default();
        let (admin, submitter, client) = setup(&env);
        let actor = Address::generate(&env);

        seed_balance(&client, &admin, &actor, 10_000);

        let slash_id = commit_and_reveal(
            &env,
            &client,
            &submitter,
            "ev_j1",
            "s1",
            &actor,
            &Offence::Downtime,
        );

        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 604_801);
        client.finalize_slash(&submitter, &slash_id);
        assert!(client.is_jailed(&actor));

        let commitment2 = make_commitment(&env, "ev_j2", "s2");
        let result =
            client.try_submit_evidence(&submitter, &commitment2, &actor, &Offence::InvalidBlock);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::AlreadyJailed);
    }

    // ── unjail path ───────────────────────────────────────────────────────────

    #[test]
    fn unjail_requires_governance_approval() {
        let env = Env::default();
        let (admin, submitter, client) = setup(&env);
        let actor = Address::generate(&env);

        seed_balance(&client, &admin, &actor, 10_000);

        let slash_id = commit_and_reveal(
            &env,
            &client,
            &submitter,
            "ev_u1",
            "su1",
            &actor,
            &Offence::Downtime,
        );

        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 604_801);
        client.finalize_slash(&submitter, &slash_id);
        assert!(client.is_jailed(&actor));

        // Unjail without approval must fail
        let result = client.try_unjail(&actor);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::UnjailNotApproved
        );

        // Admin approves
        client.approve_unjail(&admin, &actor);

        // Now actor can unjail themselves
        client.unjail(&actor);
        assert!(!client.is_jailed(&actor));
    }

    #[test]
    fn unjail_cannot_be_applied_twice() {
        let env = Env::default();
        let (admin, submitter, client) = setup(&env);
        let actor = Address::generate(&env);

        seed_balance(&client, &admin, &actor, 10_000);
        let slash_id = commit_and_reveal(
            &env,
            &client,
            &submitter,
            "ev_u2",
            "su2",
            &actor,
            &Offence::Downtime,
        );

        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 604_801);
        client.finalize_slash(&submitter, &slash_id);

        client.approve_unjail(&admin, &actor);
        client.unjail(&actor);

        // Second unjail must fail – not jailed
        let result = client.try_unjail(&actor);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NotJailed);
    }

    // ── unauthorized submitter ────────────────────────────────────────────────

    #[test]
    fn unauthorized_submitter_rejected() {
        let env = Env::default();
        let (admin, _submitter, client) = setup(&env);
        let actor = Address::generate(&env);
        let stranger = Address::generate(&env);

        seed_balance(&client, &admin, &actor, 10_000);

        let commitment = make_commitment(&env, "ev_s1", "ss1");
        let result = client.try_submit_evidence(&stranger, &commitment, &actor, &Offence::Downtime);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NotAuthorized);
    }

    // ── two-phase slash lifecycle, timing & auth ──────────────────────────────

    #[test]
    fn two_phase_lifecycle_finalize_before_window_fails() {
        let env = Env::default();
        let (admin, submitter, client) = setup(&env);
        let actor = Address::generate(&env);

        seed_balance(&client, &admin, &actor, 10_000);

        let slash_id = commit_and_reveal(
            &env,
            &client,
            &submitter,
            "ev_t1",
            "st1",
            &actor,
            &Offence::DoubleSign,
        );

        // Finalizing immediately (before 604,800 seconds) must fail
        let result = client.try_finalize_slash(&submitter, &slash_id);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::ChallengeWindowNotElapsed
        );
    }

    #[test]
    fn two_phase_lifecycle_cancel_clears_evidence_and_does_not_move_funds() {
        let env = Env::default();
        let (admin, submitter, client) = setup(&env);
        let actor = Address::generate(&env);

        seed_balance(&client, &admin, &actor, 10_000);

        let commitment = make_commitment(&env, "ev_t2", "st2");
        let slash_id =
            client.submit_evidence(&submitter, &commitment, &actor, &Offence::DoubleSign);

        // Cancel during challenge window
        client.cancel_slash(&admin, &slash_id);

        // Verify status is cancelled
        let pending = client.get_pending_slash(&slash_id).unwrap();
        assert!(matches!(pending.status, SlashStatus::Cancelled));

        // Staked balance remains unchanged
        assert_eq!(client.staked_balance(&actor), 10_000);

        // Commitment can be re-submitted since cancellation cleared the SlashRecord
        let new_id = client.submit_evidence(&submitter, &commitment, &actor, &Offence::DoubleSign);
        assert_ne!(slash_id, new_id);
    }

    #[test]
    fn two_phase_lifecycle_auth_enforced_on_transitions() {
        let env = Env::default();
        let (admin, submitter, client) = setup(&env);
        let actor = Address::generate(&env);
        let stranger = Address::generate(&env);

        seed_balance(&client, &admin, &actor, 10_000);

        let slash_id = commit_and_reveal(
            &env,
            &client,
            &submitter,
            "ev_t3",
            "st3",
            &actor,
            &Offence::DoubleSign,
        );

        // Stranger cannot finalize
        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 604_801);
        let res_fin = client.try_finalize_slash(&stranger, &slash_id);
        assert_eq!(res_fin.unwrap_err().unwrap(), ContractError::NotAuthorized);

        // Stranger cannot cancel
        let res_can = client.try_cancel_slash(&stranger, &slash_id);
        assert_eq!(res_can.unwrap_err().unwrap(), ContractError::NotAuthorized);

        // Admin is authorized to finalize
        client.finalize_slash(&admin, &slash_id);
    }

    #[test]
    fn configurable_challenge_window() {
        let env = Env::default();
        let (admin, submitter, client) = setup(&env);
        let actor = Address::generate(&env);

        seed_balance(&client, &admin, &actor, 10_000);

        // Check default
        assert_eq!(client.challenge_window(), 604_800);

        // Update challenge window to 1 day (86,400 seconds)
        client.set_challenge_window(&admin, &86_400);
        assert_eq!(client.challenge_window(), 86_400);

        let slash_id = commit_and_reveal(
            &env,
            &client,
            &submitter,
            "ev_t4",
            "st4",
            &actor,
            &Offence::DoubleSign,
        );

        // Should fail after 20 hours
        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 72_000);
        let res1 = client.try_finalize_slash(&submitter, &slash_id);
        assert_eq!(
            res1.unwrap_err().unwrap(),
            ContractError::ChallengeWindowNotElapsed
        );

        // Should succeed after 25 hours
        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 20_000); // 72_000 + 20_000 = 92_000 (which is > 86_400)
        client.finalize_slash(&submitter, &slash_id);
        assert_eq!(client.staked_balance(&actor), 9_000);
    }

    // ── Inspector bond slashing surface (Issue #925) ─────────────────────

    #[test]
    fn bond_contract_is_set_and_read_back() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(SlashingModule, ());
        let client = SlashingModuleClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.init(&admin);

        assert!(client.bond_contract().is_none());

        let bond_contract = Address::generate(&env);
        client.set_bond_contract(&admin, &bond_contract);
        assert_eq!(client.bond_contract(), Some(bond_contract));
    }

    #[test]
    fn slash_rejects_unregistered_caller_with_not_authorized() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(SlashingModule, ());
        let client = SlashingModuleClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.init(&admin);

        let registered = Address::generate(&env);
        client.set_bond_contract(&admin, &registered);

        let stranger = Address::generate(&env);
        let inspector = Address::generate(&env);
        let result = client.try_slash(
            &stranger,
            &inspector,
            &100,
            &soroban_sdk::String::from_str(&env, "INSP-1"),
            &soroban_sdk::String::from_str(&env, "r"),
        );
        assert_eq!(result, Err(Ok(ContractError::NotAuthorized)));
    }

    #[test]
    fn slash_rejects_non_positive_amount() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(SlashingModule, ());
        let client = SlashingModuleClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.init(&admin);
        let bond_contract = Address::generate(&env);
        client.set_bond_contract(&admin, &bond_contract);

        let inspector = Address::generate(&env);
        let result = client.try_slash(
            &bond_contract,
            &inspector,
            &0,
            &soroban_sdk::String::from_str(&env, "INSP-1"),
            &soroban_sdk::String::from_str(&env, "r"),
        );
        assert_eq!(result, Err(Ok(ContractError::ArithmeticError)));
    }

    #[test]
    fn slash_records_history_when_called_by_registered_bond_contract() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(SlashingModule, ());
        let client = SlashingModuleClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.init(&admin);
        let bond_contract = Address::generate(&env);
        client.set_bond_contract(&admin, &bond_contract);

        let inspector = Address::generate(&env);
        let inspection = soroban_sdk::String::from_str(&env, "INSP-7");
        let reason = soroban_sdk::String::from_str(&env, "fraud");
        let slashed = client.slash(&bond_contract, &inspector, &500, &inspection, &reason);
        assert_eq!(slashed, 500);

        let history = client.get_slash_history(&inspector);
        assert_eq!(history.len(), 1);
        let entry = history.get(0).unwrap();
        assert_eq!(entry.amount, 500);
        assert_eq!(entry.inspection_id, inspection);
        assert_eq!(entry.reason, reason);
    }

    // ── Pausable tests ───────────────────────────────────────────────────────

    #[test]
    fn pause_blocks_mutating_calls() {
        let env = Env::default();
        let (admin, _submitter, client) = setup(&env);
        let actor = Address::generate(&env);

        seed_balance(&client, &admin, &actor, 10_000);
        client.pause(&admin);

        // set_staked_balance should fail
        let result = client.try_set_staked_balance(&admin, &actor, &5_000);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::Paused);

        // approve_unjail should fail
        let result = client.try_approve_unjail(&admin, &actor);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::Paused);

        // set_bond_contract should fail
        let bond_contract = Address::generate(&env);
        let result = client.try_set_bond_contract(&admin, &bond_contract);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::Paused);
    }

    #[test]
    fn unpause_allows_mutating_calls() {
        let env = Env::default();
        let (admin, submitter, client) = setup(&env);
        let actor = Address::generate(&env);

        seed_balance(&client, &admin, &actor, 10_000);
        client.pause(&admin);
        client.unpause(&admin);

        // submit_evidence should succeed after unpause
        let slash_id = commit_and_reveal(
            &env,
            &client,
            &submitter,
            "ev_unpause",
            "s_unpause",
            &actor,
            &Offence::Downtime,
        );
        // Advance time and finalize the slash
        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 604_801);
        client.finalize_slash(&submitter, &slash_id);
        assert_eq!(client.staked_balance(&actor), 9_900);
    }

    #[test]
    fn pause_requires_admin() {
        let env = Env::default();
        let (_admin, _submitter, client) = setup(&env);
        let attacker = Address::generate(&env);

        let result = client.try_pause(&attacker);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NotAuthorized);
    }

    #[test]
    fn unpause_requires_admin() {
        let env = Env::default();
        let (admin, _submitter, client) = setup(&env);
        let attacker = Address::generate(&env);

        client.pause(&admin);
        let result = client.try_unpause(&attacker);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NotAuthorized);
    }

    #[test]
    fn getters_work_while_paused() {
        let env = Env::default();
        let (admin, _submitter, client) = setup(&env);
        let actor = Address::generate(&env);

        seed_balance(&client, &admin, &actor, 10_000);
        let slash_id = commit_and_reveal(
            &env,
            &client,
            &submitter,
            "ev_getter",
            "s_getter",
            &actor,
            &Offence::Downtime,
        );
        // Advance time and finalize the slash
        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 604_801);
        client.finalize_slash(&submitter, &slash_id);
        client.pause(&admin);

        // Read-only getters should still work
        assert_eq!(client.staked_balance(&actor), 9_900);
        assert_eq!(client.total_slashed(&actor), 100);
        assert_eq!(client.slash_count(&actor), 1);
        assert!(client.is_jailed(&actor));
        assert!(client.is_paused());
    }

    // ── Tiered slashing (Issue #1131) ─────────────────────────────────────────

    #[test]
    fn configurable_tiers_override_defaults() {
        let env = Env::default();
        let (admin, _submitter, client) = setup(&env);
        let actor = Address::generate(&env);

        seed_balance(&client, &admin, &actor, 100_000);

        // Configure: DoubleSign = 5% (500 bps), max = 50% (5000 bps)
        client.configure_tiers(&admin, &500u32, &100u32, &200u32, &5000u32);

        let slash_id = commit_and_reveal(
            &env,
            &client,
            &submitter,
            "ev_tier",
            "st_tier",
            &actor,
            &Offence::DoubleSign,
        );
        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 604_801);
        client.finalize_slash(&submitter, &slash_id);

        // 5% of 100_000 = 5_000 slashed → 95_000 remaining
        assert_eq!(client.staked_balance(&actor), 95_000);
    }

    #[test]
    fn max_slash_bps_caps_penalty() {
        let env = Env::default();
        let (admin, _submitter, client) = setup(&env);
        let actor = Address::generate(&env);

        seed_balance(&client, &admin, &actor, 100_000);

        // Configure: DoubleSign = 50% but max = 5% → capped at 5%
        client.configure_tiers(&admin, &5000u32, &100u32, &200u32, &500u32);

        let slash_id = commit_and_reveal(
            &env,
            &client,
            &submitter,
            "ev_cap",
            "sc",
            &actor,
            &Offence::DoubleSign,
        );
        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 604_801);
        client.finalize_slash(&submitter, &slash_id);

        // Capped at 5% of 100_000 = 5_000 slashed → 95_000 remaining
        assert_eq!(client.staked_balance(&actor), 95_000);
    }

    #[test]
    fn tier_mapping_downtime_vs_double_sign() {
        let env = Env::default();
        let (admin, _submitter, client) = setup(&env);

        let actor_a = Address::generate(&env);
        let actor_b = Address::generate(&env);
        seed_balance(&client, &admin, &actor_a, 100_000);
        seed_balance(&client, &admin, &actor_b, 100_000);

        // Default tiers: DoubleSign=10%, Downtime=1%
        let id_a = commit_and_reveal(
            &env,
            &client,
            &submitter,
            "ev_ds",
            "ss_ds",
            &actor_a,
            &Offence::DoubleSign,
        );
        let id_b = commit_and_reveal(
            &env,
            &client,
            &submitter,
            "ev_dt",
            "ss_dt",
            &actor_b,
            &Offence::Downtime,
        );

        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 604_801);
        client.finalize_slash(&submitter, &id_a);
        client.finalize_slash(&submitter, &id_b);

        // DoubleSign slashes more than Downtime
        let slashed_a = client.total_slashed(&actor_a);
        let slashed_b = client.total_slashed(&actor_b);
        assert!(
            slashed_a > slashed_b,
            "DoubleSign should slash more: {} vs {}",
            slashed_a,
            slashed_b
        );
        // DoubleSign = 10_000, Downtime = 1_000
        assert_eq!(slashed_a, 10_000);
        assert_eq!(slashed_b, 1_000);
    }

    // ── propose_slash with tiered bps ─────────────────────────────────────────

    #[test]
    fn propose_slash_tiered_bps() {
        let env = Env::default();
        let (admin, _submitter, client) = setup(&env);
        let actor = Address::generate(&env);

        seed_balance(&client, &admin, &actor, 10_000);

        // Propose with 500 bps (5%)
        let slash_id = client.propose_slash(&admin, &actor, &500u32);

        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 604_801);
        client.finalize_slash(&admin, &slash_id);

        // 5% of 10_000 = 500 slashed
        assert_eq!(client.total_slashed(&actor), 500);
    }

    #[test]
    fn propose_slash_bounded_by_max_bps() {
        let env = Env::default();
        let (admin, _submitter, client) = setup(&env);
        let actor = Address::generate(&env);

        seed_balance(&client, &admin, &actor, 10_000);

        // Set max to 10% (1000 bps)
        client.configure_tiers(&admin, &1000u32, &100u32, &500u32, &1000u32);

        // Propose 50% (5000 bps) → capped to 10% (1000 bps)
        let slash_id = client.propose_slash(&admin, &actor, &5000u32);
        let pending = client.get_pending_slash(&slash_id).unwrap();
        assert_eq!(
            pending.penalty_bps, 1000,
            "penalty should be capped at max 1000 bps"
        );

        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 604_801);
        client.finalize_slash(&admin, &slash_id);

        // 10% of 10_000 = 1_000 slashed
        assert_eq!(client.total_slashed(&actor), 1_000);
    }
}
