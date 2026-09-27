#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Bytes, Env, Symbol, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidThreshold = 3,
    NotASigner = 4,
    ProposalExpired = 5,
    NotPending = 6,
    AlreadyApproved = 7,
    NotApproved = 8,
    NotEnoughApprovals = 9,
    UnknownProposal = 10,
}

pub type MultisigError = ContractError;

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Config {
    pub signers: Vec<Address>,
    pub threshold: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProposalStatus {
    Pending,
    Executed,
    Cancelled,
    Expired,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Proposal {
    pub proposer: Address,
    pub operation: OperationType,
    pub params: Bytes,
    pub expiry: u64,
    pub status: ProposalStatus,
    pub approval_count: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OperationType {
    ForceReleaseEscrow,
    ExecuteSlash,
    UpgradeContract,
    SetOracleStaleness,
    FreezeAccount,
    UpdateUpgradeDelay,
}

#[contracttype]
pub enum DataKey {
    Config,
    NextProposalId,
    Proposal(u64),
    Approvals(u64),
}

#[contract]
pub struct MultisigAdmin;

#[contractimpl]
impl MultisigAdmin {
    pub fn init(env: Env, signers: Vec<Address>, threshold: u32) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(ContractError::AlreadyInitialized);
        }
        if threshold == 0 || (threshold > signers.len()) {
            return Err(ContractError::InvalidThreshold);
        }
        let cfg = Config {
            signers: signers.clone(),
            threshold,
        };
        env.storage().instance().set(&DataKey::Config, &cfg);
        env.storage()
            .instance()
            .set(&DataKey::NextProposalId, &1u64);
        env.events().publish(
            (
                Symbol::new(&env, "multisig_admin"),
                Symbol::new(&env, "init"),
            ),
            (),
        );
        Ok(())
    }

    pub fn propose(
        env: Env,
        proposer: Address,
        operation: OperationType,
        params: Bytes,
        expiry: u64,
    ) -> Result<u64, ContractError> {
        proposer.require_auth();
        let cfg: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(ContractError::NotInitialized)?;
        if !cfg.signers.contains(&proposer) {
            return Err(ContractError::NotASigner);
        }
        // Reject proposals with an expiry already in the past
        let now = env.ledger().timestamp();
        if expiry != 0 && now >= expiry {
            return Err(ContractError::ProposalExpired);
        }
        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextProposalId)
            .unwrap_or(1u64);
        let prop = Proposal {
            proposer: proposer.clone(),
            operation,
            params,
            expiry,
            status: ProposalStatus::Pending,
            approval_count: 0,
        };
        env.storage().instance().set(&DataKey::Proposal(id), &prop);
        let approvals: Vec<Address> = Vec::new(&env);
        env.storage()
            .instance()
            .set(&DataKey::Approvals(id), &approvals);
        env.storage()
            .instance()
            .set(&DataKey::NextProposalId, &(id + 1));
        env.events().publish(
            (
                Symbol::new(&env, "multisig_admin"),
                Symbol::new(&env, "proposal_created"),
            ),
            id,
        );
        Ok(id)
    }

    pub fn approve(env: Env, signer: Address, proposal_id: u64) -> Result<(), ContractError> {
        signer.require_auth();
        let cfg: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(ContractError::NotInitialized)?;
        if !cfg.signers.contains(&signer) {
            return Err(ContractError::NotASigner);
        }
        let prop: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(ContractError::UnknownProposal)?;
        if let ProposalStatus::Pending = prop.status {
        } else {
            return Err(ContractError::NotPending);
        }
        // Reject approval on expired proposals and emit the expired event
        let now = env.ledger().timestamp();
        if prop.expiry != 0 && now > prop.expiry {
            let mut expired_prop = prop.clone();
            expired_prop.status = ProposalStatus::Expired;
            env.storage()
                .instance()
                .set(&DataKey::Proposal(proposal_id), &expired_prop);
            env.events().publish(
                (
                    Symbol::new(&env, "multisig_admin"),
                    Symbol::new(&env, "proposal_expired"),
                ),
                proposal_id,
            );
            return Err(ContractError::ProposalExpired);
        }
        let mut approvals: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Approvals(proposal_id))
            .unwrap_or_else(|| Vec::new(&env));
        if approvals.contains(&signer) {
            return Err(ContractError::AlreadyApproved);
        }
        approvals.push_back(signer.clone());
        let mut updated_prop = prop;
        updated_prop.approval_count = approvals.len();
        env.storage()
            .instance()
            .set(&DataKey::Approvals(proposal_id), &approvals);
        env.storage()
            .instance()
            .set(&DataKey::Proposal(proposal_id), &updated_prop);
        env.events().publish(
            (
                Symbol::new(&env, "multisig_admin"),
                Symbol::new(&env, "proposal_approved"),
            ),
            (proposal_id, signer),
        );
        Ok(())
    }

    /// Revoke a prior approval from `signer` for `proposal_id`.
    ///
    /// Lowers the live approval count. If count drops below threshold the
    /// proposal cannot be executed until re-approved. The proposal must still
    /// be Pending and not expired.
    pub fn revoke_approval(
        env: Env,
        signer: Address,
        proposal_id: u64,
    ) -> Result<(), ContractError> {
        signer.require_auth();
        let cfg: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(ContractError::NotInitialized)?;
        if !cfg.signers.contains(&signer) {
            return Err(ContractError::NotASigner);
        }
        let prop: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(ContractError::UnknownProposal)?;
        if let ProposalStatus::Pending = prop.status {
        } else {
            return Err(ContractError::NotPending);
        }
        // Reject revocation on already-expired proposals
        let now = env.ledger().timestamp();
        if prop.expiry != 0 && now > prop.expiry {
            return Err(ContractError::ProposalExpired);
        }
        let approvals: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Approvals(proposal_id))
            .unwrap_or_else(|| Vec::new(&env));
        if !approvals.contains(&signer) {
            return Err(ContractError::NotApproved);
        }
        // Rebuild the approvals list without the revoking signer
        let mut new_approvals: Vec<Address> = Vec::new(&env);
        for i in 0..approvals.len() {
            let addr = approvals.get(i).unwrap();
            if addr != signer {
                new_approvals.push_back(addr);
            }
        }
        let mut updated_prop = prop;
        updated_prop.approval_count = new_approvals.len();
        env.storage()
            .instance()
            .set(&DataKey::Approvals(proposal_id), &new_approvals);
        env.storage()
            .instance()
            .set(&DataKey::Proposal(proposal_id), &updated_prop);
        env.events().publish(
            (
                Symbol::new(&env, "multisig_admin"),
                Symbol::new(&env, "approval_revoked"),
            ),
            (proposal_id, signer),
        );
        Ok(())
    }

    pub fn execute(env: Env, executor: Address, proposal_id: u64) -> Result<(), ContractError> {
        executor.require_auth();
        let cfg: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(ContractError::NotInitialized)?;
        if !cfg.signers.contains(&executor) {
            return Err(ContractError::NotASigner);
        }
        let mut prop: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(ContractError::UnknownProposal)?;
        if let ProposalStatus::Pending = prop.status {
        } else {
            return Err(ContractError::NotPending);
        }
        let now: u64 = env.ledger().timestamp();
        if prop.expiry != 0 && now > prop.expiry {
            prop.status = ProposalStatus::Expired;
            env.storage()
                .instance()
                .set(&DataKey::Proposal(proposal_id), &prop);
            env.events().publish(
                (
                    Symbol::new(&env, "multisig_admin"),
                    Symbol::new(&env, "proposal_expired"),
                ),
                proposal_id,
            );
            return Err(ContractError::ProposalExpired);
        }
        // Re-check live approval count (may have been lowered by revocations)
        let approvals: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Approvals(proposal_id))
            .unwrap_or_else(|| Vec::new(&env));
        if approvals.len() < cfg.threshold {
            return Err(ContractError::NotEnoughApprovals);
        }
        prop.status = ProposalStatus::Executed;
        env.storage()
            .instance()
            .set(&DataKey::Proposal(proposal_id), &prop);
        env.events().publish(
            (
                Symbol::new(&env, "multisig_admin"),
                Symbol::new(&env, "proposal_executed"),
            ),
            proposal_id,
        );
        Ok(())
    }

    pub fn cancel(env: Env, caller: Address, proposal_id: u64) -> Result<(), ContractError> {
        caller.require_auth();
        let cfg: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(ContractError::NotInitialized)?;
        if !cfg.signers.contains(&caller) {
            return Err(ContractError::NotASigner);
        }
        let mut prop: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(ContractError::UnknownProposal)?;
        if let ProposalStatus::Pending = prop.status {
        } else {
            return Err(ContractError::NotPending);
        }
        prop.status = ProposalStatus::Cancelled;
        env.storage()
            .instance()
            .set(&DataKey::Proposal(proposal_id), &prop);
        env.events().publish(
            (
                Symbol::new(&env, "multisig_admin"),
                Symbol::new(&env, "proposal_cancelled"),
            ),
            proposal_id,
        );
        Ok(())
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> Result<Proposal, ContractError> {
        env.storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(ContractError::UnknownProposal)
    }

    /// List all proposal IDs, optionally filtered by status.
    /// Returns all IDs when status_filter is None.
    pub fn list_proposals(env: Env, status_filter: Option<ProposalStatus>) -> Vec<u64> {
        let mut out: Vec<u64> = Vec::new(&env);
        let next: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextProposalId)
            .unwrap_or(1u64);
        let mut i = 1u64;
        while i < next {
            if let Some(ref filter) = status_filter {
                if let Some(prop) = env
                    .storage()
                    .instance()
                    .get::<_, Proposal>(&DataKey::Proposal(i))
                {
                    if &prop.status == filter {
                        out.push_back(i);
                    }
                }
            } else {
                out.push_back(i);
            }
            i += 1;
        }
        out
    }
}

