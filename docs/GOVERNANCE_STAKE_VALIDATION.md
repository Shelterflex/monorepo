# Governance Stake-Setting Sign Validation (`#1747`)

> **Repository**: `Shelterflex/monorepo`  
> **Component**: `contracts/governance`  
> **Related Issue**: `#1747`

---

## 1. Background & Problem Statement
Previously, governance staking functions (`set_total_staked` and `set_voter_stake` under `governance/src/lib.rs:147-166`) accepted raw `i128` stake amounts without validating whether the input value was non-negative. 

Because vote-weight and quorum calculations elsewhere in the contract assume non-negative balances, unvalidated negative stakes introduced critical risks of integer corruption, quorum bypasses, or unexpected panic states if invoked by buggy callers or administrative misconfigurations.

---

## 2. Solution & Acceptance Criteria
* **Typed Error Rejection**: Added sign boundary checks to both `set_total_staked` and `set_voter_stake` to explicitly reject negative values (`amount < 0`) with a typed error (`Error::NegativeStake`) before storing values or executing calculations.
* **Test Coverage**: Added dedicated unit tests verifying that negative stake updates return the expected error and that valid non-negative updates continue to succeed.
* **CI Compliance**: All workspace tests, formatting checks (`cargo fmt`), and Clippy lints pass successfully.