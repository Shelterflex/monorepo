-- Migration: 024_sessions_device_tracking.sql
-- Description: Enhanced session management with device fingerprinting,
--              concurrent session limits, activity tracking, and forced logout.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS device_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS ip_hash            TEXT,
  ADD COLUMN IF NOT EXISTS user_agent         TEXT,
  ADD COLUMN IF NOT EXISTS last_active_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS forced_logout_at   TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_sessions_user_active
  ON sessions(user_id, revoked_at, forced_logout_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_sessions_last_active
  ON sessions(last_active_at);
