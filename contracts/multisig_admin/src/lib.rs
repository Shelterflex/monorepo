#![no_std]

use soroban_access_control::extend_storage_ttl;
use soroban_pausable::{Pausable, PausableError};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Env, IntoVal, Symbol, TryFromVal,
    Val, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAuthorized = 3,
    Paused = 4,
    InvalidThreshold = 5,
    DuplicateSigner = 6,
    EmptySigners = 7,
    NotSigner = 8,
    ProposalNotFound = 9,
    ProposalNotPending = 10,
    ProposalExpired = 11,
    AlreadyApproved = 12,
    NotApproved = 13,
    AlreadyExecuted = 14,
    ThresholdNotReached = 15,
    InvalidTtl = 16,
}

impl From<PausableError> for Error {
    fn from(err: PausableError) -> Self {
        match err {
            PausableError::Paused => Error::Paused,
            PausableError::NotAuthorized => Error::NotAuthorized,
        }
    }
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ProposalStatus {
    Pending = 1,
    Executed = 2,
    Cancelled = 3,
    Expired = 4,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proposal {
    pub id: u64,
    pub proposer: Address,
    pub target: Address,
    pub function: Symbol,
    pub args: Vec<Val>,
    pub approvals: Vec<Address>,
    pub status: ProposalStatus,
    pub created_at: u64,
    pub expires_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Signers,
    Threshold,
    ProposalTtl,
    ProposalCount,
    Proposal(u64),
    CancelApprovals(u64),
    Paused,
}

// Ledger TTL policy. These match `soroban_access_control::extend_storage_ttl`, which
// extends persistent entries: an entry below 10,000 remaining ledgers is extended to
// 500,000 ledgers (about 29 days at a 5 second ledger close). Instance storage (signers,
// threshold, proposal TTL, pause flag) uses the same values.
const TTL_THRESHOLD_LEDGERS: u32 = 10_000;
const TTL_EXTEND_TO_LEDGERS: u32 = 500_000;

/// Extends the TTL of the contract instance (signers, threshold, proposal TTL, pause flag).
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
pub struct MultisigAdmin;

#[contractimpl]
impl MultisigAdmin {
    pub fn init(env: Env, signers: Vec<Address>, threshold: u32) -> Result<(), Error> {
        extend_instance_ttl(&env);
        if env.storage().instance().has(&DataKey::Signers) {
            return Err(Error::AlreadyInitialized);
        }

        validate_signers(&signers)?;
        if threshold < 1 || threshold > signers.len() {
            return Err(Error::InvalidThreshold);
        }

        env.storage().instance().set(&DataKey::Signers, &signers);
        env.storage()
            .instance()
            .set(&DataKey::Threshold, &threshold);
        env.storage()
            .instance()
            .set(&DataKey::ProposalTtl, &604_800u64); // 7 days
        env.storage().instance().set(&DataKey::Paused, &false);

        let count_key = DataKey::ProposalCount;
        env.storage().persistent().set(&count_key, &0u64);
        extend_storage_ttl(&env, &count_key.into_val(&env));

        env.events().publish(
            (Symbol::new(&env, "multisig"), Symbol::new(&env, "init")),
            (threshold, signers.len()),
        );

        Ok(())
    }

    pub fn propose(
        env: Env,
        proposer: Address,
        target: Address,
        function: Symbol,
        args: Vec<Val>,
    ) -> Result<u64, Error> {
        extend_instance_ttl(&env);
        require_not_paused(&env)?;
        if !Self::is_signer(env.clone(), proposer.clone()) {
            return Err(Error::NotSigner);
        }
        proposer.require_auth();

        let count_key = DataKey::ProposalCount;
        let mut count: u64 = env.storage().persistent().get(&count_key).unwrap_or(0u64);
        count += 1;
        env.storage().persistent().set(&count_key, &count);
        extend_storage_ttl(&env, &count_key.into_val(&env));

        let ttl: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ProposalTtl)
            .unwrap_or(604_800u64);
        let now = env.ledger().timestamp();
        let expires_at = now + ttl;

        let mut approvals = Vec::new(&env);
        approvals.push_back(proposer.clone());

        let proposal = Proposal {
            id: count,
            proposer: proposer.clone(),
            target: target.clone(),
            function: function.clone(),
            args,
            approvals,
            status: ProposalStatus::Pending,
            created_at: now,
            expires_at,
        };

        let prop_key = DataKey::Proposal(count);
        env.storage().persistent().set(&prop_key, &proposal);
        extend_storage_ttl(&env, &prop_key.into_val(&env));

        env.events().publish(
            (Symbol::new(&env, "multisig"), Symbol::new(&env, "proposed")),
            (count, proposer, target),
        );

        Ok(count)
    }

    pub fn approve(env: Env, signer: Address, proposal_id: u64) -> Result<(), Error> {
        extend_instance_ttl(&env);
        require_not_paused(&env)?;
        if !Self::is_signer(env.clone(), signer.clone()) {
            return Err(Error::NotSigner);
        }
        signer.require_auth();

        let prop_key = DataKey::Proposal(proposal_id);
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&prop_key)
            .ok_or(Error::ProposalNotFound)?;
        extend_persistent_if_present(&env, &prop_key);

        if proposal.status != ProposalStatus::Pending {
            return Err(Error::ProposalNotPending);
        }
        if env.ledger().timestamp() > proposal.expires_at {
            return Err(Error::ProposalExpired);
        }

        for a in proposal.approvals.iter() {
            if a == signer {
                return Err(Error::AlreadyApproved);
            }
        }

        proposal.approvals.push_back(signer.clone());
        env.storage().persistent().set(&prop_key, &proposal);
        extend_storage_ttl(&env, &prop_key.into_val(&env));

        env.events().publish(
            (Symbol::new(&env, "multisig"), Symbol::new(&env, "approved")),
            (proposal_id, signer),
        );

        Ok(())
    }

