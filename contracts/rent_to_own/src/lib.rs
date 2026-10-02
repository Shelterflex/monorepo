#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, BytesN, Env, Symbol,
};

// ── Storage Keys ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Deal(BytesN<32>),
    Payment(BytesN<32>, u32),
    /// Forfeiture fraction in basis points (0–10000) applied on default
    ForfeitureBps,
    /// Default settlement record keyed by deal_id
    DefaultSettlement(BytesN<32>),
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    DealNotFound = 3,
    DealNotActive = 4,
    PaymentsNotComplete = 5,
    EquityOverflow = 6,
    InvalidAmount = 7,
    DealAlreadyExists = 8,
    // ── Issue #1133 ──────────────────────────────────────────────────────────
    AlreadySettled = 9,
    DealNotDefaulted = 10,
    SettlementNotFound = 11,
    // ── Issue #1251 ──────────────────────────────────────────────────────────
    InvalidTransfer = 12,
}

// ── Data Structures ───────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DealStatus {
    Active,
    Completed,
    Defaulted,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct RentToOwnDeal {
    pub deal_id: BytesN<32>,
    pub tenant: Address,
    pub property_value_usdc: i128,
    pub equity_accumulated_usdc: i128,
    pub monthly_equity_usdc: i128,
    pub payments_made: u32,
    pub total_payments_required: u32,
    pub status: DealStatus,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct EquityPayment {
    pub deal_id: BytesN<32>,
    pub payment_number: u32,
    pub equity_amount: i128,
    pub total_rent_amount: i128,
    pub paid_at: u64,
}

/// Recorded equity entitlements after a default. Not settled until `settle_default` is called.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DefaultSettlementRecord {
    /// Amount refundable to the tenant
    pub refundable_usdc: i128,
    /// Amount forfeited to the platform/landlord
    pub forfeited_usdc: i128,
    /// True once `settle_default` has been executed
    pub settled: bool,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct RentToOwn;

fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("not init")
}

fn require_admin(env: &Env, caller: &Address) -> Result<(), ContractError> {
    caller.require_auth();
    if caller != &get_admin(env) {
        return Err(ContractError::NotAuthorized);
    }
    Ok(())
}

fn get_forfeiture_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get::<_, u32>(&DataKey::ForfeitureBps)
        .unwrap_or(0)
}

/// Compute `(refundable, forfeited)` from accumulated equity and the forfeiture rate.
fn equity_split(equity: i128, forfeiture_bps: u32) -> (i128, i128) {
    let forfeited = equity * forfeiture_bps as i128 / 10_000;
    let refundable = equity - forfeited;
    (refundable, forfeited)
}

