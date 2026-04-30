#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, Symbol, Vec};

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_STALENESS_SECONDS: u64 = 300;

// ── Types ─────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PriceRecord {
    /// Price scaled by 1e7 (e.g., 1.5000000 USD = 15_000_000i128)
    pub price: i128,
    /// Ledger timestamp when this price was recorded by the feed
    pub timestamp: u64,
    /// The feed that produced this record
    pub feed_id: Symbol,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DegradationPolicy {
    Reject,
    UseConservativeEstimate,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Paused,
    /// Feed contract address keyed by feed_id
    FeedAddress(Symbol),
    /// Ordered feed chain for an asset pair
    FeedChain(Symbol),
    /// Staleness limit in seconds per feed
    StalenessLimit(Symbol),
    /// Degradation policy per asset pair
    DegradationPolicy(Symbol),
    /// Conservative estimate price (scaled 1e7) per asset pair
    ConservativeEstimate(Symbol),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    // General errors (1–99)
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    Paused = 3,
    InvalidAmount = 4,
    // Oracle-specific errors (100–199)
    UnknownFeed = 100,
    NoFeedChain = 101,
    NoPriceFeedAvailable = 102,
    ConservativeEstimateNotSet = 103,
    StalePriceRecord = 104,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct OraclePriceFeeds;

// ── Internal helpers ──────────────────────────────────────────────────────────

fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<_, Address>(&DataKey::Admin)
        .expect("admin not set")
}

fn require_admin(env: &Env, caller: &Address) -> Result<(), ContractError> {
    caller.require_auth();
    if caller != &get_admin(env) {
        return Err(ContractError::NotAuthorized);
    }
    Ok(())
}

fn require_not_paused(env: &Env) -> Result<(), ContractError> {
    let paused = env
        .storage()
        .instance()
        .get::<_, bool>(&DataKey::Paused)
        .unwrap_or(false);
    if paused {
        return Err(ContractError::Paused);
    }
    Ok(())
}

/// Returns true when the price record is stale relative to `now`.
/// Future timestamps (timestamp > now) are always treated as stale.
pub fn is_stale(now: u64, record_timestamp: u64, staleness_limit: u64) -> bool {
    if record_timestamp > now {
        return true;
    }
    let age = now - record_timestamp;
    age > staleness_limit
}

fn emit(env: &Env, event_name: &str, data: impl soroban_sdk::IntoVal<Env, soroban_sdk::Val>) {
    env.events().publish(
        (
            Symbol::new(env, "oracle_price_feeds"),
            Symbol::new(env, event_name),
        ),
        data,
    );
}

// ── Contract implementation ───────────────────────────────────────────────────

#[contractimpl]
impl OraclePriceFeeds {
    // ── Lifecycle ─────────────────────────────────────────────────────────────

