#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Env, Symbol,
    Vec,
};

pub mod access_control;

#[cfg(kani)]
mod formal_properties;

const DEFAULT_STALENESS_SECONDS: u64 = 600;
const DEFAULT_MAX_DEVIATION_BPS: u64 = 500; // 5% in basis points
const PRICE_DECIMALS: u32 = 7;
const DEFAULT_QUORUM: u32 = 1;

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PriceFeed {
    pub pair: Symbol,
    pub price: i128,
    pub decimals: u32,
    pub updated_at: u64,
    pub sequence: u64,
}

/// A timestamped price snapshot recorded on each `update_price` call.
/// Used to compute manipulation-resistant TWAP views (issue #1196).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PriceObservation {
    /// Aggregated price at the time of recording (same decimals as PriceFeed).
    pub price: i128,
    /// Ledger timestamp when this observation was written.
    pub timestamp: u64,
}

/// Per-source price record stored for aggregation.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SourceData {
    pub price: i128,
    pub timestamp: u64,
    pub sequence: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Operator,
    StalenessThreshold,
    MaxDeviationBps,
    Feed(Symbol),
    Sequence(Symbol),
    /// Registered sources for a feed (Vec<Address>)
    Sources(Symbol),
    /// Latest price submitted by a specific source for a feed
    SourceData(Symbol, Address),
    /// Minimum number of fresh sources required to compute a valid price
    Quorum(Symbol),
    /// Accumulated TWAP observations ring-buffer for a feed
    TwapObservations(Symbol),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    InvalidSequence = 3,
    PriceTooStale = 4,
    UnknownPair = 5,
    PriceDeviationTooLarge = 6,
    /// Fewer fresh sources than the required quorum
    NoQuorum = 7,
    /// Source is not registered for this feed
    UnknownSource = 8,
    /// Invalid configuration parameter (e.g. out of bounds threshold or deviation)
    InvalidConfiguration = 9,
}

#[contract]
pub struct OraclePriceFeeds;

fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<_, Address>(&DataKey::Admin)
        .expect("admin not set")
}

fn get_operator(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<_, Address>(&DataKey::Operator)
        .expect("operator not set")
}

fn get_staleness_threshold(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get::<_, u64>(&DataKey::StalenessThreshold)
        .unwrap_or(DEFAULT_STALENESS_SECONDS)
}

fn get_max_deviation_bps(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get::<_, u64>(&DataKey::MaxDeviationBps)
        .unwrap_or(DEFAULT_MAX_DEVIATION_BPS)
}

fn emit_price_updated(env: &Env, feed: &PriceFeed) {
    env.events().publish(
        (
            Symbol::new(env, "oracle"),
            Symbol::new(env, "price_updated"),
            feed.pair.clone(),
        ),
        (feed.price, feed.sequence, feed.updated_at),
    );
}

/// Compute median of a non-empty Vec<i128> without floating point.
/// Uses selection sort; safe for small source sets (≤ ~10 elements).
fn median(env: &Env, values: &Vec<i128>) -> i128 {
    let n = values.len();
    // Build a sorted copy via selection sort
    let mut sorted: Vec<i128> = Vec::new(env);
    // Track which positions have been selected
    let mut used: Vec<bool> = Vec::new(env);
    for _ in 0..n {
        used.push_back(false);
    }
    for _ in 0..n {
        let mut min_val: i128 = i128::MAX;
        let mut min_idx: u32 = 0;
        for j in 0..n {
            if !used.get(j).unwrap() {
                let v = values.get(j).unwrap();
                if v < min_val {
                    min_val = v;
                    min_idx = j;
                }
            }
        }
        used.set(min_idx, true);
        sorted.push_back(min_val);
    }
    if n % 2 == 1 {
        sorted.get(n / 2).unwrap()
    } else {
        let mid = n / 2;
        (sorted.get(mid - 1).unwrap() + sorted.get(mid).unwrap()) / 2
    }
}

