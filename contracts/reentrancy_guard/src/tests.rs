#![cfg(test)]

use soroban_sdk::testutils::{Address as _, Events};
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, Symbol, TryIntoVal};

use crate::{ContractError, ReentrancyGuard, ReentrancyGuardClient};

fn setup_contract(env: &Env) -> (ReentrancyGuardClient<'_>, Address) {
    let contract_id = env.register(ReentrancyGuard, ());
    let client = ReentrancyGuardClient::new(env, &contract_id);

    let admin = Address::generate(env);

    // Initialize with mock_all_auths
    env.mock_all_auths();

    client.try_init(&admin).unwrap().unwrap();

    (client, admin)
}

fn create_entry_point(env: &Env, name: &str) -> BytesN<32> {
    let mut bytes = [0u8; 32];
    let name_bytes = name.as_bytes();
    let len = name_bytes.len().min(32);
    bytes[..len].copy_from_slice(&name_bytes[..len]);
    BytesN::from_array(env, &bytes)
}

#[test]
fn enter_sets_call_depth() {
    let env = Env::default();
    let (client, admin) = setup_contract(&env);

    let guarded_contract = Address::generate(&env);
    let entry_point = create_entry_point(&env, "transfer");

    // Activate guard
    client
        .try_activate_guard(&admin, &guarded_contract)
        .unwrap()
        .unwrap();

    // Enter should set depth
    client
        .try_enter(&guarded_contract, &entry_point)
        .unwrap()
        .unwrap();

    // Check that call depth is 1
    assert_eq!(client.get_call_depth(&guarded_contract, &entry_point), 1);
}

#[test]
fn exit_resets_call_depth() {
    let env = Env::default();
    let (client, admin) = setup_contract(&env);

    let guarded_contract = Address::generate(&env);
    let entry_point = create_entry_point(&env, "transfer");

    // Activate guard
    client
        .try_activate_guard(&admin, &guarded_contract)
        .unwrap()
        .unwrap();

    // Enter
    client
        .try_enter(&guarded_contract, &entry_point)
        .unwrap()
        .unwrap();

    // Exit
    client
        .try_exit(&guarded_contract, &entry_point)
        .unwrap()
        .unwrap();

    // Check that call depth is back to 0
    assert_eq!(client.get_call_depth(&guarded_contract, &entry_point), 0);
}

#[test]
fn reentrancy_prevention_returns_error() {
    let env = Env::default();
    let (client, admin) = setup_contract(&env);

    let guarded_contract = Address::generate(&env);
    let entry_point = create_entry_point(&env, "transfer");

    // Activate guard
    client
        .try_activate_guard(&admin, &guarded_contract)
        .unwrap()
        .unwrap();

    // Set max_depth to 1 for strict reentrancy prevention
    client.try_set_max_call_depth(&admin, &1).unwrap().unwrap();

    // First enter succeeds (depth 0 < max_depth 1)
    client
        .try_enter(&guarded_contract, &entry_point)
        .unwrap()
        .unwrap();

    // Second enter fails — depth 1 >= max_depth 1
    let err = client
        .try_enter(&guarded_contract, &entry_point)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::MaxDepthExceeded);
}

#[test]
fn exit_restores_depth_on_cleanup() {
    let env = Env::default();
    let (client, admin) = setup_contract(&env);

    let guarded_contract = Address::generate(&env);
    let entry_point = create_entry_point(&env, "transfer");

    // Activate guard
    client
        .try_activate_guard(&admin, &guarded_contract)
        .unwrap()
        .unwrap();

    // Enter (simulates guarded call)
    client
        .try_enter(&guarded_contract, &entry_point)
        .unwrap()
        .unwrap();

    // In real scenario, exit would be called automatically on panic cleanup
    // Here we manually release to simulate cleanup
    client
        .try_exit(&guarded_contract, &entry_point)
        .unwrap()
        .unwrap();

    // Verify depth is restored to 0
    assert_eq!(client.get_call_depth(&guarded_contract, &entry_point), 0);
}

