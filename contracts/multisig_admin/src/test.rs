use crate::{Error, MultisigAdmin, MultisigAdminClient, ProposalStatus};
use soroban_pausable::{PausableError, TestPausableContract, TestPausableContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address, Env, IntoVal, Symbol, Val, Vec,
};

fn setup_multisig<'a>(
    env: &'a Env,
    num_signers: u32,
    threshold: u32,
) -> (Vec<Address>, MultisigAdminClient<'a>, Address) {
    let mut signers = Vec::new(env);
    for _ in 0..num_signers {
        signers.push_back(Address::generate(env));
    }
    let contract_id = env.register(MultisigAdmin, ());
    let client = MultisigAdminClient::new(env, &contract_id);
    client.init(&signers, &threshold);
    (signers, client, contract_id)
}

#[test]
fn test_init_validation() {
    let env = Env::default();
    env.mock_all_auths();

    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);

    let contract_id = env.register(MultisigAdmin, ());
    let client = MultisigAdminClient::new(&env, &contract_id);

    // Duplicate signers rejected
    let dups = vec![&env, s1.clone(), s1.clone()];
    assert_eq!(client.try_init(&dups, &1), Err(Ok(Error::DuplicateSigner)));

    // Threshold = 0 rejected
    let signers = vec![&env, s1.clone(), s2.clone()];
    assert_eq!(
        client.try_init(&signers, &0),
        Err(Ok(Error::InvalidThreshold))
    );

    // Threshold > signers.len() rejected
    assert_eq!(
        client.try_init(&signers, &3),
        Err(Ok(Error::InvalidThreshold))
    );

    // Valid init
    client.init(&signers, &2);
    assert_eq!(client.get_threshold(), 2);
    assert_eq!(client.get_signers().len(), 2);

    // Cannot re-init
    assert_eq!(
        client.try_init(&signers, &2),
        Err(Ok(Error::AlreadyInitialized))
    );
}

#[test]
fn test_threshold_reached_and_not_reached_and_execution() {
    let env = Env::default();
    env.mock_all_auths();

    let (signers, client, _) = setup_multisig(&env, 3, 2);
    let s1 = signers.get(0).unwrap();
    let s2 = signers.get(1).unwrap();
    let non_signer = Address::generate(&env);

    // Non-signer cannot propose
    let dummy_target = Address::generate(&env);
    let func = Symbol::new(&env, "dummy");
    let args = Vec::new(&env);
    assert_eq!(
        client.try_propose(&non_signer, &dummy_target, &func, &args),
        Err(Ok(Error::NotSigner))
    );

    // s1 proposes -> proposal_id 1 with 1 approval (s1)
    let prop_id = client.propose(&s1, &dummy_target, &func, &args);
    assert_eq!(prop_id, 1);

    let p = client.get_proposal(&prop_id);
    assert_eq!(p.approvals.len(), 1);
    assert_eq!(p.status, ProposalStatus::Pending);

    // Try executing with only 1 approval when threshold is 2 -> ThresholdNotReached
    assert!(matches!(
        client.try_execute(&s1, &prop_id),
        Err(Ok(Error::ThresholdNotReached))
    ));

    // s1 tries double approval -> AlreadyApproved
    assert_eq!(
        client.try_approve(&s1, &prop_id),
        Err(Ok(Error::AlreadyApproved))
    );

    // s2 approves -> approvals reaches 2
    client.approve(&s2, &prop_id);
    let p = client.get_proposal(&prop_id);
    assert_eq!(p.approvals.len(), 2);

    // Non-signer cannot execute
    assert!(matches!(
        client.try_execute(&non_signer, &prop_id),
        Err(Ok(Error::NotSigner))
    ));
}

#[test]
fn test_revoke_dropping_below_threshold() {
    let env = Env::default();
    env.mock_all_auths();

    let (signers, client, _) = setup_multisig(&env, 3, 2);
    let s1 = signers.get(0).unwrap();
    let s2 = signers.get(1).unwrap();
    let dummy_target = Address::generate(&env);

    let prop_id = client.propose(
        &s1,
        &dummy_target,
        &Symbol::new(&env, "dummy"),
        &Vec::new(&env),
    );
    client.approve(&s2, &prop_id);

    let p = client.get_proposal(&prop_id);
    assert_eq!(p.approvals.len(), 2);

    // s2 revokes approval
    client.revoke_approval(&s2, &prop_id);
    let p = client.get_proposal(&prop_id);
    assert_eq!(p.approvals.len(), 1);

    // Execution fails now
    assert!(matches!(
        client.try_execute(&s1, &prop_id),
        Err(Ok(Error::ThresholdNotReached))
    ));

    // Revoking again fails
    assert_eq!(
        client.try_revoke_approval(&s2, &prop_id),
        Err(Ok(Error::NotApproved))
    );
}

