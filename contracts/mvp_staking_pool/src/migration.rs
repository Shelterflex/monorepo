use soroban_sdk::{Bytes, Env};

pub trait Versionable {
    fn get_version(env: &Env) -> u32;
    fn set_version(env: &Env, version: u32);
}

pub trait Migratable {
    type Error;
    fn migrate(env: &Env, to_version: u32, data: Bytes) -> Result<(), Self::Error>;
}
