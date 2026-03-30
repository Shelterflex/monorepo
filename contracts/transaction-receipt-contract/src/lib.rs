//! Transaction Receipt Contract
//!
//! This contract provides deterministic transaction receipt recording and
//! retrieval for on-chain indexing. Receipts are keyed by a SHA-256 hash of a
//! canonicalized external payment reference (the `tx_id`). The contract enforces
//! validation rules on external references, prevents duplicates, and supports
//! admin/operator authorization and pause control.
//!
#![no_std]

extern crate alloc;

use soroban_pausable::{Pausable, PausableError};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, BytesN, String, Symbol,
};

#[cfg(kani)]
pub mod formal_properties;

/// Allowed external reference sources for transaction ID generation
pub const ALLOWED_SOURCES: [&str; 8] = [
    "paystack",
    "flutterwave",
    "bank_transfer",
    "stellar",
    "onramp",
    "offramp",
    "manual",
    "manual_admin",
];

/// Allowed transaction types for MVP
pub const ALLOWED_TX_TYPES: [&str; 7] = [
    "TENANT_REPAYMENT",
    "LANDLORD_PAYOUT",
    "WHISTLEBLOWER_REWARD",
    "STAKE",
    "UNSTAKE",
    "STAKE_REWARD_CLAIM",
    "CONVERSION",
];

/// Input parameters for recording a receipt (to avoid 10-parameter limit)
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReceiptInput {
    /// The payment source (e.g., "paystack", "stellar")
    pub external_ref_source: Symbol,
    /// The external payment reference string
    pub external_ref: String,
    /// Transaction type (e.g., "rent_payment", "deposit", "refund")
    pub tx_type: Symbol,
    /// Transaction amount in USDC (canonical amount, must be positive)
    pub amount_usdc: i128,
    /// USDC token contract address
    pub token: Address,
    /// Deal identifier this transaction belongs to
    pub deal_id: String,
    /// Optional listing identifier
    pub listing_id: Option<String>,
    /// Optional sender address
    pub from: Option<Address>,
    /// Optional recipient address
    pub to: Option<Address>,
    /// Optional amount in NGN (metadata only)
    pub amount_ngn: Option<i128>,
    /// Optional FX rate (NGN per USDC, metadata only)
    pub fx_rate_ngn_per_usdc: Option<i128>,
    /// Optional FX provider name (metadata only)
    pub fx_provider: Option<String>,
    /// Optional metadata hash (SHA-256 of canonical receipt payload v1)
    pub metadata_hash: Option<BytesN<32>>,
}

/// Helper function to validate external reference source and external reference.
///
/// This enforces the same invariants as `generate_tx_id`, but can be used
/// independently in validation flows.
fn validate_external_ref(
    external_ref_source: &Symbol,
    external_ref: &String,
) -> Result<(), ContractError> {
    use alloc::string::ToString;

    extern crate alloc;
    use alloc::string::String as StdString;

    let source_str: StdString = external_ref_source.to_string();
    let source_trimmed = source_str.trim();
    let source_lower = source_trimmed.to_lowercase();

    if !ALLOWED_SOURCES.contains(&source_lower.as_str()) {
        return Err(ContractError::InvalidExternalRefSource);
    }

    let ref_str: StdString = external_ref.to_string();
    let ref_trimmed = ref_str.trim();

    if ref_trimmed.is_empty() {
        return Err(ContractError::InvalidExternalRef);
    }

    if ref_trimmed.contains('|') {
        return Err(ContractError::InvalidExternalRef);
    }

    if ref_trimmed.len() > 256 {
        return Err(ContractError::InvalidExternalRef);
    }

    Ok(())
}

