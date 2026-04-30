-- Add lease-based deduplication to scheduled_jobs
ALTER TABLE scheduled_jobs
  ADD COLUMN IF NOT EXISTS lease_holder VARCHAR(255),
  ADD COLUMN IF NOT EXISTS lease_acquired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

-- Create index for lease queries
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_lease
  ON scheduled_jobs (lease_expires_at)
  WHERE lease_holder IS NOT NULL;

-- Create job_run_history table for execution tracking
CREATE TABLE IF NOT EXISTS job_run_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES scheduled_jobs(id) ON DELETE CASCADE,
  job_name VARCHAR(255) NOT NULL,
  handler VARCHAR(255) NOT NULL,
  worker_id VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL, -- 'started', 'completed', 'failed'
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  error_message TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_run_history_job_id
  ON job_run_history (job_id);
CREATE INDEX IF NOT EXISTS idx_job_run_history_started_at
  ON job_run_history (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_run_history_status
  ON job_run_history (status);
