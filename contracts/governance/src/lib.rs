#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, Symbol};

// ── Storage keys ─────────────────────────────────────────────────────────────
pub mod access_control;
pub mod validation;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    ContractVersion,
    Admin,
    StakeOracle,
    /// Total staked across all voters
    TotalStaked,
    /// Minimum stake required to propose
    MinProposerStake,
    /// Quorum required for proposal to pass (basis points, e.g., 5000 = 50%)
    QuorumThreshold,
    /// Majority required for proposal to pass (basis points, e.g., 5000 = 50%)
    MajorityThreshold,
    /// Voting period in seconds
    VotingPeriod,
    /// Proposal count
    ProposalCount,
    /// Proposal by ID
    Proposal(u64),
    /// Voter stake snapshot at proposal creation
    VoterStakeSnapshot(Address, u64),
    /// Whether a voter has voted on a proposal
    HasVoted(Address, u64),
    /// Voter's current stake
    VoterStake(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalStatus {
    Active,
    Passed,
    Failed,
    Executed,
    Cancelled,
}

#[contracttype]
#[derive(Clone)]
pub struct Proposal {
    id: u64,
    proposer: Address,
    description: Symbol,
    created_at: u64,
    voting_ends_at: u64,
    total_voted_for: i128,
    total_voted_against: i128,
    status: ProposalStatus,
    snapshot_total_staked: i128,
}

fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<_, Address>(&DataKey::Admin)
        .expect("admin not set")
}

fn get_stake_oracle(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<_, Address>(&DataKey::StakeOracle)
        .expect("stake oracle not set")
}

fn get_total_staked(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get::<_, i128>(&DataKey::TotalStaked)
        .unwrap_or(0)
}

fn get_min_proposer_stake(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get::<_, i128>(&DataKey::MinProposerStake)
        .expect("min proposer stake not set")
}

fn get_quorum_threshold(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get::<_, i128>(&DataKey::QuorumThreshold)
        .expect("quorum threshold not set")
}

fn get_majority_threshold(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get::<_, i128>(&DataKey::MajorityThreshold)
        .expect("majority threshold not set")
}

fn get_voting_period(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get::<_, u64>(&DataKey::VotingPeriod)
        .expect("voting period not set")
}

fn get_proposal_count(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get::<_, u64>(&DataKey::ProposalCount)
        .unwrap_or(0)
}

fn set_proposal_count(env: &Env, count: u64) {
    env.storage()
        .instance()
        .set(&DataKey::ProposalCount, &count);
}

// ── Errors ───────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    InvalidAmount = 3,
    InsufficientStake = 4,
    ProposalNotFound = 5,
    ProposalNotActive = 6,
    VotingEnded = 7,
    AlreadyVoted = 8,
    QuorumNotMet = 9,
    MajorityNotMet = 10,
    ProposalAlreadyExecuted = 11,
    ProposalAlreadyCancelled = 12,
    CannotCancelEndedProposal = 13,
    NotProposerOrAdmin = 14,
    NegativeValue = 15,
    InvalidThreshold = 16,
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct Governance;

