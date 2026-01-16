import express from 'express';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { requireIdempotencyKey } from '../middleware/idempotency.js';
import { auditLog, getAuditContext, recordSystemEvent } from '../services/audit.js';

const router = express.Router();

/**
 * GET /pick-batches
 * Get all pick batches with optional status filter
 */
router.get('/', async (req, res) => {
  const { status, limit = 50, offset = 0 } = req.query;

  try {
    let query = supabase
      .from('pick_batches')
      .select(`
        *,
        pick_batch_orders (
          order_id,
          orders (
            id,
            external_order_id,
            status
          )
        ),
        pick_batch_lines (
          id,
          component_id,
          location,
          qty_required,
          components (
            id,
            internal_sku,
            description
          )
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error, count } = await query.range(
      parseInt(offset),
      parseInt(offset) + parseInt(limit) - 1
    );

    if (error) {
      console.error('Pick batches fetch error:', error);
      return errors.internal(res, 'Failed to fetch pick batches');
    }

    sendSuccess(res, {
      pick_batches: data,
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (err) {
    console.error('Pick batches fetch error:', err);
    errors.internal(res, 'Failed to fetch pick batches');
  }
});

/**
 * GET /pick-batches/:id
 * Get a single pick batch with all details
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from('pick_batches')
      .select(`
        *,
        pick_batch_orders (
          order_id,
          orders (
            id,
            external_order_id,
            status,
            customer_name,
            customer_email,
            order_lines (
              id,
              asin,
              sku,
              title,
              quantity,
              bom_id,
              boms (
                id,
                bundle_sku,
                description
              )
            )
          )
        ),
        pick_batch_lines (
          id,
          component_id,
          location,
          qty_required,
          components (
            id,
            internal_sku,
            description,
            brand
          )
        )
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return errors.notFound(res, 'Pick batch');
      }
      console.error('Pick batch fetch error:', error);
      return errors.internal(res, 'Failed to fetch pick batch');
    }

    sendSuccess(res, data);
  } catch (err) {
    console.error('Pick batch fetch error:', err);
    errors.internal(res, 'Failed to fetch pick batch');
  }
});

/**
 * POST /pick-batches
 * Create a new pick batch from READY_TO_PICK orders
 * Creates the batch with aggregated component requirements
 */
