-- Migration: 009_outbox_dead_status.sql
-- Description: Add 'dead' status to outbox_items constraint for dead-letter queue support
-- Related: Issue #436 - Outbox pattern reliability improvements

-- Step 1: Drop the existing CHECK constraint on status
-- (The constraint name varies by environment; find and drop it dynamically)
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname
  INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE rel.relname = 'outbox_items'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE outbox_items DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

-- Step 2: Add the updated CHECK constraint that includes 'dead'
ALTER TABLE outbox_items
  ADD CONSTRAINT outbox_items_status_check
  CHECK (status IN ('pending', 'sent', 'failed', 'dead'));

-- Step 3: Add index for dead-letter items for admin monitoring
CREATE INDEX IF NOT EXISTS idx_outbox_dead_items
  ON outbox_items(updated_at DESC)
  WHERE status = 'dead';

-- Step 4: Add index for failed items pending retry
CREATE INDEX IF NOT EXISTS idx_outbox_failed_retry
  ON outbox_items(next_retry_at ASC)
  WHERE status = 'failed';
