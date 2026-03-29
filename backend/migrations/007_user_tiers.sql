-- Migration to add user tiers and quotas
-- Addresses requirement: "Implement sophisticated rate limiting with user quotas and dynamic limits."

-- Add tier and plan_quota columns to users table
ALTER TABLE users ADD COLUMN tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'enterprise'));
ALTER TABLE users ADD COLUMN plan_quota INTEGER NOT NULL DEFAULT 1000;

-- Comments for documentation
COMMENT ON COLUMN users.tier IS 'Subscription tier of the user (free, pro, enterprise)';
COMMENT ON COLUMN users.plan_quota IS 'Daily or per-window request quota for the user';
