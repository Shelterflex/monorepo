#![no_std]
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, String};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAuthorized = 3,
    InvalidScore = 4,
    ReputationNotFound = 5,
    ScoreBoundsNotSet = 6,
    StaleWrite = 7,
}

#[contract]
pub struct TenantReputationContract;

#[derive(Clone)]
#[contracttype]
pub struct Reputation {
    pub composite_score: u32,
    pub payment_score: u32,
    pub property_care_score: u32,
    pub communication_score: u32,
    pub rating_count: u32,
    pub last_updated: u64,
    pub version: u64,
}

#[derive(Clone)]
#[contracttype]
pub struct ScoreBounds {
    pub min_score: u32,
    pub max_score: u32,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Operator(Address),
    ScoreBounds,
    Reputation(Address),
}

#[contractimpl]
impl TenantReputationContract {
    /// Initialize the contract with an admin address.
    pub fn init(env: Env, admin: Address) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);

        env.events().publish(
            (String::from_str(&env, "init"),),
            admin,
        );

        Ok(())
    }

    /// Update the reputation record for a tenant.
    pub fn update_reputation(
        env: Env,
        caller: Address,
        tenant: Address,
        composite_score: u32,
        payment_score: u32,
        property_care_score: u32,
        communication_score: u32,
        rating_count: u32,
    ) -> Result<(), ContractError> {
        Self::ensure_initialized(&env)?;
        Self::ensure_authorized(&env, &caller)?;

        let bounds = Self::get_score_bounds(&env)?;
        Self::validate_score(composite_score, bounds.min_score, bounds.max_score)?;
        Self::validate_score(payment_score, bounds.min_score, bounds.max_score)?;
        Self::validate_score(property_care_score, bounds.min_score, bounds.max_score)?;
        Self::validate_score(communication_score, bounds.min_score, bounds.max_score)?;

        let ledger_timestamp = env.ledger().timestamp();
        let version = Self::increment_version(&env, &tenant);

        let existing = env.storage().instance().get::<_, Reputation>(&DataKey::Reputation(tenant.clone()));

        if let Some(existing) = existing {
            if ledger_timestamp <= existing.last_updated {
                return Err(ContractError::StaleWrite);
            }
        }

        let reputation = Reputation {
            composite_score,
            payment_score,
            property_care_score,
            communication_score,
            rating_count,
            last_updated: ledger_timestamp,
            version,
        };

        env.storage().instance().set(&DataKey::Reputation(tenant), &reputation);

        env.events().publish(
            (String::from_str(&env, "update_reputation"), caller),
            (composite_score, payment_score, property_care_score, communication_score),
        );

        Ok(())
    }

    /// Revoke the reputation record for a tenant.
    pub fn revoke_reputation(env: Env, caller: Address, tenant: Address) -> Result<(), ContractError> {
        Self::ensure_initialized(&env)?;
        Self::ensure_authorized(&env, &caller)?;

        if !env.storage().instance().has(&DataKey::Reputation(tenant.clone())) {
            return Err(ContractError::ReputationNotFound);
        }

        env.storage().instance().remove(&DataKey::Reputation(tenant.clone()));

        env.events().publish(
            (String::from_str(&env, "revoke_reputation"), caller),
            tenant,
        );

        Ok(())
    }

    /// Get the reputation record for a tenant.
    pub fn get_reputation(env: Env, tenant: Address) -> Option<Reputation> {
        env.storage().instance().get(&DataKey::Reputation(tenant))
    }

    /// Check if a tenant has a reputation record.
    pub fn has_reputation(env: Env, tenant: Address) -> bool {
        env.storage().instance().has(&DataKey::Reputation(tenant))
    }

    /// Set the valid score bounds (min and max).
    pub fn set_score_bounds(env: Env, caller: Address, min_score: u32, max_score: u32) -> Result<(), ContractError> {
        Self::ensure_initialized(&env)?;
        Self::ensure_authorized(&env, &caller)?;

        if min_score >= max_score {
            return Err(ContractError::InvalidScore);
        }

        let bounds = ScoreBounds { min_score, max_score };
        env.storage().instance().set(&DataKey::ScoreBounds, &bounds);

        env.events().publish(
            (String::from_str(&env, "set_score_bounds"), caller),
            (min_score, max_score),
        );

        Ok(())
    }

    /// Set the operator address (allowed to write reputation).
    pub fn set_operator(env: Env, caller: Address, operator: Address) -> Result<(), ContractError> {
        Self::ensure_initialized(&env)?;
        Self::ensure_authorized(&env, &caller)?;

        env.storage().instance().set(&DataKey::Operator(operator.clone()), &true);

        env.events().publish(
            (String::from_str(&env, "set_operator"), caller),
            operator,
        );

        Ok(())
    }

    fn ensure_initialized(env: &Env) -> Result<(), ContractError> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::NotInitialized);
        }
        Ok(())
    }

    fn ensure_authorized(env: &Env, caller: &Address) -> Result<(), ContractError> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        let is_admin = admin == *caller;
        let is_operator = env.storage().instance().get(&DataKey::Operator(caller.clone())).unwrap_or(false);

        if !is_admin && !is_operator {
            return Err(ContractError::NotAuthorized);
        }
        Ok(())
    }

    fn get_score_bounds(env: &Env) -> Result<ScoreBounds, ContractError> {
        env.storage()
            .instance()
            .get(&DataKey::ScoreBounds)
            .ok_or(ContractError::ScoreBoundsNotSet)
    }

    fn validate_score(score: u32, min: u32, max: u32) -> Result<(), ContractError> {
        if score < min || score > max {
            return Err(ContractError::InvalidScore);
        }
        Ok(())
    }

    fn increment_version(env: &Env, tenant: &Address) -> u64 {
        let existing = env.storage().instance().get::<_, Reputation>(&DataKey::Reputation(tenant.clone()));
        match existing {
            Some(rep) => rep.version + 1,
            None => 1,
        }
    }
}

#[cfg(test)]
mod test;
