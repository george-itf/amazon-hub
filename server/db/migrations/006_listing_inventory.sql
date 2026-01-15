-- ============================================================================
-- Amazon Hub Brain - Listing Inventory Availability Functions
-- Version: 006
-- Description: Functions for calculating inventory availability per listing/BOM
--              to prevent overselling when multiple listings share components
-- ============================================================================

-- ============================================================================
-- RPC: Get Listing Inventory Availability
-- Calculates max sellable quantity for all active listings based on component stock
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_get_listing_inventory(
  p_location text DEFAULT 'Warehouse',
  p_include_inactive boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_listings jsonb := '[]'::jsonb;
  v_listing record;
  v_bom_component record;
  v_available integer;
  v_buildable integer;
  v_min_buildable integer;
  v_constraint_component_id uuid;
  v_constraint_internal_sku text;
  v_components_data jsonb;
BEGIN
  -- Loop through all listings with BOMs
  FOR v_listing IN
    SELECT
      lm.id as listing_id,
      lm.asin,
      lm.sku,
      lm.title_fingerprint,
      lm.bom_id,
      lm.is_active,
      b.bundle_sku,
      b.description as bom_description,
      b.is_active as bom_is_active
    FROM listing_memory lm
    JOIN boms b ON b.id = lm.bom_id
    WHERE lm.bom_id IS NOT NULL
      AND (p_include_inactive OR lm.is_active = true)
      AND (p_include_inactive OR b.is_active = true)
    ORDER BY lm.asin NULLS LAST, lm.sku NULLS LAST
  LOOP
    -- Calculate buildable quantity for this BOM
    v_min_buildable := 999999;
    v_constraint_component_id := NULL;
    v_constraint_internal_sku := NULL;
    v_components_data := '[]'::jsonb;

    -- Check each component in the BOM
    FOR v_bom_component IN
      SELECT
        bc.component_id,
        bc.qty_required,
        c.internal_sku,
        c.description as component_description,
        COALESCE(cs.on_hand, 0) as on_hand,
        COALESCE(cs.reserved, 0) as reserved,
        COALESCE(cs.on_hand, 0) - COALESCE(cs.reserved, 0) as available
      FROM bom_components bc
      JOIN components c ON c.id = bc.component_id
      LEFT JOIN component_stock cs ON cs.component_id = bc.component_id
        AND cs.location = p_location
      WHERE bc.bom_id = v_listing.bom_id
    LOOP
      v_available := GREATEST(0, v_bom_component.available);
      v_buildable := FLOOR(v_available::numeric / v_bom_component.qty_required);

      -- Track component data
      v_components_data := v_components_data || jsonb_build_object(
        'component_id', v_bom_component.component_id,
        'internal_sku', v_bom_component.internal_sku,
        'description', v_bom_component.component_description,
        'qty_required', v_bom_component.qty_required,
        'on_hand', v_bom_component.on_hand,
        'reserved', v_bom_component.reserved,
        'available', v_available,
        'buildable', v_buildable,
        'is_constraint', false
      );

      -- Track minimum buildable (constraint)
      IF v_buildable < v_min_buildable THEN
        v_min_buildable := v_buildable;
        v_constraint_component_id := v_bom_component.component_id;
        v_constraint_internal_sku := v_bom_component.internal_sku;
      END IF;
    END LOOP;

    -- Mark constraint components in the data
    SELECT jsonb_agg(
      CASE
        WHEN (comp->>'component_id')::uuid = v_constraint_component_id
        THEN comp || '{"is_constraint": true}'::jsonb
        ELSE comp
      END
    )
    INTO v_components_data
    FROM jsonb_array_elements(v_components_data) as comp;

    -- Handle BOMs with no components
    IF v_min_buildable = 999999 THEN
      v_min_buildable := 0;
    END IF;

    -- Add listing to results
    v_listings := v_listings || jsonb_build_object(
      'listing_id', v_listing.listing_id,
      'asin', v_listing.asin,
      'sku', v_listing.sku,
      'title_fingerprint', v_listing.title_fingerprint,
      'is_active', v_listing.is_active,
      'bom_id', v_listing.bom_id,
      'bundle_sku', v_listing.bundle_sku,
      'bom_description', v_listing.bom_description,
      'bom_is_active', v_listing.bom_is_active,
      'max_sellable', v_min_buildable,
      'constraint_component_id', v_constraint_component_id,
      'constraint_internal_sku', v_constraint_internal_sku,
      'components', v_components_data,
      'stock_status', CASE
        WHEN v_min_buildable = 0 THEN 'OUT_OF_STOCK'
        WHEN v_min_buildable <= 3 THEN 'LOW_STOCK'
        WHEN v_min_buildable <= 10 THEN 'MODERATE_STOCK'
        ELSE 'IN_STOCK'
      END
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'listings', v_listings,
      'location', p_location,
      'total', jsonb_array_length(v_listings),
      'out_of_stock_count', (
        SELECT COUNT(*) FROM jsonb_array_elements(v_listings) l
        WHERE l->>'stock_status' = 'OUT_OF_STOCK'
      ),
      'low_stock_count', (
        SELECT COUNT(*) FROM jsonb_array_elements(v_listings) l
        WHERE l->>'stock_status' = 'LOW_STOCK'
      )
    )
  );
