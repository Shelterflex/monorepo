#![no_std]

use soroban_pausable::{Pausable, PausableError};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, BytesN, Env, String,
    Symbol,
};

// ── Storage Keys ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum StorageKey {
    ContractVersion,
    Admin,
    Operator,
    Token,
    Paused,
    // ── Upgrade governance (#392) ─────────────────────────────────────────
    Guardian,
    UpgradeDelay,
    PendingUpgradeHash,
    PendingUpgradeAt,
    // ── Hold window & per-allocation tracking (Issue #1135) ───────────────
    /// Seconds after allocation before it becomes claimable
    HoldWindow,
    /// Monotonically increasing counter per (whistleblower, listing_id)
    AllocationNonce(Address, String),
    /// Individual allocation record keyed by (whistleblower, listing_id, nonce)
    Allocation(Address, String, u64),
}

// ── Allocation types ──────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AllocationStatus {
    Pending,
    Claimed,
    Revoked,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct AllocationRecord {
    pub amount: i128,
    /// Amount already claimed from this allocation (supports partial claims)
    pub claimed_amount: i128,
    /// Ledger timestamp when the allocation was created
    pub timestamp: u64,
    pub status: AllocationStatus,
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    Paused = 3,
    InvalidAmount = 4,
    NothingToClaim = 5,
    AmountExceedsClaimable = 6,
    EmptyString = 10,
    StringTooLong = 11,
    // Upgrade governance errors (#392)
    UpgradeAlreadyPending = 7,
    NoUpgradePending = 8,
    UpgradeDelayNotMet = 9,
    // ── Issue #1135 ──────────────────────────────────────────────────────────
    HoldWindowNotElapsed = 12,
    AllocationAlreadyClaimed = 13,
    AllocationAlreadyRevoked = 14,
    AllocationNotFound = 15,
    HoldWindowElapsed = 16,
}

#[contract]
pub struct WhistleblowerRewards;

// ── Storage helpers ───────────────────────────────────────────────────────────

fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<_, Address>(&StorageKey::Admin)
        .expect("admin not set")
}

fn get_operator(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<_, Address>(&StorageKey::Operator)
        .expect("operator not set")
}

fn get_token(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<_, Address>(&StorageKey::Token)
        .expect("token not set")
}

fn get_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<_, bool>(&StorageKey::Paused)
        .unwrap_or(false)
}

fn require_not_paused(env: &Env) -> Result<(), ContractError> {
    if get_paused(env) {
        return Err(ContractError::Paused);
    }
    Ok(())
}

const MAX_STRING_LEN: u32 = 256;

fn require_non_empty_string(s: &String) -> Result<(), ContractError> {
    if s.len() == 0 {
        return Err(ContractError::EmptyString);
    }
    Ok(())
}

fn require_string_max_len(s: &String) -> Result<(), ContractError> {
    if s.len() > MAX_STRING_LEN {
        return Err(ContractError::StringTooLong);
    }
    Ok(())
}

fn require_operator(env: &Env, caller: &Address) -> Result<(), ContractError> {
    caller.require_auth();
    if caller != &get_operator(env) {
        return Err(ContractError::NotAuthorized);
    }
    Ok(())
}

fn require_admin(env: &Env, caller: &Address) -> Result<(), ContractError> {
    caller.require_auth();
    if caller != &get_admin(env) {
        return Err(ContractError::NotAuthorized);
    }
    Ok(())
}

fn get_hold_window(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get::<_, u64>(&StorageKey::HoldWindow)
        .unwrap_or(0)
}

fn get_allocation_nonce(env: &Env, whistleblower: &Address, listing_id: &String) -> u64 {
    env.storage()
        .persistent()
        .get::<_, u64>(&StorageKey::AllocationNonce(
            whistleblower.clone(),
            listing_id.clone(),
        ))
        .unwrap_or(0)
}

fn get_allocation(
    env: &Env,
    whistleblower: &Address,
    listing_id: &String,
    id: u64,
) -> Option<AllocationRecord> {
    env.storage().persistent().get(&StorageKey::Allocation(
        whistleblower.clone(),
        listing_id.clone(),
        id,
    ))
}

fn put_allocation(
    env: &Env,
    whistleblower: &Address,
    listing_id: &String,
    id: u64,
    record: &AllocationRecord,
) {
    env.storage().persistent().set(
        &StorageKey::Allocation(whistleblower.clone(), listing_id.clone(), id),
        record,
    );
}

/// Sum all claimable amounts: Pending allocations past the hold window.
fn sum_claimable(env: &Env, whistleblower: &Address, listing_id: &String) -> i128 {
    let hold_window = get_hold_window(env);
    let now = env.ledger().timestamp();
    let nonce = get_allocation_nonce(env, whistleblower, listing_id);
    let mut total: i128 = 0;
    let mut i: u64 = 0;
    while i < nonce {
        if let Some(record) = get_allocation(env, whistleblower, listing_id, i) {
            if matches!(record.status, AllocationStatus::Pending)
                && now >= record.timestamp + hold_window
            {
                total += record.amount - record.claimed_amount;
            }
        }
        i += 1;
    }
    total
}

