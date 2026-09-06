#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, Address, BytesN, Env, String, Symbol, Vec,
};

#[contracttype]
#[derive(Clone)]
pub struct ScheduledInstalment {
    pub instalment_number: u32,
    pub due_timestamp: u64,
    pub amount_due: i128,
    pub amount_paid: i128,
    pub status: InstalmentStatus,
    pub paid_at: Option<u64>,
    pub last_tx_id: Option<BytesN<32>>,
}

#[contracttype]
#[derive(Clone, Copy, PartialEq, Debug)]
#[repr(u32)]
pub enum WaiverReason {
    Hardship = 1,
    DisputeResolved = 2,
    AdminAdjustment = 3,
    Promotional = 4,
}

#[contracttype]
#[derive(Clone)]
pub struct WaiverAudit {
    pub actor: Address,
    pub reason: WaiverReason,
    pub amount_waived: i128,
    pub waived_at: u64,
}

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum InstalmentStatus {
    Pending,
    Paid,
    Overdue,
    Waived,
}

#[contracttype]
pub enum DataKey {
    Config,
    Schedule(String),
    Waiver(String, u32),
    Paused,
}

#[contracttype]
pub struct Config {
    pub admin: Address,
    pub operator: Address,
}

fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<_, bool>(&DataKey::Paused)
        .unwrap_or(false)
}

fn require_not_paused(env: &Env) {
    if is_paused(env) {
        panic!("ContractPaused");
    }
}

fn instalment_remaining(inst: &ScheduledInstalment) -> i128 {
    inst.amount_due - inst.amount_paid
}

fn assert_positive_payment(amount: i128) {
    if amount <= 0 {
        panic!("InvalidAmount");
    }
}

#[contract]
pub struct RentSchedule;

#[contractimpl]
impl RentSchedule {
    pub fn init(env: Env, admin: Address, operator: Address) {
        if env.storage().instance().has(&DataKey::Config) {
            panic!("AlreadyInitialized");
        }
        let cfg = Config {
            admin: admin.clone(),
            operator: operator.clone(),
        };
        env.storage().instance().set(&DataKey::Config, &cfg);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events().publish(
            (
                Symbol::new(&env, "rent_schedule"),
                Symbol::new(&env, "init"),
            ),
            (),
        );
    }

    pub fn pause(env: Env, caller: Address) {
        caller.require_auth();
        let cfg: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .expect("NotInitialized");
        if caller != cfg.admin {
            panic!("NotAuthorized");
        }
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish(
            (
                Symbol::new(&env, "rent_schedule"),
                Symbol::new(&env, "paused"),
            ),
            (),
        );
    }

    pub fn unpause(env: Env, caller: Address) {
        caller.require_auth();
        let cfg: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .expect("NotInitialized");
        if caller != cfg.admin {
            panic!("NotAuthorized");
        }
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events().publish(
            (
                Symbol::new(&env, "rent_schedule"),
                Symbol::new(&env, "unpaused"),
            ),
            (),
        );
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }

    pub fn create_schedule(
        env: Env,
        caller: Address,
        deal_id: String,
        instalments: Vec<ScheduledInstalment>,
    ) {
        let cfg: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .expect("NotInitialized");
        if caller != cfg.admin && caller != cfg.operator {
            panic!("NotAuthorized");
        }
        caller.require_auth();
        if env
            .storage()
            .persistent()
            .has(&DataKey::Schedule(deal_id.clone()))
        {
            panic!("ScheduleExists");
        }
        let total_amount: i128 = instalments.iter().map(|i| i.amount_due).sum();
        let count = instalments.len();
        env.storage()
            .persistent()
            .set(&DataKey::Schedule(deal_id.clone()), &instalments);
        env.events().publish(
            (
                Symbol::new(&env, "rent_schedule"),
                Symbol::new(&env, "schedule_created"),
                deal_id,
            ),
            (count, total_amount),
        );
    }

    pub fn record_payment(
        env: Env,
        caller: Address,
        deal_id: String,
        instalment_number: u32,
        amount: i128,
        tx_id: BytesN<32>,
        paid_at: u64,
    ) {
        require_not_paused(&env);
        let _cfg: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .expect("NotInitialized");
        caller.require_auth();
        assert_positive_payment(amount);

        let mut schedule: Vec<ScheduledInstalment> = env
            .storage()
            .persistent()
            .get(&DataKey::Schedule(deal_id.clone()))
            .expect("NoSchedule");
        let idx = schedule
            .iter()
            .position(|i| i.instalment_number == instalment_number)
            .expect("NotFound");
        let mut inst = schedule.get(idx as u32).unwrap();

        if inst.status == InstalmentStatus::Paid || inst.status == InstalmentStatus::Waived {
            panic!("InvalidStatus");
        }

        let remaining = instalment_remaining(&inst);
        if amount > remaining {
            panic!("Overpayment");
        }

        inst.amount_paid += amount;
        inst.last_tx_id = Option::Some(tx_id.clone());

        if inst.amount_paid == inst.amount_due {
            inst.status = InstalmentStatus::Paid;
            inst.paid_at = Option::Some(paid_at);
            schedule.set(idx as u32, inst.clone());
            env.storage()
                .persistent()
                .set(&DataKey::Schedule(deal_id.clone()), &schedule);
            env.events().publish(
                (
                    Symbol::new(&env, "rent_schedule"),
                    Symbol::new(&env, "instalment_paid"),
                    deal_id.clone(),
                ),
                (instalment_number, inst.amount_due, tx_id),
            );
        } else {
            schedule.set(idx as u32, inst.clone());
            env.storage()
                .persistent()
                .set(&DataKey::Schedule(deal_id.clone()), &schedule);
            env.events().publish(
                (
                    Symbol::new(&env, "rent_schedule"),
                    Symbol::new(&env, "partial_payment_recorded"),
                    deal_id.clone(),
                ),
                (
                    instalment_number,
                    amount,
                    inst.amount_paid,
                    instalment_remaining(&inst),
                    tx_id,
                ),
            );
        }
    }