#[contractimpl]
impl RentToOwn {
    /// Initialise the contract.
    /// `forfeiture_bps`: the portion of accrued equity forfeited to the platform on default,
    /// expressed in basis points (0 = full refund, 10000 = full forfeiture).
    pub fn init(env: Env, admin: Address, forfeiture_bps: u32) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }
        admin.require_auth();
        if forfeiture_bps > 10_000 {
            return Err(ContractError::InvalidAmount);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::ForfeitureBps, &forfeiture_bps);
        Ok(())
    }

    /// Admin registers a rent-to-own deal.
    pub fn register_deal(
        env: Env,
        admin: Address,
        deal_id: BytesN<32>,
        tenant: Address,
        property_value_usdc: i128,
        monthly_equity_usdc: i128,
        total_payments_required: u32,
    ) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        if property_value_usdc <= 0 || monthly_equity_usdc <= 0 {
            return Err(ContractError::InvalidAmount);
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::Deal(deal_id.clone()))
        {
            return Err(ContractError::DealAlreadyExists);
        }

        let deal = RentToOwnDeal {
            deal_id: deal_id.clone(),
            tenant,
            property_value_usdc,
            equity_accumulated_usdc: 0,
            monthly_equity_usdc,
            payments_made: 0,
            total_payments_required,
            status: DealStatus::Active,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Deal(deal_id.clone()), &deal);

        env.events().publish(
            (
                Symbol::new(&env, "rent_to_own"),
                Symbol::new(&env, "deal_registered"),
            ),
            deal_id,
        );
        Ok(())
    }

    /// Backend calls per monthly payment; stores payment record; increments equity.
    pub fn record_equity_payment(
        env: Env,
        admin: Address,
        deal_id: BytesN<32>,
        rent_amount: i128,
        equity_amount: i128,
    ) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        if rent_amount <= 0 || equity_amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let mut deal: RentToOwnDeal = env
            .storage()
            .persistent()
            .get(&DataKey::Deal(deal_id.clone()))
            .ok_or(ContractError::DealNotFound)?;

        if !matches!(deal.status, DealStatus::Active) {
            return Err(ContractError::DealNotActive);
        }

        let new_equity = deal.equity_accumulated_usdc + equity_amount;
        if new_equity > deal.property_value_usdc {
            return Err(ContractError::EquityOverflow);
        }

        deal.equity_accumulated_usdc = new_equity;
        deal.payments_made += 1;
        let payment_number = deal.payments_made;

        env.storage()
            .persistent()
            .set(&DataKey::Deal(deal_id.clone()), &deal);

        let payment = EquityPayment {
            deal_id: deal_id.clone(),
            payment_number,
            equity_amount,
            total_rent_amount: rent_amount,
            paid_at: env.ledger().timestamp(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::Payment(deal_id.clone(), payment_number), &payment);

        env.events().publish(
            (
                Symbol::new(&env, "rent_to_own"),
                Symbol::new(&env, "equity_payment_recorded"),
            ),
            (deal_id, payment_number, new_equity),
        );
        Ok(())
    }

    /// Admin marks deal completed when all payments made; full equity entitlement transfers.
    pub fn complete_deal(
        env: Env,
        admin: Address,
        deal_id: BytesN<32>,
    ) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;

        let mut deal: RentToOwnDeal = env
            .storage()
            .persistent()
            .get(&DataKey::Deal(deal_id.clone()))
            .ok_or(ContractError::DealNotFound)?;

        if !matches!(deal.status, DealStatus::Active) {
            return Err(ContractError::DealNotActive);
        }
        if deal.payments_made != deal.total_payments_required {
            return Err(ContractError::PaymentsNotComplete);
        }

        deal.status = DealStatus::Completed;
        env.storage()
            .persistent()
            .set(&DataKey::Deal(deal_id.clone()), &deal);

        env.events().publish(
            (
                Symbol::new(&env, "rent_to_own"),
                Symbol::new(&env, "deal_completed"),
            ),
            (deal_id, deal.tenant, deal.equity_accumulated_usdc),
        );
        Ok(())
    }

    /// Admin marks deal defaulted. Computes the equity split (refundable vs. forfeited)
    /// according to the configured forfeiture fraction and records the settlement entitlement.
    /// Call `settle_default` to execute the settlement.
    pub fn default_deal(
        env: Env,
        admin: Address,
        deal_id: BytesN<32>,
        reason: Symbol,
    ) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;

        let mut deal: RentToOwnDeal = env
            .storage()
            .persistent()
            .get(&DataKey::Deal(deal_id.clone()))
            .ok_or(ContractError::DealNotFound)?;

        if !matches!(deal.status, DealStatus::Active) {
            return Err(ContractError::DealNotActive);
        }

        let accumulated = deal.equity_accumulated_usdc;
        let forfeiture_bps = get_forfeiture_bps(&env);
        let (refundable, forfeited) = equity_split(accumulated, forfeiture_bps);

        deal.status = DealStatus::Defaulted;
        env.storage()
            .persistent()
            .set(&DataKey::Deal(deal_id.clone()), &deal);

        let settlement = DefaultSettlementRecord {
            refundable_usdc: refundable,
            forfeited_usdc: forfeited,
            settled: false,
        };
        env.storage()
            .persistent()
            .set(&DataKey::DefaultSettlement(deal_id.clone()), &settlement);

        env.events().publish(
            (
                Symbol::new(&env, "rent_to_own"),
                Symbol::new(&env, "deal_defaulted"),
            ),
            (deal_id, reason, accumulated, refundable, forfeited),
        );
        Ok(())
    }

    /// Execute the settlement for a defaulted deal, exactly once.
    /// Records that the refundable portion is owed to the tenant and the
    /// forfeited portion is owed to the platform. Token movement is handled
    /// by an escrow contract in a follow-up.
    pub fn settle_default(
        env: Env,
        admin: Address,
        deal_id: BytesN<32>,
    ) -> Result<DefaultSettlementRecord, ContractError> {
        require_admin(&env, &admin)?;

        let deal: RentToOwnDeal = env
            .storage()
            .persistent()
            .get(&DataKey::Deal(deal_id.clone()))
            .ok_or(ContractError::DealNotFound)?;

        if !matches!(deal.status, DealStatus::Defaulted) {
            return Err(ContractError::DealNotDefaulted);
        }

        let mut settlement: DefaultSettlementRecord = env
            .storage()
            .persistent()
            .get(&DataKey::DefaultSettlement(deal_id.clone()))
            .ok_or(ContractError::SettlementNotFound)?;

        if settlement.settled {
            return Err(ContractError::AlreadySettled);
        }

        settlement.settled = true;
        env.storage()
            .persistent()
            .set(&DataKey::DefaultSettlement(deal_id.clone()), &settlement);

        env.events().publish(
            (
                Symbol::new(&env, "rent_to_own"),
                Symbol::new(&env, "equity_settled"),
            ),
            (
                deal_id,
                deal.tenant,
                settlement.refundable_usdc,
                settlement.forfeited_usdc,
            ),
        );
        Ok(settlement)
    }

    /// Transfer a rent-to-own position from the current tenant to a new party.
    /// Moves accrued equity and remaining obligation to the new holder.
    /// Requires authorization from both the current tenant and admin.
    /// Rejects transfers on completed/defaulted deals and to invalid addresses.
    pub fn transfer_position(
        env: Env,
        admin: Address,
        from: Address,
        to: Address,
        deal_id: BytesN<32>,
    ) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        from.require_auth();

        let mut deal: RentToOwnDeal = env
            .storage()
            .persistent()
            .get(&DataKey::Deal(deal_id.clone()))
            .ok_or(ContractError::DealNotFound)?;

        // Verify the caller is the current tenant
        if deal.tenant != from {
            return Err(ContractError::NotAuthorized);
        }

        // Only active deals can be transferred
        if !matches!(deal.status, DealStatus::Active) {
            return Err(ContractError::InvalidTransfer);
        }

        // Cannot transfer to the same address
        if from == to {
            return Err(ContractError::InvalidTransfer);
        }

        // Preserve equity accounting - transfer the tenant field
        let equity_before = deal.equity_accumulated_usdc;
        deal.tenant = to.clone();

        env.storage()
            .persistent()
            .set(&DataKey::Deal(deal_id.clone()), &deal);

        // Emit position_transferred event
        env.events().publish(
            (
                Symbol::new(&env, "rent_to_own"),
                Symbol::new(&env, "position_transferred"),
            ),
            (deal_id, from, to, equity_before),
        );

        Ok(())
    }

    pub fn get_deal(env: Env, deal_id: BytesN<32>) -> Option<RentToOwnDeal> {
        env.storage().persistent().get(&DataKey::Deal(deal_id))
    }

    pub fn get_default_settlement(
        env: Env,
        deal_id: BytesN<32>,
    ) -> Option<DefaultSettlementRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::DefaultSettlement(deal_id))
    }

    /// Returns equity as basis points of property value (0–10000).
    pub fn get_equity_percentage(env: Env, deal_id: BytesN<32>) -> u32 {
        let deal: RentToOwnDeal = match env.storage().persistent().get(&DataKey::Deal(deal_id)) {
            Some(d) => d,
            None => return 0,
        };
        if deal.property_value_usdc == 0 {
            return 0;
        }
        ((deal.equity_accumulated_usdc * 10_000) / deal.property_value_usdc) as u32
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(kani)]
mod formal_properties;