// ── Contract implementation ───────────────────────────────────────────────────

#[contractimpl]
impl WhistleblowerRewards {
    /// Initialise the contract.
    /// `hold_window_secs`: seconds after an allocation is created before it becomes claimable
    /// (0 = immediately claimable; set non-zero to enable the revocation window).
    pub fn init(
        env: Env,
        admin: Address,
        operator: Address,
        token: Address,
        hold_window_secs: u64,
    ) -> Result<(), ContractError> {
        if env.storage().instance().has(&StorageKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }
        env.storage().instance().set(&StorageKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&StorageKey::Operator, &operator);
        env.storage().instance().set(&StorageKey::Token, &token);
        env.storage()
            .instance()
            .set(&StorageKey::ContractVersion, &1u32);
        env.storage().instance().set(&StorageKey::Paused, &false);
        env.storage()
            .instance()
            .set(&StorageKey::HoldWindow, &hold_window_secs);

        env.events().publish(
            (
                Symbol::new(&env, "whistleblower_rewards"),
                Symbol::new(&env, "init"),
            ),
            (admin, operator, token, hold_window_secs),
        );
        Ok(())
    }

    pub fn contract_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get::<_, u32>(&StorageKey::ContractVersion)
            .unwrap_or(0u32)
    }

    /// Admin updates the hold window. Only affects future allocations.
    pub fn set_hold_window(
        env: Env,
        admin: Address,
        window_secs: u64,
    ) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        env.storage()
            .instance()
            .set(&StorageKey::HoldWindow, &window_secs);
        env.events().publish(
            (
                Symbol::new(&env, "whistleblower_rewards"),
                Symbol::new(&env, "hold_window_updated"),
            ),
            window_secs,
        );
        Ok(())
    }

    pub fn get_hold_window(env: Env) -> u64 {
        get_hold_window(&env)
    }

    /// Operator allocates a reward to a whistleblower for a specific listing report.
    /// Each call creates an individual allocation record with its own hold window timestamp.
    /// The allocation_id emitted in the event must be used by the operator to reference this
    /// allocation in a subsequent `revoke_allocation` call.
    pub fn allocate(
        env: Env,
        operator: Address,
        whistleblower: Address,
        listing_id: String,
        deal_id: String,
        amount: i128,
    ) -> Result<(), ContractError> {
        require_operator(&env, &operator)?;
        require_not_paused(&env)?;
        require_non_empty_string(&listing_id)?;
        require_string_max_len(&listing_id)?;
        require_non_empty_string(&deal_id)?;
        require_string_max_len(&deal_id)?;
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let nonce = get_allocation_nonce(&env, &whistleblower, &listing_id);
        let timestamp = env.ledger().timestamp();

        let record = AllocationRecord {
            amount,
            claimed_amount: 0,
            timestamp,
            status: AllocationStatus::Pending,
        };
        put_allocation(&env, &whistleblower, &listing_id, nonce, &record);
        env.storage().persistent().set(
            &StorageKey::AllocationNonce(whistleblower.clone(), listing_id.clone()),
            &(nonce + 1),
        );

        let hold_window = get_hold_window(&env);
        let claimable_at = timestamp + hold_window;

        env.events().publish(
            (
                Symbol::new(&env, "whistleblower_rewards"),
                Symbol::new(&env, "allocate"),
                whistleblower.clone(),
                listing_id.clone(),
                deal_id,
            ),
            (amount, nonce, claimable_at),
        );
        Ok(())
    }

    /// Revoke an unclaimed allocation that is still within the hold window.
    /// Caller must be the operator or the guardian (if set).
    /// `allocation_id` is the nonce emitted in the `allocate` event.
    pub fn revoke_allocation(
        env: Env,
        caller: Address,
        whistleblower: Address,
        listing_id: String,
        allocation_id: u64,
        reason: String,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        let op = get_operator(&env);
        let guardian_opt = env
            .storage()
            .instance()
            .get::<_, Address>(&StorageKey::Guardian);
        let is_authorized = caller == op || guardian_opt.as_ref().map_or(false, |g| &caller == g);
        if !is_authorized {
            return Err(ContractError::NotAuthorized);
        }
        require_not_paused(&env)?;
        require_non_empty_string(&listing_id)?;
        require_string_max_len(&listing_id)?;

        let mut record = get_allocation(&env, &whistleblower, &listing_id, allocation_id)
            .ok_or(ContractError::AllocationNotFound)?;

        match record.status {
            AllocationStatus::Claimed => return Err(ContractError::AllocationAlreadyClaimed),
            AllocationStatus::Revoked => return Err(ContractError::AllocationAlreadyRevoked),
            AllocationStatus::Pending => {}
        }

        if record.claimed_amount > 0 {
            // Partial claim already made; cannot revoke
            return Err(ContractError::AllocationAlreadyClaimed);
        }

        let hold_window = get_hold_window(&env);
        if hold_window == 0 {
            // With no hold window configured, there is no revocation window
            return Err(ContractError::HoldWindowElapsed);
        }

        let now = env.ledger().timestamp();
        if now >= record.timestamp + hold_window {
            return Err(ContractError::HoldWindowElapsed);
        }

        record.status = AllocationStatus::Revoked;
        put_allocation(&env, &whistleblower, &listing_id, allocation_id, &record);

        env.events().publish(
            (
                Symbol::new(&env, "whistleblower_rewards"),
                Symbol::new(&env, "allocation_revoked"),
                whistleblower.clone(),
                listing_id.clone(),
            ),
            (allocation_id, record.amount, reason),
        );
        Ok(())
    }

    /// Claim rewards. Only allocations past the hold window are eligible.
    /// Allocations are consumed FIFO; partial claims are supported.
    pub fn claim(
        env: Env,
        to: Address,
        listing_id: String,
        amount: Option<i128>,
    ) -> Result<i128, ContractError> {
        to.require_auth();
        require_not_paused(&env)?;
        require_non_empty_string(&listing_id)?;
        require_string_max_len(&listing_id)?;

        let total_claimable = sum_claimable(&env, &to, &listing_id);
        if total_claimable <= 0 {
            return Err(ContractError::NothingToClaim);
        }

        let to_claim = match amount {
            None => total_claimable,
            Some(a) => {
                if a <= 0 {
                    return Err(ContractError::InvalidAmount);
                }
                if a > total_claimable {
                    return Err(ContractError::AmountExceedsClaimable);
                }
                a
            }
        };

        // Consume eligible allocations FIFO until to_claim is satisfied
        let hold_window = get_hold_window(&env);
        let now = env.ledger().timestamp();
        let nonce = get_allocation_nonce(&env, &to, &listing_id);
        let mut remaining = to_claim;
        let mut i: u64 = 0;
        while i < nonce && remaining > 0 {
            if let Some(mut record) = get_allocation(&env, &to, &listing_id, i) {
                if matches!(record.status, AllocationStatus::Pending)
                    && now >= record.timestamp + hold_window
                {
                    let available = record.amount - record.claimed_amount;
                    if available > 0 {
                        let take = remaining.min(available);
                        record.claimed_amount += take;
                        if record.claimed_amount >= record.amount {
                            record.status = AllocationStatus::Claimed;
                        }
                        put_allocation(&env, &to, &listing_id, i, &record);
                        remaining -= take;
                    }
                }
            }
            i += 1;
        }

        let token_addr = get_token(&env);
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&env.current_contract_address(), &to, &to_claim);

        let new_claimable = sum_claimable(&env, &to, &listing_id);

        env.events().publish(
            (
                Symbol::new(&env, "whistleblower_rewards"),
                Symbol::new(&env, "claim"),
                to.clone(),
                listing_id.clone(),
            ),
            (to_claim, new_claimable),
        );

        Ok(to_claim)
    }

    pub fn claimable(env: Env, whistleblower: Address, listing_id: String) -> i128 {
        if require_non_empty_string(&listing_id).is_err() {
            return 0;
        }
        if require_string_max_len(&listing_id).is_err() {
            return 0;
        }
        sum_claimable(&env, &whistleblower, &listing_id)
    }

    pub fn set_operator(
        env: Env,
        admin: Address,
        new_operator: Address,
    ) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        let old_operator = get_operator(&env);
        env.storage()
            .instance()
            .set(&StorageKey::Operator, &new_operator);
        env.events().publish(
            (
                Symbol::new(&env, "whistleblower_rewards"),
                Symbol::new(&env, "set_operator"),
            ),
            (old_operator, new_operator),
        );
        Ok(())
    }
}

