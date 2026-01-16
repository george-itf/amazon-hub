/**
 * Migration: Add SP-API pricing columns to listing_settings
 * Date: 2026-01-16
 *
 * This migration adds columns to store price and stock data fetched from Amazon SP-API.
 * These fields store the Amazon-reported values, separate from manual overrides.
 */

-- Add SP-API data columns to listing_settings
ALTER TABLE listing_settings
  ADD COLUMN IF NOT EXISTS sp_api_price_pence integer,
  ADD COLUMN IF NOT EXISTS sp_api_quantity integer,
  ADD COLUMN IF NOT EXISTS sp_api_synced_at timestamptz;

-- Add comments for documentation
COMMENT ON COLUMN listing_settings.sp_api_price_pence IS 'Price fetched from Amazon SP-API (in pence)';
COMMENT ON COLUMN listing_settings.sp_api_quantity IS 'Stock quantity fetched from Amazon SP-API';
COMMENT ON COLUMN listing_settings.sp_api_synced_at IS 'Timestamp when SP-API data was last synced';

-- Create index for finding listings that need syncing
CREATE INDEX IF NOT EXISTS idx_listing_settings_sp_api_synced
  ON listing_settings(sp_api_synced_at)
  WHERE sp_api_synced_at IS NOT NULL;

-- Add helpful view to see final price/quantity (manual override takes precedence)
CREATE OR REPLACE VIEW listing_pricing AS
SELECT
  ls.listing_memory_id,
  lm.asin,
  lm.sku,
  lm.title_fingerprint,
  -- Final price (manual override > SP-API > null)
  COALESCE(ls.price_override_pence, ls.sp_api_price_pence) as final_price_pence,
  ls.price_override_pence as manual_price_pence,
  ls.sp_api_price_pence,
  CASE
    WHEN ls.price_override_pence IS NOT NULL THEN 'MANUAL'
    WHEN ls.sp_api_price_pence IS NOT NULL THEN 'SP_API'
    ELSE 'NONE'
  END as price_source,
  -- Final quantity (manual override > SP-API > null)
  COALESCE(ls.quantity_override, ls.sp_api_quantity) as final_quantity,
  ls.quantity_override as manual_quantity,
  ls.quantity_cap,
  ls.sp_api_quantity,
  CASE
    WHEN ls.quantity_override IS NOT NULL THEN 'MANUAL'
    WHEN ls.sp_api_quantity IS NOT NULL THEN 'SP_API'
    ELSE 'NONE'
  END as quantity_source,
  ls.sp_api_synced_at,
  ls.updated_at
FROM listing_memory lm
LEFT JOIN listing_settings ls ON ls.listing_memory_id = lm.id
WHERE lm.is_active = true;

COMMENT ON VIEW listing_pricing IS 'Unified view showing final pricing (manual overrides take precedence over SP-API data)';
