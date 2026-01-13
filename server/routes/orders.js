import express from 'express';
import supabase from '../services/supabase.js';
import { fetchOpenOrders } from '../services/shopify.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { requireAdmin, requireStaff } from '../middleware/auth.js';
import { recordSystemEvent } from '../services/audit.js';
import { resolveListing } from '../utils/memoryResolution.js';
import { normalizeAsin, normalizeSku, fingerprintTitle } from '../utils/identityNormalization.js';

const router = express.Router();

/**
 * POST /orders/import
 * Import orders from Shopify
 * Idempotent - will not duplicate orders
 */
router.post('/import', requireStaff, async (req, res) => {
  try {
    const shopifyOrders = await fetchOpenOrders();

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    const importedOrderIds = [];

    for (const shopifyOrder of shopifyOrders) {
      const externalOrderId = shopifyOrder.id.toString();

      // Check if order already exists
      const { data: existing, error: existingError } = await supabase
        .from('orders')
        .select('id, status, raw_payload')
        .eq('external_order_id', externalOrderId)
        .eq('channel', 'shopify')
        .maybeSingle();

      if (existingError) {
        console.error('Order lookup error:', existingError);
        continue;
      }

      if (existing) {
        // Update raw_payload if changed (for audit purposes)
        const payloadChanged = JSON.stringify(existing.raw_payload) !== JSON.stringify(shopifyOrder);

        if (payloadChanged && existing.status !== 'PICKED' && existing.status !== 'DISPATCHED') {
          await supabase
            .from('orders')
            .update({ raw_payload: shopifyOrder })
            .eq('id', existing.id);
          updated++;
        } else {
          skipped++;
        }
        continue;
      }

      // Extract customer info
      const customerEmail = shopifyOrder.email || shopifyOrder.customer?.email || null;
      const customerName = shopifyOrder.customer
        ? `${shopifyOrder.customer.first_name || ''} ${shopifyOrder.customer.last_name || ''}`.trim()
        : null;

      // Extract shipping address
      const shippingAddress = shopifyOrder.shipping_address || null;

      // Calculate total in pence
      const totalPricePence = shopifyOrder.total_price
        ? Math.round(parseFloat(shopifyOrder.total_price) * 100)
        : null;

      // Insert order
      const { data: newOrder, error: orderError } = await supabase
        .from('orders')
        .insert({
          external_order_id: externalOrderId,
          channel: 'shopify',
          status: 'IMPORTED',
          order_date: shopifyOrder.created_at ? shopifyOrder.created_at.split('T')[0] : null,
          customer_email: customerEmail,
          customer_name: customerName,
          shipping_address: shippingAddress,
          raw_payload: shopifyOrder,
          total_price_pence: totalPricePence,
          currency: shopifyOrder.currency || 'GBP'
        })
        .select()
        .single();

      if (orderError) {
        console.error('Order insert error:', orderError);
        continue;
      }

      // Process line items
      let allLinesResolved = true;

      for (const lineItem of shopifyOrder.line_items || []) {
        // Extract ASIN from properties if present
        const asinProp = lineItem.properties?.find(p =>
          p.name.toLowerCase() === 'asin' || p.name.toLowerCase() === '_asin'
        );
        const asin = asinProp ? normalizeAsin(asinProp.value) : null;
        const sku = normalizeSku(lineItem.sku);
        const title = lineItem.title || lineItem.name;
        const fingerprint = fingerprintTitle(title);

        // Attempt to resolve listing
        const resolution = await resolveListing(asin, sku, title);

        const isResolved = resolution !== null && resolution.bom_id !== null;
        if (!isResolved) {
          allLinesResolved = false;
        }

        // Insert order line
        const { error: lineError } = await supabase
          .from('order_lines')
          .insert({
            order_id: newOrder.id,
            external_line_id: lineItem.id?.toString(),
            asin: asin,
            sku: sku,
            title: title,
            title_fingerprint: fingerprint,
            quantity: lineItem.quantity,
            unit_price_pence: lineItem.price ? Math.round(parseFloat(lineItem.price) * 100) : null,
            listing_memory_id: resolution?.id || null,
            bom_id: resolution?.bom_id || null,
            resolution_source: resolution ? 'MEMORY' : null,
            is_resolved: isResolved,
            parse_intent: null
          });

        if (lineError) {
          console.error('Order line insert error:', lineError);
        }

        // If not resolved, create review queue entry
        if (!isResolved) {
          await supabase.from('review_queue').insert({
            order_id: newOrder.id,
            order_line_id: null, // We don't have the line ID yet
            external_id: `${externalOrderId}-${lineItem.id}`,
            asin: asin,
            sku: sku,
            title: title,
            title_fingerprint: fingerprint,
            reason: resolution ? 'BOM_NOT_SET' : 'UNKNOWN_LISTING',
            status: 'PENDING'
          });
        }
      }

      // Update order status based on line resolution
      const newStatus = allLinesResolved ? 'READY_TO_PICK' : 'NEEDS_REVIEW';
      await supabase
        .from('orders')
        .update({ status: newStatus })
        .eq('id', newOrder.id);

      imported++;
      importedOrderIds.push(newOrder.id);
    }

    await recordSystemEvent({
      eventType: 'SHOPIFY_IMPORT',
      description: `Imported ${imported} orders, updated ${updated}, skipped ${skipped}`,
      metadata: {
        imported,
        updated,
        skipped,
        total_fetched: shopifyOrders.length
      }
    });

    sendSuccess(res, {
      imported,
      updated,
      skipped,
      total_fetched: shopifyOrders.length,
      imported_order_ids: importedOrderIds
    });
  } catch (err) {
    console.error('Order import error:', err);
    errors.internal(res, 'Failed to import orders from Shopify');
  }
});