#[contractimpl]
impl Governance {
    /// Initialize the governance contract.
    pub fn init(
        env: Env,
        admin: Address,
        stake_oracle: Address,
        min_proposer_stake: i128,
        quorum_threshold: i128,
        majority_threshold: i128,
        voting_period: u64,
    ) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }
        admin.require_auth();

        validation::validate_amount(min_proposer_stake)?;
        validation::validate_threshold(quorum_threshold)?;
        validation::validate_threshold(majority_threshold)?;

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::StakeOracle, &stake_oracle);
        env.storage().instance().set(&DataKey::TotalStaked, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::MinProposerStake, &min_proposer_stake);
        env.storage()
            .instance()
            .set(&DataKey::QuorumThreshold, &quorum_threshold);
        env.storage()
            .instance()
            .set(&DataKey::MajorityThreshold, &majority_threshold);
        env.storage()
            .instance()
            .set(&DataKey::VotingPeriod, &voting_period);
        env.storage().instance().set(&DataKey::ProposalCount, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::ContractVersion, &1u32);

        env.events().publish(
            (Symbol::new(&env, "governance"), Symbol::new(&env, "init")),
            (
                admin,
                stake_oracle,
                min_proposer_stake,
                quorum_threshold,
                majority_threshold,
            ),
        );

        Ok(())
    }

    /// Set the total staked amount (stake oracle or admin only).
    pub fn set_total_staked(env: Env, caller: Address, amount: i128) -> Result<(), ContractError> {
        let stake_oracle = get_stake_oracle(&env);
        let admin = get_admin(&env);

        if caller != stake_oracle && caller != admin {
            return Err(ContractError::NotAuthorized);
        }

        validation::validate_amount(amount)?;

        env.storage().instance().set(&DataKey::TotalStaked, &amount);

        env.events().publish(
            (
                Symbol::new(&env, "governance"),
                Symbol::new(&env, "set_total_staked"),
            ),
            (caller, amount),
        );

        Ok(())
    }

    /// Set a voter's stake (stake oracle or admin only).
    pub fn set_voter_stake(
        env: Env,
        caller: Address,
        voter: Address,
        amount: i128,
    ) -> Result<(), ContractError> {
        let stake_oracle = get_stake_oracle(&env);
        let admin = get_admin(&env);

        if caller != stake_oracle && caller != admin {
            return Err(ContractError::NotAuthorized);
        }

        validation::validate_amount(amount)?;

        env.storage()
            .persistent()
            .set(&DataKey::VoterStake(voter.clone()), &amount);

        env.events().publish(
            (
                Symbol::new(&env, "governance"),
                Symbol::new(&env, "set_voter_stake"),
            ),
            (caller, voter, amount),
        );

        Ok(())
    }

    /// Set the minimum proposer stake (admin only).
    pub fn set_min_proposer_stake(
        env: Env,
        admin: Address,
        amount: i128,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(
            &env,
            &current_admin,
            &admin,
            "set_min_proposer_stake",
        )?;

        validation::validate_amount(amount)?;

        env.storage()
            .instance()
            .set(&DataKey::MinProposerStake, &amount);

        env.events().publish(
            (
                Symbol::new(&env, "governance"),
                Symbol::new(&env, "set_min_proposer_stake"),
            ),
            (admin, amount),
        );

        Ok(())
    }

    /// Create a new proposal.
    pub fn create_proposal(
        env: Env,
        proposer: Address,
        description: Symbol,
    ) -> Result<u64, ContractError> {
        proposer.require_auth();

        let stake = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::VoterStake(proposer.clone()))
            .unwrap_or(0);

        let min_stake = get_min_proposer_stake(&env);
        if stake < min_stake {
            return Err(ContractError::InsufficientStake);
        }

        let proposal_id = get_proposal_count(&env);
        let new_id = proposal_id + 1;
        set_proposal_count(&env, new_id);

        let now = env.ledger().timestamp();
        let voting_period = get_voting_period(&env);
        let voting_ends_at = now + voting_period;

        let total_staked = get_total_staked(&env);

        let proposal = Proposal {
            id: proposal_id,
            proposer: proposer.clone(),
            description: description.clone(),
            created_at: now,
            voting_ends_at,
            total_voted_for: 0,
            total_voted_against: 0,
            status: ProposalStatus::Active,
            snapshot_total_staked: total_staked,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        env.events().publish(
            (
                Symbol::new(&env, "governance"),
                Symbol::new(&env, "create_proposal"),
            ),
            (proposer, proposal_id, description),
        );

        Ok(proposal_id)
    }

    /// Vote on a proposal.
    pub fn vote(
        env: Env,
        voter: Address,
        proposal_id: u64,
        vote_for: bool,
    ) -> Result<(), ContractError> {
        voter.require_auth();

        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(ContractError::ProposalNotFound)?;

        if proposal.status != ProposalStatus::Active {
            return Err(ContractError::ProposalNotActive);
        }

        let now = env.ledger().timestamp();
        if now >= proposal.voting_ends_at {
            return Err(ContractError::VotingEnded);
        }

        let has_voted_key = DataKey::HasVoted(voter.clone(), proposal_id);
        if env.storage().persistent().has(&has_voted_key) {
            return Err(ContractError::AlreadyVoted);
        }

        // Get voter's stake at proposal creation time (snapshot)
        let stake = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::VoterStakeSnapshot(voter.clone(), proposal_id))
            .unwrap_or_else(|| {
                env.storage()
                    .persistent()
                    .get::<_, i128>(&DataKey::VoterStake(voter.clone()))
                    .unwrap_or(0)
            });

        if stake == 0 {
            return Err(ContractError::InsufficientStake);
        }

        // Mark as voted
        env.storage().persistent().set(&has_voted_key, &true);

        // Add vote weight
        if vote_for {
            proposal.total_voted_for += stake;
        } else {
            proposal.total_voted_against += stake;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        env.events().publish(
            (Symbol::new(&env, "governance"), Symbol::new(&env, "vote")),
            (voter, proposal_id, vote_for, stake),
        );

        Ok(())
    }

    /// Finalize a proposal (compute pass/fail).
    pub fn finalize_proposal(
        env: Env,
        caller: Address,
        proposal_id: u64,
    ) -> Result<(), ContractError> {
        caller.require_auth();

        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(ContractError::ProposalNotFound)?;

        if proposal.status != ProposalStatus::Active {
            return Err(ContractError::ProposalNotActive);
        }

        let now = env.ledger().timestamp();
        if now < proposal.voting_ends_at {
            return Err(ContractError::VotingEnded);
        }

        let total_votes = proposal.total_voted_for + proposal.total_voted_against;
        let quorum_threshold = get_quorum_threshold(&env);
        let majority_threshold = get_majority_threshold(&env);

        // Check quorum
        let quorum_met = total_votes * 10000 >= proposal.snapshot_total_staked * quorum_threshold;
        if !quorum_met {
            proposal.status = ProposalStatus::Failed;
            env.storage()
                .persistent()
                .set(&DataKey::Proposal(proposal_id), &proposal);

            env.events().publish(
                (
                    Symbol::new(&env, "governance"),
                    Symbol::new(&env, "finalize_proposal"),
                ),
                (proposal_id, ProposalStatus::Failed),
            );

            return Err(ContractError::QuorumNotMet);
        }

        // Check majority
        let majority_met = proposal.total_voted_for * 10000
            >= (proposal.total_voted_for + proposal.total_voted_against) * majority_threshold;

        if majority_met {
            proposal.status = ProposalStatus::Passed;
        } else {
            proposal.status = ProposalStatus::Failed;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        env.events().publish(
            (
                Symbol::new(&env, "governance"),
                Symbol::new(&env, "finalize_proposal"),
            ),
            (proposal_id, proposal.status.clone()),
        );

        Ok(())
    }

    /// Execute a passed proposal.
    pub fn execute_proposal(
        env: Env,
        caller: Address,
        proposal_id: u64,
    ) -> Result<(), ContractError> {
        caller.require_auth();

        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(ContractError::ProposalNotFound)?;

        if proposal.status != ProposalStatus::Passed {
            return Err(ContractError::ProposalNotActive);
        }

        proposal.status = ProposalStatus::Executed;
        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        env.events().publish(
            (
                Symbol::new(&env, "governance"),
                Symbol::new(&env, "execute_proposal"),
            ),
            (caller, proposal_id),
        );

        Ok(())
    }

    /// Cancel a proposal (proposer or admin before voting ends).
    pub fn cancel_proposal(
        env: Env,
        caller: Address,
        proposal_id: u64,
    ) -> Result<(), ContractError> {
        caller.require_auth();

        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(ContractError::ProposalNotFound)?;

        if proposal.status != ProposalStatus::Active {
            return Err(ContractError::ProposalNotActive);
        }

        let now = env.ledger().timestamp();
        if now >= proposal.voting_ends_at {
            return Err(ContractError::CannotCancelEndedProposal);
        }

        let admin = get_admin(&env);
        if caller != proposal.proposer && caller != admin {
            return Err(ContractError::NotProposerOrAdmin);
        }

        proposal.status = ProposalStatus::Cancelled;
        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        env.events().publish(
            (
                Symbol::new(&env, "governance"),
                Symbol::new(&env, "cancel_proposal"),
            ),
            (caller, proposal_id),
        );

        Ok(())
    }

    /// Get a proposal by ID.
    pub fn get_proposal(env: Env, proposal_id: u64) -> Option<Proposal> {
        env.storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
    }

    /// Get the total number of proposals.
    pub fn proposal_count(env: Env) -> u64 {
        get_proposal_count(&env)
    }

    /// Get a voter's current stake.
    pub fn voter_stake(env: Env, voter: Address) -> i128 {
        env.storage()
            .persistent()
            .get::<_, i128>(&DataKey::VoterStake(voter))
            .unwrap_or(0)
    }

    /// Get the total staked amount.
    pub fn total_staked(env: Env) -> i128 {
        get_total_staked(&env)
    }

    /// Check if a voter has voted on a proposal.
    pub fn has_voted(env: Env, voter: Address, proposal_id: u64) -> bool {
        env.storage()
            .persistent()
            .get::<_, bool>(&DataKey::HasVoted(voter, proposal_id))
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod test {
    extern crate std;

    use super::{ContractError, Governance, GovernanceClient, ProposalStatus};
    use soroban_sdk::testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke};
    use soroban_sdk::{Address, Env, IntoVal, Symbol};

    fn setup(env: &Env) -> (Address, GovernanceClient<'_>, Address, Address) {
        env.mock_all_auths();
        let contract_id = env.register(Governance, ());
        let client = GovernanceClient::new(env, &contract_id);

        let admin = Address::generate(env);
        let stake_oracle = Address::generate(env);
        let voter = Address::generate(env);

        client
            .try_init(
                &admin,
                &stake_oracle,
                &100i128,
                &5000i128,
                &5000i128,
                &86400u64,
            )
            .unwrap()
            .unwrap();

        (admin, client, stake_oracle, voter)
    }

    fn contract_id<'a>(client: &'a GovernanceClient<'a>) -> &'a Address {
        &client.address
    }

    #[test]
    #[should_panic]
    fn init_requires_admin_auth() {
        let env = Env::default();
        let id = env.register(Governance, ());
        let client = GovernanceClient::new(&env, &id);
        let admin = Address::generate(&env);
        let stake_oracle = Address::generate(&env);

        client.init(
            &admin,
            &stake_oracle,
            &100i128,
            &5000i128,
            &5000i128,
            &86400u64,
        );
    }

    #[test]
    fn init_sets_config() {
        let env = Env::default();
        let (admin, client, stake_oracle, _voter) = setup(&env);

        assert_eq!(client.total_staked(), 0i128);
    }

    #[test]
    fn init_cannot_be_called_twice() {
        let env = Env::default();
        let (admin, client, stake_oracle, _voter) = setup(&env);

        let err = client
            .try_init(
                &admin,
                &stake_oracle,
                &100i128,
                &5000i128,
                &5000i128,
                &86400u64,
            )
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::AlreadyInitialized);
    }

    #[test]
    fn set_total_staked_by_oracle() {
        let env = Env::default();
        let (_admin, client, stake_oracle, _voter) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &stake_oracle,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "set_total_staked",
                args: (stake_oracle.clone(), 1000i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_set_total_staked(&stake_oracle, &1000i128)
            .unwrap()
            .unwrap();
        assert_eq!(client.total_staked(), 1000i128);
    }

    #[test]
    fn set_voter_stake_by_oracle() {
        let env = Env::default();
        let (_admin, client, stake_oracle, voter) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &stake_oracle,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "set_voter_stake",
                args: (stake_oracle.clone(), voter.clone(), 200i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_set_voter_stake(&stake_oracle, &voter, &200i128)
            .unwrap()
            .unwrap();
        assert_eq!(client.voter_stake(&voter), 200i128);
    }

    #[test]
    fn create_proposal_requires_min_stake() {
        let env = Env::default();
        let (_admin, client, stake_oracle, voter) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &stake_oracle,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "set_voter_stake",
                args: (stake_oracle.clone(), voter.clone(), 50i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_set_voter_stake(&stake_oracle, &voter, &50i128)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &voter,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "create_proposal",
                args: (voter.clone(), Symbol::new(&env, "test")).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_create_proposal(&voter, &Symbol::new(&env, "test"))
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InsufficientStake);
    }

    #[test]
    fn create_proposal_succeeds_with_sufficient_stake() {
        let env = Env::default();
        let (_admin, client, stake_oracle, voter) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &stake_oracle,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "set_voter_stake",
                args: (stake_oracle.clone(), voter.clone(), 150i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_set_voter_stake(&stake_oracle, &voter, &150i128)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &voter,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "create_proposal",
                args: (voter.clone(), Symbol::new(&env, "test")).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let id = client
            .try_create_proposal(&voter, &Symbol::new(&env, "test"))
            .unwrap()
            .unwrap();
        assert_eq!(id, 0u64);
    }

    #[test]
    fn vote_counts_stake_once() {
        let env = Env::default();
        let (_admin, client, stake_oracle, voter) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &stake_oracle,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "set_voter_stake",
                args: (stake_oracle.clone(), voter.clone(), 150i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_set_voter_stake(&stake_oracle, &voter, &150i128)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &voter,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "create_proposal",
                args: (voter.clone(), Symbol::new(&env, "test")).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let proposal_id = client
            .try_create_proposal(&voter, &Symbol::new(&env, "test"))
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &voter,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "vote",
                args: (voter.clone(), proposal_id, true).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_vote(&voter, &proposal_id, &true)
            .unwrap()
            .unwrap();

        let proposal = client.get_proposal(&proposal_id).unwrap();
        assert_eq!(proposal.total_voted_for, 150i128);
    }

    #[test]
    fn vote_rejects_double_vote() {
        let env = Env::default();
        let (_admin, client, stake_oracle, voter) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &stake_oracle,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "set_voter_stake",
                args: (stake_oracle.clone(), voter.clone(), 150i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_set_voter_stake(&stake_oracle, &voter, &150i128)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &voter,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "create_proposal",
                args: (voter.clone(), Symbol::new(&env, "test")).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let proposal_id = client
            .try_create_proposal(&voter, &Symbol::new(&env, "test"))
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &voter,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "vote",
                args: (voter.clone(), proposal_id, true).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_vote(&voter, &proposal_id, &true)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &voter,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "vote",
                args: (voter.clone(), proposal_id, false).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_vote(&voter, &proposal_id, &false)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::AlreadyVoted);
    }

    #[test]
    fn finalize_proposal_checks_quorum() {
        let env = Env::default();
        let (_admin, client, stake_oracle, voter) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &stake_oracle,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "set_total_staked",
                args: (stake_oracle.clone(), 10000i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_set_total_staked(&stake_oracle, &10000i128)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &stake_oracle,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "set_voter_stake",
                args: (stake_oracle.clone(), voter.clone(), 150i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_set_voter_stake(&stake_oracle, &voter, &150i128)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &voter,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "create_proposal",
                args: (voter.clone(), Symbol::new(&env, "test")).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let proposal_id = client
            .try_create_proposal(&voter, &Symbol::new(&env, "test"))
            .unwrap()
            .unwrap();

        env.ledger().set_timestamp(86401);

        env.mock_auths(&[MockAuth {
            address: &voter,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "finalize_proposal",
                args: (voter.clone(), proposal_id).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_finalize_proposal(&voter, &proposal_id)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::QuorumNotMet);
    }

    #[test]
    fn execute_proposal_only_after_pass() {
        let env = Env::default();
        let (_admin, client, stake_oracle, voter) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &stake_oracle,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "set_voter_stake",
                args: (stake_oracle.clone(), voter.clone(), 150i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_set_voter_stake(&stake_oracle, &voter, &150i128)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &voter,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "create_proposal",
                args: (voter.clone(), Symbol::new(&env, "test")).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let proposal_id = client
            .try_create_proposal(&voter, &Symbol::new(&env, "test"))
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &voter,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "execute_proposal",
                args: (voter.clone(), proposal_id).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_execute_proposal(&voter, &proposal_id)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::ProposalNotActive);
    }

    #[test]
    fn cancel_proposal_by_proposer() {
        let env = Env::default();
        let (_admin, client, stake_oracle, voter) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &stake_oracle,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "set_voter_stake",
                args: (stake_oracle.clone(), voter.clone(), 150i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_set_voter_stake(&stake_oracle, &voter, &150i128)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &voter,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "create_proposal",
                args: (voter.clone(), Symbol::new(&env, "test")).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let proposal_id = client
            .try_create_proposal(&voter, &Symbol::new(&env, "test"))
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &voter,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "cancel_proposal",
                args: (voter.clone(), proposal_id).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_cancel_proposal(&voter, &proposal_id)
            .unwrap()
            .unwrap();

        let proposal = client.get_proposal(&proposal_id).unwrap();
        assert_eq!(proposal.status, ProposalStatus::Cancelled);
    }

    #[test]
    fn non_admin_cannot_set_min_proposer_stake() {
        let env = Env::default();
        let (_admin, client, _stake_oracle, voter) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &voter,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "set_min_proposer_stake",
                args: (voter.clone(), 200i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_set_min_proposer_stake(&voter, &200i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }
}