#[cfg(test)]
mod test {
    extern crate std;
    use super::*;
    use soroban_sdk::testutils::{Address as _, Events, Ledger as _};
    use soroban_sdk::{Address, Env, TryIntoVal};

    fn setup(env: &Env) -> (Address, Address, Address, Vec<Address>) {
        let a = Address::generate(env);
        let b = Address::generate(env);
        let c = Address::generate(env);
        let mut signers: Vec<Address> = Vec::new(env);
        signers.push_back(a.clone());
        signers.push_back(b.clone());
        signers.push_back(c.clone());
        (a, b, c, signers)
    }

    #[test]
    fn threshold_execute_flow() {
        let env = Env::default();
        let (a, b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);

        let id = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        client.approve(&a, &id);
        client.approve(&b, &id);
        client.execute(&a, &id);
        let prop = client.get_proposal(&id);
        assert_eq!(prop.status, ProposalStatus::Executed);
    }

    #[test]
    fn threshold_not_reached_execute_fails() {
        let env = Env::default();
        let (a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);

        let id = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        client.approve(&a, &id);
        // only 1 of 2 required approvals — execute must fail with NotEnoughApprovals
        let res = client.try_execute(&a, &id);
        assert_eq!(res, Err(Ok(ContractError::NotEnoughApprovals)));
    }

