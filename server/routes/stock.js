import express from 'express';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { requireAdmin } from '../middleware/auth.js';
import { requireIdempotencyKey } from '../middleware/idempotency.js';
import { auditLog, getAuditContext } from '../services/audit.js';

const router = express.Router();

/**
 * POST /stock/receive
 * Receive stock for a component at a location
 * ADMIN only, requires idempotency key
 */
router.post('/receive', requireAdmin, requireIdempotencyKey, async (req, res) => {
  const { component_id, location = 'Warehouse', qty, note } = req.body;

  if (!component_id) {
    return errors.badRequest(res, 'component_id is required');
  }

  if (!qty || qty <= 0) {
    return errors.badRequest(res, 'qty must be a positive integer');
  }

  try {
    const result = await supabase.rpc('rpc_stock_receive', {
      p_component_id: component_id,
      p_location: location,
      p_qty: qty,
      p_note: note || null,
      p_actor_type: req.actor.type,
      p_actor_id: req.actor.id,
      p_actor_display: req.actor.display,
      p_reference_type: 'MANUAL',
      p_reference_id: null
    });

    if (result.error) {
      console.error('Stock receive RPC error:', result.error);
      return errors.internal(res, 'Failed to receive stock');
    }

    const rpcResult = result.data;
    if (!rpcResult.ok) {
      return errors.badRequest(res, rpcResult.error.message, rpcResult.error.details);
    }

    await auditLog({
      entityType: 'STOCK',
      entityId: component_id,
      action: 'UPDATE',
      afterJson: rpcResult.data,
      changesSummary: `Received ${qty} units at ${location}`,
      ...getAuditContext(req)
    });

    sendSuccess(res, rpcResult.data);
  } catch (err) {
    console.error('Stock receive error:', err);
    errors.internal(res, 'Failed to receive stock');
  }
});

/**
 * POST /stock/adjust
 * Adjust stock for a component (damage, shrink, correction)
 * ADMIN only, requires idempotency key
 */
router.post('/adjust', requireAdmin, requireIdempotencyKey, async (req, res) => {
  const { component_id, location = 'Warehouse', on_hand_delta, reason, note } = req.body;
  const idempotencyKey = req.headers['idempotency-key'];

  if (!component_id) {
    return errors.badRequest(res, 'component_id is required');
  }

  if (on_hand_delta === undefined || on_hand_delta === null) {
    return errors.badRequest(res, 'on_hand_delta is required');
  }

  if (!reason) {
    return errors.badRequest(res, 'reason is required (ADJUST, DAMAGE, SHRINK, or CORRECTION)');
  }

  try {
    // Capture before_on_hand value
    const { data: beforeData } = await supabase
      .from('component_stock')
      .select('on_hand')
      .eq('component_id', component_id)
      .eq('location', location)
      .single();

    const before_on_hand = beforeData?.on_hand ?? 0;

    const result = await supabase.rpc('rpc_stock_adjust', {
      p_component_id: component_id,
      p_location: location,
      p_on_hand_delta: on_hand_delta,
      p_reason: reason,
      p_note: note || null,
      p_actor_type: req.actor.type,
      p_actor_id: req.actor.id,
      p_actor_display: req.actor.display,
      p_reference_type: 'MANUAL',
      p_reference_id: null
    });

    if (result.error) {
      console.error('Stock adjust RPC error:', result.error);
      return errors.internal(res, 'Failed to adjust stock');
    }

    const rpcResult = result.data;
    if (!rpcResult.ok) {
      if (rpcResult.error.code === 'INSUFFICIENT_STOCK') {
        return errors.insufficientStock(res, rpcResult.error.details);
      }
      return errors.badRequest(res, rpcResult.error.message, rpcResult.error.details);
    }

    const after_on_hand = before_on_hand + on_hand_delta;

    // Update stock_movements with idempotency_key and before/after values
    if (rpcResult.data?.movement_id) {
      await supabase
        .from('stock_movements')
        .update({
          idempotency_key: idempotencyKey,
          before_on_hand: before_on_hand,
          after_on_hand: after_on_hand
        })
        .eq('id', rpcResult.data.movement_id);
    }

    await auditLog({
      entityType: 'STOCK',
      entityId: component_id,
      action: 'UPDATE',
      afterJson: rpcResult.data,
      changesSummary: `Adjusted by ${on_hand_delta} at ${location} (${reason})`,
      ...getAuditContext(req)
    });

    // Include before/after values in response
    sendSuccess(res, {
      ...rpcResult.data,
      before_on_hand,
      after_on_hand,
      idempotency_key: idempotencyKey
    });
  } catch (err) {
    console.error('Stock adjust error:', err);
    errors.internal(res, 'Failed to adjust stock');
  }
});

