#![no_std]

use soroban_pausable::{Pausable, PausableError};
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, Symbol};

pub mod access_control;

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReputationRecord {
    pub composite_score: u32,
    pub payment_score: u32,
    pub property_care_score: u32,
    pub communication_score: u32,
    pub total_ratings: u32,
    pub last_updated: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Operator,
    Paused,
    Reputation(Address),
    // ── Decay & bounds config (Issue #1132) ──────────────────────────────────
    /// Score units to subtract per decay period (0 = no decay)
    DecayRatePerPeriod,
    /// Duration of each decay period in seconds
    DecayPeriodSecs,
    /// Minimum allowed composite score (inclusive)
    ScoreMin,
    /// Maximum allowed composite score (inclusive)
    ScoreMax,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    Paused = 3,
    InvalidScore = 4,
}

#[contract]
pub struct TenantReputation;

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

fn score_max(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get::<_, u32>(&DataKey::ScoreMax)
        .unwrap_or(1000)
}

fn score_min(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get::<_, u32>(&DataKey::ScoreMin)
        .unwrap_or(0)
}

fn clamp_score(env: &Env, score: u32) -> u32 {
    let lo = score_min(env);
    let hi = score_max(env);
    score.max(lo).min(hi)
}

/// Compute the decayed composite score without writing to storage.
/// Returns `(decayed_score, did_decay)`.
fn compute_decayed_score(env: &Env, record: &ReputationRecord) -> (u32, bool) {
    let rate: u32 = env
        .storage()
        .instance()
        .get::<_, u32>(&DataKey::DecayRatePerPeriod)
        .unwrap_or(0);
    let period: u64 = env
        .storage()
        .instance()
        .get::<_, u64>(&DataKey::DecayPeriodSecs)
        .unwrap_or(86400);

    if rate == 0 || period == 0 {
        return (record.composite_score, false);
    }

    let now = env.ledger().timestamp();
    if now <= record.last_updated {
        return (record.composite_score, false);
    }

    let elapsed = now - record.last_updated;
    let periods = (elapsed / period) as u32;
    if periods == 0 {
        return (record.composite_score, false);
    }

    let decay_amount = periods.saturating_mul(rate);
    let lo = score_min(env);
    let new_score = record.composite_score.saturating_sub(decay_amount).max(lo);

    (new_score, new_score != record.composite_score)
}

fn emit_updated(env: &Env, tenant: &Address, record: &ReputationRecord, reason: &Symbol) {
    env.events().publish(
        (
            Symbol::new(env, "tenant_reputation"),
            Symbol::new(env, "reputation_updated"),
            tenant.clone(),
        ),
        (
            record.composite_score,
            record.total_ratings,
            record.last_updated,
            reason.clone(),
        ),
    );
}

#[contractimpl]
impl TenantReputation {
    pub fn init(env: Env, admin: Address, operator: Address) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Operator, &operator);
        env.storage().instance().set(&DataKey::Paused, &false);
        // Default decay config: no decay, bounds [0, 1000]
        env.storage()
            .instance()
            .set(&DataKey::DecayRatePerPeriod, &0u32);
        env.storage()
            .instance()
            .set(&DataKey::DecayPeriodSecs, &86400u64);
        env.storage().instance().set(&DataKey::ScoreMin, &0u32);
        env.storage().instance().set(&DataKey::ScoreMax, &1000u32);
        Ok(())
    }

    /// Admin sets the linear decay rate: `decay_rate_per_period` score units per `period_secs`.
    /// Set `decay_rate_per_period = 0` to disable decay.
    pub fn set_decay_config(
        env: Env,
        admin: Address,
        decay_rate_per_period: u32,
        period_secs: u64,
    ) -> Result<(), ContractError> {
        access_control::require_admin_permission(
            &env,
            &get_admin(&env),
            &admin,
            "set_decay_config",
        )?;
        env.storage()
            .instance()
            .set(&DataKey::DecayRatePerPeriod, &decay_rate_per_period);
        env.storage()
            .instance()
            .set(&DataKey::DecayPeriodSecs, &period_secs);
        env.events().publish(
            (
                Symbol::new(&env, "tenant_reputation"),
                Symbol::new(&env, "decay_config_updated"),
            ),
            (decay_rate_per_period, period_secs),
        );
        Ok(())
    }

    /// Admin sets the min/max composite score bounds; future updates are clamped to these.
    pub fn set_score_bounds(
        env: Env,
        admin: Address,
        score_min: u32,
        score_max: u32,
    ) -> Result<(), ContractError> {
        access_control::require_admin_permission(
            &env,
            &get_admin(&env),
            &admin,
            "set_score_bounds",
        )?;
        env.storage().instance().set(&DataKey::ScoreMin, &score_min);
        env.storage().instance().set(&DataKey::ScoreMax, &score_max);
        env.events().publish(
            (
                Symbol::new(&env, "tenant_reputation"),
                Symbol::new(&env, "score_bounds_updated"),
            ),
            (score_min, score_max),
        );
        Ok(())
    }

    pub fn update_reputation(
        env: Env,
        caller: Address,
        tenant: Address,
        record: ReputationRecord,
        reason: Symbol,
    ) -> Result<(), ContractError> {
        require_not_paused(&env)?;
        access_control::require_admin_or_operator_permission(
            &env,
            &get_admin(&env),
            &get_operator(&env),
            &caller,
            "update_reputation",
        )?;

        let clamped_score = clamp_score(&env, record.composite_score);
        let updated = ReputationRecord {
            composite_score: clamped_score,
            last_updated: env.ledger().timestamp(),
            ..record
        };
        env.storage()
            .persistent()
            .set(&DataKey::Reputation(tenant.clone()), &updated);
        emit_updated(&env, &tenant, &updated, &reason);
        Ok(())
    }

    /// Returns the reputation record with lazy decay applied.
    /// Decay is computed from elapsed ledger time since `last_updated`; the stored
    /// record is not written — call `update_reputation` to persist the new score.
    pub fn get_reputation(env: Env, tenant: Address) -> Option<ReputationRecord> {
        let record: ReputationRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Reputation(tenant.clone()))?;

        let (decayed_score, did_decay) = compute_decayed_score(&env, &record);
        if did_decay {
            env.events().publish(
                (
                    Symbol::new(&env, "tenant_reputation"),
                    Symbol::new(&env, "reputation_decayed"),
                    tenant,
                ),
                (record.composite_score, decayed_score),
            );
            Some(ReputationRecord {
                composite_score: decayed_score,
                ..record
            })
        } else {
            Some(record)
        }
    }

    pub fn has_reputation(env: Env, tenant: Address) -> bool {
        env.storage().persistent().has(&DataKey::Reputation(tenant))
    }

    pub fn revoke_reputation(
        env: Env,
        caller: Address,
        tenant: Address,
    ) -> Result<(), ContractError> {
        access_control::require_admin_permission(
            &env,
            &get_admin(&env),
            &caller,
            "revoke_reputation",
        )?;
        if env
            .storage()
            .persistent()
            .has(&DataKey::Reputation(tenant.clone()))
        {
            env.storage()
                .persistent()
                .remove(&DataKey::Reputation(tenant.clone()));
            env.events().publish(
                (
                    Symbol::new(&env, "tenant_reputation"),
                    Symbol::new(&env, "revoked"),
                    tenant,
                ),
                (),
            );
        }
        Ok(())
    }
}