#[cfg(test)]
mod test {
    extern crate std;

    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    fn setup(env: &Env) -> (Address, RentToOwnClient<'_>) {
        env.mock_all_auths();
        let id = env.register(RentToOwn, ());
        let client = RentToOwnClient::new(env, &id);
        let admin = Address::generate(env);
        // Default: 20% forfeiture on default
        client.init(&admin, &2000u32);
        (admin, client)
    }

    #[test]
    #[should_panic]
    fn init_requires_admin_auth() {
        let env = Env::default();
        let id = env.register(RentToOwn, ());
        let client = RentToOwnClient::new(&env, &id);
        let admin = Address::generate(&env);

        client.init(&admin, &2000u32);
    }

    fn make_deal_id(env: &Env, seed: u8) -> BytesN<32> {
        BytesN::from_array(env, &[seed; 32])
    }

    #[test]
    fn full_lifecycle_register_payments_complete() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let tenant = Address::generate(&env);
        let deal_id = make_deal_id(&env, 1);

        client.register_deal(&admin, &deal_id, &tenant, &100_000, &10_000, &10);

        for _ in 0..10 {
            client.record_equity_payment(&admin, &deal_id, &15_000, &10_000);
        }

        let deal = client.get_deal(&deal_id).unwrap();
        assert_eq!(deal.payments_made, 10);
        assert_eq!(deal.equity_accumulated_usdc, 100_000);

