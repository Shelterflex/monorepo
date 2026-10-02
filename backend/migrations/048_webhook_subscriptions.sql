-- Webhook subscriptions table
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL,
    target_url TEXT NOT NULL,
    secret TEXT NOT NULL,
    events TEXT[] NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_subscriptions_owner_id ON webhook_subscriptions(owner_id);
CREATE INDEX idx_webhook_subscriptions_active ON webhook_subscriptions(active) WHERE active = true;

-- Webhook delivery logs table
CREATE TABLE IF NOT EXISTS webhook_delivery_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
    event TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('delivered', 'failed', 'permanently_failed')),
    response_code INTEGER,
    response_body TEXT,
    request_id TEXT,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_delivery_logs_subscription_id ON webhook_delivery_logs(subscription_id);
CREATE INDEX idx_webhook_delivery_logs_attempted_at ON webhook_delivery_logs(attempted_at DESC);
CREATE INDEX idx_webhook_delivery_logs_status ON webhook_delivery_logs(status);

-- Cleanup old delivery logs (older than 30 days) - can be run periodically
-- DELETE FROM webhook_delivery_logs WHERE attempted_at < NOW() - INTERVAL '30 days';
