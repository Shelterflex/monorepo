# Governance Contract

This contract manages stake-weighted proposals and voting for protocol governance.

## Interface

| Method | Args | Auth | Emitted events |
|---|---|---|---|
| `init` | `admin: Address, stake_oracle: Address, min_proposer_stake: i128, quorum_threshold: i128, majority_threshold: i128, voting_period: u64` | public (one-time init) | `("governance","init")` |
| `set_total_staked` | `caller: Address, amount: i128` | stake oracle or admin | `("governance","set_total_staked")` |
| `set_voter_stake` | `caller: Address, voter: Address, amount: i128` | stake oracle or admin | `("governance","set_voter_stake")` |
| `set_min_proposer_stake` | `admin: Address, amount: i128` | admin | `("governance","set_min_proposer_stake")` |
| `create_proposal` | `proposer: Address, description: Symbol` | proposer | `("governance","create_proposal")` |
| `vote` | `voter: Address, proposal_id: u64, vote_for: bool` | voter | `("governance","vote")` |
| `finalize_proposal` | `caller: Address, proposal_id: u64` | public | `("governance","finalize_proposal")` |
| `execute_proposal` | `caller: Address, proposal_id: u64` | public | `("governance","execute_proposal")` |
| `cancel_proposal` | `caller: Address, proposal_id: u64` | proposer or admin | `("governance","cancel_proposal")` |
| `get_proposal` | `proposal_id: u64` | public | none |
| `proposal_count` | none | public | none |
| `voter_stake` | `voter: Address` | public | none |
| `total_staked` | none | public | none |
| `has_voted` | `voter: Address, proposal_id: u64` | public | none |

## Storage Layout

### Instance Storage
- `Admin`: Address - Contract administrator
- `StakeOracle`: Address - Address authorized to set stake values
- `TotalStaked`: i128 - Total staked across all voters
- `MinProposerStake`: i128 - Minimum stake required to propose
- `QuorumThreshold`: i128 - Quorum required for proposal to pass (basis points, e.g., 5000 = 50%)
- `MajorityThreshold`: i128 - Majority required for proposal to pass (basis points, e.g., 5000 = 50%)
- `VotingPeriod`: u64 - Voting period in seconds
- `ProposalCount`: u64 - Total number of proposals created
- `ContractVersion`: u32 - Contract version for upgrade tracking

### Persistent Storage
- `Proposal(u64)`: Proposal - Proposal data by ID
- `VoterStakeSnapshot(Address, u64)`: i128 - Voter's stake snapshot at proposal creation
- `HasVoted(Address, u64)`: bool - Whether a voter has voted on a proposal
- `VoterStake(Address)`: i128 - Voter's current stake

## Events

All state changes emit events with topics starting with `("governance", ...)` for off-chain indexing.

## Errors

- `AlreadyInitialized`: Contract already initialized
- `NotAuthorized`: Caller lacks required permission
- `InvalidAmount`: Amount is zero or negative
- `InsufficientStake`: Insufficient stake for operation
- `ProposalNotFound`: Proposal ID does not exist
- `ProposalNotActive`: Proposal is not in active state
- `VotingEnded`: Voting period has ended
- `AlreadyVoted`: Voter has already voted on this proposal
- `QuorumNotMet`: Quorum threshold not met
- `MajorityNotMet`: Majority threshold not met
- `ProposalAlreadyExecuted`: Proposal has already been executed
- `ProposalAlreadyCancelled`: Proposal has already been cancelled
- `CannotCancelEndedProposal`: Cannot cancel a proposal after voting ends
- `NotProposerOrAdmin`: Caller is not the proposer or admin
- `NegativeValue`: Negative value provided
- `InvalidThreshold`: Threshold value is invalid (must be 0-10000 basis points)
