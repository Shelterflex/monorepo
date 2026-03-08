#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, vec, Address, Env, Symbol, Vec, BytesN,
};

/// Deal ID type - using u64 for simplicity
pub type DealId = u64;

/// Receipt ID type - using u64 for simplicity
pub type ReceiptId = u64;

/// Timestamp type - using u64
pub type Timestamp = u64;

/// Transaction ID type - BytesN<32> for Soroban transaction hashes
pub type TxId = BytesN<32>;

/// Cursor for pagination - contains (timestamp, tx_id) tuple
/// Using BytesN<32> directly for tx_id as it's contract-compatible
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Cursor {
    pub timestamp: Timestamp,
    pub tx_id: TxId, // BytesN<32> is contract-compatible
}

/// Receipt data structure
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Receipt {
    pub id: ReceiptId,
    pub deal_id: DealId,
    pub amount: i128,
    pub timestamp: Timestamp,
    pub tx_id: TxId,
    pub payer: Address,
}

/// Paginated result for list_receipts_by_deal
#[contracttype]
#[derive(Clone, Debug)]
pub struct ReceiptPage {
    pub receipts: Vec<Receipt>,
    pub has_next: bool, // True if there are more receipts
    pub next_cursor: Cursor, // Cursor for next page (only valid if has_next is true)
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Deals,
    Receipts(DealId),
    ReceiptCount(DealId),
}

#[contract]
pub struct RentPayments;

fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<_, Address>(&DataKey::Admin)
        .expect("admin not set")
}

fn require_admin(env: &Env) {
    let admin = get_admin(env);
    admin.require_auth();
}

fn get_receipts(env: &Env, deal_id: DealId) -> Vec<Receipt> {
    env.storage()
        .persistent()
        .get::<_, Vec<Receipt>>(&DataKey::Receipts(deal_id))
        .unwrap_or_else(|| vec![env])
}

fn put_receipts(env: &Env, deal_id: DealId, receipts: Vec<Receipt>) {
    env.storage()
        .persistent()
        .set(&DataKey::Receipts(deal_id), &receipts);
}

fn get_receipt_count(env: &Env, deal_id: DealId) -> ReceiptId {
    env.storage()
        .persistent()
        .get::<_, ReceiptId>(&DataKey::ReceiptCount(deal_id))
        .unwrap_or(0)
}

fn increment_receipt_count(env: &Env, deal_id: DealId) -> ReceiptId {
    let count = get_receipt_count(env, deal_id);
    let new_count = count + 1;
    env.storage()
        .persistent()
        .set(&DataKey::ReceiptCount(deal_id), &new_count);
    new_count
}

fn get_tx_id(env: &Env) -> TxId {
    // In Soroban, we can use the ledger timestamp and sequence to create a unique ID
    // For production, you might want to use the actual transaction hash
    // For now, we'll use a combination of timestamp and sequence number
    let ledger_info = env.ledger();
    let timestamp = ledger_info.timestamp();
    
    // Get a global counter from storage to ensure uniqueness across all receipts
    // Use a special deal_id (u64::MAX) as the key for the global counter
    let global_counter_key = DataKey::ReceiptCount(u64::MAX);
    let counter: u64 = env.storage()
        .persistent()
        .get(&global_counter_key)
        .unwrap_or(0);
    let new_counter = counter.wrapping_add(1);
    env.storage()
        .persistent()
        .set(&global_counter_key, &new_counter);
    
    // Create a deterministic tx_id from timestamp and counter
    // In a real implementation, you'd get this from the actual transaction hash
    let mut bytes = [0u8; 32];
    
    // Convert timestamp (u64) to bytes manually
    let mut ts = timestamp;
    for i in (0..8).rev() {
        bytes[i] = (ts & 0xFF) as u8;
        ts >>= 8;
    }
    
    // Convert counter (u64) to bytes manually  
    let mut cnt = new_counter;
    for i in (8..16).rev() {
        bytes[i] = (cnt & 0xFF) as u8;
        cnt >>= 8;
    }
    
    // Fill remaining bytes with a pattern for uniqueness
    for i in 16..32 {
        bytes[i] = (timestamp as u8).wrapping_add(i as u8);
    }
    
    BytesN::from_array(env, &bytes)
}

