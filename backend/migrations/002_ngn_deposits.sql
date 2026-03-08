CREATE TABLE ngn_deposits (
    deposit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    amount_ngn BIGINT NOT NULL,
    rail TEXT NOT NULL,
    external_ref_source TEXT,
    external_ref TEXT,
    redirect_url TEXT,
    bank_details JSONB,
    idempotency_key TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ngn_deposits_user_id_idx ON ngn_deposits (user_id);
CREATE INDEX ngn_deposits_status_idx ON ngn_deposits (status);

CREATE UNIQUE INDEX ngn_deposits_idempotency_uidx
ON ngn_deposits (user_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX ngn_deposits_external_ref_uidx
ON ngn_deposits (external_ref_source, external_ref)
WHERE external_ref_source IS NOT NULL AND external_ref IS NOT NULL;