    pub fn mark_overdue(env: Env, caller: Address, deal_id: String, instalment_number: u32) {
        require_not_paused(&env);
        let cfg: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .expect("NotInitialized");
        if caller != cfg.admin && caller != cfg.operator {
            panic!("NotAuthorized");
        }
        caller.require_auth();
        let mut schedule: Vec<ScheduledInstalment> = env
            .storage()
            .persistent()
            .get(&DataKey::Schedule(deal_id.clone()))
            .expect("NoSchedule");
        let idx = schedule
            .iter()
            .position(|i| i.instalment_number == instalment_number)
            .expect("NotFound");
        let mut inst = schedule.get(idx as u32).unwrap();
        if inst.status == InstalmentStatus::Paid || inst.status == InstalmentStatus::Waived {
            panic!("InvalidStatus");
        }
        if instalment_remaining(&inst) <= 0 {
            panic!("InvalidStatus");
        }
        inst.status = InstalmentStatus::Overdue;
        let remaining = instalment_remaining(&inst);
        schedule.set(idx as u32, inst);
        env.storage()
            .persistent()
            .set(&DataKey::Schedule(deal_id.clone()), &schedule);
        env.events().publish(
            (
                Symbol::new(&env, "rent_schedule"),
                Symbol::new(&env, "instalment_overdue"),
                deal_id,
            ),
            (instalment_number, remaining),
        );
    }

    pub fn waive_instalment(
        env: Env,
        caller: Address,
        deal_id: String,
        instalment_number: u32,
        reason: WaiverReason,
    ) {
        let cfg: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .expect("NotInitialized");
        if caller != cfg.admin {
            panic!("NotAuthorized");
        }
        caller.require_auth();
        let mut schedule: Vec<ScheduledInstalment> = env
            .storage()
            .persistent()
            .get(&DataKey::Schedule(deal_id.clone()))
            .expect("NoSchedule");
        let idx = schedule
            .iter()
            .position(|i| i.instalment_number == instalment_number)
            .expect("NotFound");
        let mut inst = schedule.get(idx as u32).unwrap();
        if inst.status == InstalmentStatus::Waived {
            panic!("AlreadyWaived");
        }
        if inst.status == InstalmentStatus::Paid {
            panic!("InvalidStatus");
        }

        let amount_waived = instalment_remaining(&inst);
        let waived_at = env.ledger().timestamp();
        inst.status = InstalmentStatus::Waived;
        schedule.set(idx as u32, inst);
        env.storage()
            .persistent()
            .set(&DataKey::Schedule(deal_id.clone()), &schedule);

        let audit = WaiverAudit {
            actor: caller.clone(),
            reason,
            amount_waived,
            waived_at,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Waiver(deal_id.clone(), instalment_number), &audit);

        env.events().publish(
            (
                Symbol::new(&env, "rent_schedule"),
                Symbol::new(&env, "instalment_waived"),
                deal_id,
            ),
            (
                instalment_number,
                caller,
                reason as u32,
                amount_waived,
                waived_at,
            ),
        );
    }

    pub fn get_waiver(env: Env, deal_id: String, instalment_number: u32) -> Option<WaiverAudit> {
        env.storage()
            .persistent()
            .get(&DataKey::Waiver(deal_id, instalment_number))
    }

    pub fn instalment_remaining(env: Env, deal_id: String, instalment_number: u32) -> i128 {
        let inst = Self::get_instalment(env.clone(), deal_id, instalment_number);
        instalment_remaining(&inst)
    }

    /// Returns instalments sorted by instalment_number ascending.
    pub fn get_schedule(env: Env, deal_id: String) -> Vec<ScheduledInstalment> {
        let mut schedule: Vec<ScheduledInstalment> = env
            .storage()
            .persistent()
            .get(&DataKey::Schedule(deal_id))
            .unwrap_or(Vec::new(&env));
        let len = schedule.len();
        let mut i = 1u32;
        while i < len {
            let mut j = i;
            while j > 0 {
                let a = schedule.get(j - 1).unwrap();
                let b = schedule.get(j).unwrap();
                if a.instalment_number > b.instalment_number {
                    schedule.set(j - 1, b.clone());
                    schedule.set(j, a);
                    j -= 1;
                } else {
                    break;
                }
            }
            i += 1;
        }
        schedule
    }

    pub fn get_instalment(
        env: Env,
        deal_id: String,
        instalment_number: u32,
    ) -> ScheduledInstalment {
        let schedule: Vec<ScheduledInstalment> = env
            .storage()
            .persistent()
            .get(&DataKey::Schedule(deal_id))
            .expect("NoSchedule");
        schedule
            .iter()
            .find(|i| i.instalment_number == instalment_number)
            .unwrap()
    }
}

#[cfg(test)]
mod test {
    extern crate std;
    use super::*;
    use soroban_sdk::testutils::{Address as _, Events};
    use soroban_sdk::{Address, BytesN, Env, String, TryIntoVal, Vec};

    fn make_deal_id(env: &Env, s: &str) -> String {
        String::from_str(env, s)
    }

    fn make_instalments(env: &Env, count: u32) -> Vec<ScheduledInstalment> {
        let mut v: Vec<ScheduledInstalment> = Vec::new(env);
        for i in 0..count {
            v.push_back(ScheduledInstalment {
                instalment_number: i + 1,
                due_timestamp: (i as u64 + 1) * 30 * 24 * 3600,
                amount_due: 100_000i128 * (i as i128 + 1),
                amount_paid: 0,
                status: InstalmentStatus::Pending,
                paid_at: Option::None,
                last_tx_id: Option::None,
            });
        }
        v
    }

