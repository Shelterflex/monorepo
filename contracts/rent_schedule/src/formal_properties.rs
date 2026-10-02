#![cfg(kani)]

use super::*;
use soroban_sdk::{Address, BytesN, Env, String, Vec};

#[kani::proof]
pub fn verify_contract_init_and_pause() {
    let env = Env::default();
    let contract_id = env.register(RentSchedule, ());
    let client = RentScheduleClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    env.mock_all_auths();

    client.init(&admin, &operator);
    assert!(!client.is_paused());

    client.pause(&admin);
    assert!(client.is_paused());

    client.unpause(&admin);
    assert!(!client.is_paused());
}

#[kani::proof]
pub fn verify_schedule_creation_and_payment() {
    let env = Env::default();
    let contract_id = env.register(RentSchedule, ());
    let client = RentScheduleClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    env.mock_all_auths();

    client.init(&admin, &operator);

    let deal_id = String::from_str(&env, "deal_1");
    let inst = ScheduledInstalment {
        instalment_number: 1,
        due_timestamp: 1000,
        amount_due: 100,
        amount_paid: 0,
        status: InstalmentStatus::Pending,
        paid_at: None,
        last_tx_id: None,
    };
    let mut vec = Vec::new(&env);
    vec.push_back(inst);

    client.create_schedule(&admin, &deal_id, &vec);

    let tx_id = BytesN::from_array(&env, &[1u8; 32]);
    client.record_payment(&admin, &deal_id, &1, &100, &tx_id, &2000);

    let updated_schedule = client.get_schedule(&deal_id);
    let updated_inst = updated_schedule.get(0).unwrap();
    assert_eq!(updated_inst.amount_paid, 100);
    assert!(matches!(updated_inst.status, InstalmentStatus::Paid));
}