#[contractimpl]
impl Pausable for TenantReputation {
    fn pause(env: Env, admin: Address) -> Result<(), PausableError> {
        access_control::require_admin_permission(&env, &get_admin(&env), &admin, "pause")
            .map_err(|_| PausableError::NotAuthorized)?;
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish(
            (Symbol::new(&env, "Pausable"), Symbol::new(&env, "pause")),
            (),
        );
        Ok(())
    }

    fn unpause(env: Env, admin: Address) -> Result<(), PausableError> {
        access_control::require_admin_permission(&env, &get_admin(&env), &admin, "unpause")
            .map_err(|_| PausableError::NotAuthorized)?;
        env.storage().instance().set(&DataKey::Paused, &false);
        Ok(())
    }

    fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get::<_, bool>(&DataKey::Paused)
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Events, Ledger, MockAuth, MockAuthInvoke};
    use soroban_sdk::{Address, Env, IntoVal, Symbol, TryIntoVal};

    fn sample_record(env: &Env) -> ReputationRecord {
        ReputationRecord {
            composite_score: 750,
            payment_score: 80,
            property_care_score: 70,
            communication_score: 90,
            total_ratings: 5,
            last_updated: env.ledger().timestamp(),
        }
    }

    fn setup(env: &Env) -> (Address, TenantReputationClient<'_>, Address, Address) {
        let contract_id = env.register(TenantReputation, ());
        let client = TenantReputationClient::new(env, &contract_id);
        let admin = Address::generate(env);
        let operator = Address::generate(env);
        client.try_init(&admin, &operator).unwrap().unwrap();
        (contract_id, client, admin, operator)
    }

    fn reason(env: &Env) -> Symbol {
        Symbol::new(env, "test_update")
    }

    #[test]
    fn init_succeeds_once() {
        let env = Env::default();
        let (_id, client, admin, operator) = setup(&env);
        assert!(!client.is_paused());
        let _ = (admin, operator);
    }

    #[test]
    fn init_cannot_be_called_twice() {
        let env = Env::default();
        let (_id, client, admin, operator) = setup(&env);
        let err = client.try_init(&admin, &operator).unwrap_err().unwrap();
        assert_eq!(err, ContractError::AlreadyInitialized);
    }

    #[test]
    fn get_reputation_returns_none_for_unknown() {
        let env = Env::default();
        let (_id, client, _admin, _op) = setup(&env);
        let tenant = Address::generate(&env);
        assert_eq!(client.get_reputation(&tenant), None);
        assert!(!client.has_reputation(&tenant));
    }

    #[test]
    fn operator_can_update_and_overwrite() {
        let env = Env::default();
        env.ledger().set_timestamp(100);
        let (contract_id, client, admin, operator) = setup(&env);
        let tenant = Address::generate(&env);
        let record = sample_record(&env);
        let r = reason(&env);

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_reputation",
                args: (operator.clone(), tenant.clone(), record.clone(), r.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_reputation(&operator, &tenant, &record, &r)
            .unwrap()
            .unwrap();

        let stored = client.get_reputation(&tenant).unwrap();
        assert_eq!(stored.composite_score, 750);
        assert!(client.has_reputation(&tenant));

        let mut updated = record.clone();
        updated.composite_score = 800;
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_reputation",
                args: (admin.clone(), tenant.clone(), updated.clone(), r.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_reputation(&admin, &tenant, &updated, &r)
            .unwrap()
            .unwrap();
        assert_eq!(client.get_reputation(&tenant).unwrap().composite_score, 800);
    }

    #[test]
    fn unauthorized_update_panics() {
        let env = Env::default();
        let (contract_id, client, _admin, _operator) = setup(&env);
        let tenant = Address::generate(&env);
        let stranger = Address::generate(&env);
        let record = sample_record(&env);
        let r = reason(&env);

        env.mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_reputation",
                args: (stranger.clone(), tenant.clone(), record.clone(), r.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_update_reputation(&stranger, &tenant, &record, &r)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    #[test]
    fn revoke_removes_record() {
        let env = Env::default();
        let (contract_id, client, admin, operator) = setup(&env);
        let tenant = Address::generate(&env);
        let record = sample_record(&env);
        let r = reason(&env);

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_reputation",
                args: (operator.clone(), tenant.clone(), record.clone(), r.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_reputation(&operator, &tenant, &record, &r)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "revoke_reputation",
                args: (admin.clone(), tenant.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_revoke_reputation(&admin, &tenant)
            .unwrap()
            .unwrap();
        assert!(!client.has_reputation(&tenant));
        assert_eq!(client.get_reputation(&tenant), None);
    }

    #[test]
    fn pause_blocks_update() {
        let env = Env::default();
        let (contract_id, client, admin, operator) = setup(&env);
        let tenant = Address::generate(&env);
        let record = sample_record(&env);
        let r = reason(&env);

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
                fn_name: "update_reputation",
                args: (operator.clone(), tenant.clone(), record.clone(), r.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let err = client
            .try_update_reputation(&operator, &tenant, &record, &r)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::Paused);

        // reads still work
        assert_eq!(client.get_reputation(&tenant), None);
    }

    #[test]
    fn score_clamped_to_max() {
        let env = Env::default();
        let (contract_id, client, admin, operator) = setup(&env);
        let tenant = Address::generate(&env);
        let r = reason(&env);

        // max is 1000 by default; submitting 1500 should be clamped to 1000
        let mut record = sample_record(&env);
        record.composite_score = 1500;

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_reputation",
                args: (operator.clone(), tenant.clone(), record.clone(), r.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_reputation(&operator, &tenant, &record, &r)
            .unwrap()
            .unwrap();

        let stored = client.get_reputation(&tenant).unwrap();
        assert_eq!(stored.composite_score, 1000);

        // Admin raises max to 1200; now 1500 should clamp to 1200
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_score_bounds",
                args: (admin.clone(), 0u32, 1200u32).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_set_score_bounds(&admin, &0u32, &1200u32)
            .unwrap()
            .unwrap();

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_reputation",
                args: (operator.clone(), tenant.clone(), record.clone(), r.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_reputation(&operator, &tenant, &record, &r)
            .unwrap()
            .unwrap();
        assert_eq!(
            client.get_reputation(&tenant).unwrap().composite_score,
            1200
        );
    }

    #[test]
    fn score_clamped_to_min() {
        let env = Env::default();
        let (contract_id, client, admin, operator) = setup(&env);
        let tenant = Address::generate(&env);
        let r = reason(&env);

        // Set min to 100
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_score_bounds",
                args: (admin.clone(), 100u32, 1000u32).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_set_score_bounds(&admin, &100u32, &1000u32)
            .unwrap()
            .unwrap();

        let mut record = sample_record(&env);
        record.composite_score = 50; // below min

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_reputation",
                args: (operator.clone(), tenant.clone(), record.clone(), r.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_reputation(&operator, &tenant, &record, &r)
            .unwrap()
            .unwrap();

        assert_eq!(client.get_reputation(&tenant).unwrap().composite_score, 100);
    }

    #[test]
    fn decay_reduces_score_over_time() {
        let env = Env::default();
        env.ledger().set_timestamp(1000);
        let (contract_id, client, admin, operator) = setup(&env);
        let tenant = Address::generate(&env);
        let r = reason(&env);

        // decay 10 per day (86400 s)
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_decay_config",
                args: (admin.clone(), 10u32, 86400u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_set_decay_config(&admin, &10u32, &86400u64)
            .unwrap()
            .unwrap();

        let record = sample_record(&env); // composite_score = 750

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_reputation",
                args: (operator.clone(), tenant.clone(), record.clone(), r.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_reputation(&operator, &tenant, &record, &r)
            .unwrap()
            .unwrap();

        // 3 days later → decay 30
        env.ledger().set_timestamp(1000 + 3 * 86400);
        let got = client.get_reputation(&tenant).unwrap();
        assert_eq!(got.composite_score, 720); // 750 - 30
    }

    #[test]
    fn no_decay_without_elapsed_time() {
        let env = Env::default();
        env.ledger().set_timestamp(5000);
        let (contract_id, client, admin, operator) = setup(&env);
        let tenant = Address::generate(&env);
        let r = reason(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_decay_config",
                args: (admin.clone(), 50u32, 86400u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_set_decay_config(&admin, &50u32, &86400u64)
            .unwrap()
            .unwrap();

        let record = sample_record(&env);
        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_reputation",
                args: (operator.clone(), tenant.clone(), record.clone(), r.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_reputation(&operator, &tenant, &record, &r)
            .unwrap()
            .unwrap();

        // Same timestamp — no decay
        let got = client.get_reputation(&tenant).unwrap();
        assert_eq!(got.composite_score, 750);
    }

    #[test]
    fn decay_clamped_at_score_min() {
        let env = Env::default();
        env.ledger().set_timestamp(0);
        let (contract_id, client, admin, operator) = setup(&env);
        let tenant = Address::generate(&env);
        let r = reason(&env);

        // Very high decay rate
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_decay_config",
                args: (admin.clone(), 500u32, 86400u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_set_decay_config(&admin, &500u32, &86400u64)
            .unwrap()
            .unwrap();

        let mut record = sample_record(&env);
        record.composite_score = 100;
        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_reputation",
                args: (operator.clone(), tenant.clone(), record.clone(), r.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_reputation(&operator, &tenant, &record, &r)
            .unwrap()
            .unwrap();

        // 10 days later → would decay 5000, but clamped to score_min (0)
        env.ledger().set_timestamp(10 * 86400);
        let got = client.get_reputation(&tenant).unwrap();
        assert_eq!(got.composite_score, 0);
    }

    #[test]
    fn revoke_resets_reputation() {
        let env = Env::default();
        let (contract_id, client, admin, operator) = setup(&env);
        let tenant = Address::generate(&env);
        let record = sample_record(&env);
        let r = reason(&env);

        env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_reputation",
                args: (operator.clone(), tenant.clone(), record.clone(), r.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_update_reputation(&operator, &tenant, &record, &r)
            .unwrap()
            .unwrap();
        assert!(client.has_reputation(&tenant));

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "revoke_reputation",
                args: (admin.clone(), tenant.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client
            .try_revoke_reputation(&admin, &tenant)
            .unwrap()
            .unwrap();

        // After revoke, reputation should be None regardless of prior score
        assert!(!client.has_reputation(&tenant));
        assert_eq!(client.get_reputation(&tenant), None);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Issue #1422 — added coverage for tenant_reputation.
    //
    // Step taxonomy referenced in comments:
    //   A1 anchor / core invariant   A2 authorization
    //   A3 initialization edges      A4 decay & clamp boundaries
    //   A5 events
    //
    // The test env exposes only the MOST RECENT invocation's events, so event
    // assertions below read `env.events()` immediately after the emitting call
    // with no intervening `client.*` call.
    // ─────────────────────────────────────────────────────────────────────────

    fn m_update(
        env: &Env,
        cid: &Address,
        caller: &Address,
        tenant: &Address,
        rec: &ReputationRecord,
        r: &Symbol,
    ) {
        env.mock_auths(&[MockAuth {
            address: caller,
            invoke: &MockAuthInvoke {
                contract: cid,
                fn_name: "update_reputation",
                args: (caller.clone(), tenant.clone(), rec.clone(), r.clone()).into_val(env),
                sub_invokes: &[],
            },
        }]);
    }

    fn m_revoke(env: &Env, cid: &Address, caller: &Address, tenant: &Address) {
        env.mock_auths(&[MockAuth {
            address: caller,
            invoke: &MockAuthInvoke {
                contract: cid,
                fn_name: "revoke_reputation",
                args: (caller.clone(), tenant.clone()).into_val(env),
                sub_invokes: &[],
            },
        }]);
    }

    fn m_set_decay(env: &Env, cid: &Address, caller: &Address, rate: u32, period: u64) {
        env.mock_auths(&[MockAuth {
            address: caller,
            invoke: &MockAuthInvoke {
                contract: cid,
                fn_name: "set_decay_config",
                args: (caller.clone(), rate, period).into_val(env),
                sub_invokes: &[],
            },
        }]);
    }

    fn m_set_bounds(env: &Env, cid: &Address, caller: &Address, lo: u32, hi: u32) {
        env.mock_auths(&[MockAuth {
            address: caller,
            invoke: &MockAuthInvoke {
                contract: cid,
                fn_name: "set_score_bounds",
                args: (caller.clone(), lo, hi).into_val(env),
                sub_invokes: &[],
            },
        }]);
    }

    fn m_pause(env: &Env, cid: &Address, caller: &Address) {
        env.mock_auths(&[MockAuth {
            address: caller,
            invoke: &MockAuthInvoke {
                contract: cid,
                fn_name: "pause",
                args: (caller.clone(),).into_val(env),
                sub_invokes: &[],
            },
        }]);
    }

    fn m_unpause(env: &Env, cid: &Address, caller: &Address) {
        env.mock_auths(&[MockAuth {
            address: caller,
            invoke: &MockAuthInvoke {
                contract: cid,
                fn_name: "unpause",
                args: (caller.clone(),).into_val(env),
                sub_invokes: &[],
            },
        }]);
    }

    fn last_topics(env: &Env) -> soroban_sdk::Vec<soroban_sdk::Val> {
        env.events().all().last().unwrap().1
    }

    fn last_data(env: &Env) -> soroban_sdk::Vec<soroban_sdk::Val> {
        env.events()
            .all()
            .last()
            .unwrap()
            .2
            .try_into_val(env)
            .unwrap()
    }

    // ── A1 · ANCHOR (B) — interested-party manipulation ─────────────────────
    //
    // Recon 3g established that tenant_reputation has NO writer<->tenant
    // relationship model. `update_reputation` authorises the caller iff it is
    // the single global admin OR the single global operator address; the
    // `tenant` being scored is a free parameter with no checked link to the
    // caller, and `composite_score` is caller-supplied (only clamped), not
    // derived from the sub-scores.
    //
    // The four tests below PIN THAT CURRENT BEHAVIOUR pending a maintainer
    // decision. They document what the contract allows today and are NOT an
    // endorsement of it. Per the issue's own framing — "a reputation that can
    // be manipulated by an interested party is worse than none at all" — this
    // is the headline finding of the PR.

    /// An authorised operator can write a score for an address it has no
    /// relationship with whatsoever.
    #[test]
    fn anchor_b_operator_can_score_an_unrelated_address() {
        let env = Env::default();
        env.ledger().set_timestamp(100);
        let (cid, client, _admin, operator) = setup(&env);
        let unrelated_tenant = Address::generate(&env);
        let rec = sample_record(&env);
        let r = reason(&env);

        m_update(&env, &cid, &operator, &unrelated_tenant, &rec, &r);
        client
            .try_update_reputation(&operator, &unrelated_tenant, &rec, &r)
            .unwrap()
            .unwrap();

        assert_eq!(
            client
                .get_reputation(&unrelated_tenant)
                .unwrap()
                .composite_score,
            750
        );
    }

    /// An authorised operator can score ITSELF — there is no `caller == tenant`
    /// guard — and hand itself the maximum composite score.
    #[test]
    fn anchor_b_operator_can_self_score_to_the_maximum() {
        let env = Env::default();
        env.ledger().set_timestamp(100);
        let (cid, client, _admin, operator) = setup(&env);
        let mut rec = sample_record(&env);
        rec.composite_score = 5_000; // clamps to the default max of 1000
        let r = reason(&env);

        m_update(&env, &cid, &operator, &operator, &rec, &r);
        client
            .try_update_reputation(&operator, &operator, &rec, &r)
            .unwrap()
            .unwrap();

        assert_eq!(
            client.get_reputation(&operator).unwrap().composite_score,
            1000
        );
    }

    /// An operator can overwrite an existing, legitimate score with an
    /// arbitrary new value. The overwrite invocation emits only the generic
    /// `reputation_updated` event — there is no on-chain audit record of who
    /// changed what (contrast rent_schedule's persisted `WaiverAudit`).
    #[test]
    fn anchor_b_operator_can_overwrite_a_legitimate_score_unaudited() {
        let env = Env::default();
        env.ledger().set_timestamp(100);
        let (cid, client, _admin, operator) = setup(&env);
        let tenant = Address::generate(&env);
        let r = reason(&env);

        let mut good = sample_record(&env);
        good.composite_score = 800;
        m_update(&env, &cid, &operator, &tenant, &good, &r);
        client
            .try_update_reputation(&operator, &tenant, &good, &r)
            .unwrap()
            .unwrap();

        let mut tanked = sample_record(&env);
        tanked.composite_score = 100;
        m_update(&env, &cid, &operator, &tenant, &tanked, &r);
        client
            .try_update_reputation(&operator, &tenant, &tanked, &r)
            .unwrap()
            .unwrap();

        // The overwrite produced exactly one event, and it is the generic
        // update event — no distinct audit event exists.
        let all = env.events().all();
        assert_eq!(all.len(), 1);
        let action: Symbol = all
            .get(0)
            .unwrap()
            .1
            .get(1)
            .unwrap()
            .try_into_val(&env)
            .unwrap();
        assert_eq!(action, Symbol::new(&env, "reputation_updated"));

        assert_eq!(client.get_reputation(&tenant).unwrap().composite_score, 100);
    }

    /// `composite_score` is caller-supplied and only clamped — it is NOT
    /// derived from the sub-scores or from `total_ratings`. An operator can
    /// store a perfect composite backed by zero ratings.
    #[test]
    fn anchor_b_operator_can_set_perfect_composite_with_zero_ratings() {
        let env = Env::default();
        env.ledger().set_timestamp(100);
        let (cid, client, _admin, operator) = setup(&env);
        let tenant = Address::generate(&env);
        let r = reason(&env);

        let rec = ReputationRecord {
            composite_score: 1000,
            payment_score: 0,
            property_care_score: 0,
            communication_score: 0,
            total_ratings: 0,
            last_updated: 0,
        };
        m_update(&env, &cid, &operator, &tenant, &rec, &r);
        client
            .try_update_reputation(&operator, &tenant, &rec, &r)
            .unwrap()
            .unwrap();

        let stored = client.get_reputation(&tenant).unwrap();
        assert_eq!(stored.composite_score, 1000);
        assert_eq!(stored.total_ratings, 0);
    }

    // ── A2 · authorization ────────────────────────────────────────────────

    #[test]
    fn revoke_reputation_rejects_unauthorized_caller() {
        let env = Env::default();
        let (cid, client, _admin, _operator) = setup(&env);
        let tenant = Address::generate(&env);
        let stranger = Address::generate(&env);
        m_revoke(&env, &cid, &stranger, &tenant);
        let err = client
            .try_revoke_reputation(&stranger, &tenant)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    /// `revoke_reputation` is admin-only — the operator cannot revoke.
    #[test]
    fn revoke_reputation_rejects_operator() {
        let env = Env::default();
        let (cid, client, _admin, operator) = setup(&env);
        let tenant = Address::generate(&env);
        m_revoke(&env, &cid, &operator, &tenant);
        let err = client
            .try_revoke_reputation(&operator, &tenant)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    #[test]
    fn set_decay_config_rejects_unauthorized_caller() {
        let env = Env::default();
        let (cid, client, _admin, _operator) = setup(&env);
        let stranger = Address::generate(&env);
        m_set_decay(&env, &cid, &stranger, 10, 86_400);
        let err = client
            .try_set_decay_config(&stranger, &10u32, &86_400u64)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    /// `set_decay_config` is admin-only — the operator cannot change decay.
    #[test]
    fn set_decay_config_rejects_operator() {
        let env = Env::default();
        let (cid, client, _admin, operator) = setup(&env);
        m_set_decay(&env, &cid, &operator, 10, 86_400);
        let err = client
            .try_set_decay_config(&operator, &10u32, &86_400u64)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    #[test]
    fn set_score_bounds_rejects_unauthorized_caller() {
        let env = Env::default();
        let (cid, client, _admin, _operator) = setup(&env);
        let stranger = Address::generate(&env);
        m_set_bounds(&env, &cid, &stranger, 0, 1000);
        let err = client
            .try_set_score_bounds(&stranger, &0u32, &1000u32)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    #[test]
    fn pause_rejects_unauthorized_caller() {
        let env = Env::default();
        let (cid, client, _admin, _operator) = setup(&env);
        let stranger = Address::generate(&env);
        m_pause(&env, &cid, &stranger);
        let err = client.try_pause(&stranger).unwrap_err().unwrap();
        assert_eq!(err, PausableError::NotAuthorized);
    }

    #[test]
    fn unpause_rejects_unauthorized_caller() {
        let env = Env::default();
        let (cid, client, admin, _operator) = setup(&env);
        m_pause(&env, &cid, &admin);
        client.try_pause(&admin).unwrap().unwrap();
        let stranger = Address::generate(&env);
        m_unpause(&env, &cid, &stranger);
        let err = client.try_unpause(&stranger).unwrap_err().unwrap();
        assert_eq!(err, PausableError::NotAuthorized);
    }

    /// With no auth mocked at all, `require_auth()` inside `update_reputation`
    /// must reject the call — proving the check is real, not a logic-level
    /// address compare. (Mirrors soroban_access_control's own convention.)
    #[test]
    #[should_panic]
    fn update_reputation_without_any_mocked_auth_fails() {
        let env = Env::default();
        let (_cid, client, _admin, operator) = setup(&env);
        let tenant = Address::generate(&env);
        let rec = sample_record(&env);
        let r = reason(&env);
        client.update_reputation(&operator, &tenant, &rec, &r);
    }

    // ── A3 · initialization edges ─────────────────────────────────────────

    #[test]
    #[should_panic(expected = "admin not set")]
    fn update_reputation_before_init_rejected() {
        let env = Env::default();
        let cid = env.register(TenantReputation, ());
        let client = TenantReputationClient::new(&env, &cid);
        let caller = Address::generate(&env);
        let tenant = Address::generate(&env);
        let rec = sample_record(&env);
        let r = reason(&env);
        client.update_reputation(&caller, &tenant, &rec, &r);
    }

    #[test]
    #[should_panic(expected = "admin not set")]
    fn revoke_reputation_before_init_rejected() {
        let env = Env::default();
        let cid = env.register(TenantReputation, ());
        let client = TenantReputationClient::new(&env, &cid);
        let caller = Address::generate(&env);
        let tenant = Address::generate(&env);
        client.revoke_reputation(&caller, &tenant);
    }

    #[test]
    #[should_panic(expected = "admin not set")]
    fn set_decay_config_before_init_rejected() {
        let env = Env::default();
        let cid = env.register(TenantReputation, ());
        let client = TenantReputationClient::new(&env, &cid);
        let caller = Address::generate(&env);
        client.set_decay_config(&caller, &10u32, &86_400u64);
    }

    /// Read paths are safe before init — they never touch admin/operator.
    #[test]
    fn read_paths_before_init_do_not_panic() {
        let env = Env::default();
        let cid = env.register(TenantReputation, ());
        let client = TenantReputationClient::new(&env, &cid);
        let tenant = Address::generate(&env);
        assert_eq!(client.get_reputation(&tenant), None);
        assert!(!client.has_reputation(&tenant));
    }

    // ── A4 · decay & clamp boundaries ────────────────────────────────────

    /// Elapsed time shorter than one decay period does not decay (`periods
    /// == 0` guard). Distinct from `no_decay_without_elapsed_time`, which
    /// exercises the `now <= last_updated` guard.
    #[test]
    fn decay_does_not_apply_below_one_full_period() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (cid, client, admin, operator) = setup(&env);
        let tenant = Address::generate(&env);
        let r = reason(&env);

        m_set_decay(&env, &cid, &admin, 10, 86_400);
        client
            .try_set_decay_config(&admin, &10u32, &86_400u64)
            .unwrap()
            .unwrap();

        let rec = sample_record(&env);
        m_update(&env, &cid, &operator, &tenant, &rec, &r);
        client
            .try_update_reputation(&operator, &tenant, &rec, &r)
            .unwrap()
            .unwrap();

        env.ledger().set_timestamp(1_000 + 43_200); // +12h, < 1 day
        assert_eq!(client.get_reputation(&tenant).unwrap().composite_score, 750);
    }

    /// Partial periods are floored, not rounded: 2.5 elapsed periods -> 2.
    #[test]
    fn decay_floors_partial_periods() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (cid, client, admin, operator) = setup(&env);
        let tenant = Address::generate(&env);
        let r = reason(&env);

        m_set_decay(&env, &cid, &admin, 10, 86_400);
        client
            .try_set_decay_config(&admin, &10u32, &86_400u64)
            .unwrap()
            .unwrap();

        let rec = sample_record(&env); // composite 750
        m_update(&env, &cid, &operator, &tenant, &rec, &r);
        client
            .try_update_reputation(&operator, &tenant, &rec, &r)
            .unwrap()
            .unwrap();

        env.ledger().set_timestamp(1_000 + 2 * 86_400 + 43_200); // 2.5 periods
                                                                 // floor(2.5) = 2 periods * 10 = 20  ->  750 - 20 = 730 (NOT 725)
        assert_eq!(client.get_reputation(&tenant).unwrap().composite_score, 730);
    }

    /// A `last_updated` in the future (clock skew) must not underflow or decay.
    #[test]
    fn decay_not_applied_when_now_is_before_last_updated() {
        let env = Env::default();
        env.ledger().set_timestamp(10_000);
        let (cid, client, admin, operator) = setup(&env);
        let tenant = Address::generate(&env);
        let r = reason(&env);

        m_set_decay(&env, &cid, &admin, 10, 86_400);
        client
            .try_set_decay_config(&admin, &10u32, &86_400u64)
            .unwrap()
            .unwrap();

        let rec = sample_record(&env);
        m_update(&env, &cid, &operator, &tenant, &rec, &r); // last_updated := 10_000
        client
            .try_update_reputation(&operator, &tenant, &rec, &r)
            .unwrap()
            .unwrap();

        env.ledger().set_timestamp(5_000); // now < last_updated
        assert_eq!(client.get_reputation(&tenant).unwrap().composite_score, 750);
    }

    /// Decay is computed on READ and never persisted: reading at a later time
    /// returns the decayed score, but the stored record is untouched, so
    /// reading again at the original time returns the original score.
    #[test]
    fn decay_is_read_only_and_never_persisted() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (cid, client, admin, operator) = setup(&env);
        let tenant = Address::generate(&env);
        let r = reason(&env);

        m_set_decay(&env, &cid, &admin, 10, 86_400);
        client
            .try_set_decay_config(&admin, &10u32, &86_400u64)
            .unwrap()
            .unwrap();

        let rec = sample_record(&env); // composite 750
        m_update(&env, &cid, &operator, &tenant, &rec, &r);
        client
            .try_update_reputation(&operator, &tenant, &rec, &r)
            .unwrap()
            .unwrap();

        env.ledger().set_timestamp(1_000 + 10 * 86_400);
        assert_eq!(
            client.get_reputation(&tenant).unwrap().composite_score,
            650 // 750 - 100
        );

        env.ledger().set_timestamp(1_000); // back to the write time
        assert_eq!(
            client.get_reputation(&tenant).unwrap().composite_score,
            750,
            "stored record must be unchanged by a decayed read"
        );
    }

    /// `update_reputation` does NOT apply decay before writing and resets
    /// `last_updated` to now — re-submitting the same score refreshes the
    /// decay clock (recon flag #6, pinned pending a maintainer decision).
    #[test]
    fn update_does_not_apply_decay_and_resets_the_clock() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (cid, client, admin, operator) = setup(&env);
        let tenant = Address::generate(&env);
        let r = reason(&env);

        m_set_decay(&env, &cid, &admin, 10, 86_400);
        client
            .try_set_decay_config(&admin, &10u32, &86_400u64)
            .unwrap()
            .unwrap();

        let rec = sample_record(&env); // composite 750
        m_update(&env, &cid, &operator, &tenant, &rec, &r);
        client
            .try_update_reputation(&operator, &tenant, &rec, &r)
            .unwrap()
            .unwrap();

        env.ledger().set_timestamp(1_000 + 5 * 86_400); // 5 periods elapsed

        // Operator re-submits the SAME composite score.
        let again = sample_record(&env);
        m_update(&env, &cid, &operator, &tenant, &again, &r);
        client
            .try_update_reputation(&operator, &tenant, &again, &r)
            .unwrap()
            .unwrap();

        // Stored value is the submitted 750 (clamped), not 750 - 50; and since
        // last_updated was reset to now, an immediate read shows no decay.
        assert_eq!(client.get_reputation(&tenant).unwrap().composite_score, 750);
    }

    /// Clamp on write applies ONLY to `composite_score`; the sub-scores are
    /// stored verbatim, even outside the configured bounds.
    #[test]
    fn sub_scores_are_not_clamped() {
        let env = Env::default();
        env.ledger().set_timestamp(1);
        let (cid, client, admin, operator) = setup(&env);
        let tenant = Address::generate(&env);
        let r = reason(&env);

        m_set_bounds(&env, &cid, &admin, 0, 1000);
        client
            .try_set_score_bounds(&admin, &0u32, &1000u32)
            .unwrap()
            .unwrap();

        let rec = ReputationRecord {
            composite_score: 500,
            payment_score: 9_999,
            property_care_score: 8_888,
            communication_score: 7_777,
            total_ratings: 42,
            last_updated: 0,
        };
        m_update(&env, &cid, &operator, &tenant, &rec, &r);
        client
            .try_update_reputation(&operator, &tenant, &rec, &r)
            .unwrap()
            .unwrap();

        let stored = client.get_reputation(&tenant).unwrap();
        assert_eq!(stored.composite_score, 500);
        assert_eq!(stored.payment_score, 9_999);
        assert_eq!(stored.property_care_score, 8_888);
        assert_eq!(stored.communication_score, 7_777);
    }

    /// FINDING (recon flag #3, promoted): `set_score_bounds` does not enforce
    /// `min <= max`. With min > max the clamp `s.max(lo).min(hi)` collapses
    /// EVERY score to `max`, silently.
    #[test]
    fn score_bounds_with_min_greater_than_max_collapse_every_score_to_max() {
        let env = Env::default();
        env.ledger().set_timestamp(1);
        let (cid, client, admin, operator) = setup(&env);
        let r = reason(&env);

        m_set_bounds(&env, &cid, &admin, 800, 200); // min > max, accepted
        client
            .try_set_score_bounds(&admin, &800u32, &200u32)
            .unwrap()
            .unwrap();

        for input in [50u32, 500u32, 5_000u32] {
            let tenant = Address::generate(&env);
            let mut rec = sample_record(&env);
            rec.composite_score = input;
            m_update(&env, &cid, &operator, &tenant, &rec, &r);
            client
                .try_update_reputation(&operator, &tenant, &rec, &r)
                .unwrap()
                .unwrap();
            assert_eq!(
                client.get_reputation(&tenant).unwrap().composite_score,
                200,
                "min > max makes the clamp collapse every score to max"
            );
        }
    }

    /// `period_secs == 0` disables decay (guarded), regardless of elapsed time.
    #[test]
    fn decay_period_of_zero_disables_decay() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (cid, client, admin, operator) = setup(&env);
        let tenant = Address::generate(&env);
        let r = reason(&env);

        m_set_decay(&env, &cid, &admin, 50, 0);
        client
            .try_set_decay_config(&admin, &50u32, &0u64)
            .unwrap()
            .unwrap();

        let rec = sample_record(&env);
        m_update(&env, &cid, &operator, &tenant, &rec, &r);
        client
            .try_update_reputation(&operator, &tenant, &rec, &r)
            .unwrap()
            .unwrap();

        env.ledger().set_timestamp(1_000 + 100 * 86_400);
        assert_eq!(client.get_reputation(&tenant).unwrap().composite_score, 750);
    }

    /// A huge elapsed time saturates rather than panicking: `saturating_mul`
    /// caps the decay amount and `saturating_sub` floors the score at
    /// `score_min`.
    #[test]
    fn decay_saturates_and_does_not_panic_on_huge_elapsed() {
        let env = Env::default();
        env.ledger().set_timestamp(0);
        let (cid, client, admin, operator) = setup(&env);
        let tenant = Address::generate(&env);
        let r = reason(&env);

        m_set_decay(&env, &cid, &admin, 1_000, 1); // 1000 points per second
        client
            .try_set_decay_config(&admin, &1_000u32, &1u64)
            .unwrap()
            .unwrap();

        let rec = sample_record(&env); // composite 750
        m_update(&env, &cid, &operator, &tenant, &rec, &r);
        client
            .try_update_reputation(&operator, &tenant, &rec, &r)
            .unwrap()
            .unwrap();

        env.ledger().set_timestamp(10_000_000); // decay_amount overflows u32 -> saturates
        assert_eq!(client.get_reputation(&tenant).unwrap().composite_score, 0);
    }

    // ── A5 · events ─────────────────────────────────────────────────────

    #[test]
    fn update_reputation_emits_reputation_updated_event() {
        let env = Env::default();
        env.ledger().set_timestamp(777);
        let (cid, client, _admin, operator) = setup(&env);
        let tenant = Address::generate(&env);
        let rec = sample_record(&env);
        let r = reason(&env);

        m_update(&env, &cid, &operator, &tenant, &rec, &r);
        client
            .try_update_reputation(&operator, &tenant, &rec, &r)
            .unwrap()
            .unwrap();

        let topics = last_topics(&env);
        let cat: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        let action: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        let ev_tenant: Address = topics.get(2).unwrap().try_into_val(&env).unwrap();
        assert_eq!(cat, Symbol::new(&env, "tenant_reputation"));
        assert_eq!(action, Symbol::new(&env, "reputation_updated"));
        assert_eq!(ev_tenant, tenant);

        let data = last_data(&env);
        let composite: u32 = data.get(0).unwrap().try_into_val(&env).unwrap();
        let total_ratings: u32 = data.get(1).unwrap().try_into_val(&env).unwrap();
        let last_updated: u64 = data.get(2).unwrap().try_into_val(&env).unwrap();
        let ev_reason: Symbol = data.get(3).unwrap().try_into_val(&env).unwrap();
        assert_eq!(composite, 750);
        assert_eq!(total_ratings, 5);
        assert_eq!(last_updated, 777);
        assert_eq!(ev_reason, r);
    }

    /// The decayed-read path emits a `reputation_decayed` event — an event
    /// produced by what is otherwise a query.
    #[test]
    fn get_reputation_emits_reputation_decayed_event_on_decay() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (cid, client, admin, operator) = setup(&env);
        let tenant = Address::generate(&env);
        let r = reason(&env);

        m_set_decay(&env, &cid, &admin, 10, 86_400);
        client
            .try_set_decay_config(&admin, &10u32, &86_400u64)
            .unwrap()
            .unwrap();
        let rec = sample_record(&env);
        m_update(&env, &cid, &operator, &tenant, &rec, &r);
        client
            .try_update_reputation(&operator, &tenant, &rec, &r)
            .unwrap()
            .unwrap();

        env.ledger().set_timestamp(1_000 + 3 * 86_400);
        let got = client.get_reputation(&tenant).unwrap();
        assert_eq!(got.composite_score, 720);

        let topics = last_topics(&env);
        let action: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        let ev_tenant: Address = topics.get(2).unwrap().try_into_val(&env).unwrap();
        assert_eq!(action, Symbol::new(&env, "reputation_decayed"));
        assert_eq!(ev_tenant, tenant);
        let data = last_data(&env);
        let old_score: u32 = data.get(0).unwrap().try_into_val(&env).unwrap();
        let new_score: u32 = data.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(old_score, 750);
        assert_eq!(new_score, 720);
    }

    #[test]
    fn revoke_reputation_emits_revoked_event() {
        let env = Env::default();
        let (cid, client, admin, operator) = setup(&env);
        let tenant = Address::generate(&env);
        let rec = sample_record(&env);
        let r = reason(&env);

        m_update(&env, &cid, &operator, &tenant, &rec, &r);
        client
            .try_update_reputation(&operator, &tenant, &rec, &r)
            .unwrap()
            .unwrap();
        m_revoke(&env, &cid, &admin, &tenant);
        client
            .try_revoke_reputation(&admin, &tenant)
            .unwrap()
            .unwrap();

        let topics = last_topics(&env);
        let cat: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        let action: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        let ev_tenant: Address = topics.get(2).unwrap().try_into_val(&env).unwrap();
        assert_eq!(cat, Symbol::new(&env, "tenant_reputation"));
        assert_eq!(action, Symbol::new(&env, "revoked"));
        assert_eq!(ev_tenant, tenant);
    }

    /// Revoking an address that was never scored is a silent no-op: it returns
    /// Ok and emits nothing (recon flag #4, pinned pending a maintainer
    /// decision).
    #[test]
    fn revoke_of_nonexistent_record_is_a_silent_noop() {
        let env = Env::default();
        let (cid, client, admin, _operator) = setup(&env);
        let ghost = Address::generate(&env);

        m_revoke(&env, &cid, &admin, &ghost);
        client
            .try_revoke_reputation(&admin, &ghost)
            .unwrap()
            .unwrap();

        assert!(
            env.events().all().is_empty(),
            "no event should be emitted when revoking a nonexistent record"
        );
    }

    #[test]
    fn set_decay_config_emits_event() {
        let env = Env::default();
        let (cid, client, admin, _operator) = setup(&env);
        m_set_decay(&env, &cid, &admin, 25, 3_600);
        client
            .try_set_decay_config(&admin, &25u32, &3_600u64)
            .unwrap()
            .unwrap();

        let topics = last_topics(&env);
        let action: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(action, Symbol::new(&env, "decay_config_updated"));
        let data = last_data(&env);
        let rate: u32 = data.get(0).unwrap().try_into_val(&env).unwrap();
        let period: u64 = data.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(rate, 25);
        assert_eq!(period, 3_600);
    }

    #[test]
    fn set_score_bounds_emits_event() {
        let env = Env::default();
        let (cid, client, admin, _operator) = setup(&env);
        m_set_bounds(&env, &cid, &admin, 100, 900);
        client
            .try_set_score_bounds(&admin, &100u32, &900u32)
            .unwrap()
            .unwrap();

        let topics = last_topics(&env);
        let action: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(action, Symbol::new(&env, "score_bounds_updated"));
        let data = last_data(&env);
        let lo: u32 = data.get(0).unwrap().try_into_val(&env).unwrap();
        let hi: u32 = data.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(lo, 100);
        assert_eq!(hi, 900);
    }

    /// A denied call emits the standard access_control `unauthorized` event
    /// carrying the caller and the operation name.
    #[test]
    fn unauthorized_update_emits_access_control_unauthorized_event() {
        let env = Env::default();
        let (cid, client, _admin, _operator) = setup(&env);
        let tenant = Address::generate(&env);
        let stranger = Address::generate(&env);
        let rec = sample_record(&env);
        let r = reason(&env);

        m_update(&env, &cid, &stranger, &tenant, &rec, &r);
        let err = client
            .try_update_reputation(&stranger, &tenant, &rec, &r)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);

        let ev = env.events().all().last().unwrap();
        let cat: Symbol = ev.1.get(0).unwrap().try_into_val(&env).unwrap();
        let kind: Symbol = ev.1.get(1).unwrap().try_into_val(&env).unwrap();
        let denied: Address = ev.1.get(2).unwrap().try_into_val(&env).unwrap();
        let op: Symbol = ev.2.try_into_val(&env).unwrap();
        assert_eq!(cat, Symbol::new(&env, "access_control"));
        assert_eq!(kind, Symbol::new(&env, "unauthorized"));
        assert_eq!(denied, stranger);
        assert_eq!(op, Symbol::new(&env, "update_reputation"));
    }

    #[test]
    fn pause_emits_event_and_unpause_does_not() {
        let env = Env::default();
        let (cid, client, admin, _operator) = setup(&env);

        m_pause(&env, &cid, &admin);
        client.try_pause(&admin).unwrap().unwrap();
        let topics = last_topics(&env);
        let cat: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        let action: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(cat, Symbol::new(&env, "Pausable"));
        assert_eq!(action, Symbol::new(&env, "pause"));

        m_unpause(&env, &cid, &admin);
        client.try_unpause(&admin).unwrap().unwrap();
        assert!(env.events().all().is_empty(), "unpause emits no event");
    }

    /// Contrast rent_schedule::init (which emits a `rent_schedule/init`
    /// event): tenant_reputation::init is silent.
    #[test]
    fn init_emits_no_event() {
        let env = Env::default();
        let cid = env.register(TenantReputation, ());
        let client = TenantReputationClient::new(&env, &cid);
        let admin = Address::generate(&env);
        let operator = Address::generate(&env);
        client.try_init(&admin, &operator).unwrap().unwrap();
        assert!(env.events().all().is_empty());
    }
}
