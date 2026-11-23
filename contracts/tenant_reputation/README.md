# Tenant Reputation Contract

On-chain tenant score registry for portable, tamper-evident reputation records.

## Interface

### Admin Functions
- `init(admin)` - Initialize the contract with an admin address
- `set_score_bounds(min_score, max_score)` - Set valid score range
- `set_operator(operator)` - Set an operator address allowed to write reputation

### Reputation Functions
- `update_reputation(tenant, composite_score, payment_score, property_care_score, communication_score, rating_count)` - Update a tenant's reputation record
- `revoke_reputation(tenant)` - Remove a tenant's reputation record
- `get_reputation(tenant)` - Get a tenant's reputation record
- `has_reputation(tenant)` - Check if a tenant has a reputation record

## Storage Layout

- `DataKey::Admin` - Admin address
- `DataKey::Operator(address)` - Operator flags
- `DataKey::ScoreBounds` - Score bounds (min, max)
- `DataKey::Reputation(address)` - Reputation records

## Reputation Record

```
Reputation {
    composite_score: u32,
    payment_score: u32,
    property_care_score: u32,
    communication_score: u32,
    rating_count: u32,
    last_updated: u64,
    version: u64,
}
```

## Events

- `init` - Contract initialized
- `update_reputation` - Reputation updated
- `revoke_reputation` - Reputation revoked
- `set_score_bounds` - Score bounds changed
- `set_operator` - Operator set

## Errors

- `AlreadyInitialized` - Contract already initialized
- `NotInitialized` - Contract not initialized
- `NotAuthorized` - Caller not authorized
- `InvalidScore` - Score out of bounds
- `ReputationNotFound` - Reputation record not found
- `ScoreBoundsNotSet` - Score bounds not set
- `StaleWrite` - Write timestamp not newer than existing
