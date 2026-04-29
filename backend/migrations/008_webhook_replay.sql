-- Webhook events table for persistence and replay
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(100) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  external_id VARCHAR(255) NOT NULL,
  payload JSONB NOT NULL,
  headers JSONB,
  received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE,
  processing_status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, processed, failed
  processing_error TEXT,
  UNIQUE(provider, external_id)
);

-- Index for efficient querying
CREATE INDEX idx_webhook_events_provider ON webhook_events(provider);
CREATE INDEX idx_webhook_events_event_type ON webhook_events(event_type);
CREATE INDEX idx_webhook_events_received_at ON webhook_events(received_at);
CREATE INDEX idx_webhook_events_status ON webhook_events(processing_status);

-- Webhook replay attempts table for audit trail
CREATE TABLE IF NOT EXISTS webhook_replay_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_event_id UUID NOT NULL REFERENCES webhook_events(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL,
  actor_type VARCHAR(50) NOT NULL, -- admin, operator, system
  reason TEXT NOT NULL,
  dry_run BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, success, failed
  outcome JSONB,
  error_message TEXT,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Index for audit queries
CREATE INDEX idx_webhook_replay_attempts_event_id ON webhook_replay_attempts(webhook_event_id);
CREATE INDEX idx_webhook_replay_attempts_actor ON webhook_replay_attempts(actor_user_id);
CREATE INDEX idx_webhook_replay_attempts_started_at ON webhook_replay_attempts(started_at);
