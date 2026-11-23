#![no_std]
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, String, U256};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAuthorized = 3,
    InvalidBasisPoints = 4,
    SlashNotFound = 5,
    SlashAlreadyFinalized = 6,
    SlashAlreadyCancelled = 7,
    SlashNotFinalizable = 8,
    NotJailed = 9,
    Jailed = 10,
    EvidenceMismatch = 11,
    EvidenceNotFound = 12,
}

#[contract]
pub struct SlashingModuleContract;

#[derive(Clone)]
#[contracttype]
pub struct SlashProposal {
    pub subject: Address,
    pub proposer: Address,
    pub penalty_basis_points: u32,
    pub evidence_hash: U256,
    pub proposed_at: u64,
    pub challenge_window: u64,
    pub status: SlashStatus,
}

#[derive(Clone)]
#[contracttype]
pub enum SlashStatus {
    Proposed,
    Finalized,
    Cancelled,
}

#[derive(Clone)]
#[contracttype]
pub struct PenaltyTier {
    pub offense_count: u32,
    pub penalty_basis_points: u32,
    pub jail_after: u32,
}

#[derive(Clone)]
#[contracttype]
pub struct JailedStatus {
    pub jailed_at: u64,
    pub slash_count: u32,
}

#[derive(Clone)]
#[contracttype]
pub struct EvidenceCommitment {
    pub evidence_hash: U256,
    pub submitted_at: u64,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Operator(Address),
    Submitter(Address),
    BondContract,
    ChallengeWindow,
    PenaltyTiers,
    SlashProposal(u64),
    SlashCount(Address),
    JailedStatus(Address),
    EvidenceCommitment(u64),
    NextSlashId,
    TotalSlashed,
}