#[test]
fn concurrent_guard_independent_state() {
    let env = Env::default();
    let (client, admin) = setup_contract(&env);

    let contract_a = Address::generate(&env);
    let contract_b = Address::generate(&env);
    let entry_point = create_entry_point(&env, "transfer");

    // Activate guards for both contracts
    client
        .try_activate_guard(&admin, &contract_a)
        .unwrap()
        .unwrap();
    client
        .try_activate_guard(&admin, &contract_b)
        .unwrap()
        .unwrap();

    // Enter contract A
    client
        .try_enter(&contract_a, &entry_point)
        .unwrap()
        .unwrap();

    // Contract A should have depth 1
    assert_eq!(client.get_call_depth(&contract_a, &entry_point), 1);

    // Contract B should still have depth 0
    assert_eq!(client.get_call_depth(&contract_b, &entry_point), 0);

    // Should be able to enter contract B independently
    client
        .try_enter(&contract_b, &entry_point)
        .unwrap()
        .unwrap();

    // Both should have depth 1 now
    assert_eq!(client.get_call_depth(&contract_a, &entry_point), 1);
    assert_eq!(client.get_call_depth(&contract_b, &entry_point), 1);
}

#[test]
fn guard_wrapping_pattern() {
    let env = Env::default();
    let (client, admin) = setup_contract(&env);

    let guarded_contract = Address::generate(&env);
    let entry_point = create_entry_point(&env, "transfer");

    // Activate guard
    client
        .try_activate_guard(&admin, &guarded_contract)
        .unwrap()
        .unwrap();

    // Demonstrate the intended usage pattern: enter -> execute -> exit
    // Enter
    client
        .try_enter(&guarded_contract, &entry_point)
        .unwrap()
        .unwrap();

    // Execute guarded logic (in this case, just check depth)
    assert_eq!(client.get_call_depth(&guarded_contract, &entry_point), 1);

    // Exit
    client
        .try_exit(&guarded_contract, &entry_point)
        .unwrap()
        .unwrap();

    // Verify depth is back to 0
    assert_eq!(client.get_call_depth(&guarded_contract, &entry_point), 0);
}

#[test]
fn call_depth_reflects_enter_exit_state() {
    let env = Env::default();
    let (client, admin) = setup_contract(&env);

    let guarded_contract = Address::generate(&env);
    let entry_point = create_entry_point(&env, "transfer");

    // Activate guard
    client
        .try_activate_guard(&admin, &guarded_contract)
        .unwrap()
        .unwrap();

    // Initially depth is 0
    assert_eq!(client.get_call_depth(&guarded_contract, &entry_point), 0);

    // After enter, depth should be 1
    client
        .try_enter(&guarded_contract, &entry_point)
        .unwrap()
        .unwrap();
    assert_eq!(client.get_call_depth(&guarded_contract, &entry_point), 1);

    // After exit, depth should be 0
    client
        .try_exit(&guarded_contract, &entry_point)
        .unwrap()
        .unwrap();
    assert_eq!(client.get_call_depth(&guarded_contract, &entry_point), 0);
}

#[test]
fn call_depth_tracking() {
    let env = Env::default();
    let (client, admin) = setup_contract(&env);

    let guarded_contract = Address::generate(&env);
    let entry_point = create_entry_point(&env, "transfer");

    // Activate guard
    client
        .try_activate_guard(&admin, &guarded_contract)
        .unwrap()
        .unwrap();

    // Initial depth should be 0
    assert_eq!(client.get_call_depth(&guarded_contract, &entry_point), 0);

    // After enter, depth should be 1
    client
        .try_enter(&guarded_contract, &entry_point)
        .unwrap()
        .unwrap();
    assert_eq!(client.get_call_depth(&guarded_contract, &entry_point), 1);

    // After exit, depth should be 0
    client
        .try_exit(&guarded_contract, &entry_point)
        .unwrap()
        .unwrap();
    assert_eq!(client.get_call_depth(&guarded_contract, &entry_point), 0);
}

#[test]
fn max_depth_exceeded_returns_error() {
    let env = Env::default();
    let (client, admin) = setup_contract(&env);

    let guarded_contract = Address::generate(&env);
    let entry_point = create_entry_point(&env, "transfer");

    // Set max depth to 1 for testing
    client.try_set_max_call_depth(&admin, &1).unwrap().unwrap();

    // Activate guard
    client
        .try_activate_guard(&admin, &guarded_contract)
        .unwrap()
        .unwrap();

    // First enter should succeed (depth 0 < max_depth 1)
    client
        .try_enter(&guarded_contract, &entry_point)
        .unwrap()
        .unwrap();

    // Second enter should fail with MaxDepthExceeded (depth 1 >= max_depth 1)
    let err = client
        .try_enter(&guarded_contract, &entry_point)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::MaxDepthExceeded);
}

// ── init / admin management ──────────────────────────────────────────────────

