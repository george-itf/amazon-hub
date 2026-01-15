-- Migration: 2026-01-15_fixes.sql
-- Addresses HIGH-impact risks identified in system audit:
-- 1. Distributed locks for race condition prevention
-- 2. Margin guardrail enforcement (minimum 10%)
-- 3. Rate limiter state persistence

-- ============================================================================
-- 1. DISTRIBUTED LOCKS TABLE
-- Prevents race conditions in concurrent operations like order imports
-- ============================================================================
CREATE TABLE IF NOT EXISTS distributed_locks (
  id bigserial PRIMARY KEY,
  lock_name text UNIQUE NOT NULL,
  lock_id text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for efficient expired lock cleanup
CREATE INDEX IF NOT EXISTS idx_distributed_locks_expires
  ON distributed_locks(expires_at);

-- Index for lock lookup
CREATE INDEX IF NOT EXISTS idx_distributed_locks_name
  ON distributed_locks(lock_name);

COMMENT ON TABLE distributed_locks IS 'Distributed locks to prevent race conditions in concurrent operations';

-- ============================================================================
-- 2. MARGIN GUARDRAIL ENFORCEMENT
-- Enforce minimum 10% margin at the database level
-- ============================================================================

-- Add CHECK constraint to listing_settings table for min_margin_override
-- This enforces the business rule: minimum margin must be >= 10%
ALTER TABLE listing_settings
  DROP CONSTRAINT IF EXISTS chk_min_margin_guardrail;

ALTER TABLE listing_settings
  ADD CONSTRAINT chk_min_margin_guardrail
  CHECK (min_margin_override IS NULL OR min_margin_override >= 10);

-- Also add constraint to ensure target margin is reasonable (if set, must be >= min margin)
ALTER TABLE listing_settings
  DROP CONSTRAINT IF EXISTS chk_target_margin_gte_min;

ALTER TABLE listing_settings
  ADD CONSTRAINT chk_target_margin_gte_min
  CHECK (
    target_margin_override IS NULL
    OR min_margin_override IS NULL
    OR target_margin_override >= min_margin_override
  );

COMMENT ON CONSTRAINT chk_min_margin_guardrail ON listing_settings
  IS 'Enforce minimum 10% margin guardrail - commercial requirement';

-- ============================================================================
-- 3. RATE LIMITER STATE PERSISTENCE
-- Store rate limiter token buckets in database to survive restarts
-- ============================================================================
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  id bigserial PRIMARY KEY,
  bucket_key text UNIQUE NOT NULL,
  tokens numeric(10,4) NOT NULL DEFAULT 10,
  last_refill timestamptz NOT NULL DEFAULT now(),
  burst_limit integer NOT NULL DEFAULT 10,
  rate_per_second numeric(10,4) NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_key
  ON rate_limit_buckets(bucket_key);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_rate_limit_buckets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rate_limit_buckets_updated_at ON rate_limit_buckets;
CREATE TRIGGER rate_limit_buckets_updated_at
  BEFORE UPDATE ON rate_limit_buckets
  FOR EACH ROW EXECUTE FUNCTION update_rate_limit_buckets_updated_at();

COMMENT ON TABLE rate_limit_buckets IS 'Persistent rate limiter state to survive server restarts';

-- ============================================================================
-- 4. IDEMPOTENCY KEY CLEANUP SUPPORT
-- Add index for efficient cleanup of expired keys
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_cleanup
  ON idempotency_keys(expires_at)
  WHERE expires_at < now();

-- ============================================================================
-- 5. AUDIT: Record migration application
-- ============================================================================
INSERT INTO system_events (event_type, description, severity, metadata)
VALUES (
  'MIGRATION_APPLIED',
  'Applied 2026-01-15_fixes.sql: distributed locks, margin guardrails, rate limit persistence',
  'INFO',
  '{
    "migration": "2026-01-15_fixes.sql",
    "changes": [
      "Created distributed_locks table",
      "Added min_margin_override >= 10% constraint",
      "Created rate_limit_buckets table",
      "Added idempotency cleanup index"
    ]
  }'::jsonb
);
