-- ============================================================================
-- DATA FIXES MIGRATION
-- Fixes for:
-- 1. user_preferences table not existing (PGRST205 error)
-- 2. Reset all listing_memory bom_id to NULL (NEEDS BOM status)
-- ============================================================================

-- ============================================================================
-- 1. CREATE USER_PREFERENCES TABLE (if not exists)
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preference_key text NOT NULL,
  preference_value jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, preference_key)
);

-- Index for fast user lookups
CREATE INDEX IF NOT EXISTS idx_user_preferences_user ON user_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_preferences_key ON user_preferences(user_id, preference_key);

COMMENT ON TABLE user_preferences IS 'Stores user preferences for cross-device sync';

-- ============================================================================
-- 2. RESET ALL BOM ASSIGNMENTS ON LISTINGS
-- Sets all listing_memory.bom_id to NULL so they show "NEEDS BOM"
-- ============================================================================

-- First, let's see how many listings have BOMs assigned
-- SELECT COUNT(*) as with_bom FROM listing_memory WHERE bom_id IS NOT NULL;

-- Reset all BOM assignments - listings will now show "NEEDS BOM" status
UPDATE listing_memory
SET bom_id = NULL
WHERE bom_id IS NOT NULL;

-- Log this action in system_events for audit trail
INSERT INTO system_events (event_type, description, metadata, created_at)
VALUES (
  'DATA_MIGRATION',
  'Reset all listing BOM assignments to NULL',
  jsonb_build_object(
    'migration', '2026-01-16_data_fixes.sql',
    'action', 'reset_all_bom_assignments',
    'timestamp', now()
  ),
  now()
);

-- ============================================================================
-- 3. VERIFY COMPONENT_STOCK HAS DATA
-- If component_stock is empty but components exist, we need to seed it
-- ============================================================================

-- Check if we have components but no stock records
-- This is informational - uncomment to diagnose
-- SELECT
--   (SELECT COUNT(*) FROM components WHERE is_active = true) as active_components,
--   (SELECT COUNT(*) FROM component_stock) as stock_records;

-- If you need to seed component_stock with defaults, uncomment this:
-- INSERT INTO component_stock (component_id, location, on_hand, reserved)
-- SELECT id, 'Warehouse', 0, 0
-- FROM components c
-- WHERE NOT EXISTS (
--   SELECT 1 FROM component_stock cs
--   WHERE cs.component_id = c.id AND cs.location = 'Warehouse'
-- );

-- ============================================================================
-- DONE
-- ============================================================================
