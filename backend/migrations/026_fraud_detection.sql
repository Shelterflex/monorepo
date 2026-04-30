-- Fraud signal registry table
CREATE TABLE IF NOT EXISTS fraud_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  signal_type VARCHAR(50) NOT NULL, -- 'rule', 'threshold', 'pattern'
  config JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT true,
  score_weight INTEGER NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fraud_signals_enabled
  ON fraud_signals (enabled) WHERE enabled = true;

-- Fraud assessment records
CREATE TABLE IF NOT EXISTS fraud_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(50) NOT NULL, -- 'account', 'payment', 'transaction'
  entity_id VARCHAR(255) NOT NULL,
  total_score INTEGER NOT NULL,
  risk_level VARCHAR(50) NOT NULL, -- 'low', 'medium', 'high', 'critical'
  action_taken VARCHAR(50), -- 'none', 'hold', 'block', 'review_queue'
  signal_matches JSONB NOT NULL DEFAULT '[]',
  context JSONB NOT NULL DEFAULT '{}',
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fraud_assessments_entity
  ON fraud_assessments (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_fraud_assessments_risk_level
  ON fraud_assessments (risk_level);
CREATE INDEX IF NOT EXISTS idx_fraud_assessments_assessed_at
  ON fraud_assessments (assessed_at DESC);

-- Account holds triggered by fraud detection
CREATE TABLE IF NOT EXISTS fraud_account_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id VARCHAR(255) NOT NULL,
  assessment_id UUID NOT NULL REFERENCES fraud_assessments(id) ON DELETE CASCADE,
  hold_type VARCHAR(50) NOT NULL, -- 'full', 'partial', 'transaction_limit'
  hold_reason TEXT NOT NULL,
  released_at TIMESTAMPTZ,
  released_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fraud_account_holds_account
  ON fraud_account_holds (account_id);
CREATE INDEX IF NOT EXISTS idx_fraud_account_holds_active
  ON fraud_account_holds (account_id) WHERE released_at IS NULL;