/**
 * POST /orders/re-evaluate
 * Re-evaluate order readiness for non-picked orders
 */
router.post('/re-evaluate', requireStaff, async (req, res) => {
  const { order_ids } = req.body;

  try {
    const result = await supabase.rpc('rpc_evaluate_order_readiness', {
      p_order_id: order_ids?.length === 1 ? order_ids[0] : null
    });

    if (result.error) {
      console.error('Re-evaluate RPC error:', result.error);
      return errors.internal(res, 'Failed to re-evaluate orders');
    }

    sendSuccess(res, result.data?.data || { orders_updated: 0 });
  } catch (err) {
    console.error('Re-evaluate error:', err);
    errors.internal(res, 'Failed to re-evaluate orders');
  }
});

/**
 * GET /orders
 * Get all orders with optional filters
 */
router.get('/', async (req, res) => {
  const { status, channel, limit = 50, offset = 0 } = req.query;

  try {
    let query = supabase
      .from('orders')
      .select(`
        *,
        order_lines (
          id,
          asin,
          sku,
          title,
          quantity,
          unit_price_pence,
          is_resolved,
          resolution_source,
          bom_id,
          boms (
            id,
            bundle_sku,
            description
          )
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (status) {
      if (status.includes(',')) {
        query = query.in('status', status.split(','));
      } else {
        query = query.eq('status', status);
      }
    }

    if (channel) {
      query = query.eq('channel', channel);
    }

    const { data, error, count } = await query.range(
      parseInt(offset),
      parseInt(offset) + parseInt(limit) - 1
    );

    if (error) {
      console.error('Orders fetch error:', error);
      return errors.internal(res, 'Failed to fetch orders');
    }

    sendSuccess(res, {
      orders: data,
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (err) {
    console.error('Orders fetch error:', err);
    errors.internal(res, 'Failed to fetch orders');
  }
});

/**
 * GET /orders/:id
 * Get a single order with all details
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        order_lines (
          id,
          external_line_id,
          asin,
          sku,
          title,
          title_fingerprint,
          quantity,
          unit_price_pence,
          is_resolved,
          resolution_source,
          parse_intent,
          listing_memory_id,
          bom_id,
          listing_memory (
            id,
            asin,
            sku,
            title_fingerprint
          ),
          boms (
            id,
            bundle_sku,
            description,
            bom_components (
              qty_required,
              components (
                id,
                internal_sku,
                description
              )
            )
          )
        )
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return errors.notFound(res, 'Order');
      }
      console.error('Order fetch error:', error);
      return errors.internal(res, 'Failed to fetch order');
    }

    sendSuccess(res, data);
  } catch (err) {
    console.error('Order fetch error:', err);
    errors.internal(res, 'Failed to fetch order');
  }
});

/**
 * GET /orders/ready-to-pick
 * Get all orders ready to pick
 */
router.get('/status/ready-to-pick', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        order_lines (
          id,
          asin,
          sku,
          title,
          quantity,
          bom_id,
          boms (
            bundle_sku,
            description
          )
        )
      `)
      .eq('status', 'READY_TO_PICK')
      .order('order_date', { ascending: true });

    if (error) {
      console.error('Ready orders fetch error:', error);
      return errors.internal(res, 'Failed to fetch ready orders');
    }

    sendSuccess(res, data || []);
  } catch (err) {
    console.error('Ready orders fetch error:', err);
    errors.internal(res, 'Failed to fetch ready orders');
  }
});

/**
 * POST /orders/:id/cancel
 * Cancel an order (local status only, does not affect Shopify)
 * ADMIN only
 */
router.post('/:id/cancel', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { note } = req.body;

  try {
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('id, status')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return errors.notFound(res, 'Order');
      }
      throw fetchError;
    }

    if (order.status === 'PICKED' || order.status === 'DISPATCHED') {
      return errors.invalidStatus(res, 'Cannot cancel an order that has been picked or dispatched', {
        current_status: order.status
      });
    }

    const { error: updateError } = await supabase
      .from('orders')
      .update({ status: 'CANCELLED' })
      .eq('id', id);

    if (updateError) throw updateError;

    await recordSystemEvent({
      eventType: 'ORDER_CANCELLED',
      entityType: 'ORDER',
      entityId: id,
      description: `Order cancelled${note ? ': ' + note : ''}`,
      metadata: { previous_status: order.status, note }
    });

    sendSuccess(res, { message: 'Order cancelled' });
  } catch (err) {
    console.error('Order cancel error:', err);
    errors.internal(res, 'Failed to cancel order');
  }
});

export default router;
