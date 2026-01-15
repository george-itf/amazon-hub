-- Migration: 2026-01-15_schema_fixes.sql
-- Fixes schema mismatches identified during deployment

-- ============================================================================
-- 1. ADD cost_price_pence TO components (if not exists)
-- The dashboard and analytics routes expect this column
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'components' AND column_name = 'cost_price_pence'
  ) THEN
    ALTER TABLE components ADD COLUMN cost_price_pence integer DEFAULT 0;
    COMMENT ON COLUMN components.cost_price_pence IS 'Cost price in pence for margin calculations';
  END IF;
END $$;

-- ============================================================================
-- 2. CREATE listing_settings TABLE (if not exists)
-- Used for per-listing configuration overrides
-- ============================================================================
CREATE TABLE IF NOT EXISTS listing_settings (
  id bigserial PRIMARY KEY,
  listing_memory_id uuid UNIQUE NOT NULL REFERENCES listing_memory(id) ON DELETE CASCADE,
  price_override_pence integer,
  quantity_cap integer,
  quantity_override integer,
  min_margin_override numeric(5,2),
  target_margin_override numeric(5,2),
  shipping_profile_id bigint,
  tags text[],
  group_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add constraint for minimum margin guardrail (if table was just created)
ALTER TABLE listing_settings
  DROP CONSTRAINT IF EXISTS chk_min_margin_guardrail;
ALTER TABLE listing_settings
  ADD CONSTRAINT chk_min_margin_guardrail
  CHECK (min_margin_override IS NULL OR min_margin_override >= 10);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_listing_settings_listing_memory_id
  ON listing_settings(listing_memory_id);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_listing_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS listing_settings_updated_at ON listing_settings;
CREATE TRIGGER listing_settings_updated_at
  BEFORE UPDATE ON listing_settings
  FOR EACH ROW EXECUTE FUNCTION update_listing_settings_updated_at();

COMMENT ON TABLE listing_settings IS 'Per-listing settings for price, quantity, and margin overrides';

-- ============================================================================
-- 3. ADD amazon_fee_percent TO listing_memory (if not exists)
-- Used for profitability calculations
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'listing_memory' AND column_name = 'amazon_fee_percent'
  ) THEN
    ALTER TABLE listing_memory ADD COLUMN amazon_fee_percent numeric(5,2) DEFAULT 15.0;
    COMMENT ON COLUMN listing_memory.amazon_fee_percent IS 'Amazon referral fee percentage (default 15%)';
  END IF;
END $$;

-- ============================================================================
-- 4. CREATE shipping_rules TABLE (if not exists)
-- Used for shipping rule configuration
-- ============================================================================
CREATE TABLE IF NOT EXISTS shipping_rules (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  description text,
  service_code text NOT NULL DEFAULT 'CRL1',
  max_weight_grams integer,
  max_length_cm numeric(6,2),
  max_width_cm numeric(6,2),
  max_height_cm numeric(6,2),
  base_cost_pence integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Trigger for shipping_rules updated_at
CREATE OR REPLACE FUNCTION update_shipping_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shipping_rules_updated_at ON shipping_rules;
CREATE TRIGGER shipping_rules_updated_at
  BEFORE UPDATE ON shipping_rules
  FOR EACH ROW EXECUTE FUNCTION update_shipping_rules_updated_at();

COMMENT ON TABLE shipping_rules IS 'Shipping rules for parcel sizes and service selection';

-- Insert default shipping rules if table is empty
INSERT INTO shipping_rules (name, description, service_code, max_weight_grams, base_cost_pence, is_active)
SELECT 'Small Parcel', 'For items under 2kg', 'CRL1', 2000, 450, true
WHERE NOT EXISTS (SELECT 1 FROM shipping_rules);

INSERT INTO shipping_rules (name, description, service_code, max_weight_grams, base_cost_pence, is_active)
SELECT 'Medium Parcel', 'For items 2-10kg', 'CRL1', 10000, 750, true
WHERE NOT EXISTS (SELECT 1 FROM shipping_rules WHERE name = 'Medium Parcel');

INSERT INTO shipping_rules (name, description, service_code, max_weight_grams, base_cost_pence, is_active)
SELECT 'Large Parcel', 'For items over 10kg', 'CRL2', 30000, 1200, true
WHERE NOT EXISTS (SELECT 1 FROM shipping_rules WHERE name = 'Large Parcel');

-- ============================================================================
-- 5. AUDIT: Record migration application
-- ============================================================================
INSERT INTO system_events (event_type, description, severity, metadata)
SELECT
  'MIGRATION_APPLIED',
  'Applied 2026-01-15_schema_fixes.sql: cost_price_pence, listing_settings, amazon_fee_percent, shipping_rules',
  'INFO',
  '{
    "migration": "2026-01-15_schema_fixes.sql",
    "changes": [
      "Added cost_price_pence to components",
      "Created listing_settings table",
      "Added amazon_fee_percent to listing_memory",
      "Created shipping_rules table with defaults"
    ]
  }'::jsonb
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'system_events');