#[test]
fn double_init_fails() {
    let env = Env::default();
    let (client, admin) = setup_contract(&env);

    // Guard is already initialized in setup; a second init must error.
    let err = client.try_init(&admin).unwrap_err().unwrap();
    assert_eq!(err, ContractError::AlreadyInitialized);
}

#[test]
fn set_admin_transfers_control() {
    let env = Env::default();
    let (client, admin) = setup_contract(&env);
    let new_admin = Address::generate(&env);
    let guarded_contract = Address::generate(&env);

    // Old admin hands control to the new admin.
    client.try_set_admin(&admin, &new_admin).unwrap().unwrap();

    // New admin can now perform admin-only operations.
    client
        .try_activate_guard(&new_admin, &guarded_contract)
        .unwrap()
        .unwrap();
    assert!(client.is_guard_active(&guarded_contract));

    // Old admin is no longer authorized.
    let err = client
        .try_activate_guard(&admin, &guarded_contract)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::NotAuthorized);
}

#[test]
fn non_admin_cannot_set_admin() {
    let env = Env::default();
    let (client, _admin) = setup_contract(&env);
    let non_admin = Address::generate(&env);
    let target = Address::generate(&env);

    let err = client
        .try_set_admin(&non_admin, &target)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::NotAuthorized);
}

// ── set_max_call_depth bounds ────────────────────────────────────────────────

#[test]
fn set_max_call_depth_zero_fails() {
    let env = Env::default();
    let (client, admin) = setup_contract(&env);

    let err = client
        .try_set_max_call_depth(&admin, &0u32)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::InvalidMaxDepth);
}

#[test]
fn set_max_call_depth_above_cap_fails() {
    let env = Env::default();
    let (client, admin) = setup_contract(&env);

    // 21 is over the hard cap of 20.
    let err = client
        .try_set_max_call_depth(&admin, &21u32)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::InvalidMaxDepth);
}

#[test]
fn set_max_call_depth_at_cap_succeeds() {
    let env = Env::default();
    let (client, admin) = setup_contract(&env);

    // 20 is the inclusive upper bound.
    client
        .try_set_max_call_depth(&admin, &20u32)
        .unwrap()
        .unwrap();
    assert_eq!(client.get_max_call_depth(), 20u32);
}

#[test]
fn non_admin_cannot_set_max_call_depth() {
    let env = Env::default();
    let (client, _admin) = setup_contract(&env);
    let non_admin = Address::generate(&env);

    let err = client
        .try_set_max_call_depth(&non_admin, &3u32)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::NotAuthorized);
    // Default is untouched.
    assert_eq!(client.get_max_call_depth(), 5u32);
}

// ── pattern allow/disallow ───────────────────────────────────────────────────

#[test]
fn allow_pattern_twice_fails() {
    let env = Env::default();
    let (client, admin) = setup_contract(&env);
    let pattern = create_entry_point(&env, "batch_call");

    client.try_allow_pattern(&admin, &pattern).unwrap().unwrap();
    assert!(client.is_pattern_allowed(&pattern));

    // Allowing an already-allowed pattern must error.
    let err = client
        .try_allow_pattern(&admin, &pattern)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::PatternAlreadyAllowed);
}

#[test]
fn disallow_pattern_clears_flag() {
    let env = Env::default();
    let (client, admin) = setup_contract(&env);
    let pattern = create_entry_point(&env, "batch_call");

    client.try_allow_pattern(&admin, &pattern).unwrap().unwrap();
    assert!(client.is_pattern_allowed(&pattern));

    client
        .try_disallow_pattern(&admin, &pattern)
        .unwrap()
        .unwrap();
    assert!(!client.is_pattern_allowed(&pattern));

    // Re-allowing after disallow works (flag was truly cleared, not just idempotent).
    client.try_allow_pattern(&admin, &pattern).unwrap().unwrap();
    assert!(client.is_pattern_allowed(&pattern));
}

#[test]
fn non_admin_cannot_allow_pattern() {
    let env = Env::default();
    let (client, _admin) = setup_contract(&env);
    let non_admin = Address::generate(&env);
    let pattern = create_entry_point(&env, "batch_call");

    let err = client
        .try_allow_pattern(&non_admin, &pattern)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::NotAuthorized);
}

