-- Persists the payout schedule preference used by the landlord payout UI.
CREATE TABLE IF NOT EXISTS landlord_payout_preferences (
  landlord_id VARCHAR(128) PRIMARY KEY,
  schedule_preference VARCHAR(20) NOT NULL DEFAULT 'monthly'
    CHECK (schedule_preference IN ('activation', 'weekly', 'monthly')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
