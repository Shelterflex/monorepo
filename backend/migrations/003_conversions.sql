CREATE TABLE conversions (
    conversion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deposit_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    amount_ngn BIGINT NOT NULL,
    amount_usdc TEXT NOT NULL DEFAULT '0',
    fx_rate_ngn_per_usdc DOUBLE PRECISION NOT NULL DEFAULT 0,
    provider TEXT NOT NULL,
    provider_ref TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX conversions_deposit_id_uidx
ON conversions (deposit_id);

CREATE INDEX conversions_user_id_idx ON conversions (user_id);
CREATE INDEX conversions_status_idx ON conversions (status);