#[test]
fn non_admin_cannot_deactivate_guard() {
    let env = Env::default();
    let (client, admin) = setup_contract(&env);
    let non_admin = Address::generate(&env);
    let guarded_contract = Address::generate(&env);

    client
        .try_activate_guard(&admin, &guarded_contract)
        .unwrap()
        .unwrap();

    let err = client
        .try_deactivate_guard(&non_admin, &guarded_contract)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::NotAuthorized);
    // Guard stays active.
    assert!(client.is_guard_active(&guarded_contract));
}

// ── allowed-pattern bypass leaves depth untouched ────────────────────────────

#[test]
fn allowed_pattern_bypasses_depth_tracking() {
    let env = Env::default();
    let (client, admin) = setup_contract(&env);
    let guarded_contract = Address::generate(&env);
    let entry_point = create_entry_point(&env, "reentrant_ok");

    client
        .try_activate_guard(&admin, &guarded_contract)
        .unwrap()
        .unwrap();
    client
        .try_allow_pattern(&admin, &entry_point)
        .unwrap()
        .unwrap();

    // enter/exit on an allowed pattern short-circuit before touching depth.
    client
        .try_enter(&guarded_contract, &entry_point)
        .unwrap()
        .unwrap();
    client
        .try_enter(&guarded_contract, &entry_point)
        .unwrap()
        .unwrap();
    assert_eq!(client.get_call_depth(&guarded_contract, &entry_point), 0u32);

    // exit on an allowed pattern is a no-op and does not underflow.
    client
        .try_exit(&guarded_contract, &entry_point)
        .unwrap()
        .unwrap();
    assert_eq!(client.get_call_depth(&guarded_contract, &entry_point), 0u32);
}

// ── exit guard-state errors ──────────────────────────────────────────────────

#[test]
fn exit_when_guard_inactive_fails() {
    let env = Env::default();
    let (client, _admin) = setup_contract(&env);
    let guarded_contract = Address::generate(&env);
    let entry_point = create_entry_point(&env, "transfer");

    // Guard never activated — exit must report GuardNotActive.
    let err = client
        .try_exit(&guarded_contract, &entry_point)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::GuardNotActive);
}

// ── independent depth per entry point on the same contract ───────────────────

#[test]
fn distinct_entry_points_track_independently() {
    let env = Env::default();
    let (client, admin) = setup_contract(&env);
    let guarded_contract = Address::generate(&env);
    let ep_transfer = create_entry_point(&env, "transfer");
    let ep_withdraw = create_entry_point(&env, "withdraw");

    client
        .try_activate_guard(&admin, &guarded_contract)
        .unwrap()
        .unwrap();

    client
        .try_enter(&guarded_contract, &ep_transfer)
        .unwrap()
        .unwrap();

    // The other entry point on the same contract is unaffected.
    assert_eq!(client.get_call_depth(&guarded_contract, &ep_transfer), 1u32);
    assert_eq!(client.get_call_depth(&guarded_contract, &ep_withdraw), 0u32);
}

// ── remaining privileged-fn unauthorized coverage ───────────────────────────

#[test]
fn non_admin_cannot_disallow_pattern() {
    let env = Env::default();
    let (client, admin) = setup_contract(&env);
    let non_admin = Address::generate(&env);
    let pattern = create_entry_point(&env, "batch_call");

    client.try_allow_pattern(&admin, &pattern).unwrap().unwrap();

    let err = client
        .try_disallow_pattern(&non_admin, &pattern)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::NotAuthorized);
    // The pattern is still allowed — the unauthorized call had no effect.
    assert!(client.is_pattern_allowed(&pattern));
}

// ── privileged calls before init ────────────────────────────────────────────
//
// NOTE: `enter`/`exit` before init return `Err(GuardNotActive)` cleanly, but the
// admin-gated setters reach `get_admin()` which does `.expect("admin not set")`.
// That is a raw panic string rather than a `ContractError` — see the
// ambiguous-behavior note in the PR description. These tests pin the *observed*
// behavior only.

#[test]
#[should_panic(expected = "admin not set")]
fn activate_guard_before_init_panics() {
    let env = Env::default();
    let contract_id = env.register(ReentrancyGuard, ());
    let client = ReentrancyGuardClient::new(&env, &contract_id);
    env.mock_all_auths();
    let some_admin = Address::generate(&env);
    let target = Address::generate(&env);
    // No init() call.
    client.activate_guard(&some_admin, &target);
}

#[test]
#[should_panic(expected = "admin not set")]
fn set_admin_before_init_panics() {
    let env = Env::default();
    let contract_id = env.register(ReentrancyGuard, ());
    let client = ReentrancyGuardClient::new(&env, &contract_id);
    env.mock_all_auths();
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    client.set_admin(&a, &b);
}