router.post('/', async (req, res) => {
  const { order_ids, note } = req.body;

  if (!order_ids || !Array.isArray(order_ids) || order_ids.length === 0) {
    return errors.badRequest(res, 'order_ids array is required');
  }

  try {
    // Verify all orders are READY_TO_PICK
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('id, status, external_order_id')
      .in('id', order_ids);

    if (ordersError) {
      console.error('Orders fetch error:', ordersError);
      return errors.internal(res, 'Failed to verify orders');
    }

    if (orders.length !== order_ids.length) {
      return errors.badRequest(res, 'One or more orders not found');
    }

    const nonReadyOrders = orders.filter(o => o.status !== 'READY_TO_PICK');
    if (nonReadyOrders.length > 0) {
      return errors.badRequest(res, 'All orders must be in READY_TO_PICK status', {
        invalid_orders: nonReadyOrders.map(o => ({
          id: o.id,
          external_order_id: o.external_order_id,
          status: o.status
        }))
      });
    }

    // Check if any orders are already in a non-cancelled pick batch
    const { data: existingBatchOrders, error: existingError } = await supabase
      .from('pick_batch_orders')
      .select(`
        order_id,
        pick_batches (
          id,
          status
        )
      `)
      .in('order_id', order_ids);

    if (existingError) {
      console.error('Existing batch check error:', existingError);
      return errors.internal(res, 'Failed to check existing batches');
    }

    const ordersInActiveBatch = existingBatchOrders.filter(
      pbo => pbo.pick_batches && pbo.pick_batches.status !== 'CANCELLED'
    );

    if (ordersInActiveBatch.length > 0) {
      return errors.conflict(res, 'Some orders are already in an active pick batch', {
        conflicting_orders: ordersInActiveBatch.map(pbo => pbo.order_id)
      });
    }

    // Get all order lines (without FK hint - fetch bom_components separately)
    const { data: orderLines, error: linesError } = await supabase
      .from('order_lines')
      .select('id, order_id, quantity, bom_id')
      .in('order_id', order_ids)
      .eq('is_resolved', true);

    if (linesError) {
      console.error('Order lines fetch error:', linesError);
      return errors.internal(res, 'Failed to fetch order lines');
    }

    // Get unique bom_ids and fetch their components separately
    const bomIds = [...new Set(orderLines?.filter(ol => ol.bom_id).map(ol => ol.bom_id) || [])];
    let bomComponentsMap = {};

    if (bomIds.length > 0) {
      const { data: bomComponents, error: bcError } = await supabase
        .from('bom_components')
        .select('bom_id, component_id, qty_required')
        .in('bom_id', bomIds);

      if (bcError) {
        console.error('BOM components fetch error:', bcError);
        return errors.internal(res, 'Failed to fetch BOM components');
      }

      // Group bom_components by bom_id
      for (const bc of bomComponents || []) {
        if (!bomComponentsMap[bc.bom_id]) {
          bomComponentsMap[bc.bom_id] = [];
        }
        bomComponentsMap[bc.bom_id].push({
          component_id: bc.component_id,
          qty_required: bc.qty_required
        });
      }
    }

    // Aggregate component requirements
    const componentRequirements = {};
    for (const line of orderLines || []) {
      const bomComponents = bomComponentsMap[line.bom_id] || [];
      for (const bc of bomComponents) {
        const key = `${bc.component_id}:Warehouse`; // Default location
        if (!componentRequirements[key]) {
          componentRequirements[key] = {
            component_id: bc.component_id,
            location: 'Warehouse',
            qty_required: 0
          };
        }
        componentRequirements[key].qty_required += bc.qty_required * line.quantity;
      }
    }

    const pickBatchLines = Object.values(componentRequirements);

    if (pickBatchLines.length === 0) {
      return errors.badRequest(res, 'No components to pick for these orders');
    }

    // Create pick batch
    const { data: pickBatch, error: batchError } = await supabase
      .from('pick_batches')
      .insert({
        status: 'DRAFT',
        note,
        created_by_actor_type: req.actor.type,
        created_by_actor_id: req.actor.id,
        created_by_actor_display: req.actor.display
      })
      .select()
      .single();

    if (batchError) {
      console.error('Pick batch create error:', batchError);
      return errors.internal(res, 'Failed to create pick batch');
    }

    // Create pick batch orders
    const { error: batchOrdersError } = await supabase
      .from('pick_batch_orders')
      .insert(order_ids.map(orderId => ({
        pick_batch_id: pickBatch.id,
        order_id: orderId
      })));

    if (batchOrdersError) {
      console.error('Pick batch orders create error:', batchOrdersError);
      // Cleanup
      await supabase.from('pick_batches').delete().eq('id', pickBatch.id);
      return errors.internal(res, 'Failed to create pick batch orders');
    }

    // Create pick batch lines (IMMUTABLE after creation)
    const { error: batchLinesError } = await supabase
      .from('pick_batch_lines')
      .insert(pickBatchLines.map(line => ({
        pick_batch_id: pickBatch.id,
        component_id: line.component_id,
        location: line.location,
        qty_required: line.qty_required
      })));

    if (batchLinesError) {
      console.error('Pick batch lines create error:', batchLinesError);
      // Cleanup
      await supabase.from('pick_batch_orders').delete().eq('pick_batch_id', pickBatch.id);
      await supabase.from('pick_batches').delete().eq('id', pickBatch.id);
      return errors.internal(res, 'Failed to create pick batch lines');
    }

    await recordSystemEvent({
      eventType: 'PICK_BATCH_CREATED',
      entityType: 'PICK_BATCH',
      entityId: pickBatch.id,
      description: `Pick batch #${pickBatch.batch_number} created with ${order_ids.length} orders`,
      metadata: { order_count: order_ids.length, line_count: pickBatchLines.length }
    });

    // Fetch the complete pick batch
    const { data: completeBatch, error: fetchError } = await supabase
      .from('pick_batches')
      .select(`
        *,
        pick_batch_orders (order_id),
        pick_batch_lines (
          id,
          component_id,
          location,
          qty_required,
          components (
            internal_sku,
            description
          )
        )
      `)
      .eq('id', pickBatch.id)
      .single();

    if (fetchError) {
      console.error('Pick batch fetch error:', fetchError);
    }

    sendSuccess(res, completeBatch || pickBatch, 201);
  } catch (err) {
    console.error('Pick batch create error:', err);
    errors.internal(res, 'Failed to create pick batch');
  }
});

/**
 * POST /pick-batches/:id/reserve
 * Reserve stock for a pick batch
 * ADMIN only, requires idempotency key
 */
router.post('/:id/reserve', requireIdempotencyKey, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await supabase.rpc('rpc_pick_batch_reserve', {
      p_pick_batch_id: id,
      p_actor_type: req.actor.type,
      p_actor_id: req.actor.id,
      p_actor_display: req.actor.display
    });

    if (result.error) {
      console.error('Pick batch reserve RPC error:', result.error);
      return errors.internal(res, 'Failed to reserve pick batch');
    }

    const rpcResult = result.data;
    if (!rpcResult.ok) {
      if (rpcResult.error.code === 'INSUFFICIENT_STOCK') {
        return errors.insufficientStock(res, rpcResult.error.details);
      }
      if (rpcResult.error.code === 'BATCH_NOT_FOUND') {
        return errors.notFound(res, 'Pick batch');
      }
      return errors.invalidStatus(res, rpcResult.error.message, rpcResult.error.details);
    }

    await recordSystemEvent({
      eventType: 'PICK_BATCH_RESERVED',
      entityType: 'PICK_BATCH',
      entityId: id,
      description: `Pick batch reserved by ${req.actor.display}`
    });

    sendSuccess(res, rpcResult.data);
  } catch (err) {
    console.error('Pick batch reserve error:', err);
    errors.internal(res, 'Failed to reserve pick batch');
  }
});

