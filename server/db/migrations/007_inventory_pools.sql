-- ============================================================================
-- Amazon Hub Brain - Inventory Pools for Shared Stock Allocation
-- Version: 007
-- Description: Tables and functions for managing shared component allocation
--              across multiple BOMs to prevent overselling
-- ============================================================================

-- ============================================================================
-- INVENTORY POOLS
-- Groups BOMs that share a critical/pooled component (e.g., tool core)
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory_pools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  pool_component_id uuid NOT NULL REFERENCES components(id) ON DELETE RESTRICT,
  location text NOT NULL DEFAULT 'Warehouse',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by_actor_type text,
  created_by_actor_id text,
  created_by_actor_display text,
  UNIQUE(pool_component_id, location)
);

CREATE INDEX IF NOT EXISTS idx_inventory_pools_component ON inventory_pools(pool_component_id);
CREATE INDEX IF NOT EXISTS idx_inventory_pools_active ON inventory_pools(is_active) WHERE is_active = true;

-- ============================================================================
-- INVENTORY POOL MEMBERS
-- Links BOMs to pools with allocation weights and constraints
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory_pool_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id uuid NOT NULL REFERENCES inventory_pools(id) ON DELETE CASCADE,
  bom_id uuid NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
  -- Weight for proportional allocation (default 1.0 = equal share)
  weight numeric(5,2) NOT NULL DEFAULT 1.0 CHECK (weight > 0),
  -- Optional minimum guaranteed allocation (0 = no minimum)
  min_qty integer NOT NULL DEFAULT 0 CHECK (min_qty >= 0),
  -- Optional maximum cap (NULL = no cap, use buildable)
  max_qty integer CHECK (max_qty IS NULL OR max_qty >= 0),
  -- Priority for allocation order (higher = allocated first for minimums)
  priority integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(pool_id, bom_id)
);

CREATE INDEX IF NOT EXISTS idx_pool_members_pool ON inventory_pool_members(pool_id);
CREATE INDEX IF NOT EXISTS idx_pool_members_bom ON inventory_pool_members(bom_id);
CREATE INDEX IF NOT EXISTS idx_pool_members_active ON inventory_pool_members(is_active) WHERE is_active = true;

-- ============================================================================
-- Triggers for updated_at
-- ============================================================================

DROP TRIGGER IF EXISTS update_inventory_pools_updated_at ON inventory_pools;
CREATE TRIGGER update_inventory_pools_updated_at
    BEFORE UPDATE ON inventory_pools
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_inventory_pool_members_updated_at ON inventory_pool_members;
CREATE TRIGGER update_inventory_pool_members_updated_at
    BEFORE UPDATE ON inventory_pool_members
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- RPC: Get Pool Allocation Data
-- Returns all data needed for the allocation algorithm
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_get_pool_allocation_data(
  p_location text DEFAULT 'Warehouse'
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_pools jsonb := '[]'::jsonb;
  v_pool record;
  v_member record;
  v_members jsonb;
  v_pool_available integer;
  v_component_available integer;
  v_buildable integer;
  v_min_buildable integer;
  v_constraint_component_id uuid;
  v_constraint_internal_sku text;
BEGIN
  -- Loop through active pools for this location
  FOR v_pool IN
    SELECT
      ip.id,
      ip.name,
      ip.description,
      ip.pool_component_id,
      c.internal_sku as pool_component_sku,
      c.description as pool_component_description,
      COALESCE(cs.on_hand, 0) as pool_on_hand,
      COALESCE(cs.reserved, 0) as pool_reserved,
      GREATEST(0, COALESCE(cs.on_hand, 0) - COALESCE(cs.reserved, 0)) as pool_available
    FROM inventory_pools ip
    JOIN components c ON c.id = ip.pool_component_id
    LEFT JOIN component_stock cs ON cs.component_id = ip.pool_component_id
      AND cs.location = p_location
    WHERE ip.is_active = true
      AND ip.location = p_location
    ORDER BY ip.name
  LOOP
    v_members := '[]'::jsonb;

    -- Get members for this pool
    FOR v_member IN
      SELECT
        ipm.id as member_id,
        ipm.bom_id,
        ipm.weight,
        ipm.min_qty,
        ipm.max_qty,
        ipm.priority,
        b.bundle_sku,
        b.description as bom_description,
        b.is_active as bom_is_active
      FROM inventory_pool_members ipm
      JOIN boms b ON b.id = ipm.bom_id
      WHERE ipm.pool_id = v_pool.id
        AND ipm.is_active = true
        AND b.is_active = true
      ORDER BY ipm.priority DESC, b.bundle_sku
    LOOP
      -- Calculate buildable for this BOM (respecting all component constraints)
      v_min_buildable := 999999;
      v_constraint_component_id := NULL;
      v_constraint_internal_sku := NULL;

      FOR v_component_available IN
        SELECT
          bc.component_id,
          bc.qty_required,
          c.internal_sku,
          GREATEST(0, COALESCE(cs.on_hand, 0) - COALESCE(cs.reserved, 0)) as available
        FROM bom_components bc
        JOIN components c ON c.id = bc.component_id
        LEFT JOIN component_stock cs ON cs.component_id = bc.component_id
          AND cs.location = p_location
        WHERE bc.bom_id = v_member.bom_id
      LOOP
        NULL; -- Placeholder, we'll use a different approach
      END LOOP;

      -- Simpler buildable calculation
      SELECT
        COALESCE(MIN(
          FLOOR(GREATEST(0, COALESCE(cs.on_hand, 0) - COALESCE(cs.reserved, 0))::numeric / bc.qty_required)
        ), 0)::integer
      INTO v_buildable
      FROM bom_components bc
      LEFT JOIN component_stock cs ON cs.component_id = bc.component_id
        AND cs.location = p_location
      WHERE bc.bom_id = v_member.bom_id;

      -- Get constraint component
      SELECT bc.component_id, c.internal_sku
      INTO v_constraint_component_id, v_constraint_internal_sku
      FROM bom_components bc
      JOIN components c ON c.id = bc.component_id
      LEFT JOIN component_stock cs ON cs.component_id = bc.component_id
        AND cs.location = p_location
      WHERE bc.bom_id = v_member.bom_id
      ORDER BY FLOOR(GREATEST(0, COALESCE(cs.on_hand, 0) - COALESCE(cs.reserved, 0))::numeric / bc.qty_required) ASC
      LIMIT 1;

      v_members := v_members || jsonb_build_object(
        'member_id', v_member.member_id,
        'bom_id', v_member.bom_id,
        'bundle_sku', v_member.bundle_sku,
        'bom_description', v_member.bom_description,
        'weight', v_member.weight,
        'min_qty', v_member.min_qty,
        'max_qty', v_member.max_qty,
        'priority', v_member.priority,
        'buildable', COALESCE(v_buildable, 0),
        'constraint_component_id', v_constraint_component_id,
        'constraint_internal_sku', v_constraint_internal_sku
      );
    END LOOP;

    v_pools := v_pools || jsonb_build_object(
      'pool_id', v_pool.id,
      'pool_name', v_pool.name,
      'pool_description', v_pool.description,
      'pool_component_id', v_pool.pool_component_id,
      'pool_component_sku', v_pool.pool_component_sku,
      'pool_component_description', v_pool.pool_component_description,
      'pool_on_hand', v_pool.pool_on_hand,
      'pool_reserved', v_pool.pool_reserved,
      'pool_available', v_pool.pool_available,
      'members', v_members,
      'member_count', jsonb_array_length(v_members)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'pools', v_pools,
      'location', p_location,
      'total_pools', jsonb_array_length(v_pools)
    )
  );