/// Produce canonical bytes for metadata hashing (v1).
///
/// Canonical format:
/// `v1|external_ref_source=<lowercased_trimmed>|external_ref=<trimmed>|tx_type=<case_sensitive>|amount_usdc=<i128>|token=<address>|deal_id=<string>|listing_id=<string>|from=<address>|to=<address>|amount_ngn=<i128>|fx_rate_ngn_per_usdc=<i128>|fx_provider=<string>`
///
/// Optional fields rules:
/// - If `None`, the key is omitted entirely.
/// - If `Some`, values are rendered without extra whitespace.
///
/// Ordering is fixed and MUST NOT change.
fn canonical_metadata_payload_v1(
    env: &soroban_sdk::Env,
    input: &ReceiptInput,
) -> soroban_sdk::Bytes {
    use soroban_sdk::Bytes;

    extern crate alloc;
    use alloc::format;
    use alloc::string::String as StdString;
    use alloc::string::ToString;

    let source_str: StdString = input.external_ref_source.to_string();
    let source_lower = source_str.trim().to_lowercase();

    let ext_ref_str: StdString = input.external_ref.to_string();
    let ext_ref_trimmed = ext_ref_str.trim();

    let tx_type_str: StdString = input.tx_type.to_string();
    let token_str: StdString = input.token.to_string().to_string();
    let deal_id_str: StdString = input.deal_id.to_string().to_string();

    let mut out: StdString = format!(
        "v1|external_ref_source={}|external_ref={}|tx_type={}|amount_usdc={}|token={}|deal_id={}",
        source_lower, ext_ref_trimmed, tx_type_str, input.amount_usdc, token_str, deal_id_str,
    );

    if let Some(ref listing_id) = input.listing_id {
        out.push_str("|listing_id=");
        let s: StdString = listing_id.to_string();
        out.push_str(s.as_str());
    }

    if let Some(ref from) = input.from {
        out.push_str("|from=");
        let s: StdString = from.to_string().to_string();
        out.push_str(s.as_str());
    }

    if let Some(ref to) = input.to {
        out.push_str("|to=");
        let s: StdString = to.to_string().to_string();
        out.push_str(s.as_str());
    }

    if let Some(amount_ngn) = input.amount_ngn {
        out.push_str("|amount_ngn=");
        out.push_str(format!("{}", amount_ngn).as_str());
    }

    if let Some(fx_rate) = input.fx_rate_ngn_per_usdc {
        out.push_str("|fx_rate_ngn_per_usdc=");
        out.push_str(format!("{}", fx_rate).as_str());
    }

    if let Some(ref fx_provider) = input.fx_provider {
        out.push_str("|fx_provider=");
        let s: StdString = fx_provider.to_string();
        out.push_str(s.as_str());
    }

    Bytes::from_slice(env, out.as_bytes())
}

fn derive_metadata_hash(env: &soroban_sdk::Env, input: &ReceiptInput) -> BytesN<32> {
    let payload = canonical_metadata_payload_v1(env, input);
    env.crypto().sha256(&payload).into()
}

fn verify_metadata_hash(env: &soroban_sdk::Env, input: &ReceiptInput, hash: &BytesN<32>) -> bool {
    derive_metadata_hash(env, input) == hash.clone()
}

/// Receipt data structure representing an immutable transaction record
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Receipt {
    /// Unique transaction identifier (SHA-256 hash of canonical external reference)
    pub tx_id: BytesN<32>,
    /// Transaction type (e.g., "rent_payment", "deposit", "refund")
    pub tx_type: Symbol,
    /// Transaction amount in USDC (canonical amount, must be positive)
    pub amount_usdc: i128,
    /// USDC token contract address
    pub token: Address,
    /// Deal identifier this transaction belongs to
    pub deal_id: String,
    /// Optional listing identifier
    pub listing_id: Option<String>,
    /// Optional sender address
    pub from: Option<Address>,
    /// Optional recipient address
    pub to: Option<Address>,
    /// External reference (same as tx_id)
    pub external_ref: BytesN<32>,
    /// Optional amount in NGN (metadata only)
    pub amount_ngn: Option<i128>,
    /// Optional FX rate (NGN per USDC, metadata only)
    pub fx_rate_ngn_per_usdc: Option<i128>,
    /// Optional FX provider name (metadata only)
    pub fx_provider: Option<String>,
    /// Optional metadata hash (SHA-256 of canonical receipt payload v1)
    pub metadata_hash: Option<BytesN<32>>,
    /// Timestamp when receipt was recorded (ledger timestamp)
    pub timestamp: u64,
}

