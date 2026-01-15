-- Migration: UI Views for saved filter tabs
-- Date: 2026-01-15
-- Description: Add ui_views table for user-defined saved filter views (tabs)

-- Create ui_views table
CREATE TABLE IF NOT EXISTS ui_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  context text NOT NULL,                           -- 'components' | 'listings' | 'orders' etc.
  name text NOT NULL,                              -- User-friendly name e.g., "Makita", "Screws"
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,  -- Filter configuration
  is_default boolean NOT NULL DEFAULT false,       -- Is this the default view for context?
  sort_order integer NOT NULL DEFAULT 0,           -- Tab ordering
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_ui_views_context_sort ON ui_views (context, sort_order);
CREATE INDEX IF NOT EXISTS idx_ui_views_context_default ON ui_views (context, is_default) WHERE is_default = true;

-- Ensure only one default per context
CREATE UNIQUE INDEX IF NOT EXISTS idx_ui_views_unique_default ON ui_views (context) WHERE is_default = true;

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_ui_views_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ui_views_updated_at ON ui_views;
CREATE TRIGGER ui_views_updated_at
  BEFORE UPDATE ON ui_views
  FOR EACH ROW
  EXECUTE FUNCTION update_ui_views_updated_at();

-- Comment on table
COMMENT ON TABLE ui_views IS 'User-defined saved filter views displayed as tabs in list pages';
COMMENT ON COLUMN ui_views.context IS 'Page context: components, listings, orders, etc.';
COMMENT ON COLUMN ui_views.config_json IS 'Filter configuration: {search, brand, stockFilter, sortBy, etc.}';