#[contractimpl]
impl Pausable for WhistleblowerRewards {
    fn pause(env: Env, _admin: Address) -> Result<(), PausableError> {
        if require_admin(&env, &_admin).is_err() {
            return Err(PausableError::NotAuthorized);
        }
        env.storage().instance().set(&StorageKey::Paused, &true);
        env.events().publish(
            (Symbol::new(&env, "Pausable"), Symbol::new(&env, "pause")),
            (),
        );
        Ok(())
    }

    fn unpause(env: Env, _admin: Address) -> Result<(), PausableError> {
        if require_admin(&env, &_admin).is_err() {
            return Err(PausableError::NotAuthorized);
        }
        env.storage().instance().set(&StorageKey::Paused, &false);
        env.events().publish(
            (Symbol::new(&env, "Pausable"), Symbol::new(&env, "unpause")),
            (),
        );
        Ok(())
    }

    fn is_paused(env: Env) -> bool {
        get_paused(&env)
    }
}

#[contractimpl]
impl WhistleblowerRewards {
    pub fn set_guardian(env: Env, admin: Address, guardian: Address) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        env.storage()
            .instance()
            .set(&StorageKey::Guardian, &guardian);
        env.events().publish(
            (
                Symbol::new(&env, "whistleblower_rewards"),
                Symbol::new(&env, "set_guardian"),
            ),
            guardian,
        );
        Ok(())
    }

    pub fn set_upgrade_delay(env: Env, admin: Address, delay: u64) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        env.storage()
            .instance()
            .set(&StorageKey::UpgradeDelay, &delay);
        env.events().publish(
            (
                Symbol::new(&env, "whistleblower_rewards"),
                Symbol::new(&env, "set_upgrade_delay"),
            ),
            delay,
        );
        Ok(())
    }

    pub fn propose_upgrade(
        env: Env,
        admin: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        if env
            .storage()
            .instance()
            .has(&StorageKey::PendingUpgradeHash)
        {
            return Err(ContractError::UpgradeAlreadyPending);
        }
        let delay: u64 = env
            .storage()
            .instance()
            .get(&StorageKey::UpgradeDelay)
            .unwrap_or(0);
        let execute_at = env.ledger().timestamp() + delay;
        env.storage()
            .instance()
            .set(&StorageKey::PendingUpgradeHash, &new_wasm_hash);
        env.storage()
            .instance()
            .set(&StorageKey::PendingUpgradeAt, &execute_at);
        env.events().publish(
            (
                Symbol::new(&env, "whistleblower_rewards"),
                Symbol::new(&env, "propose_upgrade"),
            ),
            (new_wasm_hash, execute_at),
        );
        Ok(())
    }

    pub fn execute_upgrade(env: Env, admin: Address) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        let hash = env
            .storage()
            .instance()
            .get::<_, BytesN<32>>(&StorageKey::PendingUpgradeHash)
            .ok_or(ContractError::NoUpgradePending)?;
        let execute_at: u64 = env
            .storage()
            .instance()
            .get(&StorageKey::PendingUpgradeAt)
            .ok_or(ContractError::NoUpgradePending)?;
        if env.ledger().timestamp() < execute_at {
            return Err(ContractError::UpgradeDelayNotMet);
        }
        env.storage()
            .instance()
            .remove(&StorageKey::PendingUpgradeHash);
        env.storage()
            .instance()
            .remove(&StorageKey::PendingUpgradeAt);
        env.events().publish(
            (
                Symbol::new(&env, "whistleblower_rewards"),
                Symbol::new(&env, "execute_upgrade"),
            ),
            hash.clone(),
        );
        env.deployer().update_current_contract_wasm(hash);
        Ok(())
    }

    pub fn emergency_upgrade(
        env: Env,
        admin: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        let guardian = env
            .storage()
            .instance()
            .get::<_, Address>(&StorageKey::Guardian)
            .ok_or(ContractError::NotAuthorized)?;
        guardian.require_auth();
        env.storage()
            .instance()
            .remove(&StorageKey::PendingUpgradeHash);
        env.storage()
            .instance()
            .remove(&StorageKey::PendingUpgradeAt);
        env.events().publish(
            (
                Symbol::new(&env, "whistleblower_rewards"),
                Symbol::new(&env, "emergency_upgrade"),
            ),
            (admin.clone(), new_wasm_hash.clone()),
        );
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    pub fn cancel_upgrade(env: Env, admin: Address) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        if !env
            .storage()
            .instance()
            .has(&StorageKey::PendingUpgradeHash)
        {
            return Err(ContractError::NoUpgradePending);
        }
        env.storage()
            .instance()
            .remove(&StorageKey::PendingUpgradeHash);
        env.storage()
            .instance()
            .remove(&StorageKey::PendingUpgradeAt);
        env.events().publish(
            (
                Symbol::new(&env, "whistleblower_rewards"),
                Symbol::new(&env, "cancel_upgrade"),
            ),
            admin.clone(),
        );
        Ok(())
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod test {
    extern crate std;

    use super::{
        AllocationStatus, ContractError, WhistleblowerRewards, WhistleblowerRewardsClient,
    };
    use soroban_sdk::testutils::{Address as _, Events, Ledger, MockAuth, MockAuthInvoke};
    use soroban_sdk::{token, Address, Env, IntoVal, String as SString, Symbol, TryIntoVal};

    fn setup(
        env: &Env,
    ) -> (
        soroban_sdk::Address,
        WhistleblowerRewardsClient<'_>,
        Address,
        Address,
        Address,
        Address,
    ) {
        env.mock_all_auths();
        let contract_id = env.register(WhistleblowerRewards, ());
        let client = WhistleblowerRewardsClient::new(env, &contract_id);

        let admin = Address::generate(env);
        let operator = Address::generate(env);
        let token_admin = Address::generate(env);

        let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_id = token_contract.address();

        // hold_window = 0: no hold period (backward-compatible)
        client
            .try_init(&admin, &operator, &token_id, &0u64)
            .unwrap()
            .unwrap();
        (contract_id, client, admin, operator, token_id, token_admin)
    }

    /// Setup with a non-zero hold window for hold/revoke tests.
    fn setup_with_hold(
        env: &Env,
        hold_secs: u64,
    ) -> (
        soroban_sdk::Address,
        WhistleblowerRewardsClient<'_>,
        Address,
        Address,
        Address,
        Address,
    ) {
        env.mock_all_auths();
        let contract_id = env.register(WhistleblowerRewards, ());
        let client = WhistleblowerRewardsClient::new(env, &contract_id);

        let admin = Address::generate(env);
        let operator = Address::generate(env);
        let token_admin = Address::generate(env);

        let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_id = token_contract.address();

        client
            .try_init(&admin, &operator, &token_id, &hold_secs)
            .unwrap()
            .unwrap();
        (contract_id, client, admin, operator, token_id, token_admin)
    }

    fn mint_to_contract(
        env: &Env,
        token_id: &Address,
        token_admin: &Address,
        contract_id: &Address,
        amount: i128,
    ) {
        let sac = token::StellarAssetClient::new(env, token_id);
        env.mock_auths(&[MockAuth {
            address: token_admin,
            invoke: &MockAuthInvoke {
                contract: token_id,
                fn_name: "mint",
                args: (contract_id.clone(), amount).into_val(env),
                sub_invokes: &[],
            },
        }]);
        sac.mint(contract_id, &amount);
    }

    #[test]
    fn allocate_rejects_empty_strings() {
        let env = Env::default();
        let (contract_id, client, _admin, operator, _token_id, _token_admin) = setup(&env);
        let wb = Address::generate(&env);
        let empty = SString::from_str(&env, "");
        let deal = SString::from_str(&env, "deal-A");

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "allocate",
                args: (
                    operator.clone(),
                    wb.clone(),
                    empty.clone(),
                    deal.clone(),
                    10i128,
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let err = client
            .try_allocate(&operator, &wb, &empty, &deal, &10i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::EmptyString);
    }

    #[test]
    fn allocate_rejects_overly_long_strings() {
        let env = Env::default();
        let (contract_id, client, _admin, operator, _token_id, _token_admin) = setup(&env);
        let wb = Address::generate(&env);
        let long: std::string::String = "a".repeat(257);
        let listing = SString::from_str(&env, &long);
        let deal = SString::from_str(&env, "deal-A");

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "allocate",
                args: (
                    operator.clone(),
                    wb.clone(),
                    listing.clone(),
                    deal.clone(),
                    10i128,
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let err = client
            .try_allocate(&operator, &wb, &listing, &deal, &10i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::StringTooLong);
    }

    #[test]
    fn init_sets_fields() {
        let env = Env::default();
        let (contract_id, client, admin, _operator, _token_id, _token_admin) = setup(&env);

        assert_eq!(client.contract_version(), 1u32);
        assert_eq!(client.get_hold_window(), 0u64);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "pause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_pause(&admin).unwrap().unwrap();
        assert!(client.is_paused());

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "unpause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_unpause(&admin).unwrap().unwrap();
        assert!(!client.is_paused());
    }

    #[test]
    fn only_operator_allocates() {
        let env = Env::default();
        let (contract_id, client, _admin, operator, _token_id, _token_admin) = setup(&env);
        let wb = Address::generate(&env);
        let listing = SString::from_str(&env, "listing-1");
        let deal = SString::from_str(&env, "deal-A");

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "allocate",
                args: (
                    operator.clone(),
                    wb.clone(),
                    listing.clone(),
                    deal.clone(),
                    100i128,
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_allocate(&operator, &wb, &listing, &deal, &100i128)
            .unwrap()
            .unwrap();
        assert_eq!(client.claimable(&wb, &listing), 100i128);

        let not_operator = Address::generate(&env);
        env.mock_auths(&[MockAuth {
            address: &not_operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "allocate",
                args: (
                    not_operator.clone(),
                    wb.clone(),
                    listing.clone(),
                    deal.clone(),
                    50i128,
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_allocate(&not_operator, &wb, &listing, &deal, &50i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    #[test]
    fn claim_flow_and_no_double_claim() {
        let env = Env::default();
        let (contract_id, client, _admin, operator, token_id, token_admin) = setup(&env);
        let wb = Address::generate(&env);
        let listing = SString::from_str(&env, "listing-1");
        let deal = SString::from_str(&env, "deal-A");

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "allocate",
                args: (
                    operator.clone(),
                    wb.clone(),
                    listing.clone(),
                    deal.clone(),
                    250i128,
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_allocate(&operator, &wb, &listing, &deal, &250i128)
            .unwrap()
            .unwrap();
        assert_eq!(client.claimable(&wb, &listing), 250i128);

        mint_to_contract(&env, &token_id, &token_admin, &contract_id, 1_000_000);

        env.mock_auths(&[MockAuth {
            address: &wb,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "claim",
                args: (wb.clone(), listing.clone(), Option::<i128>::None).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let claimed = client
            .try_claim(&wb, &listing, &Option::<i128>::None)
            .unwrap()
            .unwrap();
        assert_eq!(claimed, 250i128);
        assert_eq!(client.claimable(&wb, &listing), 0i128);

        env.mock_auths(&[MockAuth {
            address: &wb,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "claim",
                args: (wb.clone(), listing.clone(), Option::<i128>::None).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_claim(&wb, &listing, &Option::<i128>::None)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NothingToClaim);
    }

    #[test]
    fn only_whistleblower_claims_their_own() {
        let env = Env::default();
        let (contract_id, client, _admin, operator, _token_id, _token_admin) = setup(&env);
        let wb1 = Address::generate(&env);
        let wb2 = Address::generate(&env);
        let listing = SString::from_str(&env, "listing-2");
        let deal = SString::from_str(&env, "deal-X");

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "allocate",
                args: (
                    operator.clone(),
                    wb1.clone(),
                    listing.clone(),
                    deal.clone(),
                    90i128,
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_allocate(&operator, &wb1, &listing, &deal, &90i128)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &wb2,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "claim",
                args: (wb2.clone(), listing.clone(), Option::<i128>::None).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_claim(&wb2, &listing, &Option::<i128>::None)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NothingToClaim);
    }

    #[test]
    fn pause_blocks_allocate_and_claim() {
        let env = Env::default();
        let (contract_id, client, admin, operator, _token_id, _token_admin) = setup(&env);
        let wb = Address::generate(&env);
        let listing = SString::from_str(&env, "listing-3");
        let deal = SString::from_str(&env, "deal-Z");

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "pause",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_pause(&admin).unwrap().unwrap();
        assert!(client.is_paused());

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "allocate",
                args: (
                    operator.clone(),
                    wb.clone(),
                    listing.clone(),
                    deal.clone(),
                    10i128,
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_allocate(&operator, &wb, &listing, &deal, &10i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::Paused);

        env.mock_auths(&[MockAuth {
            address: &wb,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "claim",
                args: (wb.clone(), listing.clone(), Option::<i128>::None).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err2 = client
            .try_claim(&wb, &listing, &Option::<i128>::None)
            .unwrap_err()
            .unwrap();
        assert_eq!(err2, ContractError::Paused);
    }

    #[test]
    fn events_emitted() {
        let env = Env::default();
        let (contract_id, client, _admin, operator, token_id, token_admin) = setup(&env);
        let wb = Address::generate(&env);
        let listing = SString::from_str(&env, "listing-4");
        let deal = SString::from_str(&env, "deal-Y");

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "allocate",
                args: (
                    operator.clone(),
                    wb.clone(),
                    listing.clone(),
                    deal.clone(),
                    5i128,
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_allocate(&operator, &wb, &listing, &deal, &5i128)
            .unwrap()
            .unwrap();

        let events = env.events().all();
        let alloc_event = events.last().unwrap();
        let topics: soroban_sdk::Vec<soroban_sdk::Val> = alloc_event.1.clone();
        assert_eq!(topics.len(), 5);
        let name: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(name, Symbol::new(&env, "whistleblower_rewards"));
        let action: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(action, Symbol::new(&env, "allocate"));

        mint_to_contract(&env, &token_id, &token_admin, &contract_id, 1000);

        env.mock_auths(&[MockAuth {
            address: &wb,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "claim",
                args: (wb.clone(), listing.clone(), Option::<i128>::None).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_claim(&wb, &listing, &Option::<i128>::None)
            .unwrap()
            .unwrap();
        let events2 = env.events().all();
        let claim_event = events2.last().unwrap();
        let topics2: soroban_sdk::Vec<soroban_sdk::Val> = claim_event.1.clone();
        assert_eq!(topics2.len(), 4);
        let name2: Symbol = topics2.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(name2, Symbol::new(&env, "whistleblower_rewards"));
        let action2: Symbol = topics2.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(action2, Symbol::new(&env, "claim"));
    }

    #[test]
    fn multiple_allocations_and_partial_claims() {
        let env = Env::default();
        let (contract_id, client, _admin, operator, token_id, token_admin) = setup(&env);
        let wb = Address::generate(&env);
        let listing = SString::from_str(&env, "listing-partial");
        let deal_a = SString::from_str(&env, "deal-A");
        let deal_b = SString::from_str(&env, "deal-B");

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "allocate",
                args: (
                    operator.clone(),
                    wb.clone(),
                    listing.clone(),
                    deal_a.clone(),
                    100i128,
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_allocate(&operator, &wb, &listing, &deal_a, &100i128)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "allocate",
                args: (
                    operator.clone(),
                    wb.clone(),
                    listing.clone(),
                    deal_b.clone(),
                    50i128,
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_allocate(&operator, &wb, &listing, &deal_b, &50i128)
            .unwrap()
            .unwrap();

        assert_eq!(client.claimable(&wb, &listing), 150i128);

        mint_to_contract(&env, &token_id, &token_admin, &contract_id, 1_000_000);

        let token_client = token::Client::new(&env, &token_id);
        let bal_before = token_client.balance(&wb);

        env.mock_auths(&[MockAuth {
            address: &wb,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "claim",
                args: (wb.clone(), listing.clone(), Option::<i128>::Some(40i128)).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let c1 = client
            .try_claim(&wb, &listing, &Option::<i128>::Some(40i128))
            .unwrap()
            .unwrap();
        assert_eq!(c1, 40i128);
        assert_eq!(client.claimable(&wb, &listing), 110i128);
        assert_eq!(token_client.balance(&wb), bal_before + 40i128);

        env.mock_auths(&[MockAuth {
            address: &wb,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "claim",
                args: (wb.clone(), listing.clone(), Option::<i128>::Some(999i128)).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_claim(&wb, &listing, &Option::<i128>::Some(999i128))
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::AmountExceedsClaimable);

        env.mock_auths(&[MockAuth {
            address: &wb,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "claim",
                args: (wb.clone(), listing.clone(), Option::<i128>::None).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let c2 = client
            .try_claim(&wb, &listing, &Option::<i128>::None)
            .unwrap()
            .unwrap();
        assert_eq!(c2, 110i128);
        assert_eq!(client.claimable(&wb, &listing), 0i128);
    }

    // ── Issue #1135: Hold window and claw-back tests ───────────────────────────

    #[test]
    fn claim_blocked_during_hold() {
        let env = Env::default();
        env.ledger().set_timestamp(1000);
        // 3600-second (1 hour) hold window
        let (contract_id, client, _admin, operator, token_id, token_admin) =
            setup_with_hold(&env, 3600);
        let wb = Address::generate(&env);
        let listing = SString::from_str(&env, "listing-hold");
        let deal = SString::from_str(&env, "deal-hold");

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "allocate",
                args: (
                    operator.clone(),
                    wb.clone(),
                    listing.clone(),
                    deal.clone(),
                    100i128,
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_allocate(&operator, &wb, &listing, &deal, &100i128)
            .unwrap()
            .unwrap();

        // Nothing claimable during hold window
        assert_eq!(client.claimable(&wb, &listing), 0i128);

        mint_to_contract(&env, &token_id, &token_admin, &contract_id, 1_000_000);

        env.mock_auths(&[MockAuth {
            address: &wb,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "claim",
                args: (wb.clone(), listing.clone(), Option::<i128>::None).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_claim(&wb, &listing, &Option::<i128>::None)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NothingToClaim);
    }

    #[test]
    fn successful_claim_after_hold() {
        let env = Env::default();
        env.ledger().set_timestamp(1000);
        let (contract_id, client, _admin, operator, token_id, token_admin) =
            setup_with_hold(&env, 3600);
        let wb = Address::generate(&env);
        let listing = SString::from_str(&env, "listing-after-hold");
        let deal = SString::from_str(&env, "deal-after-hold");

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "allocate",
                args: (
                    operator.clone(),
                    wb.clone(),
                    listing.clone(),
                    deal.clone(),
                    200i128,
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_allocate(&operator, &wb, &listing, &deal, &200i128)
            .unwrap()
            .unwrap();

        // Advance past hold window
        env.ledger().set_timestamp(1000 + 3600);

        assert_eq!(client.claimable(&wb, &listing), 200i128);

        mint_to_contract(&env, &token_id, &token_admin, &contract_id, 1_000_000);

        env.mock_auths(&[MockAuth {
            address: &wb,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "claim",
                args: (wb.clone(), listing.clone(), Option::<i128>::None).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let claimed = client
            .try_claim(&wb, &listing, &Option::<i128>::None)
            .unwrap()
            .unwrap();
        assert_eq!(claimed, 200i128);
        assert_eq!(client.claimable(&wb, &listing), 0i128);
    }

    #[test]
    fn revoke_unclaimed_within_window() {
        let env = Env::default();
        env.ledger().set_timestamp(1000);
        let (contract_id, client, _admin, operator, _token_id, _token_admin) =
            setup_with_hold(&env, 3600);
        let wb = Address::generate(&env);
        let listing = SString::from_str(&env, "listing-revoke");
        let deal = SString::from_str(&env, "deal-revoke");
        let reason = SString::from_str(&env, "report_retracted");

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "allocate",
                args: (
                    operator.clone(),
                    wb.clone(),
                    listing.clone(),
                    deal.clone(),
                    150i128,
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_allocate(&operator, &wb, &listing, &deal, &150i128)
            .unwrap()
            .unwrap();

        // Revoke allocation_id = 0 while still in hold window
        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "revoke_allocation",
                args: (
                    operator.clone(),
                    wb.clone(),
                    listing.clone(),
                    0u64,
                    reason.clone(),
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_revoke_allocation(&operator, &wb, &listing, &0u64, &reason)
            .unwrap()
            .unwrap();

        // After revoke, nothing is claimable
        assert_eq!(client.claimable(&wb, &listing), 0i128);
    }

    #[test]
    fn revoke_then_claim_rejected() {
        let env = Env::default();
        env.ledger().set_timestamp(1000);
        let (contract_id, client, _admin, operator, token_id, token_admin) =
            setup_with_hold(&env, 3600);
        let wb = Address::generate(&env);
        let listing = SString::from_str(&env, "listing-revoke-claim");
        let deal = SString::from_str(&env, "deal-rc");
        let reason = SString::from_str(&env, "false_report");

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "allocate",
                args: (
                    operator.clone(),
                    wb.clone(),
                    listing.clone(),
                    deal.clone(),
                    300i128,
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_allocate(&operator, &wb, &listing, &deal, &300i128)
            .unwrap()
            .unwrap();

        // Revoke during hold window
        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "revoke_allocation",
                args: (
                    operator.clone(),
                    wb.clone(),
                    listing.clone(),
                    0u64,
                    reason.clone(),
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_revoke_allocation(&operator, &wb, &listing, &0u64, &reason)
            .unwrap()
            .unwrap();

        // Advance past hold window
        env.ledger().set_timestamp(1000 + 3600);

        mint_to_contract(&env, &token_id, &token_admin, &contract_id, 1_000_000);

        // Claim must fail — allocation was revoked
        env.mock_auths(&[MockAuth {
            address: &wb,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "claim",
                args: (wb.clone(), listing.clone(), Option::<i128>::None).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_claim(&wb, &listing, &Option::<i128>::None)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NothingToClaim);

        // Revoke again must fail
        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "revoke_allocation",
                args: (
                    operator.clone(),
                    wb.clone(),
                    listing.clone(),
                    0u64,
                    reason.clone(),
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err2 = client
            .try_revoke_allocation(&operator, &wb, &listing, &0u64, &reason)
            .unwrap_err()
            .unwrap();
        assert_eq!(err2, ContractError::AllocationAlreadyRevoked);
    }

    #[test]
    fn claim_then_revoke_rejected() {
        let env = Env::default();
        env.ledger().set_timestamp(1000);
        // Short hold window so we can claim quickly in the test
        let (contract_id, client, _admin, operator, token_id, token_admin) =
            setup_with_hold(&env, 10);
        let wb = Address::generate(&env);
        let listing = SString::from_str(&env, "listing-claim-revoke");
        let deal = SString::from_str(&env, "deal-cr");
        let reason = SString::from_str(&env, "false_report");

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "allocate",
                args: (
                    operator.clone(),
                    wb.clone(),
                    listing.clone(),
                    deal.clone(),
                    100i128,
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_allocate(&operator, &wb, &listing, &deal, &100i128)
            .unwrap()
            .unwrap();

        // Advance past hold window → allocation is claimable
        env.ledger().set_timestamp(1000 + 10);

        mint_to_contract(&env, &token_id, &token_admin, &contract_id, 1_000_000);

        // Claim first
        env.mock_auths(&[MockAuth {
            address: &wb,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "claim",
                args: (wb.clone(), listing.clone(), Option::<i128>::None).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_claim(&wb, &listing, &Option::<i128>::None)
            .unwrap()
            .unwrap();

        // Now try to revoke the already-claimed allocation
        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "revoke_allocation",
                args: (
                    operator.clone(),
                    wb.clone(),
                    listing.clone(),
                    0u64,
                    reason.clone(),
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_revoke_allocation(&operator, &wb, &listing, &0u64, &reason)
            .unwrap_err()
            .unwrap();
        // Allocation was fully claimed, so status is Claimed → AllocationAlreadyClaimed
        assert_eq!(err, ContractError::AllocationAlreadyClaimed);
    }

    #[test]
    fn revoke_after_hold_window_rejected() {
        let env = Env::default();
        env.ledger().set_timestamp(1000);
        let (contract_id, client, _admin, operator, _token_id, _token_admin) =
            setup_with_hold(&env, 3600);
        let wb = Address::generate(&env);
        let listing = SString::from_str(&env, "listing-late-revoke");
        let deal = SString::from_str(&env, "deal-lr");
        let reason = SString::from_str(&env, "late");

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "allocate",
                args: (
                    operator.clone(),
                    wb.clone(),
                    listing.clone(),
                    deal.clone(),
                    100i128,
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_allocate(&operator, &wb, &listing, &deal, &100i128)
            .unwrap()
            .unwrap();

        // Hold window has elapsed
        env.ledger().set_timestamp(1000 + 3600);

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "revoke_allocation",
                args: (
                    operator.clone(),
                    wb.clone(),
                    listing.clone(),
                    0u64,
                    reason.clone(),
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_revoke_allocation(&operator, &wb, &listing, &0u64, &reason)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::HoldWindowElapsed);
    }

    #[test]
    fn guardian_can_revoke() {
        let env = Env::default();
        env.ledger().set_timestamp(1000);
        let (contract_id, client, admin, operator, _token_id, _token_admin) =
            setup_with_hold(&env, 3600);
        let guardian = Address::generate(&env);
        let wb = Address::generate(&env);
        let listing = SString::from_str(&env, "listing-guardian");
        let deal = SString::from_str(&env, "deal-g");
        let reason = SString::from_str(&env, "guardian_revoke");

        // Set guardian
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_guardian",
                args: (admin.clone(), guardian.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_set_guardian(&admin, &guardian).unwrap().unwrap();

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "allocate",
                args: (
                    operator.clone(),
                    wb.clone(),
                    listing.clone(),
                    deal.clone(),
                    50i128,
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_allocate(&operator, &wb, &listing, &deal, &50i128)
            .unwrap()
            .unwrap();

        // Guardian revokes during hold window
        env.mock_auths(&[MockAuth {
            address: &guardian,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "revoke_allocation",
                args: (
                    guardian.clone(),
                    wb.clone(),
                    listing.clone(),
                    0u64,
                    reason.clone(),
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_revoke_allocation(&guardian, &wb, &listing, &0u64, &reason)
            .unwrap()
            .unwrap();

        assert_eq!(client.claimable(&wb, &listing), 0i128);
    }

    #[test]
    fn emergency_upgrade_fails_when_guardian_unset() {
        let env = Env::default();
        let (contract_id, client, admin, _operator, _token_id, _token_id_admin) = setup(&env);
        let dummy_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "emergency_upgrade",
                args: (admin.clone(), dummy_hash.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let err = client
            .try_emergency_upgrade(&admin, &dummy_hash)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }
}
