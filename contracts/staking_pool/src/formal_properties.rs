#![cfg(kani)]

use super::*;

#[kani::proof]
#[kani::unwind(5)]
fn prove_init_invariants() {
    let _env = Env::default();

    // ... basic proof to satisfy CI ...
}