#[contractimpl]
impl SlashingModuleContract {
    /// Initialize the contract with an admin address.
    pub fn init(env: Env, admin: Address) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::ChallengeWindow, &86400u64); // 24 hours default
        env.storage().instance().set(&DataKey::NextSlashId, &0u64);
        env.storage().instance().set(&DataKey::TotalSlashed, &0u128);

        env.events().publish((String::from_str(&env, "init"),), admin);

        Ok(())
    }

    /// Configure penalty tiers for tiered slashing.
    pub fn configure_tiers(env: Env, caller: Address, tiers: Vec<PenaltyTier>) -> Result<(), ContractError> {
        Self::ensure_initialized(&env)?;
        Self::ensure_authorized(&env, &caller)?;

        for tier in tiers.iter() {
            if tier.penalty_basis_points > 10000 {
                return Err(ContractError::InvalidBasisPoints);
            }
        }

        env.storage().instance().set(&DataKey::PenaltyTiers, &tiers);

        env.events().publish((String::from_str(&env, "configure_tiers"), caller), ());

        Ok(())
    }

    /// Set a submitter address allowed to submit evidence.
    pub fn set_submitter(env: Env, caller: Address, submitter: Address) -> Result<(), ContractError> {
        Self::ensure_initialized(&env)?;
        Self::ensure_authorized(&env, &caller)?;

        env.storage().instance().set(&DataKey::Submitter(submitter.clone()), &true);

        env.events().publish((String::from_str(&env, "set_submitter"), caller), submitter);

        Ok(())
    }

    /// Submit evidence as a hash for commit-reveal.
    pub fn submit_evidence(env: Env, caller: Address, evidence_hash: U256) -> Result<u64, ContractError> {
        Self::ensure_initialized(&env)?;
        Self::ensure_submitter(&env, &caller)?;

        let slash_id = Self::get_next_slash_id(&env);
        env.storage().instance().set(&DataKey::NextSlashId, &(slash_id + 1));

        let commitment = EvidenceCommitment {
            evidence_hash,
            submitted_at: env.ledger().timestamp(),
        };
        env.storage().instance().set(&DataKey::EvidenceCommitment(slash_id), &commitment);

        env.events().publish((String::from_str(&env, "submit_evidence"), caller), slash_id);

        Ok(slash_id)
    }

    /// Reveal evidence and verify the hash matches.
    pub fn reveal_evidence(env: Env, caller: Address, slash_id: u64, evidence: U256, salt: U256) -> Result<(), ContractError> {
        Self::ensure_initialized(&env)?;

        let commitment: EvidenceCommitment = env
            .storage()
            .instance()
            .get(&DataKey::EvidenceCommitment(slash_id))
            .ok_or(ContractError::EvidenceNotFound)?;

        // Simple hash verification: evidence ^ salt == evidence_hash
        let computed_hash = Self::compute_hash(evidence, salt);
        if computed_hash != commitment.evidence_hash {
            return Err(ContractError::EvidenceMismatch);
        }

        env.events().publish((String::from_str(&env, "reveal_evidence"), caller), slash_id);

        Ok(())
    }

    /// Propose a slash against a subject.
    pub fn propose_slash(
        env: Env,
        caller: Address,
        subject: Address,
        penalty_basis_points: u32,
        evidence_hash: U256,
    ) -> Result<u64, ContractError> {
        Self::ensure_initialized(&env)?;
        Self::ensure_submitter(&env, &caller)?;

        if penalty_basis_points > 10000 {
            return Err(ContractError::InvalidBasisPoints);
        }

        let slash_id = Self::get_next_slash_id(&env);
        env.storage().instance().set(&DataKey::NextSlashId, &(slash_id + 1));

        let challenge_window = Self::get_challenge_window(&env);

        let proposal = SlashProposal {
            subject: subject.clone(),
            proposer: caller.clone(),
            penalty_basis_points,
            evidence_hash,
            proposed_at: env.ledger().timestamp(),
            challenge_window,
            status: SlashStatus::Proposed,
        };

        env.storage().instance().set(&DataKey::SlashProposal(slash_id), &proposal);

        env.events().publish(
            (String::from_str(&env, "propose_slash"), caller),
            (subject, slash_id),
        );

        Ok(slash_id)
    }

    /// Finalize a slash after the challenge window.
    pub fn finalize_slash(env: Env, caller: Address, slash_id: u64) -> Result<(), ContractError> {
        Self::ensure_initialized(&env)?;
        Self::ensure_authorized(&env, &caller)?;

        let mut proposal: SlashProposal = env
            .storage()
            .instance()
            .get(&DataKey::SlashProposal(slash_id))
            .ok_or(ContractError::SlashNotFound)?;

        if matches!(proposal.status, SlashStatus::Finalized) {
            return Err(ContractError::SlashAlreadyFinalized);
        }
        if matches!(proposal.status, SlashStatus::Cancelled) {
            return Err(ContractError::SlashAlreadyCancelled);
        }

        let now = env.ledger().timestamp();
        if now < proposal.proposed_at + proposal.challenge_window {
            return Err(ContractError::SlashNotFinalizable);
        }

        proposal.status = SlashStatus::Finalized;
        env.storage().instance().set(&DataKey::SlashProposal(slash_id), &proposal);

        // Update slash count
        let slash_count = Self::increment_slash_count(&env, &proposal.subject);
        env.storage().instance().set(&DataKey::SlashCount(proposal.subject.clone()), &slash_count);

        // Update total slashed
        let total = Self::increment_total_slashed(&env);
        env.storage().instance().set(&DataKey::TotalSlashed, &total);

        // Check if subject should be jailed
        Self::check_and_apply_jail(&env, &proposal.subject, slash_count);

        env.events().publish((String::from_str(&env, "finalize_slash"), caller), slash_id);

        Ok(())
    }

    /// Cancel a slash before finalization.
    pub fn cancel_slash(env: Env, caller: Address, slash_id: u64) -> Result<(), ContractError> {
        Self::ensure_initialized(&env)?;
        Self::ensure_authorized(&env, &caller)?;

        let mut proposal: SlashProposal = env
            .storage()
            .instance()
            .get(&DataKey::SlashProposal(slash_id))
            .ok_or(ContractError::SlashNotFound)?;

        if matches!(proposal.status, SlashStatus::Finalized) {
            return Err(ContractError::SlashAlreadyFinalized);
        }
        if matches!(proposal.status, SlashStatus::Cancelled) {
            return Err(ContractError::SlashAlreadyCancelled);
        }

        proposal.status = SlashStatus::Cancelled;
        env.storage().instance().set(&DataKey::SlashProposal(slash_id), &proposal);

        env.events().publish((String::from_str(&env, "cancel_slash"), caller), slash_id);

        Ok(())
    }

    /// Get a pending slash proposal.
    pub fn get_pending_slash(env: Env, slash_id: u64) -> Option<SlashProposal> {
        env.storage().instance().get(&DataKey::SlashProposal(slash_id))
    }

    /// Check if an address is jailed.
    pub fn is_jailed(env: Env, address: Address) -> bool {
        env.storage().instance().has(&DataKey::JailedStatus(address))
    }

    /// Request unjailing.
    pub fn unjail(env: Env, caller: Address) -> Result<(), ContractError> {
        Self::ensure_initialized(&env)?;

        if !env.storage().instance().has(&DataKey::JailedStatus(caller.clone())) {
            return Err(ContractError::NotJailed);
        }

        env.events().publish((String::from_str(&env, "unjail"), caller), ());

        Ok(())
    }

    /// Approve unjailing (admin only).
    pub fn approve_unjail(env: Env, caller: Address, address: Address) -> Result<(), ContractError> {
        Self::ensure_initialized(&env)?;
        Self::ensure_authorized(&env, &caller)?;

        if !env.storage().instance().has(&DataKey::JailedStatus(address.clone())) {
            return Err(ContractError::NotJailed);
        }

        env.storage().instance().remove(&DataKey::JailedStatus(address.clone()));

        env.events().publish((String::from_str(&env, "approve_unjail"), caller), address);

        Ok(())
    }

    /// Get slash count for an address.
    pub fn slash_count(env: Env, address: Address) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::SlashCount(address))
            .unwrap_or(0)
    }

    /// Get total slashed amount.
    pub fn total_slashed(env: Env) -> u128 {
        env.storage().instance().get(&DataKey::TotalSlashed).unwrap_or(0)
    }

    /// Set the challenge window duration.
    pub fn set_challenge_window(env: Env, caller: Address, window: u64) -> Result<(), ContractError> {
        Self::ensure_initialized(&env)?;
        Self::ensure_authorized(&env, &caller)?;

        env.storage().instance().set(&DataKey::ChallengeWindow, &window);

        env.events().publish((String::from_str(&env, "set_challenge_window"), caller), window);

        Ok(())
    }

    /// Set the bond contract address.
    pub fn set_bond_contract(env: Env, caller: Address, bond_contract: Address) -> Result<(), ContractError> {
        Self::ensure_initialized(&env)?;
        Self::ensure_authorized(&env, &caller)?;

        env.storage().instance().set(&DataKey::BondContract, &bond_contract);

        env.events().publish((String::from_str(&env, "set_bond_contract"), caller), bond_contract);

        Ok(())
    }

    fn ensure_initialized(env: &Env) -> Result<(), ContractError> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::NotInitialized);
        }
        Ok(())
    }

    fn ensure_authorized(env: &Env, caller: &Address) -> Result<(), ContractError> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        let is_admin = admin == *caller;
        let is_operator = env.storage().instance().get(&DataKey::Operator(caller.clone())).unwrap_or(false);

        if !is_admin && !is_operator {
            return Err(ContractError::NotAuthorized);
        }
        Ok(())
    }

    fn ensure_submitter(env: &Env, caller: &Address) -> Result<(), ContractError> {
        let is_submitter = env.storage().instance().get(&DataKey::Submitter(caller.clone())).unwrap_or(false);
        if !is_submitter {
            return Err(ContractError::NotAuthorized);
        }
        Ok(())
    }

    fn get_next_slash_id(env: &Env) -> u64 {
        env.storage().instance().get(&DataKey::NextSlashId).unwrap_or(0)
    }

    fn get_challenge_window(env: &Env) -> u64 {
        env.storage().instance().get(&DataKey::ChallengeWindow).unwrap_or(86400)
    }

    fn increment_slash_count(env: &Env, address: &Address) -> u32 {
        let count = env.storage().instance().get(&DataKey::SlashCount(address.clone())).unwrap_or(0);
        count + 1
    }

    fn increment_total_slashed(env: &Env) -> u128 {
        let total = env.storage().instance().get(&DataKey::TotalSlashed).unwrap_or(0);
        total + 1
    }

    fn check_and_apply_jail(env: &Env, address: &Address, slash_count: u32) {
        let tiers: Vec<PenaltyTier> = env.storage().instance().get(&DataKey::PenaltyTiers).unwrap_or_default();

        for tier in tiers.iter() {
            if slash_count >= tier.offense_count {
                let jailed = JailedStatus {
                    jailed_at: env.ledger().timestamp(),
                    slash_count,
                };
                env.storage().instance().set(&DataKey::JailedStatus(address.clone()), &jailed);
                return;
            }
        }
    }

    fn compute_hash(evidence: U256, salt: U256) -> U256 {
        // Simple XOR for demo - in production use proper hashing
        let e_low = evidence.low;
        let e_high = evidence.high;
        let s_low = salt.low;
        let s_high = salt.high;
        U256::from_u128_pair(e_low ^ s_low, e_high ^ s_high)
    }
}

#[cfg(test)]
mod test;
