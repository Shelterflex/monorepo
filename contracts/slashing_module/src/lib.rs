#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Bytes, Env, Symbol,
};

// ── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    /// Authorized evidence submitters
    Submitter(Address),
    /// Slash record keyed by evidence hash (duplicate detection)
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
}

// ── Slashable Offence Types ───────────────────────────────────────────────────

/// Penalty ratios expressed as basis points (1 bp = 0.01%).
/// Max stake reduction capped at 10_000 bp (100%).
pub const OFFENCE_DOUBLE_SIGN_BPS: u32 = 1_000; // 10 %
pub const OFFENCE_DOWNTIME_BPS: u32 = 100; // 1 %
pub const OFFENCE_INVALID_BLOCK_BPS: u32 = 500; // 5 %
pub const MAX_BPS: u32 = 10_000;

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    /// Contract already initialized
    AlreadyInitialized = 1,
    /// Caller is not authorized
    NotAuthorized = 2,
    /// Evidence was already processed (duplicate)
    DuplicateEvidence = 3,
    /// Slashed actor has no staked balance
    ZeroBalance = 4,
    /// Actor is already jailed
    AlreadyJailed = 5,
    /// Actor is not jailed (unjail attempted on unjailed actor)
    NotJailed = 6,
    /// No governance approval for unjail
    UnjailNotApproved = 7,
    /// Unknown offence type
    UnknownOffence = 8,
    /// Amount overflow or underflow
    ArithmeticError = 9,
}

// ── Data Structures ───────────────────────────────────────────────────────────

/// Offence classification submitted with evidence
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Offence {
    DoubleSign,
    Downtime,
    InvalidBlock,
}

/// Full evidence record stored on-chain (keyed by hash)
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

    /// Register an authorized evidence submitter.
    pub fn set_submitter(
        env: Env,
        admin: Address,
        submitter: Address,
        enabled: bool,
    ) -> Result<(), ContractError> {
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

    // ── Core: submit evidence & slash ─────────────────────────────────────────

    /// Submit evidence of misbehavior.
    ///
    /// * `evidence_hash` – unique fingerprint of the raw evidence bytes (duplicate guard).
    /// * `actor`         – address being slashed.
    /// * `offence`       – classification used to look up the penalty ratio.
    pub fn submit_evidence(
        env: Env,
        submitter: Address,
        evidence_hash: Bytes,
        actor: Address,
        offence: Offence,
    ) -> Result<(), ContractError> {
        Self::require_submitter(&env, &submitter)?;

        // Duplicate evidence check
        if env
            .storage()
            .persistent()
            .has(&DataKey::SlashRecord(evidence_hash.clone()))
        {
            return Err(ContractError::DuplicateEvidence);
        }

        // Actor must not already be jailed (cannot re-slash a jailed actor for a
        // new offence until governance unjails them; prevents double-jailing races).
        let already_jailed: bool = env
            .storage()
            .persistent()
            .get(&DataKey::Jailed(actor.clone()))
            .unwrap_or(false);
        if already_jailed {
            return Err(ContractError::AlreadyJailed);
        }

        // Determine penalty ratio
        let penalty_bps: u32 = match offence {
            Offence::DoubleSign => OFFENCE_DOUBLE_SIGN_BPS,
            Offence::Downtime => OFFENCE_DOWNTIME_BPS,
            Offence::InvalidBlock => OFFENCE_INVALID_BLOCK_BPS,
        };

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
        let slash_amount = slash_amount.min(balance); // cap at balance
        let new_balance = balance - slash_amount;

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
            &(prev_total + slash_amount),
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

        // Mark evidence as processed
        let evidence_record = SlashEvidence {
            actor: actor.clone(),
            offence: offence.clone(),
            submitter: submitter.clone(),
            submitted_at: env.ledger().timestamp(),
            penalty_bps,
            slashed_amount: slash_amount,
        };
        env.storage().persistent().set(
            &DataKey::SlashRecord(evidence_hash.clone()),
            &evidence_record,
        );

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

        Ok(())
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
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    extern crate std;

    use super::*;
    use soroban_sdk::{testutils::Address as _, Bytes, Env};

    fn evidence(env: &Env, tag: &str) -> Bytes {
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

    // ── happy-path slash ──────────────────────────────────────────────────────

    #[test]
    fn valid_slash_reduces_balance_and_jails() {
        let env = Env::default();
        let (admin, submitter, client) = setup(&env);
        let actor = Address::generate(&env);

        seed_balance(&client, &admin, &actor, 10_000);

        client.submit_evidence(
            &submitter,
            &evidence(&env, "ev1"),
            &actor,
            &Offence::DoubleSign,
        );

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

        client.submit_evidence(
            &submitter,
            &evidence(&env, "ev2"),
            &actor,
            &Offence::Downtime,
        );

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

        let ev = evidence(&env, "same_hash");
        client.submit_evidence(&submitter, &ev, &actor, &Offence::Downtime);

        // Second submission with same hash must fail
        let result = client.try_submit_evidence(&submitter, &ev, &actor2, &Offence::Downtime);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::DuplicateEvidence
        );
    }

    // ── over-slash boundary ───────────────────────────────────────────────────

    #[test]
    fn slash_never_exceeds_balance() {
        let env = Env::default();
        let (admin, submitter, client) = setup(&env);
        let actor = Address::generate(&env);

        // Even if penalty ratio would exceed 100 %, balance must not go negative.
        seed_balance(&client, &admin, &actor, 1); // tiny balance

        client.submit_evidence(
            &submitter,
            &evidence(&env, "tiny"),
            &actor,
            &Offence::DoubleSign,
        );

        assert!(client.staked_balance(&actor) >= 0);
    }

    // ── jailed actor cannot be re-slashed ────────────────────────────────────

    #[test]
    fn jailed_actor_cannot_be_slashed_again() {
        let env = Env::default();
        let (admin, submitter, client) = setup(&env);
        let actor = Address::generate(&env);

        seed_balance(&client, &admin, &actor, 10_000);

        client.submit_evidence(
            &submitter,
            &evidence(&env, "ev_j1"),
            &actor,
            &Offence::Downtime,
        );
        assert!(client.is_jailed(&actor));

        let result = client.try_submit_evidence(
            &submitter,
            &evidence(&env, "ev_j2"),
            &actor,
            &Offence::InvalidBlock,
        );
        assert_eq!(result.unwrap_err().unwrap(), ContractError::AlreadyJailed);
    }

    // ── unjail path ───────────────────────────────────────────────────────────

    #[test]
    fn unjail_requires_governance_approval() {
        let env = Env::default();
        let (admin, submitter, client) = setup(&env);
        let actor = Address::generate(&env);

        seed_balance(&client, &admin, &actor, 10_000);

        client.submit_evidence(
            &submitter,
            &evidence(&env, "ev_u1"),
            &actor,
            &Offence::Downtime,
        );
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
        client.submit_evidence(
            &submitter,
            &evidence(&env, "ev_u2"),
            &actor,
            &Offence::Downtime,
        );
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

        let result = client.try_submit_evidence(
            &stranger,
            &evidence(&env, "ev_s1"),
            &actor,
            &Offence::Downtime,
        );
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NotAuthorized);
    }
}