#[test]
fn enter_before_init_returns_guard_not_active() {
    // Contrast with the setters above: enter() does not panic pre-init, it
    // returns a structured error because the guard-active flag defaults to false.
    let env = Env::default();
    let contract_id = env.register(ReentrancyGuard, ());
    let client = ReentrancyGuardClient::new(&env, &contract_id);
    let target = Address::generate(&env);
    let ep = create_entry_point(&env, "transfer");

    let err = client.try_enter(&target, &ep).unwrap_err().unwrap();
    assert_eq!(err, ContractError::GuardNotActive);
}

// ── event assertions ───────────────────────────────────────────────────────

/// Name symbol of the most-recently-published event. Works for both the
/// 2-topic events `(reentrancy_guard, <name>)` and the 3-topic ones
/// `(reentrancy_guard, <name>, contract)` — the name is always topic index 1.
fn last_event_name(env: &Env) -> Symbol {
    let events = env.events().all();
    let last = events.last().unwrap();
    let topics: soroban_sdk::Vec<soroban_sdk::Val> = last.1.clone();
    topics.get(1).unwrap().try_into_val(env).unwrap()
}

#[test]
fn event_init_emitted() {
    let env = Env::default();
    let (_client, _admin) = setup_contract(&env);
    // setup_contract already called init(); it must be the emitted event.
    assert_eq!(last_event_name(&env), Symbol::new(&env, "init"));
}

#[test]
fn event_guard_activated_emitted() {
    let env = Env::default();
    let (client, admin) = setup_contract(&env);
    let guarded_contract = Address::generate(&env);

    client
        .try_activate_guard(&admin, &guarded_contract)
        .unwrap()
        .unwrap();

    let events = env.events().all();
    let last = events.last().unwrap();
    let topics: soroban_sdk::Vec<soroban_sdk::Val> = last.1.clone();
    let name: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
    assert_eq!(name, Symbol::new(&env, "guard_activated"));
    let data: Address = last.2.try_into_val(&env).unwrap();
    assert_eq!(data, guarded_contract);
}

#[test]
fn event_guard_deactivated_emitted() {
    let env = Env::default();
    let (client, admin) = setup_contract(&env);
    let guarded_contract = Address::generate(&env);

    client
        .try_activate_guard(&admin, &guarded_contract)
        .unwrap()
        .unwrap();
    client
        .try_deactivate_guard(&admin, &guarded_contract)
        .unwrap()
        .unwrap();

    assert_eq!(
        last_event_name(&env),
        Symbol::new(&env, "guard_deactivated")
    );
}

#[test]
fn event_set_admin_emitted() {
    let env = Env::default();
    let (client, admin) = setup_contract(&env);
    let new_admin = Address::generate(&env);

    client.try_set_admin(&admin, &new_admin).unwrap().unwrap();

    let events = env.events().all();
    let last = events.last().unwrap();
    let topics: soroban_sdk::Vec<soroban_sdk::Val> = last.1.clone();
    let name: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
    assert_eq!(name, Symbol::new(&env, "set_admin"));
    let (old, new): (Address, Address) = last.2.try_into_val(&env).unwrap();
    assert_eq!(old, admin);
    assert_eq!(new, new_admin);
}

#[test]
fn event_set_max_call_depth_emitted() {
    let env = Env::default();
    let (client, admin) = setup_contract(&env);

    client
        .try_set_max_call_depth(&admin, &7u32)
        .unwrap()
        .unwrap();

    let events = env.events().all();
    let last = events.last().unwrap();
    let topics: soroban_sdk::Vec<soroban_sdk::Val> = last.1.clone();
    let name: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
    assert_eq!(name, Symbol::new(&env, "set_max_call_depth"));
    let data: u32 = last.2.try_into_val(&env).unwrap();
    assert_eq!(data, 7u32);
}

#[test]
fn event_pattern_allowed_and_disallowed_emitted() {
    let env = Env::default();
    let (client, admin) = setup_contract(&env);
    let pattern = create_entry_point(&env, "batch_call");

    client.try_allow_pattern(&admin, &pattern).unwrap().unwrap();
    assert_eq!(last_event_name(&env), Symbol::new(&env, "pattern_allowed"));

    client
        .try_disallow_pattern(&admin, &pattern)
        .unwrap()
        .unwrap();
    assert_eq!(
        last_event_name(&env),
        Symbol::new(&env, "pattern_disallowed")
    );
}

