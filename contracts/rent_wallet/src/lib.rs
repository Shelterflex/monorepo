#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, Map, Symbol};

#[contracttype]
#[derive(Clone)]

pub enum DataKey {
    Admin,

    Balances,

    Paused,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    Paused = 3,
    InvalidAmount = 4,
    InsufficientBalance = 5,
}

#[contract]

pub struct RentWallet;

fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<_, Address>(&DataKey::Admin)
        .expect("admin not set")
}

fn balances(env: &Env) -> Map<Address, i128> {
    env.storage()
        .instance()
        .get::<_, Map<Address, i128>>(&DataKey::Balances)
        .unwrap_or_else(|| Map::new(env))
}

fn put_balances(env: &Env, b: Map<Address, i128>) {
    env.storage().instance().set(&DataKey::Balances, &b)
}

fn require_admin(env: &Env, caller: &Address) -> Result<(), ContractError> {
    let admin = get_admin(env);
    caller.require_auth();

    if caller != &admin {
        return Err(ContractError::NotAuthorized);
    }

    Ok(())
}

fn get_paused_state(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<_, bool>(&DataKey::Paused)
        .unwrap_or(false)
}

fn require_not_paused(env: &Env) -> Result<(), ContractError> {
    if get_paused_state(env) {
        return Err(ContractError::Paused);
    }

    Ok(())
}

#[contractimpl]

impl RentWallet {
    pub fn init(env: Env, admin: Address) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);

        env.storage()
            .instance()
            .set(&DataKey::Balances, &Map::<Address, i128>::new(&env));

        env.events().publish(
            (Symbol::new(&env, "rent_wallet"), Symbol::new(&env, "init")),
            admin,
        );

        Ok(())
    }

    pub fn credit(
        env: Env,
        admin: Address,
        user: Address,
        amount: i128,
    ) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;

        require_not_paused(&env)?;
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let mut b = balances(&env);

        let cur = b.get(user.clone()).unwrap_or(0);

        b.set(user.clone(), cur + amount);

        put_balances(&env, b);

        env.events().publish(
            (
                Symbol::new(&env, "rent_wallet"),
                Symbol::new(&env, "credit"),
                user,
            ),
            amount,
        );

        Ok(())
    }

    pub fn debit(
        env: Env,
        admin: Address,
        user: Address,
        amount: i128,
    ) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;

        require_not_paused(&env)?;
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let mut b = balances(&env);

        let cur = b.get(user.clone()).unwrap_or(0);

        if cur < amount {
            return Err(ContractError::InsufficientBalance);
        }

        b.set(user.clone(), cur - amount);

        put_balances(&env, b);

        env.events().publish(
            (
                Symbol::new(&env, "rent_wallet"),
                Symbol::new(&env, "debit"),
                user,
            ),
            amount,
        );

        Ok(())
    }

    pub fn balance(env: Env, user: Address) -> i128 {
        let b = balances(&env);

        b.get(user).unwrap_or(0)
    }

    pub fn set_admin(env: Env, admin: Address, new_admin: Address) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;

        env.storage().instance().set(&DataKey::Admin, &new_admin);

        env.events().publish(
            (
                Symbol::new(&env, "rent_wallet"),
                Symbol::new(&env, "set_admin"),
            ),
            new_admin,
        );

        Ok(())
    }

    pub fn pause(env: Env, admin: Address) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish(
            (Symbol::new(&env, "rent_wallet"), Symbol::new(&env, "pause")),
            (),
        );

        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events().publish(
            (
                Symbol::new(&env, "rent_wallet"),
                Symbol::new(&env, "unpause"),
            ),
            (),
        );

        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        get_paused_state(&env)
    }
}

#[cfg(test)]

mod test {

    extern crate std;

    use super::{ContractError, RentWallet, RentWalletClient};
    use soroban_sdk::testutils::{Address as _, Events, MockAuth, MockAuthInvoke};
    use soroban_sdk::{Address, Env, IntoVal, Symbol, TryIntoVal};

    fn setup(
        env: &Env,
    ) -> (
        soroban_sdk::Address,
        RentWalletClient<'_>,
        Address,
        Address,
        Address,
    ) {
        let contract_id = env.register_contract(None, RentWallet);

        let client = RentWalletClient::new(env, &contract_id);

        let admin = Address::generate(env);

        let user = Address::generate(env);

        let non_admin = Address::generate(env);

        client.try_init(&admin).unwrap().unwrap();

        (contract_id, client, admin, user, non_admin)
    }

    // ============================================================================
    // Init Tests
    // ============================================================================

    #[test]
    fn init_sets_admin() {
        let env = Env::default();
        let contract_id = env.register_contract(None, RentWallet);
        let client = RentWalletClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.try_init(&admin).unwrap().unwrap();

        // Admin should be able to perform admin operations
        let user = Address::generate(&env);
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_credit(&admin, &user, &100i128).unwrap().unwrap();
        assert_eq!(client.balance(&user), 100i128);
    }

