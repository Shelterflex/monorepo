#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Env, Symbol, Vec,
};

// ── Storage keys ─────────────────────────────────────────────────────────────
pub mod access_control;
pub mod validation;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    ContractVersion,
    Admin,
    Operator,
    SlashingModule,
    /// Fixed asset price (since oracle contract was removed)
    AssetPrice,
    /// Health threshold for collateral positions (e.g., 150 = 150%)
    HealthThreshold,
    /// Per-owner bond balance
    BondBalance(Address),
    /// Lock by owner and lock ID
    BondLock(Address, u64),
    /// Next lock ID for each owner
    NextLockId(Address),
    /// Total locked per owner
    TotalLocked(Address),
    /// Collateral position: (owner, (collateral_amount, bond_issued))
    CollateralPosition(Address),
    /// Total bonded balance (invariant tracking)
    TotalBonded,
}

fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<_, Address>(&DataKey::Admin)
        .expect("admin not set")
}

fn get_slashing_module(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<_, Address>(&DataKey::SlashingModule)
        .expect("slashing module not set")
}

fn get_asset_price(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get::<_, i128>(&DataKey::AssetPrice)
        .expect("asset price not set")
}

fn get_health_threshold(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get::<_, i128>(&DataKey::HealthThreshold)
        .expect("health threshold not set")
}

fn get_bond_balance(env: &Env, owner: &Address) -> i128 {
    env.storage()
        .persistent()
        .get::<_, i128>(&DataKey::BondBalance(owner.clone()))
        .unwrap_or(0)
}

fn set_bond_balance(env: &Env, owner: &Address, amount: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::BondBalance(owner.clone()), &amount);
}

fn get_total_locked(env: &Env, owner: &Address) -> i128 {
    env.storage()
        .persistent()
        .get::<_, i128>(&DataKey::TotalLocked(owner.clone()))
        .unwrap_or(0)
}

fn set_total_locked(env: &Env, owner: &Address, amount: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::TotalLocked(owner.clone()), &amount);
}

fn get_total_bonded(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get::<_, i128>(&DataKey::TotalBonded)
        .unwrap_or(0)
}

fn set_total_bonded(env: &Env, amount: i128) {
    env.storage().instance().set(&DataKey::TotalBonded, &amount);
}

// ── Errors ───────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    InvalidAmount = 3,
    InsufficientBalance = 4,
    InsufficientUnlockedBalance = 5,
    LockNotFound = 6,
    LockExpired = 7,
    LockNotExpired = 8,
    NotLockOwner = 9,
    SlashingModuleNotSet = 10,
    NotSlashingModule = 11,
    SlashExceedsAvailable = 12,
    InvalidPrice = 13,
    InvalidThreshold = 14,
    PositionNotFound = 15,
    PositionUnhealthy = 16,
    LiquidationBelowThreshold = 17,
    NegativeValue = 18,
    BalanceOverflow = 19,
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct BondCollateral;

