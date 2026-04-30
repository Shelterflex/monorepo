-- Landlord Payout Schedule
-- Stores scheduled payouts with deductions, delay reasons, and channel info

CREATE TABLE IF NOT EXISTS landlord_payouts (
  id VARCHAR(128) PRIMARY KEY DEFAULT CONCAT('PAY-', EXTRACT(EPOCH FROM NOW())::bigint, '-', nextval('landlord_payouts_seq')),
  landlord_id VARCHAR(128) NOT NULL,
  property_id VARCHAR(128) NOT NULL,
  property_name VARCHAR(255) NOT NULL,
  scheduled_date TIMESTAMPTZ NOT NULL,
  completed_date TIMESTAMPTZ,
  gross_amount NUMERIC(12,2) NOT NULL CHECK (gross_amount >= 0),
  deductions JSONB NOT NULL DEFAULT '[]',
  net_amount NUMERIC(12,2) NOT NULL CHECK (net_amount >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','processing','completed','delayed','failed','on_hold')),
  channel VARCHAR(20) NOT NULL DEFAULT 'bank_transfer' CHECK (channel IN ('bank_transfer','mobile_money','crypto_wallet','check')),
  delay_reasons JSONB NOT NULL DEFAULT '[]',
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS landlord_payouts_seq;

CREATE INDEX IF NOT EXISTS idx_landlord_payouts_landlord_id ON landlord_payouts (landlord_id);
CREATE INDEX IF NOT EXISTS idx_landlord_payouts_property_id ON landlord_payouts (property_id);
CREATE INDEX IF NOT EXISTS idx_landlord_payouts_status ON landlord_payouts (status);
CREATE INDEX IF NOT EXISTS idx_landlord_payouts_scheduled_date ON landlord_payouts (scheduled_date);
CREATE INDEX IF NOT EXISTS idx_landlord_payouts_channel ON landlord_payouts (channel);