END;
$$;

-- ============================================================================
-- RPC: Get Component Dependent Listings
-- Returns all listings/BOMs that depend on a specific component
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_get_component_dependent_listings(
  p_component_id uuid,
  p_location text DEFAULT 'Warehouse'
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_component record;
  v_dependent_listings jsonb := '[]'::jsonb;
  v_listing record;
  v_available integer;
  v_buildable_from_this integer;
BEGIN
  -- Get the component info
  SELECT
    c.id,
    c.internal_sku,
    c.description,
    c.brand,
    COALESCE(cs.on_hand, 0) as on_hand,
    COALESCE(cs.reserved, 0) as reserved,
    COALESCE(cs.on_hand, 0) - COALESCE(cs.reserved, 0) as available
  INTO v_component
  FROM components c
  LEFT JOIN component_stock cs ON cs.component_id = c.id
    AND cs.location = p_location
  WHERE c.id = p_component_id;

  IF v_component IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'COMPONENT_NOT_FOUND',
        'message', 'Component not found'
      )
    );
  END IF;

  v_available := GREATEST(0, v_component.available);

  -- Find all listings that use this component
  FOR v_listing IN
    SELECT
      lm.id as listing_id,
      lm.asin,
      lm.sku,
      lm.title_fingerprint,
      lm.is_active,
      b.id as bom_id,
      b.bundle_sku,
      b.description as bom_description,
      bc.qty_required
    FROM bom_components bc
    JOIN boms b ON b.id = bc.bom_id
    JOIN listing_memory lm ON lm.bom_id = b.id
    WHERE bc.component_id = p_component_id
      AND lm.is_active = true
      AND b.is_active = true
    ORDER BY lm.asin NULLS LAST, lm.sku NULLS LAST
  LOOP
    v_buildable_from_this := FLOOR(v_available::numeric / v_listing.qty_required);

    v_dependent_listings := v_dependent_listings || jsonb_build_object(
      'listing_id', v_listing.listing_id,
      'asin', v_listing.asin,
      'sku', v_listing.sku,
      'title_fingerprint', v_listing.title_fingerprint,
      'is_active', v_listing.is_active,
      'bom_id', v_listing.bom_id,
      'bundle_sku', v_listing.bundle_sku,
      'bom_description', v_listing.bom_description,
      'qty_required_per_unit', v_listing.qty_required,
      'max_sellable_from_this_component', v_buildable_from_this
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'component', jsonb_build_object(
        'id', v_component.id,
        'internal_sku', v_component.internal_sku,
        'description', v_component.description,
        'brand', v_component.brand,
        'on_hand', v_component.on_hand,
        'reserved', v_component.reserved,
        'available', v_available,
        'location', p_location
      ),
      'dependent_listings', v_dependent_listings,
      'total_dependent', jsonb_array_length(v_dependent_listings)
    )
  );