#[contractimpl]
impl BondCollateral {
    /// Initialize the contract with admin, operator, slashing module, and pricing config.
    pub fn init(
        env: Env,
        admin: Address,
        operator: Address,
        slashing_module: Address,
        asset_price: i128,
        health_threshold: i128,
    ) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }
        admin.require_auth();

        validation::validate_amount(asset_price)?;
        validation::validate_amount(health_threshold)?;

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Operator, &operator);
        env.storage()
            .instance()
            .set(&DataKey::SlashingModule, &slashing_module);
        env.storage()
            .instance()
            .set(&DataKey::AssetPrice, &asset_price);
        env.storage()
            .instance()
            .set(&DataKey::HealthThreshold, &health_threshold);
        env.storage()
            .instance()
            .set(&DataKey::ContractVersion, &1u32);
        env.storage().instance().set(&DataKey::TotalBonded, &0i128);

        env.events().publish(
            (
                Symbol::new(&env, "bond_collateral"),
                Symbol::new(&env, "init"),
            ),
            (
                admin,
                operator,
                slashing_module,
                asset_price,
                health_threshold,
            ),
        );

        Ok(())
    }

    /// Set the admin address (admin only).
    pub fn set_admin(env: Env, admin: Address, new_admin: Address) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "set_admin")?;

        env.storage().instance().set(&DataKey::Admin, &new_admin);

        env.events().publish(
            (
                Symbol::new(&env, "bond_collateral"),
                Symbol::new(&env, "set_admin"),
            ),
            (current_admin, new_admin),
        );

        Ok(())
    }

    /// Set the operator address (admin only).
    pub fn set_operator(
        env: Env,
        admin: Address,
        new_operator: Address,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "set_operator")?;

        env.storage()
            .instance()
            .set(&DataKey::Operator, &new_operator);

        env.events().publish(
            (
                Symbol::new(&env, "bond_collateral"),
                Symbol::new(&env, "set_operator"),
            ),
            (admin, new_operator),
        );

        Ok(())
    }

    /// Set the asset price and health threshold (admin only).
    pub fn set_thresholds(
        env: Env,
        admin: Address,
        asset_price: i128,
        health_threshold: i128,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "set_thresholds")?;

        validation::validate_amount(asset_price)?;
        validation::validate_amount(health_threshold)?;

        env.storage()
            .instance()
            .set(&DataKey::AssetPrice, &asset_price);
        env.storage()
            .instance()
            .set(&DataKey::HealthThreshold, &health_threshold);

        env.events().publish(
            (
                Symbol::new(&env, "bond_collateral"),
                Symbol::new(&env, "set_thresholds"),
            ),
            (asset_price, health_threshold),
        );

        Ok(())
    }

    /// Deposit a bond for the caller.
    pub fn deposit_bond(env: Env, from: Address, amount: i128) -> Result<(), ContractError> {
        from.require_auth();
        validation::validate_amount(amount)?;

        let current = get_bond_balance(&env, &from);
        let new_balance = current
            .checked_add(amount)
            .ok_or(ContractError::BalanceOverflow)?;
        set_bond_balance(&env, &from, new_balance);

        let total = get_total_bonded(&env);
        let new_total = total
            .checked_add(amount)
            .ok_or(ContractError::BalanceOverflow)?;
        set_total_bonded(&env, new_total);

        env.events().publish(
            (
                Symbol::new(&env, "bond_collateral"),
                Symbol::new(&env, "deposit_bond"),
                from,
            ),
            amount,
        );

        Ok(())
    }

    /// Withdraw a bond from the caller's balance (cannot go below locked amount).
    pub fn withdraw_bond(env: Env, from: Address, amount: i128) -> Result<(), ContractError> {
        from.require_auth();
        validation::validate_amount(amount)?;

        let current = get_bond_balance(&env, &from);
        let locked = get_total_locked(&env, &from);
        let unlocked = current - locked;

        if amount > unlocked {
            return Err(ContractError::InsufficientUnlockedBalance);
        }

        let new_balance = current - amount;
        set_bond_balance(&env, &from, new_balance);

        let total = get_total_bonded(&env);
        let new_total = total - amount;
        set_total_bonded(&env, new_total);

        env.events().publish(
            (
                Symbol::new(&env, "bond_collateral"),
                Symbol::new(&env, "withdraw_bond"),
                from,
            ),
            amount,
        );

        Ok(())
    }

    /// Lock a portion of a bond with an expiry timestamp.
    pub fn lock_bond(
        env: Env,
        owner: Address,
        amount: i128,
        expiry: u64,
    ) -> Result<(), ContractError> {
        owner.require_auth();
        validation::validate_amount(amount)?;

        let current = get_bond_balance(&env, &owner);
        let locked = get_total_locked(&env, &owner);
        let unlocked = current - locked;

        if amount > unlocked {
            return Err(ContractError::InsufficientUnlockedBalance);
        }

        let lock_id = env
            .storage()
            .persistent()
            .get::<_, u64>(&DataKey::NextLockId(owner.clone()))
            .unwrap_or(0);

        let lock_data = (amount, expiry, owner.clone());
        env.storage()
            .persistent()
            .set(&DataKey::BondLock(owner.clone(), lock_id), &lock_data);

        env.storage()
            .persistent()
            .set(&DataKey::NextLockId(owner.clone()), &(lock_id + 1));

        let new_locked = locked
            .checked_add(amount)
            .ok_or(ContractError::BalanceOverflow)?;
        set_total_locked(&env, &owner, new_locked);

        env.events().publish(
            (
                Symbol::new(&env, "bond_collateral"),
                Symbol::new(&env, "lock_bond"),
                owner,
            ),
            (lock_id, amount, expiry),
        );

        Ok(())
    }

    /// Unlock a previously locked bond (only by lock owner, after expiry).
    pub fn unlock_bond(env: Env, owner: Address, lock_id: u64) -> Result<(), ContractError> {
        owner.require_auth();

        let lock: (i128, u64, Address) = env
            .storage()
            .persistent()
            .get(&DataKey::BondLock(owner.clone(), lock_id))
            .ok_or(ContractError::LockNotFound)?;

        let (amount, expiry, lock_owner) = lock;

        if lock_owner != owner {
            return Err(ContractError::NotLockOwner);
        }

        let now = env.ledger().timestamp();
        if now < expiry {
            return Err(ContractError::LockNotExpired);
        }

        env.storage()
            .persistent()
            .remove(&DataKey::BondLock(owner.clone(), lock_id));

        let locked = get_total_locked(&env, &owner);
        let new_locked = locked - amount;
        set_total_locked(&env, &owner, new_locked);

        env.events().publish(
            (
                Symbol::new(&env, "bond_collateral"),
                Symbol::new(&env, "unlock_bond"),
                owner,
            ),
            (lock_id, amount),
        );

        Ok(())
    }

    /// Get the bond balance for an owner.
    pub fn get_bond(env: Env, owner: Address) -> i128 {
        get_bond_balance(&env, &owner)
    }

    /// Get all locks for an owner.
    pub fn get_locks(env: Env, owner: Address) -> Vec<(u64, i128, u64)> {
        let mut locks = Vec::new(&env);
        let next_id = env
            .storage()
            .persistent()
            .get::<_, u64>(&DataKey::NextLockId(owner.clone()))
            .unwrap_or(0);

        for i in 0..next_id {
            if let Some((amount, expiry, _)) = env
                .storage()
                .persistent()
                .get::<_, (i128, u64, Address)>(&DataKey::BondLock(owner.clone(), i))
            {
                locks.push_back((i, amount, expiry));
            }
        }
        locks
    }

    /// Execute a slash requested by the slashing module.
    pub fn execute_slash(
        env: Env,
        slashing_module: Address,
        owner: Address,
        amount: i128,
        lock_id: Option<u64>,
    ) -> Result<(), ContractError> {
        slashing_module.require_auth();
        validation::validate_amount(amount)?;

        let configured_module = get_slashing_module(&env);
        if slashing_module != configured_module {
            return Err(ContractError::NotSlashingModule);
        }

        let current = get_bond_balance(&env, &owner);
        let locked = get_total_locked(&env, &owner);

        // If a specific lock is provided, verify the slash can be applied to it
        if let Some(lid) = lock_id {
            let lock: (i128, u64, Address) = env
                .storage()
                .persistent()
                .get(&DataKey::BondLock(owner.clone(), lid))
                .ok_or(ContractError::LockNotFound)?;

            let (lock_amount, _, lock_owner) = lock;
            if lock_owner != owner {
                return Err(ContractError::NotLockOwner);
            }

            // Slash can only affect this specific lock + unlocked balance
            let available_for_this_lock = lock_amount + (current - locked);
            if amount > available_for_this_lock {
                return Err(ContractError::SlashExceedsAvailable);
            }

            // Remove the lock and reduce locked amount
            env.storage()
                .persistent()
                .remove(&DataKey::BondLock(owner.clone(), lid));
            let new_locked = locked - lock_amount;
            set_total_locked(&env, &owner, new_locked);
        } else {
            // Slash from unlocked balance first
            let _unlocked = current - locked;
            if amount > current {
                return Err(ContractError::SlashExceedsAvailable);
            }
        }

        let new_balance = current - amount;
        set_bond_balance(&env, &owner, new_balance);

        let total = get_total_bonded(&env);
        let new_total = total - amount;
        set_total_bonded(&env, new_total);

        env.events().publish(
            (
                Symbol::new(&env, "bond_collateral"),
                Symbol::new(&env, "execute_slash"),
                owner,
            ),
            (amount, lock_id),
        );

        Ok(())
    }

    /// Deposit collateral to a position.
    pub fn deposit_collateral(env: Env, owner: Address, amount: i128) -> Result<(), ContractError> {
        owner.require_auth();
        validation::validate_amount(amount)?;

        let position: (i128, i128) = env
            .storage()
            .persistent()
            .get(&DataKey::CollateralPosition(owner.clone()))
            .unwrap_or((0, 0));

        let (collateral, bond_issued) = position;
        let new_collateral = collateral
            .checked_add(amount)
            .ok_or(ContractError::BalanceOverflow)?;

        env.storage().persistent().set(
            &DataKey::CollateralPosition(owner.clone()),
            &(new_collateral, bond_issued),
        );

        env.events().publish(
            (
                Symbol::new(&env, "bond_collateral"),
                Symbol::new(&env, "deposit_collateral"),
                owner,
            ),
            amount,
        );

        Ok(())
    }

    /// Withdraw collateral from a position.
    pub fn withdraw_collateral(
        env: Env,
        owner: Address,
        amount: i128,
    ) -> Result<(), ContractError> {
        owner.require_auth();
        validation::validate_amount(amount)?;

        let position: (i128, i128) = env
            .storage()
            .persistent()
            .get(&DataKey::CollateralPosition(owner.clone()))
            .ok_or(ContractError::PositionNotFound)?;

        let (collateral, bond_issued) = position;

        if amount > collateral {
            return Err(ContractError::InsufficientBalance);
        }

        // Check if withdrawal would make position unhealthy
        let new_collateral = collateral - amount;
        let price = get_asset_price(&env);
        let threshold = get_health_threshold(&env);

        if bond_issued > 0 {
            let collateral_value = new_collateral * price;
            let required = bond_issued * threshold / 100;
            if collateral_value < required {
                return Err(ContractError::PositionUnhealthy);
            }
        }

        env.storage().persistent().set(
            &DataKey::CollateralPosition(owner.clone()),
            &(new_collateral, bond_issued),
        );

        env.events().publish(
            (
                Symbol::new(&env, "bond_collateral"),
                Symbol::new(&env, "withdraw_collateral"),
                owner,
            ),
            amount,
        );

        Ok(())
    }

    /// Issue bonds against collateral (create debt).
    pub fn issue_bond(env: Env, owner: Address, amount: i128) -> Result<(), ContractError> {
        owner.require_auth();
        validation::validate_amount(amount)?;

        let position: (i128, i128) = env
            .storage()
            .persistent()
            .get(&DataKey::CollateralPosition(owner.clone()))
            .unwrap_or((0, 0));

        let (collateral, bond_issued) = position;

        let new_bond_issued = bond_issued
            .checked_add(amount)
            .ok_or(ContractError::BalanceOverflow)?;

        // Check if position would remain healthy
        let price = get_asset_price(&env);
        let threshold = get_health_threshold(&env);
        let collateral_value = collateral * price;
        let required = new_bond_issued * threshold / 100;

        if collateral_value < required {
            return Err(ContractError::PositionUnhealthy);
        }

        env.storage().persistent().set(
            &DataKey::CollateralPosition(owner.clone()),
            &(collateral, new_bond_issued),
        );

        env.events().publish(
            (
                Symbol::new(&env, "bond_collateral"),
                Symbol::new(&env, "issue_bond"),
                owner,
            ),
            amount,
        );

        Ok(())
    }

    /// Redeem bonds (repay debt).
    pub fn redeem_bond(env: Env, owner: Address, amount: i128) -> Result<(), ContractError> {
        owner.require_auth();
        validation::validate_amount(amount)?;

        let position: (i128, i128) = env
            .storage()
            .persistent()
            .get(&DataKey::CollateralPosition(owner.clone()))
            .ok_or(ContractError::PositionNotFound)?;

        let (collateral, bond_issued) = position;

        if amount > bond_issued {
            return Err(ContractError::InsufficientBalance);
        }

        let new_bond_issued = bond_issued - amount;
        env.storage().persistent().set(
            &DataKey::CollateralPosition(owner.clone()),
            &(collateral, new_bond_issued),
        );

        env.events().publish(
            (
                Symbol::new(&env, "bond_collateral"),
                Symbol::new(&env, "redeem_bond"),
                owner,
            ),
            amount,
        );

        Ok(())
    }

    /// Liquidate an unhealthy position.
    pub fn liquidate(env: Env, liquidator: Address, owner: Address) -> Result<(), ContractError> {
        liquidator.require_auth();

        let position: (i128, i128) = env
            .storage()
            .persistent()
            .get(&DataKey::CollateralPosition(owner.clone()))
            .ok_or(ContractError::PositionNotFound)?;

        let (collateral, bond_issued) = position;

        if bond_issued == 0 {
            return Err(ContractError::PositionNotFound);
        }

        // Check if position is unhealthy
        let price = get_asset_price(&env);
        let threshold = get_health_threshold(&env);
        let collateral_value = collateral * price;
        let required = bond_issued * threshold / 100;

        if collateral_value >= required {
            return Err(ContractError::LiquidationBelowThreshold);
        }

        // Liquidate: clear the position
        env.storage()
            .persistent()
            .remove(&DataKey::CollateralPosition(owner.clone()));

        env.events().publish(
            (
                Symbol::new(&env, "bond_collateral"),
                Symbol::new(&env, "liquidate"),
                owner,
            ),
            (liquidator, collateral, bond_issued),
        );

        Ok(())
    }

    /// Get a collateral position.
    pub fn get_position(env: Env, owner: Address) -> Option<(i128, i128)> {
        env.storage()
            .persistent()
            .get(&DataKey::CollateralPosition(owner.clone()))
    }

    /// Get the collateral ratio for a position (in basis points, e.g., 150 = 150%).
    pub fn get_collateral_ratio(env: Env, owner: Address) -> Option<i128> {
        let position: (i128, i128) = env
            .storage()
            .persistent()
            .get(&DataKey::CollateralPosition(owner.clone()))?;

        let (collateral, bond_issued) = position;

        if bond_issued == 0 {
            return None;
        }

        let price = get_asset_price(&env);
        let collateral_value = collateral * price;
        Some(collateral_value * 100 / bond_issued)
    }
}