    pub fn revoke_approval(env: Env, signer: Address, proposal_id: u64) -> Result<(), Error> {
        extend_instance_ttl(&env);
        require_not_paused(&env)?;
        if !Self::is_signer(env.clone(), signer.clone()) {
            return Err(Error::NotSigner);
        }
        signer.require_auth();

        let prop_key = DataKey::Proposal(proposal_id);
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&prop_key)
            .ok_or(Error::ProposalNotFound)?;
        extend_persistent_if_present(&env, &prop_key);

        if proposal.status != ProposalStatus::Pending {
            return Err(Error::ProposalNotPending);
        }
        if env.ledger().timestamp() > proposal.expires_at {
            return Err(Error::ProposalExpired);
        }

        let mut new_approvals = Vec::new(&env);
        let mut found = false;
        for a in proposal.approvals.iter() {
            if a == signer {
                found = true;
            } else {
                new_approvals.push_back(a);
            }
        }

        if !found {
            return Err(Error::NotApproved);
        }

        proposal.approvals = new_approvals;
        env.storage().persistent().set(&prop_key, &proposal);
        extend_storage_ttl(&env, &prop_key.into_val(&env));

        env.events().publish(
            (Symbol::new(&env, "multisig"), Symbol::new(&env, "revoked")),
            (proposal_id, signer),
        );

