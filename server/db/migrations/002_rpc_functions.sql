-- ============================================================================
-- Amazon Hub Brain - RPC Functions for Atomic Stock Operations
-- Version: 002
-- Description: All stock-affecting operations must go through these RPCs
-- ============================================================================

-- ============================================================================
-- HELPER: Ensure Component Stock Record Exists
-- ============================================================================

CREATE OR REPLACE FUNCTION ensure_component_stock(
  p_component_id uuid,
  p_location text DEFAULT 'Warehouse'
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_stock_id uuid;
BEGIN
  -- Try to find existing record
  SELECT id INTO v_stock_id
  FROM component_stock
  WHERE component_id = p_component_id AND location = p_location;

  -- Create if not exists
  IF v_stock_id IS NULL THEN
    INSERT INTO component_stock (component_id, location, on_hand, reserved)
    VALUES (p_component_id, p_location, 0, 0)
    RETURNING id INTO v_stock_id;
  END IF;

  RETURN v_stock_id;
END;
$$;

-- ============================================================================
-- RPC: Stock Receive
-- Increases on_hand for a component at a location
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_stock_receive(
  p_component_id uuid,
  p_location text,
  p_qty integer,
  p_note text,
  p_actor_type text,
  p_actor_id text,
  p_actor_display text,
  p_reference_type text DEFAULT 'MANUAL',
  p_reference_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_stock_id uuid;
  v_new_on_hand integer;
BEGIN
  -- Validate inputs
  IF p_qty <= 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'INVALID_QUANTITY',
        'message', 'Quantity must be greater than 0'
      )
    );
  END IF;

  -- Ensure stock record exists
  v_stock_id := ensure_component_stock(p_component_id, p_location);

  -- Update stock
  UPDATE component_stock
  SET on_hand = on_hand + p_qty
  WHERE id = v_stock_id
  RETURNING on_hand INTO v_new_on_hand;

  -- Record movement
  INSERT INTO stock_movements (
    component_id, location, on_hand_delta, reserved_delta,
    reason, reference_type, reference_id, note,
    actor_type, actor_id, actor_display
  ) VALUES (
    p_component_id, p_location, p_qty, 0,
    'RECEIVE', p_reference_type, p_reference_id, p_note,
    p_actor_type, p_actor_id, p_actor_display
  );

  RETURN jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'component_id', p_component_id,
      'location', p_location,
      'qty_received', p_qty,
      'new_on_hand', v_new_on_hand
    )
  );
END;
$$;

-- ============================================================================
-- RPC: Stock Adjust
-- Adjusts on_hand for a component with specified reason
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_stock_adjust(
  p_component_id uuid,
  p_location text,
  p_on_hand_delta integer,
  p_reason text,
  p_note text,
  p_actor_type text,
  p_actor_id text,
  p_actor_display text,
  p_reference_type text DEFAULT 'MANUAL',
  p_reference_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_stock_id uuid;
  v_current_on_hand integer;
  v_new_on_hand integer;
BEGIN
  -- Validate reason
  IF p_reason NOT IN ('ADJUST', 'DAMAGE', 'SHRINK', 'CORRECTION') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'INVALID_REASON',
        'message', 'Reason must be one of: ADJUST, DAMAGE, SHRINK, CORRECTION'
      )
    );
  END IF;

  -- Ensure stock record exists
  v_stock_id := ensure_component_stock(p_component_id, p_location);

  -- Get current stock
  SELECT on_hand INTO v_current_on_hand
  FROM component_stock
  WHERE id = v_stock_id;

  -- Check if adjustment would make on_hand negative
  IF (v_current_on_hand + p_on_hand_delta) < 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'INSUFFICIENT_STOCK',
        'message', 'Adjustment would result in negative on_hand',
        'details', jsonb_build_object(
          'current_on_hand', v_current_on_hand,
          'requested_delta', p_on_hand_delta
        )
      )
    );
  END IF;

  -- Update stock
  UPDATE component_stock
  SET on_hand = on_hand + p_on_hand_delta
  WHERE id = v_stock_id
  RETURNING on_hand INTO v_new_on_hand;

  -- Record movement
  INSERT INTO stock_movements (
    component_id, location, on_hand_delta, reserved_delta,
    reason, reference_type, reference_id, note,
    actor_type, actor_id, actor_display
  ) VALUES (
    p_component_id, p_location, p_on_hand_delta, 0,
    p_reason, p_reference_type, p_reference_id, p_note,
    p_actor_type, p_actor_id, p_actor_display
  );

  RETURN jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'component_id', p_component_id,
      'location', p_location,
      'delta', p_on_hand_delta,
      'previous_on_hand', v_current_on_hand,
      'new_on_hand', v_new_on_hand
    )
  );
