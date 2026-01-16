-- ============================================================================
-- KEEPA API ENHANCEMENTS
-- Adds FBA-specific pricing, stats parameter support, and account balance tracking
-- ============================================================================

-- Add FBA price column to keepa_metrics_daily for better margin analysis
ALTER TABLE keepa_metrics_daily
ADD COLUMN IF NOT EXISTS fba_price_pence integer;

-- Add FBM price column for completeness
ALTER TABLE keepa_metrics_daily
ADD COLUMN IF NOT EXISTS fbm_price_pence integer;

-- Add Keepa account balance tracking table
CREATE TABLE IF NOT EXISTS keepa_account_balance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  tokens_left integer NOT NULL,
  refill_rate integer,                    -- Tokens per minute from subscription
  refill_in_ms integer,                   -- Milliseconds until next refill
  token_flow_reduction numeric(10,2),     -- Reduction due to tracking
  request_endpoint text,                  -- Which endpoint triggered this record
  created_at timestamptz DEFAULT now()
);

-- Index for time-based queries on account balance
CREATE INDEX IF NOT EXISTS idx_keepa_account_balance_recorded_at
  ON keepa_account_balance(recorded_at DESC);

-- Add stats columns to keepa_metrics_daily for price statistics
-- These come from the free &stats=90 parameter
ALTER TABLE keepa_metrics_daily
ADD COLUMN IF NOT EXISTS stats_min_price_90d integer;

ALTER TABLE keepa_metrics_daily
ADD COLUMN IF NOT EXISTS stats_max_price_90d integer;

ALTER TABLE keepa_metrics_daily
ADD COLUMN IF NOT EXISTS stats_avg_price_90d integer;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN keepa_metrics_daily.fba_price_pence IS 'FBA-specific price from csv[10] (NEW_FBA)';
COMMENT ON COLUMN keepa_metrics_daily.fbm_price_pence IS 'FBM price with shipping from csv[7] (NEW_FBM_SHIPPING)';
COMMENT ON COLUMN keepa_metrics_daily.stats_min_price_90d IS 'Minimum Buy Box price over last 90 days (from stats parameter)';
COMMENT ON COLUMN keepa_metrics_daily.stats_max_price_90d IS 'Maximum Buy Box price over last 90 days (from stats parameter)';
COMMENT ON COLUMN keepa_metrics_daily.stats_avg_price_90d IS 'Average Buy Box price over last 90 days (from stats parameter)';

COMMENT ON TABLE keepa_account_balance IS 'Tracks actual Keepa account token balance from API responses';