/**
 * GET /stock
 * Get all stock levels
 */
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('component_stock')
      .select(`
        *,
        components (
          id,
          internal_sku,
          description,
          brand
        )
      `)
      .order('location')
      .order('component_id');

    if (error) {
      console.error('Stock fetch error:', error);
      return errors.internal(res, 'Failed to fetch stock');
    }

    // Add computed available field
    const stockWithAvailable = data.map(s => ({
      ...s,
      available: s.on_hand - s.reserved
    }));

    sendSuccess(res, stockWithAvailable);
  } catch (err) {
    console.error('Stock fetch error:', err);
    errors.internal(res, 'Failed to fetch stock');
  }
});

/**
 * GET /stock/:componentId
 * Get stock levels for a specific component
 */
router.get('/:componentId', async (req, res) => {
  const { componentId } = req.params;

  try {
    const { data, error } = await supabase
      .from('component_stock')
      .select(`
        *,
        components (
          id,
          internal_sku,
          description,
          brand
        )
      `)
      .eq('component_id', componentId);

    if (error) {
      console.error('Stock fetch error:', error);
      return errors.internal(res, 'Failed to fetch stock');
    }

    // Add computed available field
    const stockWithAvailable = data.map(s => ({
      ...s,
      available: s.on_hand - s.reserved
    }));

    sendSuccess(res, stockWithAvailable);
  } catch (err) {
    console.error('Stock fetch error:', err);
    errors.internal(res, 'Failed to fetch stock');
  }
});

/**
 * GET /stock/:componentId/movements
 * Get stock movements for a specific component
 */