/// Storage keys for contract state
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StorageKey {
    ContractVersion,
    /// Admin address (set during initialization, immutable)
    Admin,
    /// Operator address (can be changed by admin)
    Operator,
    /// Paused state (boolean)
    Paused,
    /// Receipt storage: tx_id → Receipt
    Receipt(BytesN<32>),
    /// Deal index: (deal_id, index) → tx_id
    DealIndex(String, u32),
    /// Deal count: deal_id → count
    DealCount(String),
    /// User index: (user_address, index) → tx_id
    UserIndex(Address, u32),
    /// User count: user_address → count
    UserCount(Address),
}

/// Contract error types
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    /// Contract has already been initialized
    AlreadyInitialized = 1,
    /// Caller is not authorized for this operation
    NotAuthorized = 2,
    /// Contract is currently paused
    Paused = 3,
    /// Amount is invalid (zero or negative)
    InvalidAmount = 4,
    /// Transaction ID already exists (duplicate)
    DuplicateTransaction = 5,
    /// External reference source is not in allowed list
    InvalidExternalRefSource = 6,
    /// External reference is invalid (empty, contains pipes, or too long)
    InvalidExternalRef = 7,
    /// Timestamp is invalid
    InvalidTimestamp = 8,
    /// Transaction type is not in allowed list
    InvalidTxType = 9,
    /// Metadata hash is invalid (does not match canonical payload)
    InvalidMetadataHash = 10,
}

#[cfg(kani)]
pub mod formal_properties;
#[contract]
/// Primary contract type. All public contract methods are implemented on this
/// struct via the `#[contractimpl]` impl block.
pub struct TransactionReceiptContract;

#[contractimpl]
impl TransactionReceiptContract {
    /// Initialize the contract with admin and operator addresses
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `admin` - The admin address (can manage operator and pause state)
    /// * `operator` - The operator address (can record receipts)
    ///
    /// # Returns
    /// * `Ok(())` - If initialization succeeds
    /// * `Err(ContractError::AlreadyInitialized)` - If contract is already initialized
    ///
    /// # Requirements
    /// * Can only be called once (Requirements 1.3)
    /// * Stores admin and operator addresses (Requirements 1.1, 1.2)
    /// * Initializes paused state to false
    pub fn init(
        env: soroban_sdk::Env,
        admin: Address,
        operator: Address,
    ) -> Result<(), ContractError> {
        // Check if already initialized by checking if Admin key exists
        if env.storage().instance().has(&StorageKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }

        // Store admin address
        env.storage().instance().set(&StorageKey::Admin, &admin);

        // Store operator address
        env.storage()
            .instance()
            .set(&StorageKey::Operator, &operator);

        env.storage()
            .instance()
            .set(&StorageKey::ContractVersion, &1u32);

        // Initialize paused state to false
        env.storage().instance().set(&StorageKey::Paused, &false);

        env.events().publish(
            (
                Symbol::new(&env, "transaction_receipt"),
                Symbol::new(&env, "init"),
            ),
            (admin, operator, 1u32),
        );

        Ok(())
    }

    pub fn contract_version(env: soroban_sdk::Env) -> u32 {
        env.storage()
            .instance()
            .get::<_, u32>(&StorageKey::ContractVersion)
            .unwrap_or(0u32)
    }

    pub fn version(env: soroban_sdk::Env) -> u32 {
        Self::contract_version(env)
    }

