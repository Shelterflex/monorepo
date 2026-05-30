#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Vec};

#[contracttype]
pub struct Multisig {
    pub signers: Vec<Address>,
    pub threshold: u32,
}

#[contracttype]
pub enum DataKey {
    Approvals(u64),
}

#[contract]
pub struct MultisigContract;

#[contractimpl]
impl MultisigContract {
    pub fn approve(env: Env, signer: Address, op_id: u64) {
        let mut approvals: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Approvals(op_id))
            .unwrap_or_else(|| Vec::new(&env));

        if approvals.contains(&signer) {
            panic!("Already approved");
        }

        approvals.push_back(signer);
        env.storage()
            .persistent()
            .set(&DataKey::Approvals(op_id), &approvals);
    }

    pub fn execute(env: Env, op_id: u64, threshold: u32) {
        let approvals: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Approvals(op_id))
            .unwrap_or_else(|| Vec::new(&env));

        if approvals.len() < threshold {
            panic!("Not enough approvals");
        }

        // Execute logic here
    }

    pub fn revoke(env: Env, signer: Address, op_id: u64) {
        let approvals: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Approvals(op_id))
            .unwrap_or_else(|| Vec::new(&env));

        let mut new_approvals = Vec::new(&env);
        for s in approvals.iter() {
            if s != signer {
                new_approvals.push_back(s);
            }
        }

        env.storage()
            .persistent()
            .set(&DataKey::Approvals(op_id), &new_approvals);
    }
}
