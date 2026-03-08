# Soroban Contract Conventions

This document defines conventions for Soroban smart contracts in this repo to keep indexers and backend integrations stable as new contracts are added.

## Errors

### Use `#[contracterror]` + `Result`

- Public, state-mutating contract functions should return `Result<_, ContractError>`.
- Prefer typed errors over `panic!("...")`.

### Standard error variants

Contracts should implement a `ContractError` enum using:

- `#[contracterror]`
- `#[repr(u32)]`

Recommended shared variants (use when applicable):

- `AlreadyInitialized = 1`
- `NotAuthorized = 2`
- `Paused = 3`
- `InvalidAmount = 4`

Common contract-specific variants (examples):

- `InsufficientBalance`
- `Duplicate`
- `NotFound`
- `InvalidInput`

### Authorization and pause checks

- Admin-only entrypoints should require auth of the caller and compare against stored admin.
- Operator-only entrypoints should require auth of the caller and compare against stored operator (or an operator set).
- If the contract is paused, mutating entrypoints should return `Err(ContractError::Paused)`.

## Events

### Topic shape

Contracts should emit Soroban events with topics structured as:

- `(contract: Symbol, event: Symbol, ...event-specific topics)`

This gives indexers a stable primary discriminator (contract + event) and allows filtering.

### Naming

- `contract` should be a stable snake_case identifier for the contract crate (e.g. `"rent_wallet"`, `"transaction_receipt"`).
- `event` should be a stable snake_case verb phrase (e.g. `"init"`, `"credit"`, `"receipt_recorded"`).

### Examples

- Rent wallet credit:
  - **Topic**: `(rent_wallet, credit, user)`
  - **Data**: `amount`

- Transaction receipt recorded:
  - **Topic**: `(transaction_receipt, receipt_recorded, tx_id)`
  - **Data**: `Receipt`

## Initialization

### Standard init pattern

- Contracts should expose exactly one initialization entrypoint named `init`.
- `init` should be callable once and return `AlreadyInitialized` if called again.
- `init` should store at least an `admin` address. If the contract uses an operator role, also store an `operator` address.

Recommended signatures:

- Admin-only contracts:
  - `init(env: Env, admin: Address) -> Result<(), ContractError>`
- Admin + operator contracts:
  - `init(env: Env, admin: Address, operator: Address) -> Result<(), ContractError>`

### Storage


- Store `Admin` in instance storage.
- If present, store `Operator` in instance storage.
- Store `Paused` in instance storage (default `false`).