    /// Set a new operator address
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `admin` - The admin address attempting to set operator
    /// * `new_operator` - The new operator address
    ///
    /// # Returns
    /// * `Ok(())` - If operator update succeeds
    /// * `Err(ContractError::NotAuthorized)` - If caller is not admin
    ///
    /// # Requirements
    /// * Only admin can set operator (Requirement 5.2, 7.2)
    /// * Updates operator address in storage (Requirement 7.1)
    /// * Accepts any valid Soroban Address (Requirement 7.3)
    pub fn set_operator(
        env: soroban_sdk::Env,
        admin: Address,
        new_operator: Address,
    ) -> Result<(), ContractError> {
        // Require authentication from the admin
        admin.require_auth();

        // Verify caller is admin
        require_admin(&env, &admin)?;

        // Update operator address in storage
        let old_operator: Address = env
            .storage()
            .instance()
            .get(&StorageKey::Operator)
            .unwrap_or_else(|| panic!("Operator not initialized"));
        env.storage()
            .instance()
            .set(&StorageKey::Operator, &new_operator);

        env.events().publish(
            (
                Symbol::new(&env, "transaction_receipt"),
                Symbol::new(&env, "set_operator"),
            ),
            (old_operator, new_operator),
        );

        Ok(())
    }

    /// Record a new transaction receipt
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `operator` - The operator address attempting to record
    /// * `input` - Receipt input parameters (ReceiptInput struct)
    ///
    /// # Returns
    /// * `Ok(BytesN<32>)` - The generated tx_id
    /// * `Err(ContractError)` - If validation fails or duplicate detected
    ///
    /// # Requirements
    /// * Only operator can record (Requirement 5.1)
    /// * Contract must not be paused (Requirement 6.2)
    /// * Amount must be positive (Requirement 2.4)
    /// * Rejects duplicate tx_id (Requirement 3.1)
    /// * Emits event on success (Requirements 10.1, 10.2, 10.3)
    pub fn record_receipt(
        env: soroban_sdk::Env,
        operator: Address,
        input: ReceiptInput,
    ) -> Result<BytesN<32>, ContractError> {
        // Require authentication from the operator
        operator.require_auth();

        // Verify caller is operator
        require_operator(&env, &operator)?;

        // Verify contract is not paused
        require_not_paused(&env)?;

        // Validate amount_usdc is positive
        if input.amount_usdc <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        // Validate tx_type is in allowed list
        validate_tx_type(&input.tx_type)?;

        // Validate external reference source and reference
        validate_external_ref(&input.external_ref_source, &input.external_ref)?;

        // Generate tx_id from canonical external reference
        let tx_id = generate_tx_id(&env, &input.external_ref_source, &input.external_ref)?;

        // If provided, validate metadata hash against canonical payload
        if let Some(ref mh) = input.metadata_hash {
            if !verify_metadata_hash(&env, &input, mh) {
                return Err(ContractError::InvalidMetadataHash);
            }
        }

        // Check for duplicate tx_id
        if env
            .storage()
            .persistent()
            .has(&StorageKey::Receipt(tx_id.clone()))
        {
            return Err(ContractError::DuplicateTransaction);
        }

        // Get current ledger timestamp
        let timestamp = env.ledger().timestamp();

        // Create Receipt struct
        let receipt = Receipt {
            tx_id: tx_id.clone(),
            tx_type: input.tx_type,
            amount_usdc: input.amount_usdc,
            token: input.token,
            deal_id: input.deal_id.clone(),
            listing_id: input.listing_id,
            from: input.from,
            to: input.to,
            external_ref: tx_id.clone(), // Same as tx_id per Requirement 4.10
            amount_ngn: input.amount_ngn,
            fx_rate_ngn_per_usdc: input.fx_rate_ngn_per_usdc,
            fx_provider: input.fx_provider,
            metadata_hash: input.metadata_hash,
            timestamp,
        };

        // Store receipt in persistent storage
        env.storage()
            .persistent()
            .set(&StorageKey::Receipt(tx_id.clone()), &receipt);

        // Update deal index
        let deal_count_key = StorageKey::DealCount(input.deal_id.clone());
        let current_count: u32 = env.storage().persistent().get(&deal_count_key).unwrap_or(0);

        // Store tx_id in deal index
        let deal_index_key = StorageKey::DealIndex(input.deal_id.clone(), current_count);
        env.storage().persistent().set(&deal_index_key, &tx_id);

        // Increment deal count
        env.storage()
            .persistent()
            .set(&deal_count_key, &(current_count + 1));

        // Update user indices for from and to addresses
        if let Some(ref from_addr) = receipt.from {
            let user_count_key = StorageKey::UserCount(from_addr.clone());
            let user_count: u32 = env.storage().persistent().get(&user_count_key).unwrap_or(0);
            env.storage().persistent().set(
                &StorageKey::UserIndex(from_addr.clone(), user_count),
                &tx_id,
            );
            env.storage()
                .persistent()
                .set(&user_count_key, &(user_count + 1));
        }

        if let Some(ref to_addr) = receipt.to {
            let user_count_key = StorageKey::UserCount(to_addr.clone());
            let user_count: u32 = env.storage().persistent().get(&user_count_key).unwrap_or(0);
            env.storage()
                .persistent()
                .set(&StorageKey::UserIndex(to_addr.clone(), user_count), &tx_id);
            env.storage()
                .persistent()
                .set(&user_count_key, &(user_count + 1));
        }

        // Emit event with topic ("receipt", tx_id) and receipt payload
        env.events().publish(
            (
                Symbol::new(&env, "transaction_receipt"),
                Symbol::new(&env, "receipt_recorded"),
                tx_id.clone(),
            ),
            receipt,
        );

        Ok(tx_id)
    }

