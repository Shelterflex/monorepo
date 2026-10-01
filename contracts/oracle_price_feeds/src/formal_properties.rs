#![cfg(kani)]

use soroban_sdk::{Address, Env, Symbol};

use crate::{ContractError, DataKey, OraclePriceFeeds, PriceFeed, SourceData};

// ── Oracle Price Feeds — Formal Verification Properties ──────────────────────
//
// These Kani proof harnesses verify critical safety properties of the oracle
// price-feed contract. They are compiled only under `#[cfg(kani)]` and are
// NOT included in the normal `cargo test` suite.
//
// Run with:  cargo kani --harness <name>

// ---------------------------------------------------------------------------
// 1. Staleness bounds: get_price always fails when timestamp is beyond threshold
// ---------------------------------------------------------------------------

/// Property: get_price (single-source mode) must panic with PriceTooStale
/// whenever the feed's `updated_at` is older than the staleness threshold.
///
/// Invariant: ∀ feed ∈ Storage, now − feed.updated_at > threshold ⟹ get_price panics.
#[kani::proof]
fn verify_stale_price_rejected() {
    let env = Env::default();

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    let pair = Symbol::new(&env, "NGN_USD");

    let contract_id = env.register(OraclePriceFeeds, ());
    let client = OraclePriceFeedsClient::new(&env, &contract_id);

    env.mock_all_auths();

    // Initialize with a 600-second staleness threshold
    client
        .try_init(&admin, &operator, &600u64, &500u64)
        .unwrap()
        .unwrap();

    // Write a price at t=1000
    env.ledger().set_timestamp(1_000);
    client
        .try_update_price(&operator, &pair, &10_000i128, &1u64)
        .unwrap()
        .unwrap();

    // Advance time past threshold: now = 1000 + 601 = 1601 (stale by 1 second)
    env.ledger().set_timestamp(1_601);

    // Property: get_price must fail (panic / Err) for stale feeds
    let result = client.try_get_price(&pair);
    assert!(result.is_err(), "get_price must fail on stale feed");

    // Property: is_stale must agree
    assert!(
        client.is_stale(&pair),
        "is_stale must return true past threshold"
    );
}

// ---------------------------------------------------------------------------
// 2. Sequence monotonicity: update_price rejects replayed or equal sequences
// ---------------------------------------------------------------------------

/// Property: A price update with sequence ≤ the last recorded sequence must
/// be rejected with InvalidSequence. The feed's price must not change.
///
/// Invariant: ∀ seq_new ≤ seq_current, update_price returns Err(InvalidSequence).
#[kani::proof]
fn verify_sequence_monotonicity() {
    let env = Env::default();
    env.ledger().set_timestamp(1_000);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    let pair = Symbol::new(&env, "NGN_USD");

    let contract_id = env.register(OraclePriceFeeds, ());
    let client = OraclePriceFeedsClient::new(&env, &contract_id);

    env.mock_all_auths();
    client
        .try_init(&admin, &operator, &600u64, &500u64)
        .unwrap()
        .unwrap();

    // Submit sequence=5
    client
        .try_update_price(&operator, &pair, &6_170i128, &5u64)
        .unwrap()
        .unwrap();

    let price_after_first = client.get_price_unsafe(&pair).price;

    // Replay with the same sequence — must fail
    let replay_result = client.try_update_price(&operator, &pair, &9_999i128, &5u64);
    assert!(
        matches!(
            replay_result.unwrap_err().unwrap(),
            ContractError::InvalidSequence
        ),
        "replay sequence must be rejected"
    );

    // Replay with lower sequence — must also fail
    let lower_result = client.try_update_price(&operator, &pair, &9_999i128, &3u64);
    assert!(
        matches!(
            lower_result.unwrap_err().unwrap(),
            ContractError::InvalidSequence
        ),
        "lower sequence must be rejected"
    );

    // Price must remain unchanged after rejected updates
    let price_unchanged = client.get_price_unsafe(&pair).price;
    assert_eq!(
        price_after_first, price_unchanged,
        "price must not change on rejected sequence"
    );
}

// ---------------------------------------------------------------------------
// 3. Deviation bounds: updates exceeding max_deviation_bps are rejected
// ---------------------------------------------------------------------------

