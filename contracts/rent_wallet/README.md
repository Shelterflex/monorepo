# Rent Wallet Contract

This contract is a minimal wallet-like contract for credit/debit flows.

See `docs/specs/contracts/CONVENTIONS.md` for shared conventions (errors, events, init patterns).

## Interface

| Method | Args | Auth | Emitted events |
|---|---|---|---|
| `init` | `admin: Address` | public (one-time init) | `("rent_wallet","init")` |
| `contract_version` | none | public | none |
| `credit` | `admin: Address, user: Address, amount: i128` | admin | `("rent_wallet","credit", user)` |
| `debit` | `admin: Address, user: Address, amount: i128` | admin | `("rent_wallet","debit", user)` |
| `balance` | `user: Address` | public | none |
| `set_admin` | `admin: Address, new_admin: Address` | admin | `("rent_wallet","set_admin")` |
| `pause` | `admin: Address` | admin | `("rent_wallet","pause")` |
| `unpause` | `admin: Address` | admin | `("rent_wallet","unpause")` |
| `is_paused` | none | public | none |