#[contractimpl]
impl RentPayments {
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.events().publish((Symbol::new(&env, "init"),), admin);
    }

    /// Create a new receipt for a deal
    /// This function records a monthly payment receipt
    pub fn create_receipt(
        env: Env,
        deal_id: DealId,
        amount: i128,
        payer: Address,
    ) -> Receipt {
        require_admin(&env);
        
        if amount <= 0 {
            panic!("amount must be positive");
        }

        let receipt_id = increment_receipt_count(&env, deal_id);
        let timestamp = env.ledger().timestamp();
        let tx_id = get_tx_id(&env);
        let payer_clone = payer.clone();

        let receipt = Receipt {
            id: receipt_id,
            deal_id,
            amount,
            timestamp,
            tx_id: tx_id.clone(),
            payer: payer_clone.clone(),
        };

        let mut receipts = get_receipts(&env, deal_id);
        receipts.push_back(receipt.clone());
        put_receipts(&env, deal_id, receipts);

        env.events().publish(
            (Symbol::new(&env, "receipt_created"), deal_id),
            (receipt_id, amount, payer_clone),
        );

        receipt
    }

    /// List receipts for a deal with cursor-based pagination
    /// 
    /// # Arguments
    /// * `deal_id` - The deal ID to list receipts for
    /// * `limit` - Maximum number of receipts to return (must be > 0 and <= 100)
    /// * `cursor` - Optional cursor for pagination. If None, starts from the beginning.
    ///              Cursor format: (timestamp, tx_id) tuple
    /// 
    /// # Returns
    /// * `ReceiptPage` containing:
    ///   - `receipts`: Vec of receipts ordered by (timestamp ASC, tx_id ASC)
    ///   - `next_cursor`: Optional cursor for the next page, None if this is the last page
    /// 
    /// # Ordering
    /// Receipts are ordered by:
    /// 1. `timestamp` (ascending)
    /// 2. `tx_id` (ascending, as bytes comparison)
    /// 
    /// This ensures stable, deterministic ordering even if multiple receipts have the same timestamp.
    pub fn list_receipts_by_deal(
        env: Env,
        deal_id: DealId,
        limit: u32,
        cursor: Option<Cursor>,
    ) -> ReceiptPage {
        if limit == 0 || limit > 100 {
            panic!("limit must be between 1 and 100");
        }

        let receipts = get_receipts(&env, deal_id);
        let receipts_len = receipts.len();

        // Convert to a sortable format - we'll need to collect into a Vec for sorting
        // Since Soroban Vec doesn't support sort_by directly, we'll build a sorted Vec
        let mut sorted_receipts = vec![&env];
        
        // Collect all receipts into the sorted Vec
        for i in 0..receipts_len {
            sorted_receipts.push_back(receipts.get(i).unwrap());
        }

        // Sort receipts by (timestamp, tx_id) in ascending order
        // We'll use a simple bubble sort since we can't use sort_by in no_std easily
        // For production, consider using a more efficient algorithm or storing sorted
        if sorted_receipts.len() > 1 {
            let mut swapped = true;
            while swapped {
                swapped = false;
                let len = sorted_receipts.len();
                for i in 0..(len - 1) {
                    let a = sorted_receipts.get(i).unwrap();
                    let b = sorted_receipts.get(i + 1).unwrap();
                    
                    let should_swap = match a.timestamp.cmp(&b.timestamp) {
                        core::cmp::Ordering::Greater => true,
                        core::cmp::Ordering::Equal => {
                            a.tx_id.to_array() > b.tx_id.to_array()
                        }
                        core::cmp::Ordering::Less => false,
                    };
                    
                    if should_swap {
                        sorted_receipts.set(i, b.clone());
                        sorted_receipts.set(i + 1, a.clone());
                        swapped = true;
                    }
                }
            }
        }

        // Find the starting point based on cursor
        let mut start_index = 0u32;
        if let Some(cursor) = cursor {
            let cursor_tx_id_array = cursor.tx_id.to_array();
            
            // Find the first receipt with (timestamp, tx_id) > cursor
            for i in 0..sorted_receipts.len() {
                let r = sorted_receipts.get(i).unwrap();
                let r_tx_id_array = r.tx_id.to_array();
                if r.timestamp > cursor.timestamp
                    || (r.timestamp == cursor.timestamp
                        && r_tx_id_array > cursor_tx_id_array)
                {
                    start_index = i;
                    break;
                }
            }
            // If no receipt found, start_index remains at end
            if start_index == 0 && sorted_receipts.len() > 0 {
                let first = sorted_receipts.get(0).unwrap();
                let first_tx_id_array = first.tx_id.to_array();
                if !(first.timestamp > cursor.timestamp
                    || (first.timestamp == cursor.timestamp
                        && first_tx_id_array > cursor_tx_id_array))
                {
                    start_index = sorted_receipts.len();
                }
            }
        }

        // Extract the page
        let limit_u32 = limit;
        let receipts_len_u32 = sorted_receipts.len();
        let end_index = if start_index + limit_u32 < receipts_len_u32 {
            start_index + limit_u32
        } else {
            receipts_len_u32
        };

        let mut page_receipts = vec![&env];
        for i in start_index..end_index {
            if let Some(receipt) = sorted_receipts.get(i) {
                page_receipts.push_back(receipt.clone());
            }
        }

        // Determine next cursor
        let empty_tx_id = BytesN::from_array(&env, &[0u8; 32]);
        let (has_next, next_cursor) = if end_index < receipts_len_u32 && page_receipts.len() > 0 {
            // There are more receipts, create cursor from the last item in this page
            let last_index = if page_receipts.len() > 0 {
                page_receipts.len() - 1
            } else {
                0
            };
            if let Some(last_receipt) = page_receipts.get(last_index) {
                (true, Cursor {
                    timestamp: last_receipt.timestamp,
                    tx_id: last_receipt.tx_id.clone(),
                })
            } else {
                // Fallback: create empty cursor
                (false, Cursor {
                    timestamp: 0,
                    tx_id: empty_tx_id,
                })
            }
        } else {
            // No more receipts
            (false, Cursor {
                timestamp: 0,
                tx_id: empty_tx_id,
            })
        };

        ReceiptPage {
            receipts: page_receipts,
            has_next,
            next_cursor,
        }
    }

    /// Get the total number of receipts for a deal
    pub fn receipt_count(env: Env, deal_id: DealId) -> u64 {
        get_receipt_count(&env, deal_id)
    }
}