#[test]
fn event_entered_and_exited_emitted() {
    let env = Env::default();
    let (client, admin) = setup_contract(&env);
    let guarded_contract = Address::generate(&env);
    let ep = create_entry_point(&env, "transfer");

    client
        .try_activate_guard(&admin, &guarded_contract)
        .unwrap()
        .unwrap();

    client.try_enter(&guarded_contract, &ep).unwrap().unwrap();
    {
        let events = env.events().all();
        let last = events.last().unwrap();
        let topics: soroban_sdk::Vec<soroban_sdk::Val> = last.1.clone();
        let name: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(name, Symbol::new(&env, "entered"));
        // topic 2 is the guarded contract address
        let topic_contract: Address = topics.get(2).unwrap().try_into_val(&env).unwrap();
        assert_eq!(topic_contract, guarded_contract);
        // data is (entry_point, new_depth)
        let (evt_ep, depth): (BytesN<32>, u32) = last.2.try_into_val(&env).unwrap();
        assert_eq!(evt_ep, ep);
        assert_eq!(depth, 1u32);
    }

    client.try_exit(&guarded_contract, &ep).unwrap().unwrap();
    {
        let events = env.events().all();
        let last = events.last().unwrap();
        let topics: soroban_sdk::Vec<soroban_sdk::Val> = last.1.clone();
        let name: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(name, Symbol::new(&env, "exited"));
        let (evt_ep, depth): (BytesN<32>, u32) = last.2.try_into_val(&env).unwrap();
        assert_eq!(evt_ep, ep);
        assert_eq!(depth, 0u32);
    }
}

#[test]
fn event_max_depth_exceeded_emitted() {
    let env = Env::default();
    let (client, admin) = setup_contract(&env);
    let guarded_contract = Address::generate(&env);
    let ep = create_entry_point(&env, "transfer");

    client
        .try_activate_guard(&admin, &guarded_contract)
        .unwrap()
        .unwrap();
    client
        .try_set_max_call_depth(&admin, &1u32)
        .unwrap()
        .unwrap();

    client.try_enter(&guarded_contract, &ep).unwrap().unwrap();
    // Blocked re-entry: returns Err AND emits the event (Err return, not a panic,
    // so the publish is not rolled back).
    let err = client
        .try_enter(&guarded_contract, &ep)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::MaxDepthExceeded);

    let events = env.events().all();
    let last = events.last().unwrap();
    let topics: soroban_sdk::Vec<soroban_sdk::Val> = last.1.clone();
    let name: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
    assert_eq!(name, Symbol::new(&env, "max_depth_exceeded"));
    let topic_contract: Address = topics.get(2).unwrap().try_into_val(&env).unwrap();
    assert_eq!(topic_contract, guarded_contract);
    // data is (entry_point, depth, max_depth)
    let (evt_ep, depth, max_depth): (BytesN<32>, u32, u32) = last.2.try_into_val(&env).unwrap();
    assert_eq!(evt_ep, ep);
    assert_eq!(depth, 1u32);
    assert_eq!(max_depth, 1u32);
}

// ── genuine cross-contract reentrancy via a malicious callback ──────────────
//
// IMPORTANT ENVIRONMENT FACT (recon 3h): the Soroban host itself refuses to let
// a contract that is already on the call stack be invoked again ("Contract
// re-entry is not allowed", Error(Context, InvalidAction)). So the *textbook*
// attack — attacker's callback calls straight back into the victim's own
// function — cannot even execute; the host traps before this guard is consulted
// (see `host_blocks_direct_same_contract_reentry` below).
//
// What this guard still meaningfully protects is the *logical critical section*
// identified by `(guarded_contract, entry_point)` against a re-entry attempt
// routed through a DIFFERENT contract while the victim's section is open. That
// is the scenario modelled here:
//
//   test → Victim::run                         [guard.enter(victim, EP): depth 0→1]
//            → Attacker::callback              (real external call, victim frame open)
//                 → guard.try_enter(victim, EP) [depth 1 ≥ max 1 → MaxDepthExceeded]
//          ← Attacker::callback returns the rejection code
//          Victim::run: guard.exit(victim, EP)  [depth 1→0]
//
// The re-entrant `enter` is a real nested cross-contract invocation, not two
// `enter` calls issued back-to-back from the test.

const SECTION_REENTERED: u32 = 0; // guard let the re-entrant section entry through
const CALLBACK_INVOKE_ERR: u32 = 999; // unexpected non-contract invoke failure

