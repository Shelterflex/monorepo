//! # contract_access — Role-Based Access Control (RBAC) for Soroban contracts
//!
//! Provides a permission matrix keyed by `Role` covering every contract
//! operation.  Role assignment, revocation, multi-sig guards, and audit events
//! are all handled here so individual contracts only need to call
//! `require_permission(&env, caller, Permission::X)?`.
//!
//! ## Roles
//! | Role     | Typical capabilities                                       |
//! |----------|---------------------------------------------------------------|
//! | Admin    | Full access, role management, pause/unpause                |
//! | Operator | Execute business operations (transfer, stake, …)          |
//! | User     | Self-service operations (own balance, own stake, …)       |
//! | Auditor  | Read-only access to state and event history               |
//!
//! ## Multi-sig
//! Critical operations (role assignment / revocation, contract upgrade) are
//! guarded by `require_multisig`: both the *current admin* and a *second
//! approver* stored under `DataKey::SecondApprover` must authorise the call.
//!
//! ## Delegation
//! An address may delegate a specific permission to another address via
//! `delegate_permission`.  The delegated permission does **not** grant the
//! delegatee a role — it only allows them to pass `require_permission` checks
//! for that one permission.  Delegations can be revoked at any time by the
//! original admin.
//!
//! ## Closes: #383

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Env, Map, Symbol, Vec,
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/// The four roles supported by this access-control framework.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, PartialOrd, Ord, Copy)]
#[repr(u32)]
pub enum Role {
    Admin = 0,
    Operator = 1,
    User = 2,
    Auditor = 3,
}

/// All permissions that can be granted to a role.  Add new variants here as
/// contracts grow; the `permission_matrix` function maps each role to its
/// allowed set.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, PartialOrd, Ord, Copy)]
#[repr(u32)]
pub enum Permission {
    // ── Core ──────────────────────────────────────────────────────────────
    /// Initialize the contract
    Initialize = 0,
    /// Pause / unpause contract operations
    PauseContract = 1,
    /// Upgrade contract WASM (requires multi-sig)
    UpgradeContract = 2,

    // ── Role management (requires multi-sig) ───────────────────────────
    AssignRole = 3,
    RevokeRole = 4,
    TransferAdmin = 5,

    // ── Fund operations ────────────────────────────────────────────────
    /// Credit / mint funds to a user
    CreditFunds = 6,
    /// Debit / burn funds from a user
    DebitFunds = 7,
    /// Transfer funds between accounts
    TransferFunds = 8,

    // ── Staking operations ────────────────────────────────────────────
    Stake = 9,
    Unstake = 10,
    SetLockPeriod = 11,

    // ── Audit / read ──────────────────────────────────────────────────
    ReadBalance = 12,
    ReadAuditLog = 13,

    // ── Delegation ────────────────────────────────────────────────────
    /// Delegate a permission to another address
    DelegatePermission = 14,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub struct DelegationInfo {
    pub delegator: Address,
    pub permission: Permission,
}

/// Storage keys for the access-control module.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// admin address
    Admin,
    /// second approver for multi-sig critical ops
    SecondApprover,
    /// role map: Address → Role (one role per address)
    Roles,
    /// pending multi-sig proposals: (proposer, Permission) → bool
    Proposals,
    /// delegation map: delegatee Address → DelegationInfo
    Delegations,
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum AccessError {
    /// Caller does not hold a role that grants the requested permission
    Unauthorized = 1,
    /// Multi-sig second approver has not yet confirmed
    AwaitingApproval = 2,
    /// Contract already initialised
    AlreadyInitialized = 3,
    /// Tried to revoke the last admin — would lock the contract
    CannotRevokeLastAdmin = 4,
    /// Second approver not configured for multi-sig operations
    NoSecondApprover = 5,
    /// No delegation found to revoke
    NoDelegationFound = 6,
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<_, Address>(&DataKey::Admin)
        .expect("admin not set")
}

fn roles_map(env: &Env) -> Map<Address, Role> {
    env.storage()
        .instance()
        .get::<_, Map<Address, Role>>(&DataKey::Roles)
        .unwrap_or_else(|| Map::new(env))
}

fn put_roles(env: &Env, roles: Map<Address, Role>) {
    env.storage().instance().set(&DataKey::Roles, &roles);
}

fn proposals_map(env: &Env) -> Map<Address, u32> {
    env.storage()
        .instance()
        .get::<_, Map<Address, u32>>(&DataKey::Proposals)
        .unwrap_or_else(|| Map::new(env))
}

fn put_proposals(env: &Env, p: Map<Address, u32>) {
    env.storage().instance().set(&DataKey::Proposals, &p);
}

/// Returns all permissions granted to `role`.
fn permission_matrix(role: Role) -> &'static [Permission] {
    match role {
        Role::Admin => &[
            Permission::Initialize,
            Permission::PauseContract,
            Permission::UpgradeContract,
            Permission::AssignRole,
            Permission::RevokeRole,
            Permission::TransferAdmin,
            Permission::CreditFunds,
            Permission::DebitFunds,
            Permission::TransferFunds,
            Permission::Stake,
            Permission::Unstake,
            Permission::SetLockPeriod,
            Permission::ReadBalance,
            Permission::ReadAuditLog,
            Permission::DelegatePermission,
        ],
        Role::Operator => &[
            Permission::CreditFunds,
            Permission::DebitFunds,
            Permission::TransferFunds,
            Permission::Stake,
            Permission::Unstake,
            Permission::ReadBalance,
            Permission::ReadAuditLog,
        ],
        Role::User => &[
            Permission::Stake,
            Permission::Unstake,
            Permission::ReadBalance,
        ],
        Role::Auditor => &[Permission::ReadBalance, Permission::ReadAuditLog],
    }
}

fn role_has_permission(role: Role, perm: Permission) -> bool {
    permission_matrix(role).contains(&perm)
}

/// Check if an address has a delegated permission and if the delegator still holds it.
fn has_delegation(env: &Env, delegatee: &Address, perm: Permission) -> bool {
    let delegations: Map<Address, DelegationInfo> = env
        .storage()
        .instance()
        .get(&DataKey::Delegations)
        .unwrap_or_else(|| Map::new(env));

    if let Some(info) = delegations.get(delegatee.clone()) {
        if info.permission == perm {
            // Delegation is valid only if the delegator still has the permission
            return has_permission_internal(env, &info.delegator, perm);
        }
    }
    false
}

