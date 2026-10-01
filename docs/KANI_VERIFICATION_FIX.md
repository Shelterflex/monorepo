# Kani Formal Verification Harness CFG Fix (`#1829`)

> **Repository**: `Shelterflex/monorepo`  
> **Components**: `contracts/rent_wallet`, `contracts/transaction-receipt-contract`  
> **Related Issue**: `#1829`

---

## 1. Background & Problem Statement
A compilation configuration mismatch prevented formal verification harnesses from executing under Kani:
* While parent modules in `lib.rs` were correctly gated with `#[cfg(kani)]`, the files `rent_wallet/src/formal_properties.rs` and `transaction-receipt-contract/src/formal_properties.rs` wrapped their contents in inner `#[cfg(test)]` modules.
* Because `cargo kani` does not pass `cfg(test)`, these formal proofs were treated as dead code and never executed by either standard test suites or Kani runs.
* Furthermore, `transaction-receipt-contract` contained an empty stub proof (`invariant_unique_receipts`) that performed zero assertions.

---

## 2. Solution & Remediation Details
1. **CFG Mismatch Correction**: Removed the inner `#[cfg(test)]` modules and aligned both files to standard Kani attribute structures (`#[cfg(kani)]` and `#[kani::proof]`), matching the reference pattern in `staking_pool/src/formal_properties.rs`.
2. **Receipt Invariant Realization**: Replaced the empty stub in `transaction-receipt-contract` with a concrete verification test that instantiates the contract, issues a receipt, and asserts correct storage and indexing properties.
3. **Rent Wallet Invariants**: Verified that all 10 rent wallet invariant proofs (`inv1_funds_conservation` through `inv10_total_consistency_after_batch`) are now fully reachable and execute correctly under `cargo kani`.