    #[test]
    fn expired_proposal_execute_fails() {
        let env = Env::default();
        let (a, b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);

        // Set expiry in the past relative to the current ledger timestamp
        let expiry = env.ledger().timestamp() + 5;
        let id = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &expiry,
        );
        client.approve(&a, &id);
        client.approve(&b, &id);
        // Advance ledger past expiry
        env.ledger().set_timestamp(expiry + 1);
        let res = client.try_execute(&a, &id);
        assert_eq!(res, Err(Ok(ContractError::ProposalExpired)));
    }

    #[test]
    fn duplicate_approval_fails() {
        let env = Env::default();
        let (a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        let id = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        client.approve(&a, &id);
        let res = client.try_approve(&a, &id);
        assert_eq!(res, Err(Ok(ContractError::AlreadyApproved)));
    }

    #[test]
    fn non_signer_cannot_propose() {
        let env = Env::default();
        let (_a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        let outsider = Address::generate(&env);
        let res = client.try_propose(
            &outsider,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        assert_eq!(res, Err(Ok(ContractError::NotASigner)));
    }

    #[test]
    fn non_signer_cannot_approve() {
        let env = Env::default();
        let (a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        let id = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        let outsider = Address::generate(&env);
        let res = client.try_approve(&outsider, &id);
        assert_eq!(res, Err(Ok(ContractError::NotASigner)));
    }

    #[test]
    fn non_signer_cannot_execute() {
        let env = Env::default();
        let (a, b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        let id = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        client.approve(&a, &id);
        client.approve(&b, &id);
        let outsider = Address::generate(&env);
        let res = client.try_execute(&outsider, &id);
        assert_eq!(res, Err(Ok(ContractError::NotASigner)));
    }

    #[test]
    fn cancel_removes_proposal_from_pending() {
        let env = Env::default();
        let (a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        let id = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        client.cancel(&a, &id);
        let prop = client.get_proposal(&id);
        assert_eq!(prop.status, ProposalStatus::Cancelled);
    }

    #[test]
    fn execute_cancelled_proposal_fails() {
        let env = Env::default();
        let (a, b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        let id = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        client.approve(&a, &id);
        client.approve(&b, &id);
        client.cancel(&a, &id);
        let res = client.try_execute(&a, &id);
        assert_eq!(res, Err(Ok(ContractError::NotPending)));
    }

    #[test]
    fn list_proposals_with_status_filter() {
        let env = Env::default();
        let (a, b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);

        let id1 = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        let id2 = client.propose(
            &a,
            &OperationType::UpgradeContract,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        client.approve(&a, &id1);
        client.approve(&b, &id1);
        client.execute(&a, &id1);

        // id1 is Executed, id2 is Pending
        let pending = client.list_proposals(&Option::Some(ProposalStatus::Pending));
        assert_eq!(pending.len(), 1);
        assert_eq!(pending.get(0).unwrap(), id2);

        let executed = client.list_proposals(&Option::Some(ProposalStatus::Executed));
        assert_eq!(executed.len(), 1);
        assert_eq!(executed.get(0).unwrap(), id1);

        let all = client.list_proposals(&Option::<ProposalStatus>::None);
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn approval_count_tracked() {
        let env = Env::default();
        let (a, b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        let id = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        assert_eq!(client.get_proposal(&id).approval_count, 0);
        client.approve(&a, &id);
        assert_eq!(client.get_proposal(&id).approval_count, 1);
        client.approve(&b, &id);
        assert_eq!(client.get_proposal(&id).approval_count, 2);
    }

    // ── TTL / expiry on approve ───────────────────────────────────────────────

    #[test]
    fn expiry_blocks_approve() {
        let env = Env::default();
        let (a, b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);

        let expiry = env.ledger().timestamp() + 10;
        let id = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &expiry,
        );
        // Advance past expiry
        env.ledger().set_timestamp(expiry + 1);
        // Approve on an expired proposal must fail with ProposalExpired
        let res = client.try_approve(&b, &id);
        assert_eq!(res, Err(Ok(ContractError::ProposalExpired)));
    }

    // ── Revocation ───────────────────────────────────────────────────────────

    #[test]
    fn revoke_below_threshold_blocks_execute() {
        let env = Env::default();
        let (a, b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);

        let id = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        client.approve(&a, &id);
        client.approve(&b, &id);
        assert_eq!(client.get_proposal(&id).approval_count, 2);

        // Revoke one — drops below threshold
        client.revoke_approval(&b, &id);
        assert_eq!(client.get_proposal(&id).approval_count, 1);

        // Execute must fail: only 1 of 2 required approvals
        let res = client.try_execute(&a, &id);
        assert_eq!(res, Err(Ok(ContractError::NotEnoughApprovals)));
    }

    #[test]
    fn revoke_then_reapprove_succeeds() {
        let env = Env::default();
        let (a, b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);

        let id = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        client.approve(&a, &id);
        client.approve(&b, &id);

        // B revokes their approval
        client.revoke_approval(&b, &id);
        assert_eq!(client.get_proposal(&id).approval_count, 1);

        // B re-approves — count is back to 2
        client.approve(&b, &id);
        assert_eq!(client.get_proposal(&id).approval_count, 2);

        // Execute must now succeed
        client.execute(&a, &id);
        let prop = client.get_proposal(&id);
        assert_eq!(prop.status, ProposalStatus::Executed);
    }

    #[test]
    fn revoke_without_prior_approval_fails() {
        let env = Env::default();
        let (a, b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);

        let id = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        // B never approved — revoke must return NotApproved
        assert_eq!(
            client.try_revoke_approval(&b, &id),
            Err(Ok(ContractError::NotApproved))
        );
    }

    #[test]
    fn non_signer_cannot_revoke() {
        let env = Env::default();
        let (a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);

        let id = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        client.approve(&a, &id);
        let outsider = Address::generate(&env);
        assert_eq!(
            client.try_revoke_approval(&outsider, &id),
            Err(Ok(ContractError::NotASigner))
        );
    }

    #[test]
    fn double_approve_is_idempotent_via_rejection() {
        let env = Env::default();
        let (a, b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);

        let id = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        client.approve(&a, &id);
        // Second approve from same signer is rejected (count stays at 1)
        let res = client.try_approve(&a, &id);
        assert_eq!(res, Err(Ok(ContractError::AlreadyApproved)));
        assert_eq!(client.get_proposal(&id).approval_count, 1);

        // Proposal is still live — another signer can still approve
        client.approve(&b, &id);
        assert_eq!(client.get_proposal(&id).approval_count, 2);
        client.execute(&a, &id);
    }

    // ── init validation ───────────────────────────────────────────────────────

    #[test]
    fn double_init_fails() {
        let env = Env::default();
        let (_a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        // Second init must panic / fail with AlreadyInitialized
        assert_eq!(
            client.try_init(&signers, &2u32),
            Err(Ok(ContractError::AlreadyInitialized))
        );
    }

    #[test]
    fn init_zero_threshold_fails() {
        let env = Env::default();
        let (_a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        assert_eq!(
            client.try_init(&signers, &0u32),
            Err(Ok(ContractError::InvalidThreshold))
        );
    }

    #[test]
    fn init_threshold_exceeds_signers_fails() {
        let env = Env::default();
        let (_a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        // 3 signers, threshold 4 — must fail with InvalidThreshold
        assert_eq!(
            client.try_init(&signers, &4u32),
            Err(Ok(ContractError::InvalidThreshold))
        );
    }

    #[test]
    fn single_signer_threshold_one_flow() {
        let env = Env::default();
        let (a, _b, _c, _signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        let mut signers: Vec<Address> = Vec::new(&env);
        signers.push_back(a.clone());
        client.init(&signers, &1u32);

        let id = client.propose(
            &a,
            &OperationType::UpgradeContract,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        client.approve(&a, &id);
        // A single approval meets the threshold of 1
        client.execute(&a, &id);
        assert_eq!(client.get_proposal(&id).status, ProposalStatus::Executed);
    }

    // ── propose guards ─────────────────────────────────────────────────────────

    #[test]
    fn propose_before_init_fails() {
        let env = Env::default();
        let (a, _b, _c, _signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        // No init — propose must fail with NotInitialized
        assert_eq!(
            client.try_propose(
                &a,
                &OperationType::FreezeAccount,
                &Bytes::from_slice(&env, b"{}"),
                &0u64,
            ),
            Err(Ok(ContractError::NotInitialized))
        );
    }

    #[test]
    fn propose_with_past_expiry_fails() {
        let env = Env::default();
        let (a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        // Advance the ledger so a non-zero expiry lands in the past
        env.ledger().set_timestamp(100);
        assert_eq!(
            client.try_propose(
                &a,
                &OperationType::FreezeAccount,
                &Bytes::from_slice(&env, b"{}"),
                &50u64,
            ),
            Err(Ok(ContractError::ProposalExpired))
        );
    }

    #[test]
    fn proposal_ids_increment() {
        let env = Env::default();
        let (a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        let id1 = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        let id2 = client.propose(
            &a,
            &OperationType::UpgradeContract,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        assert_eq!(id1, 1u64);
        assert_eq!(id2, 2u64);
    }

    // ── approve / execute / cancel error paths ─────────────────────────────────

    #[test]
    fn approve_unknown_proposal_fails() {
        let env = Env::default();
        let (a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        assert_eq!(
            client.try_approve(&a, &999u64),
            Err(Ok(ContractError::UnknownProposal))
        );
    }

    #[test]
    fn approve_executed_proposal_fails() {
        let env = Env::default();
        let (a, b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        let id = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        client.approve(&a, &id);
        client.approve(&b, &id);
        client.execute(&a, &id);
        // Approving an already-executed proposal must fail with NotPending
        assert_eq!(
            client.try_approve(&b, &id),
            Err(Ok(ContractError::NotPending))
        );
    }

    #[test]
    fn execute_unknown_proposal_fails() {
        let env = Env::default();
        let (a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        assert_eq!(
            client.try_execute(&a, &999u64),
            Err(Ok(ContractError::UnknownProposal))
        );
    }

    #[test]
    fn cancel_unknown_proposal_fails() {
        let env = Env::default();
        let (a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        assert_eq!(
            client.try_cancel(&a, &999u64),
            Err(Ok(ContractError::UnknownProposal))
        );
    }

    #[test]
    fn cancel_already_cancelled_fails() {
        let env = Env::default();
        let (a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        let id = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        client.cancel(&a, &id);
        // Cancelling twice must fail with NotPending
        assert_eq!(
            client.try_cancel(&a, &id),
            Err(Ok(ContractError::NotPending))
        );
    }

    #[test]
    fn non_signer_cannot_cancel() {
        let env = Env::default();
        let (a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        let id = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        let outsider = Address::generate(&env);
        assert_eq!(
            client.try_cancel(&outsider, &id),
            Err(Ok(ContractError::NotASigner))
        );
    }

    #[test]
    fn get_unknown_proposal_fails() {
        let env = Env::default();
        let (_a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        assert_eq!(
            client.try_get_proposal(&42u64),
            Err(Ok(ContractError::UnknownProposal))
        );
    }

    // ── revoke error paths ─────────────────────────────────────────────────────

    #[test]
    fn revoke_on_cancelled_proposal_fails() {
        let env = Env::default();
        let (a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        let id = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        client.approve(&a, &id);
        client.cancel(&a, &id);
        // Revoking an approval on a cancelled proposal must fail with NotPending
        assert_eq!(
            client.try_revoke_approval(&a, &id),
            Err(Ok(ContractError::NotPending))
        );
    }

    // ── threshold boundary: extra approvals & duplicate signer ────────────────

    #[test]
    fn extra_approvals_beyond_threshold_execute() {
        // 3 signers, threshold 2, but all 3 approve. Execute must still succeed
        // and the approval count must be 3 — no double-counting, no rejection of
        // the "extra" signature.
        let env = Env::default();
        let (a, b, c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);

        let id = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        client.approve(&a, &id);
        client.approve(&b, &id);
        client.approve(&c, &id);
        assert_eq!(client.get_proposal(&id).approval_count, 3);

        client.execute(&a, &id);
        assert_eq!(client.get_proposal(&id).status, ProposalStatus::Executed);
    }

    #[test]
    fn duplicate_signer_approval_not_double_counted() {
        // The same signer approving twice must NOT count as two signatures.
        // The second approval is rejected (AlreadyApproved) and the count stays
        // at 1 — still below the threshold of 2.
        let env = Env::default();
        let (a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);

        let id = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        client.approve(&a, &id);
        let dup = client.try_approve(&a, &id);
        assert_eq!(dup, Err(Ok(ContractError::AlreadyApproved)));
        assert_eq!(
            client.get_proposal(&id).approval_count,
            1,
            "duplicate approval must not increment the count"
        );

        // Confirm the proposal is genuinely still under threshold: execute fails.
        let exec = client.try_execute(&a, &id);
        assert_eq!(exec, Err(Ok(ContractError::NotEnoughApprovals)));
    }

    // ── event assertions ─────────────────────────────────────────────────────────

    fn last_event_name(env: &Env) -> Symbol {
        let events = env.events().all();
        let last = events.last().unwrap();
        let topics: Vec<soroban_sdk::Val> = last.1.clone();
        // topics = (Symbol "multisig_admin", Symbol "<event name>")
        topics.get(1).unwrap().try_into_val(env).unwrap()
    }

    #[test]
    fn event_init_emitted() {
        let env = Env::default();
        let (_a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        assert_eq!(last_event_name(&env), Symbol::new(&env, "init"));
    }

    #[test]
    fn event_proposal_created_emitted() {
        let env = Env::default();
        let (a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        let id = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        let events = env.events().all();
        let last = events.last().unwrap();
        let topics: Vec<soroban_sdk::Val> = last.1.clone();
        let name: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(name, Symbol::new(&env, "proposal_created"));
        let data: u64 = last.2.try_into_val(&env).unwrap();
        assert_eq!(data, id);
    }

    #[test]
    fn event_proposal_approved_emitted() {
        let env = Env::default();
        let (a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        let id = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        client.approve(&a, &id);
        let events = env.events().all();
        let last = events.last().unwrap();
        let topics: Vec<soroban_sdk::Val> = last.1.clone();
        let name: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(name, Symbol::new(&env, "proposal_approved"));
        let (pid, who): (u64, Address) = last.2.try_into_val(&env).unwrap();
        assert_eq!(pid, id);
        assert_eq!(who, a);
    }

    #[test]
    fn event_approval_revoked_emitted() {
        let env = Env::default();
        let (a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        let id = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        client.approve(&a, &id);
        client.revoke_approval(&a, &id);
        let events = env.events().all();
        let last = events.last().unwrap();
        let topics: Vec<soroban_sdk::Val> = last.1.clone();
        let name: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(name, Symbol::new(&env, "approval_revoked"));
        let (pid, who): (u64, Address) = last.2.try_into_val(&env).unwrap();
        assert_eq!(pid, id);
        assert_eq!(who, a);
    }

    #[test]
    fn event_proposal_executed_emitted() {
        let env = Env::default();
        let (a, b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        let id = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        client.approve(&a, &id);
        client.approve(&b, &id);
        client.execute(&a, &id);
        let events = env.events().all();
        let last = events.last().unwrap();
        let topics: Vec<soroban_sdk::Val> = last.1.clone();
        let name: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(name, Symbol::new(&env, "proposal_executed"));
        let data: u64 = last.2.try_into_val(&env).unwrap();
        assert_eq!(data, id);
    }

    #[test]
    fn event_proposal_cancelled_emitted() {
        let env = Env::default();
        let (a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        let id = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        client.cancel(&a, &id);
        assert_eq!(
            last_event_name(&env),
            Symbol::new(&env, "proposal_cancelled")
        );
        let events = env.events().all();
        let data: u64 = events.last().unwrap().2.try_into_val(&env).unwrap();
        assert_eq!(data, id);
    }

    // ── list_proposals edge cases ──────────────────────────────────────────────

    #[test]
    fn list_proposals_empty_when_none() {
        let env = Env::default();
        let (_a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        let all = client.list_proposals(&Option::<ProposalStatus>::None);
        assert_eq!(all.len(), 0);
    }

    #[test]
    fn list_proposals_filters_cancelled() {
        let env = Env::default();
        let (a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        let id1 = client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        let _id2 = client.propose(
            &a,
            &OperationType::UpgradeContract,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
        client.cancel(&a, &id1);

        let cancelled = client.list_proposals(&Option::Some(ProposalStatus::Cancelled));
        assert_eq!(cancelled.len(), 1);
        assert_eq!(cancelled.get(0).unwrap(), id1);

        let pending = client.list_proposals(&Option::Some(ProposalStatus::Pending));
        assert_eq!(pending.len(), 1);
    }
}
