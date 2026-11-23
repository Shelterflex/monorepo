# Schema Registry Contract

This contract records which `(from_version, to_version)` state transitions are supported and keeps a receipt for each executed migration so an upgrade can be audited.

## Interface

| Method | Args | Auth | Emitted events |
|---|---|---|---|
| `initialize` | `admin: Address` | public (one-time init) | `("schema_registry","initialize")` |
| `register_transition` | `admin: Address, from_version: u32, to_version: u32` | admin | `("schema_registry","register_transition")` |
| `is_transition_supported` | `from_version: u32, to_version: u32` | public | none |
| `dry_run` | `contract_id: Address, from_version: u32, to_version: u32` | public | none |
| `execute_migration` | `caller: Address, contract_id: Address, from_version: u32, to_version: u32, result_hash: BytesN<32>` | caller | `("schema_registry","execute_migration")` |
| `get_receipt` | `contract_id: Address, ledger_sequence: u64` | public | none |
| `verify_migration` | `contract_id: Address, ledger_sequence: u64, expected_hash: BytesN<32>` | public | none |
| `registry_version` | none | public | none |

## Storage Layout

### Instance Storage
- `Admin`: Address - Contract administrator
- `RegistryVersion`: u32 - Registry version (incremented on schema updates)
- `ContractVersion`: u32 - Contract version for upgrade tracking
- `Transition(u32, u32)`: bool - Whether a transition is registered (from_version, to_version)

### Persistent Storage
- `Receipt(Address, u64)`: MigrationReceipt - Migration receipt by contract ID and ledger sequence
- `NextReceiptSequence(Address)`: u64 - Next receipt sequence for a contract

## Events

All state changes emit events with topics starting with `("schema_registry", ...)` for off-chain indexing.

## Errors

- `AlreadyInitialized`: Contract already initialized
- `NotAuthorized`: Caller lacks required permission
- `TransitionAlreadyRegistered`: Transition already registered
- `InvalidVersion`: Invalid version provided
- `DowngradeNotAllowed`: Downgrade transitions are not allowed
- `TransitionNotSupported`: Transition is not registered
- `ReceiptNotFound`: Receipt does not exist
- `VerificationFailed`: Hash verification failed
- `ReceiptAlreadyExists`: Receipt already exists for this sequence
