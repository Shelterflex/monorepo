#![no_std]

#[cfg(test)]
mod integration_test;
#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, xdr::ToXdr, Address, BytesN, Env, IntoVal,
    Symbol, Val, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TimelockError {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    InvalidDelay = 3,
    TransactionAlreadyQueued = 4,
    TransactionNotQueued = 5,
    TimestampNotMet = 6,
    TransactionExpired = 7,
    InsufficientMultisigApprovals = 8,
    ContractPaused = 9,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    MinDelay,
    MaxDelay,
    Queued(BytesN<32>),
    MultisigMembers,
    Paused,
}

#[contract]
pub struct Timelock;

#[contractimpl]
impl Timelock {
    /// Initialize the Timelock contract
    pub fn init(
        env: Env,
        admin: Address,
        min_delay: u64,
        max_delay: u64,
        multisig_members: Vec<Address>,
    ) -> Result<(), TimelockError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(TimelockError::AlreadyInitialized);
        }

        if min_delay > max_delay {
            return Err(TimelockError::InvalidDelay);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::MinDelay, &min_delay);
        env.storage().instance().set(&DataKey::MaxDelay, &max_delay);
        env.storage()
            .instance()
            .set(&DataKey::MultisigMembers, &multisig_members);
        env.storage().instance().set(&DataKey::Paused, &false);

        Ok(())
    }

    /// Queue a transaction for future execution
    pub fn queue(
        env: Env,
        admin: Address,
        target: Address,
        function: Symbol,
        args: Vec<Val>,
        delay: u64,
    ) -> Result<BytesN<32>, TimelockError> {
        admin.require_auth();
        let current_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != current_admin {
            return Err(TimelockError::NotAuthorized);
        }

        let min: u64 = env
            .storage()
            .instance()
            .get(&DataKey::MinDelay)
            .unwrap_or(0);
        let max: u64 = env
            .storage()
            .instance()
            .get(&DataKey::MaxDelay)
            .unwrap_or(u64::MAX);

        if delay < min || delay > max {
            return Err(TimelockError::InvalidDelay);
        }

        let now = env.ledger().timestamp();
        let eta = now + delay;

        // Create a unique hash for the transaction using XDR serialization
        let mut hash_data = Vec::new(&env);
        hash_data.push_back(target.to_val());
        hash_data.push_back(function.to_val());
        for arg in args.iter() {
            hash_data.push_back(arg);
        }
        hash_data.push_back(eta.into_val(&env));

        let tx_hash = env.crypto().sha256(&hash_data.to_xdr(&env));
        let tx_hash_n: BytesN<32> = tx_hash.into();

        if env
            .storage()
            .temporary()
            .has(&DataKey::Queued(tx_hash_n.clone()))
        {
            return Err(TimelockError::TransactionAlreadyQueued);
        }

        env.storage()
            .temporary()
            .set(&DataKey::Queued(tx_hash_n.clone()), &eta);

        env.events().publish(
            (Symbol::new(&env, "governance"), Symbol::new(&env, "queued")),
            (tx_hash_n.clone(), target, function, args, eta),
        );

        Ok(tx_hash_n)
    }

    /// Execute a queued transaction after the delay has passed
    pub fn execute(
        env: Env,
        target: Address,
        function: Symbol,
        args: Vec<Val>,
        eta: u64,
    ) -> Result<Val, TimelockError> {
        if env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
        {
            return Err(TimelockError::ContractPaused);
        }

        let mut hash_data = Vec::new(&env);
        hash_data.push_back(target.to_val());
        hash_data.push_back(function.to_val());
        for arg in args.iter() {
            hash_data.push_back(arg);
        }
        hash_data.push_back(eta.into_val(&env));

        let tx_hash = env.crypto().sha256(&hash_data.to_xdr(&env));
        let tx_hash_n: BytesN<32> = tx_hash.into();

        let stored_eta: u64 = env
            .storage()
            .temporary()
            .get(&DataKey::Queued(tx_hash_n.clone()))
            .ok_or(TimelockError::TransactionNotQueued)?;

        if stored_eta != eta {
            return Err(TimelockError::TransactionNotQueued);
        }

        let now = env.ledger().timestamp();
        if now < eta {
            return Err(TimelockError::TimestampNotMet);
        }

        // Grace period (e.g., 2 weeks) to avoid stale transactions sitting in the queue
        if now > eta + 1_209_600 {
            return Err(TimelockError::TransactionExpired);
        }

        env.storage()
            .temporary()
            .remove(&DataKey::Queued(tx_hash_n.clone()));

        // Perform the call
        let result = env.invoke_contract::<Val>(&target, &function, args);

        env.events().publish(
            (
                Symbol::new(&env, "governance"),
                Symbol::new(&env, "executed"),
            ),
            tx_hash_n,
        );

        Ok(result)
    }

    /// Cancel a queued transaction
    pub fn cancel(env: Env, admin: Address, tx_hash: BytesN<32>) -> Result<(), TimelockError> {
        admin.require_auth();
        let current_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != current_admin {
            return Err(TimelockError::NotAuthorized);
        }

        if !env
            .storage()
            .temporary()
            .has(&DataKey::Queued(tx_hash.clone()))
        {
            return Err(TimelockError::TransactionNotQueued);
        }

        env.storage()
            .temporary()
            .remove(&DataKey::Queued(tx_hash.clone()));

        env.events().publish(
            (
                Symbol::new(&env, "governance"),
                Symbol::new(&env, "cancelled"),
            ),
            tx_hash,
        );

        Ok(())
    }

    /// Emergency pause using multisig (requires 2 members to authorize)
    pub fn emergency_pause(env: Env, members: Vec<Address>) -> Result<(), TimelockError> {
        if members.len() < 2 {
            return Err(TimelockError::InsufficientMultisigApprovals);
        }

        let allowed_members: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::MultisigMembers)
            .unwrap();

        for member in members.iter() {
            member.require_auth();
            if !allowed_members.contains(&member) {
                return Err(TimelockError::NotAuthorized);
            }
        }

        env.storage().instance().set(&DataKey::Paused, &true);

        env.events().publish(
            (
                Symbol::new(&env, "governance"),
                Symbol::new(&env, "emergency_pause"),
            ),
            (),
        );

        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), TimelockError> {
        admin.require_auth();
        let current_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != current_admin {
            return Err(TimelockError::NotAuthorized);
        }

        env.storage().instance().set(&DataKey::Paused, &false);
        Ok(())
    }
}
