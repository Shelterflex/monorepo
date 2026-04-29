-- Underwriting Decision Traces Table
-- Stores audit trail of underwriting decisions for transparency and recalibration

CREATE TABLE IF NOT EXISTS underwriting_decision_traces (
  id TEXT PRIMARY KEY DEFAULT ('TRACE-' || EXTRACT(EPOCH FROM NOW())::BIGINT || '-' || floor(random() * 1000)::INT),
  application_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('APPROVE', 'REVIEW', 'REJECT')),
  total_score NUMERIC(10, 2) NOT NULL,
  max_score NUMERIC(10, 2) NOT NULL,
  triggered_rules JSONB NOT NULL,
  decision_reason TEXT NOT NULL,
  rule_config_version TEXT NOT NULL,
  evaluated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_underwriting_decision_traces_application_id ON underwriting_decision_traces(application_id);
CREATE INDEX IF NOT EXISTS idx_underwriting_decision_traces_user_id ON underwriting_decision_traces(user_id);
CREATE INDEX IF NOT EXISTS idx_underwriting_decision_traces_decision ON underwriting_decision_traces(decision);
CREATE INDEX IF NOT EXISTS idx_underwriting_decision_traces_created_at ON underwriting_decision_traces(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_underwriting_decision_traces_user_decision ON underwriting_decision_traces(user_id, decision);

-- Comments
COMMENT ON TABLE underwriting_decision_traces IS 'Audit trail of underwriting decisions for tenant applications';
COMMENT ON COLUMN underwriting_decision_traces.id IS 'Unique trace identifier';
COMMENT ON COLUMN underwriting_decision_traces.application_id IS 'Associated tenant application ID';
COMMENT ON COLUMN underwriting_decision_traces.user_id IS 'User who submitted the application';
COMMENT ON COLUMN underwriting_decision_traces.decision IS 'Underwriting decision: APPROVE, REVIEW, or REJECT';
COMMENT ON COLUMN underwriting_decision_traces.total_score IS 'Total score achieved from rule evaluation';
COMMENT ON COLUMN underwriting_decision_traces.max_score IS 'Maximum possible score for the rule configuration';
COMMENT ON COLUMN underwriting_decision_traces.triggered_rules IS 'JSON array of all rule evaluations with details';
COMMENT ON COLUMN underwriting_decision_traces.decision_reason IS 'Human-readable explanation of the decision';
COMMENT ON COLUMN underwriting_decision_traces.rule_config_version IS 'Version of the rule configuration used for evaluation';
COMMENT ON COLUMN underwriting_decision_traces.evaluated_at IS 'Timestamp when the underwriting evaluation was performed';