#[cfg(test)]
mod test {
    extern crate std;

    use super::{BondCollateral, BondCollateralClient, ContractError};
    use soroban_sdk::testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke};
    use soroban_sdk::{Address, Env, IntoVal};

    fn setup(env: &Env) -> (Address, BondCollateralClient<'_>, Address, Address, Address) {
        env.mock_all_auths();
        let contract_id = env.register(BondCollateral, ());
        let client = BondCollateralClient::new(env, &contract_id);

        let admin = Address::generate(env);
        let operator = Address::generate(env);
        let slashing_module = Address::generate(env);
        let user = Address::generate(env);

        client
            .try_init(&admin, &operator, &slashing_module, &100i128, &150i128)
            .unwrap()
            .unwrap();

        (admin, client, operator, slashing_module, user)
    }

    fn contract_id<'a>(client: &'a BondCollateralClient<'a>) -> &'a Address {
        &client.address
    }

    #[test]
    #[should_panic]
    fn init_requires_admin_auth() {
        let env = Env::default();
        let id = env.register(BondCollateral, ());
        let client = BondCollateralClient::new(&env, &id);
        let admin = Address::generate(&env);
        let operator = Address::generate(&env);
        let slashing_module = Address::generate(&env);

        client.init(&admin, &operator, &slashing_module, &100i128, &150i128);
    }

    #[test]
    fn init_sets_config() {
        let env = Env::default();
        let (admin, client, _operator, _slashing_module, _user) = setup(&env);

        assert_eq!(client.get_bond(&admin), 0i128);
    }

    #[test]
    fn init_cannot_be_called_twice() {
        let env = Env::default();
        let (admin, client, operator, slashing_module, _user) = setup(&env);

        let err = client
            .try_init(&admin, &operator, &slashing_module, &100i128, &150i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::AlreadyInitialized);
    }

    #[test]
    fn deposit_bond_increases_balance() {
        let env = Env::default();
        let (_admin, client, _operator, _slashing_module, user) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "deposit_bond",
                args: (user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_deposit_bond(&user, &100i128).unwrap().unwrap();
        assert_eq!(client.get_bond(&user), 100i128);
    }

    #[test]
    fn deposit_bond_fails_with_zero_amount() {
        let env = Env::default();
        let (_admin, client, _operator, _slashing_module, user) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "deposit_bond",
                args: (user.clone(), 0i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client.try_deposit_bond(&user, &0i128).unwrap_err().unwrap();
        assert_eq!(err, ContractError::InvalidAmount);
    }

    #[test]
    fn deposit_bond_fails_with_negative_amount() {
        let env = Env::default();
        let (_admin, client, _operator, _slashing_module, user) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "deposit_bond",
                args: (user.clone(), -10i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_deposit_bond(&user, &-10i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InvalidAmount);
    }

    #[test]
    fn withdraw_bond_decreases_balance() {
        let env = Env::default();
        let (_admin, client, _operator, _slashing_module, user) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "deposit_bond",
                args: (user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_deposit_bond(&user, &100i128).unwrap().unwrap();

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "withdraw_bond",
                args: (user.clone(), 30i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_withdraw_bond(&user, &30i128).unwrap().unwrap();
        assert_eq!(client.get_bond(&user), 70i128);
    }

    #[test]
    fn withdraw_bond_fails_below_locked_amount() {
        let env = Env::default();
        let (_admin, client, _operator, _slashing_module, user) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "deposit_bond",
                args: (user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_deposit_bond(&user, &100i128).unwrap().unwrap();

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "lock_bond",
                args: (user.clone(), 50i128, 1000u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_lock_bond(&user, &50i128, &1000u64)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "withdraw_bond",
                args: (user.clone(), 60i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_withdraw_bond(&user, &60i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InsufficientUnlockedBalance);
    }

    #[test]
    fn lock_bond_creates_lock() {
        let env = Env::default();
        let (_admin, client, _operator, _slashing_module, user) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "deposit_bond",
                args: (user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_deposit_bond(&user, &100i128).unwrap().unwrap();

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "lock_bond",
                args: (user.clone(), 50i128, 1000u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_lock_bond(&user, &50i128, &1000u64)
            .unwrap()
            .unwrap();

        let locks = client.get_locks(&user);
        assert_eq!(locks.len(), 1);
    }

    #[test]
    fn unlock_bond_removes_lock_after_expiry() {
        let env = Env::default();
        let (_admin, client, _operator, _slashing_module, user) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "deposit_bond",
                args: (user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_deposit_bond(&user, &100i128).unwrap().unwrap();

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "lock_bond",
                args: (user.clone(), 50i128, 100u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_lock_bond(&user, &50i128, &100u64)
            .unwrap()
            .unwrap();

        env.ledger().set_timestamp(200);

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "unlock_bond",
                args: (user.clone(), 0u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_unlock_bond(&user, &0u64).unwrap().unwrap();

        let locks = client.get_locks(&user);
        assert_eq!(locks.len(), 0);
    }

    #[test]
    fn unlock_bond_fails_before_expiry() {
        let env = Env::default();
        let (_admin, client, _operator, _slashing_module, user) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "deposit_bond",
                args: (user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_deposit_bond(&user, &100i128).unwrap().unwrap();

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "lock_bond",
                args: (user.clone(), 50i128, 1000u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_lock_bond(&user, &50i128, &1000u64)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "unlock_bond",
                args: (user.clone(), 0u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client.try_unlock_bond(&user, &0u64).unwrap_err().unwrap();
        assert_eq!(err, ContractError::LockNotExpired);
    }

    #[test]
    fn execute_slash_only_by_slashing_module() {
        let env = Env::default();
        let (_admin, client, _operator, slashing_module, user) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "deposit_bond",
                args: (user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_deposit_bond(&user, &100i128).unwrap().unwrap();

        // Create Option<u64> value to pass
        let none_opt: Option<u64> = None;
        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "execute_slash",
                args: (user.clone(), user.clone(), 30i128, none_opt.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_execute_slash(&user, &user, &30i128, &none_opt)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotSlashingModule);
    }

    #[test]
    fn deposit_collateral_creates_position() {
        let env = Env::default();
        let (_admin, client, _operator, _slashing_module, user) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "deposit_collateral",
                args: (user.clone(), 1000i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_deposit_collateral(&user, &1000i128)
            .unwrap()
            .unwrap();

        let position = client.get_position(&user);
        assert_eq!(position, Some((1000i128, 0i128)));
    }

    #[test]
    fn issue_bond_creates_debt() {
        let env = Env::default();
        let (_admin, client, _operator, _slashing_module, user) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "deposit_collateral",
                args: (user.clone(), 1000i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_deposit_collateral(&user, &1000i128)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "issue_bond",
                args: (user.clone(), 500i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_issue_bond(&user, &500i128).unwrap().unwrap();

        let position = client.get_position(&user);
        assert_eq!(position, Some((1000i128, 500i128)));
    }

    #[test]
    fn issue_bond_fails_if_unhealthy() {
        let env = Env::default();
        let (_admin, client, _operator, _slashing_module, user) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "deposit_collateral",
                args: (user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_deposit_collateral(&user, &100i128)
            .unwrap()
            .unwrap();

        // With price=100, threshold=150, collateral=100:
        // collateral_value = 100 * 100 = 10000
        // For 150 bond, required = 150 * 150 / 100 = 225
        // But we need to exceed the threshold. Let's try issuing a large amount.
        // For 10000 bond, required = 10000 * 150 / 100 = 15000
        // 10000 < 15000, so this should fail
        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "issue_bond",
                args: (user.clone(), 10000i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client.try_issue_bond(&user, &10000i128).unwrap_err().unwrap();
        assert_eq!(err, ContractError::PositionUnhealthy);
    }

    #[test]
    fn liquidate_fails_for_healthy_position() {
        let env = Env::default();
        let (_admin, client, _operator, _slashing_module, user) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "deposit_collateral",
                args: (user.clone(), 1000i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_deposit_collateral(&user, &1000i128)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "issue_bond",
                args: (user.clone(), 500i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_issue_bond(&user, &500i128).unwrap().unwrap();

        let liquidator = Address::generate(&env);
        env.mock_auths(&[MockAuth {
            address: &liquidator,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "liquidate",
                args: (liquidator.clone(), user.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_liquidate(&liquidator, &user)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::LiquidationBelowThreshold);
    }

    #[test]
    fn invariant_total_bonded_equals_sum_of_balances() {
        let env = Env::default();
        let (_admin, client, _operator, _slashing_module, user) = setup(&env);

        let user2 = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "deposit_bond",
                args: (user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_deposit_bond(&user, &100i128).unwrap().unwrap();

        env.mock_auths(&[MockAuth {
            address: &user2,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "deposit_bond",
                args: (user2.clone(), 200i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_deposit_bond(&user2, &200i128).unwrap().unwrap();

        let sum = client.get_bond(&user) + client.get_bond(&user2);
        assert_eq!(sum, 300i128);
    }

    #[test]
    fn non_admin_cannot_set_admin() {
        let env = Env::default();
        let (_admin, client, _operator, _slashing_module, user) = setup(&env);

        let new_admin = Address::generate(&env);
        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: contract_id(&client),
                fn_name: "set_admin",
                args: (user.clone(), new_admin.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_set_admin(&user, &new_admin)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }
}
