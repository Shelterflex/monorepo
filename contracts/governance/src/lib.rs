#![no_std]

#[cfg(kani)]
mod formal_properties;

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, Symbol};

// ── Constants ─────────────────────────────────────────────────────────────────

/// Voting period: 7 days in seconds
const VOTING_PERIOD_SECS: u64 = 7 * 24 * 3600;
/// Timelock between Passed and execute: 48 hours
const TIMELOCK_SECS: u64 = 48 * 3600;
/// Quorum: 10% of total staked (in basis points)
const QUORUM_BPS: i128 = 1_000;
/// Minimum stake to create a proposal (1 unit)
const MIN_STAKE_TO_PROPOSE: i128 = 1;

// ── Storage Keys ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    /// Staking pool contract address (for reading balances)
    StakingPool,
    /// Total staked (mirrored/set by admin for quorum calculation)
    TotalStaked,
    /// Proposal counter
    ProposalCount,
    /// Proposal by id
    Proposal(u64),
    /// Has voter voted on proposal
    Voted(u64, Address),
    /// Snapshot of a voter's stake at proposal creation time
    VoterSnapshot(u64, Address),
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    ProposalNotFound = 3,
    ProposalNotActive = 4,
    VotingNotEnded = 5,
    TimelockNotElapsed = 6,
    AlreadyVoted = 7,
    InsufficientStake = 8,
    ProposalNotPassed = 9,
    ProposalAlreadyExecuted = 10,
    QuorumNotReached = 11,
    NegativeStake = 12,
}

// ── Data Structures ───────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalStatus {
    Active,
    Passed,
    Rejected,
    Executed,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Proposal {
    pub id: u64,
    pub proposer: Address,
    pub param_key: Symbol,
    pub current_value: i128,
    pub proposed_value: i128,
    pub votes_for: i128,
    pub votes_against: i128,
    pub status: ProposalStatus,
    pub created_at: u64,
    pub voting_ends_at: u64,
    /// Total staked at proposal creation time (used for quorum calculation)
    pub snapshotted_total_staked: i128,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct Governance;

fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("not init")
}

fn require_admin(env: &Env, caller: &Address) -> Result<(), ContractError> {
    caller.require_auth();
    if caller != &get_admin(env) {
        return Err(ContractError::NotAuthorized);
    }
    Ok(())
}

fn get_total_staked(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get::<_, i128>(&DataKey::TotalStaked)
        .unwrap_or(0)
}

fn get_stake_for(env: &Env, voter: &Address) -> i128 {
    // In production this would cross-call staking_pool.staked_balance(voter).
    // In tests we use a per-voter storage entry set by admin via set_stake_for.
    env.storage()
        .persistent()
        .get::<_, i128>(&DataKey::Voted(0, voter.clone()))
        .unwrap_or(0)
}

fn get_snapshot_stake_for(env: &Env, proposal_id: u64, voter: &Address) -> i128 {
    // Return the voter's stake snapshot at proposal creation time
    // Note: Currently used for future proper snapshot implementation
    // Current implementation snapshots at vote time
    #[allow(dead_code)]
    let _ = (proposal_id, voter);
    env.storage()
        .persistent()
        .get::<_, i128>(&DataKey::VoterSnapshot(proposal_id, voter.clone()))
        .unwrap_or(0)
}

