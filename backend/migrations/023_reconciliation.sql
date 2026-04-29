-- Migration: 023_reconciliation.sql
-- Description: Event-sourced payment ledger reconciliation tables

-- Internal ledger movement events (source of truth from our system)
CREATE TABLE IF NOT EXISTS reconciliation_ledger_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      TEXT NOT NULL CHECK (event_type IN ('credit', 'debit')),
  amount_minor    BIGINT NOT NULL CHECK (amount_minor > 0),
  currency        TEXT NOT NULL DEFAULT 'NGN',
  internal_ref    TEXT NOT NULL UNIQUE,
  rail            TEXT NOT NULL,
  user_id         TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'matched', 'unmatched')),
  occurred_at     TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recon_ledger_status      ON reconciliation_ledger_events(status);
CREATE INDEX IF NOT EXISTS idx_recon_ledger_internal_ref ON reconciliation_ledger_events(internal_ref);
CREATE INDEX IF NOT EXISTS idx_recon_ledger_occurred_at ON reconciliation_ledger_events(occurred_at);

-- PSP / provider settlement events (inbound from webhooks or settlement files)
CREATE TABLE IF NOT EXISTS reconciliation_provider_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type        TEXT NOT NULL CHECK (event_type IN ('credit', 'debit')),
  amount_minor      BIGINT NOT NULL CHECK (amount_minor > 0),
  currency          TEXT NOT NULL DEFAULT 'NGN',
  internal_ref      TEXT,
  raw_status        TEXT NOT NULL,
  occurred_at       TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_recon_provider_internal_ref ON reconciliation_provider_events(internal_ref);
CREATE INDEX IF NOT EXISTS idx_recon_provider_occurred_at  ON reconciliation_provider_events(occurred_at);

-- Detected mismatches between ledger and provider
CREATE TABLE IF NOT EXISTS reconciliation_mismatches (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mismatch_class          TEXT NOT NULL CHECK (mismatch_class IN (
                            'missing_credit', 'duplicate_debit',
                            'amount_mismatch', 'delayed_settlement'
                          )),
  ledger_event_id         UUID REFERENCES reconciliation_ledger_events(id),
  provider_event_id       UUID REFERENCES reconciliation_provider_events(id),
  expected_amount_minor   BIGINT,
  actual_amount_minor     BIGINT,
  tolerance_minor         BIGINT NOT NULL DEFAULT 0,
  status                  TEXT NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open', 'auto_resolved', 'escalated', 'closed')),
  resolution_workflow     TEXT,
  resolution_attempts     INTEGER NOT NULL DEFAULT 0,
  last_resolution_at      TIMESTAMP WITH TIME ZONE,
  escalated_at            TIMESTAMP WITH TIME ZONE,
  sla_deadline            TIMESTAMP WITH TIME ZONE,
  trace_context           JSONB NOT NULL DEFAULT '{}',
  created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recon_mismatch_status    ON reconciliation_mismatches(status);
CREATE INDEX IF NOT EXISTS idx_recon_mismatch_class     ON reconciliation_mismatches(mismatch_class);
CREATE INDEX IF NOT EXISTS idx_recon_mismatch_sla       ON reconciliation_mismatches(sla_deadline) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_recon_mismatch_created   ON reconciliation_mismatches(created_at);
