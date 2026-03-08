-- Migration: 003_receipt_indexer.sql
-- Description: Tables for receipt indexing and checkpointing

CREATE TABLE IF NOT EXISTS indexed_receipts (
    tx_id TEXT PRIMARY KEY,
    tx_type TEXT NOT NULL,
    deal_id TEXT NOT NULL,
    listing_id TEXT,
    amount_usdc TEXT NOT NULL,
    amount_ngn NUMERIC,
    fx_rate NUMERIC,
    fx_provider TEXT,
    sender TEXT,
    receiver TEXT,
    external_ref_hash TEXT NOT NULL,
    metadata_hash TEXT,
    ledger BIGINT NOT NULL,
    indexed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_receipts_deal_id ON indexed_receipts(deal_id);
CREATE INDEX idx_receipts_tx_type ON indexed_receipts(tx_type);
CREATE INDEX idx_receipts_ledger ON indexed_receipts(ledger);
CREATE INDEX idx_receipts_indexed_at ON indexed_receipts(indexed_at);

CREATE TABLE IF NOT EXISTS indexer_checkpoint (
    name TEXT PRIMARY KEY,
    last_ledger BIGINT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Seed with default name
INSERT INTO indexer_checkpoint (name, last_ledger)
VALUES ('receipt_indexer', 0)
ON CONFLICT DO NOTHING;