#[cfg(test)]
mod test {
    extern crate std;

    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, MockAuth, MockAuthInvoke},
        Address, BytesN, Env, IntoVal,
    };

    fn setup(env: &Env) -> (Address, RentPaymentsClient<'_>, soroban_sdk::Address) {
        let contract_id = env.register_contract(None, RentPayments);
        // Note: register_contract is deprecated but still works in SDK 22.0.7
        let client = RentPaymentsClient::new(env, &contract_id);
        let admin = Address::generate(env);
        client.init(&admin);
        (admin, client, contract_id)
    }


    #[test]
    fn test_list_receipts_by_deal_empty() {
        let env = Env::default();
        let (_admin, client, _contract_id) = setup(&env);
        let deal_id = 1u64;

        let page = client.list_receipts_by_deal(&deal_id, &10u32, &None);
        assert_eq!(page.receipts.len(), 0);
        assert!(!page.has_next);
    }

    #[test]
    fn test_list_receipts_by_deal_single_page() {
        let env = Env::default();
        let (admin, client, contract_id) = setup(&env);
        let deal_id = 1u64;
        let payer = Address::generate(&env);

        // Create 5 receipts
        for i in 1..=5 {
            env.mock_auths(&[MockAuth {
                address: &admin,
                invoke: &MockAuthInvoke {
                    contract: &contract_id,
                    fn_name: "create_receipt",
                    args: (deal_id, (i * 1000) as i128, payer.clone()).into_val(&env),
                    sub_invokes: &[],
                },
            }]);
            client.create_receipt(&deal_id, &(i * 1000), &payer);
        }

        let page = client.list_receipts_by_deal(&deal_id, &10u32, &None);
        assert_eq!(page.receipts.len(), 5);
        assert!(!page.has_next);
    }

    #[test]
    fn test_list_receipts_by_deal_pagination() {
        let env = Env::default();
        let (admin, client, contract_id) = setup(&env);
        let deal_id = 1u64;
        let payer = Address::generate(&env);

        // Create 15 receipts
        for i in 1..=15 {
            env.mock_auths(&[MockAuth {
                address: &admin,
                invoke: &MockAuthInvoke {
                    contract: &contract_id,
                    fn_name: "create_receipt",
                    args: (deal_id, (i * 1000) as i128, payer.clone()).into_val(&env),
                    sub_invokes: &[],
                },
            }]);
            client.create_receipt(&deal_id, &(i * 1000), &payer);
        }

        // First page: 10 receipts
        let page1 = client.list_receipts_by_deal(&deal_id, &10u32, &None);
        assert_eq!(page1.receipts.len(), 10);
        assert!(page1.has_next);

        // Second page: remaining 5 receipts
        let cursor1 = page1.next_cursor.clone();
        let page2 = client.list_receipts_by_deal(&deal_id, &10u32, &Some(cursor1));
        assert_eq!(page2.receipts.len(), 5);
        assert!(!page2.has_next);

        // Verify no duplicates between pages
        let page1_ids: std::vec::Vec<u64> = page1
            .receipts
            .iter()
            .map(|r| r.id)
            .collect();
        let page2_ids: std::vec::Vec<u64> = page2
            .receipts
            .iter()
            .map(|r| r.id)
            .collect();

        for id in &page1_ids {
            assert!(!page2_ids.contains(id), "Duplicate receipt found: {}", id);
        }
    }

    #[test]
    fn test_list_receipts_by_deal_no_skipping() {
        let env = Env::default();
        let (admin, client, contract_id) = setup(&env);
        let deal_id = 1u64;
        let payer = Address::generate(&env);

        // Create 25 receipts
        for i in 1..=25 {
            env.mock_auths(&[MockAuth {
                address: &admin,
                invoke: &MockAuthInvoke {
                    contract: &contract_id,
                    fn_name: "create_receipt",
                    args: (deal_id, (i * 1000) as i128, payer.clone()).into_val(&env),
                    sub_invokes: &[],
                },
            }]);
            client.create_receipt(&deal_id, &(i * 1000), &payer);
        }

        // Collect all receipts across pages
        let mut all_receipt_ids = std::vec::Vec::new();
        let mut cursor = None;

        loop {
            let page = client.list_receipts_by_deal(&deal_id, &10u32, &cursor);

            for receipt in page.receipts.iter() {
                all_receipt_ids.push(receipt.id);
            }

            if !page.has_next {
                break;
            }
            cursor = Some(page.next_cursor.clone());
        }

        // Verify we got exactly 25 receipts (no skipping)
        assert_eq!(all_receipt_ids.len(), 25);
        
        // Verify all IDs are unique (no duplicates)
        let mut sorted_ids = all_receipt_ids.clone();
        sorted_ids.sort();
        sorted_ids.dedup();
        assert_eq!(sorted_ids.len(), 25, "Found duplicate receipts");
    }

    #[test]
    fn test_list_receipts_by_deal_stable_ordering() {
        let env = Env::default();
        let (admin, client, contract_id) = setup(&env);
        let deal_id = 1u64;
        let payer = Address::generate(&env);

        // Create multiple receipts
        for i in 1..=10 {
            env.mock_auths(&[MockAuth {
                address: &admin,
                invoke: &MockAuthInvoke {
                    contract: &contract_id,
                    fn_name: "create_receipt",
                    args: (deal_id, (i * 1000) as i128, payer.clone()).into_val(&env),
                    sub_invokes: &[],
                },
            }]);
            client.create_receipt(&deal_id, &(i * 1000), &payer);
        }

        // Get all receipts in one call
        let all_page = client.list_receipts_by_deal(&deal_id, &100u32, &None);
        
        // Get receipts in pages and verify ordering is consistent
        let mut cursor = None;
        let mut prev_timestamp = 0u64;
        let mut prev_tx_id: Option<BytesN<32>> = None;

        loop {
            let page = client.list_receipts_by_deal(&deal_id, &3u32, &cursor);
            
            for receipt in page.receipts.iter() {
                // Verify ordering: timestamp should be >= previous
                assert!(
                    receipt.timestamp >= prev_timestamp,
                    "Receipts not in ascending timestamp order"
                );
                
                // If timestamp is equal, tx_id should be >= previous
                if receipt.timestamp == prev_timestamp {
                    if let Some(ref prev) = prev_tx_id {
                        let receipt_array = receipt.tx_id.to_array();
                        let prev_array = prev.to_array();
                        assert!(
                            receipt_array >= prev_array,
                            "Receipts with same timestamp not in ascending tx_id order"
                        );
                    }
                }
                
                prev_timestamp = receipt.timestamp;
                prev_tx_id = Some(receipt.tx_id.clone());
            }

            if !page.has_next {
                break;
            }
            cursor = Some(page.next_cursor.clone());
        }

        // Verify the full list matches the single-page result
        let mut paginated_ids: std::vec::Vec<u64> = std::vec::Vec::new();
        cursor = None;
        loop {
            let page = client.list_receipts_by_deal(&deal_id, &3u32, &cursor);
            for receipt in page.receipts.iter() {
                paginated_ids.push(receipt.id);
            }
            if !page.has_next {
                break;
            }
            cursor = Some(page.next_cursor.clone());
        }

        let all_ids: std::vec::Vec<u64> = all_page.receipts.iter().map(|r| r.id).collect();
        assert_eq!(paginated_ids, all_ids, "Paginated results don't match full results");
    }

    #[test]
    #[should_panic(expected = "limit must be between 1 and 100")]
    fn test_list_receipts_by_deal_invalid_limit_zero() {
        let env = Env::default();
        let (_admin, client, _contract_id) = setup(&env);
        let deal_id = 1u64;

        client.list_receipts_by_deal(&deal_id, &0u32, &None);
    }

    #[test]
    #[should_panic(expected = "limit must be between 1 and 100")]
    fn test_list_receipts_by_deal_invalid_limit_too_large() {
        let env = Env::default();
        let (_admin, client, _contract_id) = setup(&env);
        let deal_id = 1u64;

        client.list_receipts_by_deal(&deal_id, &101u32, &None);
    }

    #[test]
    fn test_list_receipts_by_deal_different_deals() {
        let env = Env::default();
        let (admin, client, contract_id) = setup(&env);
        let payer = Address::generate(&env);

        // Create receipts for deal 1
        for i in 1..=5 {
            env.mock_auths(&[MockAuth {
                address: &admin,
                invoke: &MockAuthInvoke {
                    contract: &contract_id,
                    fn_name: "create_receipt",
                    args: (1u64, (i * 1000) as i128, payer.clone()).into_val(&env),
                    sub_invokes: &[],
                },
            }]);
            client.create_receipt(&1u64, &(i * 1000), &payer);
        }

        // Create receipts for deal 2
        for i in 1..=3 {
            env.mock_auths(&[MockAuth {
                address: &admin,
                invoke: &MockAuthInvoke {
                    contract: &contract_id,
                    fn_name: "create_receipt",
                    args: (2u64, (i * 2000) as i128, payer.clone()).into_val(&env),
                    sub_invokes: &[],
                },
            }]);
            client.create_receipt(&2u64, &(i * 2000), &payer);
        }

        // Verify deal 1 has 5 receipts
        let page1 = client.list_receipts_by_deal(&1u64, &10u32, &None);
        assert_eq!(page1.receipts.len(), 5);

        // Verify deal 2 has 3 receipts
        let page2 = client.list_receipts_by_deal(&2u64, &10u32, &None);
        assert_eq!(page2.receipts.len(), 3);
    }
}