router.get('/:componentId/movements', async (req, res) => {
  const { componentId } = req.params;
  const { limit = 100, offset = 0 } = req.query;

  try {
    const { data, error, count } = await supabase
      .from('stock_movements')
      .select('*', { count: 'exact' })
      .eq('component_id', componentId)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) {
      console.error('Movements fetch error:', error);
      return errors.internal(res, 'Failed to fetch movements');
    }

    sendSuccess(res, {
      movements: data,
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (err) {
    console.error('Movements fetch error:', err);
    errors.internal(res, 'Failed to fetch movements');
  }
});

/**
 * POST /stock/undo/:movementId
 * Undo a stock adjustment within 2-minute window
 * ADMIN only
 */
router.post('/undo/:movementId', requireAdmin, async (req, res) => {
  const { movementId } = req.params;
  const UNDO_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

  try {
    // Fetch the original movement
    const { data: movement, error: fetchError } = await supabase
      .from('stock_movements')
      .select('*')
      .eq('id', movementId)
      .single();

    if (fetchError || !movement) {
      return errors.notFound(res, 'Stock movement not found');
    }

    // Check if already undone
    if (movement.undone_at) {
      return errors.badRequest(res, 'This adjustment has already been undone');
    }

    // Check if this is itself an undo movement (prevent undo of undo)
    if (movement.reason === 'UNDO') {
      return errors.badRequest(res, 'Cannot undo an undo adjustment');
    }

    // Check 2-minute window (server-side enforcement)
    const movementTime = new Date(movement.created_at).getTime();
    const now = Date.now();
    const elapsedMs = now - movementTime;

    if (elapsedMs > UNDO_WINDOW_MS) {
      const elapsedSecs = Math.floor(elapsedMs / 1000);
      return errors.badRequest(res, `Undo window expired. Adjustment was made ${elapsedSecs} seconds ago (limit: 120 seconds)`);
    }

    // Calculate reverse delta
    const reverseDelta = -movement.delta;

    // Check if reverse adjustment would cause negative stock
    const { data: currentStock } = await supabase
      .from('component_stock')
      .select('on_hand')
      .eq('component_id', movement.component_id)
      .eq('location', movement.location)
      .single();

    const currentOnHand = currentStock?.on_hand ?? 0;
    const newOnHand = currentOnHand + reverseDelta;

    if (newOnHand < 0) {
      return errors.badRequest(res, `Cannot undo: reverse adjustment would result in negative stock (current: ${currentOnHand}, change: ${reverseDelta})`);
    }

    // Create reverse adjustment using the RPC
    const result = await supabase.rpc('rpc_stock_adjust', {
      p_component_id: movement.component_id,
      p_location: movement.location,
      p_on_hand_delta: reverseDelta,
      p_reason: 'UNDO',
      p_note: `Undo of movement ${movementId}`,
      p_actor_type: req.actor.type,
      p_actor_id: req.actor.id,
      p_actor_display: req.actor.display,
      p_reference_type: 'UNDO',
      p_reference_id: movementId
    });

    if (result.error) {
      console.error('Stock undo RPC error:', result.error);
      return errors.internal(res, 'Failed to create reverse adjustment');
    }

    const rpcResult = result.data;
    if (!rpcResult.ok) {
      return errors.badRequest(res, rpcResult.error.message, rpcResult.error.details);
    }

    const undoMovementId = rpcResult.data?.movement_id;

    // Mark original movement as undone
    const { error: updateError } = await supabase
      .from('stock_movements')
      .update({
        undone_at: new Date().toISOString(),
        undo_movement_id: undoMovementId
      })
      .eq('id', movementId);

    if (updateError) {
      console.error('Failed to mark movement as undone:', updateError);
      // Don't fail the request, the undo already succeeded
    }

    // Update the undo movement with before/after values
    if (undoMovementId) {
      await supabase
        .from('stock_movements')
        .update({
          before_on_hand: currentOnHand,
          after_on_hand: newOnHand,
          undo_of_movement_id: movementId
        })
        .eq('id', undoMovementId);
    }

    // Audit log for the undo
    await auditLog({
      entityType: 'STOCK',
      entityId: movement.component_id,
      action: 'UNDO',
      beforeJson: { original_movement_id: movementId, original_delta: movement.delta },
      afterJson: { undo_movement_id: undoMovementId, reverse_delta: reverseDelta },
      changesSummary: `Undid adjustment of ${movement.delta} at ${movement.location}`,
      ...getAuditContext(req)
    });

    sendSuccess(res, {
      undone: true,
      original_movement_id: movementId,
      undo_movement_id: undoMovementId,
      reverse_delta: reverseDelta,
      new_on_hand: newOnHand
    });
  } catch (err) {
    console.error('Stock undo error:', err);
    errors.internal(res, 'Failed to undo stock adjustment');
  }
});

/**
 * GET /stock/movements/recent
 * Get recent stock movements across all components
 */
router.get('/movements/recent', async (req, res) => {
  const { limit = 50 } = req.query;

  try {
    const { data, error } = await supabase
      .from('stock_movements')
      .select(`
        *,
        components (
          id,
          internal_sku,
          description
        )
      `)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (error) {
      console.error('Recent movements fetch error:', error);
      return errors.internal(res, 'Failed to fetch recent movements');
    }

    sendSuccess(res, data);
  } catch (err) {
    console.error('Recent movements fetch error:', err);
    errors.internal(res, 'Failed to fetch recent movements');
  }
});

export default router;