END;
$$;

-- ============================================================================
-- RPC: Get Shared Component Report
-- Shows components that are shared across multiple BOMs/listings
-- Useful for identifying overselling risks
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_get_shared_components_report(
  p_location text DEFAULT 'Warehouse'
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_shared_components jsonb := '[]'::jsonb;
  v_component record;
  v_listing_count integer;
  v_available integer;
  v_total_required integer;
BEGIN
  -- Find components used in multiple active BOMs
  FOR v_component IN
    SELECT
      c.id,
      c.internal_sku,
      c.description,
      c.brand,
      COALESCE(cs.on_hand, 0) as on_hand,
      COALESCE(cs.reserved, 0) as reserved,
      COALESCE(cs.on_hand, 0) - COALESCE(cs.reserved, 0) as available,
      COUNT(DISTINCT bc.bom_id) as bom_count,
      SUM(bc.qty_required) as total_qty_required_per_unit
    FROM components c
    JOIN bom_components bc ON bc.component_id = c.id
    JOIN boms b ON b.id = bc.bom_id AND b.is_active = true
    LEFT JOIN component_stock cs ON cs.component_id = c.id
      AND cs.location = p_location
    WHERE c.is_active = true
    GROUP BY c.id, c.internal_sku, c.description, c.brand,
             cs.on_hand, cs.reserved
    HAVING COUNT(DISTINCT bc.bom_id) > 1
    ORDER BY COUNT(DISTINCT bc.bom_id) DESC, c.internal_sku
  LOOP
    -- Count active listings that use this component
    SELECT COUNT(DISTINCT lm.id)
    INTO v_listing_count
    FROM listing_memory lm
    JOIN bom_components bc ON bc.bom_id = lm.bom_id
    WHERE bc.component_id = v_component.id
      AND lm.is_active = true;

    v_available := GREATEST(0, v_component.available);

    v_shared_components := v_shared_components || jsonb_build_object(
      'component_id', v_component.id,
      'internal_sku', v_component.internal_sku,
      'description', v_component.description,
      'brand', v_component.brand,
      'on_hand', v_component.on_hand,
      'reserved', v_component.reserved,
      'available', v_available,
      'bom_count', v_component.bom_count,
      'listing_count', v_listing_count,
      'risk_level', CASE
        WHEN v_available = 0 THEN 'CRITICAL'
        WHEN v_available < v_component.bom_count * 2 THEN 'HIGH'
        WHEN v_available < v_component.bom_count * 5 THEN 'MEDIUM'
        ELSE 'LOW'
      END
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'shared_components', v_shared_components,
      'location', p_location,
      'total', jsonb_array_length(v_shared_components),
      'critical_count', (
        SELECT COUNT(*) FROM jsonb_array_elements(v_shared_components) sc
        WHERE sc->>'risk_level' = 'CRITICAL'
      ),
      'high_risk_count', (
        SELECT COUNT(*) FROM jsonb_array_elements(v_shared_components) sc
        WHERE sc->>'risk_level' = 'HIGH'
      )
    )
  );
END;
$$;

-- ============================================================================
-- GRANT EXECUTE (for Supabase if needed)
-- ============================================================================

-- GRANT EXECUTE ON FUNCTION rpc_get_listing_inventory TO authenticated;
-- GRANT EXECUTE ON FUNCTION rpc_get_component_dependent_listings TO authenticated;
-- GRANT EXECUTE ON FUNCTION rpc_get_shared_components_report TO authenticated;