END;
$$;

-- ============================================================================
-- RPC: Pick Batch Reserve
-- Reserves stock for all lines in a pick batch
-- ============================================================================

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
  v_available integer;
  v_shortages jsonb := '[]'::jsonb;
  v_has_shortage boolean := false;
BEGIN
  -- Lock the batch row
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

  -- Check availability for all lines
  FOR v_line IN
    SELECT pbl.*, c.internal_sku, c.description as component_description
    FROM pick_batch_lines pbl
    JOIN components c ON c.id = pbl.component_id
    WHERE pbl.pick_batch_id = p_pick_batch_id
  LOOP
    -- Ensure stock record exists and get available
    PERFORM ensure_component_stock(v_line.component_id, v_line.location);

    SELECT (on_hand - reserved) INTO v_available
    FROM component_stock
    WHERE component_id = v_line.component_id AND location = v_line.location;

    IF v_available IS NULL THEN
      v_available := 0;
    END IF;

    IF v_available < v_line.qty_required THEN
      v_has_shortage := true;
      v_shortages := v_shortages || jsonb_build_object(
        'component_id', v_line.component_id,
        'internal_sku', v_line.internal_sku,
        'description', v_line.component_description,
        'location', v_line.location,
        'required', v_line.qty_required,
        'available', v_available,
        'shortage', v_line.qty_required - v_available
      );
    END IF;
  END LOOP;

  -- If any shortages, fail atomically
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
  FOR v_line IN
    SELECT * FROM pick_batch_lines WHERE pick_batch_id = p_pick_batch_id
  LOOP
    -- Update reserved
    UPDATE component_stock
    SET reserved = reserved + v_line.qty_required
    WHERE component_id = v_line.component_id AND location = v_line.location;

    -- Record movement
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

  -- Update batch status
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

-- ============================================================================
-- RPC: Pick Batch Confirm
-- Confirms a reserved pick batch, decrementing on_hand and reserved
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_pick_batch_confirm(
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
  v_order_id uuid;
BEGIN
  -- Lock the batch row
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

  IF v_batch_status != 'RESERVED' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'INVALID_STATUS',
        'message', 'Pick batch must be in RESERVED status to confirm',
        'details', jsonb_build_object('current_status', v_batch_status)
      )
    );
  END IF;

  -- Process each line
  FOR v_line IN
    SELECT * FROM pick_batch_lines WHERE pick_batch_id = p_pick_batch_id
  LOOP
    -- Decrement both on_hand and reserved
    UPDATE component_stock
    SET
      on_hand = on_hand - v_line.qty_required,
      reserved = reserved - v_line.qty_required
    WHERE component_id = v_line.component_id AND location = v_line.location;

    -- Record movement
    INSERT INTO stock_movements (
      component_id, location, on_hand_delta, reserved_delta,
      reason, reference_type, reference_id, note,
      actor_type, actor_id, actor_display
    ) VALUES (
      v_line.component_id, v_line.location,
      -v_line.qty_required, -v_line.qty_required,
      'DISPATCH', 'PICK_BATCH', p_pick_batch_id::text,
      'Dispatched via pick batch confirmation',
      p_actor_type, p_actor_id, p_actor_display
    );
  END LOOP;

  -- Update batch status
  UPDATE pick_batches
  SET
    status = 'CONFIRMED',
    confirmed_at = now(),
    confirmed_by_actor_type = p_actor_type,
    confirmed_by_actor_id = p_actor_id,
    confirmed_by_actor_display = p_actor_display
  WHERE id = p_pick_batch_id;

  -- Update order statuses to PICKED
  FOR v_order_id IN
    SELECT order_id FROM pick_batch_orders WHERE pick_batch_id = p_pick_batch_id
  LOOP
    UPDATE orders SET status = 'PICKED' WHERE id = v_order_id;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'pick_batch_id', p_pick_batch_id,
      'status', 'CONFIRMED',
      'confirmed_at', now()
    )
  );