#[test]
fn test_proposal_expiry_and_reexecution_rejection() {
    let env = Env::default();
    env.mock_all_auths();

    let (signers, client, _) = setup_multisig(&env, 2, 1);
    let s1 = signers.get(0).unwrap();
    let dummy_target = Address::generate(&env);

    let prop_id = client.propose(
        &s1,
        &dummy_target,
        &Symbol::new(&env, "dummy"),
        &Vec::new(&env),
    );

    // Fast-forward time past proposal TTL (604,800 + 10s)
    let cur_time = env.ledger().timestamp();
    env.ledger().set_timestamp(cur_time + 604_810);

    // Proposal status is now expired
    let p = client.get_proposal(&prop_id);
    assert_eq!(p.status, ProposalStatus::Expired);

    // Executing expired proposal fails
    assert!(matches!(
        client.try_execute(&s1, &prop_id),
        Err(Ok(Error::ProposalExpired))
    ));

    // Approving expired proposal fails
    assert_eq!(
        client.try_approve(&s1, &prop_id),
        Err(Ok(Error::ProposalExpired))
    );
}

#[test]
fn test_real_cross_contract_call_pausing_contract() {
    let env = Env::default();
    env.mock_all_auths();

    let (signers, multisig_client, multisig_address) = setup_multisig(&env, 3, 2);
    let s1 = signers.get(0).unwrap();
    let s2 = signers.get(1).unwrap();

    // Register a TestPausableContract with multisig as admin!
    let pausable_id = env.register(TestPausableContract, ());
    let pausable_client = TestPausableContractClient::new(&env, &pausable_id);
    pausable_client.init(&multisig_address);

    assert!(!pausable_client.is_paused());

    // Multisig proposes to call pause(&multisig_address) on pausable contract
    let func = Symbol::new(&env, "pause");
    let mut args = Vec::new(&env);
    args.push_back(multisig_address.into_val(&env));

    let prop_id = multisig_client.propose(&s1, &pausable_id, &func, &args);
    multisig_client.approve(&s2, &prop_id);

    // Execute proposal
    multisig_client.execute(&s1, &prop_id);

    // The pausable contract is now paused!
    assert!(pausable_client.is_paused());

    // Cannot re-execute already executed proposal
    assert!(matches!(
        multisig_client.try_execute(&s1, &prop_id),
        Err(Ok(Error::AlreadyExecuted))
    ));
}

#[test]
fn test_self_targeting_proposal_to_change_signers_and_threshold() {
    let env = Env::default();
    env.mock_all_auths();

    let (signers, multisig_client, multisig_address) = setup_multisig(&env, 2, 2);
    let s1 = signers.get(0).unwrap();
    let s2 = signers.get(1).unwrap();
    let s3 = Address::generate(&env);

    // Direct invocation fails because require_auth() checks for self address
    let new_signers = vec![&env, s1.clone(), s2.clone(), s3.clone()];
    // Trying direct call from external caller fails authorization:
    // We test proposing change_signers via multisig:
    let func = Symbol::new(&env, "change_signers");
    let mut args = Vec::new(&env);
    args.push_back(new_signers.into_val(&env));

    let prop_id = multisig_client.propose(&s1, &multisig_address, &func, &args);
    multisig_client.approve(&s2, &prop_id);
    multisig_client.execute(&s1, &prop_id);

    // Now signers has 3 members
    assert_eq!(multisig_client.get_signers().len(), 3);

    // Next, change threshold to 3 via self proposal
    let thresh_func = Symbol::new(&env, "change_threshold");
    let mut thresh_args = Vec::new(&env);
    let val_3: Val = 3u32.into_val(&env);
    thresh_args.push_back(val_3);

    let prop_id2 = multisig_client.propose(&s1, &multisig_address, &thresh_func, &thresh_args);
    multisig_client.approve(&s2, &prop_id2);
    multisig_client.execute(&s1, &prop_id2);

    assert_eq!(multisig_client.get_threshold(), 3);
}

