#![no_std]

use soroban_access_control::{extend_storage_ttl, require_admin_permission};
use soroban_pausable::PausableError;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, vec, Address, Env, IntoVal, Symbol, Vec,
};

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    NotAuthorized = 5001,
    PriceTooStale = 5002,
    InvalidPrice = 5003,
    InvalidDeviation = 5004,
    UnknownPair = 5005,
    QuorumNotMet = 5006,
    Paused = 5007,
}

impl From<PausableError> for ContractError {
    fn from(err: PausableError) -> Self {
        match err {
            PausableError::Paused => ContractError::Paused,
            PausableError::NotAuthorized => ContractError::NotAuthorized,
        }
    }
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceFeed {
    pub pair: Symbol,
    pub price: i128,
    pub decimals: u32,
    pub updated_at: u64,
    pub sequence: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Paused,
    Sources(Symbol),
    Price(Symbol),
    Quorum(Symbol),
    StalenessThreshold,
    MaxDeviationBps,
}

// ────────────────────────────────────────────────────────────────────────────
// Contract
// ────────────────────────────────────────────────────────────────────────────

// Ledger TTL policy. These match `soroban_access_control::extend_storage_ttl`, which
// extends persistent entries: an entry below 10,000 remaining ledgers is extended to
// 500,000 ledgers (about 29 days at a 5 second ledger close). Instance storage (admin,
// pause flag, staleness threshold, deviation bound) uses the same values.
const TTL_THRESHOLD_LEDGERS: u32 = 10_000;
const TTL_EXTEND_TO_LEDGERS: u32 = 500_000;

/// Extends the TTL of the contract instance (admin, pause flag, thresholds).
fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD_LEDGERS, TTL_EXTEND_TO_LEDGERS);
}

/// Extends the TTL of a persistent entry when it exists. Extending a missing key is a
/// host error, so reads of absent keys are skipped.
fn extend_persistent_if_present(env: &Env, key: &DataKey) {
    if env.storage().persistent().has(key) {
        extend_storage_ttl(env, &key.into_val(env));
    }
}

#[contract]
pub struct OraclePriceFeeds;

#[contractimpl]
impl OraclePriceFeeds {
    /// Initialize the contract with an admin.
    pub fn init(env: Env, admin: Address) -> Result<(), ContractError> {
        extend_instance_ttl(&env);
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::NotAuthorized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage()
            .instance()
            .set(&DataKey::StalenessThreshold, &600u64);
        env.storage()
            .instance()
            .set(&DataKey::MaxDeviationBps, &500u32);
        env.events().publish(
            (
                Symbol::new(&env, "oracle"),
                Symbol::new(&env, "initialized"),
            ),
            admin,
        );
        Ok(())
    }

    /// Add an authorized source for a price pair.
    pub fn add_source(
        env: Env,
        admin: Address,
        pair: Symbol,
        source: Address,
    ) -> Result<(), ContractError> {
        extend_instance_ttl(&env);
        let stored_admin = Self::get_admin(&env)?;
        require_admin_permission(
            &env,
            &stored_admin,
            &admin,
            "add_source",
            ContractError::NotAuthorized,
        )?;

        let mut sources = Self::get_sources_internal(&env, &pair);
        if !sources.contains(&source) {
            sources.push_back(source.clone());
            let key = DataKey::Sources(pair.clone());
            env.storage().persistent().set(&key, &sources);
            extend_storage_ttl(&env, &key.into_val(&env));
        }

        env.events().publish(
            (
                Symbol::new(&env, "oracle"),
                Symbol::new(&env, "source_added"),
            ),
            (pair, source),
        );
        Ok(())
    }