        Ok(())
    }

    pub fn execute(env: Env, executor: Address, proposal_id: u64) -> Result<Val, Error> {
        extend_instance_ttl(&env);
        require_not_paused(&env)?;
        if !Self::is_signer(env.clone(), executor.clone()) {
            return Err(Error::NotSigner);
        }
        executor.require_auth();

        let prop_key = DataKey::Proposal(proposal_id);
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&prop_key)
            .ok_or(Error::ProposalNotFound)?;
        extend_persistent_if_present(&env, &prop_key);

        if proposal.status == ProposalStatus::Executed {
            return Err(Error::AlreadyExecuted);
        }
        if proposal.status != ProposalStatus::Pending {
            return Err(Error::ProposalNotPending);
        }
        if env.ledger().timestamp() > proposal.expires_at {
            return Err(Error::ProposalExpired);
        }

        let threshold: u32 = env
            .storage()
            .instance()
            .get(&DataKey::Threshold)
            .ok_or(Error::NotInitialized)?;

        if proposal.approvals.len() < threshold {
            return Err(Error::ThresholdNotReached);
        }

        proposal.status = ProposalStatus::Executed;
        env.storage().persistent().set(&prop_key, &proposal);
        extend_storage_ttl(&env, &prop_key.into_val(&env));
        let res = if proposal.target == env.current_contract_address() {
            if proposal.function == Symbol::new(&env, "change_signers") {
                let val = proposal.args.get(0).ok_or(Error::NotAuthorized)?;
                let new_signers =
                    Vec::<Address>::try_from_val(&env, &val).map_err(|_| Error::NotAuthorized)?;
                change_signers_internal(&env, new_signers)?;
                ().into_val(&env)
            } else if proposal.function == Symbol::new(&env, "change_threshold") {
                let val = proposal.args.get(0).ok_or(Error::NotAuthorized)?;
                let new_threshold =
                    u32::try_from_val(&env, &val).map_err(|_| Error::NotAuthorized)?;
                change_threshold_internal(&env, new_threshold)?;
                ().into_val(&env)
            } else if proposal.function == Symbol::new(&env, "set_proposal_ttl") {
                let val = proposal.args.get(0).ok_or(Error::NotAuthorized)?;
                let new_ttl = u64::try_from_val(&env, &val).map_err(|_| Error::NotAuthorized)?;
                set_proposal_ttl_internal(&env, new_ttl)?;
                ().into_val(&env)
            } else {
                return Err(Error::NotAuthorized);
            }
        } else {
            env.invoke_contract(&proposal.target, &proposal.function, proposal.args)
        };

        env.events().publish(
            (Symbol::new(&env, "multisig"), Symbol::new(&env, "executed")),
            (proposal_id, executor),
        );

        Ok(res)
    }

    pub fn cancel(env: Env, caller: Address, proposal_id: u64) -> Result<(), Error> {
        extend_instance_ttl(&env);
        require_not_paused(&env)?;
        caller.require_auth();

        let prop_key = DataKey::Proposal(proposal_id);
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&prop_key)
            .ok_or(Error::ProposalNotFound)?;
        extend_persistent_if_present(&env, &prop_key);

        if proposal.status != ProposalStatus::Pending {
            return Err(Error::ProposalNotPending);
        }

        if caller == proposal.proposer {
            proposal.status = ProposalStatus::Cancelled;
            env.storage().persistent().set(&prop_key, &proposal);
            extend_storage_ttl(&env, &prop_key.into_val(&env));

            env.events().publish(
                (
                    Symbol::new(&env, "multisig"),
                    Symbol::new(&env, "cancelled"),
                ),
                (proposal_id, caller),
            );
            return Ok(());
        }

        if Self::is_signer(env.clone(), caller.clone()) {
            let cancel_key = DataKey::CancelApprovals(proposal_id);
            let mut cancel_approvals: Vec<Address> = env
                .storage()
                .persistent()
                .get(&cancel_key)
                .unwrap_or(Vec::new(&env));
            extend_persistent_if_present(&env, &cancel_key);

            let mut already_voted = false;
            for a in cancel_approvals.iter() {
                if a == caller {
                    already_voted = true;
                    break;
                }
            }

            if !already_voted {
                cancel_approvals.push_back(caller.clone());
                env.storage()
                    .persistent()
                    .set(&cancel_key, &cancel_approvals);
                extend_storage_ttl(&env, &cancel_key.into_val(&env));
            }

            let threshold: u32 = env
                .storage()
                .instance()
                .get(&DataKey::Threshold)
                .ok_or(Error::NotInitialized)?;

            if cancel_approvals.len() >= threshold {
                proposal.status = ProposalStatus::Cancelled;
                env.storage().persistent().set(&prop_key, &proposal);
                extend_storage_ttl(&env, &prop_key.into_val(&env));

                env.events().publish(
                    (
                        Symbol::new(&env, "multisig"),
                        Symbol::new(&env, "cancelled"),
                    ),
                    (proposal_id, caller),
                );
            } else {
                env.events().publish(
                    (
                        Symbol::new(&env, "multisig"),
                        Symbol::new(&env, "cancel_vote"),
                    ),
                    (proposal_id, caller),
                );
            }

            return Ok(());
        }

        Err(Error::NotAuthorized)
    }

    pub fn get_proposal(env: Env, id: u64) -> Result<Proposal, Error> {
        extend_instance_ttl(&env);
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(id))
            .ok_or(Error::ProposalNotFound)?;
        extend_persistent_if_present(&env, &DataKey::Proposal(id));

        if proposal.status == ProposalStatus::Pending
            && env.ledger().timestamp() > proposal.expires_at
        {
            proposal.status = ProposalStatus::Expired;
        }

        Ok(proposal)
    }

    pub fn list_proposals(env: Env, status_filter: Option<ProposalStatus>) -> Vec<u64> {
        extend_instance_ttl(&env);
        let count: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::ProposalCount)
            .unwrap_or(0u64);
        extend_persistent_if_present(&env, &DataKey::ProposalCount);
        let mut result = Vec::new(&env);

        let mut id = 1u64;
        while id <= count {
            if let Ok(prop) = Self::get_proposal(env.clone(), id) {
                if let Some(target_status) = status_filter {
                    if prop.status == target_status {
                        result.push_back(id);
                    }
                } else {
                    result.push_back(id);
                }
            }
            id += 1;
        }

        result
    }

    // ── Self-Targeting Governance Methods ─────────────────────────────────────

    pub fn change_signers(env: Env, new_signers: Vec<Address>) -> Result<(), Error> {
        extend_instance_ttl(&env);
        env.current_contract_address().require_auth();
        change_signers_internal(&env, new_signers)
    }

    pub fn change_threshold(env: Env, new_threshold: u32) -> Result<(), Error> {
        extend_instance_ttl(&env);
        env.current_contract_address().require_auth();
        change_threshold_internal(&env, new_threshold)
    }

    pub fn set_proposal_ttl(env: Env, new_ttl: u64) -> Result<(), Error> {
        extend_instance_ttl(&env);
        env.current_contract_address().require_auth();
        set_proposal_ttl_internal(&env, new_ttl)
    }

    // ── View Helpers ──────────────────────────────────────────────────────────

    pub fn get_signers(env: Env) -> Vec<Address> {
        extend_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::Signers)
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_threshold(env: Env) -> u32 {
        extend_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::Threshold)
            .unwrap_or(0u32)
    }

    pub fn get_proposal_ttl(env: Env) -> u64 {
        extend_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::ProposalTtl)
            .unwrap_or(604_800u64)
    }

    pub fn is_signer(env: Env, caller: Address) -> bool {
        extend_instance_ttl(&env);
        let signers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Signers)
            .unwrap_or(Vec::new(&env));
        for s in signers.iter() {
            if s == caller {
                return true;
            }
        }
        false
    }
}

