-- Migration: Add INVENTORY_PUSH to amazon_sync_log sync_type enum
-- Purpose: Allow tracking inventory push operations in the sync log

-- Drop the existing check constraint and recreate with new value
-- Note: This is a safe operation as we're only adding a new allowed value
ALTER TABLE amazon_sync_log
DROP CONSTRAINT IF EXISTS amazon_sync_log_sync_type_check;

ALTER TABLE amazon_sync_log
ADD CONSTRAINT amazon_sync_log_sync_type_check
CHECK (sync_type IN ('ORDERS', 'FEES', 'CATALOG', 'SHIPMENTS', 'INVENTORY_PUSH'));

COMMENT ON COLUMN amazon_sync_log.sync_type IS 'Type of sync operation: ORDERS, FEES, CATALOG, SHIPMENTS, or INVENTORY_PUSH';

-- ============================================================================
-- Add missing RPC function for BOM availability calculation
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_get_bom_availability(
  p_bom_id uuid,
  p_location text DEFAULT 'Warehouse'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_buildable integer;
  v_constraint_component_id uuid;
  v_constraint_internal_sku text;
  v_bom_info record;
BEGIN
  -- Validate BOM exists and is active
  SELECT id, bundle_sku, description, is_active
  INTO v_bom_info
  FROM boms
  WHERE id = p_bom_id;

  IF v_bom_info IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'BOM not found'
    );
  END IF;

  IF NOT v_bom_info.is_active THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'BOM is inactive'
    );
  END IF;

  -- Calculate buildable quantity (minimum of available/required across all components)
  SELECT
    COALESCE(MIN(
      FLOOR(GREATEST(0, COALESCE(cs.on_hand, 0) - COALESCE(cs.reserved, 0))::numeric / bc.qty_required)
    ), 0)::integer
  INTO v_buildable
  FROM bom_components bc
  LEFT JOIN component_stock cs ON cs.component_id = bc.component_id
    AND cs.location = p_location
  WHERE bc.bom_id = p_bom_id;

  -- Find the constraining component (lowest buildable ratio)
  SELECT bc.component_id, c.internal_sku
  INTO v_constraint_component_id, v_constraint_internal_sku
  FROM bom_components bc
  JOIN components c ON c.id = bc.component_id
  LEFT JOIN component_stock cs ON cs.component_id = bc.component_id
    AND cs.location = p_location
  WHERE bc.bom_id = p_bom_id
  ORDER BY FLOOR(GREATEST(0, COALESCE(cs.on_hand, 0) - COALESCE(cs.reserved, 0))::numeric / bc.qty_required)
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'bom_id', p_bom_id,
      'bundle_sku', v_bom_info.bundle_sku,
      'description', v_bom_info.description,
      'location', p_location,
      'buildable', v_buildable,
      'constraint_component_id', v_constraint_component_id,
      'constraint_internal_sku', v_constraint_internal_sku
    )
  );
END;
$$;
