-- ============================================================================
-- KEEPA DATA CLEANUP
-- Adds scheduled cleanup functions for unbounded table growth
-- ============================================================================

-- ============================================================================
-- CLEANUP FUNCTIONS
-- These functions can be called via pg_cron or application-level scheduling
-- ============================================================================

-- Clean up old Keepa request logs (keep 30 days)
CREATE OR REPLACE FUNCTION cleanup_keepa_request_log(retention_days integer DEFAULT 30)
RETURNS integer AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM keepa_request_log
  WHERE requested_at < NOW() - (retention_days || ' days')::interval;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RAISE NOTICE 'Cleaned up % old Keepa request log entries (older than % days)', deleted_count, retention_days;

  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Clean up old Keepa account balance records (keep 7 days)
CREATE OR REPLACE FUNCTION cleanup_keepa_account_balance(retention_days integer DEFAULT 7)
RETURNS integer AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM keepa_account_balance
  WHERE recorded_at < NOW() - (retention_days || ' days')::interval;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RAISE NOTICE 'Cleaned up % old Keepa account balance records (older than % days)', deleted_count, retention_days;

  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Combined cleanup function for all Keepa tables
CREATE OR REPLACE FUNCTION cleanup_keepa_data()
RETURNS TABLE(table_name text, records_deleted integer) AS $$
BEGIN
  -- Clean request logs (30 days retention)
  RETURN QUERY
  SELECT 'keepa_request_log'::text, cleanup_keepa_request_log(30);

  -- Clean account balance (7 days retention)
  RETURN QUERY
  SELECT 'keepa_account_balance'::text, cleanup_keepa_account_balance(7);

  -- Clean stale cache entries that expired more than 7 days ago
  DELETE FROM keepa_products_cache
  WHERE expires_at < NOW() - interval '7 days';

  RETURN QUERY
  SELECT 'keepa_products_cache (stale)'::text,
         (SELECT COUNT(*)::integer FROM keepa_products_cache WHERE expires_at < NOW() - interval '7 days');
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON FUNCTION cleanup_keepa_request_log IS 'Removes Keepa request log entries older than specified days (default 30)';
COMMENT ON FUNCTION cleanup_keepa_account_balance IS 'Removes Keepa account balance records older than specified days (default 7)';
COMMENT ON FUNCTION cleanup_keepa_data IS 'Runs all Keepa data cleanup functions with default retention periods';

-- ============================================================================
-- ADD CLEANUP SETTINGS
-- ============================================================================

INSERT INTO keepa_settings (setting_key, setting_value) VALUES
  ('cleanup_request_log_days', '30'),
  ('cleanup_account_balance_days', '7'),
  ('cleanup_stale_cache_days', '7')
ON CONFLICT (setting_key) DO NOTHING;

-- ============================================================================
-- PERFORMANCE INDEXES
-- These indexes optimize the cleanup queries
-- ============================================================================

-- Index for efficient time-based deletion of request logs
CREATE INDEX IF NOT EXISTS idx_keepa_request_log_requested_at
  ON keepa_request_log(requested_at);

-- Index for efficient deletion of stale cache entries
CREATE INDEX IF NOT EXISTS idx_keepa_products_cache_expires_at
  ON keepa_products_cache(expires_at);

-- ============================================================================
-- EXAMPLE USAGE (for cron or scheduled tasks):
--
-- Daily cleanup (recommended to run during off-peak hours):
--   SELECT * FROM cleanup_keepa_data();
--
-- Or individually with custom retention:
--   SELECT cleanup_keepa_request_log(30);  -- Keep 30 days
--   SELECT cleanup_keepa_account_balance(7);  -- Keep 7 days
-- ============================================================================
