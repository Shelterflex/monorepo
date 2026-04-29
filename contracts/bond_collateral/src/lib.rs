#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, BytesN, Env, Symbol,
};

pub mod access_control;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Token,
    BondCollateral(BytesN<32>),
    TotalCollateral,
    WarningThreshold,
    LiquidationThreshold,
    KeeperRewardCap,
    ContractVersion,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CollateralPosition {
    pub owner: Address,
    pub collateral_amount: i128,
    pub bond_amount: i128,
    pub created_at: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    InvalidAmount = 3,
    InsufficientCollateral = 4,
    PositionNotFound = 5,
    CannotLiquidate = 6,
    BelowThreshold = 7,
    InvalidThreshold = 8,
    InvalidRewardCap = 9,
    CollateralRatioTooLow = 10,
    NoSurplus = 11,
}

impl From<access_control::AccessControlError> for ContractError {
    fn from(_err: access_control::AccessControlError) -> Self {
        ContractError::NotAuthorized
    }
}

#[contract]
pub struct BondCollateral;

fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("admin not set")
}

fn get_token(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Token)
        .expect("token not set")
}

fn get_contract_version(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::ContractVersion)
        .unwrap_or(1u32)
}

fn get_warning_threshold(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::WarningThreshold)
        .unwrap_or(150u32)
}

fn get_liquidation_threshold(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::LiquidationThreshold)
        .unwrap_or(120u32)
}

fn get_keeper_reward_cap(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::KeeperRewardCap)
        .unwrap_or(500u32)
}

fn calculate_collateral_ratio(collateral: i128, bond: i128) -> u32 {
    if bond == 0 {
        return u32::MAX;
    }
    ((collateral as f64 / bond as f64) * 100.0) as u32
}

fn get_position(env: &Env, position_id: &BytesN<32>) -> Option<CollateralPosition> {
    env.storage()
        .persistent()
        .get(&DataKey::BondCollateral(position_id.clone()))
}

fn put_position(env: &Env, position_id: &BytesN<32>, position: &CollateralPosition) {
    env.storage()
        .persistent()
        .set(&DataKey::BondCollateral(position_id.clone()), position);
}

fn remove_position(env: &Env, position_id: &BytesN<32>) {
    env.storage()
        .persistent()
        .remove(&DataKey::BondCollateral(position_id.clone()));
}

fn get_total_collateral(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalCollateral)
        .unwrap_or(0)
}

fn put_total_collateral(env: &Env, total: i128) {
    env.storage()
        .instance()
        .set(&DataKey::TotalCollateral, &total);
}

#[contractimpl]
impl BondCollateral {
    pub fn init(env: Env, admin: Address, token: Address) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage()
            .instance()
            .set(&DataKey::ContractVersion, &1u32);
        env.storage()
            .instance()
            .set(&DataKey::TotalCollateral, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::WarningThreshold, &150u32);
        env.storage()
            .instance()
            .set(&DataKey::LiquidationThreshold, &120u32);
        env.storage()
            .instance()
            .set(&DataKey::KeeperRewardCap, &500u32);

        env.events().publish(
            (
                Symbol::new(&env, "bond_collateral"),
                Symbol::new(&env, "init"),
            ),
            admin,
        );

