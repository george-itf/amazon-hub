-- Migration: UI Views for saved filter tabs
-- Date: 2026-01-15
-- Description: User-defined saved filter views displayed as tabs

-- Drop old table if exists from previous migration
DROP TABLE IF EXISTS ui_views CASCADE;

-- Create ui_views table
CREATE TABLE ui_views (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  context text NOT NULL,                           -- 'components' | 'listings'
  name text NOT NULL,                              -- User-friendly name e.g., "Makita", "Screws"
  config jsonb NOT NULL DEFAULT '{}'::jsonb,       -- Filter configuration (filters, sort, columns)
  is_default boolean NOT NULL DEFAULT false,       -- Is this the default view for context?
  sort_order int NOT NULL DEFAULT 0,               -- Tab ordering
  created_by text NULL,                            -- Username/email of creator
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_ui_views_context ON ui_views(context);
CREATE INDEX idx_ui_views_context_sort ON ui_views(context, sort_order);

-- Unique constraint: (context, name) must be unique
ALTER TABLE ui_views ADD CONSTRAINT ui_views_context_name_unique UNIQUE (context, name);

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

-- Comments
COMMENT ON TABLE ui_views IS 'User-defined saved filter views displayed as tabs in list pages';
COMMENT ON COLUMN ui_views.context IS 'Page context: components, listings';
COMMENT ON COLUMN ui_views.config IS 'Filter/sort/column configuration as JSON';