END;
$$;

-- ============================================================================
-- RPC: Pick Batch Cancel
-- Cancels a pick batch, releasing reserved stock if applicable
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_pick_batch_cancel(
  p_pick_batch_id uuid,
  p_actor_type text,
  p_actor_id text,
  p_actor_display text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_batch_status text;
  v_line record;
BEGIN
  -- Lock the batch row
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

  IF v_batch_status = 'CONFIRMED' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'CANNOT_CANCEL_CONFIRMED',
        'message', 'Cannot cancel a confirmed pick batch'
      )
    );
  END IF;

  IF v_batch_status = 'CANCELLED' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'ALREADY_CANCELLED',
        'message', 'Pick batch is already cancelled'
      )
    );
  END IF;

  -- If RESERVED, release the reserved stock
  IF v_batch_status = 'RESERVED' THEN
    FOR v_line IN
      SELECT * FROM pick_batch_lines WHERE pick_batch_id = p_pick_batch_id
    LOOP
      -- Release reserved
      UPDATE component_stock
      SET reserved = reserved - v_line.qty_required
      WHERE component_id = v_line.component_id AND location = v_line.location;

      -- Record movement
      INSERT INTO stock_movements (
        component_id, location, on_hand_delta, reserved_delta,
        reason, reference_type, reference_id, note,
        actor_type, actor_id, actor_display
      ) VALUES (
        v_line.component_id, v_line.location, 0, -v_line.qty_required,
        'UNRESERVE', 'PICK_BATCH', p_pick_batch_id::text,
        COALESCE(p_note, 'Released due to pick batch cancellation'),
        p_actor_type, p_actor_id, p_actor_display
      );
    END LOOP;
  END IF;

  -- Update batch status
  UPDATE pick_batches
  SET
    status = 'CANCELLED',
    cancelled_at = now(),
    cancelled_by_actor_type = p_actor_type,
    cancelled_by_actor_id = p_actor_id,
    cancelled_by_actor_display = p_actor_display,
    note = COALESCE(p_note, note)
  WHERE id = p_pick_batch_id;

  RETURN jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'pick_batch_id', p_pick_batch_id,
      'previous_status', v_batch_status,
      'status', 'CANCELLED'
    )
  );
END;
$$;