#[contract]
struct Victim;

#[contractimpl]
impl Victim {
    /// Top-level guarded operation: enter the guard for `self`, optionally make
    /// an external call to the attacker (which tries to re-enter the section),
    /// then exit. Returns the attacker's status code, or `SECTION_REENTERED`
    /// when no callback was requested.
    pub fn run(
        env: Env,
        guard: Address,
        attacker: Address,
        entry_point: BytesN<32>,
        trigger_reentrancy: bool,
    ) -> u32 {
        let g = ReentrancyGuardClient::new(&env, &guard);
        let me = env.current_contract_address();

        g.enter(&me, &entry_point);

        let code = if trigger_reentrancy {
            AttackerClient::new(&env, &attacker).callback(&me, &guard, &entry_point)
        } else {
            SECTION_REENTERED
        };

        g.exit(&me, &entry_point);
        code
    }

    /// Used only by `host_blocks_direct_same_contract_reentry` to show the host
    /// stops a literal re-entry into this contract before the guard sees it.
    pub fn run_direct(env: Env, guard: Address, attacker: Address, entry_point: BytesN<32>) -> u32 {
        let g = ReentrancyGuardClient::new(&env, &guard);
        let me = env.current_contract_address();
        g.enter(&me, &entry_point);
        // Attacker will call straight back into Victim::reenter → host trap here.
        let code =
            AttackerClient::new(&env, &attacker).callback_into_victim(&me, &guard, &entry_point);
        g.exit(&me, &entry_point);
        code
    }

    pub fn reenter(env: Env, guard: Address, entry_point: BytesN<32>) -> u32 {
        let g = ReentrancyGuardClient::new(&env, &guard);
        let me = env.current_contract_address();
        match g.try_enter(&me, &entry_point) {
            Ok(_) => {
                g.exit(&me, &entry_point);
                SECTION_REENTERED
            }
            Err(Ok(contract_err)) => contract_err as u32,
            Err(Err(_)) => CALLBACK_INVOKE_ERR,
        }
    }
}

#[contract]
struct Attacker;

#[contractimpl]
impl Attacker {
    /// Invoked by the victim mid-operation. Tries to re-enter the victim's
    /// guarded critical section by calling the guard directly with the victim's
    /// key — the cross-contract re-entry path the guard is meant to stop.
    pub fn callback(env: Env, victim: Address, guard: Address, entry_point: BytesN<32>) -> u32 {
        let g = ReentrancyGuardClient::new(&env, &guard);
        match g.try_enter(&victim, &entry_point) {
            Ok(_) => {
                // Section re-entry was allowed — release it and report.
                g.exit(&victim, &entry_point);
                SECTION_REENTERED
            }
            Err(Ok(contract_err)) => contract_err as u32,
            Err(Err(_)) => CALLBACK_INVOKE_ERR,
        }
    }

    /// Invoked by the victim mid-operation; calls straight back into the victim.
    pub fn callback_into_victim(
        env: Env,
        victim: Address,
        guard: Address,
        entry_point: BytesN<32>,
    ) -> u32 {
        VictimClient::new(&env, &victim).reenter(&guard, &entry_point)
    }
}

/// Sets up the guard (init'd), a Victim and an Attacker, activates the guard for
/// the Victim, and sets `max_call_depth = 1` (strict). Returns everything the
/// tests need.
fn setup_reentrancy_scenario(
    env: &Env,
) -> (
    ReentrancyGuardClient<'_>,
    VictimClient<'_>,
    AttackerClient<'_>,
    Address,
    BytesN<32>,
) {
    let (guard, admin) = setup_contract(env);

    let victim_id = env.register(Victim, ());
    let victim = VictimClient::new(env, &victim_id);
    let attacker_id = env.register(Attacker, ());
    let attacker = AttackerClient::new(env, &attacker_id);

    let entry_point = create_entry_point(env, "withdraw");

    guard
        .try_set_max_call_depth(&admin, &1u32)
        .unwrap()
        .unwrap();
    guard
        .try_activate_guard(&admin, &victim_id)
        .unwrap()
        .unwrap();

    (guard, victim, attacker, victim_id, entry_point)
}

