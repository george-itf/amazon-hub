-- Migration: Enhanced Saved Views System
-- Date: 2026-01-16
-- Description: Comprehensive saved views with user ownership, sharing, columns, and sort config
-- Supports page-specific views (shipping, listings, inventory, components, orders, etc.)

-- Add new columns to existing ui_views table
-- Note: This migration enhances the existing ui_views table from 020_ui_views.sql

-- First, rename 'context' to 'page' for clarity (if not already)
DO $$
BEGIN
  -- Check if 'context' column exists but 'page' doesn't
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ui_views' AND column_name = 'context')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ui_views' AND column_name = 'page')
  THEN
    ALTER TABLE ui_views RENAME COLUMN context TO page;
  END IF;
END $$;

-- Add user_id column for ownership (references users table if exists, otherwise text)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ui_views' AND column_name = 'user_id') THEN
    -- Try to add with foreign key if users table exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
      ALTER TABLE ui_views ADD COLUMN user_id uuid REFERENCES users(id) ON DELETE CASCADE;
    ELSE
      ALTER TABLE ui_views ADD COLUMN user_id uuid;
    END IF;
  END IF;
END $$;

-- Add columns array for column visibility/ordering
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ui_views' AND column_name = 'columns') THEN
    ALTER TABLE ui_views ADD COLUMN columns text[] DEFAULT '{}';
  END IF;
END $$;

-- Add sort configuration as JSONB (column, direction)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ui_views' AND column_name = 'sort') THEN
    ALTER TABLE ui_views ADD COLUMN sort jsonb DEFAULT '{}';
  END IF;
END $$;

-- Add is_shared flag for shared views visible to all users
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ui_views' AND column_name = 'is_shared') THEN
    ALTER TABLE ui_views ADD COLUMN is_shared boolean DEFAULT false;
  END IF;
END $$;

-- Rename 'config' to 'filters' for clarity (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ui_views' AND column_name = 'config')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ui_views' AND column_name = 'filters')
  THEN
    ALTER TABLE ui_views RENAME COLUMN config TO filters;
  END IF;
END $$;

-- Drop old unique constraint if exists and recreate
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ui_views_context_name_unique') THEN
    ALTER TABLE ui_views DROP CONSTRAINT ui_views_context_name_unique;
  END IF;
END $$;

-- Create new unique constraint: (user_id, page, name) must be unique for personal views
-- Shared views have their own namespace
CREATE UNIQUE INDEX IF NOT EXISTS idx_ui_views_user_page_name
ON ui_views(user_id, page, name)
WHERE user_id IS NOT NULL;

-- Create index for shared views
CREATE INDEX IF NOT EXISTS idx_ui_views_shared
ON ui_views(page, is_shared)
WHERE is_shared = true;

-- Create index for user's views
CREATE INDEX IF NOT EXISTS idx_ui_views_user_page
ON ui_views(user_id, page)
WHERE user_id IS NOT NULL;

-- Update the page column constraint to allow more contexts
-- Drop old index if exists
DROP INDEX IF EXISTS idx_ui_views_context;
DROP INDEX IF EXISTS idx_ui_views_context_sort;

-- Create new indexes
CREATE INDEX IF NOT EXISTS idx_ui_views_page ON ui_views(page);
CREATE INDEX IF NOT EXISTS idx_ui_views_page_sort ON ui_views(page, sort_order);

-- Add check constraint for valid pages
DO $$
BEGIN
  -- Drop old constraint if exists
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ui_views_page_check') THEN
    ALTER TABLE ui_views DROP CONSTRAINT ui_views_page_check;
  END IF;
END $$;

-- Add new check constraint with expanded page list
ALTER TABLE ui_views ADD CONSTRAINT ui_views_page_check
CHECK (page IN ('shipping', 'listings', 'inventory', 'components', 'orders', 'boms', 'returns', 'analytics', 'review'));

-- Update comments
COMMENT ON TABLE ui_views IS 'User-defined saved views with filters, columns, and sort configuration';
COMMENT ON COLUMN ui_views.page IS 'Page context: shipping, listings, inventory, components, orders, boms, returns, analytics, review';
COMMENT ON COLUMN ui_views.user_id IS 'Owner user ID (null for legacy views)';
COMMENT ON COLUMN ui_views.filters IS 'Filter configuration as JSON object';
COMMENT ON COLUMN ui_views.columns IS 'Array of visible column keys in display order';
COMMENT ON COLUMN ui_views.sort IS 'Sort configuration: {column, direction}';
COMMENT ON COLUMN ui_views.is_shared IS 'Whether this view is visible to all users';
COMMENT ON COLUMN ui_views.is_default IS 'Whether this is the default view for the user on this page';

-- Create function to get views for a page (personal + shared)
CREATE OR REPLACE FUNCTION get_page_views(p_page text, p_user_id uuid)
RETURNS TABLE (
  id bigint,
  user_id uuid,
  page text,
  name text,
  filters jsonb,
  columns text[],
  sort jsonb,
  is_shared boolean,
  is_default boolean,
  is_owner boolean,
  sort_order int,
  created_by text,
  created_at timestamptz,
  updated_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    v.id,
    v.user_id,
    v.page,
    v.name,
    v.filters,
    v.columns,
    v.sort,
    v.is_shared,
    v.is_default,
    (v.user_id = p_user_id) AS is_owner,
    v.sort_order,
    v.created_by,
    v.created_at,
    v.updated_at
  FROM ui_views v
  WHERE v.page = p_page
    AND (v.user_id = p_user_id OR v.is_shared = true)
  ORDER BY
    -- Personal views first, then shared
    (v.user_id = p_user_id) DESC,
    v.sort_order ASC,
    v.created_at ASC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_page_views IS 'Get all views for a page: user personal views + shared views';