-- ============================================================================
-- RPC: Return Process
-- Processes a return, updating stock based on disposition
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_return_process(
  p_return_id uuid,
  p_actor_type text,
  p_actor_id text,
  p_actor_display text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_return_status text;
  v_line record;
  v_target_location text;
  v_processed_lines jsonb := '[]'::jsonb;
BEGIN
  -- Lock the return row
  SELECT status INTO v_return_status
  FROM returns
  WHERE id = p_return_id
  FOR UPDATE;

  IF v_return_status IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'RETURN_NOT_FOUND',
        'message', 'Return not found'
      )
    );
  END IF;

  IF v_return_status != 'INSPECTED' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'INVALID_STATUS',
        'message', 'Return must be in INSPECTED status to process',
        'details', jsonb_build_object('current_status', v_return_status)
      )
    );
  END IF;

  -- Check for any UNDECIDED dispositions
  IF EXISTS (
    SELECT 1 FROM return_lines
    WHERE return_id = p_return_id AND disposition = 'UNDECIDED'
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'UNDECIDED_LINES',
        'message', 'All return lines must have a disposition before processing'
      )
    );
  END IF;

  -- Process each line based on disposition
  FOR v_line IN
    SELECT rl.*, c.internal_sku
    FROM return_lines rl
    JOIN components c ON c.id = rl.component_id
    WHERE rl.return_id = p_return_id
  LOOP
    CASE v_line.disposition
      WHEN 'RESTOCK' THEN
        v_target_location := 'Warehouse';
        PERFORM ensure_component_stock(v_line.component_id, v_target_location);

        UPDATE component_stock
        SET on_hand = on_hand + v_line.qty
        WHERE component_id = v_line.component_id AND location = v_target_location;

        INSERT INTO stock_movements (
          component_id, location, on_hand_delta, reserved_delta,
          reason, reference_type, reference_id, note,
          actor_type, actor_id, actor_display
        ) VALUES (
          v_line.component_id, v_target_location, v_line.qty, 0,
          'RETURN_RESTOCK', 'RETURN', p_return_id::text,
          'Restocked from return - condition: ' || v_line.condition,
          p_actor_type, p_actor_id, p_actor_display
        );

      WHEN 'REFURB' THEN
        v_target_location := 'Refurb';
        PERFORM ensure_component_stock(v_line.component_id, v_target_location);

        UPDATE component_stock
        SET on_hand = on_hand + v_line.qty
        WHERE component_id = v_line.component_id AND location = v_target_location;

        INSERT INTO stock_movements (
          component_id, location, on_hand_delta, reserved_delta,
          reason, reference_type, reference_id, note,
          actor_type, actor_id, actor_display
        ) VALUES (
          v_line.component_id, v_target_location, v_line.qty, 0,
          'RETURN_REFURB', 'RETURN', p_return_id::text,
          'Sent to refurb - condition: ' || v_line.condition,
          p_actor_type, p_actor_id, p_actor_display
        );

      WHEN 'SCRAP' THEN
        -- No stock increase for scrap, just record the movement
        INSERT INTO stock_movements (
          component_id, location, on_hand_delta, reserved_delta,
          reason, reference_type, reference_id, note,
          actor_type, actor_id, actor_display
        ) VALUES (
          v_line.component_id, 'Scrap', 0, 0,
          'RETURN_SCRAP', 'RETURN', p_return_id::text,
          'Scrapped - condition: ' || v_line.condition || COALESCE(' - ' || v_line.inspection_note, ''),
          p_actor_type, p_actor_id, p_actor_display
        );

      WHEN 'SUPPLIER_RETURN' THEN
        -- No sellable stock increase, just record
        INSERT INTO stock_movements (
          component_id, location, on_hand_delta, reserved_delta,
          reason, reference_type, reference_id, note,
          actor_type, actor_id, actor_display
        ) VALUES (
          v_line.component_id, 'SupplierReturn', 0, 0,
          'SUPPLIER_RETURN', 'RETURN', p_return_id::text,
          'Returned to supplier - condition: ' || v_line.condition,
          p_actor_type, p_actor_id, p_actor_display
        );
    END CASE;

    v_processed_lines := v_processed_lines || jsonb_build_object(
      'component_id', v_line.component_id,
      'internal_sku', v_line.internal_sku,
      'qty', v_line.qty,
      'disposition', v_line.disposition
    );
  END LOOP;

  -- Update return status to CLOSED
  UPDATE returns
  SET
    status = 'CLOSED',
    closed_at = now(),
    closed_by_actor_type = p_actor_type,
    closed_by_actor_id = p_actor_id,
    closed_by_actor_display = p_actor_display
  WHERE id = p_return_id;

  RETURN jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'return_id', p_return_id,
      'status', 'CLOSED',
      'processed_lines', v_processed_lines
    )
  );
END;
$$;

-- ============================================================================
-- RPC: Get Constraints/Bottlenecks
-- Returns components that are constraining orders
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_get_constraints()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_constraints jsonb := '[]'::jsonb;
  v_component record;
  v_available integer;
  v_required integer;
  v_bundles_affected integer;
  v_orders_affected integer;
