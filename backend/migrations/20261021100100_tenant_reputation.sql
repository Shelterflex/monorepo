-- Tenant reputation score cache and RBAC permissions — issue #1980.
--
-- tenant_reputation_scores holds the last-published computed reputation record
-- per tenant. It is a local deduplication cache: the outbox item and the
-- on-chain contract are the authoritative source of truth. The store is updated
-- on every sync; an outbox item is only enqueued when the recomputed record
-- differs from the row here.
--
-- All score columns are INTEGER NOT NULL CHECK (...BETWEEN 0 AND 100).

CREATE TABLE IF NOT EXISTS tenant_reputation_scores (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           TEXT        NOT NULL,
    composite_score     INTEGER     NOT NULL CHECK (composite_score     BETWEEN 0 AND 100),
    payment_score       INTEGER     NOT NULL CHECK (payment_score       BETWEEN 0 AND 100),
    property_care_score INTEGER     NOT NULL CHECK (property_care_score BETWEEN 0 AND 100),
    communication_score INTEGER     NOT NULL CHECK (communication_score BETWEEN 0 AND 100),
    total_ratings       INTEGER     NOT NULL DEFAULT 0 CHECK (total_ratings >= 0),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tenant_reputation_scores_tenant_id_unique UNIQUE (tenant_id)
);

CREATE INDEX IF NOT EXISTS tenant_reputation_scores_tenant_id_idx
    ON tenant_reputation_scores (tenant_id);

CREATE INDEX IF NOT EXISTS tenant_reputation_scores_updated_at_idx
    ON tenant_reputation_scores (updated_at DESC);

-- RBAC permissions for the admin reputation endpoints.
-- reputation:manage is required for GET /admin/reputation,
-- GET /admin/reputation/:tenantId, and POST /admin/reputation/:tenantId/sync.
-- operations and finance roles can view and trigger syncs; super_admin is implicit.
INSERT INTO permissions (resource, action) VALUES
    ('reputation', 'manage')
ON CONFLICT (resource, action) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name IN ('operations', 'finance')
  AND p.resource = 'reputation'
  AND p.action   = 'manage'
ON CONFLICT DO NOTHING;