/**
 * POST /pick-batches/:id/confirm
 * Confirm a reserved pick batch (dispatches stock)
 * ADMIN only, requires idempotency key
 */
router.post('/:id/confirm', requireIdempotencyKey, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await supabase.rpc('rpc_pick_batch_confirm', {
      p_pick_batch_id: id,
      p_actor_type: req.actor.type,
      p_actor_id: req.actor.id,
      p_actor_display: req.actor.display
    });

    if (result.error) {
      console.error('Pick batch confirm RPC error:', result.error);
      return errors.internal(res, 'Failed to confirm pick batch');
    }

    const rpcResult = result.data;
    if (!rpcResult.ok) {
      if (rpcResult.error.code === 'BATCH_NOT_FOUND') {
        return errors.notFound(res, 'Pick batch');
      }
      return errors.invalidStatus(res, rpcResult.error.message, rpcResult.error.details);
    }

    await recordSystemEvent({
      eventType: 'PICK_BATCH_CONFIRMED',
      entityType: 'PICK_BATCH',
      entityId: id,
      description: `Pick batch confirmed by ${req.actor.display}`,
      severity: 'INFO'
    });

    sendSuccess(res, rpcResult.data);
  } catch (err) {
    console.error('Pick batch confirm error:', err);
    errors.internal(res, 'Failed to confirm pick batch');
  }
});

/**
 * POST /pick-batches/:id/cancel
 * Cancel a pick batch (releases reserved stock if applicable)
 * ADMIN only, requires idempotency key
 */
router.post('/:id/cancel', requireIdempotencyKey, async (req, res) => {
  const { id } = req.params;
  const { note } = req.body;

  try {
    const result = await supabase.rpc('rpc_pick_batch_cancel', {
      p_pick_batch_id: id,
      p_actor_type: req.actor.type,
      p_actor_id: req.actor.id,
      p_actor_display: req.actor.display,
      p_note: note || null
    });

    if (result.error) {
      console.error('Pick batch cancel RPC error:', result.error);
      return errors.internal(res, 'Failed to cancel pick batch');
    }

    const rpcResult = result.data;
    if (!rpcResult.ok) {
      if (rpcResult.error.code === 'BATCH_NOT_FOUND') {
        return errors.notFound(res, 'Pick batch');
      }
      if (rpcResult.error.code === 'CANNOT_CANCEL_CONFIRMED') {
        return errors.badRequest(res, rpcResult.error.message);
      }
      return errors.invalidStatus(res, rpcResult.error.message, rpcResult.error.details);
    }

    await recordSystemEvent({
      eventType: 'PICK_BATCH_CANCELLED',
      entityType: 'PICK_BATCH',
      entityId: id,
      description: `Pick batch cancelled by ${req.actor.display}`,
      metadata: { note }
    });

    sendSuccess(res, rpcResult.data);
  } catch (err) {
    console.error('Pick batch cancel error:', err);
    errors.internal(res, 'Failed to cancel pick batch');
  }
});

/**
 * GET /pick-batches/:id/print
 * Get printable picklist for a pick batch
 */
router.get('/:id/print', async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from('pick_batches')
      .select(`
        *,
        pick_batch_orders (
          orders (
            external_order_id,
            customer_name
          )
        ),
        pick_batch_lines (
          component_id,
          location,
          qty_required,
          components (
            internal_sku,
            description,
            brand
          )
        )
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return errors.notFound(res, 'Pick batch');
      }
      console.error('Pick batch fetch error:', error);
      return errors.internal(res, 'Failed to fetch pick batch');
    }

    // Format for printing - group by location
    const linesByLocation = {};
    for (const line of data.pick_batch_lines) {
      if (!linesByLocation[line.location]) {
        linesByLocation[line.location] = [];
      }
      linesByLocation[line.location].push({
        internal_sku: line.components.internal_sku,
        description: line.components.description,
        brand: line.components.brand,
        qty_required: line.qty_required
      });
    }

    sendSuccess(res, {
      batch_number: data.batch_number,
      status: data.status,
      created_at: data.created_at,
      order_count: data.pick_batch_orders.length,
      orders: data.pick_batch_orders.map(pbo => ({
        external_order_id: pbo.orders.external_order_id,
        customer_name: pbo.orders.customer_name
      })),
      lines_by_location: linesByLocation,
      total_lines: data.pick_batch_lines.length
    });
  } catch (err) {
    console.error('Pick batch print error:', err);
    errors.internal(res, 'Failed to generate printable picklist');
  }
});

export default router;
