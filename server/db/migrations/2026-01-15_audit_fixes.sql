-- ============================================================================
-- Amazon Hub Brain - Audit Fixes Migration
-- Date: 2026-01-15
-- Description: Add missing indexes on foreign keys, location CHECK constraint,
--              and fix race condition in rpc_pick_batch_reserve
-- ============================================================================

-- ============================================================================
-- SECTION 1: Missing Indexes on Foreign Keys
-- ============================================================================

-- Index on order_lines.bom_id for faster BOM lookups on order lines
CREATE INDEX IF NOT EXISTS idx_order_lines_bom ON order_lines(bom_id);

-- Composite index on order_lines for order-based queries sorted by creation time
CREATE INDEX IF NOT EXISTS idx_order_lines_order_created ON order_lines(order_id, created_at DESC);

-- Index on returns.order_line_id for faster return lookups by order line
CREATE INDEX IF NOT EXISTS idx_returns_order_line ON returns(order_line_id);

-- Index on return_lines.component_id (may already exist, but ensure it does)
CREATE INDEX IF NOT EXISTS idx_return_lines_component ON return_lines(component_id);

-- Composite index on review_queue for status-based queries sorted by creation time
CREATE INDEX IF NOT EXISTS idx_review_queue_status_created ON review_queue(status, created_at DESC);

-- Index on orders.amazon_order_id for Amazon order lookups
-- Note: A partial index already exists from 004_order_linking.sql, this creates a full index
CREATE INDEX IF NOT EXISTS idx_orders_amazon_order ON orders(amazon_order_id);

-- Composite index on orders for status-based queries sorted by creation time
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at DESC);

-- Composite index on system_events for time-based queries filtered by event type
CREATE INDEX IF NOT EXISTS idx_system_events_created_type ON system_events(created_at DESC, event_type);


-- ============================================================================
-- SECTION 2: CHECK Constraint for component_stock.location
-- ============================================================================

-- Add CHECK constraint to ensure location values are valid
-- Valid values: 'Warehouse', 'Refurb', 'Scrap', 'Staging', 'SupplierReturn'
-- Note: Using DO block to handle case where constraint may already exist
DO $$
BEGIN
  -- First, check if the constraint already exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'component_stock_location_check'
    AND conrelid = 'component_stock'::regclass
  ) THEN
    -- Add the constraint
    ALTER TABLE component_stock
    ADD CONSTRAINT component_stock_location_check
    CHECK (location IN ('Warehouse', 'Refurb', 'Scrap', 'Staging', 'SupplierReturn'));
  END IF;
END $$;


-- ============================================================================
-- SECTION 3: Fix Race Condition in rpc_pick_batch_reserve
-- ============================================================================

-- The original function has a race condition:
-- 1. It checks availability for all lines
-- 2. Then reserves stock for all lines
-- Between steps 1 and 2, another transaction could reserve the same stock.
--
-- Fix: Use FOR UPDATE lock on component_stock rows when checking availability
-- to prevent concurrent transactions from reading/modifying the same rows.

CREATE OR REPLACE FUNCTION rpc_pick_batch_reserve(
  p_pick_batch_id uuid,
  p_actor_type text,
  p_actor_id text,
  p_actor_display text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_batch_status text;
  v_line record;
  v_stock record;
  v_shortages jsonb := '[]'::jsonb;
  v_has_shortage boolean := false;
BEGIN
  -- Lock the batch row first to prevent concurrent reserve attempts
  SELECT status INTO v_batch_status
  FROM pick_batches
  WHERE id = p_pick_batch_id
  FOR UPDATE;

  IF v_batch_status IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'BATCH_NOT_FOUND',
        'message', 'Pick batch not found'
      )
    );
  END IF;

  IF v_batch_status != 'DRAFT' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'INVALID_STATUS',
        'message', 'Pick batch must be in DRAFT status to reserve',
        'details', jsonb_build_object('current_status', v_batch_status)
      )
    );
  END IF;

  -- Check availability for all lines WITH FOR UPDATE lock on component_stock
  -- This prevents race conditions by locking the stock rows during the check
  FOR v_line IN
    SELECT pbl.*, c.internal_sku, c.description as component_description
    FROM pick_batch_lines pbl
    JOIN components c ON c.id = pbl.component_id
    WHERE pbl.pick_batch_id = p_pick_batch_id
  LOOP
    -- Ensure stock record exists
    PERFORM ensure_component_stock(v_line.component_id, v_line.location);

    -- Lock the component_stock row with FOR UPDATE to prevent race conditions
    -- This is the critical fix: we now hold a lock on the row while checking
    SELECT id, on_hand, reserved, (on_hand - reserved) as available
    INTO v_stock
    FROM component_stock
    WHERE component_id = v_line.component_id AND location = v_line.location
    FOR UPDATE;

    IF v_stock.available IS NULL THEN
      v_stock.available := 0;
    END IF;

    IF v_stock.available < v_line.qty_required THEN
      v_has_shortage := true;
      v_shortages := v_shortages || jsonb_build_object(
        'component_id', v_line.component_id,
        'internal_sku', v_line.internal_sku,
        'description', v_line.component_description,
        'location', v_line.location,
        'required', v_line.qty_required,
        'available', COALESCE(v_stock.available, 0),
        'shortage', v_line.qty_required - COALESCE(v_stock.available, 0)
      );
    END IF;
  END LOOP;

  -- If any shortages, fail atomically (locks are released on rollback/commit)
  IF v_has_shortage THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'INSUFFICIENT_STOCK',
        'message', 'One or more components have insufficient available stock',
        'details', jsonb_build_object('shortages', v_shortages)
      )
    );
  END IF;

  -- Reserve stock for all lines
  -- The FOR UPDATE locks are still held, so we can safely update
  FOR v_line IN
    SELECT * FROM pick_batch_lines WHERE pick_batch_id = p_pick_batch_id
  LOOP
    -- Update reserved count
    UPDATE component_stock
    SET reserved = reserved + v_line.qty_required
    WHERE component_id = v_line.component_id AND location = v_line.location;

    -- Record stock movement for audit trail
    INSERT INTO stock_movements (
      component_id, location, on_hand_delta, reserved_delta,
      reason, reference_type, reference_id, note,
      actor_type, actor_id, actor_display
    ) VALUES (
      v_line.component_id, v_line.location, 0, v_line.qty_required,
      'RESERVE', 'PICK_BATCH', p_pick_batch_id::text,
      'Reserved for pick batch',
      p_actor_type, p_actor_id, p_actor_display
    );
  END LOOP;

  -- Update batch status to RESERVED
  UPDATE pick_batches
  SET
    status = 'RESERVED',
    reserved_at = now(),
    reserved_by_actor_type = p_actor_type,
    reserved_by_actor_id = p_actor_id,
    reserved_by_actor_display = p_actor_display
  WHERE id = p_pick_batch_id;

  RETURN jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'pick_batch_id', p_pick_batch_id,
      'status', 'RESERVED'
    )
  );
END;
$$;

-- Add comment documenting the race condition fix
COMMENT ON FUNCTION rpc_pick_batch_reserve(uuid, text, text, text) IS
'Reserves stock for all lines in a pick batch. Uses FOR UPDATE locks on component_stock rows to prevent race conditions where concurrent transactions could reserve the same stock.';