BEGIN
  -- For each component with insufficient available stock
  FOR v_component IN
    SELECT
      c.id,
      c.internal_sku,
      c.description,
      COALESCE(SUM(cs.on_hand), 0) as total_on_hand,
      COALESCE(SUM(cs.reserved), 0) as total_reserved,
      COALESCE(SUM(cs.on_hand - cs.reserved), 0) as total_available
    FROM components c
    LEFT JOIN component_stock cs ON cs.component_id = c.id
    WHERE c.is_active = true
    GROUP BY c.id, c.internal_sku, c.description
  LOOP
    -- Calculate required from pending orders
    SELECT COALESCE(SUM(bc.qty_required * ol.quantity), 0)
    INTO v_required
    FROM order_lines ol
    JOIN orders o ON o.id = ol.order_id
    JOIN bom_components bc ON bc.bom_id = ol.bom_id
    WHERE bc.component_id = v_component.id
      AND o.status IN ('READY_TO_PICK', 'NEEDS_REVIEW', 'IMPORTED');

    -- Count affected BOMs
    SELECT COUNT(DISTINCT bom_id)
    INTO v_bundles_affected
    FROM bom_components
    WHERE component_id = v_component.id;

    -- Count affected orders
    SELECT COUNT(DISTINCT o.id)
    INTO v_orders_affected
    FROM orders o
    JOIN order_lines ol ON ol.order_id = o.id
    JOIN bom_components bc ON bc.bom_id = ol.bom_id
    WHERE bc.component_id = v_component.id
      AND o.status IN ('READY_TO_PICK', 'NEEDS_REVIEW', 'IMPORTED')
      AND v_component.total_available < (bc.qty_required * ol.quantity);

    -- Only include if there's a constraint
    IF v_required > 0 AND v_component.total_available < v_required THEN
      v_constraints := v_constraints || jsonb_build_object(
        'component_id', v_component.id,
        'internal_sku', v_component.internal_sku,
        'description', v_component.description,
        'on_hand', v_component.total_on_hand,
        'reserved', v_component.total_reserved,
        'available', v_component.total_available,
        'required', v_required,
        'shortage', v_required - v_component.total_available,
        'bundles_affected', v_bundles_affected,
        'orders_affected', v_orders_affected,
        'severity', CASE
          WHEN v_component.total_available = 0 THEN 'CRITICAL'
          WHEN v_component.total_available < v_required * 0.25 THEN 'HIGH'
          WHEN v_component.total_available < v_required * 0.5 THEN 'MEDIUM'
          ELSE 'LOW'
        END
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'data', v_constraints
  );
END;
$$;

-- ============================================================================
-- RPC: Evaluate Order Readiness
-- Recalculates order status based on line resolution
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_evaluate_order_readiness(p_order_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_order record;
  v_updated_count integer := 0;
  v_all_resolved boolean;
BEGIN
  FOR v_order IN
    SELECT id, status
    FROM orders
    WHERE (p_order_id IS NULL OR id = p_order_id)
      AND status NOT IN ('PICKED', 'DISPATCHED', 'CANCELLED')
  LOOP
    -- Check if all lines are resolved
    SELECT NOT EXISTS (
      SELECT 1 FROM order_lines
      WHERE order_id = v_order.id AND is_resolved = false
    ) INTO v_all_resolved;

    IF v_all_resolved AND v_order.status != 'READY_TO_PICK' THEN
      UPDATE orders SET status = 'READY_TO_PICK' WHERE id = v_order.id;
      v_updated_count := v_updated_count + 1;
    ELSIF NOT v_all_resolved AND v_order.status NOT IN ('NEEDS_REVIEW', 'IMPORTED') THEN
      UPDATE orders SET status = 'NEEDS_REVIEW' WHERE id = v_order.id;
      v_updated_count := v_updated_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object('orders_updated', v_updated_count)
  );
END;
$$;

-- ============================================================================
-- GRANT EXECUTE TO authenticated role (for Supabase)
-- ============================================================================

-- Note: In Supabase, you may need to grant execute permissions
-- GRANT EXECUTE ON FUNCTION rpc_stock_receive TO authenticated;
-- GRANT EXECUTE ON FUNCTION rpc_stock_adjust TO authenticated;
-- GRANT EXECUTE ON FUNCTION rpc_pick_batch_reserve TO authenticated;
-- GRANT EXECUTE ON FUNCTION rpc_pick_batch_confirm TO authenticated;
-- GRANT EXECUTE ON FUNCTION rpc_pick_batch_cancel TO authenticated;
-- GRANT EXECUTE ON FUNCTION rpc_return_process TO authenticated;
-- GRANT EXECUTE ON FUNCTION rpc_get_constraints TO authenticated;
-- GRANT EXECUTE ON FUNCTION rpc_evaluate_order_readiness TO authenticated;