/// Internal check for permission without recursion via delegations.
fn has_permission_internal(env: &Env, addr: &Address, permission: Permission) -> bool {
    let roles = roles_map(env);
    if let Some(role) = roles.get(addr.clone()) {
        if role_has_permission(role, permission) {
            return true;
        }
    }
    false
}

/// Emit an audit event for every permission change.
fn emit_audit(env: &Env, action: &str, subject: &Address, detail: u32) {
    env.events().publish(
        (
            Symbol::new(env, "access_control"),
            Symbol::new(env, action),
            subject.clone(),
        ),
        detail,
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Public interface
// ─────────────────────────────────────────────────────────────────────────────

#[contract]
pub struct AccessControl;

#[contractimpl]
impl AccessControl {
    // ── Initialisation ───────────────────────────────────────────────────────

    /// Initialise the access-control contract with `admin` as the first
    /// Admin-role holder and `second_approver` as the multi-sig co-signer.
    pub fn init(env: Env, admin: Address, second_approver: Address) -> Result<(), AccessError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(AccessError::AlreadyInitialized);
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::SecondApprover, &second_approver);

        let mut roles = Map::new(&env);
        roles.set(admin.clone(), Role::Admin);
        put_roles(&env, roles);

        emit_audit(&env, "init", &admin, Role::Admin as u32);
        Ok(())
    }

    // ── Role assignment / revocation (multi-sig required) ───────────────────

    /// Propose assigning `role` to `subject`.  The admin calls this first;
    /// then `second_approver` calls `confirm_assign_role` to finalise.
    pub fn propose_assign_role(
        env: Env,
        admin: Address,
        subject: Address,
        role: Role,
    ) -> Result<(), AccessError> {
        admin.require_auth();
        let current_admin = get_admin(&env);
        if admin != current_admin {
            return Err(AccessError::Unauthorized);
        }

        let mut proposals = proposals_map(&env);
        // encode (subject, role) as a single u32 key for simplicity
        let key_addr = subject.clone();
        proposals.set(key_addr, role as u32);
        put_proposals(&env, proposals);

        emit_audit(&env, "propose_assign", &subject, role as u32);
        Ok(())
    }

    /// Second approver confirms the pending role assignment for `subject`.
    pub fn confirm_assign_role(
        env: Env,
        approver: Address,
        subject: Address,
    ) -> Result<(), AccessError> {
        approver.require_auth();

        let second: Address = env
            .storage()
            .instance()
            .get(&DataKey::SecondApprover)
            .ok_or(AccessError::NoSecondApprover)?;

        if approver != second {
            return Err(AccessError::Unauthorized);
        }

        let mut proposals = proposals_map(&env);
        let role_u32 = proposals
            .get(subject.clone())
            .ok_or(AccessError::AwaitingApproval)?;

        let role = match role_u32 {
            0 => Role::Admin,
            1 => Role::Operator,
            2 => Role::User,
            _ => Role::Auditor,
        };

        proposals.remove(subject.clone());
        put_proposals(&env, proposals);

        let mut roles = roles_map(&env);
        roles.set(subject.clone(), role);
        put_roles(&env, roles);

        emit_audit(&env, "assign_role", &subject, role as u32);
        Ok(())
    }

    /// Revoke the role of `subject`.  Admin proposes; second approver confirms
    /// via `confirm_revoke_role`.  Prevents revoking the last Admin.
    pub fn propose_revoke_role(
        env: Env,
        admin: Address,
        subject: Address,
    ) -> Result<(), AccessError> {
        admin.require_auth();
        let current_admin = get_admin(&env);
        if admin != current_admin {
            return Err(AccessError::Unauthorized);
        }

        // Guard: cannot revoke yourself if you're the only admin
        let roles = roles_map(&env);
        let admin_count = roles.iter().filter(|(_, r)| r == &Role::Admin).count();

        if roles.get(subject.clone()) == Some(Role::Admin) && admin_count <= 1 {
            return Err(AccessError::CannotRevokeLastAdmin);
        }

        // Re-use proposals map with u32::MAX as sentinel for revocation
        let mut proposals = proposals_map(&env);
        proposals.set(subject.clone(), u32::MAX);
        put_proposals(&env, proposals);

        emit_audit(&env, "propose_revoke", &subject, 0);
        Ok(())
    }

    /// Second approver confirms revocation.
    pub fn confirm_revoke_role(
        env: Env,
        approver: Address,
        subject: Address,
    ) -> Result<(), AccessError> {
        approver.require_auth();

        let second: Address = env
            .storage()
            .instance()
            .get(&DataKey::SecondApprover)
            .ok_or(AccessError::NoSecondApprover)?;

        if approver != second {
            return Err(AccessError::Unauthorized);
        }

        let mut proposals = proposals_map(&env);
        let sentinel = proposals
            .get(subject.clone())
            .ok_or(AccessError::AwaitingApproval)?;

        if sentinel != u32::MAX {
            return Err(AccessError::AwaitingApproval);
        }

        proposals.remove(subject.clone());
        put_proposals(&env, proposals);

        let mut roles = roles_map(&env);
        roles.remove(subject.clone());
        put_roles(&env, roles);

        emit_audit(&env, "revoke_role", &subject, 0);
        Ok(())
    }

    // ── Delegation ───────────────────────────────────────────────────────────

    /// Delegate a specific `permission` to `delegatee`.  The `delegator` must
    /// hold the permission they are delegating.
    pub fn delegate_permission(
        env: Env,
        delegator: Address,
        delegatee: Address,
        permission: Permission,
    ) -> Result<(), AccessError> {
        delegator.require_auth();
        if !Self::has_permission(env.clone(), delegator.clone(), permission) {
            return Err(AccessError::Unauthorized);
        }

        let mut delegations: Map<Address, DelegationInfo> = env
            .storage()
            .instance()
            .get(&DataKey::Delegations)
            .unwrap_or_else(|| Map::new(&env));

        delegations.set(
            delegatee.clone(),
            DelegationInfo {
                delegator,
                permission,
            },
        );
        env.storage()
            .instance()
            .set(&DataKey::Delegations, &delegations);

        emit_audit(&env, "delegate_perm", &delegatee, permission as u32);
        Ok(())
    }

    /// Revoke a previously granted delegation from `delegatee`.
    /// Can be called by the admin or the original delegator.
    pub fn revoke_delegation(
        env: Env,
        caller: Address,
        delegatee: Address,
    ) -> Result<(), AccessError> {
        caller.require_auth();

        let mut delegations: Map<Address, DelegationInfo> = env
            .storage()
            .instance()
            .get(&DataKey::Delegations)
            .unwrap_or_else(|| Map::new(&env));

        let info = delegations
            .get(delegatee.clone())
            .ok_or(AccessError::NoDelegationFound)?;

        let current_admin = get_admin(&env);
        if caller != current_admin && caller != info.delegator {
            return Err(AccessError::Unauthorized);
        }

        delegations.remove(delegatee.clone());
        env.storage()
            .instance()
            .set(&DataKey::Delegations, &delegations);

        emit_audit(&env, "revoke_delegation", &delegatee, 0);
        Ok(())
    }

    // ── Permission check ─────────────────────────────────────────────────────

    /// Returns `Ok(())` if `caller` holds a role that includes `permission`
    /// OR has been explicitly delegated that permission,
    /// otherwise `Err(AccessError::Unauthorized)`.
    ///
    /// Call this from any contract function that needs access control:
    /// ```ignore
    /// AccessControlClient::new(&env, &access_contract_id)
    ///     .require_permission(&caller, &Permission::CreditFunds)?;
    /// ```
    pub fn require_permission(
        env: Env,
        caller: Address,
        permission: Permission,
    ) -> Result<(), AccessError> {
        caller.require_auth();

        if Self::has_permission(env, caller, permission) {
            Ok(())
        } else {
            Err(AccessError::Unauthorized)
        }
    }

    // ── Queries ──────────────────────────────────────────────────────────────

    /// Returns the `Role` assigned to `addr`, or `None`.
    pub fn get_role(env: Env, addr: Address) -> Option<Role> {
        roles_map(&env).get(addr)
    }

    /// Returns `true` if `addr` has `permission` (via role or delegation).
    pub fn has_permission(env: Env, addr: Address, permission: Permission) -> bool {
        if has_permission_internal(&env, &addr, permission) {
            return true;
        }
        has_delegation(&env, &addr, permission)
    }

    /// Returns the delegated permission for `addr`, if any.
    pub fn get_delegation(env: Env, addr: Address) -> Option<Permission> {
        let delegations: Map<Address, DelegationInfo> = env
            .storage()
            .instance()
            .get(&DataKey::Delegations)
            .unwrap_or_else(|| Map::new(&env));

        delegations.get(addr).map(|info| info.permission)
    }

    /// Returns all addresses with assigned roles as (Address, Role) pairs.
    pub fn list_roles(env: Env) -> Vec<(Address, Role)> {
        let roles = roles_map(&env);
        let mut out = Vec::new(&env);
        for (addr, role) in roles.iter() {
            out.push_back((addr, role));
        }
        out
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events, MockAuth, MockAuthInvoke},
        Address, Env, IntoVal, TryIntoVal,
    };

    fn setup(env: &Env) -> (Address, Address, Address, AccessControlClient<'_>) {
        let contract_id = env.register(AccessControl, ());
        let client = AccessControlClient::new(env, &contract_id);
        let admin = Address::generate(env);
        let approver = Address::generate(env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "init",
                args: (admin.clone(), approver.clone()).into_val(env),
                sub_invokes: &[],
            },
        }]);
        client.try_init(&admin, &approver).unwrap().unwrap();

        (contract_id, admin, approver, client)
    }

    /// Run the full two-step (propose + confirm) assignment of `role` to
    /// `subject`.  Mirrors the inline pattern used by the pre-existing tests.
    fn assign_role(
        env: &Env,
        contract_id: &Address,
        client: &AccessControlClient<'_>,
        admin: &Address,
        approver: &Address,
        subject: &Address,
        role: Role,
    ) {
        env.mock_auths(&[MockAuth {
            address: admin,
            invoke: &MockAuthInvoke {
                contract: contract_id,
                fn_name: "propose_assign_role",
                args: (admin.clone(), subject.clone(), role).into_val(env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_propose_assign_role(admin, subject, &role)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: approver,
            invoke: &MockAuthInvoke {
                contract: contract_id,
                fn_name: "confirm_assign_role",
                args: (approver.clone(), subject.clone()).into_val(env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_confirm_assign_role(approver, subject)
            .unwrap()
            .unwrap();
    }

    /// Search the events published by the most recent contract invocation for an
    /// audit event with topics `(Symbol "access_control", Symbol `action`,
    /// <subject Address>)` and return `(subject, detail_u32)`.  `emit_audit` is
    /// the only event source in this contract, so every event has exactly three
    /// topics and a `u32` body.
    ///
    /// NOTE: `Events::all()` only exposes the *last* invocation's events, so
    /// callers must assert immediately after the emitting call — before any
    /// other client call (queries included) clears the buffer.
    fn find_audit_event(env: &Env, action: &str) -> Option<(Address, u32)> {
        let all = env.events().all();
        for i in (0..all.len()).rev() {
            let (_cid, topics, data) = all.get(i).unwrap();
            if topics.len() != 3 {
                continue;
            }
            let t0: Result<Symbol, _> = topics.get(0).unwrap().try_into_val(env);
            let t1: Result<Symbol, _> = topics.get(1).unwrap().try_into_val(env);
            match (t0, t1) {
                (Ok(a), Ok(b))
                    if a == Symbol::new(env, "access_control") && b == Symbol::new(env, action) =>
                {
                    let subject: Address = topics.get(2).unwrap().try_into_val(env).ok()?;
                    let detail: u32 = data.try_into_val(env).ok()?;
                    return Some((subject, detail));
                }
                _ => {}
            }
        }
        None
    }

    // ── init ─────────────────────────────────────────────────────────────────

    #[test]
    fn init_sets_admin_role() {
        let env = Env::default();
        let (_id, admin, _approver, client) = setup(&env);
        assert_eq!(client.get_role(&admin), Some(Role::Admin));
    }

    #[test]
    fn double_init_fails() {
        let env = Env::default();
        let (contract_id, admin, approver, client) = setup(&env);
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "init",
                args: (admin.clone(), approver.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_init(&admin, &approver);
        assert_eq!(
            result.unwrap_err().unwrap(),
            AccessError::AlreadyInitialized
        );
    }

    // ── permission matrix ─────────────────────────────────────────────────────

    #[test]
    fn admin_has_all_permissions() {
        let env = Env::default();
        let (_id, admin, _approver, client) = setup(&env);

        for perm in [
            Permission::Initialize,
            Permission::PauseContract,
            Permission::CreditFunds,
            Permission::DebitFunds,
            Permission::Stake,
            Permission::ReadAuditLog,
        ] {
            assert!(
                client.has_permission(&admin, &perm),
                "admin should have {perm:?}"
            );
        }
    }

    #[test]
    fn auditor_can_only_read() {
        let env = Env::default();
        let (contract_id, admin, approver, client) = setup(&env);

        let auditor = Address::generate(&env);

        // propose
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_assign_role",
                args: (admin.clone(), auditor.clone(), Role::Auditor).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_propose_assign_role(&admin, &auditor, &Role::Auditor)
            .unwrap()
            .unwrap();

        // confirm
        env.mock_auths(&[MockAuth {
            address: &approver,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "confirm_assign_role",
                args: (approver.clone(), auditor.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_confirm_assign_role(&approver, &auditor)
            .unwrap()
            .unwrap();

        assert_eq!(client.get_role(&auditor), Some(Role::Auditor));
        assert!(client.has_permission(&auditor, &Permission::ReadBalance));
        assert!(client.has_permission(&auditor, &Permission::ReadAuditLog));
        assert!(!client.has_permission(&auditor, &Permission::CreditFunds));
        assert!(!client.has_permission(&auditor, &Permission::Stake));
        assert!(!client.has_permission(&auditor, &Permission::PauseContract));
    }

    #[test]
    fn user_role_permissions() {
        let env = Env::default();
        let (contract_id, admin, approver, client) = setup(&env);
        let user = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_assign_role",
                args: (admin.clone(), user.clone(), Role::User).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_propose_assign_role(&admin, &user, &Role::User)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &approver,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "confirm_assign_role",
                args: (approver.clone(), user.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_confirm_assign_role(&approver, &user)
            .unwrap()
            .unwrap();

        assert!(client.has_permission(&user, &Permission::Stake));
        assert!(client.has_permission(&user, &Permission::Unstake));
        assert!(client.has_permission(&user, &Permission::ReadBalance));
        assert!(!client.has_permission(&user, &Permission::CreditFunds));
        assert!(!client.has_permission(&user, &Permission::PauseContract));
        assert!(!client.has_permission(&user, &Permission::AssignRole));
    }

    #[test]
    fn unassigned_address_has_no_permissions() {
        let env = Env::default();
        let (_id, _admin, _approver, client) = setup(&env);
        let stranger = Address::generate(&env);
        assert!(!client.has_permission(&stranger, &Permission::ReadBalance));
        assert!(!client.has_permission(&stranger, &Permission::Stake));
    }

    // ── require_permission ────────────────────────────────────────────────────

    #[test]
    fn require_permission_passes_for_admin() {
        let env = Env::default();
        let (contract_id, admin, _approver, client) = setup(&env);
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "require_permission",
                args: (admin.clone(), Permission::CreditFunds).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_require_permission(&admin, &Permission::CreditFunds)
            .unwrap()
            .unwrap();
    }

    #[test]
    fn require_permission_fails_for_unauthorized() {
        let env = Env::default();
        let (contract_id, _admin, _approver, client) = setup(&env);
        let stranger = Address::generate(&env);
        env.mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "require_permission",
                args: (stranger.clone(), Permission::CreditFunds).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_require_permission(&stranger, &Permission::CreditFunds);
        assert_eq!(result.unwrap_err().unwrap(), AccessError::Unauthorized);
    }

    // ── revocation ────────────────────────────────────────────────────────────

    #[test]
    fn two_step_assign_and_revoke() {
        let env = Env::default();
        let (contract_id, admin, approver, client) = setup(&env);
        let subject = Address::generate(&env);

        // 1. Propose assign
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_assign_role",
                args: (admin.clone(), subject.clone(), Role::Operator).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_propose_assign_role(&admin, &subject, &Role::Operator)
            .unwrap()
            .unwrap();

        // Should NOT have permission yet
        assert!(!client.has_permission(&subject, &Permission::CreditFunds));

        // 2. Confirm assign
        env.mock_auths(&[MockAuth {
            address: &approver,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "confirm_assign_role",
                args: (approver.clone(), subject.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_confirm_assign_role(&approver, &subject)
            .unwrap()
            .unwrap();

        // Should NOW have permission
        assert!(client.has_permission(&subject, &Permission::CreditFunds));

        // 3. Propose revoke
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_revoke_role",
                args: (admin.clone(), subject.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_propose_revoke_role(&admin, &subject)
            .unwrap()
            .unwrap();

        // Should STILL have permission
        assert!(client.has_permission(&subject, &Permission::CreditFunds));

        // 4. Confirm revoke
        env.mock_auths(&[MockAuth {
            address: &approver,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "confirm_revoke_role",
                args: (approver.clone(), subject.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_confirm_revoke_role(&approver, &subject)
            .unwrap()
            .unwrap();

        // Should NO LONGER have permission
        assert!(!client.has_permission(&subject, &Permission::CreditFunds));
    }

    #[test]
    fn delegation_constraints_and_invalidation() {
        let env = Env::default();
        let (contract_id, admin, approver, client) = setup(&env);
        let delegator = Address::generate(&env);
        let delegatee = Address::generate(&env);

        // Give delegator Operator role
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_assign_role",
                args: (admin.clone(), delegator.clone(), Role::Operator).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_propose_assign_role(&admin, &delegator, &Role::Operator)
            .unwrap()
            .unwrap();
        env.mock_auths(&[MockAuth {
            address: &approver,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "confirm_assign_role",
                args: (approver.clone(), delegator.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_confirm_assign_role(&approver, &delegator)
            .unwrap()
            .unwrap();

        // 1. Delegate a permission the delegator HAS (CreditFunds)
        env.mock_auths(&[MockAuth {
            address: &delegator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "delegate_permission",
                args: (
                    delegator.clone(),
                    delegatee.clone(),
                    Permission::CreditFunds,
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_delegate_permission(&delegator, &delegatee, &Permission::CreditFunds)
            .unwrap()
            .unwrap();
        assert!(client.has_permission(&delegatee, &Permission::CreditFunds));

        // 2. Try to delegate a permission the delegator DOES NOT have (PauseContract)
        env.mock_auths(&[MockAuth {
            address: &delegator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "delegate_permission",
                args: (
                    delegator.clone(),
                    delegatee.clone(),
                    Permission::PauseContract,
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result =
            client.try_delegate_permission(&delegator, &delegatee, &Permission::PauseContract);
        assert_eq!(result.unwrap_err().unwrap(), AccessError::Unauthorized);

        // 3. Invalidate delegation by revoking delegator's role
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_revoke_role",
                args: (admin.clone(), delegator.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_propose_revoke_role(&admin, &delegator)
            .unwrap()
            .unwrap();
        env.mock_auths(&[MockAuth {
            address: &approver,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "confirm_revoke_role",
                args: (approver.clone(), delegator.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_confirm_revoke_role(&approver, &delegator)
            .unwrap()
            .unwrap();

        // Delegation should now be invalid
        assert!(!client.has_permission(&delegatee, &Permission::CreditFunds));
    }

    #[test]
    fn require_permission_on_revoked_grant() {
        let env = Env::default();
        let (contract_id, admin, approver, client) = setup(&env);
        let subject = Address::generate(&env);

        // Assign role
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_assign_role",
                args: (admin.clone(), subject.clone(), Role::Operator).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_propose_assign_role(&admin, &subject, &Role::Operator)
            .unwrap()
            .unwrap();
        env.mock_auths(&[MockAuth {
            address: &approver,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "confirm_assign_role",
                args: (approver.clone(), subject.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_confirm_assign_role(&approver, &subject)
            .unwrap()
            .unwrap();

        // Verify require_permission works
        env.mock_auths(&[MockAuth {
            address: &subject,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "require_permission",
                args: (subject.clone(), Permission::CreditFunds).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_require_permission(&subject, &Permission::CreditFunds)
            .unwrap()
            .unwrap();

        // Revoke role
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_revoke_role",
                args: (admin.clone(), subject.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_propose_revoke_role(&admin, &subject)
            .unwrap()
            .unwrap();
        env.mock_auths(&[MockAuth {
            address: &approver,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "confirm_revoke_role",
                args: (approver.clone(), subject.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_confirm_revoke_role(&approver, &subject)
            .unwrap()
            .unwrap();

        // Verify require_permission fails
        env.mock_auths(&[MockAuth {
            address: &subject,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "require_permission",
                args: (subject.clone(), Permission::CreditFunds).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_require_permission(&subject, &Permission::CreditFunds);
        assert_eq!(result.unwrap_err().unwrap(), AccessError::Unauthorized);
    }

    #[test]
    fn list_roles_returns_all_assigned() {
        let env = Env::default();
        let (_id, admin, _approver, client) = setup(&env);
        let roles = client.list_roles();
        assert_eq!(roles.len(), 1);
        let (addr, role) = roles.get(0).unwrap();
        assert_eq!(addr, admin);
        assert_eq!(role, Role::Admin);
    }

    // ── delegation ────────────────────────────────────────────────────────────

    #[test]
    fn delegate_permission_grants_access() {
        let env = Env::default();
        let (contract_id, admin, _approver, client) = setup(&env);
        let delegatee = Address::generate(&env);

        // Delegate CreditFunds to delegatee
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "delegate_permission",
                args: (admin.clone(), delegatee.clone(), Permission::CreditFunds).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_delegate_permission(&admin, &delegatee, &Permission::CreditFunds)
            .unwrap()
            .unwrap();

        // delegatee has no role
        assert_eq!(client.get_role(&delegatee), None);
        // but has the delegated permission
        assert!(client.has_permission(&delegatee, &Permission::CreditFunds));
        // and not others
        assert!(!client.has_permission(&delegatee, &Permission::Stake));
        // get_delegation returns the right permission
        assert_eq!(
            client.get_delegation(&delegatee),
            Some(Permission::CreditFunds)
        );
    }

    #[test]
    fn revoke_delegation_removes_access() {
        let env = Env::default();
        let (contract_id, admin, _approver, client) = setup(&env);
        let delegatee = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "delegate_permission",
                args: (admin.clone(), delegatee.clone(), Permission::ReadBalance).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_delegate_permission(&admin, &delegatee, &Permission::ReadBalance)
            .unwrap()
            .unwrap();
        assert!(client.has_permission(&delegatee, &Permission::ReadBalance));

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "revoke_delegation",
                args: (admin.clone(), delegatee.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_revoke_delegation(&admin, &delegatee)
            .unwrap()
            .unwrap();

        assert!(!client.has_permission(&delegatee, &Permission::ReadBalance));
        assert_eq!(client.get_delegation(&delegatee), None);
    }

    #[test]
    fn revoke_delegation_fails_if_none_exists() {
        let env = Env::default();
        let (contract_id, admin, _approver, client) = setup(&env);
        let nobody = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "revoke_delegation",
                args: (admin.clone(), nobody.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_revoke_delegation(&admin, &nobody);
        assert_eq!(result.unwrap_err().unwrap(), AccessError::NoDelegationFound);
    }

    #[test]
    fn non_admin_cannot_delegate() {
        let env = Env::default();
        let (contract_id, _admin, _approver, client) = setup(&env);
        let stranger = Address::generate(&env);
        let target = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "delegate_permission",
                args: (stranger.clone(), target.clone(), Permission::ReadBalance).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_delegate_permission(&stranger, &target, &Permission::ReadBalance);
        assert_eq!(result.unwrap_err().unwrap(), AccessError::Unauthorized);
    }

    // ── unauthorized-caller rejection for every privileged function ───────────

    #[test]
    fn propose_assign_role_rejects_non_admin() {
        let env = Env::default();
        let (contract_id, _admin, _approver, client) = setup(&env);
        let stranger = Address::generate(&env);
        let subject = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_assign_role",
                args: (stranger.clone(), subject.clone(), Role::Operator).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_propose_assign_role(&stranger, &subject, &Role::Operator);
        assert_eq!(result.unwrap_err().unwrap(), AccessError::Unauthorized);

        // no role assigned as a side effect
        assert_eq!(client.get_role(&subject), None);
        assert_eq!(client.list_roles().len(), 1);
    }

    #[test]
    fn confirm_assign_role_rejects_non_approver() {
        let env = Env::default();
        let (contract_id, admin, _approver, client) = setup(&env);
        let subject = Address::generate(&env);
        let impostor = Address::generate(&env);

        // a valid proposal exists
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_assign_role",
                args: (admin.clone(), subject.clone(), Role::Operator).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_propose_assign_role(&admin, &subject, &Role::Operator)
            .unwrap()
            .unwrap();

        // someone who is not the configured second approver tries to confirm
        env.mock_auths(&[MockAuth {
            address: &impostor,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "confirm_assign_role",
                args: (impostor.clone(), subject.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_confirm_assign_role(&impostor, &subject);
        assert_eq!(result.unwrap_err().unwrap(), AccessError::Unauthorized);
        assert_eq!(client.get_role(&subject), None);
    }

    #[test]
    fn confirm_assign_role_without_proposal_fails() {
        let env = Env::default();
        let (contract_id, _admin, approver, client) = setup(&env);
        let subject = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &approver,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "confirm_assign_role",
                args: (approver.clone(), subject.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_confirm_assign_role(&approver, &subject);
        assert_eq!(result.unwrap_err().unwrap(), AccessError::AwaitingApproval);
    }

    #[test]
    fn propose_revoke_role_rejects_non_admin() {
        let env = Env::default();
        let (contract_id, _admin, _approver, client) = setup(&env);
        let stranger = Address::generate(&env);
        let subject = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_revoke_role",
                args: (stranger.clone(), subject.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_propose_revoke_role(&stranger, &subject);
        assert_eq!(result.unwrap_err().unwrap(), AccessError::Unauthorized);
    }

    #[test]
    fn confirm_revoke_role_rejects_non_approver() {
        let env = Env::default();
        let (contract_id, admin, approver, client) = setup(&env);
        let subject = Address::generate(&env);
        let impostor = Address::generate(&env);

        assign_role(
            &env,
            &contract_id,
            &client,
            &admin,
            &approver,
            &subject,
            Role::Operator,
        );

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_revoke_role",
                args: (admin.clone(), subject.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_propose_revoke_role(&admin, &subject)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &impostor,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "confirm_revoke_role",
                args: (impostor.clone(), subject.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_confirm_revoke_role(&impostor, &subject);
        assert_eq!(result.unwrap_err().unwrap(), AccessError::Unauthorized);
        // the role survived the failed confirmation
        assert_eq!(client.get_role(&subject), Some(Role::Operator));
    }

    #[test]
    fn confirm_revoke_role_without_proposal_fails() {
        let env = Env::default();
        let (contract_id, _admin, approver, client) = setup(&env);
        let subject = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &approver,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "confirm_revoke_role",
                args: (approver.clone(), subject.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_confirm_revoke_role(&approver, &subject);
        assert_eq!(result.unwrap_err().unwrap(), AccessError::AwaitingApproval);
    }

    #[test]
    fn confirm_revoke_role_rejects_assign_sentinel() {
        let env = Env::default();
        let (contract_id, admin, approver, client) = setup(&env);
        let subject = Address::generate(&env);

        // pending ASSIGN proposal: Proposals[subject] holds `role as u32`, not the
        // `u32::MAX` sentinel that `propose_revoke_role` writes.
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_assign_role",
                args: (admin.clone(), subject.clone(), Role::Operator).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_propose_assign_role(&admin, &subject, &Role::Operator)
            .unwrap()
            .unwrap();

        // confirm_revoke_role must refuse to act on an assign proposal
        env.mock_auths(&[MockAuth {
            address: &approver,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "confirm_revoke_role",
                args: (approver.clone(), subject.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_confirm_revoke_role(&approver, &subject);
        assert_eq!(result.unwrap_err().unwrap(), AccessError::AwaitingApproval);
        assert_eq!(client.get_role(&subject), None);
    }

    #[test]
    fn confirm_assign_role_on_pending_revocation_grants_auditor_defect() {
        // DEFECT REPRODUCTION — not an endorsement of this behavior.
        //
        // `propose_revoke_role` stores the sentinel `u32::MAX` in the shared
        // `Proposals` map. `confirm_assign_role` then decodes any unrecognised
        // value through its catch-all `_ => Role::Auditor` arm. Consequently the
        // second approver can unilaterally convert a pending *revocation* into an
        // *Auditor grant*, defeating the two-step multisig, and it emits an
        // `assign_role` audit event that looks legitimate to an indexer.
        //
        // This test pins the CURRENT (buggy) behavior so the PR carries a
        // reproduction. It must be fixed under a SEPARATE issue; when fixed,
        // replace this with a test asserting the revocation is honored or a
        // typed error is returned.
        let env = Env::default();
        let (contract_id, admin, approver, client) = setup(&env);
        let subject = Address::generate(&env);

        assign_role(
            &env,
            &contract_id,
            &client,
            &admin,
            &approver,
            &subject,
            Role::Operator,
        );
        assert_eq!(client.get_role(&subject), Some(Role::Operator));

        // admin proposes to REVOKE the subject's role
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_revoke_role",
                args: (admin.clone(), subject.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_propose_revoke_role(&admin, &subject)
            .unwrap()
            .unwrap();

        // the second approver calls the WRONG confirm function...
        env.mock_auths(&[MockAuth {
            address: &approver,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "confirm_assign_role",
                args: (approver.clone(), subject.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_confirm_assign_role(&approver, &subject)
            .unwrap()
            .unwrap();

        // the audit trail shows a legitimate-looking assignment to Auditor (3).
        // (Asserted before any query call — `Events::all()` only keeps the last
        // invocation's events.)
        let (subj, detail) = find_audit_event(&env, "assign_role").expect("assign_role event");
        assert_eq!(subj, subject);
        assert_eq!(detail, Role::Auditor as u32);

        // ...and the pending revocation has silently become an Auditor grant.
        assert_eq!(client.get_role(&subject), Some(Role::Auditor));
    }

    // ── last-admin guard (restored regression) ──────────────────────────────

    #[test]
    fn cannot_revoke_last_admin() {
        // Regression: this test existed until commit 6bba8263 ("fix compilation
        // and clippy errors in contract_access and rent_payments"), which removed
        // an accidentally duplicated copy — and with it the only copy — leaving
        // `test_snapshots/tests/cannot_revoke_last_admin.1.json` orphaned and the
        // `admin_count <= 1` guard in `propose_revoke_role` entirely uncovered.
        let env = Env::default();
        let (contract_id, admin, _approver, client) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_revoke_role",
                args: (admin.clone(), admin.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_propose_revoke_role(&admin, &admin);
        assert_eq!(
            result.unwrap_err().unwrap(),
            AccessError::CannotRevokeLastAdmin
        );
        assert_eq!(client.get_role(&admin), Some(Role::Admin));
    }

    #[test]
    fn can_revoke_admin_when_two_exist() {
        let env = Env::default();
        let (contract_id, admin, approver, client) = setup(&env);
        let admin2 = Address::generate(&env);

        // promote a second admin so the last-admin guard no longer applies
        assign_role(
            &env,
            &contract_id,
            &client,
            &admin,
            &approver,
            &admin2,
            Role::Admin,
        );
        assert_eq!(client.get_role(&admin2), Some(Role::Admin));

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_revoke_role",
                args: (admin.clone(), admin2.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_propose_revoke_role(&admin, &admin2)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &approver,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "confirm_revoke_role",
                args: (approver.clone(), admin2.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_confirm_revoke_role(&approver, &admin2)
            .unwrap()
            .unwrap();

        assert_eq!(client.get_role(&admin2), None);
        assert_eq!(client.get_role(&admin), Some(Role::Admin));
    }

    // ── revoke_delegation authorization boundaries ──────────────────────────

    #[test]
    fn revoke_delegation_rejects_unrelated_caller() {
        let env = Env::default();
        let (contract_id, admin, _approver, client) = setup(&env);
        let delegatee = Address::generate(&env);
        let stranger = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "delegate_permission",
                args: (admin.clone(), delegatee.clone(), Permission::ReadBalance).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_delegate_permission(&admin, &delegatee, &Permission::ReadBalance)
            .unwrap()
            .unwrap();

        // caller is neither the admin nor the original delegator
        env.mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "revoke_delegation",
                args: (stranger.clone(), delegatee.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_revoke_delegation(&stranger, &delegatee);
        assert_eq!(result.unwrap_err().unwrap(), AccessError::Unauthorized);

        // the delegation survived the failed revoke
        assert!(client.has_permission(&delegatee, &Permission::ReadBalance));
        assert_eq!(
            client.get_delegation(&delegatee),
            Some(Permission::ReadBalance)
        );
    }

    #[test]
    fn original_delegator_can_revoke_own_delegation() {
        let env = Env::default();
        let (contract_id, admin, approver, client) = setup(&env);
        let delegator = Address::generate(&env);
        let delegatee = Address::generate(&env);

        assign_role(
            &env,
            &contract_id,
            &client,
            &admin,
            &approver,
            &delegator,
            Role::Operator,
        );

        env.mock_auths(&[MockAuth {
            address: &delegator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "delegate_permission",
                args: (
                    delegator.clone(),
                    delegatee.clone(),
                    Permission::CreditFunds,
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_delegate_permission(&delegator, &delegatee, &Permission::CreditFunds)
            .unwrap()
            .unwrap();
        assert!(client.has_permission(&delegatee, &Permission::CreditFunds));

        // the original delegator holds no admin role but may revoke their grant
        env.mock_auths(&[MockAuth {
            address: &delegator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "revoke_delegation",
                args: (delegator.clone(), delegatee.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_revoke_delegation(&delegator, &delegatee)
            .unwrap()
            .unwrap();

        assert!(!client.has_permission(&delegatee, &Permission::CreditFunds));
        assert_eq!(client.get_delegation(&delegatee), None);
    }

    // ── grant / revoke / re-grant cycle ────────────────────────────────────

    #[test]
    fn assign_revoke_reassign_cycle() {
        let env = Env::default();
        let (contract_id, admin, approver, client) = setup(&env);
        let subject = Address::generate(&env);

        assign_role(
            &env,
            &contract_id,
            &client,
            &admin,
            &approver,
            &subject,
            Role::Operator,
        );
        assert!(client.has_permission(&subject, &Permission::CreditFunds));

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_revoke_role",
                args: (admin.clone(), subject.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_propose_revoke_role(&admin, &subject)
            .unwrap()
            .unwrap();
        env.mock_auths(&[MockAuth {
            address: &approver,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "confirm_revoke_role",
                args: (approver.clone(), subject.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_confirm_revoke_role(&approver, &subject)
            .unwrap()
            .unwrap();
        assert!(!client.has_permission(&subject, &Permission::CreditFunds));
        assert_eq!(client.get_role(&subject), None);

        // re-grant, a different role this time
        assign_role(
            &env,
            &contract_id,
            &client,
            &admin,
            &approver,
            &subject,
            Role::Auditor,
        );
        assert_eq!(client.get_role(&subject), Some(Role::Auditor));
        assert!(client.has_permission(&subject, &Permission::ReadBalance));
        assert!(!client.has_permission(&subject, &Permission::CreditFunds));
    }

    // ── transitive-delegation safety boundary ──────────────────────────────

    #[test]
    fn second_hop_delegation_confers_no_usable_permission() {
        // A delegatee may itself call `delegate_permission` (the guard accepts a
        // permission held via delegation), and the call succeeds and emits a
        // `delegate_perm` event — but the second hop is INERT: `has_delegation`
        // only consults the *immediate* delegator's ROLE, so a second-hop
        // delegatee gains nothing usable. This pins the transitive-escalation
        // safety boundary. (Whether the second hop should be rejected outright,
        // rather than silently accepted + evented, is flagged for the maintainer.)
        let env = Env::default();
        let (contract_id, admin, approver, client) = setup(&env);
        let d1 = Address::generate(&env);
        let d2 = Address::generate(&env);
        let d3 = Address::generate(&env);

        assign_role(
            &env,
            &contract_id,
            &client,
            &admin,
            &approver,
            &d1,
            Role::Operator,
        );

        // hop 1: d1 holds CreditFunds via its Operator role
        env.mock_auths(&[MockAuth {
            address: &d1,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "delegate_permission",
                args: (d1.clone(), d2.clone(), Permission::CreditFunds).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_delegate_permission(&d1, &d2, &Permission::CreditFunds)
            .unwrap()
            .unwrap();
        assert!(client.has_permission(&d2, &Permission::CreditFunds));

        // hop 2: d2 holds CreditFunds ONLY via delegation, re-delegates to d3
        env.mock_auths(&[MockAuth {
            address: &d2,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "delegate_permission",
                args: (d2.clone(), d3.clone(), Permission::CreditFunds).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        // the call is accepted and the delegation is stored...
        client
            .try_delegate_permission(&d2, &d3, &Permission::CreditFunds)
            .unwrap()
            .unwrap();
        assert_eq!(client.get_delegation(&d3), Some(Permission::CreditFunds));

        // ...but it confers no usable permission — no transitive escalation
        assert!(!client.has_permission(&d3, &Permission::CreditFunds));
        assert_eq!(client.get_role(&d3), None);
    }

    // ── pre-init behavior (see report: failure modes are inconsistent) ──────

    #[test]
    #[should_panic(expected = "admin not set")]
    fn pre_init_propose_assign_role_panics() {
        // The `propose_*` role fns read the admin via `get_admin`'s
        // `.expect("admin not set")`, so calling one before `init` is a bare
        // panic, not a typed error. (The `confirm_*` fns and the
        // delegate/require paths instead return typed errors pre-init — the
        // inconsistency is flagged in the report.)
        let env = Env::default();
        let contract_id = env.register(AccessControl, ());
        let client = AccessControlClient::new(&env, &contract_id);
        let caller = Address::generate(&env);
        let subject = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &caller,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_assign_role",
                args: (caller.clone(), subject.clone(), Role::Operator).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.propose_assign_role(&caller, &subject, &Role::Operator);
    }

    #[test]
    fn pre_init_require_permission_is_unauthorized() {
        let env = Env::default();
        let contract_id = env.register(AccessControl, ());
        let client = AccessControlClient::new(&env, &contract_id);
        let caller = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &caller,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "require_permission",
                args: (caller.clone(), Permission::ReadBalance).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_require_permission(&caller, &Permission::ReadBalance);
        assert_eq!(result.unwrap_err().unwrap(), AccessError::Unauthorized);
    }

    #[test]
    fn pre_init_delegate_permission_is_unauthorized() {
        let env = Env::default();
        let contract_id = env.register(AccessControl, ());
        let client = AccessControlClient::new(&env, &contract_id);
        let caller = Address::generate(&env);
        let target = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &caller,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "delegate_permission",
                args: (caller.clone(), target.clone(), Permission::ReadBalance).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_delegate_permission(&caller, &target, &Permission::ReadBalance);
        assert_eq!(result.unwrap_err().unwrap(), AccessError::Unauthorized);
    }

    // ── event assertions (no pre-existing test asserted any event) ──────────

    #[test]
    fn init_emits_audit_event() {
        let env = Env::default();
        let (_id, admin, _approver, _client) = setup(&env);

        let (subject, detail) = find_audit_event(&env, "init").expect("init event");
        assert_eq!(subject, admin);
        assert_eq!(detail, Role::Admin as u32);
    }

    #[test]
    fn assign_and_revoke_flow_emit_events() {
        let env = Env::default();
        let (contract_id, admin, approver, client) = setup(&env);
        let subject = Address::generate(&env);

        // Each event is asserted immediately after its emitting call, because
        // `Events::all()` only exposes the most recent invocation's events.

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_assign_role",
                args: (admin.clone(), subject.clone(), Role::Operator).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_propose_assign_role(&admin, &subject, &Role::Operator)
            .unwrap()
            .unwrap();
        let (s, d) = find_audit_event(&env, "propose_assign").expect("propose_assign event");
        assert_eq!(s, subject);
        assert_eq!(d, Role::Operator as u32);

        env.mock_auths(&[MockAuth {
            address: &approver,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "confirm_assign_role",
                args: (approver.clone(), subject.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_confirm_assign_role(&approver, &subject)
            .unwrap()
            .unwrap();
        let (s, d) = find_audit_event(&env, "assign_role").expect("assign_role event");
        assert_eq!(s, subject);
        assert_eq!(d, Role::Operator as u32);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "propose_revoke_role",
                args: (admin.clone(), subject.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_propose_revoke_role(&admin, &subject)
            .unwrap()
            .unwrap();
        let (s, d) = find_audit_event(&env, "propose_revoke").expect("propose_revoke event");
        assert_eq!(s, subject);
        assert_eq!(d, 0);

        env.mock_auths(&[MockAuth {
            address: &approver,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "confirm_revoke_role",
                args: (approver.clone(), subject.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_confirm_revoke_role(&approver, &subject)
            .unwrap()
            .unwrap();
        let (s, d) = find_audit_event(&env, "revoke_role").expect("revoke_role event");
        assert_eq!(s, subject);
        assert_eq!(d, 0);
    }

    #[test]
    fn delegation_flow_emits_events() {
        let env = Env::default();
        let (contract_id, admin, _approver, client) = setup(&env);
        let delegatee = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "delegate_permission",
                args: (admin.clone(), delegatee.clone(), Permission::CreditFunds).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_delegate_permission(&admin, &delegatee, &Permission::CreditFunds)
            .unwrap()
            .unwrap();

        let (s, d) = find_audit_event(&env, "delegate_perm").expect("delegate_perm event");
        assert_eq!(s, delegatee);
        assert_eq!(d, Permission::CreditFunds as u32);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "revoke_delegation",
                args: (admin.clone(), delegatee.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_revoke_delegation(&admin, &delegatee)
            .unwrap()
            .unwrap();

        let (s, d) = find_audit_event(&env, "revoke_delegation").expect("revoke_delegation event");
        assert_eq!(s, delegatee);
        assert_eq!(d, 0);
    }
}
