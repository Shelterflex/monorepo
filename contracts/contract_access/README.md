# Contract Access

`contract_access` is a standalone access-control contract. It has four roles, a permission
matrix, a two-step (propose then confirm) process for assigning and revoking roles that needs a
second approver, and delegation of single permissions. Delegations have no expiry.

All statements below were derived from `src/lib.rs`. Function names link to their definitions.
The inline tests are cited where they pin behavior.

## Roles and permissions

[`Role`](src/lib.rs#L47) (stored as `u32`): `Admin = 0`, `Operator = 1`, `User = 2`, `Auditor = 3`.
Each address holds at most one role.

[`Permission`](src/lib.rs#L60): `Initialize`, `PauseContract`, `UpgradeContract`, `AssignRole`,
`RevokeRole`, `TransferAdmin`, `CreditFunds`, `DebitFunds`, `TransferFunds`, `Stake`, `Unstake`,
`SetLockPeriod`, `ReadBalance`, `ReadAuditLog`, `DelegatePermission`.

The permission matrix is [`permission_matrix`](src/lib.rs#L175):

| Role | Permissions |
|---|---|
| Admin | All 15 |
| Operator | `CreditFunds`, `DebitFunds`, `TransferFunds`, `Stake`, `Unstake`, `ReadBalance`, `ReadAuditLog` |
| User | `Stake`, `Unstake`, `ReadBalance` |
| Auditor | `ReadBalance`, `ReadAuditLog` |

## Storage layout

All keys are in **instance** storage. Keys are defined in [`DataKey`](src/lib.rs#L106).

| Key | Value |
|---|---|
| `Admin` | `Address`. The admin used for proposals and for delegation revocation |
| `SecondApprover` | `Address`. The only address that can confirm a proposal |
| `Roles` | `Map<Address, Role>`. The whole map is read and rewritten on each change |
| `Proposals` | `Map<Address, u32>`. One pending proposal per subject. A role value (0–3) for assign, or `u32::MAX` for revoke |
| `Delegations` | `Map<Address, DelegationInfo { delegator, permission }>`. One delegation per delegatee |

## Errors

[`AccessError`](src/lib.rs#L126): `Unauthorized = 1`, `AwaitingApproval = 2`,
`AlreadyInitialized = 3`, `CannotRevokeLastAdmin = 4`, `NoSecondApprover = 5`,
`NoDelegationFound = 6`.

## Interface

| Function | Arguments | Authorization | Returns | Errors |
|---|---|---|---|---|
| [`init`](src/lib.rs#L269) | `admin, second_approver` | `admin.require_auth()`. First call only | `()` | `AlreadyInitialized` |
| [`propose_assign_role`](src/lib.rs#L293) | `admin, subject, role` | `admin.require_auth()`. `admin` must equal stored `Admin` | `()` | `Unauthorized` |
| [`confirm_assign_role`](src/lib.rs#L316) | `approver, subject` | `approver.require_auth()`. `approver` must equal `SecondApprover` | `()` | `NoSecondApprover`, `Unauthorized`, `AwaitingApproval` (no proposal for `subject`) |
| [`propose_revoke_role`](src/lib.rs#L358) | `admin, subject` | As `propose_assign_role` | `()` | `Unauthorized`, `CannotRevokeLastAdmin` (`subject` is the only Admin) |
| [`confirm_revoke_role`](src/lib.rs#L387) | `approver, subject` | As `confirm_assign_role` | `()` | `NoSecondApprover`, `Unauthorized`, `AwaitingApproval` (no revoke proposal) |
| [`delegate_permission`](src/lib.rs#L428) | `delegator, delegatee, permission` | `delegator.require_auth()`. `delegator` must hold `permission` (by role or delegation) | `()` | `Unauthorized` |
| [`revoke_delegation`](src/lib.rs#L462) | `caller, delegatee` | `caller.require_auth()`. `caller` must be stored `Admin` or the original delegator | `()` | `NoDelegationFound`, `Unauthorized` |
| [`require_permission`](src/lib.rs#L504) | `caller, permission` | `caller.require_auth()` | `()` | `Unauthorized` |
| [`get_role`](src/lib.rs#L521) | `addr` | none | `Option<Role>` | none |
| [`has_permission`](src/lib.rs#L526) | `addr, permission` | none | `bool`. True by role, or by a delegation whose delegator still holds the permission | none |
| [`get_delegation`](src/lib.rs#L534) | `addr` | none | `Option<Permission>` | none |
| [`list_roles`](src/lib.rs#L545) | none | none | `Vec<(Address, Role)>` | none |

### The two-step role change

1. The admin calls `propose_*`. This writes to `Proposals` and emits an audit event.
2. The second approver calls `confirm_*`. This reads the proposal, applies the change, removes
   the proposal, and emits an audit event.

The last-admin guard runs at `propose_revoke_role` time. It applies only when the subject
currently holds `Admin`.

## Events

All events use topics `(access_control, action, subject)`. Data is `u32` as shown. The emitter
is [`emit_audit`](src/lib.rs#L245).

| Action | Subject | Data |
|---|---|---|
| `init` | admin | `Role::Admin as u32` |
| `propose_assign` | subject | role value |
| `assign_role` | subject | role value |
| `propose_revoke` | subject | `0` |
| `revoke_role` | subject | `0` |
| `delegate_perm` | delegatee | permission value |
| `revoke_delegation` | delegatee | `0` |

## Usage example

```rust
let client = AccessControlClient::new(&env, &contract_id);
client.init(&admin, &second_approver);

// Two-step assignment.
client.propose_assign_role(&admin, &operator_addr, &Role::Operator);
client.confirm_assign_role(&second_approver, &operator_addr);

// Admin delegates one permission to a user, and the user can then act with it.
client.delegate_permission(&operator_addr, &user_addr, &Permission::Stake);

// Gate a call.
client.require_permission(&user_addr, &Permission::Stake);
```

## Known limitations

These were found by reading the code. Each is reported here and not fixed, per the issue.

1. **A pending revocation can be turned into an Auditor grant.** `propose_revoke_role` stores
   the sentinel `u32::MAX` in `Proposals`. `confirm_assign_role` decodes any value that is not
   0–2 as `Role::Auditor`. So the second approver can confirm an assign on a subject who has a
   pending revoke, and that subject gets `Auditor`. The inline test
   [`confirm_assign_role_on_pending_revocation_grants_auditor_defect`](src/lib.rs#L1455) pins
   this current behavior and marks it as a defect to fix under a separate issue.
2. **Admin authority comes from `DataKey::Admin`, not from the Admin role.** `propose_assign_role`,
   `propose_revoke_role` and `revoke_delegation` compare the caller with the stored `Admin`. The
   last-admin guard reads the `Roles` map. Two Admin holders are possible. If the address in
   `DataKey::Admin` is revoked (allowed while another Admin exists), it keeps the admin-only entry
   points, and the other Admin holder loses them. Found by reading. No test covers it.
3. **`DataKey::Proposals` does not match its doc comment.** The comment says
   `(proposer, Permission) → bool`. The code stores `Map<Address, u32>` keyed by subject. Only one
   pending proposal exists per subject, so a later proposal silently overwrites an earlier one,
   including a pending revoke.
4. **One delegation per delegatee, silently overwritten.** `delegate_permission` replaces any
   existing delegation for the same delegatee.
5. **Second-hop delegation is recorded but inert.** `delegate_permission` accepts a delegator
   who holds a permission only by delegation. `has_delegation` checks only the delegator's role,
   so the second hop grants nothing. This is pinned by the test
   `second_hop_delegation_confers_no_usable_permission`.
6. **The second approver is not checked against the admin.** `init` does not reject
   `second_approver == admin`. If they are equal, the two-step process is one person.
7. **Whole-map reads and writes.** `Roles` and `Proposals` are single instance entries. Each
   change reads and rewrites the full map, so cost grows with the number of roles. `list_roles`
   returns every role with no pagination.