    #[test]
    fn init_initializes_empty_balances() {
        let env = Env::default();
        let contract_id = env.register_contract(None, RentWallet);
        let client = RentWalletClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.try_init(&admin).unwrap().unwrap();

        // Balance should be zero for any user initially
        assert_eq!(client.balance(&user), 0i128);
    }

    #[test]
    fn init_cannot_be_called_twice() {
        let env = Env::default();
        let contract_id = env.register_contract(None, RentWallet);
        let client = RentWalletClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.try_init(&admin).unwrap().unwrap();
        let err = client.try_init(&admin).unwrap_err().unwrap();
        assert_eq!(err, ContractError::AlreadyInitialized);
    }

    // ============================================================================
    // Credit Tests
    // ============================================================================

    #[test]
    fn credit_increases_balance() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        assert_eq!(client.balance(&user), 0i128);
        client.try_credit(&admin, &user, &100i128).unwrap().unwrap();
        assert_eq!(client.balance(&user), 100i128);
    }

    #[test]
    fn credit_accumulates_balance() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 50i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_credit(&admin, &user, &50i128).unwrap().unwrap();
        assert_eq!(client.balance(&user), 50i128);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 75i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_credit(&admin, &user, &75i128).unwrap().unwrap();
        assert_eq!(client.balance(&user), 125i128);
    }

    #[test]
    fn credit_fails_with_zero_amount() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 0i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_credit(&admin, &user, &0i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InvalidAmount);
    }

    #[test]
    fn credit_fails_with_negative_amount() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), -10i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_credit(&admin, &user, &-10i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InvalidAmount);
    }

    // ============================================================================
    // Debit Tests
    // ============================================================================

    #[test]
    fn debit_decreases_balance() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        // First credit some balance
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_credit(&admin, &user, &100i128).unwrap().unwrap();
        assert_eq!(client.balance(&user), 100i128);

        // Then debit
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "debit",
                args: (admin.clone(), user.clone(), 30i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_debit(&admin, &user, &30i128).unwrap().unwrap();
        assert_eq!(client.balance(&user), 70i128);
    }

    #[test]
    fn debit_can_reduce_balance_to_zero() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        // Credit balance
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 50i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_credit(&admin, &user, &50i128).unwrap().unwrap();

        // Debit entire balance
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "debit",
                args: (admin.clone(), user.clone(), 50i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_debit(&admin, &user, &50i128).unwrap().unwrap();
        assert_eq!(client.balance(&user), 0i128);
    }

    #[test]
    fn debit_fails_with_insufficient_balance() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        // Credit some balance
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 50i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_credit(&admin, &user, &50i128).unwrap().unwrap();

        // Try to debit more than available
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "debit",
                args: (admin.clone(), user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_debit(&admin, &user, &100i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InsufficientBalance);
    }

    #[test]
    fn debit_fails_when_balance_is_zero() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "debit",
                args: (admin.clone(), user.clone(), 1i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_debit(&admin, &user, &1i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InsufficientBalance);
    }

    #[test]
    fn debit_fails_with_zero_amount() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        // First credit some balance
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_credit(&admin, &user, &100i128).unwrap().unwrap();

        // Try to debit zero
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "debit",
                args: (admin.clone(), user.clone(), 0i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_debit(&admin, &user, &0i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InvalidAmount);
    }

    #[test]
    fn debit_fails_with_negative_amount() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        // First credit some balance
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_credit(&admin, &user, &100i128).unwrap().unwrap();

        // Try to debit negative amount
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "debit",
                args: (admin.clone(), user.clone(), -10i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_debit(&admin, &user, &-10i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InvalidAmount);
    }

    // ============================================================================
    // Balance Tests
    // ============================================================================

    #[test]
    fn balance_returns_zero_for_new_user() {
        let env = Env::default();
        let (_contract_id, client, _admin, user, _non_admin) = setup(&env);
        let new_user = Address::generate(&env);

        assert_eq!(client.balance(&user), 0i128);
        assert_eq!(client.balance(&new_user), 0i128);
    }

    #[test]
    fn balance_reflects_credit_and_debit_operations() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        // Initial balance
        assert_eq!(client.balance(&user), 0i128);

        // After credit
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 200i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_credit(&admin, &user, &200i128).unwrap().unwrap();
        assert_eq!(client.balance(&user), 200i128);

        // After debit
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "debit",
                args: (admin.clone(), user.clone(), 80i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_debit(&admin, &user, &80i128).unwrap().unwrap();
        assert_eq!(client.balance(&user), 120i128);
    }

    // ============================================================================
    // Admin Authorization Tests
    // ============================================================================

    #[test]
    fn non_admin_cannot_credit() {
        let env = Env::default();

        let (contract_id, client, _admin, user, non_admin) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &non_admin,

            invoke: &MockAuthInvoke {
                contract: &contract_id,

                fn_name: "credit",

                args: (non_admin.clone(), user.clone(), 100i128).into_val(&env),

                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_credit(&non_admin, &user, &100i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    #[test]
    fn non_admin_cannot_debit() {
        let env = Env::default();

        let (contract_id, client, _admin, user, non_admin) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &non_admin,

            invoke: &MockAuthInvoke {
                contract: &contract_id,

                fn_name: "debit",

                args: (non_admin.clone(), user.clone(), 1i128).into_val(&env),

                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_debit(&non_admin, &user, &1i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    #[test]
    fn admin_can_set_admin() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);
        let new_admin = Address::generate(&env);

        // Original admin can set new admin
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_admin",
                args: (admin.clone(), new_admin.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_set_admin(&admin, &new_admin).unwrap().unwrap();

        // New admin should be able to perform admin operations
        env.mock_auths(&[MockAuth {
            address: &new_admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (new_admin.clone(), user.clone(), 50i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_credit(&new_admin, &user, &50i128)
            .unwrap()
            .unwrap();
        assert_eq!(client.balance(&user), 50i128);
    }

    #[test]
    fn non_admin_cannot_set_admin() {
        let env = Env::default();

        let (contract_id, client, _admin, _user, non_admin) = setup(&env);

        let new_admin = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &non_admin,

            invoke: &MockAuthInvoke {
                contract: &contract_id,

                fn_name: "set_admin",

                args: (non_admin.clone(), new_admin.clone()).into_val(&env),

                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_set_admin(&non_admin, &new_admin)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    #[test]
    fn admin_can_pause() {
        let env = Env::default();
        let (contract_id, client, admin, _user, _non_admin) = setup(&env);

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
    }

    #[test]
    fn admin_can_unpause() {
        let env = Env::default();
        let (contract_id, client, admin, _user, _non_admin) = setup(&env);

        // First pause
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

        // Then unpause
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
    fn non_admin_cannot_pause() {
        let env = Env::default();
        let (contract_id, client, _admin, _user, non_admin) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &non_admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "pause",
                args: (non_admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client.try_pause(&non_admin).unwrap_err().unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    #[test]
    fn non_admin_cannot_unpause() {
        let env = Env::default();
        let (contract_id, client, admin, _user, non_admin) = setup(&env);

        // First pause as admin
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

        // Try to unpause as non-admin
        env.mock_auths(&[MockAuth {
            address: &non_admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "unpause",
                args: (non_admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client.try_unpause(&non_admin).unwrap_err().unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    #[test]
    fn credit_fails_when_paused() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        // Pause the contract
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

        // Try to credit while paused
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_credit(&admin, &user, &100i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::Paused);
    }

    #[test]
    fn debit_fails_when_paused() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        // First credit some balance
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_credit(&admin, &user, &100i128).unwrap().unwrap();

        // Pause the contract
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

        // Try to debit while paused
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "debit",
                args: (admin.clone(), user.clone(), 50i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_debit(&admin, &user, &50i128)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::Paused);
    }

    #[test]
    fn balance_works_when_paused() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        // Credit some balance
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_credit(&admin, &user, &100i128).unwrap().unwrap();
        assert_eq!(client.balance(&user), 100i128);

        // Pause the contract
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

        // Balance should still be readable
        assert_eq!(client.balance(&user), 100i128);
    }

    #[test]
    fn is_paused_returns_false_initially() {
        let env = Env::default();
        let (_contract_id, client, _admin, _user, _non_admin) = setup(&env);
        assert!(!client.is_paused());
    }

    // ============================================================================
    // Event Tests
    // ============================================================================

    #[test]
    fn credit_emits_event() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 100i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        client.try_credit(&admin, &user, &100i128).unwrap().unwrap();

        let events = env.events().all();
        let event = events.last().unwrap();

        let topics: soroban_sdk::Vec<soroban_sdk::Val> = event.1.clone();
        assert_eq!(topics.len(), 3);

        let event_name: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(event_name, Symbol::new(&env, "rent_wallet"));

        let event_action: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(event_action, Symbol::new(&env, "credit"));

        let event_user: Address = topics.get(2).unwrap().try_into_val(&env).unwrap();
        assert_eq!(event_user, user);

        let data: i128 = event.2.try_into_val(&env).unwrap();
        assert_eq!(data, 100i128);
    }

    #[test]
    fn debit_emits_event() {
        let env = Env::default();
        let (contract_id, client, admin, user, _non_admin) = setup(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "credit",
                args: (admin.clone(), user.clone(), 200i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_credit(&admin, &user, &200i128).unwrap().unwrap();

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "debit",
                args: (admin.clone(), user.clone(), 50i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.try_debit(&admin, &user, &50i128).unwrap().unwrap();

        let events = env.events().all();
        let event = events.last().unwrap();

        let topics: soroban_sdk::Vec<soroban_sdk::Val> = event.1.clone();
        assert_eq!(topics.len(), 3);

        let event_name: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(event_name, Symbol::new(&env, "rent_wallet"));

        let event_action: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(event_action, Symbol::new(&env, "debit"));

        let event_user: Address = topics.get(2).unwrap().try_into_val(&env).unwrap();
        assert_eq!(event_user, user);

        let data: i128 = event.2.try_into_val(&env).unwrap();
        assert_eq!(data, 50i128);
    }
}