    /// Retrieve a receipt by transaction ID
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `tx_id` - The transaction ID to look up
    ///
    /// # Returns
    /// * `Some(Receipt)` - If the receipt exists
    /// * `None` - If the receipt does not exist
    ///
    /// # Requirements
    /// * Returns complete receipt if exists (Requirement 8.1, 8.3)
    /// * Returns None for non-existent tx_id (Requirement 8.2)
    /// * No authorization required (public read)
    pub fn get_receipt(env: soroban_sdk::Env, tx_id: BytesN<32>) -> Option<Receipt> {
        env.storage().persistent().get(&StorageKey::Receipt(tx_id))
    }

    /// List all receipts for a specific deal with pagination
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `deal_id` - The deal identifier to query
    /// * `limit` - Maximum number of receipts to return
    /// * `cursor` - Optional starting index for pagination (default: 0)
    ///
    /// # Returns
    /// * `Vec<Receipt>` - Vector of receipts matching the deal_id
    ///
    /// # Requirements
    /// * Returns receipts matching deal_id (Requirement 9.1)
    /// * Supports pagination (Requirements 9.2, 9.4, 9.5)
    /// * Returns receipts in deterministic order (Requirement 9.3)
    /// * No authorization required (public read)
    pub fn list_receipts_by_deal(
        env: soroban_sdk::Env,
        deal_id: String,
        limit: u32,
        cursor: Option<u32>,
    ) -> soroban_sdk::Vec<Receipt> {
        use soroban_sdk::Vec;

        let mut results = Vec::new(&env);

        // Get total count of receipts for this deal
        let deal_count_key = StorageKey::DealCount(deal_id.clone());
        let total_count: u32 = env.storage().persistent().get(&deal_count_key).unwrap_or(0);

        // Calculate start index from cursor (default 0)
        let start_index = cursor.unwrap_or(0);

        // Calculate end index (start + limit, capped at total_count)
        let end_index = core::cmp::min(start_index + limit, total_count);

        // Iterate through deal index to load receipts
        for index in start_index..end_index {
            let deal_index_key = StorageKey::DealIndex(deal_id.clone(), index);

            // Load tx_id from deal index
            if let Some(tx_id) = env
                .storage()
                .persistent()
                .get::<StorageKey, BytesN<32>>(&deal_index_key)
            {
                // Load receipt for this tx_id
                if let Some(receipt) = env
                    .storage()
                    .persistent()
                    .get::<StorageKey, Receipt>(&StorageKey::Receipt(tx_id))
                {
                    results.push_back(receipt);
                }
            }
        }

        results
    }