        Ok(())
    }

    pub fn contract_version(env: Env) -> u32 {
        get_contract_version(&env)
    }

    pub fn set_admin(env: Env, admin: Address, new_admin: Address) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "set_admin")?;

        env.storage().instance().set(&DataKey::Admin, &new_admin);

        env.events().publish(
            (
                Symbol::new(&env, "bond_collateral"),
                Symbol::new(&env, "set_admin"),
            ),
            (admin, new_admin),
        );
        Ok(())
    }

    pub fn set_thresholds(
        env: Env,
        admin: Address,
        warning: u32,
        liquidation: u32,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(&env, &current_admin, &admin, "set_thresholds")?;

        if warning <= liquidation || liquidation < 100 {
            return Err(ContractError::InvalidThreshold);
        }

        env.storage()
            .instance()
            .set(&DataKey::WarningThreshold, &warning);
        env.storage()
            .instance()
            .set(&DataKey::LiquidationThreshold, &liquidation);

        env.events().publish(
            (
                Symbol::new(&env, "bond_collateral"),
                Symbol::new(&env, "set_thresholds"),
            ),
            (warning, liquidation),
        );

        Ok(())
    }

    pub fn set_keeper_reward_cap(
        env: Env,
        admin: Address,
        cap_bps: u32,
    ) -> Result<(), ContractError> {
        let current_admin = get_admin(&env);
        access_control::require_admin_permission(
            &env,
            &current_admin,
            &admin,
            "set_keeper_reward_cap",
        )?;

        if cap_bps > 5000 {
            return Err(ContractError::InvalidRewardCap);
        }

        env.storage()
            .instance()
            .set(&DataKey::KeeperRewardCap, &cap_bps);

        env.events().publish(
            (
                Symbol::new(&env, "bond_collateral"),
                Symbol::new(&env, "set_keeper_reward_cap"),
            ),
            cap_bps,
        );

        Ok(())
    }

    pub fn deposit_collateral(
        env: Env,
        owner: Address,
        position_id: BytesN<32>,
        amount: i128,
    ) -> Result<(), ContractError> {
        owner.require_auth();

        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let token_address = get_token(&env);
        let token_client = token::Client::new(&env, &token_address);

        token_client.transfer(&owner, &env.current_contract_address(), &amount);

        let mut position = get_position(&env, &position_id).unwrap_or(CollateralPosition {
            owner: owner.clone(),
            collateral_amount: 0,
            bond_amount: 0,
            created_at: env.ledger().timestamp(),
        });

        if position.owner != owner {
            return Err(ContractError::NotAuthorized);
        }

        position.collateral_amount += amount;
        position.created_at = env.ledger().timestamp();

        put_position(&env, &position_id, &position);

        let total = get_total_collateral(&env) + amount;
        put_total_collateral(&env, total);

        let ratio = calculate_collateral_ratio(position.collateral_amount, position.bond_amount);

        env.events().publish(
            (
                Symbol::new(&env, "bond_collateral"),
                Symbol::new(&env, "collateral_deposited"),
                owner.clone(),
            ),
            (
                position_id.clone(),
                amount,
                position.collateral_amount,
                ratio,
            ),
        );

        if ratio < get_warning_threshold(&env) {
            env.events().publish(
                (
                    Symbol::new(&env, "bond_collateral"),
                    Symbol::new(&env, "warning_threshold_breached"),
                    owner.clone(),
                ),
                (position_id.clone(), ratio, get_warning_threshold(&env)),
            );
        }

        Ok(())
    }

    pub fn issue_bond(
        env: Env,
        owner: Address,
        position_id: BytesN<32>,
        bond_amount: i128,
    ) -> Result<(), ContractError> {
        owner.require_auth();

        if bond_amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let mut position = get_position(&env, &position_id).unwrap_or(CollateralPosition {
            owner: owner.clone(),
            collateral_amount: 0,
            bond_amount: 0,
            created_at: env.ledger().timestamp(),
        });

        if position.owner != owner {
            return Err(ContractError::NotAuthorized);
        }

        position.bond_amount += bond_amount;

        let ratio = calculate_collateral_ratio(position.collateral_amount, position.bond_amount);

        if ratio < get_liquidation_threshold(&env) {
            position.bond_amount -= bond_amount;
            return Err(ContractError::CollateralRatioTooLow);
        }

        put_position(&env, &position_id, &position);

        env.events().publish(
            (
                Symbol::new(&env, "bond_collateral"),
                Symbol::new(&env, "bond_issued"),
                owner.clone(),
            ),
            (
                position_id.clone(),
                bond_amount,
                position.bond_amount,
                ratio,
            ),
        );

        if ratio < get_warning_threshold(&env) {
            env.events().publish(
                (
                    Symbol::new(&env, "bond_collateral"),
                    Symbol::new(&env, "warning_threshold_breached"),
                    owner.clone(),
                ),
                (position_id.clone(), ratio, get_warning_threshold(&env)),
            );
        }

        Ok(())
    }

    pub fn redeem_bond(
        env: Env,
        owner: Address,
        position_id: BytesN<32>,
        bond_amount: i128,
    ) -> Result<(), ContractError> {
        owner.require_auth();

        if bond_amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let mut position =
            get_position(&env, &position_id).ok_or(ContractError::PositionNotFound)?;

        if position.owner != owner {
            return Err(ContractError::NotAuthorized);
        }

        if position.bond_amount < bond_amount {
            return Err(ContractError::InsufficientCollateral);
        }

        position.bond_amount -= bond_amount;
        put_position(&env, &position_id, &position);

        env.events().publish(
            (
                Symbol::new(&env, "bond_collateral"),
                Symbol::new(&env, "bond_redeemed"),
                owner.clone(),
            ),
            (position_id.clone(), bond_amount, position.bond_amount),
        );

        Ok(())
    }

    pub fn withdraw_collateral(
        env: Env,
        owner: Address,
        position_id: BytesN<32>,
        amount: i128,
    ) -> Result<(), ContractError> {
        owner.require_auth();

        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let mut position =
            get_position(&env, &position_id).ok_or(ContractError::PositionNotFound)?;

        if position.owner != owner {
            return Err(ContractError::NotAuthorized);
        }

        if position.collateral_amount < amount {
            return Err(ContractError::InsufficientCollateral);
        }

        let new_collateral = position.collateral_amount - amount;
        let ratio = calculate_collateral_ratio(new_collateral, position.bond_amount);

        if position.bond_amount > 0 && ratio < get_liquidation_threshold(&env) {
            return Err(ContractError::BelowThreshold);
        }

        position.collateral_amount = new_collateral;
        put_position(&env, &position_id, &position);

        let token_address = get_token(&env);
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&env.current_contract_address(), &owner, &amount);

        let total = get_total_collateral(&env) - amount;
        put_total_collateral(&env, total);

        env.events().publish(
            (
                Symbol::new(&env, "bond_collateral"),
                Symbol::new(&env, "collateral_withdrawn"),
                owner.clone(),
            ),
            (position_id.clone(), amount, position.collateral_amount),
        );

        Ok(())
    }

    pub fn liquidate(
        env: Env,
        keeper: Address,
        position_id: BytesN<32>,
    ) -> Result<(), ContractError> {
        keeper.require_auth();

        let position = get_position(&env, &position_id).ok_or(ContractError::PositionNotFound)?;

        let ratio = calculate_collateral_ratio(position.collateral_amount, position.bond_amount);

        if ratio >= get_liquidation_threshold(&env) {
            return Err(ContractError::CannotLiquidate);
        }

        let collateral = position.collateral_amount;
        let bond = position.bond_amount;

        if bond == 0 || collateral == 0 {
            return Err(ContractError::CannotLiquidate);
        }

        let surplus = collateral.saturating_sub(bond);
        let mut keeper_reward = if surplus > 0 {
            (surplus * get_keeper_reward_cap(&env) as i128) / 10000
        } else {
            0
        };

        let max_reward = collateral / 10;
        if keeper_reward > max_reward {
            keeper_reward = max_reward;
        }

        let liquidator_payout = if keeper_reward > 0 {
            collateral.min(keeper_reward)
        } else {
            0
        };

        let token_address = get_token(&env);
        let token_client = token::Client::new(&env, &token_address);

        if liquidator_payout > 0 {
            token_client.transfer(&env.current_contract_address(), &keeper, &liquidator_payout);
        }

        remove_position(&env, &position_id);

        let total = get_total_collateral(&env) - collateral;
        put_total_collateral(&env, total);

        env.events().publish(
            (
                Symbol::new(&env, "bond_collateral"),
                Symbol::new(&env, "liquidation"),
                keeper.clone(),
            ),
            (
                position_id.clone(),
                position.owner.clone(),
                collateral,
                bond,
                ratio,
                liquidator_payout,
            ),
        );

        Ok(())
    }

    pub fn get_position(env: Env, position_id: BytesN<32>) -> Option<CollateralPosition> {
        get_position(&env, &position_id)
    }

    pub fn get_collateral_ratio(env: Env, position_id: BytesN<32>) -> Option<u32> {
        get_position(&env, &position_id)
            .map(|p| calculate_collateral_ratio(p.collateral_amount, p.bond_amount))
    }

    pub fn get_thresholds(env: Env) -> (u32, u32) {
        (get_warning_threshold(&env), get_liquidation_threshold(&env))
    }

    pub fn get_keeper_reward_cap(env: Env) -> u32 {
        get_keeper_reward_cap(&env)
    }

    pub fn total_collateral(env: Env) -> i128 {
        get_total_collateral(&env)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Address, BytesN, Env};

    fn create_position_id(env: &Env, seed: u64) -> BytesN<32> {
        let mut bytes = [0u8; 32];
        bytes[0..8].copy_from_slice(&seed.to_be_bytes());
        BytesN::from_array(env, &bytes)
    }

    #[test]
    fn init_succeeds() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(BondCollateral, ());
        let client = BondCollateralClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token = Address::generate(&env);

        client.try_init(&admin, &token).unwrap().unwrap();

        assert_eq!(client.contract_version(), 1u32);
    }

    #[test]
    fn contract_has_functions() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(BondCollateral, ());
        let client = BondCollateralClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token = Address::generate(&env);

        client.try_init(&admin, &token).unwrap().unwrap();

        let position_id = create_position_id(&env, 1);
        let result = client.get_position(&position_id);
        assert!(result.is_none());
    }
}