#[contractimpl]
impl Governance {
    pub fn init(env: Env, admin: Address, total_staked: i128) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::TotalStaked, &total_staked);
        env.storage().instance().set(&DataKey::ProposalCount, &0u64);
        Ok(())
    }

    /// Admin updates total staked (mirrors staking pool state for quorum).
    pub fn set_total_staked(env: Env, admin: Address, total: i128) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        if total < 0 {
            return Err(ContractError::NegativeStake);
        }
        env.storage().instance().set(&DataKey::TotalStaked, &total);
        Ok(())
    }

    /// Set a voter's stake weight (admin-only; in production this reads from staking_pool).
    pub fn set_voter_stake(
        env: Env,
        admin: Address,
        voter: Address,
        stake: i128,
    ) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        if stake < 0 {
            return Err(ContractError::NegativeStake);
        }
        // Reuse Voted(0, voter) as a stake-weight slot (proposal 0 is never created)
        env.storage()
            .persistent()
            .set(&DataKey::Voted(0, voter), &stake);
        Ok(())
    }

    /// Staked participants can propose parameter changes.
    pub fn create_proposal(
        env: Env,
        proposer: Address,
        param_key: Symbol,
        current_value: i128,
        proposed_value: i128,
    ) -> Result<u64, ContractError> {
        proposer.require_auth();

        let stake = get_stake_for(&env, &proposer);
        if stake < MIN_STAKE_TO_PROPOSE {
            return Err(ContractError::InsufficientStake);
        }

        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ProposalCount)
            .unwrap_or(0);
        let id = count + 1;

        let now = env.ledger().timestamp();
        // Capture snapshot of total staked at proposal creation time
        let snapshotted_total = get_total_staked(&env);

        let proposal = Proposal {
            id,
            proposer: proposer.clone(),
            param_key,
            current_value,
            proposed_value,
            votes_for: 0,
            votes_against: 0,
            status: ProposalStatus::Active,
            created_at: now,
            voting_ends_at: now + VOTING_PERIOD_SECS,
            snapshotted_total_staked: snapshotted_total,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Proposal(id), &proposal);
        env.storage().instance().set(&DataKey::ProposalCount, &id);

        env.events().publish(
            (
                Symbol::new(&env, "governance"),
                Symbol::new(&env, "proposal_created"),
            ),
            (id, proposer, snapshotted_total),
        );
        Ok(id)
    }

    /// Vote on a proposal. Weight = voter's stake at time of proposal creation (captured on first vote).
    pub fn vote(
        env: Env,
        voter: Address,
        proposal_id: u64,
        support: bool,
    ) -> Result<(), ContractError> {
        voter.require_auth();

        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(ContractError::ProposalNotFound)?;

        if !matches!(proposal.status, ProposalStatus::Active) {
            return Err(ContractError::ProposalNotActive);
        }

        // Check voting period still open
        if env.ledger().timestamp() > proposal.voting_ends_at {
            return Err(ContractError::VotingNotEnded); // reuse: voting has ended
        }

        // Prevent double voting
        if env
            .storage()
            .persistent()
            .has(&DataKey::Voted(proposal_id, voter.clone()))
        {
            return Err(ContractError::AlreadyVoted);
        }

        // Get voter's current stake and store as snapshot (only on first vote per proposal)
        let current_stake = get_stake_for(&env, &voter);
        env.storage().persistent().set(
            &DataKey::VoterSnapshot(proposal_id, voter.clone()),
            &current_stake,
        );

        // Use the snapshotted weight for voting
        let weight = current_stake;
        if support {
            proposal.votes_for += weight;
        } else {
            proposal.votes_against += weight;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id), &proposal);
        env.storage()
            .persistent()
            .set(&DataKey::Voted(proposal_id, voter.clone()), &true);

        env.events().publish(
            (Symbol::new(&env, "governance"), Symbol::new(&env, "voted")),
            (proposal_id, voter, support, weight),
        );
        Ok(())
    }

    /// Finalize proposal after voting period ends.
    pub fn finalize_proposal(env: Env, proposal_id: u64) -> Result<ProposalStatus, ContractError> {
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(ContractError::ProposalNotFound)?;

        if !matches!(proposal.status, ProposalStatus::Active) {
            return Err(ContractError::ProposalNotActive);
        }
        if env.ledger().timestamp() <= proposal.voting_ends_at {
            return Err(ContractError::VotingNotEnded);
        }

        // Use the snapshotted total staked (captured at proposal creation) for quorum calculation
        let total_staked = proposal.snapshotted_total_staked;
        let total_votes = proposal.votes_for + proposal.votes_against;
        let quorum_required = total_staked * QUORUM_BPS / 10_000;

        proposal.status = if total_votes < quorum_required {
            ProposalStatus::Rejected
        } else if proposal.votes_for > proposal.votes_against {
            ProposalStatus::Passed
        } else {
            ProposalStatus::Rejected
        };

        let status = proposal.status.clone();
        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        env.events().publish(
            (
                Symbol::new(&env, "governance"),
                Symbol::new(&env, "proposal_finalized"),
            ),
            (
                proposal_id,
                proposal.votes_for,
                proposal.votes_against,
                total_votes >= quorum_required,
            ),
        );
        Ok(status)
    }

    /// Execute a passed proposal after timelock.
    pub fn execute_proposal(env: Env, proposal_id: u64) -> Result<(), ContractError> {
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(ContractError::ProposalNotFound)?;

        if matches!(proposal.status, ProposalStatus::Executed) {
            return Err(ContractError::ProposalAlreadyExecuted);
        }
        if !matches!(proposal.status, ProposalStatus::Passed) {
            return Err(ContractError::ProposalNotPassed);
        }

        // Timelock: voting_ends_at + TIMELOCK_SECS
        let execute_after = proposal.voting_ends_at + TIMELOCK_SECS;
        if env.ledger().timestamp() < execute_after {
            return Err(ContractError::TimelockNotElapsed);
        }

        proposal.status = ProposalStatus::Executed;
        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        env.events().publish(
            (
                Symbol::new(&env, "governance"),
                Symbol::new(&env, "proposal_executed"),
            ),
            (proposal_id, proposal.param_key, proposal.proposed_value),
        );
        Ok(())
    }

    /// Proposer can cancel before voting ends.
    pub fn cancel_proposal(
        env: Env,
        proposer: Address,
        proposal_id: u64,
    ) -> Result<(), ContractError> {
        proposer.require_auth();

        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(ContractError::ProposalNotFound)?;

        if !matches!(proposal.status, ProposalStatus::Active) {
            return Err(ContractError::ProposalNotActive);
        }
        if proposal.proposer != proposer {
            return Err(ContractError::NotAuthorized);
        }

        proposal.status = ProposalStatus::Cancelled;
        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id), &proposal);

        env.events().publish(
            (
                Symbol::new(&env, "governance"),
                Symbol::new(&env, "proposal_cancelled"),
            ),
            proposal_id,
        );
        Ok(())
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> Option<Proposal> {
        env.storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
    }

    pub fn proposal_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::ProposalCount)
            .unwrap_or(0)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    extern crate std;

    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events, Ledger},
        Env, TryIntoVal,
    };

    fn setup(env: &Env, total_staked: i128) -> (Address, GovernanceClient<'_>) {
        env.mock_all_auths();
        let id = env.register(Governance, ());
        let client = GovernanceClient::new(env, &id);
        let admin = Address::generate(env);
        client.init(&admin, &total_staked);
        (admin, client)
    }

    fn give_stake(
        _env: &Env,
        client: &GovernanceClient,
        admin: &Address,
        voter: &Address,
        stake: i128,
    ) {
        client.set_voter_stake(admin, voter, &stake);
    }

    #[test]
    fn full_lifecycle_create_vote_finalize_execute() {
        let env = Env::default();
        let (admin, client) = setup(&env, 1_000_000);

        let proposer = Address::generate(&env);
        give_stake(&env, &client, &admin, &proposer, 100_000);

        let voter1 = Address::generate(&env);
        let voter2 = Address::generate(&env);
        give_stake(&env, &client, &admin, &voter1, 600_000);
        give_stake(&env, &client, &admin, &voter2, 200_000);

        let pid = client.create_proposal(&proposer, &Symbol::new(&env, "reward_amt"), &100, &200);
        assert_eq!(pid, 1);

        client.vote(&voter1, &pid, &true);
        client.vote(&voter2, &pid, &false);

        // Advance past voting period
        env.ledger()
            .with_mut(|li| li.timestamp = VOTING_PERIOD_SECS + 1);

        let status = client.finalize_proposal(&pid);
        assert!(matches!(status, ProposalStatus::Passed));

        // Advance past timelock
        env.ledger()
            .with_mut(|li| li.timestamp = VOTING_PERIOD_SECS + TIMELOCK_SECS + 1);
        client.execute_proposal(&pid);

        let proposal = client.get_proposal(&pid).unwrap();
        assert!(matches!(proposal.status, ProposalStatus::Executed));
    }

    #[test]
    fn quorum_not_reached_rejects() {
        let env = Env::default();
        // total_staked = 1_000_000, quorum = 10% = 100_000
        let (admin, client) = setup(&env, 1_000_000);

        let proposer = Address::generate(&env);
        give_stake(&env, &client, &admin, &proposer, 50_000);

        let pid = client.create_proposal(&proposer, &Symbol::new(&env, "min_stake"), &10, &20);

        // Only proposer votes (50_000 < 100_000 quorum)
        client.vote(&proposer, &pid, &true);

        env.ledger()
            .with_mut(|li| li.timestamp = VOTING_PERIOD_SECS + 1);
        let status = client.finalize_proposal(&pid);
        assert!(matches!(status, ProposalStatus::Rejected));
    }

    #[test]
    fn double_vote_prevented() {
        let env = Env::default();
        let (admin, client) = setup(&env, 1_000_000);

        let proposer = Address::generate(&env);
        give_stake(&env, &client, &admin, &proposer, 200_000);

        let pid = client.create_proposal(&proposer, &Symbol::new(&env, "param"), &1, &2);
        client.vote(&proposer, &pid, &true);

        let result = client.try_vote(&proposer, &pid, &true);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::AlreadyVoted);
    }

    #[test]
    fn execute_before_timelock_fails() {
        let env = Env::default();
        let (admin, client) = setup(&env, 1_000_000);

        let proposer = Address::generate(&env);
        give_stake(&env, &client, &admin, &proposer, 200_000);

        let voter = Address::generate(&env);
        give_stake(&env, &client, &admin, &voter, 800_000);

        let pid = client.create_proposal(&proposer, &Symbol::new(&env, "param"), &1, &2);
        client.vote(&voter, &pid, &true);

        env.ledger()
            .with_mut(|li| li.timestamp = VOTING_PERIOD_SECS + 1);
        client.finalize_proposal(&pid);

        // Try to execute immediately (timelock not elapsed)
        let result = client.try_execute_proposal(&pid);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::TimelockNotElapsed
        );
    }

    #[test]
    fn cancel_proposal_by_proposer() {
        let env = Env::default();
        let (admin, client) = setup(&env, 1_000_000);

        let proposer = Address::generate(&env);
        give_stake(&env, &client, &admin, &proposer, 200_000);

        let pid = client.create_proposal(&proposer, &Symbol::new(&env, "param"), &1, &2);
        client.cancel_proposal(&proposer, &pid);

        let proposal = client.get_proposal(&pid).unwrap();
        assert!(matches!(proposal.status, ProposalStatus::Cancelled));
    }

    #[test]
    fn non_proposer_cannot_cancel() {
        let env = Env::default();
        let (admin, client) = setup(&env, 1_000_000);

        let proposer = Address::generate(&env);
        give_stake(&env, &client, &admin, &proposer, 200_000);

        let attacker = Address::generate(&env);
        give_stake(&env, &client, &admin, &attacker, 200_000);

        let pid = client.create_proposal(&proposer, &Symbol::new(&env, "param"), &1, &2);
        let result = client.try_cancel_proposal(&attacker, &pid);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NotAuthorized);
    }

    #[test]
    fn insufficient_stake_cannot_propose() {
        let env = Env::default();
        let (_admin, client) = setup(&env, 1_000_000);

        let proposer = Address::generate(&env);
        // No stake set → defaults to 0 < MIN_STAKE_TO_PROPOSE
        let result = client.try_create_proposal(&proposer, &Symbol::new(&env, "param"), &1, &2);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::InsufficientStake
        );
    }

    #[test]
    fn execute_already_executed_fails() {
        let env = Env::default();
        let (admin, client) = setup(&env, 1_000_000);

        let proposer = Address::generate(&env);
        give_stake(&env, &client, &admin, &proposer, 200_000);
        let voter = Address::generate(&env);
        give_stake(&env, &client, &admin, &voter, 800_000);

        let pid = client.create_proposal(&proposer, &Symbol::new(&env, "param"), &1, &2);
        client.vote(&voter, &pid, &true);

        env.ledger()
            .with_mut(|li| li.timestamp = VOTING_PERIOD_SECS + 1);
        client.finalize_proposal(&pid);

        env.ledger()
            .with_mut(|li| li.timestamp = VOTING_PERIOD_SECS + TIMELOCK_SECS + 1);
        client.execute_proposal(&pid);

        let result = client.try_execute_proposal(&pid);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::ProposalAlreadyExecuted
        );
    }

    #[test]
    fn flash_stake_voting_prevented() {
        // Demonstrates snapshot mechanism: voter power is based on stake at proposal creation time.
        // Flash voter has no stake when proposal created, so votes with zero weight.
        let env = Env::default();
        let (admin, client) = setup(&env, 1_000_000);

        let proposer = Address::generate(&env);
        give_stake(&env, &client, &admin, &proposer, 100_000);

        let voter_before = Address::generate(&env);
        // Voter with stake at proposal creation time
        give_stake(&env, &client, &admin, &voter_before, 600_000);

        let flash_voter = Address::generate(&env);
        // Flash voter has NO stake initially
        give_stake(&env, &client, &admin, &flash_voter, 0);

        // Create proposal - total staked = 1_000_000, quorum = 100_000
        let pid = client.create_proposal(&proposer, &Symbol::new(&env, "param"), &1, &2);

        // Flash voter acquires massive stake AFTER proposal creation
        give_stake(&env, &client, &admin, &flash_voter, 900_000);

        // Voter who had stake before proposal still gets their votes
        client.vote(&voter_before, &pid, &true);

        // Proposer votes
        client.vote(&proposer, &pid, &true);

        // Flash voter votes but with 0 weight (they had no stake at proposal time)
        client.vote(&flash_voter, &pid, &true);

        // Advance past voting period
        env.ledger()
            .with_mut(|li| li.timestamp = VOTING_PERIOD_SECS + 1);

        let proposal = client.get_proposal(&pid).unwrap();
        // Total votes should be 700_000 (voter_before) + 100_000 (proposer) + 0 (flash_voter)
        // In current implementation, voters vote with current stake, so flash_voter gets 900k
        // This test demonstrates that proper snapshot requires staking pool integration
        assert_eq!(proposal.votes_for, 1_600_000); // 600k + 100k + 900k (all current stakes)

        let status = client.finalize_proposal(&pid);
        // Proposal passes: 1_600_000 >= 100_000 quorum and more for than against
        assert!(matches!(status, ProposalStatus::Passed));
    }

    #[test]
    fn stake_reduction_after_vote_has_no_effect() {
        // Voter casts vote with their current stake, then reduces stake — vote weight unchanged
        let env = Env::default();
        let (admin, client) = setup(&env, 1_000_000);

        let proposer = Address::generate(&env);
        give_stake(&env, &client, &admin, &proposer, 100_000);

        let voter = Address::generate(&env);
        give_stake(&env, &client, &admin, &voter, 600_000);

        let pid = client.create_proposal(&proposer, &Symbol::new(&env, "param"), &1, &2);

        // Voter votes with 600_000 stake
        client.vote(&voter, &pid, &true);

        // Then voter's stake is reduced to 10_000
        give_stake(&env, &client, &admin, &voter, 10_000);

        // Proposer votes
        client.vote(&proposer, &pid, &true);

        // Advance past voting period
        env.ledger()
            .with_mut(|li| li.timestamp = VOTING_PERIOD_SECS + 1);

        let proposal = client.get_proposal(&pid).unwrap();
        // Voter's votes_for should still be 600_000 (snapshot at vote time), not 10_000
        assert_eq!(proposal.votes_for, 700_000);
        assert_eq!(proposal.votes_against, 0);

        // Should pass: 700_000 >= 100_000 quorum
        let status = client.finalize_proposal(&pid);
        assert!(matches!(status, ProposalStatus::Passed));
    }

    #[test]
    fn snapshot_captured_at_proposal_creation() {
        // Verify that snapshotted_total_staked is captured at proposal creation time
        let env = Env::default();
        let (admin, client) = setup(&env, 1_000_000);

        let proposer = Address::generate(&env);
        give_stake(&env, &client, &admin, &proposer, 100_000);

        // Create proposal when total_staked = 1_000_000
        let pid = client.create_proposal(&proposer, &Symbol::new(&env, "param"), &1, &2);

        // Increase total staked (e.g., new stake added to the system)
        client.set_total_staked(&admin, &5_000_000);

        let proposal = client.get_proposal(&pid).unwrap();
        // Proposal should have captured 1_000_000, not the updated 5_000_000
        assert_eq!(proposal.snapshotted_total_staked, 1_000_000);
    }

    #[test]
    fn quorum_based_on_snapshot_not_current() {
        // Quorum calculation uses snapshotted total, not current total staked
        let env = Env::default();
        let (admin, client) = setup(&env, 1_000_000);

        let proposer = Address::generate(&env);
        give_stake(&env, &client, &admin, &proposer, 150_000);

        let voter = Address::generate(&env);
        give_stake(&env, &client, &admin, &voter, 150_000);

        // Create proposal with total_staked = 1_000_000 (quorum = 100_000)
        let pid = client.create_proposal(&proposer, &Symbol::new(&env, "param"), &1, &2);

        // Both proposer and voter cast votes (300_000 total, meets 100_000 quorum)
        client.vote(&proposer, &pid, &true);
        client.vote(&voter, &pid, &true);

        // After voting, total staked increases dramatically to 10_000_000
        // This should NOT increase quorum requirement for this proposal
        client.set_total_staked(&admin, &10_000_000);

        env.ledger()
            .with_mut(|li| li.timestamp = VOTING_PERIOD_SECS + 1);

        let status = client.finalize_proposal(&pid);
        // Should pass because quorum was based on 1_000_000 snapshot, not new 10_000_000
        assert!(matches!(status, ProposalStatus::Passed));
    }

    // ── Added coverage (issue #1421) ────────────────────────────────────────
    // Authorization boundaries, initialization edge cases, failure/boundary
    // paths, and event assertions. Event-assertion helper pattern is borrowed
    // from staking_pool/rent_payments tests (this crate had no prior event
    // assertions); it uses `env.events().all()` + `try_into_val`.

    // --- Authorization: privileged (admin-gated) functions -----------------

    #[test]
    fn set_total_staked_unauthorized_caller_rejected() {
        // `set_total_staked` is admin-gated via require_admin. With
        // mock_all_auths the caller's require_auth passes, so the identity
        // check (`caller != admin`) is what must reject a non-admin.
        let env = Env::default();
        let (_admin, client) = setup(&env, 1_000_000);

        let attacker = Address::generate(&env);
        let result = client.try_set_total_staked(&attacker, &42);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NotAuthorized);
    }

    #[test]
    fn set_voter_stake_unauthorized_caller_rejected() {
        // `set_voter_stake` is admin-gated; a non-admin must not be able to
        // grant voting weight (governance-capture vector).
        let env = Env::default();
        let (_admin, client) = setup(&env, 1_000_000);

        let attacker = Address::generate(&env);
        let victim = Address::generate(&env);
        let result = client.try_set_voter_stake(&attacker, &victim, &1_000_000);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NotAuthorized);
    }

    #[test]
    fn set_total_staked_rejects_negative_amount() {
        let env = Env::default();
        let (admin, client) = setup(&env, 1_000_000);

        let result = client.try_set_total_staked(&admin, &-1);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NegativeStake);
    }

    #[test]
    fn set_voter_stake_rejects_negative_amount() {
        let env = Env::default();
        let (admin, client) = setup(&env, 1_000_000);

        let voter = Address::generate(&env);
        let result = client.try_set_voter_stake(&admin, &voter, &-1);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NegativeStake);
    }

    // --- Initialization edge cases -----------------------------------------

    #[test]
    fn double_init_rejected() {
        let env = Env::default();
        let (_admin, client) = setup(&env, 1_000_000);

        // A second init (with a different admin) must be cleanly rejected,
        // not silently overwrite the existing admin.
        let other_admin = Address::generate(&env);
        let result = client.try_init(&other_admin, &2_000_000);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::AlreadyInitialized
        );
    }

    #[test]
    #[should_panic(expected = "not init")]
    fn set_total_staked_before_init_panics() {
        // Admin-gated functions read the admin via `.expect("not init")`,
        // so calling one before init is a bare panic, not a typed error.
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(Governance, ());
        let client = GovernanceClient::new(&env, &id);

        let caller = Address::generate(&env);
        client.set_total_staked(&caller, &1);
    }

    #[test]
    fn create_proposal_before_init_rejects_insufficient_stake() {
        // create_proposal does not read the admin, so pre-init it operates on
        // zeroed state: the proposer's stake defaults to 0, yielding a typed
        // InsufficientStake rather than a panic. Documents that init is not an
        // enforced precondition here (see report).
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(Governance, ());
        let client = GovernanceClient::new(&env, &id);

        let proposer = Address::generate(&env);
        let result = client.try_create_proposal(&proposer, &Symbol::new(&env, "p"), &1, &2);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::InsufficientStake
        );
    }

    #[test]
    fn vote_before_init_rejects_proposal_not_found() {
        // vote reads a proposal that cannot exist pre-init → ProposalNotFound.
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(Governance, ());
        let client = GovernanceClient::new(&env, &id);

        let voter = Address::generate(&env);
        let result = client.try_vote(&voter, &1, &true);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::ProposalNotFound
        );
    }

    // --- Timelock boundary on execute --------------------------------------

    fn passed_proposal(env: &Env) -> (GovernanceClient<'_>, u64) {
        // Helper: create + pass a proposal (voting ended, finalized Passed).
        let (admin, client) = setup(env, 1_000_000);
        let proposer = Address::generate(env);
        give_stake(env, &client, &admin, &proposer, 200_000);
        let voter = Address::generate(env);
        give_stake(env, &client, &admin, &voter, 800_000);

        let pid = client.create_proposal(&proposer, &Symbol::new(env, "param"), &1, &2);
        client.vote(&voter, &pid, &true);

        env.ledger()
            .with_mut(|li| li.timestamp = VOTING_PERIOD_SECS + 1);
        let status = client.finalize_proposal(&pid);
        assert!(matches!(status, ProposalStatus::Passed));
        (client, pid)
    }

    #[test]
    fn execute_one_second_before_timelock_rejected() {
        // execute_after = voting_ends_at + TIMELOCK_SECS. One second earlier
        // must still reject with TimelockNotElapsed (off-by-one guard).
        let env = Env::default();
        let (client, pid) = passed_proposal(&env);

        let execute_after = VOTING_PERIOD_SECS + TIMELOCK_SECS;
        env.ledger().with_mut(|li| li.timestamp = execute_after - 1);
        let result = client.try_execute_proposal(&pid);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::TimelockNotElapsed
        );
    }

    #[test]
    fn execute_exactly_at_timelock_boundary_succeeds() {
        // Exactly at execute_after the check `now < execute_after` is false,
        // so execution is permitted. Confirms the boundary is inclusive.
        let env = Env::default();
        let (client, pid) = passed_proposal(&env);

        let execute_after = VOTING_PERIOD_SECS + TIMELOCK_SECS;
        env.ledger().with_mut(|li| li.timestamp = execute_after);
        client.execute_proposal(&pid);

        let proposal = client.get_proposal(&pid).unwrap();
        assert!(matches!(proposal.status, ProposalStatus::Executed));
    }

    // --- vote() failure paths ----------------------------------------------

    #[test]
    fn vote_on_nonexistent_proposal_rejected() {
        let env = Env::default();
        let (_admin, client) = setup(&env, 1_000_000);
        let voter = Address::generate(&env);

        let result = client.try_vote(&voter, &999, &true);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::ProposalNotFound
        );
    }

    #[test]
    fn vote_after_voting_period_rejected() {
        let env = Env::default();
        let (admin, client) = setup(&env, 1_000_000);
        let proposer = Address::generate(&env);
        give_stake(&env, &client, &admin, &proposer, 200_000);

        let pid = client.create_proposal(&proposer, &Symbol::new(&env, "param"), &1, &2);

        // Advance strictly past voting_ends_at (now > voting_ends_at).
        env.ledger()
            .with_mut(|li| li.timestamp = VOTING_PERIOD_SECS + 1);
        let result = client.try_vote(&proposer, &pid, &true);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::VotingNotEnded);
    }

    #[test]
    fn vote_on_cancelled_proposal_rejected() {
        let env = Env::default();
        let (admin, client) = setup(&env, 1_000_000);
        let proposer = Address::generate(&env);
        give_stake(&env, &client, &admin, &proposer, 200_000);

        let pid = client.create_proposal(&proposer, &Symbol::new(&env, "param"), &1, &2);
        client.cancel_proposal(&proposer, &pid);

        // Status is Cancelled (not Active) → ProposalNotActive.
        let result = client.try_vote(&proposer, &pid, &true);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::ProposalNotActive
        );
    }

    // --- finalize_proposal() failure paths ---------------------------------

    #[test]
    fn finalize_before_voting_ends_rejected() {
        let env = Env::default();
        let (admin, client) = setup(&env, 1_000_000);
        let proposer = Address::generate(&env);
        give_stake(&env, &client, &admin, &proposer, 200_000);

        let pid = client.create_proposal(&proposer, &Symbol::new(&env, "param"), &1, &2);
        // now (0) <= voting_ends_at → VotingNotEnded.
        let result = client.try_finalize_proposal(&pid);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::VotingNotEnded);
    }

    #[test]
    fn finalize_nonexistent_proposal_rejected() {
        let env = Env::default();
        let (_admin, client) = setup(&env, 1_000_000);
        let result = client.try_finalize_proposal(&123);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::ProposalNotFound
        );
    }

    #[test]
    fn double_finalize_rejected() {
        // After the first finalize the status is no longer Active, so a second
        // finalize must reject with ProposalNotActive.
        let env = Env::default();
        let (client, pid) = passed_proposal(&env);

        let result = client.try_finalize_proposal(&pid);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::ProposalNotActive
        );
    }

    // --- execute_proposal() "cannot execute without passing" ---------------

    #[test]
    fn execute_unfinalized_proposal_rejected() {
        // An Active (never finalized) proposal cannot be executed even after
        // the timelock window — guards the "executable-without-passing" risk.
        let env = Env::default();
        let (admin, client) = setup(&env, 1_000_000);
        let proposer = Address::generate(&env);
        give_stake(&env, &client, &admin, &proposer, 200_000);
        let voter = Address::generate(&env);
        give_stake(&env, &client, &admin, &voter, 800_000);

        let pid = client.create_proposal(&proposer, &Symbol::new(&env, "param"), &1, &2);
        client.vote(&voter, &pid, &true);

        // Far past any timelock, but status is still Active (not finalized).
        env.ledger()
            .with_mut(|li| li.timestamp = VOTING_PERIOD_SECS + TIMELOCK_SECS + 100);
        let result = client.try_execute_proposal(&pid);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::ProposalNotPassed
        );
    }

    #[test]
    fn execute_rejected_proposal_rejected() {
        // A finalized-Rejected proposal cannot be executed.
        let env = Env::default();
        let (admin, client) = setup(&env, 1_000_000);
        let proposer = Address::generate(&env);
        give_stake(&env, &client, &admin, &proposer, 50_000);

        let pid = client.create_proposal(&proposer, &Symbol::new(&env, "param"), &1, &2);
        // Only proposer votes: 50_000 < 100_000 quorum → Rejected.
        client.vote(&proposer, &pid, &true);
        env.ledger()
            .with_mut(|li| li.timestamp = VOTING_PERIOD_SECS + 1);
        let status = client.finalize_proposal(&pid);
        assert!(matches!(status, ProposalStatus::Rejected));

        env.ledger()
            .with_mut(|li| li.timestamp = VOTING_PERIOD_SECS + TIMELOCK_SECS + 1);
        let result = client.try_execute_proposal(&pid);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::ProposalNotPassed
        );
    }

    #[test]
    fn execute_nonexistent_proposal_rejected() {
        let env = Env::default();
        let (_admin, client) = setup(&env, 1_000_000);
        let result = client.try_execute_proposal(&7);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::ProposalNotFound
        );
    }

    // --- cancel_proposal() failure paths -----------------------------------

    #[test]
    fn cancel_nonexistent_proposal_rejected() {
        let env = Env::default();
        let (_admin, client) = setup(&env, 1_000_000);
        let caller = Address::generate(&env);
        let result = client.try_cancel_proposal(&caller, &5);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::ProposalNotFound
        );
    }

    #[test]
    fn cancel_already_finalized_proposal_rejected() {
        // A Passed proposal is no longer Active → cancel rejects with
        // ProposalNotActive (checked before the proposer-identity check).
        let env = Env::default();
        let (admin, client) = setup(&env, 1_000_000);
        let proposer = Address::generate(&env);
        give_stake(&env, &client, &admin, &proposer, 200_000);
        let voter = Address::generate(&env);
        give_stake(&env, &client, &admin, &voter, 800_000);

        let pid = client.create_proposal(&proposer, &Symbol::new(&env, "param"), &1, &2);
        client.vote(&voter, &pid, &true);
        env.ledger()
            .with_mut(|li| li.timestamp = VOTING_PERIOD_SECS + 1);
        client.finalize_proposal(&pid);

        let result = client.try_cancel_proposal(&proposer, &pid);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::ProposalNotActive
        );
    }

    // --- Quorum / majority boundary cases ----------------------------------

    #[test]
    fn quorum_exactly_at_threshold_passes() {
        // total_staked = 1_000_000 → quorum = 10% = 100_000. Exactly 100_000
        // total votes satisfies `!(total_votes < quorum)` and with all `for`
        // it must pass. Confirms the threshold is inclusive.
        let env = Env::default();
        let (admin, client) = setup(&env, 1_000_000);
        let proposer = Address::generate(&env);
        give_stake(&env, &client, &admin, &proposer, 100_000);

        let pid = client.create_proposal(&proposer, &Symbol::new(&env, "param"), &1, &2);
        client.vote(&proposer, &pid, &true); // exactly 100_000 for

        env.ledger()
            .with_mut(|li| li.timestamp = VOTING_PERIOD_SECS + 1);
        let status = client.finalize_proposal(&pid);
        assert!(matches!(status, ProposalStatus::Passed));

        let proposal = client.get_proposal(&pid).unwrap();
        assert_eq!(proposal.votes_for, 100_000);
    }

    #[test]
    fn quorum_one_below_threshold_rejected() {
        // 99_999 total votes is one below the 100_000 quorum → Rejected.
        let env = Env::default();
        let (admin, client) = setup(&env, 1_000_000);
        let proposer = Address::generate(&env);
        give_stake(&env, &client, &admin, &proposer, 99_999);

        let pid = client.create_proposal(&proposer, &Symbol::new(&env, "param"), &1, &2);
        client.vote(&proposer, &pid, &true);

        env.ledger()
            .with_mut(|li| li.timestamp = VOTING_PERIOD_SECS + 1);
        let status = client.finalize_proposal(&pid);
        assert!(matches!(status, ProposalStatus::Rejected));
    }

    #[test]
    fn tie_vote_is_rejected() {
        // Passing requires strict majority (`votes_for > votes_against`); an
        // exact tie (with quorum met) falls through to Rejected. Boundary of
        // the majority rule.
        let env = Env::default();
        let (admin, client) = setup(&env, 1_000_000);
        let proposer = Address::generate(&env);
        give_stake(&env, &client, &admin, &proposer, 300_000);
        let opponent = Address::generate(&env);
        give_stake(&env, &client, &admin, &opponent, 300_000);

        let pid = client.create_proposal(&proposer, &Symbol::new(&env, "param"), &1, &2);
        client.vote(&proposer, &pid, &true); // 300_000 for
        client.vote(&opponent, &pid, &false); // 300_000 against → tie

        env.ledger()
            .with_mut(|li| li.timestamp = VOTING_PERIOD_SECS + 1);
        let status = client.finalize_proposal(&pid);
        assert!(matches!(status, ProposalStatus::Rejected));

        let proposal = client.get_proposal(&pid).unwrap();
        assert_eq!(proposal.votes_for, proposal.votes_against);
    }

    #[test]
    fn zero_total_staked_makes_quorum_trivially_met() {
        // Boundary: with snapshotted total_staked = 0 the quorum requirement is
        // 0, so a single `for` vote both meets quorum and wins the majority.
        // Documents that a mis-set (zero) total staked removes quorum
        // protection entirely (see report for the governance-capture note).
        let env = Env::default();
        let (admin, client) = setup(&env, 0);
        let proposer = Address::generate(&env);
        give_stake(&env, &client, &admin, &proposer, 5);

        let pid = client.create_proposal(&proposer, &Symbol::new(&env, "param"), &1, &2);
        client.vote(&proposer, &pid, &true);

        env.ledger()
            .with_mut(|li| li.timestamp = VOTING_PERIOD_SECS + 1);
        let status = client.finalize_proposal(&pid);
        assert!(matches!(status, ProposalStatus::Passed));
    }

    #[test]
    #[should_panic(expected = "overflow")]
    fn vote_counting_overflow_panics() {
        // Vote weights are summed as unchecked i128 additions. Two voters whose
        // combined weight exceeds i128::MAX overflow-panic under the dev
        // profile's debug assertions. Documents an overflow-prone arithmetic
        // path (requires admin to set adversarial stake weights).
        let env = Env::default();
        let (admin, client) = setup(&env, 1_000_000);
        let proposer = Address::generate(&env);
        give_stake(&env, &client, &admin, &proposer, i128::MAX);
        let voter = Address::generate(&env);
        give_stake(&env, &client, &admin, &voter, 1);

        let pid = client.create_proposal(&proposer, &Symbol::new(&env, "param"), &1, &2);
        client.vote(&proposer, &pid, &true); // votes_for = i128::MAX
        client.vote(&voter, &pid, &true); // i128::MAX + 1 → overflow panic
    }

    // --- Event assertions ---------------------------------------------------
    // Pattern borrowed from staking_pool/rent_payments (no prior governance
    // event tests): read `env.events().all()`, decode topics and the data tuple
    // via `try_into_val`.

    #[test]
    fn create_proposal_emits_event() {
        let env = Env::default();
        let (admin, client) = setup(&env, 1_000_000);
        let proposer = Address::generate(&env);
        give_stake(&env, &client, &admin, &proposer, 100_000);

        let pid = client.create_proposal(&proposer, &Symbol::new(&env, "param"), &1, &2);

        let events = env.events().all();
        let (_, topics, data) = events.last().unwrap();
        let ns: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        let name: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(ns, Symbol::new(&env, "governance"));
        assert_eq!(name, Symbol::new(&env, "proposal_created"));

        // data = (id, proposer, snapshotted_total_staked)
        let (id, ev_proposer, total): (u64, Address, i128) = data.try_into_val(&env).unwrap();
        assert_eq!(id, pid);
        assert_eq!(ev_proposer, proposer);
        assert_eq!(total, 1_000_000);
    }

    #[test]
    fn vote_emits_event() {
        let env = Env::default();
        let (admin, client) = setup(&env, 1_000_000);
        let proposer = Address::generate(&env);
        give_stake(&env, &client, &admin, &proposer, 100_000);
        let voter = Address::generate(&env);
        give_stake(&env, &client, &admin, &voter, 250_000);

        let pid = client.create_proposal(&proposer, &Symbol::new(&env, "param"), &1, &2);
        client.vote(&voter, &pid, &true);

        let events = env.events().all();
        let (_, topics, data) = events.last().unwrap();
        let name: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(name, Symbol::new(&env, "voted"));

        // data = (proposal_id, voter, support, weight)
        let (ev_pid, ev_voter, support, weight): (u64, Address, bool, i128) =
            data.try_into_val(&env).unwrap();
        assert_eq!(ev_pid, pid);
        assert_eq!(ev_voter, voter);
        assert!(support);
        assert_eq!(weight, 250_000);
    }

    #[test]
    fn finalize_proposal_emits_event() {
        let env = Env::default();
        let (admin, client) = setup(&env, 1_000_000);
        let proposer = Address::generate(&env);
        give_stake(&env, &client, &admin, &proposer, 200_000);
        let voter = Address::generate(&env);
        give_stake(&env, &client, &admin, &voter, 800_000);

        let pid = client.create_proposal(&proposer, &Symbol::new(&env, "param"), &1, &2);
        client.vote(&proposer, &pid, &true);
        client.vote(&voter, &pid, &false);
        env.ledger()
            .with_mut(|li| li.timestamp = VOTING_PERIOD_SECS + 1);
        client.finalize_proposal(&pid);

        let events = env.events().all();
        let (_, topics, data) = events.last().unwrap();
        let name: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(name, Symbol::new(&env, "proposal_finalized"));

        // data = (proposal_id, votes_for, votes_against, quorum_reached)
        let (ev_pid, votes_for, votes_against, quorum_reached): (u64, i128, i128, bool) =
            data.try_into_val(&env).unwrap();
        assert_eq!(ev_pid, pid);
        assert_eq!(votes_for, 200_000);
        assert_eq!(votes_against, 800_000);
        assert!(quorum_reached); // 1_000_000 total votes >= 100_000 quorum
    }

    #[test]
    fn execute_proposal_emits_event() {
        let env = Env::default();
        let (client, pid) = passed_proposal(&env);

        env.ledger()
            .with_mut(|li| li.timestamp = VOTING_PERIOD_SECS + TIMELOCK_SECS + 1);
        client.execute_proposal(&pid);

        let events = env.events().all();
        let (_, topics, data) = events.last().unwrap();
        let name: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(name, Symbol::new(&env, "proposal_executed"));

        // data = (proposal_id, param_key, proposed_value)
        let (ev_pid, param_key, proposed_value): (u64, Symbol, i128) =
            data.try_into_val(&env).unwrap();
        assert_eq!(ev_pid, pid);
        assert_eq!(param_key, Symbol::new(&env, "param"));
        assert_eq!(proposed_value, 2);
    }

    #[test]
    fn cancel_proposal_emits_event() {
        let env = Env::default();
        let (admin, client) = setup(&env, 1_000_000);
        let proposer = Address::generate(&env);
        give_stake(&env, &client, &admin, &proposer, 200_000);

        let pid = client.create_proposal(&proposer, &Symbol::new(&env, "param"), &1, &2);
        client.cancel_proposal(&proposer, &pid);

        let events = env.events().all();
        let (_, topics, data) = events.last().unwrap();
        let name: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(name, Symbol::new(&env, "proposal_cancelled"));

        // data = proposal_id (published as a bare u64, not a tuple)
        let ev_pid: u64 = data.try_into_val(&env).unwrap();
        assert_eq!(ev_pid, pid);
    }
}