    /// List receipts for a specific user with pagination
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `user` - The user address (from or to)
    /// * `limit` - Maximum number of receipts to return
    /// * `cursor` - Optional starting index for pagination
    ///
    /// # Returns
    /// A vector of receipts for the user, starting from cursor (or 0) up to limit
    pub fn list_receipts_by_user(
        env: soroban_sdk::Env,
        user: Address,
        limit: u32,
        cursor: Option<u32>,
    ) -> soroban_sdk::Vec<Receipt> {
        use soroban_sdk::Vec;

        let mut results = Vec::new(&env);

        let user_count_key = StorageKey::UserCount(user.clone());
        let total_count: u32 = env.storage().persistent().get(&user_count_key).unwrap_or(0);

        let start_index = cursor.unwrap_or(0);
        let end_index = core::cmp::min(start_index + limit, total_count);

        for index in start_index..end_index {
            let user_index_key = StorageKey::UserIndex(user.clone(), index);

            if let Some(tx_id) = env
                .storage()
                .persistent()
                .get::<StorageKey, BytesN<32>>(&user_index_key)
            {
                if let Some(receipt) = env
                    .storage()
                    .persistent()
                    .get::<StorageKey, Receipt>(&StorageKey::Receipt(tx_id))
                {
                    results.push_back(receipt);
                }
            }
        }

        results
    }
}

#[contractimpl]
impl Pausable for TransactionReceiptContract {
    fn pause(env: soroban_sdk::Env, admin: Address) -> Result<(), PausableError> {
        if require_admin(&env, &admin).is_err() {
            return Err(PausableError::NotAuthorized);
        }
        env.storage().instance().set(&StorageKey::Paused, &true);
        env.events().publish(
            (Symbol::new(&env, "Pausable"), Symbol::new(&env, "pause")),
            (),
        );
        Ok(())
    }

    fn unpause(env: soroban_sdk::Env, admin: Address) -> Result<(), PausableError> {
        if require_admin(&env, &admin).is_err() {
            return Err(PausableError::NotAuthorized);
        }
        env.storage().instance().set(&StorageKey::Paused, &false);
        env.events().publish(
            (Symbol::new(&env, "Pausable"), Symbol::new(&env, "unpause")),
            (),
        );
        Ok(())
    }

    fn is_paused(env: soroban_sdk::Env) -> bool {
        env.storage()
            .instance()
            .get::<_, bool>(&StorageKey::Paused)
            .unwrap_or(false)
    }
}

/// Helper function to verify that the caller is the admin
///
/// # Arguments
/// * `env` - The Soroban environment
/// * `caller` - The address attempting the operation
///
/// # Returns
/// * `Ok(())` - If the caller is the admin
/// * `Err(ContractError::NotAuthorized)` - If the caller is not the admin
fn require_admin(env: &soroban_sdk::Env, caller: &Address) -> Result<(), ContractError> {
    // Load admin address from storage
    let admin: Address = env
        .storage()
        .instance()
        .get(&StorageKey::Admin)
        .unwrap_or_else(|| panic!("Admin not initialized"));

    // Verify caller is admin
    if caller != &admin {
        return Err(ContractError::NotAuthorized);
    }

    Ok(())
}

/// Helper function to verify that the caller is the operator
///
/// # Arguments
/// * `env` - The Soroban environment
/// * `caller` - The address attempting the operation
///
/// # Returns
/// * `Ok(())` - If the caller is the operator
/// * `Err(ContractError::NotAuthorized)` - If the caller is not the operator
fn require_operator(env: &soroban_sdk::Env, caller: &Address) -> Result<(), ContractError> {
    // Load operator address from storage
    let operator: Address = env
        .storage()
        .instance()
        .get(&StorageKey::Operator)
        .unwrap_or_else(|| panic!("Operator not initialized"));

    // Verify caller is operator
    if caller != &operator {
        return Err(ContractError::NotAuthorized);
    }

    Ok(())
}