    /// Remove an authorized source for a price pair.
    pub fn remove_source(
        env: Env,
        admin: Address,
        pair: Symbol,
        source: Address,
    ) -> Result<(), ContractError> {
        extend_instance_ttl(&env);
        let stored_admin = Self::get_admin(&env)?;
        require_admin_permission(
            &env,
            &stored_admin,
            &admin,
            "remove_source",
            ContractError::NotAuthorized,
        )?;

        let mut sources = vec![&env];
        for existing in Self::get_sources_internal(&env, &pair).iter() {
            if existing != source {
                sources.push_back(existing);
            }
        }
        let key = DataKey::Sources(pair.clone());
        env.storage().persistent().set(&key, &sources);
        extend_storage_ttl(&env, &key.into_val(&env));

        env.events().publish(
            (
                Symbol::new(&env, "oracle"),
                Symbol::new(&env, "source_removed"),
            ),
            (pair, source),
        );
        Ok(())
    }

    /// Get all sources for a pair.
    pub fn get_sources(env: Env, pair: Symbol) -> Vec<Address> {
        extend_instance_ttl(&env);
        Self::get_sources_internal(&env, &pair)
    }

    /// Set the quorum required for a pair.
    pub fn set_quorum(
        env: Env,
        admin: Address,
        pair: Symbol,
        quorum: u32,
    ) -> Result<(), ContractError> {
        extend_instance_ttl(&env);
        let stored_admin = Self::get_admin(&env)?;
        require_admin_permission(
            &env,
            &stored_admin,
            &admin,
            "set_quorum",
            ContractError::NotAuthorized,
        )?;

        let key = DataKey::Quorum(pair.clone());
        env.storage().persistent().set(&key, &quorum);
        extend_storage_ttl(&env, &key.into_val(&env));

        env.events().publish(
            (Symbol::new(&env, "oracle"), Symbol::new(&env, "quorum_set")),
            (pair, quorum),
        );
        Ok(())
    }

    /// Update price for a pair. Only authorized sources can call this.
    /// Rejects non-positive prices and prices that deviate too much from current price.
    pub fn update_price(
        env: Env,
        source: Address,
        pair: Symbol,
        price: i128,
    ) -> Result<(), ContractError> {
        extend_instance_ttl(&env);
        // Check if paused
        if Self::is_paused(env.clone()) {
            return Err(ContractError::Paused);
        }

        source.require_auth();

        // Reject non-positive prices
        if price <= 0 {
            return Err(ContractError::InvalidPrice);
        }

        // Verify source is authorized for this pair
        let sources = Self::get_sources_internal(&env, &pair);
        if !sources.contains(&source) {
            return Err(ContractError::NotAuthorized);
        }

        // Check deviation from current price if one exists
        if let Some(current_feed) = Self::get_price_internal(&env, &pair) {
            let max_deviation_bps = Self::get_max_deviation_bps(&env);
            let deviation_bps = Self::calculate_deviation_bps(current_feed.price, price);
            if deviation_bps > max_deviation_bps {
                return Err(ContractError::InvalidDeviation);
            }
        }

        // Get current sequence or start at 0
        let price_key = DataKey::Price(pair.clone());
        let sequence = if let Some(current_feed) = Self::get_price_internal(&env, &pair) {
            current_feed.sequence + 1
        } else {
            0
        };

        let feed = PriceFeed {
            pair: pair.clone(),
            price,
            decimals: 7,
            updated_at: env.ledger().timestamp(),
            sequence,
        };

        env.storage().persistent().set(&price_key, &feed);
        extend_storage_ttl(&env, &price_key.into_val(&env));

        env.events().publish(
            (
                Symbol::new(&env, "oracle"),
                Symbol::new(&env, "price_updated"),
            ),
            (pair, price),
        );
        Ok(())
    }

    /// Get the current price feed for a pair.
    /// Fails if price is stale or doesn't exist.
    pub fn get_price(env: Env, pair: Symbol) -> Result<PriceFeed, ContractError> {
        extend_instance_ttl(&env);
        let feed = Self::get_price_internal(&env, &pair).ok_or(ContractError::UnknownPair)?;

        let staleness_threshold = Self::get_staleness_threshold(&env);
        let now = env.ledger().timestamp();
        if now.saturating_sub(feed.updated_at) > staleness_threshold {
            return Err(ContractError::PriceTooStale);
        }

        Ok(feed)
    }

