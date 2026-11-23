-- Account erasure runs request -> confirm -> grace period -> anonymization (#2053).
-- 'scheduled' is a confirmed request inside its grace window: it can still be cancelled.

ALTER TABLE erasure_requests DROP CONSTRAINT IF EXISTS erasure_requests_status_check;
ALTER TABLE erasure_requests
  ADD CONSTRAINT erasure_requests_status_check
  CHECK (status IN ('pending', 'scheduled', 'completed', 'cancelled', 'expired'));

ALTER TABLE erasure_requests ADD COLUMN IF NOT EXISTS grace_ends_at TIMESTAMPTZ;
ALTER TABLE erasure_requests ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- At most one open (pending or scheduled) request per user.
CREATE UNIQUE INDEX IF NOT EXISTS erasure_requests_one_open_per_user_uidx
  ON erasure_requests (user_id)
  WHERE status IN ('pending', 'scheduled');
