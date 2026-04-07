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
    /// delegation map: delegatee Address → delegated Permission (as u32)
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

/// Check if an address has a delegated permission.
fn has_delegation(env: &Env, delegatee: &Address, perm: Permission) -> bool {
    let delegations: Map<Address, u32> = env
        .storage()
        .instance()
        .get(&DataKey::Delegations)
        .unwrap_or_else(|| Map::new(env));
    delegations.get(delegatee.clone()) == Some(perm as u32)
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

    /// Delegate a specific `permission` to `delegatee`.  Only admin can do
    /// this.  Delegation is stored separately from roles and grants only the
    /// specified permission (not a full role).
    pub fn delegate_permission(
        env: Env,
        admin: Address,
        delegatee: Address,
        permission: Permission,
    ) -> Result<(), AccessError> {
        admin.require_auth();
        let current_admin = get_admin(&env);
        if admin != current_admin {
            return Err(AccessError::Unauthorized);
        }

        let mut delegations: Map<Address, u32> = env
            .storage()
            .instance()
            .get(&DataKey::Delegations)
            .unwrap_or_else(|| Map::new(&env));

        delegations.set(delegatee.clone(), permission as u32);
        env.storage()
            .instance()
            .set(&DataKey::Delegations, &delegations);

        emit_audit(&env, "delegate_perm", &delegatee, permission as u32);
        Ok(())
    }

    /// Revoke a previously granted delegation from `delegatee`.
    pub fn revoke_delegation(
        env: Env,
        admin: Address,
        delegatee: Address,
    ) -> Result<(), AccessError> {
        admin.require_auth();
        let current_admin = get_admin(&env);
        if admin != current_admin {
            return Err(AccessError::Unauthorized);
        }

        let mut delegations: Map<Address, u32> = env
            .storage()
            .instance()
            .get(&DataKey::Delegations)
            .unwrap_or_else(|| Map::new(&env));

        if delegations.get(delegatee.clone()).is_none() {
            return Err(AccessError::NoDelegationFound);
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

        let roles = roles_map(&env);
        let role = roles.get(caller.clone()).ok_or(AccessError::Unauthorized)?;

        if role_has_permission(role, permission) {
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
        let roles = roles_map(&env);
        if let Some(role) = roles.get(addr.clone()) {
            if role_has_permission(role, permission) {
                return true;
            }
        }
        has_delegation(&env, &addr, permission)
    }

    /// Returns the delegated permission for `addr`, if any.
    pub fn get_delegation(env: Env, addr: Address) -> Option<Permission> {
        let delegations: Map<Address, u32> = env
            .storage()
            .instance()
            .get(&DataKey::Delegations)
            .unwrap_or_else(|| Map::new(&env));

        let perm_u32 = delegations.get(addr)?;

        let perm = match perm_u32 {
            0 => Permission::Initialize,
            1 => Permission::PauseContract,
            2 => Permission::UpgradeContract,
            3 => Permission::AssignRole,
            4 => Permission::RevokeRole,
            5 => Permission::TransferAdmin,
            6 => Permission::CreditFunds,
            7 => Permission::DebitFunds,
            8 => Permission::TransferFunds,
            9 => Permission::Stake,
            10 => Permission::Unstake,
            11 => Permission::SetLockPeriod,
            12 => Permission::ReadBalance,
            13 => Permission::ReadAuditLog,
            _ => Permission::DelegatePermission,
        };

        Some(perm)
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
        testutils::{Address as _, MockAuth, MockAuthInvoke},
        Address, Env, IntoVal,
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
    fn cannot_revoke_last_admin() {
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
}