    /// Check if a price is stale.
    pub fn is_stale(env: Env, pair: Symbol) -> Result<bool, ContractError> {
        extend_instance_ttl(&env);
        let feed = Self::get_price_internal(&env, &pair).ok_or(ContractError::UnknownPair)?;

        let staleness_threshold = Self::get_staleness_threshold(&env);
        let now = env.ledger().timestamp();
        Ok(now.saturating_sub(feed.updated_at) > staleness_threshold)
    }

    /// Set the staleness threshold (in seconds).
    pub fn set_staleness_threshold(
        env: Env,
        admin: Address,
        threshold: u64,
    ) -> Result<(), ContractError> {
        extend_instance_ttl(&env);
        let stored_admin = Self::get_admin(&env)?;
        require_admin_permission(
            &env,
            &stored_admin,
            &admin,
            "set_staleness_threshold",
            ContractError::NotAuthorized,
        )?;

        let key = DataKey::StalenessThreshold;
        env.storage().instance().set(&key, &threshold);

        env.events().publish(
            (
                Symbol::new(&env, "oracle"),
                Symbol::new(&env, "staleness_threshold_set"),
            ),
            threshold,
        );
        Ok(())
    }

    /// Set the maximum deviation in basis points.
    pub fn set_max_deviation_bps(env: Env, admin: Address, bps: u32) -> Result<(), ContractError> {
        extend_instance_ttl(&env);
        let stored_admin = Self::get_admin(&env)?;
        require_admin_permission(
            &env,
            &stored_admin,
            &admin,
            "set_max_deviation_bps",
            ContractError::NotAuthorized,
        )?;

        let key = DataKey::MaxDeviationBps;
        env.storage().instance().set(&key, &bps);

        env.events().publish(
            (
                Symbol::new(&env, "oracle"),
                Symbol::new(&env, "max_deviation_bps_set"),
            ),
            bps,
        );
        Ok(())
    }

    /// Pause the contract.
    pub fn pause(env: Env, admin: Address) -> Result<(), ContractError> {
        extend_instance_ttl(&env);
        let stored_admin = Self::get_admin(&env)?;
        require_admin_permission(
            &env,
            &stored_admin,
            &admin,
            "pause",
            ContractError::NotAuthorized,
        )?;

        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish(
            (Symbol::new(&env, "oracle"), Symbol::new(&env, "paused")),
            (),
        );
        Ok(())
    }

    /// Unpause the contract.
    pub fn unpause(env: Env, admin: Address) -> Result<(), ContractError> {
        extend_instance_ttl(&env);
        let stored_admin = Self::get_admin(&env)?;
        require_admin_permission(
            &env,
            &stored_admin,
            &admin,
            "unpause",
            ContractError::NotAuthorized,
        )?;

        env.storage().instance().set(&DataKey::Paused, &false);
        env.events().publish(
            (Symbol::new(&env, "oracle"), Symbol::new(&env, "unpaused")),
            (),
        );
        Ok(())
    }

    /// Check if the contract is paused.
    pub fn is_paused(env: Env) -> bool {
        extend_instance_ttl(&env);
        env.storage()
            .instance()
            .get::<_, bool>(&DataKey::Paused)
            .unwrap_or(false)
    }

    // ────────────────────────────────────────────────────────────────────────
    // Helpers
    // ────────────────────────────────────────────────────────────────────────

