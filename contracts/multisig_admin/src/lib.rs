#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, Env, Symbol, Vec};

#[contracttype]
pub struct Config {
    pub signers: Vec<Address>,
    pub threshold: u32,
}

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum ProposalStatus {
    Pending,
    Executed,
    Cancelled,
    Expired,
}

#[contracttype]
#[derive(Clone)]
pub struct Proposal {
    pub proposer: Address,
    pub operation: OperationType,
    pub params: Bytes,
    pub expiry: u64,
    pub status: ProposalStatus,
    pub approval_count: u32,
}

#[contracttype]
#[derive(Clone)]
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
    pub fn init(env: Env, signers: Vec<Address>, threshold: u32) {
        if env.storage().instance().has(&DataKey::Config) {
            panic!("AlreadyInitialized");
        }
        if threshold == 0 || (threshold > signers.len() as u32) {
            panic!("InvalidThreshold");
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
    }

    pub fn propose(
        env: Env,
        proposer: Address,
        operation: OperationType,
        params: Bytes,
        expiry: u64,
    ) -> u64 {
        proposer.require_auth();
        let cfg: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .expect("NotInitialized");
        if !cfg.signers.contains(&proposer) {
            panic!("NotASigner");
        }
        // Reject proposals with an expiry already in the past
        let now = env.ledger().timestamp();
        if expiry != 0 && now >= expiry {
            panic!("ProposalExpired");
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
        id
    }

    pub fn approve(env: Env, signer: Address, proposal_id: u64) {
        signer.require_auth();
        let cfg: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .expect("NotInitialized");
        if !cfg.signers.contains(&signer) {
            panic!("NotASigner");
        }
        let prop: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("UnknownProposal");
        if let ProposalStatus::Pending = prop.status {
        } else {
            panic!("NotPending");
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
            panic!("ProposalExpired");
        }
        let mut approvals: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Approvals(proposal_id))
            .unwrap_or_else(|| Vec::new(&env));
        if approvals.contains(&signer) {
            panic!("AlreadyApproved");
        }
        approvals.push_back(signer.clone());
        let mut updated_prop = prop;
        updated_prop.approval_count = approvals.len() as u32;
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
    }

    /// Revoke a prior approval from `signer` for `proposal_id`.
    ///
    /// Lowers the live approval count. If count drops below threshold the
    /// proposal cannot be executed until re-approved. The proposal must still
    /// be Pending and not expired.
    pub fn revoke_approval(env: Env, signer: Address, proposal_id: u64) {
        signer.require_auth();
        let cfg: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .expect("NotInitialized");
        if !cfg.signers.contains(&signer) {
            panic!("NotASigner");
        }
        let prop: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("UnknownProposal");
        if let ProposalStatus::Pending = prop.status {
        } else {
            panic!("NotPending");
        }
        // Reject revocation on already-expired proposals
        let now = env.ledger().timestamp();
        if prop.expiry != 0 && now > prop.expiry {
            panic!("ProposalExpired");
        }
        let approvals: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Approvals(proposal_id))
            .unwrap_or_else(|| Vec::new(&env));
        if !approvals.contains(&signer) {
            panic!("NotApproved");
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
        updated_prop.approval_count = new_approvals.len() as u32;
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
    }

    pub fn execute(env: Env, executor: Address, proposal_id: u64) {
        executor.require_auth();
        let cfg: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .expect("NotInitialized");
        if !cfg.signers.contains(&executor) {
            panic!("NotASigner");
        }
        let mut prop: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("UnknownProposal");
        if let ProposalStatus::Pending = prop.status {
        } else {
            panic!("NotPending");
        }
        let now: u64 = env.ledger().timestamp() as u64;
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
            panic!("ProposalExpired");
        }
        // Re-check live approval count (may have been lowered by revocations)
        let approvals: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Approvals(proposal_id))
            .unwrap_or_else(|| Vec::new(&env));
        if (approvals.len() as u32) < cfg.threshold {
            panic!("NotEnoughApprovals");
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
    }

    pub fn cancel(env: Env, caller: Address, proposal_id: u64) {
        caller.require_auth();
        let cfg: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .expect("NotInitialized");
        if !cfg.signers.contains(&caller) {
            panic!("NotASigner");
        }
        let mut prop: Proposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("UnknownProposal");
        if let ProposalStatus::Pending = prop.status {
        } else {
            panic!("NotPending");
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
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> Proposal {
        env.storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("UnknownProposal")
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
        match prop.status {
            ProposalStatus::Executed => {}
            _ => panic!("expected executed"),
        }
    }

    #[test]
    #[should_panic(expected = "NotEnoughApprovals")]
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
        // only 1 of 2 required approvals — execute must panic
        client.execute(&a, &id);
    }

    #[test]
    #[should_panic(expected = "ProposalExpired")]
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
        client.execute(&a, &id);
    }

    #[test]
    #[should_panic(expected = "AlreadyApproved")]
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
        client.approve(&a, &id); // must panic
    }

    #[test]
    #[should_panic(expected = "NotASigner")]
    fn non_signer_cannot_propose() {
        let env = Env::default();
        let (a, b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        let outsider = Address::generate(&env);
        client.propose(
            &outsider,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
    }

    #[test]
    #[should_panic(expected = "NotASigner")]
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
        client.approve(&outsider, &id);
    }

    #[test]
    #[should_panic(expected = "NotASigner")]
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
        client.execute(&outsider, &id);
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
        match prop.status {
            ProposalStatus::Cancelled => {}
            _ => panic!("expected cancelled"),
        }
    }

    #[test]
    #[should_panic(expected = "NotPending")]
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
        client.execute(&a, &id); // must panic: NotPending
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
    #[should_panic(expected = "ProposalExpired")]
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
        // Approve on an expired proposal must panic
        client.approve(&b, &id);
    }

    // ── Revocation ───────────────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "NotEnoughApprovals")]
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
        client.execute(&a, &id);
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
        match prop.status {
            ProposalStatus::Executed => {}
            _ => panic!("expected executed"),
        }
    }

    #[test]
    #[should_panic(expected = "NotApproved")]
    fn revoke_without_prior_approval_panics() {
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
        // B never approved — revoke must panic
        client.revoke_approval(&b, &id);
    }

    #[test]
    #[should_panic(expected = "NotASigner")]
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
        client.revoke_approval(&outsider, &id);
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
        assert!(res.is_err(), "duplicate approve must be rejected");
        assert_eq!(client.get_proposal(&id).approval_count, 1);

        // Proposal is still live — another signer can still approve
        client.approve(&b, &id);
        assert_eq!(client.get_proposal(&id).approval_count, 2);
        client.execute(&a, &id);
    }

    // ── init validation ───────────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "AlreadyInitialized")]
    fn double_init_fails() {
        let env = Env::default();
        let (_a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        // Second init must panic
        client.init(&signers, &2u32);
    }

    #[test]
    #[should_panic(expected = "InvalidThreshold")]
    fn init_zero_threshold_fails() {
        let env = Env::default();
        let (_a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &0u32);
    }

    #[test]
    #[should_panic(expected = "InvalidThreshold")]
    fn init_threshold_exceeds_signers_fails() {
        let env = Env::default();
        let (_a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        // 3 signers, threshold 4 — must panic
        client.init(&signers, &4u32);
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
        match client.get_proposal(&id).status {
            ProposalStatus::Executed => {}
            _ => panic!("expected executed"),
        }
    }

    // ── propose guards ─────────────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "NotInitialized")]
    fn propose_before_init_fails() {
        let env = Env::default();
        let (a, _b, _c, _signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        // No init — propose must panic on missing config
        client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &0u64,
        );
    }

    #[test]
    #[should_panic(expected = "ProposalExpired")]
    fn propose_with_past_expiry_fails() {
        let env = Env::default();
        let (a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        // Advance the ledger so a non-zero expiry lands in the past
        env.ledger().set_timestamp(100);
        client.propose(
            &a,
            &OperationType::FreezeAccount,
            &Bytes::from_slice(&env, b"{}"),
            &50u64,
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
    #[should_panic(expected = "UnknownProposal")]
    fn approve_unknown_proposal_fails() {
        let env = Env::default();
        let (a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        client.approve(&a, &999u64);
    }

    #[test]
    #[should_panic(expected = "NotPending")]
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
        // Approving an already-executed proposal must panic
        client.approve(&b, &id);
    }

    #[test]
    #[should_panic(expected = "UnknownProposal")]
    fn execute_unknown_proposal_fails() {
        let env = Env::default();
        let (a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        client.execute(&a, &999u64);
    }

    #[test]
    #[should_panic(expected = "UnknownProposal")]
    fn cancel_unknown_proposal_fails() {
        let env = Env::default();
        let (a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        client.cancel(&a, &999u64);
    }

    #[test]
    #[should_panic(expected = "NotPending")]
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
        // Cancelling twice must panic
        client.cancel(&a, &id);
    }

    #[test]
    #[should_panic(expected = "NotASigner")]
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
        client.cancel(&outsider, &id);
    }

    #[test]
    #[should_panic(expected = "UnknownProposal")]
    fn get_unknown_proposal_fails() {
        let env = Env::default();
        let (_a, _b, _c, signers) = setup(&env);
        env.mock_all_auths();
        let contract_id = env.register(MultisigAdmin, ());
        let client = MultisigAdminClient::new(&env, &contract_id);
        client.init(&signers, &2u32);
        client.get_proposal(&42u64);
    }

    // ── revoke error paths ─────────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "NotPending")]
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
        // Revoking an approval on a cancelled proposal must panic
        client.revoke_approval(&a, &id);
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
        match client.get_proposal(&id).status {
            ProposalStatus::Executed => {}
            _ => panic!("expected executed with threshold+1 approvals"),
        }
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
        assert!(
            dup.is_err(),
            "duplicate approval by same signer must be rejected"
        );
        assert_eq!(
            client.get_proposal(&id).approval_count,
            1,
            "duplicate approval must not increment the count"
        );

        // Confirm the proposal is genuinely still under threshold: execute fails.
        let exec = client.try_execute(&a, &id);
        assert!(
            exec.is_err(),
            "one distinct signer must not satisfy a threshold of 2"
        );
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
