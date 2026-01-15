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

    await auditLog({
      entityType: 'STOCK',
      entityId: component_id,
      action: 'UPDATE',
      afterJson: rpcResult.data,
      changesSummary: `Adjusted by ${on_hand_delta} at ${location} (${reason})`,
      ...getAuditContext(req)
    });

    sendSuccess(res, rpcResult.data);
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
