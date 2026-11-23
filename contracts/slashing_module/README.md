# Slashing Module Contract

Implements a two-phase slashing mechanism with commit-reveal evidence, challenge windows, tiered penalties, and jailing.

## Interface

### Admin Functions
- `init(admin)` - Initialize the contract with an admin address
- `configure_tiers(tiers)` - Configure penalty tiers for tiered slashing
- `set_submitter(submitter)` - Set an allowed evidence submitter
- `set_challenge_window(window)` - Set the challenge window duration
- `set_bond_contract(bond_contract)` - Set the bond contract address
- `cancel_slash(slash_id)` - Cancel a slash before finalization
- `approve_unjail(address)` - Approve unjailing for a jailed address

### Evidence Functions
- `submit_evidence(evidence_hash)` - Submit evidence as a hash (commit)
- `reveal_evidence(slash_id, evidence, salt)` - Reveal evidence and verify hash

### Slash Functions
- `propose_slash(subject, penalty_basis_points, evidence_hash)` - Propose a slash
- `finalize_slash(slash_id)` - Finalize a slash after challenge window
- `get_pending_slash(slash_id)` - Get a pending slash proposal
- `slash_count(address)` - Get slash count for an address
- `total_slashed()` - Get total slashed amount

### Jail Functions
- `is_jailed(address)` - Check if an address is jailed
- `unjail()` - Request unjailing
- `approve_unjail(address)` - Approve unjailing (admin only)

## Storage Layout

- `DataKey::Admin` - Admin address
- `DataKey::Operator(address)` - Operator flags
- `DataKey::Submitter(address)` - Submitter flags
- `DataKey::BondContract` - Bond contract address
- `DataKey::ChallengeWindow` - Challenge window duration
- `DataKey::PenaltyTiers` - Penalty tier configuration
- `DataKey::SlashProposal(slash_id)` - Slash proposals
- `DataKey::SlashCount(address)` - Per-address slash counts
- `DataKey::JailedStatus(address)` - Jailed status records
- `DataKey::EvidenceCommitment(slash_id)` - Evidence commitments
- `DataKey::NextSlashId` - Next slash ID counter
- `DataKey::TotalSlashed` - Total slashed counter

## Slash Lifecycle

1. `submit_evidence` - Store evidence hash
2. `reveal_evidence` - Verify evidence matches hash
3. `propose_slash` - Create slash proposal
4. Wait for `challenge_window`
5. `finalize_slash` - Apply penalty (or `cancel_slash` by admin)

## Errors

- `AlreadyInitialized` - Contract already initialized
- `NotInitialized` - Contract not initialized
- `NotAuthorized` - Caller not authorized
- `InvalidBasisPoints` - Basis points above 10000
- `SlashNotFound` - Slash proposal not found
- `SlashAlreadyFinalized` - Slash already finalized
- `SlashAlreadyCancelled` - Slash already cancelled
- `SlashNotFinalizable` - Challenge window not elapsed
- `NotJailed` - Address not jailed
- `Jailed` - Address is jailed
- `EvidenceMismatch` - Evidence hash mismatch
- `EvidenceNotFound` - Evidence commitment not found
