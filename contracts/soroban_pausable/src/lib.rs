#![no_std]

use soroban_sdk::{contracterror, Address, Env};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PausableError {
    Paused = 3001,
    NotAuthorized = 3002,
}

pub trait Pausable {
    /// Pause the contract. Only an authorized admin should be able to trigger this.
    fn pause(env: Env, admin: Address) -> Result<(), PausableError>;

    /// Unpause the contract. Only an authorized admin should be able to trigger this.
    fn unpause(env: Env, admin: Address) -> Result<(), PausableError>;

    /// Check if the contract is paused.
    fn is_paused(env: Env) -> bool;
}