        client.complete_deal(&admin, &deal_id);
        let deal = client.get_deal(&deal_id).unwrap();
        assert!(matches!(deal.status, DealStatus::Completed));
    }

    #[test]
    fn equity_is_monotonically_increasing() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let tenant = Address::generate(&env);
        let deal_id = make_deal_id(&env, 2);

        client.register_deal(&admin, &deal_id, &tenant, &100_000, &10_000, &5);

        let mut prev_equity = 0i128;
        for _ in 0..5 {
            client.record_equity_payment(&admin, &deal_id, &15_000, &10_000);
            let deal = client.get_deal(&deal_id).unwrap();
            assert!(deal.equity_accumulated_usdc > prev_equity);
            prev_equity = deal.equity_accumulated_usdc;
        }
    }

    #[test]
    fn default_mid_deal() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let tenant = Address::generate(&env);
        let deal_id = make_deal_id(&env, 3);

        client.register_deal(&admin, &deal_id, &tenant, &100_000, &10_000, &10);
        client.record_equity_payment(&admin, &deal_id, &15_000, &10_000);
        client.record_equity_payment(&admin, &deal_id, &15_000, &10_000);

        client.default_deal(&admin, &deal_id, &Symbol::new(&env, "missed_payment"));
        let deal = client.get_deal(&deal_id).unwrap();
        assert!(matches!(deal.status, DealStatus::Defaulted));
        assert_eq!(deal.equity_accumulated_usdc, 20_000);
    }

    #[test]
    fn overpayment_protection() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let tenant = Address::generate(&env);
        let deal_id = make_deal_id(&env, 4);

        client.register_deal(&admin, &deal_id, &tenant, &10_000, &6_000, &2);
        client.record_equity_payment(&admin, &deal_id, &8_000, &6_000);

        let result = client.try_record_equity_payment(&admin, &deal_id, &8_000, &6_000);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::EquityOverflow);
    }

    #[test]
    fn complete_deal_fails_if_payments_not_done() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let tenant = Address::generate(&env);
        let deal_id = make_deal_id(&env, 5);

        client.register_deal(&admin, &deal_id, &tenant, &100_000, &10_000, &10);
        client.record_equity_payment(&admin, &deal_id, &15_000, &10_000);

        let result = client.try_complete_deal(&admin, &deal_id);
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::PaymentsNotComplete
        );
    }

    #[test]
    fn equity_percentage_correct() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let tenant = Address::generate(&env);
        let deal_id = make_deal_id(&env, 6);

        client.register_deal(&admin, &deal_id, &tenant, &100_000, &25_000, &4);
        client.record_equity_payment(&admin, &deal_id, &30_000, &25_000);

        assert_eq!(client.get_equity_percentage(&deal_id), 2_500);
    }

    #[test]
    fn non_admin_cannot_register_deal() {
        let env = Env::default();
        let (_admin, client) = setup(&env);
        let attacker = Address::generate(&env);
        let tenant = Address::generate(&env);
        let deal_id = make_deal_id(&env, 7);

        let result = client.try_register_deal(&attacker, &deal_id, &tenant, &100_000, &10_000, &10);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NotAuthorized);
    }

    #[test]
    fn payment_on_completed_deal_fails() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let tenant = Address::generate(&env);
        let deal_id = make_deal_id(&env, 8);

        client.register_deal(&admin, &deal_id, &tenant, &10_000, &10_000, &1);
        client.record_equity_payment(&admin, &deal_id, &10_000, &10_000);
        client.complete_deal(&admin, &deal_id);

        let result = client.try_record_equity_payment(&admin, &deal_id, &10_000, &10_000);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::DealNotActive);
    }

    // ── Issue #1133: Default equity policy tests ──────────────────────────────

    #[test]
    fn default_equity_split_correct() {
        let env = Env::default();
        // 30% forfeiture
        env.mock_all_auths();
        let id = env.register(RentToOwn, ());
        let client = RentToOwnClient::new(&env, &id);
        let admin = Address::generate(&env);
        let tenant = Address::generate(&env);
        client.init(&admin, &3000u32); // 30% forfeiture
        let deal_id = make_deal_id(&env, 20);

        client.register_deal(&admin, &deal_id, &tenant, &100_000, &10_000, &10);
        // Make 4 payments: equity = 40_000
        for _ in 0..4 {
            client.record_equity_payment(&admin, &deal_id, &15_000, &10_000);
        }

        client.default_deal(&admin, &deal_id, &Symbol::new(&env, "default"));

        let settlement = client.get_default_settlement(&deal_id).unwrap();
        // 40_000 * 3000 / 10_000 = 12_000 forfeited
        // 40_000 - 12_000 = 28_000 refundable
        assert_eq!(settlement.forfeited_usdc, 12_000);
        assert_eq!(settlement.refundable_usdc, 28_000);
        assert_eq!(
            settlement.refundable_usdc + settlement.forfeited_usdc,
            40_000
        );
        assert!(!settlement.settled);
    }

    #[test]
    fn double_settlement_rejected() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let tenant = Address::generate(&env);
        let deal_id = make_deal_id(&env, 21);

        client.register_deal(&admin, &deal_id, &tenant, &100_000, &10_000, &10);
        client.record_equity_payment(&admin, &deal_id, &15_000, &10_000);

        client.default_deal(&admin, &deal_id, &Symbol::new(&env, "default"));

        // First settlement succeeds
        let s = client.settle_default(&admin, &deal_id);
        assert!(s.settled);

        // Second settlement is rejected
        let err = client
            .try_settle_default(&admin, &deal_id)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::AlreadySettled);
    }

    #[test]
    fn complete_vs_default_divergence() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let tenant = Address::generate(&env);
        let deal_id_a = make_deal_id(&env, 22);
        let deal_id_b = make_deal_id(&env, 23);

        // Deal A: completes normally — full equity to tenant, no split
        client.register_deal(&admin, &deal_id_a, &tenant, &10_000, &10_000, &1);
        client.record_equity_payment(&admin, &deal_id_a, &10_000, &10_000);
        client.complete_deal(&admin, &deal_id_a);
        let deal_a = client.get_deal(&deal_id_a).unwrap();
        assert!(matches!(deal_a.status, DealStatus::Completed));
        // No settlement record for completed deal
        assert!(client.get_default_settlement(&deal_id_a).is_none());

        // Deal B: defaults — equity is split
        client.register_deal(&admin, &deal_id_b, &tenant, &10_000, &10_000, &1);
        client.record_equity_payment(&admin, &deal_id_b, &10_000, &10_000);
        // Can't complete if we want to default — use a fresh deal without completing
        let deal_id_c = make_deal_id(&env, 24);
        client.register_deal(&admin, &deal_id_c, &tenant, &10_000, &2_000, &5);
        client.record_equity_payment(&admin, &deal_id_c, &5_000, &2_000);
        client.default_deal(&admin, &deal_id_c, &Symbol::new(&env, "test"));
        let deal_c = client.get_deal(&deal_id_c).unwrap();
        assert!(matches!(deal_c.status, DealStatus::Defaulted));
        assert!(client.get_default_settlement(&deal_id_c).is_some());
    }

    #[test]
    fn zero_equity_default() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let tenant = Address::generate(&env);
        let deal_id = make_deal_id(&env, 25);

        client.register_deal(&admin, &deal_id, &tenant, &100_000, &10_000, &10);
        // No payments made; equity = 0
        client.default_deal(&admin, &deal_id, &Symbol::new(&env, "no_payments"));

        let settlement = client.get_default_settlement(&deal_id).unwrap();
        assert_eq!(settlement.refundable_usdc, 0);
        assert_eq!(settlement.forfeited_usdc, 0);

        // Settlement of zero-equity deal should still succeed once
        let s = client.settle_default(&admin, &deal_id);
        assert!(s.settled);
    }

    #[test]
    fn settle_non_defaulted_deal_rejected() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let tenant = Address::generate(&env);
        let deal_id = make_deal_id(&env, 26);

        client.register_deal(&admin, &deal_id, &tenant, &10_000, &10_000, &1);
        // Still active — settle_default must fail
        let err = client
            .try_settle_default(&admin, &deal_id)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::DealNotDefaulted);
    }

    // ── Issue #1251: Equity transfer/assignment tests ─────────────────────────

    #[test]
    fn authorized_transfer_succeeds() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let tenant = Address::generate(&env);
        let new_tenant = Address::generate(&env);
        let deal_id = make_deal_id(&env, 30);

        client.register_deal(&admin, &deal_id, &tenant, &100_000, &10_000, &10);
        client.record_equity_payment(&admin, &deal_id, &15_000, &10_000);

        let deal_before = client.get_deal(&deal_id).unwrap();
        assert_eq!(deal_before.tenant, tenant);
        assert_eq!(deal_before.equity_accumulated_usdc, 10_000);

        // Transfer succeeds with admin authorization
        client.transfer_position(&admin, &tenant, &new_tenant, &deal_id);

        let deal_after = client.get_deal(&deal_id).unwrap();
        assert_eq!(deal_after.tenant, new_tenant);
        // Equity is conserved exactly
        assert_eq!(deal_after.equity_accumulated_usdc, 10_000);
        assert_eq!(deal_after.payments_made, 1);
    }

    #[test]
    fn unauthorized_transfer_rejected() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let tenant = Address::generate(&env);
        let attacker = Address::generate(&env);
        let new_tenant = Address::generate(&env);
        let deal_id = make_deal_id(&env, 31);

        client.register_deal(&admin, &deal_id, &tenant, &100_000, &10_000, &10);

        // Attacker cannot transfer someone else's position
        let err = client
            .try_transfer_position(&admin, &attacker, &new_tenant, &deal_id)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    #[test]
    fn transfer_without_admin_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(RentToOwn, ());
        let client = RentToOwnClient::new(&env, &id);
        let admin = Address::generate(&env);
        let tenant = Address::generate(&env);
        let new_tenant = Address::generate(&env);
        let deal_id = make_deal_id(&env, 32);

        client.init(&admin, &2000u32);
        client.register_deal(&admin, &deal_id, &tenant, &100_000, &10_000, &10);

        // Non-admin cannot authorize transfer
        let random = Address::generate(&env);
        let err = client
            .try_transfer_position(&random, &tenant, &new_tenant, &deal_id)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::NotAuthorized);
    }

    #[test]
    fn transfer_on_completed_deal_rejected() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let tenant = Address::generate(&env);
        let new_tenant = Address::generate(&env);
        let deal_id = make_deal_id(&env, 33);

        client.register_deal(&admin, &deal_id, &tenant, &10_000, &10_000, &1);
        client.record_equity_payment(&admin, &deal_id, &10_000, &10_000);
        client.complete_deal(&admin, &deal_id);

        // Cannot transfer completed deal
        let err = client
            .try_transfer_position(&admin, &tenant, &new_tenant, &deal_id)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InvalidTransfer);
    }

    #[test]
    fn transfer_on_defaulted_deal_rejected() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let tenant = Address::generate(&env);
        let new_tenant = Address::generate(&env);
        let deal_id = make_deal_id(&env, 34);

        client.register_deal(&admin, &deal_id, &tenant, &100_000, &10_000, &10);
        client.record_equity_payment(&admin, &deal_id, &15_000, &10_000);
        client.default_deal(&admin, &deal_id, &Symbol::new(&env, "test"));

        // Cannot transfer defaulted deal
        let err = client
            .try_transfer_position(&admin, &tenant, &new_tenant, &deal_id)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InvalidTransfer);
    }

    #[test]
    fn transfer_to_same_address_rejected() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let tenant = Address::generate(&env);
        let deal_id = make_deal_id(&env, 35);

        client.register_deal(&admin, &deal_id, &tenant, &100_000, &10_000, &10);

        // Cannot transfer to self
        let err = client
            .try_transfer_position(&admin, &tenant, &tenant, &deal_id)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::InvalidTransfer);
    }

    #[test]
    fn equity_conserved_across_transfer() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let tenant = Address::generate(&env);
        let new_tenant = Address::generate(&env);
        let deal_id = make_deal_id(&env, 36);

        client.register_deal(&admin, &deal_id, &tenant, &100_000, &10_000, &10);

        // Build up equity
        for _ in 0..5 {
            client.record_equity_payment(&admin, &deal_id, &15_000, &10_000);
        }

        let equity_before = client.get_deal(&deal_id).unwrap().equity_accumulated_usdc;
        assert_eq!(equity_before, 50_000);

        client.transfer_position(&admin, &tenant, &new_tenant, &deal_id);

        let equity_after = client.get_deal(&deal_id).unwrap().equity_accumulated_usdc;
        assert_eq!(equity_after, 50_000);
        // Equity percentage should remain the same
        assert_eq!(client.get_equity_percentage(&deal_id), 5000);
    }

    #[test]
    fn post_transfer_payments_accrue_to_new_holder() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let tenant = Address::generate(&env);
        let new_tenant = Address::generate(&env);
        let deal_id = make_deal_id(&env, 37);

        client.register_deal(&admin, &deal_id, &tenant, &100_000, &10_000, &10);
        client.record_equity_payment(&admin, &deal_id, &15_000, &10_000);

        client.transfer_position(&admin, &tenant, &new_tenant, &deal_id);

        // New payments should accrue to new holder
        client.record_equity_payment(&admin, &deal_id, &15_000, &10_000);

        let deal = client.get_deal(&deal_id).unwrap();
        assert_eq!(deal.tenant, new_tenant);
        assert_eq!(deal.equity_accumulated_usdc, 20_000);
        assert_eq!(deal.payments_made, 2);
    }

    #[test]
    fn transfer_on_nonexistent_deal_rejected() {
        let env = Env::default();
        let (admin, client) = setup(&env);
        let tenant = Address::generate(&env);
        let new_tenant = Address::generate(&env);
        let deal_id = make_deal_id(&env, 38);

        // Cannot transfer non-existent deal
        let err = client
            .try_transfer_position(&admin, &tenant, &new_tenant, &deal_id)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, ContractError::DealNotFound);
    }
}