#[test]
fn host_blocks_direct_same_contract_reentry() {
    // Establishes the environment fact the malicious-callback test is designed
    // around: a literal re-entry into a contract already on the stack traps at
    // the host, never reaching this guard's logic.
    let env = Env::default();
    let (guard, victim, attacker, _victim_id, entry_point) = setup_reentrancy_scenario(&env);

    let res = victim.try_run_direct(&guard.address, &attacker.address, &entry_point);
    assert!(
        res.is_err(),
        "host must reject a direct re-entrant call into the victim"
    );
}

#[test]
fn reentrancy_blocked_via_malicious_callback() {
    let env = Env::default();
    let (guard, victim, attacker, victim_id, entry_point) = setup_reentrancy_scenario(&env);

    let code = victim.run(
        &guard.address,
        &attacker.address,
        &entry_point,
        &true, // fire the malicious callback
    );

    // The re-entrant section entry was rejected with exactly MaxDepthExceeded
    // (discriminant 4) — not allowed through, not an opaque invoke failure.
    assert_eq!(code, ContractError::MaxDepthExceeded as u32);
    assert_ne!(code, SECTION_REENTERED);
    assert_ne!(code, CALLBACK_INVOKE_ERR);

    // The outer (legitimate) call still completed and the guard was released.
    assert_eq!(guard.get_call_depth(&victim_id, &entry_point), 0u32);
}

#[test]
fn guard_released_after_blocked_reentrancy() {
    let env = Env::default();
    let (guard, victim, attacker, victim_id, entry_point) = setup_reentrancy_scenario(&env);

    // First: an attack that gets blocked.
    let blocked = victim.run(&guard.address, &attacker.address, &entry_point, &true);
    assert_eq!(blocked, ContractError::MaxDepthExceeded as u32);
    assert_eq!(guard.get_call_depth(&victim_id, &entry_point), 0u32);

    // The guard must NOT be stuck engaged: a subsequent legitimate (non-reentrant)
    // call through the same section still succeeds and releases cleanly.
    let clean = victim.run(&guard.address, &attacker.address, &entry_point, &false);
    assert_eq!(clean, SECTION_REENTERED); // no callback fired => no rejection code
    assert_eq!(guard.get_call_depth(&victim_id, &entry_point), 0u32);

    // And an attack is still blocked the second time around.
    let blocked_again = victim.run(&guard.address, &attacker.address, &entry_point, &true);
    assert_eq!(blocked_again, ContractError::MaxDepthExceeded as u32);
    assert_eq!(guard.get_call_depth(&victim_id, &entry_point), 0u32);
}

#[test]
fn guard_released_after_successful_call() {
    let env = Env::default();
    let (guard, victim, attacker, victim_id, entry_point) = setup_reentrancy_scenario(&env);

    // A normal, non-reentrant guarded call: enter -> work -> exit.
    let code = victim.run(&guard.address, &attacker.address, &entry_point, &false);
    assert_eq!(code, SECTION_REENTERED);
    assert_eq!(guard.get_call_depth(&victim_id, &entry_point), 0u32);

    // It can be run again immediately — the previous exit released the section.
    let code2 = victim.run(&guard.address, &attacker.address, &entry_point, &false);
    assert_eq!(code2, SECTION_REENTERED);
    assert_eq!(guard.get_call_depth(&victim_id, &entry_point), 0u32);
}

#[test]
fn default_depth_lets_cross_contract_section_reentry_through() {
    // OBSERVED-BEHAVIOUR ONLY (see ambiguous-behaviour note #1): with the default
    // max_call_depth of 5 the very same malicious callback that is blocked under
    // max_call_depth = 1 is allowed to re-enter the section (depth 1 < 5). This
    // test documents the effect of the default; it asserts nothing about whether
    // the default is the intended one.
    let env = Env::default();
    let (guard, _admin) = setup_contract(&env);
    let victim_id = env.register(Victim, ());
    let victim = VictimClient::new(&env, &victim_id);
    let attacker_id = env.register(Attacker, ());
    let attacker = AttackerClient::new(&env, &attacker_id);
    let entry_point = create_entry_point(&env, "withdraw");

    // Guard active, but max_call_depth left at its default of 5.
    guard
        .try_activate_guard(&_admin, &victim_id)
        .unwrap()
        .unwrap();
    assert_eq!(guard.get_max_call_depth(), 5u32);

    let code = victim.run(&guard.address, &attacker.address, &entry_point, &true);
    assert_eq!(
        code, SECTION_REENTERED,
        "under the default depth of 5 the section re-entry is NOT blocked"
    );
    // Guard still balances back to 0 afterwards.
    assert_eq!(guard.get_call_depth(&victim_id, &entry_point), 0u32);
}
