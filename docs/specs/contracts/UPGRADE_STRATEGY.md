# Contract Upgrade / Versioning Strategy

This repo contains multiple Soroban contracts that will evolve over time. This document defines a strategy for making state layout changes safely while maintaining backwards compatibility when possible.

## Goals

- Provide a stable, explicit `contract_version() -> u32` for each contract.
- Make storage layout changes incremental and non-breaking by default.
- Avoid ad-hoc migrations; when migrations are needed, make them explicit and testable.

## Contract versioning

Each contract MUST:

- Store an instance storage key `ContractVersion` during `init`.
- Expose `contract_version(env: Env) -> u32` that returns the stored version.

Version numbers are monotonically increasing `u32` values:

- `1` = initial production layout
- `2+` = subsequent layout/API revisions

## Storage key versioning approach

### 1) Prefer stable, typed keys

Prefer `#[contracttype] enum StorageKey` / `DataKey` for instance storage keys.

- Existing variants should NOT be renamed.
- Existing variants should NOT change their associated data types.

### 2) Adding new keys

To add new state:

- Add a new enum variant, e.g. `StorageKey::NewField`.
- In new code, read the key with `get(...).unwrap_or(default)` to tolerate older deployments.
- Write the key during `init` (or lazily during the first call that needs it) depending on whether it is required for correctness.

### 3) Optional fields and defaulting

When introducing new fields, treat them as optional for at least one version:

- Read path: `get` and default if missing.
- Write path: ensure new writes populate it.

This enables old state to keep working without immediate migration.

## Introducing new fields safely

Recommended pattern for a new field `X`:

- **Version N**:
  - Add key `X`.
  - On reads, default to a safe value if missing.
  - On writes, set `X`.
- **Version N+1**:
  - If desired, enforce presence (e.g. expect it exists) after a successful migration path has been available.

## Deprecating fields

Deprecation should happen in phases:

- **Phase 1 (deprecated but supported)**
  - Stop writing to the old key.
  - Keep reading it only as a fallback.
- **Phase 2 (soft removal)**
  - Read new key primarily; read old key only if new key is missing.
- **Phase 3 (hard removal)**
  - Only after a deliberate migration step (or a planned chain reset), remove old-key reads.

Do not reuse old keys for new meanings.

## Data migrations

### Default: no migrations (lazy defaulting)

Most layout changes should avoid migrations by:

- Adding new keys with defaults.
- Leaving old keys in place.

### When migrations are required

A migration is required when:

- A value must be transformed (e.g., changing a numeric scale, changing a map structure).
- A key must be split/merged into new keys.
- A correctness-critical invariant depends on new state being present.

### Migration strategy

If a migration is required:

- Add a dedicated admin-only entrypoint (e.g. `migrate_vN_to_vN1(...)`) or a generic `migrate(target_version: u32)`.
- Make migrations:
  - Idempotent
  - Safe to resume
  - Explicitly version-gated (only runs when current version matches expected)
- Update `ContractVersion` only after migration succeeds.

### Testing migrations

- Add tests that:
  - Start from old state (constructed in test using direct storage writes when needed)
  - Run migration
  - Assert new keys exist and old-state behavior remains correct
  - Assert `contract_version()` was updated
