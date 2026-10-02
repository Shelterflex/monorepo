#![cfg(kani)]

//! Kani formal-verification harnesses for `upgradeable_proxy`.
//!
//! Core security invariant under proof:
//!   **Upgrade authorization** — the two-step upgrade flow (propose → confirm)
//!   must enforce role separation: only the admin may propose, only the
//!   designated second approver may confirm, and the hash passed to
//!   `confirm_upgrade` must match the pending proposal (TOCTOU protection).
//!
//! Kani proofs are gated with `#[cfg(kani)]` and are NOT compiled or run by
//! `cargo test`.  They require `cargo kani` and are not a CI merge gate.

use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

use crate::{DataKey, ProxyError, UpgradeableProxy};

// ── helpers ───────────────────────────────────────────────────────────────────

/// Initialise the contract and return (admin, approver, client).
fn setup(
    env: &Env,
) -> (
    Address,
    Address,
    crate::UpgradeableProxyClient<'_>,
) {
    let contract_id = env.register(UpgradeableProxy, ());
    let client = crate::UpgradeableProxyClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let approver = Address::generate(env);
    env.mock_all_auths();
    client.init(&admin, &approver);
    (admin, approver, client)
}

fn dummy_hash(env: &Env, seed: u8) -> BytesN<32> {
    let mut arr = [0u8; 32];
    arr[0] = seed;
    BytesN::from_array(env, &arr)
}

// ── proofs ────────────────────────────────────────────────────────────────────

/// **Proof 1 — non-admin cannot propose upgrade**
///
/// Any address other than the stored admin must receive `NotAdmin` when
/// calling `propose_upgrade`.
#[kani::proof]
fn verify_only_admin_can_propose_upgrade() {
    let env = Env::default();
    let (_admin, _approver, client) = setup(&env);

    let outsider = Address::generate(&env);
    let new_hash = dummy_hash(&env, 1);

    let result = client.try_propose_upgrade(&outsider, &new_hash);

    assert!(
        matches!(result, Err(Ok(ProxyError::NotAdmin))),
        "non-admin must not be able to propose an upgrade"
    );
}

/// **Proof 2 — non-approver cannot confirm upgrade**
///
/// After the admin has submitted a valid upgrade proposal, any address other
/// than the stored second approver must receive `NotApprover` when calling
/// `confirm_upgrade`.
#[kani::proof]
fn verify_only_approver_can_confirm_upgrade() {
    let env = Env::default();
    let (admin, _approver, client) = setup(&env);

    let new_hash = dummy_hash(&env, 2);
    // Admin proposes successfully.
    client.propose_upgrade(&admin, &new_hash);

    // A different address tries to confirm.
    let outsider = Address::generate(&env);
    let result = client.try_confirm_upgrade(&outsider, &new_hash);

    assert!(
        matches!(result, Err(Ok(ProxyError::NotApprover))),
        "non-approver must not be able to confirm an upgrade"
    );
}

/// **Proof 3 — hash mismatch is rejected (TOCTOU protection)**
///
/// The `confirm_upgrade` call must fail with `HashMismatch` when the supplied
/// hash differs from the one stored in `PendingUpgrade`.  This prevents a
/// scenario where the admin proposes hash A but the approver signs hash B.
#[kani::proof]
fn verify_confirm_upgrade_rejects_hash_mismatch() {
    let env = Env::default();
    let (admin, approver, client) = setup(&env);

    let proposed_hash = dummy_hash(&env, 3);
    let different_hash = dummy_hash(&env, 4); // different first byte

    client.propose_upgrade(&admin, &proposed_hash);

    // Approver supplies the wrong hash.
    let result = client.try_confirm_upgrade(&approver, &different_hash);

    assert!(
        matches!(result, Err(Ok(ProxyError::HashMismatch))),
        "confirm_upgrade must reject a hash that does not match the proposal"
    );
}

/// **Proof 4 — confirm without a prior proposal is rejected**
///
/// Calling `confirm_upgrade` when no proposal has been submitted (or after
/// it was cancelled) must return `NoPendingUpgrade`.
#[kani::proof]
fn verify_confirm_upgrade_requires_pending_proposal() {
    let env = Env::default();
    let (_admin, approver, client) = setup(&env);

    // No proposal has been submitted.
    let hash = dummy_hash(&env, 5);
    let result = client.try_confirm_upgrade(&approver, &hash);

    assert!(
        matches!(result, Err(Ok(ProxyError::NoPendingUpgrade))),
        "confirm_upgrade must fail when no proposal is pending"
    );
}

/// **Proof 5 — version counter increments on successful upgrade**
///
/// After a complete propose→confirm cycle, the version stored in contract
/// state must be exactly `initial_version + 1`.
///
/// Note: `env.deployer().update_current_contract_wasm()` is a no-op in the
/// test environment, so the full flow is exercisable without real WASM.
#[kani::proof]
fn verify_version_increments_on_upgrade() {
    let env = Env::default();
    let (admin, approver, client) = setup(&env);

    // Record version before upgrade.
    let version_before = client.version();

    let new_hash = dummy_hash(&env, 6);
    client.propose_upgrade(&admin, &new_hash);
    client.confirm_upgrade(&approver, &new_hash);

    let version_after = client.version();

    assert_eq!(
        version_after,
        version_before + 1,
        "version must increment by exactly 1 after a successful upgrade"
    );
}

/// **Proof 6 — cancelled proposal clears pending state**
///
/// After `cancel_upgrade`, the `PendingUpgrade` key must be absent from
/// storage, so any subsequent `confirm_upgrade` attempt returns
/// `NoPendingUpgrade` rather than operating on stale state.
#[kani::proof]
fn verify_cancel_clears_pending_upgrade() {
    let env = Env::default();
    let (admin, approver, client) = setup(&env);

    let new_hash = dummy_hash(&env, 7);
    client.propose_upgrade(&admin, &new_hash);

    // Sanity: pending flag should be set.
    assert!(
        client.has_pending_upgrade(),
        "pending upgrade must be set after propose_upgrade"
    );

    client.cancel_upgrade(&admin);

    // Pending flag should now be cleared.
    assert!(
        !client.has_pending_upgrade(),
        "pending upgrade must be cleared after cancel_upgrade"
    );

    // Confirming after cancellation must fail.
    let result = client.try_confirm_upgrade(&approver, &new_hash);
    assert!(
        matches!(result, Err(Ok(ProxyError::NoPendingUpgrade))),
        "confirm_upgrade must fail after cancel_upgrade"
    );
}