    fn get_admin(env: &Env) -> Result<Address, ContractError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotAuthorized)
    }

    fn get_price_internal(env: &Env, pair: &Symbol) -> Option<PriceFeed> {
        let key = DataKey::Price(pair.clone());
        let feed = env.storage().persistent().get(&key);
        extend_persistent_if_present(env, &key);
        feed
    }

    fn get_sources_internal(env: &Env, pair: &Symbol) -> Vec<Address> {
        let key = DataKey::Sources(pair.clone());
        let sources = env.storage().persistent().get::<_, Vec<Address>>(&key);
        extend_persistent_if_present(env, &key);
        sources.unwrap_or_else(|| vec![&env])
    }

    fn get_staleness_threshold(env: &Env) -> u64 {
        env.storage()
            .instance()
            .get::<_, u64>(&DataKey::StalenessThreshold)
            .unwrap_or(600)
    }

    fn get_max_deviation_bps(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get::<_, u32>(&DataKey::MaxDeviationBps)
            .unwrap_or(500)
    }

    /// Calculate deviation in basis points between old and new price.
    fn calculate_deviation_bps(old_price: i128, new_price: i128) -> u32 {
        if old_price == 0 {
            return 0;
        }
        let diff = if new_price > old_price {
            new_price - old_price
        } else {
            old_price - new_price
        };
        // bps = (diff / old_price) * 10000
        (diff as u128 * 10000 / old_price as u128) as u32
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};

    fn setup(env: &Env) -> (Address, Symbol, OraclePriceFeedsClient<'_>) {
        env.mock_all_auths();
        let contract_id = env.register(OraclePriceFeeds, ());
        let client = OraclePriceFeedsClient::new(env, &contract_id);
        let admin = Address::generate(env);
        let pair = Symbol::new(env, "NGN_USDC");

        client.init(&admin);
        (admin, pair, client)
    }

    #[test]
    fn init_succeeds() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register(OraclePriceFeeds, ());
        let client = OraclePriceFeedsClient::new(&env, &contract_id);

        client.init(&admin);
        assert!(!client.is_paused());
    }

    #[test]
    fn init_emits_event() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register(OraclePriceFeeds, ());
        let client = OraclePriceFeedsClient::new(&env, &contract_id);

        client.init(&admin);

        let events = env.events().all();
        assert!(!events.is_empty());
    }

    #[test]
    fn add_source_requires_admin() {
        let env = Env::default();
        let (_admin, pair, client) = setup(&env);
        let attacker = Address::generate(&env);
        let source = Address::generate(&env);

        let result = client.try_add_source(&attacker, &pair, &source);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NotAuthorized);
    }

    #[test]
    fn add_source_emits_event() {
        let env = Env::default();
        let (admin, pair, client) = setup(&env);
        let source = Address::generate(&env);

        client.add_source(&admin, &pair, &source);

        let events = env.events().all();
        assert!(!events.is_empty());
    }

    #[test]
    fn remove_source_requires_admin() {
        let env = Env::default();
        let (admin, pair, client) = setup(&env);
        let attacker = Address::generate(&env);
        let source = Address::generate(&env);

        client.add_source(&admin, &pair, &source);

        let result = client.try_remove_source(&attacker, &pair, &source);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NotAuthorized);
    }

    #[test]
    fn remove_source_emits_event() {
        let env = Env::default();
        let (admin, pair, client) = setup(&env);
        let source = Address::generate(&env);

        client.add_source(&admin, &pair, &source);

        client.remove_source(&admin, &pair, &source);

        let events = env.events().all();
        assert!(!events.is_empty());
    }

    #[test]
    fn unauthorized_source_rejected() {
        let env = Env::default();
        let (_admin, pair, client) = setup(&env);
        let unauthorized_source = Address::generate(&env);

        let result = client.try_update_price(&unauthorized_source, &pair, &1000000);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NotAuthorized);
    }

    #[test]
    fn non_positive_price_rejected() {
        let env = Env::default();
        let (admin, pair, client) = setup(&env);
        let source = Address::generate(&env);

        client.add_source(&admin, &pair, &source);

        // Test zero price

        let result = client.try_update_price(&source, &pair, &0);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::InvalidPrice);

        // Test negative price

        let result = client.try_update_price(&source, &pair, &-100);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::InvalidPrice);
    }

    #[test]
    fn deviation_guard_rejects_large_deviation() {
        let env = Env::default();
        let (admin, pair, client) = setup(&env);
        let source = Address::generate(&env);

        client.add_source(&admin, &pair, &source);

        // First price

        client.update_price(&source, &pair, &1000000);

        // Try to set a price that deviates more than 500 bps (5%)
        // 1000000 + 600000 = 1600000 (60% increase, well above 5%)

        let result = client.try_update_price(&source, &pair, &1600000);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::InvalidDeviation
        );
    }

    #[test]
    fn deviation_guard_accepts_within_bounds() {
        let env = Env::default();
        let (admin, pair, client) = setup(&env);
        let source = Address::generate(&env);

        client.add_source(&admin, &pair, &source);

        // First price

        client.update_price(&source, &pair, &1000000);

        // Price within 5% (500 bps)
        // 1000000 * 0.05 = 50000, so 1050000 is exactly at the threshold

        let result = client.try_update_price(&source, &pair, &1050000);
        assert!(result.is_ok());
    }

    #[test]
    fn staleness_check_rejects_stale_price() {
        let env = Env::default();
        let (admin, pair, client) = setup(&env);
        let source = Address::generate(&env);

        client.add_source(&admin, &pair, &source);

        client.update_price(&source, &pair, &1000000);

        // Advance ledger past staleness threshold (default 600s)
        env.ledger().set_timestamp(700);

        let result = client.try_get_price(&pair);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::PriceTooStale);
    }

    #[test]
    fn get_price_within_threshold() {
        let env = Env::default();
        let (admin, pair, client) = setup(&env);
        let source = Address::generate(&env);

        client.add_source(&admin, &pair, &source);

        client.update_price(&source, &pair, &1000000);

        let feed = client.get_price(&pair);
        assert_eq!(feed.price, 1000000);
        assert_eq!(feed.decimals, 7);
    }

    #[test]
    fn is_stale_returns_false_for_fresh_price() {
        let env = Env::default();
        let (admin, pair, client) = setup(&env);
        let source = Address::generate(&env);

        client.add_source(&admin, &pair, &source);

        client.update_price(&source, &pair, &1000000);

        assert!(!client.is_stale(&pair));
    }

    #[test]
    fn is_stale_returns_true_for_stale_price() {
        let env = Env::default();
        let (admin, pair, client) = setup(&env);
        let source = Address::generate(&env);

        client.add_source(&admin, &pair, &source);

        client.update_price(&source, &pair, &1000000);

        // Advance ledger
        env.ledger().set_timestamp(700);

        assert!(client.is_stale(&pair));
    }

    #[test]
    fn pause_blocks_updates() {
        let env = Env::default();
        let (admin, pair, client) = setup(&env);
        let source = Address::generate(&env);

        client.add_source(&admin, &pair, &source);

        client.pause(&admin);

        let result = client.try_update_price(&source, &pair, &1000000);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::Paused);
    }

    #[test]
    fn unpause_allows_updates() {
        let env = Env::default();
        let (admin, pair, client) = setup(&env);
        let source = Address::generate(&env);

        client.add_source(&admin, &pair, &source);

        client.pause(&admin);

        client.unpause(&admin);

        let result = client.try_update_price(&source, &pair, &1000000);
        assert!(result.is_ok());
    }

    #[test]
    fn pause_requires_admin() {
        let env = Env::default();
        let (_admin, _pair, client) = setup(&env);
        let attacker = Address::generate(&env);

        let result = client.try_pause(&attacker);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NotAuthorized);
    }

    #[test]
    fn unpause_requires_admin() {
        let env = Env::default();
        let (admin, _pair, client) = setup(&env);
        let attacker = Address::generate(&env);

        client.pause(&admin);

        let result = client.try_unpause(&attacker);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NotAuthorized);
    }

    #[test]
    fn price_feed_fields_match_backend_expectations() {
        let env = Env::default();
        let (admin, pair, client) = setup(&env);
        let source = Address::generate(&env);

        client.add_source(&admin, &pair, &source);

        env.ledger().set_timestamp(1_000);
        client.update_price(&source, &pair, &1000000);

        let feed = client.get_price(&pair);

        // Verify field names match backend expectations
        assert_eq!(feed.price, 1000000);
        assert_eq!(feed.decimals, 7);
        assert_eq!(feed.updated_at, 1_000);
        assert_eq!(feed.sequence, 0);
    }

    #[test]
    fn set_staleness_threshold_requires_admin() {
        let env = Env::default();
        let (_admin, _pair, client) = setup(&env);
        let attacker = Address::generate(&env);

        let result = client.try_set_staleness_threshold(&attacker, &300u64);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NotAuthorized);
    }

    #[test]
    fn set_staleness_threshold_emits_event() {
        let env = Env::default();
        let (admin, _pair, client) = setup(&env);

        client.set_staleness_threshold(&admin, &300u64);

        let events = env.events().all();
        assert!(!events.is_empty());
    }

    #[test]
    fn set_max_deviation_bps_requires_admin() {
        let env = Env::default();
        let (_admin, _pair, client) = setup(&env);
        let attacker = Address::generate(&env);

        let result = client.try_set_max_deviation_bps(&attacker, &1000u32);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NotAuthorized);
    }

    #[test]
    fn set_max_deviation_bps_emits_event() {
        let env = Env::default();
        let (admin, _pair, client) = setup(&env);

        client.set_max_deviation_bps(&admin, &1000u32);

        let events = env.events().all();
        assert!(!events.is_empty());
    }

    #[test]
    fn sequence_increments_on_each_price_update() {
        let env = Env::default();
        let (admin, pair, client) = setup(&env);
        let source = Address::generate(&env);

        client.add_source(&admin, &pair, &source);

        // First update

        client.update_price(&source, &pair, &1000000);

        let feed1 = client.get_price(&pair);
        assert_eq!(feed1.sequence, 0);

        // Second update (within deviation bounds)

        client.update_price(&source, &pair, &1010000);

        let feed2 = client.get_price(&pair);
        assert_eq!(feed2.sequence, 1);
    }

    #[test]
    fn price_update_emits_event() {
        let env = Env::default();
        let (admin, pair, client) = setup(&env);
        let source = Address::generate(&env);

        client.add_source(&admin, &pair, &source);

        client.update_price(&source, &pair, &1000000);

        let events = env.events().all();
        assert!(!events.is_empty());
    }

    /// Ledgers advanced in the TTL test: beyond the test environment's default 4,096-ledger
    /// minimum persistent TTL, and below the 500,000-ledger extension the contract applies.
    const TTL_TEST_LEDGER_JUMP: u32 = 100_000;

    #[test]
    fn sources_and_price_survive_ledger_jump_past_default_ttl() {
        let env = Env::default();
        let (admin, pair, client) = setup(&env);
        let source = Address::generate(&env);
        client.add_source(&admin, &pair, &source);
        client.update_price(&source, &pair, &1_000_000i128);

        env.ledger()
            .with_mut(|li| li.sequence_number += TTL_TEST_LEDGER_JUMP);

        // Sources (persistent) and the price feed (persistent) are intact. The timestamp
        // has not moved, so the price is not stale.
        let sources = client.get_sources(&pair);
        assert_eq!(sources.len(), 1);
        assert!(sources.contains(&source));
        let feed = client.get_price(&pair);
        assert_eq!(feed.price, 1_000_000i128);
        assert_eq!(feed.sequence, 0);
        assert!(!client.is_stale(&pair));
        assert!(!client.is_paused());
    }
}
