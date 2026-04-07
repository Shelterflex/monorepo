#![no_std]

extern crate alloc;

use soroban_pausable::{Pausable, PausableError};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, BytesN, Env, String,
    Symbol,
};

#[contracttype]
#[derive(Clone)]
pub enum StorageKey {
    ContractVersion,
    Admin,
    Operator,
    Token,
    Paused,
    TotalAllocated(Address, String),
    TotalClaimed(Address, String),
    // ── Upgrade governance (#392) ─────────────────────────────────────────
    Guardian,
    UpgradeDelay,
    PendingUpgradeHash,
    PendingUpgradeAt,
}

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
}

#[contract]
pub struct WhistleblowerRewards;

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

fn total_allocated_get(env: &Env, whistleblower: &Address, listing_id: &String) -> i128 {
    env.storage()
        .instance()
        .get::<_, i128>(&StorageKey::TotalAllocated(
            whistleblower.clone(),
            listing_id.clone(),
        ))
        .unwrap_or(0)
}

fn total_allocated_put(env: &Env, whistleblower: &Address, listing_id: &String, amount: i128) {
    env.storage().instance().set(
        &StorageKey::TotalAllocated(whistleblower.clone(), listing_id.clone()),
        &amount,
    );
}

fn total_claimed_get(env: &Env, whistleblower: &Address, listing_id: &String) -> i128 {
    env.storage()
        .instance()
        .get::<_, i128>(&StorageKey::TotalClaimed(
            whistleblower.clone(),
            listing_id.clone(),
        ))
        .unwrap_or(0)
}

fn total_claimed_put(env: &Env, whistleblower: &Address, listing_id: &String, amount: i128) {
    env.storage().instance().set(
        &StorageKey::TotalClaimed(whistleblower.clone(), listing_id.clone()),
        &amount,
    );
}

fn claimable_get(env: &Env, whistleblower: &Address, listing_id: &String) -> i128 {
    let allocated = total_allocated_get(env, whistleblower, listing_id);
    let claimed = total_claimed_get(env, whistleblower, listing_id);
    allocated.checked_sub(claimed).unwrap_or(0)
}

#[contractimpl]
impl WhistleblowerRewards {
    pub fn init(
        env: Env,
        admin: Address,
        operator: Address,
        token: Address,
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

        env.events().publish(
            (
                Symbol::new(&env, "whistleblower_rewards"),
                Symbol::new(&env, "init"),
            ),
            (admin, operator, token),
        );
        Ok(())
    }

    pub fn contract_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get::<_, u32>(&StorageKey::ContractVersion)
            .unwrap_or(0u32)
    }

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
        let cur_alloc = total_allocated_get(&env, &whistleblower, &listing_id);
        let new_alloc = cur_alloc
            .checked_add(amount)
            .expect("overflow on allocation add");
        total_allocated_put(&env, &whistleblower, &listing_id, new_alloc);

        let total_claimed = total_claimed_get(&env, &whistleblower, &listing_id);
        let claimable = new_alloc
            .checked_sub(total_claimed)
            .expect("underflow on claimable after allocation");

        env.events().publish(
            (
                Symbol::new(&env, "whistleblower_rewards"),
                Symbol::new(&env, "allocate"),
                whistleblower.clone(),
                listing_id.clone(),
                deal_id,
            ),
            (amount, new_alloc, total_claimed, claimable),
        );
        Ok(())
    }

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

        let claimable = claimable_get(&env, &to, &listing_id);
        if claimable <= 0 {
            return Err(ContractError::NothingToClaim);
        }

        let to_claim = match amount {
            None => claimable,
            Some(a) => {
                if a <= 0 {
                    return Err(ContractError::InvalidAmount);
                }
                if a > claimable {
                    return Err(ContractError::AmountExceedsClaimable);
                }
                a
            }
        };

        let cur_claimed = total_claimed_get(&env, &to, &listing_id);
        let new_claimed = cur_claimed
            .checked_add(to_claim)
            .expect("overflow on claimed add");
        total_claimed_put(&env, &to, &listing_id, new_claimed);

        let total_allocated = total_allocated_get(&env, &to, &listing_id);
        let new_claimable = total_allocated
            .checked_sub(new_claimed)
            .expect("underflow on claimable after claim");

        let token_addr = get_token(&env);
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&env.current_contract_address(), &to, &to_claim);

        env.events().publish(
            (
                Symbol::new(&env, "whistleblower_rewards"),
                Symbol::new(&env, "claim"),
                to.clone(),
                listing_id.clone(),
            ),
            (to_claim, total_allocated, new_claimed, new_claimable),
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
        claimable_get(&env, &whistleblower, &listing_id)
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
        if let Some(guardian) = env
            .storage()
            .instance()
            .get::<_, Address>(&StorageKey::Guardian)
        {
            guardian.require_auth();
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

#[cfg(test)]
mod test {
    extern crate std;

    use super::{ContractError, WhistleblowerRewards, WhistleblowerRewardsClient};
    use soroban_sdk::testutils::{Address as _, Events, MockAuth, MockAuthInvoke};
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

        client
            .try_init(&admin, &operator, &token_id)
            .unwrap()
            .unwrap();
        (contract_id, client, admin, operator, token_id, token_admin)
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

        let token_client = token::Client::new(&env, &token_id);
        let sac = token::StellarAssetClient::new(&env, &token_id);
        env.mock_auths(&[MockAuth {
            address: &token_admin,
            invoke: &MockAuthInvoke {
                contract: &token_id,
                fn_name: "mint",
                args: (contract_id.clone(), 1_000_000i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        sac.mint(&contract_id, &1_000_000i128);
        assert!(token_client.balance(&contract_id) >= 250i128);

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

        let sac = token::StellarAssetClient::new(&env, &token_id);
        let _token_client = token::Client::new(&env, &token_id);
        env.mock_auths(&[MockAuth {
            address: &token_admin,
            invoke: &MockAuthInvoke {
                contract: &token_id,
                fn_name: "mint",
                args: (contract_id.clone(), 1000i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        sac.mint(&contract_id, &1000i128);
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

        let sac = token::StellarAssetClient::new(&env, &token_id);
        let token_client = token::Client::new(&env, &token_id);
        env.mock_auths(&[MockAuth {
            address: &token_admin,
            invoke: &MockAuthInvoke {
                contract: &token_id,
                fn_name: "mint",
                args: (contract_id.clone(), 1_000_000i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        sac.mint(&contract_id, &1_000_000i128);
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
}