END;
$$;

-- ============================================================================
-- RPC: Get Non-Pooled BOMs Availability
-- Returns BOMs not in any pool with their buildable quantities
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_get_non_pooled_boms(
  p_location text DEFAULT 'Warehouse'
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_boms jsonb := '[]'::jsonb;
  v_bom record;
  v_buildable integer;
  v_constraint_component_id uuid;
  v_constraint_internal_sku text;
BEGIN
  FOR v_bom IN
    SELECT
      b.id,
      b.bundle_sku,
      b.description
    FROM boms b
    WHERE b.is_active = true
      AND NOT EXISTS (
        SELECT 1 FROM inventory_pool_members ipm
        JOIN inventory_pools ip ON ip.id = ipm.pool_id
        WHERE ipm.bom_id = b.id
          AND ipm.is_active = true
          AND ip.is_active = true
          AND ip.location = p_location
      )
    ORDER BY b.bundle_sku
  LOOP
    -- Calculate buildable
    SELECT
      COALESCE(MIN(
        FLOOR(GREATEST(0, COALESCE(cs.on_hand, 0) - COALESCE(cs.reserved, 0))::numeric / bc.qty_required)
      ), 0)::integer
    INTO v_buildable
    FROM bom_components bc
    LEFT JOIN component_stock cs ON cs.component_id = bc.component_id
      AND cs.location = p_location
    WHERE bc.bom_id = v_bom.id;

    -- Get constraint component
    SELECT bc.component_id, c.internal_sku
    INTO v_constraint_component_id, v_constraint_internal_sku
    FROM bom_components bc
    JOIN components c ON c.id = bc.component_id
    LEFT JOIN component_stock cs ON cs.component_id = bc.component_id
      AND cs.location = p_location
    WHERE bc.bom_id = v_bom.id
    ORDER BY FLOOR(GREATEST(0, COALESCE(cs.on_hand, 0) - COALESCE(cs.reserved, 0))::numeric / bc.qty_required) ASC
    LIMIT 1;

    v_boms := v_boms || jsonb_build_object(
      'bom_id', v_bom.id,
      'bundle_sku', v_bom.bundle_sku,
      'bom_description', v_bom.description,
      'buildable', COALESCE(v_buildable, 0),
      'recommended_qty', COALESCE(v_buildable, 0),
      'constraint_component_id', v_constraint_component_id,
      'constraint_internal_sku', v_constraint_internal_sku,
      'pool_id', null,
      'pool_name', null
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'boms', v_boms,
      'location', p_location,
      'total', jsonb_array_length(v_boms)
    )
  );
END;
$$;