    pub fn init(env: Env, admin: Address) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
        emit(&env, "init", admin);
        Ok(())
    }

    pub fn pause(env: Env, admin: Address) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &true);
        emit(&env, "pause", admin);
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &false);
        emit(&env, "unpause", admin);
        Ok(())
    }

    pub fn set_admin(env: Env, admin: Address, new_admin: Address) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        emit(&env, "set_admin", new_admin);
        Ok(())
    }

    // ── Feed Registration ─────────────────────────────────────────────────────

    pub fn register_feed(
        env: Env,
        admin: Address,
        feed_id: Symbol,
        feed_address: Address,
    ) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        env.storage()
            .persistent()
            .set(&DataKey::FeedAddress(feed_id.clone()), &feed_address);
        emit(&env, "register_feed", (feed_id, feed_address));
        Ok(())
    }

    // ── FeedChain Configuration ───────────────────────────────────────────────

    pub fn set_feed_chain(
        env: Env,
        admin: Address,
        asset_pair: Symbol,
        chain: Vec<Symbol>,
    ) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        // Validate all feed_ids are registered
        for feed_id in chain.iter() {
            if !env
                .storage()
                .persistent()
                .has(&DataKey::FeedAddress(feed_id.clone()))
            {
                return Err(ContractError::UnknownFeed);
            }
        }
        env.storage()
            .persistent()
            .set(&DataKey::FeedChain(asset_pair.clone()), &chain);
        emit(&env, "set_feed_chain", asset_pair);
        Ok(())
    }

    pub fn get_feed_chain(env: Env, asset_pair: Symbol) -> Result<Vec<Symbol>, ContractError> {
        env.storage()
            .persistent()
            .get::<_, Vec<Symbol>>(&DataKey::FeedChain(asset_pair))
            .ok_or(ContractError::NoFeedChain)
    }

    // ── Staleness Configuration ───────────────────────────────────────────────

    pub fn set_staleness_limit(
        env: Env,
        admin: Address,
        feed_id: Symbol,
        max_age_seconds: u64,
    ) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        env.storage()
            .persistent()
            .set(&DataKey::StalenessLimit(feed_id.clone()), &max_age_seconds);
        emit(&env, "set_staleness_limit", (feed_id, max_age_seconds));
        Ok(())
    }

    pub fn get_staleness_limit(env: Env, feed_id: Symbol) -> u64 {
        env.storage()
            .persistent()
            .get::<_, u64>(&DataKey::StalenessLimit(feed_id))
            .unwrap_or(DEFAULT_STALENESS_SECONDS)
    }

    // ── Degradation Policy ────────────────────────────────────────────────────

    pub fn set_degradation_policy(
        env: Env,
        admin: Address,
        asset_pair: Symbol,
        policy: DegradationPolicy,
    ) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        env.storage()
            .persistent()
            .set(&DataKey::DegradationPolicy(asset_pair.clone()), &policy);
        emit(&env, "set_degradation_policy", asset_pair);
        Ok(())
    }

    pub fn set_conservative_estimate(
        env: Env,
        admin: Address,
        asset_pair: Symbol,
        price: i128,
    ) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        if price <= 0 {
            return Err(ContractError::InvalidAmount);
        }
        env.storage()
            .persistent()
            .set(&DataKey::ConservativeEstimate(asset_pair.clone()), &price);
        emit(&env, "set_conservative_estimate", (asset_pair, price));
        Ok(())
    }

    // ── Price Query ───────────────────────────────────────────────────────────

    pub fn get_price(env: Env, asset_pair: Symbol) -> Result<PriceRecord, ContractError> {
        require_not_paused(&env)?;

        let chain = env
            .storage()
            .persistent()
            .get::<_, Vec<Symbol>>(&DataKey::FeedChain(asset_pair.clone()))
            .ok_or(ContractError::NoFeedChain)?;

        let now = env.ledger().timestamp();
        let mut skipped: Vec<Symbol> = Vec::new(&env);

        for feed_id in chain.iter() {
            let feed_addr = match env
                .storage()
                .persistent()
                .get::<_, Address>(&DataKey::FeedAddress(feed_id.clone()))
            {
                Some(a) => a,
                None => {
                    skipped.push_back(feed_id.clone());
                    continue;
                }
            };

            let staleness_limit = env
                .storage()
                .persistent()
                .get::<_, u64>(&DataKey::StalenessLimit(feed_id.clone()))
                .unwrap_or(DEFAULT_STALENESS_SECONDS);

            // Cross-contract call to the feed adapter
            let record_opt: Option<PriceRecord> = env.invoke_contract(
                &feed_addr,
                &Symbol::new(&env, "get_price"),
                soroban_sdk::vec![&env],
            );

            let record = match record_opt {
                Some(r) => r,
                None => {
                    skipped.push_back(feed_id.clone());
                    continue;
                }
            };

            if is_stale(now, record.timestamp, staleness_limit) {
                let age = if record.timestamp > now {
                    u64::MAX
                } else {
                    now - record.timestamp
                };
                emit(
                    &env,
                    "staleness_warning",
                    (asset_pair.clone(), feed_id.clone(), age, staleness_limit),
                );
                skipped.push_back(feed_id.clone());
                continue;
            }

            // Fresh price found
            if !skipped.is_empty() {
                emit(
                    &env,
                    "fallback_used",
                    (asset_pair.clone(), feed_id.clone(), skipped),
                );
            }
            emit(
                &env,
                "price_updated",
                (asset_pair, feed_id, record.price, record.timestamp),
            );
            return Ok(record);
        }

        // No fresh price found — apply degradation policy
        emit(&env, "no_price_available", asset_pair.clone());

        let policy = env
            .storage()
            .persistent()
            .get::<_, DegradationPolicy>(&DataKey::DegradationPolicy(asset_pair.clone()))
            .unwrap_or(DegradationPolicy::Reject);

        match policy {
            DegradationPolicy::Reject => Err(ContractError::NoPriceFeedAvailable),
            DegradationPolicy::UseConservativeEstimate => {
                let estimate = env
                    .storage()
                    .persistent()
                    .get::<_, i128>(&DataKey::ConservativeEstimate(asset_pair.clone()))
                    .ok_or(ContractError::ConservativeEstimateNotSet)?;
                emit(
                    &env,
                    "conservative_estimate_used",
                    (asset_pair.clone(), estimate),
                );
                Ok(PriceRecord {
                    price: estimate,
                    timestamp: now,
                    feed_id: Symbol::new(&env, "conservative"),
                })
            }
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod test {
    extern crate std;

    use super::{
        ContractError, DegradationPolicy, OraclePriceFeeds, OraclePriceFeedsClient, PriceRecord,
    };
    use soroban_sdk::testutils::{Address as _, Events, Ledger as _};
    use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, TryFromVal, Vec};

    // ── Stub feed contract ────────────────────────────────────────────────────
    // A minimal feed adapter used in tests. Its price and availability are
    // controlled via instance storage so tests can simulate stale / missing data.

    #[contract]
    pub struct StubFeed;

    #[contractimpl]
    impl StubFeed {
        /// Store a price record that `get_price` will return.
        pub fn set_price(env: Env, price: i128, timestamp: u64, feed_id: Symbol) {
            env.storage()
                .instance()
                .set(&Symbol::new(&env, "price"), &price);
            env.storage()
                .instance()
                .set(&Symbol::new(&env, "ts"), &timestamp);
            env.storage()
                .instance()
                .set(&Symbol::new(&env, "fid"), &feed_id);
        }

        /// Mark the feed as unavailable (returns None).
        pub fn set_unavailable(env: Env) {
            env.storage()
                .instance()
                .set(&Symbol::new(&env, "unavail"), &true);
        }

        /// The oracle contract calls this via cross-contract invocation.
        pub fn get_price(env: Env) -> Option<PriceRecord> {
            let unavail = env
                .storage()
                .instance()
                .get::<_, bool>(&Symbol::new(&env, "unavail"))
                .unwrap_or(false);
            if unavail {
                return None;
            }
            let price = env
                .storage()
                .instance()
                .get::<_, i128>(&Symbol::new(&env, "price"))?;
            let timestamp = env
                .storage()
                .instance()
                .get::<_, u64>(&Symbol::new(&env, "ts"))?;
            let feed_id = env
                .storage()
                .instance()
                .get::<_, Symbol>(&Symbol::new(&env, "fid"))?;
            Some(PriceRecord {
                price,
                timestamp,
                feed_id,
            })
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn setup(env: &Env) -> (Address, OraclePriceFeedsClient<'_>) {
        let contract_id = env.register(OraclePriceFeeds, ());
        let client = OraclePriceFeedsClient::new(env, &contract_id);
        let admin = Address::generate(env);
        env.mock_all_auths();
        client.try_init(&admin).unwrap().unwrap();
        (admin, client)
    }

    fn register_stub_feed(
        env: &Env,
        client: &OraclePriceFeedsClient,
        admin: &Address,
        feed_id: &Symbol,
        price: i128,
        timestamp: u64,
    ) -> Address {
        let feed_addr = env.register(StubFeed, ());
        let feed_client = StubFeedClient::new(env, &feed_addr);
        feed_client.set_price(&price, &timestamp, feed_id);
        client
            .try_register_feed(admin, feed_id, &feed_addr)
            .unwrap()
            .unwrap();
        feed_addr
    }

    fn register_unavailable_feed(
        env: &Env,
        client: &OraclePriceFeedsClient,
        admin: &Address,
        feed_id: &Symbol,
    ) -> Address {
        let feed_addr = env.register(StubFeed, ());
        let feed_client = StubFeedClient::new(env, &feed_addr);
        feed_client.set_unavailable();
        client
            .try_register_feed(admin, feed_id, &feed_addr)
            .unwrap()
            .unwrap();
        feed_addr
    }

    // ── is_stale unit tests ───────────────────────────────────────────────────

    #[test]
    fn is_stale_fresh_at_boundary() {
        // age == limit → fresh
        assert!(!super::is_stale(1000, 700, 300));
    }

    #[test]
    fn is_stale_stale_one_over_boundary() {
        // age == limit + 1 → stale
        assert!(super::is_stale(1000, 699, 300));
    }

    #[test]
    fn is_stale_future_timestamp() {
        // timestamp in the future → always stale
        assert!(super::is_stale(1000, 1001, 300));
    }

    #[test]
    fn is_stale_zero_age() {
        // age == 0 → fresh for any limit >= 0
        assert!(!super::is_stale(1000, 1000, 0));
    }

    // ── init tests ────────────────────────────────────────────────────────────

    #[test]
    fn init_sets_admin_and_rejects_double_init() {
        let env = Env::default();
        let contract_id = env.register(OraclePriceFeeds, ());
        let client = OraclePriceFeedsClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        env.mock_all_auths();

        client.try_init(&admin).unwrap().unwrap();

        let err = client.try_init(&admin).unwrap_err().unwrap();
        assert_eq!(err, ContractError::AlreadyInitialized);
    }

    // ── pause / unpause tests ─────────────────────────────────────────────────

    #[test]
    fn pause_blocks_get_price_and_unpause_restores() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, client) = setup(&env);

        let fid = Symbol::new(&env, "xlm_usd");
        env.ledger().set_timestamp(1000);
        register_stub_feed(&env, &client, &admin, &fid, 10_000_000, 900);

        let mut chain = Vec::new(&env);
        chain.push_back(fid.clone());
        client
            .try_set_feed_chain(&admin, &Symbol::new(&env, "xlm_usd"), &chain)
            .unwrap()
            .unwrap();

        client.try_pause(&admin).unwrap().unwrap();
        let err = client
            .try_get_price(&Symbol::new(&env, "xlm_usd"))
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::Paused);

        client.try_unpause(&admin).unwrap().unwrap();
        let record = client
            .try_get_price(&Symbol::new(&env, "xlm_usd"))
            .unwrap()
            .unwrap();
        assert_eq!(record.price, 10_000_000);
    }

    #[test]
    fn non_admin_pause_returns_not_authorized() {
        let env = Env::default();
        env.mock_all_auths();
        let (_admin, client) = setup(&env);
        let non_admin = Address::generate(&env);

        let err = client.try_pause(&non_admin).unwrap_err().unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    // ── set_admin tests ───────────────────────────────────────────────────────

    #[test]
    fn set_admin_transfers_rights() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, client) = setup(&env);
        let new_admin = Address::generate(&env);

        client.try_set_admin(&admin, &new_admin).unwrap().unwrap();

        // old admin can no longer pause
        let err = client.try_pause(&admin).unwrap_err().unwrap();
        assert_eq!(err, ContractError::NotAuthorized);

        // new admin can pause
        client.try_pause(&new_admin).unwrap().unwrap();
    }

    // ── register_feed / set_feed_chain tests ──────────────────────────────────

    #[test]
    fn set_feed_chain_rejects_unregistered_feed() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, client) = setup(&env);

        let unknown = Symbol::new(&env, "ghost_feed");
        let mut chain = Vec::new(&env);
        chain.push_back(unknown);

        let err = client
            .try_set_feed_chain(&admin, &Symbol::new(&env, "xlm_usd"), &chain)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::UnknownFeed);
    }

    #[test]
    fn get_feed_chain_round_trip() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, client) = setup(&env);

        let fid1 = Symbol::new(&env, "feed_a");
        let fid2 = Symbol::new(&env, "feed_b");
        let pair = Symbol::new(&env, "xlm_usd");

        let addr1 = env.register(StubFeed, ());
        let addr2 = env.register(StubFeed, ());
        client
            .try_register_feed(&admin, &fid1, &addr1)
            .unwrap()
            .unwrap();
        client
            .try_register_feed(&admin, &fid2, &addr2)
            .unwrap()
            .unwrap();

        let mut chain = Vec::new(&env);
        chain.push_back(fid1.clone());
        chain.push_back(fid2.clone());
        client
            .try_set_feed_chain(&admin, &pair, &chain)
            .unwrap()
            .unwrap();

        let stored = client.try_get_feed_chain(&pair).unwrap().unwrap();
        assert_eq!(stored.get(0).unwrap(), fid1);
        assert_eq!(stored.get(1).unwrap(), fid2);
    }

    // ── get_price: primary feed fresh ────────────────────────────────────────

    #[test]
    fn get_price_returns_primary_when_fresh() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1000);
        let (admin, client) = setup(&env);

        let fid = Symbol::new(&env, "xlm_usd");
        let pair = Symbol::new(&env, "xlm_usd");
        register_stub_feed(&env, &client, &admin, &fid, 15_000_000, 900); // age=100, limit=300

        let mut chain = Vec::new(&env);
        chain.push_back(fid.clone());
        client
            .try_set_feed_chain(&admin, &pair, &chain)
            .unwrap()
            .unwrap();

        let record = client.try_get_price(&pair).unwrap().unwrap();
        assert_eq!(record.price, 15_000_000);
        assert_eq!(record.feed_id, fid);
    }

    // ── get_price: primary stale, fallback fresh ──────────────────────────────

    #[test]
    fn get_price_falls_back_when_primary_stale() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1000);
        let (admin, client) = setup(&env);

        let fid_primary = Symbol::new(&env, "primary");
        let fid_fallback = Symbol::new(&env, "fallback");
        let pair = Symbol::new(&env, "xlm_usd");

        register_stub_feed(&env, &client, &admin, &fid_primary, 5_000_000, 300);
        register_stub_feed(&env, &client, &admin, &fid_fallback, 20_000_000, 950);

        let mut chain = Vec::new(&env);
        chain.push_back(fid_primary.clone());
        chain.push_back(fid_fallback.clone());
        client
            .try_set_feed_chain(&admin, &pair, &chain)
            .unwrap()
            .unwrap();

        let record = client.try_get_price(&pair).unwrap().unwrap();
        assert_eq!(record.price, 20_000_000);
        assert_eq!(record.feed_id, fid_fallback);
    }

    // ── get_price: all stale, Reject policy ──────────────────────────────────

    #[test]
    fn get_price_rejects_when_all_stale_and_reject_policy() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1000);
        let (admin, client) = setup(&env);

        let fid = Symbol::new(&env, "stale_feed");
        let pair = Symbol::new(&env, "xlm_usd");
        register_stub_feed(&env, &client, &admin, &fid, 5_000_000, 100);

        let mut chain = Vec::new(&env);
        chain.push_back(fid);
        client
            .try_set_feed_chain(&admin, &pair, &chain)
            .unwrap()
            .unwrap();

        let err = client.try_get_price(&pair).unwrap_err().unwrap();
        assert_eq!(err, ContractError::NoPriceFeedAvailable);
    }

    // ── get_price: all stale, UseConservativeEstimate ─────────────────────────

    #[test]
    fn get_price_returns_conservative_estimate_when_all_stale() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1000);
        let (admin, client) = setup(&env);

        let fid = Symbol::new(&env, "stale_feed");
        let pair = Symbol::new(&env, "xlm_usd");
        register_stub_feed(&env, &client, &admin, &fid, 5_000_000, 100);

        let mut chain = Vec::new(&env);
        chain.push_back(fid);
        client
            .try_set_feed_chain(&admin, &pair, &chain)
            .unwrap()
            .unwrap();
        client
            .try_set_degradation_policy(&admin, &pair, &DegradationPolicy::UseConservativeEstimate)
            .unwrap()
            .unwrap();
        client
            .try_set_conservative_estimate(&admin, &pair, &8_000_000i128)
            .unwrap()
            .unwrap();

        let record = client.try_get_price(&pair).unwrap().unwrap();
        assert_eq!(record.price, 8_000_000);
        assert_eq!(record.feed_id, Symbol::new(&env, "conservative"));
    }

    // ── get_price: unavailable feed ───────────────────────────────────────────

    #[test]
    fn get_price_skips_unavailable_feed_and_uses_fallback() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1000);
        let (admin, client) = setup(&env);

        let fid_unavail = Symbol::new(&env, "unavail");
        let fid_good = Symbol::new(&env, "good");
        let pair = Symbol::new(&env, "xlm_usd");

        register_unavailable_feed(&env, &client, &admin, &fid_unavail);
        register_stub_feed(&env, &client, &admin, &fid_good, 12_000_000, 990);

        let mut chain = Vec::new(&env);
        chain.push_back(fid_unavail);
        chain.push_back(fid_good.clone());
        client
            .try_set_feed_chain(&admin, &pair, &chain)
            .unwrap()
            .unwrap();

        let record = client.try_get_price(&pair).unwrap().unwrap();
        assert_eq!(record.price, 12_000_000);
        assert_eq!(record.feed_id, fid_good);
    }

    // ── get_price: no feed chain ──────────────────────────────────────────────

    #[test]
    fn get_price_returns_no_feed_chain_when_unconfigured() {
        let env = Env::default();
        env.mock_all_auths();
        let (_admin, client) = setup(&env);

        let err = client
            .try_get_price(&Symbol::new(&env, "btc_usd"))
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NoFeedChain);
    }

    // ── future timestamp treated as stale ─────────────────────────────────────

    #[test]
    fn get_price_treats_future_timestamp_as_stale() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1000);
        let (admin, client) = setup(&env);

        let fid = Symbol::new(&env, "future_feed");
        let pair = Symbol::new(&env, "xlm_usd");
        register_stub_feed(&env, &client, &admin, &fid, 5_000_000, 2000);

        let mut chain = Vec::new(&env);
        chain.push_back(fid);
        client
            .try_set_feed_chain(&admin, &pair, &chain)
            .unwrap()
            .unwrap();

        let err = client.try_get_price(&pair).unwrap_err().unwrap();
        assert_eq!(err, ContractError::NoPriceFeedAvailable);
    }

    // ── non-admin config rejection ────────────────────────────────────────────

    #[test]
    fn non_admin_register_feed_returns_not_authorized() {
        let env = Env::default();
        env.mock_all_auths();
        let (_admin, client) = setup(&env);
        let non_admin = Address::generate(&env);
        let feed_addr = env.register(StubFeed, ());

        let err = client
            .try_register_feed(&non_admin, &Symbol::new(&env, "feed_x"), &feed_addr)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    #[test]
    fn non_admin_set_feed_chain_returns_not_authorized() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, client) = setup(&env);
        let non_admin = Address::generate(&env);

        let fid = Symbol::new(&env, "feed_x");
        let addr = env.register(StubFeed, ());
        client
            .try_register_feed(&admin, &fid, &addr)
            .unwrap()
            .unwrap();

        let mut chain = Vec::new(&env);
        chain.push_back(fid);
        let err = client
            .try_set_feed_chain(&non_admin, &Symbol::new(&env, "xlm_usd"), &chain)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    // ── staleness limit configuration ─────────────────────────────────────────

    #[test]
    fn custom_staleness_limit_is_respected() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1000);
        let (admin, client) = setup(&env);

        let fid = Symbol::new(&env, "fast_feed");
        let pair = Symbol::new(&env, "xlm_usd");
        register_stub_feed(&env, &client, &admin, &fid, 5_000_000, 950);
        client
            .try_set_staleness_limit(&admin, &fid, &30u64)
            .unwrap()
            .unwrap();

        let mut chain = Vec::new(&env);
        chain.push_back(fid);
        client
            .try_set_feed_chain(&admin, &pair, &chain)
            .unwrap()
            .unwrap();

        let err = client.try_get_price(&pair).unwrap_err().unwrap();
        assert_eq!(err, ContractError::NoPriceFeedAvailable);
    }

    #[test]
    fn default_staleness_limit_is_300() {
        let env = Env::default();
        env.mock_all_auths();
        let (_admin, client) = setup(&env);
        let limit = client.get_staleness_limit(&Symbol::new(&env, "any_feed"));
        assert_eq!(limit, 300u64);
    }

    // ── events: oracle_price_feeds prefix ────────────────────────────────────

    #[test]
    fn all_emitted_events_have_oracle_price_feeds_prefix() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1000);
        let (admin, client) = setup(&env);

        let fid = Symbol::new(&env, "xlm_usd");
        let pair = Symbol::new(&env, "xlm_usd");
        register_stub_feed(&env, &client, &admin, &fid, 10_000_000, 900);

        let mut chain = Vec::new(&env);
        chain.push_back(fid);
        client
            .try_set_feed_chain(&admin, &pair, &chain)
            .unwrap()
            .unwrap();
        client.try_get_price(&pair).unwrap().unwrap();

        let events = env.events().all();
        let prefix = Symbol::new(&env, "oracle_price_feeds");
        for event in events.iter() {
            let topics = event.1;
            let first = topics.get(0).unwrap();
            let first_sym = Symbol::try_from_val(&env, &first).unwrap();
            assert_eq!(first_sym, prefix, "event topic prefix mismatch");
        }
    }

    // ── events: price_updated on success ─────────────────────────────────────

    #[test]
    fn successful_get_price_emits_price_updated_event() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1000);
        let (admin, client) = setup(&env);

        let fid = Symbol::new(&env, "xlm_usd");
        let pair = Symbol::new(&env, "xlm_usd");
        register_stub_feed(&env, &client, &admin, &fid, 10_000_000, 900);

        let mut chain = Vec::new(&env);
        chain.push_back(fid.clone());
        client
            .try_set_feed_chain(&admin, &pair, &chain)
            .unwrap()
            .unwrap();
        client.try_get_price(&pair).unwrap().unwrap();

        let events = env.events().all();
        let price_updated = Symbol::new(&env, "price_updated");
        let found = events.iter().any(|e| {
            let topics = e.1;
            topics
                .get(1)
                .and_then(|v| Symbol::try_from_val(&env, &v).ok())
                .map(|t| t == price_updated)
                .unwrap_or(false)
        });
        assert!(found, "price_updated event not emitted");
    }
}
