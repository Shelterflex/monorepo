-- Migration: 008_timelock_governance.sql
-- Description: Tables for Timelock governance indexing

CREATE TABLE IF NOT EXISTS timelock_transactions (
    tx_hash TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    function_name TEXT NOT NULL,
    args JSONB NOT NULL,
    eta BIGINT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'executed', 'cancelled')),
    queued_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    executed_at TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE,
    ledger_index BIGINT NOT NULL
);

CREATE INDEX idx_timelock_status ON timelock_transactions(status);
CREATE INDEX idx_timelock_eta ON timelock_transactions(eta);

-- Seed checkpoint for the new indexer
INSERT INTO indexer_checkpoint (name, last_ledger)
VALUES ('timelock_indexer', 0)
ON CONFLICT DO NOTHING;
