# Bond Collateral Contract

This contract manages refundable bonds that bind actors to good behavior, supports locking part of a bond while a dispute is open, executes slashes requested by the slashing module, and provides collateralized lending positions.

## Interface

| Method | Args | Auth | Emitted events |
|---|---|---|---|
| `init` | `admin: Address, operator: Address, slashing_module: Address, asset_price: i128, health_threshold: i128` | public (one-time init) | `("bond_collateral","init")` |
| `set_admin` | `admin: Address, new_admin: Address` | admin | `("bond_collateral","set_admin")` |
| `set_operator` | `admin: Address, new_operator: Address` | admin | `("bond_collateral","set_operator")` |
| `set_thresholds` | `admin: Address, asset_price: i128, health_threshold: i128` | admin | `("bond_collateral","set_thresholds")` |
| `deposit_bond` | `from: Address, amount: i128` | caller | `("bond_collateral","deposit_bond", from)` |
| `withdraw_bond` | `from: Address, amount: i128` | caller | `("bond_collateral","withdraw_bond", from)` |
| `lock_bond` | `owner: Address, amount: i128, expiry: u64` | caller | `("bond_collateral","lock_bond", owner)` |
| `unlock_bond` | `owner: Address, lock_id: u64` | caller | `("bond_collateral","unlock_bond", owner)` |
| `get_bond` | `owner: Address` | public | none |
| `get_locks` | `owner: Address` | public | none |
| `execute_slash` | `slashing_module: Address, owner: Address, amount: i128, lock_id: Option<u64>` | slashing module | `("bond_collateral","execute_slash", owner)` |
| `deposit_collateral` | `owner: Address, amount: i128` | caller | `("bond_collateral","deposit_collateral", owner)` |
| `withdraw_collateral` | `owner: Address, amount: i128` | caller | `("bond_collateral","withdraw_collateral", owner)` |
| `issue_bond` | `owner: Address, amount: i128` | caller | `("bond_collateral","issue_bond", owner)` |
| `redeem_bond` | `owner: Address, amount: i128` | caller | `("bond_collateral","redeem_bond", owner)` |
| `liquidate` | `liquidator: Address, owner: Address` | liquidator | `("bond_collateral","liquidate", owner)` |
| `get_position` | `owner: Address` | public | none |
| `get_collateral_ratio` | `owner: Address` | public | none |

## Storage Layout

### Instance Storage
- `Admin`: Address - Contract administrator
- `Operator`: Address - Operator address with admin-like permissions
- `SlashingModule`: Address - Address authorized to execute slashes
- `AssetPrice`: i128 - Fixed asset price (replaces removed oracle contract)
- `HealthThreshold`: i128 - Health threshold for collateral positions (e.g., 150 = 150%)
- `ContractVersion`: u32 - Contract version for upgrade tracking
- `TotalBonded`: i128 - Total bonded balance across all owners (invariant tracking)

### Persistent Storage
- `BondBalance(Address)`: i128 - Per-owner bond balance
- `BondLock(Address, u64)`: (i128, u64, Address) - Lock data: (amount, expiry, owner)
- `NextLockId(Address)`: u64 - Next lock ID for each owner
- `TotalLocked(Address)`: i128 - Total locked amount per owner
- `CollateralPosition(Address)`: (i128, i128) - Collateral position: (collateral_amount, bond_issued)

## Events

All state changes emit events with topics starting with `("bond_collateral", ...)` for off-chain indexing.

## Errors

- `AlreadyInitialized`: Contract already initialized
- `NotAuthorized`: Caller lacks required permission
- `InvalidAmount`: Amount is zero, negative, or exceeds maximum
- `InsufficientBalance`: Insufficient balance for operation
- `InsufficientUnlockedBalance`: Withdrawal would go below locked amount
- `LockNotFound`: Lock ID does not exist
- `LockExpired`: Lock has already expired
- `LockNotExpired`: Lock has not yet expired
- `NotLockOwner`: Caller is not the lock owner
- `SlashingModuleNotSet`: Slashing module not configured
- `NotSlashingModule`: Caller is not the configured slashing module
- `SlashExceedsAvailable`: Slash amount exceeds available balance
- `InvalidPrice`: Invalid asset price
- `InvalidThreshold`: Invalid health threshold
- `PositionNotFound`: No collateral position exists
- `PositionUnhealthy`: Position would be or is unhealthy
- `LiquidationBelowThreshold`: Attempt to liquidate a healthy position
- `NegativeValue`: Negative value provided
- `BalanceOverflow`: Arithmetic overflow would occur
