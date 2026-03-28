# Canonical Event Topics

To ensure consistency in event tracking and avoid breakage in off-chain indexers when contracts are upgraded, all core contracts in the Drips Network must conform to a standardized event topic naming scheme.

## The Canonical Scheme

Each contract event must be published with a topic tuple that ALWAYS starts with the `contract_name` as its first element, followed by the `event_name` as its second element.

**Format**: `(Symbol::new(&env, "<contract_name>"), Symbol::new(&env, "<event_name>"))`

**Arguments**: `(arg1, arg2, ...)`

### Examples

**Correct**:
```rust
env.events().publish(
    (Symbol::new(&env, "staking_pool"), Symbol::new(&env, "paused")),
    ()
);
```

**Incorrect** (missing contract name prefix):
```rust
env.events().publish(
    (Symbol::new(&env, "paused"),),
    ()
);
```

### Why?
1. **Filtering**: Indexers can filter globally by the first topic element (the contract name) without needing hardcoded contract IDs.
2. **Upgradability**: If a contract ID changes during an upgrade, the indexer can still seamlessly capture events by looking for the consistent `contract_name` topic.