/// Helper function to verify that the contract is not paused
///
/// # Arguments
/// * `env` - The Soroban environment
///
/// # Returns
/// * `Ok(())` - If the contract is not paused
/// * `Err(ContractError::Paused)` - If the contract is paused
fn require_not_paused(env: &soroban_sdk::Env) -> Result<(), ContractError> {
    // Load paused state from storage (defaults to false if not set)
    let paused: bool = env
        .storage()
        .instance()
        .get(&StorageKey::Paused)
        .unwrap_or(false);

    // Return error if contract is paused
    if paused {
        return Err(ContractError::Paused);
    }

    Ok(())
}

/// Helper function to validate transaction type against allowed list
///
/// # Arguments
/// * `tx_type` - The transaction type to validate
///
/// # Returns
/// * `Ok(())` - If the transaction type is valid
/// * `Err(ContractError::InvalidTxType)` - If the transaction type is not in allowed list
fn validate_tx_type(tx_type: &Symbol) -> Result<(), ContractError> {
    use alloc::string::ToString;

    let tx_type_str = tx_type.to_string();

    if !ALLOWED_TX_TYPES.contains(&tx_type_str.as_str()) {
        return Err(ContractError::InvalidTxType);
    }

    Ok(())
}

/// Helper function to generate a deterministic transaction ID from external payment references
///
/// # Arguments
/// * `env` - The Soroban environment
/// * `external_ref_source` - The payment source (must be in ALLOWED_SOURCES)
/// * `external_ref` - The external payment reference string
///
/// # Returns
/// * `Ok(BytesN<32>)` - SHA-256 hash of the canonical external reference string
/// * `Err(ContractError)` - If validation fails
///
/// # Validation Rules
/// * external_ref_source must be in ALLOWED_SOURCES (case-insensitive)
/// * external_ref must not be empty after trimming
/// * external_ref must not contain pipe character (|)
/// * external_ref must not exceed 256 characters
///
/// # Canonical Format
/// The canonical string format is: "v1|source=<lowercased_trimmed_source>|ref=<trimmed_ref>"
fn generate_tx_id(
    env: &soroban_sdk::Env,
    external_ref_source: &Symbol,
    external_ref: &String,
) -> Result<BytesN<32>, ContractError> {
    use soroban_sdk::Bytes;

    // Convert Symbol to string for validation
    // We need to use the alloc feature for string manipulation
    extern crate alloc;
    use alloc::string::String as StdString;
    use alloc::string::ToString;

    let source_str: StdString = external_ref_source.to_string();
    let source_trimmed = source_str.trim();
    let source_lower = source_trimmed.to_lowercase();

    // Validate external_ref_source against ALLOWED_SOURCES
    if !ALLOWED_SOURCES.contains(&source_lower.as_str()) {
        return Err(ContractError::InvalidExternalRefSource);
    }

    // Get the external_ref as a string and trim it
    let ref_str: StdString = external_ref.to_string();
    let ref_trimmed = ref_str.trim();

    // Validate external_ref is not empty after trimming
    if ref_trimmed.is_empty() {
        return Err(ContractError::InvalidExternalRef);
    }

    // Validate external_ref does not contain pipe character
    if ref_trimmed.contains('|') {
        return Err(ContractError::InvalidExternalRef);
    }

    // Validate external_ref does not exceed 256 characters
    if ref_trimmed.len() > 256 {
        return Err(ContractError::InvalidExternalRef);
    }

    // Construct canonical string: "v1|source=<lowercased_trimmed_source>|ref=<trimmed_ref>"
    use alloc::format;
    let canonical = format!("v1|source={}|ref={}", source_lower, ref_trimmed);

    // Convert to Bytes for hashing
    let canonical_bytes = Bytes::from_slice(env, canonical.as_bytes());

    // Compute SHA-256 hash using Soroban's crypto module
    let hash = env.crypto().sha256(&canonical_bytes);

    Ok(hash.into())
}

mod integration_tests;
mod test;
