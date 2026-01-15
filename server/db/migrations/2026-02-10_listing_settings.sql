-- Migration: Per-listing settings for pricing, allocation and grouping
-- Date: 2026-02-10
-- Description: Add listing_settings table for per-listing overrides

CREATE TABLE listing_settings (
  id bigserial PRIMARY KEY,
  listing_memory_id uuid UNIQUE REFERENCES listing_memory(id) ON DELETE CASCADE,
  price_override_pence integer,           -- Override sell-out price
  quantity_cap integer,                   -- Maximum recommended quantity
  quantity_override integer,              -- Force specific quantity (ignores allocation)
  min_margin_override numeric(5,2),       -- Override minimum margin threshold
  target_margin_override numeric(5,2),    -- Override target margin
  shipping_profile_id text,               -- Reference to shipping profile (for future use)
  tags jsonb DEFAULT '[]'::jsonb,         -- Tags for categorization
  group_key text,                         -- Variant grouping key (e.g., "DHR242Z")
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes for efficient lookups
CREATE INDEX idx_listing_settings_listing_memory_id ON listing_settings(listing_memory_id);
CREATE INDEX idx_listing_settings_group_key ON listing_settings(group_key) WHERE group_key IS NOT NULL;

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
  FOR EACH ROW
  EXECUTE FUNCTION update_listing_settings_updated_at();

-- Comments
COMMENT ON TABLE listing_settings IS 'Per-listing overrides for pricing, allocation and grouping.';
COMMENT ON COLUMN listing_settings.price_override_pence IS 'Override sell-out price in pence';
COMMENT ON COLUMN listing_settings.quantity_cap IS 'Maximum recommended quantity (allocation respects this cap)';
COMMENT ON COLUMN listing_settings.quantity_override IS 'Force specific quantity, overriding allocation algorithm';
COMMENT ON COLUMN listing_settings.min_margin_override IS 'Override minimum margin % threshold (default: 10)';
COMMENT ON COLUMN listing_settings.target_margin_override IS 'Override target margin % (default: 15)';
COMMENT ON COLUMN listing_settings.shipping_profile_id IS 'Optional shipping profile identifier';
COMMENT ON COLUMN listing_settings.tags IS 'JSON array of string tags for categorization';
COMMENT ON COLUMN listing_settings.group_key IS 'Variant grouping key for related listings';
