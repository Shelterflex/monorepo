-- Audit Log Migration
-- Addresses issue #457: Comprehensive audit logging with tamper detection
--
-- Design:
--   - Append-only: UPDATE and DELETE are blocked at the DB rule level
--   - Hash chaining: each row stores the HMAC of its content and a pointer
--     to the previous row's hash, making any retrospective tampering detectable
--   - Archival: old rows can be moved to audit_log_archive without loss of the
--     integrity chain (the archive table has the same schema)

-- AUDIT_LOG TABLE
CREATE TABLE audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type      TEXT        NOT NULL,
    actor_type      TEXT        NOT NULL CHECK (actor_type IN ('user', 'admin', 'system')),
    user_id         TEXT,                       -- nullable for unauthenticated events
    request_id      TEXT,
    ip_address      TEXT,
    http_method     TEXT,
    http_path       TEXT,
    metadata        JSONB       NOT NULL DEFAULT '{}',
    prev_hash       TEXT        NOT NULL,       -- hash of the previous row, or 'GENESIS'
    event_hash      TEXT        NOT NULL,       -- HMAC-SHA256 of this row's canonical payload
    chain_hash      TEXT        NOT NULL,       -- HMAC-SHA256(event_hash || prev_hash)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent any modification or deletion after insert
CREATE RULE audit_log_no_update AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE audit_log_no_delete AS ON DELETE TO audit_log DO INSTEAD NOTHING;

-- Indexes for search / filter queries
CREATE INDEX audit_log_event_type_idx  ON audit_log (event_type);
CREATE INDEX audit_log_user_id_idx     ON audit_log (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX audit_log_actor_type_idx  ON audit_log (actor_type);
CREATE INDEX audit_log_created_at_idx  ON audit_log (created_at DESC);
CREATE INDEX audit_log_request_id_idx  ON audit_log (request_id) WHERE request_id IS NOT NULL;

-- AUDIT_LOG_ARCHIVE TABLE (same schema, used for retention archival)
CREATE TABLE audit_log_archive (
    id              UUID PRIMARY KEY,
    event_type      TEXT        NOT NULL,
    actor_type      TEXT        NOT NULL,
    user_id         TEXT,
    request_id      TEXT,
    ip_address      TEXT,
    http_method     TEXT,
    http_path       TEXT,
    metadata        JSONB       NOT NULL DEFAULT '{}',
    prev_hash       TEXT        NOT NULL,
    event_hash      TEXT        NOT NULL,
    chain_hash      TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL,
    archived_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Archive table is also append-only
CREATE RULE audit_log_archive_no_update AS ON UPDATE TO audit_log_archive DO INSTEAD NOTHING;
CREATE RULE audit_log_archive_no_delete AS ON DELETE TO audit_log_archive DO INSTEAD NOTHING;

CREATE INDEX audit_log_archive_created_at_idx ON audit_log_archive (created_at DESC);
CREATE INDEX audit_log_archive_event_type_idx ON audit_log_archive (event_type);

-- Function: archive audit log rows older than retention_days
-- Moves rows from audit_log to audit_log_archive and removes them from the live table
-- via a direct DELETE bypass (executed as superuser or role with BYPASSRLS).
-- This function must be called explicitly (e.g. from a maintenance job).
CREATE OR REPLACE FUNCTION archive_audit_log(retention_days INTEGER DEFAULT 90)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    archived_count INTEGER;
    cutoff TIMESTAMPTZ := NOW() - (retention_days || ' days')::INTERVAL;
BEGIN
    -- Copy rows to archive
    INSERT INTO audit_log_archive
        (id, event_type, actor_type, user_id, request_id, ip_address,
         http_method, http_path, metadata, prev_hash, event_hash, chain_hash, created_at)
    SELECT id, event_type, actor_type, user_id, request_id, ip_address,
           http_method, http_path, metadata, prev_hash, event_hash, chain_hash, created_at
    FROM   audit_log
    WHERE  created_at < cutoff
    ON CONFLICT (id) DO NOTHING;

    -- Remove archived rows from the live table
    -- Rules block normal DELETE, so bypass with a direct table scan via a temp table trick
    CREATE TEMP TABLE _audit_ids_to_delete ON COMMIT DROP AS
        SELECT id FROM audit_log WHERE created_at < cutoff;

    DELETE FROM audit_log WHERE id IN (SELECT id FROM _audit_ids_to_delete);

    GET DIAGNOSTICS archived_count = ROW_COUNT;
    RETURN archived_count;
END;
$$;

COMMENT ON TABLE audit_log IS 'Immutable, append-only audit trail for all sensitive operations';
COMMENT ON TABLE audit_log_archive IS 'Archive of audit_log rows past the retention window';
COMMENT ON COLUMN audit_log.prev_hash  IS 'event_hash of the previous row, or the literal string GENESIS for the first row';
COMMENT ON COLUMN audit_log.event_hash IS 'HMAC-SHA256 of the canonical JSON payload of this row';
COMMENT ON COLUMN audit_log.chain_hash IS 'HMAC-SHA256(event_hash || prev_hash) — links the chain';
