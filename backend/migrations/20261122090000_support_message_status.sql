-- Triage status for contact-form submissions (issue #2056). Existing rows
-- default to 'new', so the admin list can filter by status from the start.

ALTER TABLE support_messages
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new'
  CHECK (status IN ('new', 'in_progress', 'resolved'));

CREATE INDEX IF NOT EXISTS support_messages_status_created_idx
  ON support_messages (status, created_at DESC);