#[contractimpl]
impl Pausable for MultisigAdmin {
    fn pause(env: Env, admin: Address) -> Result<(), PausableError> {
        extend_instance_ttl(&env);
        if !MultisigAdmin::is_signer(env.clone(), admin.clone()) {
            return Err(PausableError::NotAuthorized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish(
            (Symbol::new(&env, "multisig"), Symbol::new(&env, "pause")),
            admin,
        );
        Ok(())
    }

    fn unpause(env: Env, admin: Address) -> Result<(), PausableError> {
        extend_instance_ttl(&env);
        if !MultisigAdmin::is_signer(env.clone(), admin.clone()) {
            return Err(PausableError::NotAuthorized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events().publish(
            (Symbol::new(&env, "multisig"), Symbol::new(&env, "unpause")),
            admin,
        );
        Ok(())
    }

    fn is_paused(env: Env) -> bool {
        extend_instance_ttl(&env);
        env.storage()
            .instance()
            .get::<_, bool>(&DataKey::Paused)
            .unwrap_or(false)
    }
}

fn change_signers_internal(env: &Env, new_signers: Vec<Address>) -> Result<(), Error> {
    validate_signers(&new_signers)?;

    let threshold: u32 = env
        .storage()
        .instance()
        .get(&DataKey::Threshold)
        .ok_or(Error::NotInitialized)?;
    if threshold > new_signers.len() {
        return Err(Error::InvalidThreshold);
    }

    env.storage()
        .instance()
        .set(&DataKey::Signers, &new_signers);
    env.events().publish(
        (
            Symbol::new(env, "multisig"),
            Symbol::new(env, "signers_changed"),
        ),
        new_signers.len(),
    );

    Ok(())
}

fn change_threshold_internal(env: &Env, new_threshold: u32) -> Result<(), Error> {
    let signers: Vec<Address> = env
        .storage()
        .instance()
        .get(&DataKey::Signers)
        .ok_or(Error::NotInitialized)?;

    if new_threshold < 1 || new_threshold > signers.len() {
        return Err(Error::InvalidThreshold);
    }

    env.storage()
        .instance()
        .set(&DataKey::Threshold, &new_threshold);
    env.events().publish(
        (
            Symbol::new(env, "multisig"),
            Symbol::new(env, "threshold_changed"),
        ),
        new_threshold,
    );

    Ok(())
}

fn set_proposal_ttl_internal(env: &Env, new_ttl: u64) -> Result<(), Error> {
    if new_ttl == 0 {
        return Err(Error::InvalidTtl);
    }

    env.storage()
        .instance()
        .set(&DataKey::ProposalTtl, &new_ttl);
    env.events().publish(
        (
            Symbol::new(env, "multisig"),
            Symbol::new(env, "ttl_changed"),
        ),
        new_ttl,
    );

    Ok(())
}

fn validate_signers(signers: &Vec<Address>) -> Result<(), Error> {
    if signers.is_empty() {
        return Err(Error::EmptySigners);
    }
    let len = signers.len();
    for i in 0..len {
        let a = signers.get(i).unwrap();
        for j in (i + 1)..len {
            let b = signers.get(j).unwrap();
            if a == b {
                return Err(Error::DuplicateSigner);
            }
        }
    }
    Ok(())
}

fn require_not_paused(env: &Env) -> Result<(), Error> {
    if MultisigAdmin::is_paused(env.clone()) {
        Err(Error::Paused)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod test;