    fn setup(env: &Env) -> (Address, Address, soroban_sdk::Address) {
        let admin = Address::generate(env);
        let operator = Address::generate(env);
        let contract_id = env.register(RentSchedule, ());
        (admin, operator, contract_id)
    }

    #[test]
    fn create_schedule_and_get() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);

        let deal_id = make_deal_id(&env, "deal_001");
        let instalments = make_instalments(&env, 3);
        client.create_schedule(&admin, &deal_id, &instalments);

        let schedule = client.get_schedule(&deal_id);
        assert_eq!(schedule.len(), 3);
    }

    #[test]
    #[should_panic(expected = "ScheduleExists")]
    fn create_schedule_fails_if_duplicate() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);

        let deal_id = make_deal_id(&env, "deal_002");
        let instalments = make_instalments(&env, 2);
        client.create_schedule(&admin, &deal_id, &instalments.clone());
        client.create_schedule(&admin, &deal_id, &instalments);
    }

    #[test]
    fn partial_then_full_payment_transitions_to_paid() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);

        let deal_id = make_deal_id(&env, "deal_partial");
        let instalments = make_instalments(&env, 1);
        client.create_schedule(&admin, &deal_id, &instalments);

        let tx1 = BytesN::from_array(&env, &[1u8; 32]);
        client.record_payment(&admin, &deal_id, &1u32, &40_000i128, &tx1, &1_000u64);
        let partial = client.get_instalment(&deal_id, &1u32);
        assert!(matches!(partial.status, InstalmentStatus::Pending));
        assert_eq!(partial.amount_paid, 40_000i128);
        assert_eq!(client.instalment_remaining(&deal_id, &1u32), 60_000i128);

        let tx2 = BytesN::from_array(&env, &[2u8; 32]);
        client.record_payment(&admin, &deal_id, &1u32, &60_000i128, &tx2, &2_000u64);
        let paid = client.get_instalment(&deal_id, &1u32);
        assert!(matches!(paid.status, InstalmentStatus::Paid));
        assert_eq!(paid.amount_paid, 100_000i128);
        assert_eq!(client.instalment_remaining(&deal_id, &1u32), 0i128);
    }

    #[test]
    #[should_panic(expected = "Overpayment")]
    fn overpayment_beyond_due_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);

        let deal_id = make_deal_id(&env, "deal_overpay");
        let instalments = make_instalments(&env, 1);
        client.create_schedule(&admin, &deal_id, &instalments);

        let tx = BytesN::from_array(&env, &[3u8; 32]);
        client.record_payment(&admin, &deal_id, &1u32, &100_001i128, &tx, &1_000u64);
    }

    #[test]
    fn mark_overdue_reflects_remaining_on_partial_payment() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);

        let deal_id = make_deal_id(&env, "deal_overdue_partial");
        let instalments = make_instalments(&env, 1);
        client.create_schedule(&admin, &deal_id, &instalments);

        let tx = BytesN::from_array(&env, &[4u8; 32]);
        client.record_payment(&admin, &deal_id, &1u32, &25_000i128, &tx, &1_000u64);
        client.mark_overdue(&admin, &deal_id, &1u32);

        let inst = client.get_instalment(&deal_id, &1u32);
        assert!(matches!(inst.status, InstalmentStatus::Overdue));
        assert_eq!(client.instalment_remaining(&deal_id, &1u32), 75_000i128);
    }

    #[test]
    #[should_panic(expected = "InvalidStatus")]
    fn mark_overdue_on_paid_instalment_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);

        let deal_id = make_deal_id(&env, "deal_004");
        let instalments = make_instalments(&env, 1);
        client.create_schedule(&admin, &deal_id, &instalments);

        let tx_id = BytesN::from_array(&env, &[2u8; 32]);
        client.record_payment(&admin, &deal_id, &1u32, &100_000i128, &tx_id, &1_000_000u64);
        client.mark_overdue(&admin, &deal_id, &1u32);
    }

    #[test]
    fn get_schedule_returns_sorted_order() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);

        let deal_id = make_deal_id(&env, "deal_006");
        let mut v: Vec<ScheduledInstalment> = Vec::new(&env);
        v.push_back(ScheduledInstalment {
            instalment_number: 3,
            due_timestamp: 90,
            amount_due: 300,
            amount_paid: 0,
            status: InstalmentStatus::Pending,
            paid_at: Option::None,
            last_tx_id: Option::None,
        });
        v.push_back(ScheduledInstalment {
            instalment_number: 1,
            due_timestamp: 30,
            amount_due: 100,
            amount_paid: 0,
            status: InstalmentStatus::Pending,
            paid_at: Option::None,
            last_tx_id: Option::None,
        });
        v.push_back(ScheduledInstalment {
            instalment_number: 2,
            due_timestamp: 60,
            amount_due: 200,
            amount_paid: 0,
            status: InstalmentStatus::Pending,
            paid_at: Option::None,
            last_tx_id: Option::None,
        });
        client.create_schedule(&admin, &deal_id, &v);

        let schedule = client.get_schedule(&deal_id);
        assert_eq!(schedule.get(0).unwrap().instalment_number, 1);
        assert_eq!(schedule.get(1).unwrap().instalment_number, 2);
        assert_eq!(schedule.get(2).unwrap().instalment_number, 3);
    }

    #[test]
    fn waiver_persists_audit_fields() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);

        let deal_id = make_deal_id(&env, "deal_waiver");
        let instalments = make_instalments(&env, 1);
        client.create_schedule(&admin, &deal_id, &instalments);
        client.waive_instalment(&admin, &deal_id, &1u32, &WaiverReason::Hardship);

        let audit = client.get_waiver(&deal_id, &1u32).unwrap();
        assert_eq!(audit.actor, admin);
        assert_eq!(audit.reason, WaiverReason::Hardship);
        assert_eq!(audit.amount_waived, 100_000i128);
        assert_eq!(audit.waived_at, env.ledger().timestamp());
    }

    #[test]
    #[should_panic(expected = "InvalidStatus")]
    fn record_payment_on_waived_instalment_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);

        let deal_id = make_deal_id(&env, "deal_008");
        let instalments = make_instalments(&env, 1);
        client.create_schedule(&admin, &deal_id, &instalments);
        client.waive_instalment(&admin, &deal_id, &1u32, &WaiverReason::AdminAdjustment);

        let tx_id = BytesN::from_array(&env, &[3u8; 32]);
        client.record_payment(&admin, &deal_id, &1u32, &1_000i128, &tx_id, &1_000_000u64);
    }

    #[test]
    #[should_panic(expected = "InvalidStatus")]
    fn double_pay_on_paid_instalment_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);

        let deal_id = make_deal_id(&env, "deal_double_pay");
        let instalments = make_instalments(&env, 1);
        client.create_schedule(&admin, &deal_id, &instalments);

        let tx1 = BytesN::from_array(&env, &[5u8; 32]);
        client.record_payment(&admin, &deal_id, &1u32, &100_000i128, &tx1, &1_000u64);
        let tx2 = BytesN::from_array(&env, &[6u8; 32]);
        client.record_payment(&admin, &deal_id, &1u32, &1i128, &tx2, &2_000u64);
    }

    #[test]
    #[should_panic(expected = "ContractPaused")]
    fn paused_blocks_record_payment() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);

        let deal_id = make_deal_id(&env, "deal_009");
        let instalments = make_instalments(&env, 1);
        client.create_schedule(&admin, &deal_id, &instalments);
        client.pause(&admin);

        let tx_id = BytesN::from_array(&env, &[4u8; 32]);
        client.record_payment(&admin, &deal_id, &1u32, &1_000i128, &tx_id, &1_000_000u64);
    }

    #[test]
    #[should_panic(expected = "ContractPaused")]
    fn paused_blocks_mark_overdue() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);

        let deal_id = make_deal_id(&env, "deal_010");
        let instalments = make_instalments(&env, 1);
        client.create_schedule(&admin, &deal_id, &instalments);
        client.pause(&admin);
        client.mark_overdue(&admin, &deal_id, &1u32);
    }

    #[test]
    fn unpause_restores_operations() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);

        let deal_id = make_deal_id(&env, "deal_011");
        let instalments = make_instalments(&env, 1);
        client.create_schedule(&admin, &deal_id, &instalments);
        client.pause(&admin);
        client.unpause(&admin);

        let tx_id = BytesN::from_array(&env, &[5u8; 32]);
        client.record_payment(&admin, &deal_id, &1u32, &100_000i128, &tx_id, &1_000_000u64);
        let inst = client.get_instalment(&deal_id, &1u32);
        assert!(matches!(inst.status, InstalmentStatus::Paid));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Issue #1422 — added coverage for rent_schedule.
    //
    // Step taxonomy referenced in comments:
    //   A1 core invariant / anchor      A2 authorization
    //   A3 initialization edges         A4 state-machine / boundary
    //   A5 events
    // ─────────────────────────────────────────────────────────────────────────

    fn equal_term(env: &Env, count: u32, per_period: i128) -> Vec<ScheduledInstalment> {
        let mut v: Vec<ScheduledInstalment> = Vec::new(env);
        for i in 0..count {
            v.push_back(ScheduledInstalment {
                instalment_number: i + 1,
                due_timestamp: (i as u64 + 1) * 30 * 24 * 3600,
                amount_due: per_period,
                amount_paid: 0,
                status: InstalmentStatus::Pending,
                paid_at: Option::None,
                last_tx_id: Option::None,
            });
        }
        v
    }

    fn last_event_topics(env: &Env) -> Vec<soroban_sdk::Val> {
        env.events().all().last().unwrap().1
    }

    fn last_event_data(env: &Env) -> Vec<soroban_sdk::Val> {
        env.events()
            .all()
            .last()
            .unwrap()
            .2
            .try_into_val(env)
            .unwrap()
    }

    // ── A1 · ANCHOR (A) — full-term aggregation & tracking integrity ─────────
    //
    // rent_schedule performs NO amortization: every `amount_due` is supplied
    // by the caller (recon 3b). A per-cycle rounding error therefore cannot
    // originate in this contract — the split is computed off-chain before
    // `create_schedule` is ever called. What these two anchors pin instead is
    // that, over a FULL term, the contract:
    //   * aggregates exactly — `schedule_created.total_amount` equals an
    //     independently-computed sum, and
    //   * tracks exactly — after paying every period, Σ(amount_paid) equals
    //     the total obligation with no dust stranded and no drift,
    // for both an evenly-divisible term and a deliberately non-divisible one.

    /// A1 — divisible term: 24 identical periods, paid in full across the term.
    #[test]
    fn full_term_divisible_no_drift() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);

        let deal_id = make_deal_id(&env, "deal_full_term_div");
        let periods: u32 = 24;
        let per_period: i128 = 50_000;
        let expected_total: i128 = per_period * periods as i128; // 1_200_000, computed here

        client.create_schedule(&admin, &deal_id, &equal_term(&env, periods, per_period));

        // The contract's only aggregation point.
        let data = last_event_data(&env);
        let ev_count: u32 = data.get(0).unwrap().try_into_val(&env).unwrap();
        let ev_total: i128 = data.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(ev_count, periods);
        assert_eq!(ev_total, expected_total);

        // Pay the whole term, one period at a time.
        let mut paid_sum: i128 = 0;
        for i in 0..periods {
            let n = i + 1;
            let tx = BytesN::from_array(&env, &[(i % 250) as u8 + 1; 32]);
            client.record_payment(
                &admin,
                &deal_id,
                &n,
                &per_period,
                &tx,
                &((i as u64 + 1) * 1_000),
            );
            let inst = client.get_instalment(&deal_id, &n);
            assert!(matches!(inst.status, InstalmentStatus::Paid));
            assert_eq!(client.instalment_remaining(&deal_id, &n), 0);
            paid_sum += inst.amount_paid;
        }
        assert_eq!(
            paid_sum, expected_total,
            "Sum of payments must equal the obligation exactly after a full term"
        );

        // Divisible case: every period identical.
        let schedule = client.get_schedule(&deal_id);
        for i in 0..periods {
            assert_eq!(schedule.get(i).unwrap().amount_due, per_period);
        }
    }

    /// A1 — non-divisible term: 1_000_000 over 36 periods (27_777 each, rem 28).
    /// The caller places the remainder in the final period; the contract must
    /// preserve that uneven split verbatim and still aggregate/track exactly.
    #[test]
    fn full_term_nondivisible_sums_exactly() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);

        let deal_id = make_deal_id(&env, "deal_full_term_nondiv");
        let periods: u32 = 36;
        let total_obligation: i128 = 1_000_000;
        let base: i128 = total_obligation / periods as i128; // 27_777, computed here — not by the contract
        let remainder: i128 = total_obligation % periods as i128; // 28
        let last_amount: i128 = base + remainder; // 27_805
        assert_eq!(base * (periods as i128 - 1) + last_amount, total_obligation);

        let mut v: Vec<ScheduledInstalment> = Vec::new(&env);
        for i in 0..periods {
            let amount_due = if i == periods - 1 { last_amount } else { base };
            v.push_back(ScheduledInstalment {
                instalment_number: i + 1,
                due_timestamp: (i as u64 + 1) * 30 * 24 * 3600,
                amount_due,
                amount_paid: 0,
                status: InstalmentStatus::Pending,
                paid_at: Option::None,
                last_tx_id: Option::None,
            });
        }
        client.create_schedule(&admin, &deal_id, &v);

        let data = last_event_data(&env);
        let ev_total: i128 = data.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(
            ev_total, total_obligation,
            "schedule_created.total_amount must be the exact obligation"
        );

        let mut paid_sum: i128 = 0;
        for i in 0..periods {
            let n = i + 1;
            let amount = if i == periods - 1 { last_amount } else { base };
            let tx = BytesN::from_array(&env, &[(i % 250) as u8 + 1; 32]);
            client.record_payment(
                &admin,
                &deal_id,
                &n,
                &amount,
                &tx,
                &((i as u64 + 1) * 1_000),
            );
            assert!(matches!(
                client.get_instalment(&deal_id, &n).status,
                InstalmentStatus::Paid
            ));
            assert_eq!(client.instalment_remaining(&deal_id, &n), 0);
            paid_sum += amount;
        }
        assert_eq!(
            paid_sum, total_obligation,
            "Sum of payments over the full term must equal the obligation exactly — no dust, no drift"
        );

        // The uneven remainder survived intact in the final period.
        let schedule = client.get_schedule(&deal_id);
        assert_eq!(schedule.get(periods - 1).unwrap().amount_due, last_amount);
        for i in 0..(periods - 1) {
            assert_eq!(schedule.get(i).unwrap().amount_due, base);
        }
    }

    // ── A2 · authorization ─────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "NotAuthorized")]
    fn create_schedule_rejects_unauthorized_caller() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        let stranger = Address::generate(&env);
        client.create_schedule(
            &stranger,
            &make_deal_id(&env, "d"),
            &make_instalments(&env, 1),
        );
    }

    #[test]
    fn create_schedule_allows_operator() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        let deal_id = make_deal_id(&env, "d_op");
        client.create_schedule(&operator, &deal_id, &make_instalments(&env, 2));
        assert_eq!(client.get_schedule(&deal_id).len(), 2);
    }

    #[test]
    #[should_panic(expected = "NotAuthorized")]
    fn mark_overdue_rejects_unauthorized_caller() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        let deal_id = make_deal_id(&env, "d");
        client.create_schedule(&admin, &deal_id, &make_instalments(&env, 1));
        client.mark_overdue(&Address::generate(&env), &deal_id, &1u32);
    }

    #[test]
    #[should_panic(expected = "NotAuthorized")]
    fn waive_rejects_unauthorized_caller() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        let deal_id = make_deal_id(&env, "d");
        client.create_schedule(&admin, &deal_id, &make_instalments(&env, 1));
        client.waive_instalment(
            &Address::generate(&env),
            &deal_id,
            &1u32,
            &WaiverReason::Hardship,
        );
    }

    /// `waive_instalment` is admin-only — the operator (accepted by
    /// `create_schedule` / `mark_overdue`) must NOT be able to waive.
    #[test]
    #[should_panic(expected = "NotAuthorized")]
    fn waive_rejects_operator() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        let deal_id = make_deal_id(&env, "d");
        client.create_schedule(&admin, &deal_id, &make_instalments(&env, 1));
        client.waive_instalment(&operator, &deal_id, &1u32, &WaiverReason::Hardship);
    }

    #[test]
    #[should_panic(expected = "NotAuthorized")]
    fn pause_rejects_unauthorized_caller() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        client.pause(&Address::generate(&env));
    }

    #[test]
    #[should_panic(expected = "NotAuthorized")]
    fn unpause_rejects_unauthorized_caller() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        client.pause(&admin);
        client.unpause(&Address::generate(&env));
    }

    /// PINS CURRENT BEHAVIOR pending a maintainer decision (recon flag #3):
    /// `record_payment` performs NO role or deal-relationship check — any
    /// address that can authorize the call may pay any instalment of any
    /// deal. This is either intentional tenant-self-pay or a missing guard;
    /// either way it must be visible in the suite. NOT an endorsement.
    #[test]
    fn record_payment_has_no_caller_restriction() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        let deal_id = make_deal_id(&env, "d_perm");
        client.create_schedule(&admin, &deal_id, &make_instalments(&env, 1));

        let unrelated = Address::generate(&env);
        let tx = BytesN::from_array(&env, &[9u8; 32]);
        client.record_payment(&unrelated, &deal_id, &1u32, &40_000i128, &tx, &1_000u64);

        assert_eq!(
            client.get_instalment(&deal_id, &1u32).amount_paid,
            40_000i128
        );
    }

    // ── A3 · initialization edges ──────────────────────────────────────────

    #[test]
    #[should_panic(expected = "AlreadyInitialized")]
    fn double_init_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        client.init(&admin, &operator);
    }

    #[test]
    #[should_panic(expected = "NotInitialized")]
    fn create_schedule_before_init_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, _operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.create_schedule(&admin, &make_deal_id(&env, "d"), &make_instalments(&env, 1));
    }

    #[test]
    #[should_panic(expected = "NotInitialized")]
    fn record_payment_before_init_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, _operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        let tx = BytesN::from_array(&env, &[1u8; 32]);
        client.record_payment(&admin, &make_deal_id(&env, "d"), &1u32, &1i128, &tx, &1u64);
    }

    #[test]
    #[should_panic(expected = "NotInitialized")]
    fn mark_overdue_before_init_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, _operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.mark_overdue(&admin, &make_deal_id(&env, "d"), &1u32);
    }

    #[test]
    #[should_panic(expected = "NotInitialized")]
    fn waive_before_init_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, _operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.waive_instalment(
            &admin,
            &make_deal_id(&env, "d"),
            &1u32,
            &WaiverReason::Hardship,
        );
    }

    #[test]
    #[should_panic(expected = "NotInitialized")]
    fn pause_before_init_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, _operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.pause(&admin);
    }

    #[test]
    fn is_paused_before_init_returns_false_without_panicking() {
        let env = Env::default();
        let (_admin, _operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        assert!(!client.is_paused());
    }

    // ── A4 · state-machine & boundary ─────────────────────────────────────

    #[test]
    #[should_panic(expected = "InvalidStatus")]
    fn waive_paid_instalment_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        let deal_id = make_deal_id(&env, "d");
        client.create_schedule(&admin, &deal_id, &make_instalments(&env, 1));
        let tx = BytesN::from_array(&env, &[1u8; 32]);
        client.record_payment(&admin, &deal_id, &1u32, &100_000i128, &tx, &1u64);
        client.waive_instalment(&admin, &deal_id, &1u32, &WaiverReason::AdminAdjustment);
    }

    #[test]
    #[should_panic(expected = "AlreadyWaived")]
    fn waive_already_waived_instalment_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        let deal_id = make_deal_id(&env, "d");
        client.create_schedule(&admin, &deal_id, &make_instalments(&env, 1));
        client.waive_instalment(&admin, &deal_id, &1u32, &WaiverReason::Hardship);
        client.waive_instalment(&admin, &deal_id, &1u32, &WaiverReason::Hardship);
    }

    #[test]
    #[should_panic(expected = "InvalidStatus")]
    fn mark_overdue_on_waived_instalment_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        let deal_id = make_deal_id(&env, "d");
        client.create_schedule(&admin, &deal_id, &make_instalments(&env, 1));
        client.waive_instalment(&admin, &deal_id, &1u32, &WaiverReason::Hardship);
        client.mark_overdue(&admin, &deal_id, &1u32);
    }

    /// A partially-paid instalment waives only the OUTSTANDING remainder.
    #[test]
    fn partial_payment_then_waive_waives_only_remainder() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        let deal_id = make_deal_id(&env, "d");
        client.create_schedule(&admin, &deal_id, &make_instalments(&env, 1));
        let tx = BytesN::from_array(&env, &[1u8; 32]);
        client.record_payment(&admin, &deal_id, &1u32, &30_000i128, &tx, &1u64);
        client.waive_instalment(&admin, &deal_id, &1u32, &WaiverReason::DisputeResolved);

        let inst = client.get_instalment(&deal_id, &1u32);
        assert!(matches!(inst.status, InstalmentStatus::Waived));
        let audit = client.get_waiver(&deal_id, &1u32).unwrap();
        assert_eq!(audit.amount_waived, 70_000i128);
        assert_eq!(audit.reason, WaiverReason::DisputeResolved);
    }

    /// Overdue -> Paid is a legal transition when the full remainder is paid.
    #[test]
    fn overdue_instalment_then_full_payment_becomes_paid() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        let deal_id = make_deal_id(&env, "d");
        client.create_schedule(&admin, &deal_id, &make_instalments(&env, 1));
        client.mark_overdue(&admin, &deal_id, &1u32);
        let tx = BytesN::from_array(&env, &[1u8; 32]);
        client.record_payment(&admin, &deal_id, &1u32, &100_000i128, &tx, &1u64);
        assert!(matches!(
            client.get_instalment(&deal_id, &1u32).status,
            InstalmentStatus::Paid
        ));
    }

    /// A PARTIAL payment on an Overdue instalment leaves it Overdue —
    /// `record_payment`'s partial branch never touches `status`.
    #[test]
    fn partial_payment_on_overdue_keeps_it_overdue() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        let deal_id = make_deal_id(&env, "d");
        client.create_schedule(&admin, &deal_id, &make_instalments(&env, 1));
        client.mark_overdue(&admin, &deal_id, &1u32);
        let tx = BytesN::from_array(&env, &[1u8; 32]);
        client.record_payment(&admin, &deal_id, &1u32, &30_000i128, &tx, &1u64);
        let inst = client.get_instalment(&deal_id, &1u32);
        assert!(matches!(inst.status, InstalmentStatus::Overdue));
        assert_eq!(inst.amount_paid, 30_000i128);
    }

    /// Re-marking an already-Overdue instalment is permitted (idempotent).
    #[test]
    fn mark_overdue_is_idempotent() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        let deal_id = make_deal_id(&env, "d");
        client.create_schedule(&admin, &deal_id, &make_instalments(&env, 1));
        client.mark_overdue(&admin, &deal_id, &1u32);
        client.mark_overdue(&admin, &deal_id, &1u32);
        assert!(matches!(
            client.get_instalment(&deal_id, &1u32).status,
            InstalmentStatus::Overdue
        ));
    }

    #[test]
    #[should_panic(expected = "InvalidAmount")]
    fn record_payment_zero_amount_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        let deal_id = make_deal_id(&env, "d");
        client.create_schedule(&admin, &deal_id, &make_instalments(&env, 1));
        let tx = BytesN::from_array(&env, &[1u8; 32]);
        client.record_payment(&admin, &deal_id, &1u32, &0i128, &tx, &1u64);
    }

    #[test]
    #[should_panic(expected = "InvalidAmount")]
    fn record_payment_negative_amount_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        let deal_id = make_deal_id(&env, "d");
        client.create_schedule(&admin, &deal_id, &make_instalments(&env, 1));
        let tx = BytesN::from_array(&env, &[1u8; 32]);
        client.record_payment(&admin, &deal_id, &1u32, &-1i128, &tx, &1u64);
    }

    #[test]
    #[should_panic(expected = "NotFound")]
    fn record_payment_absent_instalment_number_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        let deal_id = make_deal_id(&env, "d");
        client.create_schedule(&admin, &deal_id, &make_instalments(&env, 1));
        let tx = BytesN::from_array(&env, &[1u8; 32]);
        client.record_payment(&admin, &deal_id, &99u32, &1i128, &tx, &1u64);
    }

    #[test]
    #[should_panic(expected = "NoSchedule")]
    fn record_payment_absent_schedule_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        let tx = BytesN::from_array(&env, &[1u8; 32]);
        client.record_payment(
            &admin,
            &make_deal_id(&env, "ghost"),
            &1u32,
            &1i128,
            &tx,
            &1u64,
        );
    }

    /// An empty schedule can be created (no input validation) but is unusable.
    #[test]
    fn empty_schedule_can_be_created_and_reports_zero_totals() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        let deal_id = make_deal_id(&env, "d_empty");
        let empty: Vec<ScheduledInstalment> = Vec::new(&env);
        client.create_schedule(&admin, &deal_id, &empty);

        // Capture the event before any other invocation (the test env exposes
        // only the most recent invocation's events).
        let data = last_event_data(&env);
        let ev_count: u32 = data.get(0).unwrap().try_into_val(&env).unwrap();
        let ev_total: i128 = data.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(ev_count, 0);
        assert_eq!(ev_total, 0);

        assert_eq!(client.get_schedule(&deal_id).len(), 0);
    }

    #[test]
    #[should_panic(expected = "NotFound")]
    fn record_payment_on_empty_schedule_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        let deal_id = make_deal_id(&env, "d_empty");
        client.create_schedule(&admin, &deal_id, &Vec::new(&env));
        let tx = BytesN::from_array(&env, &[1u8; 32]);
        client.record_payment(&admin, &deal_id, &1u32, &1i128, &tx, &1u64);
    }

    #[test]
    fn single_period_schedule_full_lifecycle() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        let deal_id = make_deal_id(&env, "d_single");
        client.create_schedule(&admin, &deal_id, &equal_term(&env, 1, 100_000));
        let tx = BytesN::from_array(&env, &[1u8; 32]);
        client.record_payment(&admin, &deal_id, &1u32, &100_000i128, &tx, &1u64);
        let inst = client.get_instalment(&deal_id, &1u32);
        assert!(matches!(inst.status, InstalmentStatus::Paid));
        assert_eq!(client.instalment_remaining(&deal_id, &1u32), 0);
    }

    /// Large (but in-range) i128 amounts are tracked without truncation.
    #[test]
    fn large_amount_values_are_not_truncated() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        let deal_id = make_deal_id(&env, "d_big");
        let big: i128 = 1_000_000_000_000_000_000; // 1e18
        client.create_schedule(&admin, &deal_id, &equal_term(&env, 1, big));

        // create_schedule aggregate carries the full value, untruncated.
        let created = last_event_data(&env);
        let ev_total: i128 = created.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(ev_total, big);

        assert_eq!(
            client.get_schedule(&deal_id).get(0).unwrap().amount_due,
            big
        );

        let tx = BytesN::from_array(&env, &[1u8; 32]);
        client.record_payment(&admin, &deal_id, &1u32, &big, &tx, &1u64);

        // instalment_paid event carries amount_due, untruncated.
        let paid = last_event_data(&env);
        let ev_amount_due: i128 = paid.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(ev_amount_due, big);

        assert!(matches!(
            client.get_instalment(&deal_id, &1u32).status,
            InstalmentStatus::Paid
        ));
    }

    #[test]
    fn get_waiver_returns_none_when_no_waiver_recorded() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        let deal_id = make_deal_id(&env, "d");
        client.create_schedule(&admin, &deal_id, &make_instalments(&env, 1));
        assert!(client.get_waiver(&deal_id, &1u32).is_none());
    }

    // ── A5 · events ───────────────────────────────────────────────────────

    #[test]
    fn create_schedule_emits_schedule_created_event() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        let deal_id = make_deal_id(&env, "d_evt");
        client.create_schedule(&admin, &deal_id, &make_instalments(&env, 3));

        let topics = last_event_topics(&env);
        let cat: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        let action: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        let ev_deal: String = topics.get(2).unwrap().try_into_val(&env).unwrap();
        assert_eq!(cat, Symbol::new(&env, "rent_schedule"));
        assert_eq!(action, Symbol::new(&env, "schedule_created"));
        assert_eq!(ev_deal, deal_id);

        let data = last_event_data(&env);
        let count: u32 = data.get(0).unwrap().try_into_val(&env).unwrap();
        let total: i128 = data.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(count, 3);
        assert_eq!(total, 600_000i128); // 100_000 + 200_000 + 300_000
    }

    #[test]
    fn record_payment_full_emits_instalment_paid_event() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        let deal_id = make_deal_id(&env, "d_evt");
        client.create_schedule(&admin, &deal_id, &make_instalments(&env, 1));
        let tx = BytesN::from_array(&env, &[7u8; 32]);
        client.record_payment(&admin, &deal_id, &1u32, &100_000i128, &tx, &1u64);

        let topics = last_event_topics(&env);
        let action: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(action, Symbol::new(&env, "instalment_paid"));
        let data = last_event_data(&env);
        let n: u32 = data.get(0).unwrap().try_into_val(&env).unwrap();
        let amount_due: i128 = data.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(n, 1);
        assert_eq!(amount_due, 100_000i128);
    }

    #[test]
    fn record_payment_partial_emits_partial_payment_recorded_event() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        let deal_id = make_deal_id(&env, "d_evt");
        client.create_schedule(&admin, &deal_id, &make_instalments(&env, 1));
        let tx = BytesN::from_array(&env, &[7u8; 32]);
        client.record_payment(&admin, &deal_id, &1u32, &40_000i128, &tx, &1u64);

        let topics = last_event_topics(&env);
        let action: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(action, Symbol::new(&env, "partial_payment_recorded"));
        let data = last_event_data(&env);
        let n: u32 = data.get(0).unwrap().try_into_val(&env).unwrap();
        let amount: i128 = data.get(1).unwrap().try_into_val(&env).unwrap();
        let amount_paid: i128 = data.get(2).unwrap().try_into_val(&env).unwrap();
        let remaining: i128 = data.get(3).unwrap().try_into_val(&env).unwrap();
        assert_eq!(n, 1);
        assert_eq!(amount, 40_000i128);
        assert_eq!(amount_paid, 40_000i128);
        assert_eq!(remaining, 60_000i128);
    }

    #[test]
    fn mark_overdue_emits_instalment_overdue_event() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        let deal_id = make_deal_id(&env, "d_evt");
        client.create_schedule(&admin, &deal_id, &make_instalments(&env, 1));
        client.mark_overdue(&admin, &deal_id, &1u32);

        let topics = last_event_topics(&env);
        let action: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(action, Symbol::new(&env, "instalment_overdue"));
        let data = last_event_data(&env);
        let n: u32 = data.get(0).unwrap().try_into_val(&env).unwrap();
        let remaining: i128 = data.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(n, 1);
        assert_eq!(remaining, 100_000i128);
    }

    #[test]
    fn waive_instalment_emits_instalment_waived_event() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);
        let deal_id = make_deal_id(&env, "d_evt");
        client.create_schedule(&admin, &deal_id, &make_instalments(&env, 1));
        client.waive_instalment(&admin, &deal_id, &1u32, &WaiverReason::Promotional);

        let topics = last_event_topics(&env);
        let action: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(action, Symbol::new(&env, "instalment_waived"));
        let data = last_event_data(&env);
        let n: u32 = data.get(0).unwrap().try_into_val(&env).unwrap();
        let reason_code: u32 = data.get(2).unwrap().try_into_val(&env).unwrap();
        let amount_waived: i128 = data.get(3).unwrap().try_into_val(&env).unwrap();
        assert_eq!(n, 1);
        assert_eq!(reason_code, WaiverReason::Promotional as u32); // 4
        assert_eq!(amount_waived, 100_000i128);
    }

    #[test]
    fn init_emits_init_event() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);

        let topics = last_event_topics(&env);
        assert_eq!(topics.len(), 2);
        let cat: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        let action: Symbol = topics.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(cat, Symbol::new(&env, "rent_schedule"));
        assert_eq!(action, Symbol::new(&env, "init"));
    }

    #[test]
    fn pause_and_unpause_emit_their_events() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, operator, contract_id) = setup(&env);
        let client = RentScheduleClient::new(&env, &contract_id);
        client.init(&admin, &operator);

        client.pause(&admin);
        let paused_action: Symbol = last_event_topics(&env)
            .get(1)
            .unwrap()
            .try_into_val(&env)
            .unwrap();
        assert_eq!(paused_action, Symbol::new(&env, "paused"));

        client.unpause(&admin);
        let unpaused_action: Symbol = last_event_topics(&env)
            .get(1)
            .unwrap()
            .try_into_val(&env)
            .unwrap();
        assert_eq!(unpaused_action, Symbol::new(&env, "unpaused"));
    }
}