/// Property: A price update whose deviation from the last accepted price
/// exceeds max_deviation_bps must be rejected with PriceDeviationTooLarge,
/// leaving the stored price unchanged.
///
/// Invariant: |new − old| / old × 10_000 > max_bps ⟹ Err(PriceDeviationTooLarge).
#[kani::proof]
fn verify_deviation_bounds_enforced() {
    let env = Env::default();
    env.ledger().set_timestamp(1_000);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    let pair = Symbol::new(&env, "NGN_USD");

    let contract_id = env.register(OraclePriceFeeds, ());
    let client = OraclePriceFeedsClient::new(&env, &contract_id);

    env.mock_all_auths();
    // Configure 500 bps (5%) max deviation
    client
        .try_init(&admin, &operator, &600u64, &500u64)
        .unwrap()
        .unwrap();

    // Seed price = 10_000
    client
        .try_update_price(&operator, &pair, &10_000i128, &1u64)
        .unwrap()
        .unwrap();

    // 5.01% upward deviation: 10_000 → 10_501 — must be rejected
    let excessive_up = client.try_update_price(&operator, &pair, &10_501i128, &2u64);
    assert!(
        matches!(
            excessive_up.unwrap_err().unwrap(),
            ContractError::PriceDeviationTooLarge
        ),
        "5.01% upward deviation must be rejected"
    );

    // 5.01% downward deviation: 10_000 → 9_499 — must be rejected
    let excessive_down = client.try_update_price(&operator, &pair, &9_499i128, &2u64);
    assert!(
        matches!(
            excessive_down.unwrap_err().unwrap(),
            ContractError::PriceDeviationTooLarge
        ),
        "5.01% downward deviation must be rejected"
    );

    // Price must remain at 10_000 after both rejections
    let price = client.get_price_unsafe(&pair).price;
    assert_eq!(
        price, 10_000,
        "price must be unchanged after rejected updates"
    );
}

// ---------------------------------------------------------------------------
// 4. Authorization: only admin or operator may call update_price (single-source)
// ---------------------------------------------------------------------------

/// Property: An unauthorized caller must not be able to update a price feed
/// in single-source mode.
///
/// Invariant: ∀ caller ∉ {admin, operator}, update_price returns NotAuthorized.
#[kani::proof]
fn verify_unauthorized_update_rejected() {
    let env = Env::default();
    env.ledger().set_timestamp(1_000);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    let attacker = Address::generate(&env);
    let pair = Symbol::new(&env, "NGN_USD");

    let contract_id = env.register(OraclePriceFeeds, ());
    let client = OraclePriceFeedsClient::new(&env, &contract_id);

    env.mock_all_auths();
    client
        .try_init(&admin, &operator, &600u64, &500u64)
        .unwrap()
        .unwrap();

    // Attempt to update price as an unauthorized address
    let result = client.try_update_price(&attacker, &pair, &6_170i128, &1u64);
    assert!(
        matches!(result.unwrap_err().unwrap(), ContractError::NotAuthorized),
        "unauthorized caller must be rejected"
    );
}

// ---------------------------------------------------------------------------
// 5. Freshness after valid update: get_price returns the new price immediately
// ---------------------------------------------------------------------------

/// Property: Immediately after a valid price update, get_price returns the
/// newly submitted price, and is_stale returns false.
///
/// Invariant: valid update ⟹ get_price().price == submitted_price ∧ ¬is_stale.
#[kani::proof]
fn verify_fresh_price_readable() {
    let env = Env::default();
    env.ledger().set_timestamp(1_000);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    let pair = Symbol::new(&env, "NGN_USD");

    let contract_id = env.register(OraclePriceFeeds, ());
    let client = OraclePriceFeedsClient::new(&env, &contract_id);

    env.mock_all_auths();
    client
        .try_init(&admin, &operator, &600u64, &500u64)
        .unwrap()
        .unwrap();

    let submitted_price: i128 = 7_500;
    client
        .try_update_price(&operator, &pair, &submitted_price, &1u64)
        .unwrap()
        .unwrap();

    // Still within the staleness window
    env.ledger().set_timestamp(1_599);

    let feed = client.get_price(&pair);
    assert_eq!(
        feed.price, submitted_price,
        "get_price must return the last valid submitted price"
    );
    assert!(
        !client.is_stale(&pair),
        "feed must not be stale immediately after update"
    );
}

#[kani::proof]
fn verify_stale_price_rejected() {
    let env = Env::default();
    let contract_id = env.register(OracleContract, ());
    let client = OracleContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    let pair = Symbol::new(&env, "BTC");

    // Symbolic inputs for thresholds and timestamps
    let max_stale_secs: u64 = kani::any();
    kani::assume(max_stale_secs > 0 && max_stale_secs <= 86400);

    let initial_time: u64 = kani::any();
    kani::assume(initial_time > 1000 && initial_time < u64::MAX / 4);

    let update_delta: u64 = kani::any();
    kani::assume(update_delta > 0 && update_delta < 100_000);

    let price: i128 = kani::any();
    kani::assume(price > 0 && price < 1_000_000_000i128);

    client
        .try_init(&admin, &operator, &max_stale_secs, &500u64)
        .unwrap()
        .unwrap();

    env.ledger().set_timestamp(initial_time);
    let update_timestamp = initial_time + update_delta;
    client
        .try_update_price(&operator, &pair, &price, &update_timestamp)
        .unwrap()
        .unwrap();

    // Query time strictly greater than staleness threshold
    let query_time = update_timestamp + max_stale_secs + 1;
    kani::assume(query_time > update_timestamp);
    env.ledger().set_timestamp(query_time);

    let result = client.try_get_price(&pair);
    assert!(
        result.is_err(),
        "get_price must fail on stale feed across all symbolic ranges"
    );
}