#[test]
fn test_cancel_proposals() {
    let env = Env::default();
    env.mock_all_auths();

    let (signers, client, _) = setup_multisig(&env, 3, 2);
    let s1 = signers.get(0).unwrap();
    let s2 = signers.get(1).unwrap();
    let s3 = signers.get(2).unwrap();
    let dummy = Address::generate(&env);

    // Proposer cancels directly
    let prop_1 = client.propose(&s1, &dummy, &Symbol::new(&env, "d"), &Vec::new(&env));
    client.cancel(&s1, &prop_1);
    assert_eq!(
        client.get_proposal(&prop_1).status,
        ProposalStatus::Cancelled
    );

    // Proposer 1 proposes, s2 votes to cancel (threshold is 2)
    let prop_2 = client.propose(&s1, &dummy, &Symbol::new(&env, "d"), &Vec::new(&env));
    client.cancel(&s2, &prop_2);
    // Not cancelled yet with 1 cancel vote
    assert_eq!(client.get_proposal(&prop_2).status, ProposalStatus::Pending);

    // s3 also votes to cancel -> reached threshold of 2 signers
    client.cancel(&s3, &prop_2);
    assert_eq!(
        client.get_proposal(&prop_2).status,
        ProposalStatus::Cancelled
    );
}

#[test]
fn test_list_proposals_filter() {
    let env = Env::default();
    env.mock_all_auths();

    let (signers, client, _) = setup_multisig(&env, 2, 1);
    let s1 = signers.get(0).unwrap();
    let dummy = Address::generate(&env);

    let p1 = client.propose(&s1, &dummy, &Symbol::new(&env, "f1"), &Vec::new(&env));
    let p2 = client.propose(&s1, &dummy, &Symbol::new(&env, "f2"), &Vec::new(&env));

    client.cancel(&s1, &p1);

    let all = client.list_proposals(&None);
    assert_eq!(all.len(), 2);

    let cancelled = client.list_proposals(&Some(ProposalStatus::Cancelled));
    assert_eq!(cancelled.len(), 1);
    assert_eq!(cancelled.get(0).unwrap(), p1);

    let pending = client.list_proposals(&Some(ProposalStatus::Pending));
    assert_eq!(pending.len(), 1);
    assert_eq!(pending.get(0).unwrap(), p2);
}

#[test]
fn test_multisig_pausable() {
    let env = Env::default();
    env.mock_all_auths();

    let (signers, client, _) = setup_multisig(&env, 2, 1);
    let s1 = signers.get(0).unwrap();
    let non_signer = Address::generate(&env);

    assert_eq!(
        client.try_pause(&non_signer),
        Err(Ok(PausableError::NotAuthorized))
    );

    client.pause(&s1);
    assert!(client.is_paused());

    let dummy = Address::generate(&env);
    assert_eq!(
        client.try_propose(&s1, &dummy, &Symbol::new(&env, "x"), &Vec::new(&env)),
        Err(Ok(Error::Paused))
    );

    client.unpause(&s1);
    assert!(!client.is_paused());
}

/// Ledgers advanced in the TTL test. This is beyond the test environment's default
/// 4,096-ledger minimum persistent TTL, so an entry that was never extended expires, and
/// it is below the 500,000-ledger extension the contract applies.
const TTL_TEST_LEDGER_JUMP: u32 = 100_000;

#[test]
fn signers_threshold_and_proposals_survive_ledger_jump_past_default_ttl() {
    let env = Env::default();
    env.mock_all_auths();
    let (signers, client, _contract_id) = setup_multisig(&env, 2, 2);

    let target = Address::generate(&env);
    let function = Symbol::new(&env, "noop");
    let proposal_id = client.propose(
        &signers.get(0).unwrap(),
        &target,
        &function,
        &Vec::new(&env),
    );

    env.ledger()
        .with_mut(|li| li.sequence_number += TTL_TEST_LEDGER_JUMP);

    // Signer set and threshold (instance storage) survive the jump unchanged.
    assert_eq!(client.get_signers(), signers);
    assert_eq!(client.get_threshold(), 2);
    assert!(client.is_signer(&signers.get(1).unwrap()));

    // The proposal (persistent storage) is still readable. The timestamp has not moved,
    // so it has not expired and is still pending with its original approval.
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Pending);
    assert_eq!(proposal.approvals.len(), 1);

    // It can still be approved to the threshold after the jump.
    client.approve(&signers.get(1).unwrap(), &proposal_id);
    assert_eq!(client.get_proposal(&proposal_id).approvals.len(), 2);
}