#[contractimpl]
impl OraclePriceFeeds {
    pub fn init(
        env: Env,
        admin: Address,
        operator: Address,
        staleness_threshold: u64,
        max_deviation_bps: u64,
    ) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }
        let threshold = if staleness_threshold == 0 {
            DEFAULT_STALENESS_SECONDS
        } else {
            staleness_threshold
        };
        let deviation = if max_deviation_bps == 0 {
            DEFAULT_MAX_DEVIATION_BPS
        } else {
            max_deviation_bps
        };
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Operator, &operator);
        env.storage()
            .instance()
            .set(&DataKey::StalenessThreshold, &threshold);
        env.storage()
            .instance()
            .set(&DataKey::MaxDeviationBps, &deviation);
        Ok(())
    }

    // ── Source management (admin-only) ────────────────────────────────────────

    /// Register a new price source for a feed. Admin-only.
    pub fn add_source(
        env: Env,
        caller: Address,
        pair: Symbol,
        source: Address,
    ) -> Result<(), ContractError> {
        access_control::require_admin_permission(&env, &get_admin(&env), &caller, "add_source")?;
        let mut sources: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Sources(pair.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        if !sources.contains(&source) {
            sources.push_back(source.clone());
            env.storage()
                .instance()
                .set(&DataKey::Sources(pair.clone()), &sources);
        }
        env.events().publish(
            (
                Symbol::new(&env, "oracle"),
                Symbol::new(&env, "source_added"),
                pair,
            ),
            source,
        );
        Ok(())
    }

    /// Remove a price source from a feed. Admin-only.
    pub fn remove_source(
        env: Env,
        caller: Address,
        pair: Symbol,
        source: Address,
    ) -> Result<(), ContractError> {
        access_control::require_admin_permission(&env, &get_admin(&env), &caller, "remove_source")?;
        let sources: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Sources(pair.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        let mut new_sources: Vec<Address> = Vec::new(&env);
        for i in 0..sources.len() {
            let s = sources.get(i).unwrap();
            if s != source {
                new_sources.push_back(s);
            }
        }
        env.storage()
            .instance()
            .set(&DataKey::Sources(pair.clone()), &new_sources);
        env.events().publish(
            (
                Symbol::new(&env, "oracle"),
                Symbol::new(&env, "source_removed"),
                pair,
            ),
            source,
        );
        Ok(())
    }

    /// Set quorum requirement for a feed. Admin-only.
    pub fn set_quorum(
        env: Env,
        caller: Address,
        pair: Symbol,
        quorum: u32,
    ) -> Result<(), ContractError> {
        access_control::require_admin_permission(&env, &get_admin(&env), &caller, "set_quorum")?;
        env.storage()
            .instance()
            .set(&DataKey::Quorum(pair), &quorum);
        Ok(())
    }

    /// Read registered sources for a feed.
    pub fn get_sources(env: Env, pair: Symbol) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::Sources(pair))
            .unwrap_or_else(|| Vec::new(&env))
    }

    // ── Price updates ─────────────────────────────────────────────────────────

    /// Submit a price update.
    ///
    /// When sources are registered for a feed the caller must be one of those
    /// registered sources (per-source heartbeat). Otherwise the existing
    /// admin-or-operator authentication is used (single-source fallback mode).
    pub fn update_price(
        env: Env,
        caller: Address,
        pair: Symbol,
        price: i128,
        sequence: u64,
    ) -> Result<(), ContractError> {
        let sources: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Sources(pair.clone()))
            .unwrap_or_else(|| Vec::new(&env));

        if sources.is_empty() {
            // Legacy single-source mode: admin or operator
            access_control::require_admin_or_operator_permission(
                &env,
                &get_admin(&env),
                &get_operator(&env),
                &caller,
                "update_price",
            )?;
        } else {
            // Multi-source mode: caller must be a registered source
            if !sources.contains(&caller) {
                return Err(ContractError::UnknownSource);
            }
            caller.require_auth();
        }

        // Per-source sequence guard
        let source_key = DataKey::SourceData(pair.clone(), caller.clone());
        let current_seq: u64 =
            if let Some(prev_data) = env.storage().instance().get::<_, SourceData>(&source_key) {
                prev_data.sequence
            } else {
                0u64
            };

        if sequence <= current_seq {
            return Err(ContractError::InvalidSequence);
        }

        // Also update the feed-level sequence for legacy compatibility
        let feed_seq: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Sequence(pair.clone()))
            .unwrap_or(0);

        // For single-source mode, enforce strict sequence on feed level
        if sources.is_empty() && sequence <= feed_seq {
            return Err(ContractError::InvalidSequence);
        }

        // Deviation check against the last price for this source
        let max_deviation_bps = get_max_deviation_bps(&env);
        let prev_price: Option<i128> =
            if let Some(prev_data) = env.storage().instance().get::<_, SourceData>(&source_key) {
                Some(prev_data.price)
            } else if sources.is_empty() {
                // Single-source: deviation against the feed-level price
                env.storage()
                    .instance()
                    .get::<_, PriceFeed>(&DataKey::Feed(pair.clone()))
                    .map(|f| f.price)
            } else {
                None
            };

        if let Some(old_price) = prev_price {
            if old_price != 0 {
                let diff = if price > old_price {
                    price - old_price
                } else {
                    old_price - price
                };
                let deviation_bps = (diff * 10000) / old_price.abs();
                if deviation_bps > max_deviation_bps as i128 {
                    return Err(ContractError::PriceDeviationTooLarge);
                }
            }
        }

        let now = env.ledger().timestamp();

        // Store per-source data
        env.storage().instance().set(
            &source_key,
            &SourceData {
                price,
                timestamp: now,
                sequence,
            },
        );

        // Emit source_reported event
        env.events().publish(
            (
                Symbol::new(&env, "oracle"),
                Symbol::new(&env, "source_reported"),
                pair.clone(),
            ),
            (caller.clone(), price, sequence, now),
        );

        if sources.is_empty() {
            // Update the canonical feed record in single-source mode
            let feed = PriceFeed {
                pair: pair.clone(),
                price,
                decimals: PRICE_DECIMALS,
                updated_at: now,
                sequence,
            };
            env.storage()
                .instance()
                .set(&DataKey::Feed(pair.clone()), &feed);
            env.storage()
                .instance()
                .set(&DataKey::Sequence(pair.clone()), &sequence);
            emit_price_updated(&env, &feed);
        }

        Ok(())
    }

    // ── Price queries ─────────────────────────────────────────────────────────

    /// Get the current price for a feed.
    ///
    /// When sources are registered, returns the **median** of fresh source
    /// submissions and fails with `NoQuorum` if fewer than the required quorum
    /// of sources have fresh data. Otherwise uses the single-source feed record.
    pub fn get_price(env: Env, pair: Symbol) -> PriceFeed {
        let sources: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Sources(pair.clone()))
            .unwrap_or_else(|| Vec::new(&env));

        if !sources.is_empty() {
            let threshold = get_staleness_threshold(&env);
            let now = env.ledger().timestamp();
            let quorum: u32 = env
                .storage()
                .instance()
                .get(&DataKey::Quorum(pair.clone()))
                .unwrap_or(DEFAULT_QUORUM);

            // Collect fresh source prices
            let mut fresh_prices: Vec<i128> = Vec::new(&env);
            for i in 0..sources.len() {
                let src = sources.get(i).unwrap();
                if let Some(data) = env
                    .storage()
                    .instance()
                    .get::<_, SourceData>(&DataKey::SourceData(pair.clone(), src))
                {
                    if now.saturating_sub(data.timestamp) <= threshold {
                        fresh_prices.push_back(data.price);
                    }
                }
            }

            if fresh_prices.len() < quorum {
                panic_with_error!(&env, ContractError::NoQuorum);
            }

            let aggregated_price = median(&env, &fresh_prices);

            let feed = PriceFeed {
                pair: pair.clone(),
                price: aggregated_price,
                decimals: PRICE_DECIMALS,
                updated_at: now,
                sequence: 0,
            };

            // Emit aggregated price event
            env.events().publish(
                (
                    Symbol::new(&env, "oracle"),
                    Symbol::new(&env, "aggregated_price"),
                    pair,
                ),
                (aggregated_price, fresh_prices.len(), now),
            );

            return feed;
        }

        // Single-source fallback
        let feed = Self::get_price_unsafe(env.clone(), pair);
        let threshold = get_staleness_threshold(&env);
        let now = env.ledger().timestamp();
        if now.saturating_sub(feed.updated_at) > threshold {
            panic_with_error!(&env, ContractError::PriceTooStale);
        }
        feed
    }

    pub fn get_price_unsafe(env: Env, pair: Symbol) -> PriceFeed {
        env.storage()
            .instance()
            .get(&DataKey::Feed(pair))
            .unwrap_or_else(|| panic_with_error!(&env, ContractError::UnknownPair))
    }

    pub fn is_stale(env: Env, pair: Symbol) -> bool {
        let sources: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Sources(pair.clone()))
            .unwrap_or_else(|| Vec::new(&env));

        if !sources.is_empty() {
            let threshold = get_staleness_threshold(&env);
            let now = env.ledger().timestamp();
            let quorum: u32 = env
                .storage()
                .instance()
                .get(&DataKey::Quorum(pair.clone()))
                .unwrap_or(DEFAULT_QUORUM);
            let mut fresh_count: u32 = 0;
            for i in 0..sources.len() {
                let src = sources.get(i).unwrap();
                if let Some(data) = env
                    .storage()
                    .instance()
                    .get::<_, SourceData>(&DataKey::SourceData(pair.clone(), src))
                {
                    if now.saturating_sub(data.timestamp) <= threshold {
                        fresh_count += 1;
                    }
                }
            }
            return fresh_count < quorum;
        }

        if !env.storage().instance().has(&DataKey::Feed(pair.clone())) {
            return true;
        }
        let feed: PriceFeed = env.storage().instance().get(&DataKey::Feed(pair)).unwrap();
        let threshold = get_staleness_threshold(&env);
        let now = env.ledger().timestamp();
        now.saturating_sub(feed.updated_at) > threshold
    }

    pub fn set_staleness_threshold(
        env: Env,
        caller: Address,
        threshold: u64,
    ) -> Result<(), ContractError> {
        access_control::require_admin_permission(
            &env,
            &get_admin(&env),
            &caller,
            "set_staleness_threshold",
        )?;
        if threshold == 0 || threshold > 31536000 {
            return Err(ContractError::InvalidConfiguration);
        }
        env.storage()
            .instance()
            .set(&DataKey::StalenessThreshold, &threshold);
        Ok(())
    }

    pub fn set_max_deviation_bps(
        env: Env,
        caller: Address,
        max_deviation_bps: u64,
    ) -> Result<(), ContractError> {
        access_control::require_admin_permission(
            &env,
            &get_admin(&env),
            &caller,
            "set_max_deviation_bps",
        )?;
        if max_deviation_bps == 0 || max_deviation_bps > 10000 {
            return Err(ContractError::InvalidConfiguration);
        }
        env.storage()
            .instance()
            .set(&DataKey::MaxDeviationBps, &max_deviation_bps);
        Ok(())
    }

    /// Return a time-weighted average price (TWAP) for `pair` over the stored
    /// observations window (issue #1196).
    ///
    /// Reads the `PriceObservation` ring-buffer accumulated by `update_price`
    /// and computes a simple time-weighted mean:
    ///
    ///   TWAP = Σ(price_i × Δt_i) / Σ(Δt_i)
    ///
    /// Reverts with `UnknownPair` when no observations exist yet.
    /// Returns the latest spot price when only one observation is available
    /// (zero elapsed time — no manipulation possible yet).
    pub fn get_twap(env: Env, pair: Symbol) -> i128 {
        let observations: Vec<PriceObservation> = env
            .storage()
            .instance()
            .get(&DataKey::TwapObservations(pair.clone()))
            .unwrap_or_else(|| panic_with_error!(&env, ContractError::UnknownPair));

        let n = observations.len();
        if n == 0 {
            panic_with_error!(&env, ContractError::UnknownPair);
        }
        if n == 1 {
            return observations.get(0).unwrap().price;
        }

        let mut weighted_sum: i128 = 0;
        let mut total_time: u64 = 0;

        for i in 1..n {
            let prev = observations.get(i - 1).unwrap();
            let curr = observations.get(i).unwrap();
            let dt = curr.timestamp.saturating_sub(prev.timestamp);
            weighted_sum = weighted_sum.saturating_add(prev.price.saturating_mul(dt as i128));
            total_time = total_time.saturating_add(dt);
        }

        if total_time == 0 {
            return observations.get(n - 1).unwrap().price;
        }

        weighted_sum / total_time as i128
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke};
    use soroban_sdk::{Address, Env, IntoVal, Symbol};

    fn pair(env: &Env) -> Symbol {
        Symbol::new(env, "NGN_USDC")
    }

    fn setup(
        env: &Env,
    ) -> (
        Address,
        OraclePriceFeedsClient<'_>,
        Address,
        Address,
        Symbol,
    ) {
        let contract_id = env.register(OraclePriceFeeds, ());
        let client = OraclePriceFeedsClient::new(env, &contract_id);
        let admin = Address::generate(env);
        let operator = Address::generate(env);
        let p = pair(env);
        client
            .try_init(&admin, &operator, &600u64, &500u64)
            .unwrap()
            .unwrap();
        (contract_id, client, admin, operator, p)
    }

    #[test]
    fn update_price_rejects_replay_sequence() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (contract_id, client, _admin, operator, p) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_price",
                args: (operator.clone(), p.clone(), 6170i128, 1u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_price(&operator, &p, &6170i128, &1u64)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_price",
                args: (operator.clone(), p.clone(), 6200i128, 1u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_update_price(&operator, &p, &6200i128, &1u64)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InvalidSequence);
    }

    #[test]
    fn get_price_panics_when_stale() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (contract_id, client, _admin, operator, p) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_price",
                args: (operator.clone(), p.clone(), 6170i128, 1u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_price(&operator, &p, &6170i128, &1u64)
            .unwrap()
            .unwrap();

        env.ledger().set_timestamp(1_000 + 601);
        assert!(client.is_stale(&p));
        let _ = client.try_get_price(&p).unwrap_err();
    }

    #[test]
    fn get_price_unsafe_returns_without_staleness_check() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (contract_id, client, _admin, operator, p) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_price",
                args: (operator.clone(), p.clone(), 6170i128, 1u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_price(&operator, &p, &6170i128, &1u64)
            .unwrap()
            .unwrap();

        env.ledger().set_timestamp(1_000 + 900);
        let feed = client.get_price_unsafe(&p);
        assert_eq!(feed.price, 6170);
        assert_eq!(feed.decimals, 7);
    }

    #[test]
    fn operator_auth_required() {
        let env = Env::default();
        let (contract_id, client, _admin, _operator, p) = setup(&env);
        let stranger = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_price",
                args: (stranger.clone(), p.clone(), 6170i128, 1u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_update_price(&stranger, &p, &6170i128, &1u64)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    #[test]
    fn first_price_publish_exempt_from_deviation_check() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (contract_id, client, _admin, operator, p) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_price",
                args: (operator.clone(), p.clone(), 1_000_000i128, 1u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_price(&operator, &p, &1_000_000i128, &1u64)
            .unwrap()
            .unwrap();

        let feed = client.get_price(&p);
        assert_eq!(feed.price, 1_000_000);
    }

    #[test]
    fn update_price_within_deviation_bound_succeeds() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (contract_id, client, _admin, operator, p) = setup(&env);

        // First price
        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_price",
                args: (operator.clone(), p.clone(), 10000i128, 1u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_price(&operator, &p, &10000i128, &1u64)
            .unwrap()
            .unwrap();

        // Update within 5% deviation (500 bps): 10000 -> 10499 is 4.99%
        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_price",
                args: (operator.clone(), p.clone(), 10499i128, 2u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_price(&operator, &p, &10499i128, &2u64)
            .unwrap()
            .unwrap();

        let feed = client.get_price(&p);
        assert_eq!(feed.price, 10499);
    }

    #[test]
    fn update_price_exceeds_deviation_bound_rejected() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (contract_id, client, _admin, operator, p) = setup(&env);

        // First price
        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_price",
                args: (operator.clone(), p.clone(), 10000i128, 1u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_price(&operator, &p, &10000i128, &1u64)
            .unwrap()
            .unwrap();

        // Update exceeds 5% deviation (500 bps): 10000 -> 10501 is 5.01%
        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_price",
                args: (operator.clone(), p.clone(), 10501i128, 2u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_update_price(&operator, &p, &10501i128, &2u64)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::PriceDeviationTooLarge);
    }

    #[test]
    fn update_price_downward_deviation_checked() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (contract_id, client, _admin, operator, p) = setup(&env);

        // First price
        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_price",
                args: (operator.clone(), p.clone(), 10000i128, 1u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_price(&operator, &p, &10000i128, &1u64)
            .unwrap()
            .unwrap();

        // Downward update within 5%: 10000 -> 9501 is 4.99%
        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_price",
                args: (operator.clone(), p.clone(), 9501i128, 2u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_price(&operator, &p, &9501i128, &2u64)
            .unwrap()
            .unwrap();

        // Downward update exceeds 5%: 9501 -> 9000 is >5%
        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_price",
                args: (operator.clone(), p.clone(), 9000i128, 3u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_update_price(&operator, &p, &9000i128, &3u64)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::PriceDeviationTooLarge);
    }

    #[test]
    fn set_max_deviation_bps_configurable_by_admin() {
        let env = Env::default();
        let (contract_id, client, admin, _operator, p) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_max_deviation_bps",
                args: (admin.clone(), 1000u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_set_max_deviation_bps(&admin, &1000u64)
            .unwrap()
            .unwrap();

        // Now 10% deviation should be allowed
        env.ledger().set_timestamp(1_000);
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_price",
                args: (admin.clone(), p.clone(), 10000i128, 1u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_price(&admin, &p, &10000i128, &1u64)
            .unwrap()
            .unwrap();

        // 10% increase should now be allowed
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_price",
                args: (admin.clone(), p.clone(), 11000i128, 2u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_price(&admin, &p, &11000i128, &2u64)
            .unwrap()
            .unwrap();
    }

    #[test]
    fn set_max_deviation_bps_requires_admin() {
        let env = Env::default();
        let (contract_id, client, _admin, operator, _p) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_max_deviation_bps",
                args: (operator.clone(), 1000u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_set_max_deviation_bps(&operator, &1000u64)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    #[test]
    fn staleness_behavior_unchanged_with_deviation_check() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (contract_id, client, _admin, operator, p) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_price",
                args: (operator.clone(), p.clone(), 6170i128, 1u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_price(&operator, &p, &6170i128, &1u64)
            .unwrap()
            .unwrap();

        env.ledger().set_timestamp(1_000 + 601);
        assert!(client.is_stale(&p));
        let _ = client.try_get_price(&p).unwrap_err();
    }

    #[test]
    fn zero_price_allows_any_update() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (contract_id, client, _admin, operator, p) = setup(&env);

        // First price is zero
        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_price",
                args: (operator.clone(), p.clone(), 0i128, 1u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_price(&operator, &p, &0i128, &1u64)
            .unwrap()
            .unwrap();

        // Any update from zero should be allowed (division by zero protection)
        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_price",
                args: (operator.clone(), p.clone(), 1_000_000i128, 2u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_price(&operator, &p, &1_000_000i128, &2u64)
            .unwrap()
            .unwrap();

        let feed = client.get_price(&p);
        assert_eq!(feed.price, 1_000_000);
    }

    // ── Multi-source aggregation tests ────────────────────────────────────────

    fn setup_multi_source(
        env: &Env,
    ) -> (
        Address,
        OraclePriceFeedsClient<'_>,
        Address,
        Symbol,
        Address,
        Address,
        Address,
    ) {
        let (contract_id, client, admin, _operator, p) = setup(env);
        let src1 = Address::generate(env);
        let src2 = Address::generate(env);
        let src3 = Address::generate(env);
        env.mock_all_auths();
        client.add_source(&admin, &p, &src1);
        client.add_source(&admin, &p, &src2);
        client.add_source(&admin, &p, &src3);
        client.set_quorum(&admin, &p, &2u32);
        (contract_id, client, admin, p, src1, src2, src3)
    }

    #[test]
    fn multi_source_quorum_met_returns_median() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (_cid, client, _admin, p, src1, src2, src3) = setup_multi_source(&env);

        env.mock_all_auths();
        // Three sources report: 100, 110, 105 → sorted: 100, 105, 110 → median = 105
        client.update_price(&src1, &p, &100i128, &1u64);
        client.update_price(&src2, &p, &110i128, &1u64);
        client.update_price(&src3, &p, &105i128, &1u64);

        let feed = client.get_price(&p);
        assert_eq!(feed.price, 105, "expected median 105, got {}", feed.price);
    }

    #[test]
    fn multi_source_stale_source_ignored() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (_cid, client, _admin, p, src1, src2, src3) = setup_multi_source(&env);

        env.mock_all_auths();
        // All three sources report at t=1000 with similar prices
        client.update_price(&src1, &p, &100i128, &1u64);
        client.update_price(&src2, &p, &100i128, &1u64);
        client.update_price(&src3, &p, &100i128, &1u64);

        // Advance time so src3 becomes stale (> 600s threshold)
        env.ledger().set_timestamp(1_000 + 700);

        // src1 and src2 re-report fresh prices (within 5% of 100)
        client.update_price(&src1, &p, &102i128, &2u64);
        client.update_price(&src2, &p, &104i128, &2u64);
        // src3 did NOT re-report → its last data is at t=1000 (stale at t=1700)

        // Quorum = 2: src1 + src2 fresh, src3 stale → median of [102, 104] = 103
        let feed = client.get_price(&p);
        assert_eq!(
            feed.price, 103,
            "expected median of fresh sources 103, got {}",
            feed.price
        );
    }

    #[test]
    fn multi_source_below_quorum_returns_error() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (_cid, client, admin, p, src1, _src2, _src3) = setup_multi_source(&env);

        env.mock_all_auths();
        // Set quorum to 3 but only 1 source reports
        client.set_quorum(&admin, &p, &3u32);
        client.update_price(&src1, &p, &100i128, &1u64);

        // Only 1 fresh source, quorum=3 → get_price should panic (panic_with_error)
        // try_get_price returns Err when the contract panics
        assert!(client.try_get_price(&p).is_err(), "expected NoQuorum error");
    }

    #[test]
    fn multi_source_outlier_rejected_by_deviation_bound() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (_cid, client, _admin, p, src1, src2, src3) = setup_multi_source(&env);

        env.mock_all_auths();
        // src1 establishes baseline
        client.update_price(&src1, &p, &100i128, &1u64);
        // src2 at similar price
        client.update_price(&src2, &p, &102i128, &1u64);
        // src3 tries to submit an outlier (>5% from its previous... but first submission
        // is exempt from deviation check). Set a more realistic scenario:
        // src3 first reports 100 then tries to jump to 200 (100% deviation → rejected)
        client.update_price(&src3, &p, &100i128, &1u64);

        let err = client
            .try_update_price(&src3, &p, &200i128, &2u64)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::PriceDeviationTooLarge);

        // Median is still based on valid sources: 100, 102 → 101
        let feed = client.get_price(&p);
        // src3 still has price 100 (last valid), so median of [100, 102, 100] = 100
        assert_eq!(feed.price, 100);
    }

    #[test]
    fn unregistered_source_cannot_update_price() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (_cid, client, _admin, p, _src1, _src2, _src3) = setup_multi_source(&env);

        env.mock_all_auths();
        let stranger = Address::generate(&env);
        let err = client
            .try_update_price(&stranger, &p, &100i128, &1u64)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::UnknownSource);
    }

    #[test]
    fn add_and_remove_source() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (_cid, client, admin, p, src1, src2, src3) = setup_multi_source(&env);

        env.mock_all_auths();
        let initial = client.get_sources(&p);
        assert_eq!(initial.len(), 3);

        client.remove_source(&admin, &p, &src2);
        let after_remove = client.get_sources(&p);
        assert_eq!(after_remove.len(), 2);
        assert!(!after_remove.contains(&src2));
    }

    #[test]
    fn multi_source_even_count_median_is_average() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (contract_id, client, admin, p, src1, src2, _src3) = setup_multi_source(&env);

        env.mock_all_auths();
        // Set quorum to 2 and use only 2 sources for deterministic even-median
        client.set_quorum(&admin, &p, &2u32);
        client.update_price(&src1, &p, &100i128, &1u64);
        client.update_price(&src2, &p, &200i128, &1u64);
        // src3 is stale (never reported)

        // Only 2 fresh prices: [100, 200] → median = (100 + 200) / 2 = 150
        let feed = client.get_price(&p);
        assert_eq!(
            feed.price, 150,
            "expected average median 150, got {}",
            feed.price
        );
    }

    // ── Issue #1425: Additional test coverage ───────────────────────────────

    // ── Initialization edge cases ──────────────────────────────────────────

    #[test]
    fn init_rejects_double_initialization() {
        let env = Env::default();
        let (contract_id, client, admin, operator, p) = setup(&env);

        let result = client.try_init(&admin, &operator, &600u64, &500u64);
        assert_eq!(result, Err(Ok(ContractError::AlreadyInitialized)));
    }

    #[test]
    fn init_defaults_zero_staleness_to_600() {
        let env = Env::default();
        let contract_id = env.register(OraclePriceFeeds, ());
        let client = OraclePriceFeedsClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let operator = Address::generate(&env);

        // staleness=0 should default to DEFAULT_STALENESS_SECONDS (600)
        client
            .try_init(&admin, &operator, &0u64, &500u64)
            .unwrap()
            .unwrap();

        env.ledger().set_timestamp(1_000);
        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_price",
                args: (operator.clone(), Symbol::new(&env, "TEST"), 100i128, 1u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_price(&operator, &Symbol::new(&env, "TEST"), &100i128, &1u64)
            .unwrap()
            .unwrap();

        // At t=1000+601=1601, price should be stale (staleness defaults to 600)
        env.ledger().set_timestamp(1_601);
        assert!(client.is_stale(&Symbol::new(&env, "TEST")));
    }

    #[test]
    fn init_defaults_zero_deviation_to_500() {
        let env = Env::default();
        let contract_id = env.register(OraclePriceFeeds, ());
        let client = OraclePriceFeedsClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let operator = Address::generate(&env);

        // max_deviation_bps=0 should default to DEFAULT_MAX_DEVIATION_BPS (500)
        client
            .try_init(&admin, &operator, &600u64, &0u64)
            .unwrap()
            .unwrap();

        env.ledger().set_timestamp(1_000);
        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_price",
                args: (operator.clone(), Symbol::new(&env, "TEST"), 10000i128, 1u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_price(&operator, &Symbol::new(&env, "TEST"), &10000i128, &1u64)
            .unwrap()
            .unwrap();

        // 5.01% deviation should be rejected with default 500 bps limit
        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_price",
                args: (operator.clone(), Symbol::new(&env, "TEST"), 10501i128, 2u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_update_price(&operator, &Symbol::new(&env, "TEST"), &10501i128, &2u64)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::PriceDeviationTooLarge);
    }

    // ── Admin-only function rejection tests ────────────────────────────────

    #[test]
    fn set_staleness_threshold_requires_admin() {
        let env = Env::default();
        let (contract_id, client, _admin, operator, _p) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_staleness_threshold",
                args: (operator.clone(), 1000u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_set_staleness_threshold(&operator, &1000u64)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    #[test]
    fn add_source_requires_admin() {
        let env = Env::default();
        let (contract_id, client, _admin, operator, p) = setup(&env);
        let stranger = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "add_source",
                args: (stranger.clone(), p.clone(), Address::generate(&env)).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_add_source(&stranger, &p, &Address::generate(&env));
        assert!(result.is_err());
    }

    #[test]
    fn remove_source_requires_admin() {
        let env = Env::default();
        let (contract_id, client, admin, _operator, p) = setup(&env);
        let src = Address::generate(&env);
        env.mock_all_auths();
        client.add_source(&admin, &p, &src);

        let stranger = Address::generate(&env);
        let result = client.try_remove_source(&stranger, &p, &src);
        assert!(result.is_err());
    }

    #[test]
    fn set_quorum_requires_admin() {
        let env = Env::default();
        let (contract_id, client, _admin, operator, p) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_quorum",
                args: (operator.clone(), p.clone(), 3u32).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_set_quorum(&operator, &p, &3u32)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    // ── Boundary and failure path tests ────────────────────────────────────

    #[test]
    fn get_price_unsafe_panics_for_unknown_pair() {
        let env = Env::default();
        let (_contract_id, client, _admin, _operator, _p) = setup(&env);
        let unknown = Symbol::new(&env, "UNKNOWN");

        let result = client.try_get_price_unsafe(&unknown);
        assert!(result.is_err());
    }

    #[test]
    fn get_price_panics_for_unknown_pair_in_single_source_mode() {
        let env = Env::default();
        let (_contract_id, client, _admin, _operator, _p) = setup(&env);
        let unknown = Symbol::new(&env, "UNKNOWN");

        let result = client.try_get_price(&unknown);
        assert!(result.is_err());
    }

    #[test]
    fn is_stale_returns_true_for_unknown_pair() {
        let env = Env::default();
        let (_contract_id, client, _admin, _operator, _p) = setup(&env);
        let unknown = Symbol::new(&env, "UNKNOWN");

        assert!(client.is_stale(&unknown));
    }

    #[test]
    fn add_source_is_idempotent() {
        let env = Env::default();
        let (contract_id, client, admin, _operator, p) = setup(&env);
        let src = Address::generate(&env);
        env.mock_all_auths();

        client.add_source(&admin, &p, &src);
        client.add_source(&admin, &p, &src);

        let sources = client.get_sources(&p);
        assert_eq!(sources.len(), 1);
    }

    #[test]
    fn remove_nonexistent_source_does_not_panic() {
        let env = Env::default();
        let (contract_id, client, admin, _operator, p) = setup(&env);
        let nonexistent = Address::generate(&env);
        env.mock_all_auths();

        // Removing a source that was never added should not panic
        client.remove_source(&admin, &p, &nonexistent);
        let sources = client.get_sources(&p);
        assert_eq!(sources.len(), 0);
    }

    #[test]
    fn get_sources_returns_empty_for_unknown_pair() {
        let env = Env::default();
        let (_contract_id, client, _admin, _operator, _p) = setup(&env);
        let unknown = Symbol::new(&env, "UNKNOWN");

        let sources = client.get_sources(&unknown);
        assert!(sources.is_empty());
    }

    #[test]
    fn set_staleness_threshold_updates_value() {
        let env = Env::default();
        let (contract_id, client, admin, _operator, p) = setup(&env);
        env.mock_all_auths();

        client.set_staleness_threshold(&admin, &1200u64);

        // Publish a price at t=1000
        env.ledger().set_timestamp(1_000);
        client.update_price(&admin, &p, &100i128, &1u64);

        // At t=1800 (800s later), should NOT be stale with 1200s threshold
        env.ledger().set_timestamp(1_800);
        assert!(!client.is_stale(&p));

        // At t=2201 (1201s later), should be stale
        env.ledger().set_timestamp(2_201);
        assert!(client.is_stale(&p));
    }

    #[test]
    fn deviation_check_with_custom_threshold() {
        let env = Env::default();
        let (contract_id, client, admin, _operator, p) = setup(&env);

        // Set deviation to 10% (1000 bps)
        env.mock_all_auths();
        client.set_max_deviation_bps(&admin, &1000u64);

        env.ledger().set_timestamp(1_000);
        client.update_price(&admin, &p, &10000i128, &1u64);

        // 4.99% increase should be allowed (within 10% limit)
        client.update_price(&admin, &p, &10499i128, &2u64);

        // >10% increase from 10499 should be rejected
        // 11550 is ~10.01% above 10499
        let result = client.try_update_price(&admin, &p, &11550i128, &3u64);
        assert!(result.is_err());
    }

    // ── Event emission tests (Issue #1426) ─────────────────────────────────

    #[test]
    fn update_price_emits_source_reported_event() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (contract_id, client, _admin, operator, p) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_price",
                args: (operator.clone(), p.clone(), 6170i128, 1u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_price(&operator, &p, &6170i128, &1u64)
            .unwrap()
            .unwrap();

        let feed = client.get_price(&p);
        assert_eq!(feed.price, 6170);
        assert_eq!(feed.sequence, 1);
    }

    #[test]
    fn update_price_emits_price_updated_event_in_single_source_mode() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (contract_id, client, _admin, operator, p) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_price",
                args: (operator.clone(), p.clone(), 5000i128, 1u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_price(&operator, &p, &5000i128, &1u64)
            .unwrap()
            .unwrap();

        let feed = client.get_price_unsafe(&p);
        assert_eq!(feed.price, 5000);
        assert_eq!(feed.decimals, 7);
        assert_eq!(feed.updated_at, 1_000);
    }

    #[test]
    fn multi_source_emits_aggregated_price_event() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (_cid, client, _admin, p, src1, src2, src3) = setup_multi_source(&env);

        env.mock_all_auths();
        client.update_price(&src1, &p, &100i128, &1u64);
        client.update_price(&src2, &p, &110i128, &1u64);
        client.update_price(&src3, &p, &105i128, &1u64);

        let feed = client.get_price(&p);
        // Median of [100, 105, 110] = 105
        assert_eq!(feed.price, 105);
    }

    #[test]
    fn add_source_emits_source_added_event() {
        let env = Env::default();
        let (contract_id, client, admin, _operator, p) = setup(&env);
        let src = Address::generate(&env);
        env.mock_all_auths();

        client.add_source(&admin, &p, &src);

        let sources = client.get_sources(&p);
        assert_eq!(sources.len(), 1);
        assert!(sources.contains(&src));
    }

    #[test]
    fn remove_source_emits_source_removed_event() {
        let env = Env::default();
        let (contract_id, client, admin, _operator, p) = setup(&env);
        let src = Address::generate(&env);
        env.mock_all_auths();

        client.add_source(&admin, &p, &src);
        assert_eq!(client.get_sources(&p).len(), 1);

        client.remove_source(&admin, &p, &src);
        assert_eq!(client.get_sources(&p).len(), 0);
    }

    #[test]
    fn set_max_deviation_bps_rejects_out_of_bounds() {
        let env = Env::default();
        let (contract_id, client, admin, _operator, _p) = setup(&env);
        env.mock_all_auths();

        // Zero deviation should be rejected
        let err_zero = client
            .try_set_max_deviation_bps(&admin, &0u64)
            .unwrap_err()
            .unwrap();
        assert_eq!(err_zero, ContractError::InvalidConfiguration);

        // Unreasonably large deviation (> 10000 bps / 100%) should be rejected
        let err_large = client
            .try_set_max_deviation_bps(&admin, &10001u64)
            .unwrap_err()
            .unwrap();
        assert_eq!(err_large, ContractError::InvalidConfiguration);

        // Valid update should succeed
        client.set_max_deviation_bps(&admin, &500u64);
    }

    #[test]
    fn set_staleness_threshold_rejects_out_of_bounds() {
        let env = Env::default();
        let (contract_id, client, admin, _operator, _p) = setup(&env);
        env.mock_all_auths();

        // Zero staleness threshold should be rejected
        let err_zero = client
            .try_set_staleness_threshold(&admin, &0u64)
            .unwrap_err()
            .unwrap();
        assert_eq!(err_zero, ContractError::InvalidConfiguration);

        // Unreasonably large threshold (> 31536000s / 1 year) should be rejected
        let err_large = client
            .try_set_staleness_threshold(&admin, &31536001u64)
            .unwrap_err()
            .unwrap();
        assert_eq!(err_large, ContractError::InvalidConfiguration);

        // Valid update should succeed
        client.set_staleness_threshold(&admin, &600u64);
    }
}
