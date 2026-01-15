/**
 * Shipping Routes
 * Handles Royal Mail Click & Drop integration and shipping workflows
 */
import express from 'express';
import supabase from '../services/supabase.js';
import royalMailClient, { SERVICE_CODES } from '../services/royalMail.js';
import spApiClient from '../services/spApi.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { requireAdmin, requireStaff } from '../middleware/auth.js';
import { recordSystemEvent } from '../services/audit.js';

const router = express.Router();

/**
 * GET /shipping/status
 * Check Royal Mail API connection status
 */
router.get('/status', async (req, res) => {
  const configured = royalMailClient.isConfigured();

  if (!configured) {
    return sendSuccess(res, {
      connected: false,
      configured: false,
      message: 'Royal Mail API not configured. Set ROYAL_MAIL_API_KEY.',
    });
  }

  try {
    // Try a simple API call to verify connection
    await royalMailClient.getOrders({ pageSize: 1 });

    sendSuccess(res, {
      connected: true,
      configured: true,
      message: 'Connected to Royal Mail Click & Drop',
    });
  } catch (err) {
    console.error('Royal Mail status check failed:', err);
    sendSuccess(res, {
      connected: false,
      configured: true,
      message: `Connection failed: ${err.message}`,
    });
  }
});

/**
 * GET /shipping/services
 * Get available Royal Mail service codes
 */
router.get('/services', (req, res) => {
  sendSuccess(res, {
    domestic: {
      'TRACKED_24': { code: SERVICE_CODES.TRACKED_24, name: 'Tracked 24', description: 'Next day delivery' },
      'TRACKED_48': { code: SERVICE_CODES.TRACKED_48, name: 'Tracked 48', description: '2-3 day delivery' },
      'FIRST_CLASS': { code: SERVICE_CODES.FIRST_CLASS, name: '1st Class', description: '1-2 days' },
      'SECOND_CLASS': { code: SERVICE_CODES.SECOND_CLASS, name: '2nd Class', description: '2-3 days' },
      'SIGNED_FOR_1ST': { code: SERVICE_CODES.SIGNED_FOR_1ST, name: 'Signed For 1st', description: 'Signature required' },
      'SPECIAL_DELIVERY_1PM': { code: SERVICE_CODES.SPECIAL_DELIVERY_1PM, name: 'Special Delivery by 1pm', description: 'Guaranteed' },
    },
    international: {
      'INTERNATIONAL_TRACKED': { code: SERVICE_CODES.INTERNATIONAL_TRACKED, name: 'International Tracked', description: 'Tracked delivery' },
      'INTERNATIONAL_TRACKED_SIGNED': { code: SERVICE_CODES.INTERNATIONAL_TRACKED_SIGNED, name: 'International Tracked & Signed', description: 'With signature' },
    },
  });
});

/**
 * GET /shipping/orders/ready
 * Get orders ready to ship (picked but not shipped)
 */
router.get('/orders/ready', requireStaff, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select(`
        id,
        external_order_id,
        amazon_order_id,
        order_number,
        channel,
        order_date,
        customer_name,
        customer_email,
        shipping_address,
        total_price_pence,
        currency,
        order_lines (
          id,
          title,
          quantity,
          asin,
          sku,
          unit_price_pence
        )
      `)
      .in('status', ['PICKED', 'READY_TO_PICK'])
      .order('order_date', { ascending: true });

    if (error) throw error;

    // Check which orders already have shipments
    const orderIds = data.map(o => o.id);
    const { data: existingShipments } = await supabase
      .from('amazon_shipments')
      .select('order_id')
      .in('order_id', orderIds);

    const shippedIds = new Set(existingShipments?.map(s => s.order_id) || []);

    // Filter and enrich orders
    const readyOrders = data
      .filter(o => !shippedIds.has(o.id))
      .map(order => ({
        ...order,
        is_amazon: order.channel === 'AMAZON' || !!order.amazon_order_id,
        can_create_label: royalMailClient.isConfigured(),
      }));

    sendSuccess(res, {
      count: readyOrders.length,
      orders: readyOrders,
    });
  } catch (err) {
    console.error('Failed to fetch ready orders:', err);
    errors.internal(res, 'Failed to fetch orders');
  }
});

/**
 * POST /shipping/label/create
 * Create a shipping label via Royal Mail Click & Drop
 */
router.post('/label/create', requireStaff, async (req, res) => {
  const { orderId, serviceCode = 'TPN' } = req.body;

  if (!orderId) {
    return errors.badRequest(res, 'orderId is required');
  }

  if (!royalMailClient.isConfigured()) {
    return errors.badRequest(res, 'Royal Mail API not configured');
  }

  try {
    // Get order details
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        *,
        order_lines (*)
      `)
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return errors.notFound(res, 'Order');
    }

    // Build the Royal Mail order payload
    const payload = royalMailClient.buildOrderPayload(order, order.order_lines, serviceCode);

    // Create the order in Click & Drop
    const result = await royalMailClient.createOrder(payload);

    // Store the Click & Drop order reference
    await supabase
      .from('amazon_shipments')
      .upsert({
        order_id: order.id,
        amazon_order_id: order.amazon_order_id || order.external_order_id,
        carrier_code: 'Royal Mail',
        carrier_name: 'Royal Mail',
        ship_method: serviceCode,
        items: order.order_lines,
        created_at: new Date().toISOString(),
      }, { onConflict: 'order_id' });

    await recordSystemEvent({
      eventType: 'SHIPPING_LABEL_CREATED',
      entityType: 'ORDER',
      entityId: orderId,
      description: `Royal Mail label created: ${serviceCode}`,
      metadata: { serviceCode, clickDropOrderId: result.orderId },
    });

    sendSuccess(res, {
      message: 'Label created in Click & Drop',
      clickDropOrderId: result.orderId,
      serviceCode,
    });
  } catch (err) {
    console.error('Failed to create shipping label:', err);
    errors.internal(res, `Failed to create label: ${err.message}`);
  }
});

/**
 * POST /shipping/sync-tracking
 * Sync tracking numbers from Royal Mail and confirm on Amazon
 */
router.post('/sync-tracking', requireAdmin, async (req, res) => {
  const { daysBack = 7, autoConfirmAmazon = true } = req.body;

  if (!royalMailClient.isConfigured()) {
    return errors.badRequest(res, 'Royal Mail API not configured');
  }

  try {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - daysBack);

    console.log(`[Shipping] Syncing Royal Mail orders from ${sinceDate.toISOString()}`);

    const rmOrders = await royalMailClient.getShippedOrders(sinceDate);

    const results = {
      processed: 0,
      trackingFound: 0,
      amazonConfirmed: 0,
      errors: [],
    };

    for (const rmOrder of rmOrders.orders || []) {
      results.processed++;

      const trackingNumber = rmOrder.trackingNumber;
      const channelRef = rmOrder.channelShippingRef;

      if (!trackingNumber) continue;
      results.trackingFound++;

      // Find matching order in our system
      const { data: order } = await supabase
        .from('orders')
        .select('id, channel, amazon_order_id, external_order_id')
        .or(`external_order_id.eq.${channelRef},amazon_order_id.eq.${channelRef}`)
        .maybeSingle();

      if (!order) continue;

      // Update shipment record
      await supabase
        .from('amazon_shipments')
        .upsert({
          order_id: order.id,
          amazon_order_id: order.amazon_order_id || order.external_order_id,
          carrier_code: 'Royal Mail',
          carrier_name: 'Royal Mail',
          tracking_number: trackingNumber,
          ship_date: rmOrder.shippedDate || new Date().toISOString(),
          confirmed_at: rmOrder.shippedDate || new Date().toISOString(),
        }, { onConflict: 'order_id' });

      // Update order status
      await supabase
        .from('orders')
        .update({
          status: 'DISPATCHED',
          updated_at: new Date().toISOString(),
        })
        .eq('id', order.id);

      // Confirm on Amazon if applicable
      if (autoConfirmAmazon && spApiClient.isConfigured()) {
        const amazonOrderId = order.amazon_order_id || (order.channel === 'AMAZON' ? order.external_order_id : null);

        if (amazonOrderId) {
          try {
            await spApiClient.confirmShipment(amazonOrderId, {
              carrierCode: 'Royal Mail',
              carrierName: 'Royal Mail',
              trackingNumber: trackingNumber,
              shipDate: rmOrder.shippedDate || new Date().toISOString(),
            });
            results.amazonConfirmed++;
          } catch (amazonErr) {
            console.error(`Failed to confirm on Amazon: ${amazonOrderId}`, amazonErr);
            results.errors.push({
              orderId: amazonOrderId,
              error: amazonErr.message,
            });
          }
        }
      }
    }

    await recordSystemEvent({
      eventType: 'SHIPPING_SYNC',
      description: `Synced ${results.trackingFound} tracking numbers, confirmed ${results.amazonConfirmed} on Amazon`,
      metadata: results,
    });

    sendSuccess(res, results);
  } catch (err) {
    console.error('Shipping sync failed:', err);
    errors.internal(res, `Sync failed: ${err.message}`);
  }
});

/**
 * POST /shipping/confirm/:orderId
 * Manually confirm shipment with tracking
 */
router.post('/confirm/:orderId', requireStaff, async (req, res) => {
  const { orderId } = req.params;
  const { trackingNumber, carrierCode = 'Royal Mail', confirmOnAmazon = true } = req.body;

  if (!trackingNumber) {
    return errors.badRequest(res, 'trackingNumber is required');
  }

  try {
    // Get order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, channel, amazon_order_id, external_order_id')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return errors.notFound(res, 'Order');
    }

    // Record shipment
    await supabase
      .from('amazon_shipments')
      .upsert({
        order_id: order.id,
        amazon_order_id: order.amazon_order_id || order.external_order_id,
        carrier_code: carrierCode,
        carrier_name: carrierCode,
        tracking_number: trackingNumber,
        ship_date: new Date().toISOString(),
        confirmed_at: new Date().toISOString(),
      }, { onConflict: 'order_id' });

    // Update order status
    await supabase
      .from('orders')
      .update({
        status: 'DISPATCHED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', order.id);

    // Confirm on Amazon
    let amazonConfirmed = false;
    if (confirmOnAmazon && spApiClient.isConfigured()) {
      const amazonOrderId = order.amazon_order_id || (order.channel === 'AMAZON' ? order.external_order_id : null);

      if (amazonOrderId) {
        try {
          await spApiClient.confirmShipment(amazonOrderId, {
            carrierCode,
            carrierName: carrierCode,
            trackingNumber,
            shipDate: new Date().toISOString(),
          });
          amazonConfirmed = true;
        } catch (amazonErr) {
          console.warn(`Amazon confirmation failed: ${amazonErr.message}`);
        }
      }
    }

    await recordSystemEvent({
      eventType: 'SHIPMENT_CONFIRMED',
      entityType: 'ORDER',
      entityId: orderId,
      description: `Shipment confirmed: ${carrierCode} ${trackingNumber}`,
      metadata: { carrierCode, trackingNumber, amazonConfirmed },
    });

    sendSuccess(res, {
      message: 'Shipment confirmed',
      trackingNumber,
      amazonConfirmed,
    });
  } catch (err) {
    console.error('Failed to confirm shipment:', err);
    errors.internal(res, `Failed to confirm: ${err.message}`);
  }
});

/**
 * POST /shipping/confirm-bulk
 * Bulk confirm shipments with tracking numbers
 */
router.post('/confirm-bulk', requireStaff, async (req, res) => {
  const { shipments, confirmOnAmazon = true } = req.body;

  if (!Array.isArray(shipments) || shipments.length === 0) {
    return errors.badRequest(res, 'shipments array is required');
  }

  if (shipments.length > 50) {
    return errors.badRequest(res, 'Maximum 50 shipments per bulk operation');
  }

  const results = {
    total: shipments.length,
    confirmed: 0,
    amazonConfirmed: 0,
    errors: [],
  };

  for (const shipment of shipments) {
    const { orderId, trackingNumber, carrierCode = 'Royal Mail' } = shipment;

    if (!orderId || !trackingNumber) {
      results.errors.push({ orderId, error: 'Missing orderId or trackingNumber' });
      continue;
    }

    try {
      // Get order
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('id, channel, amazon_order_id, external_order_id')
        .eq('id', orderId)
        .single();

      if (orderError || !order) {
        results.errors.push({ orderId, error: 'Order not found' });
        continue;
      }

      // Record shipment
      await supabase
        .from('amazon_shipments')
        .upsert({
          order_id: order.id,
          amazon_order_id: order.amazon_order_id || order.external_order_id,
          carrier_code: carrierCode,
          carrier_name: carrierCode,
          tracking_number: trackingNumber,
          ship_date: new Date().toISOString(),
          confirmed_at: new Date().toISOString(),
        }, { onConflict: 'order_id' });

      // Update order status
      await supabase
        .from('orders')
        .update({
          status: 'DISPATCHED',
          updated_at: new Date().toISOString(),
        })
        .eq('id', order.id);

      results.confirmed++;

      // Confirm on Amazon
      if (confirmOnAmazon && spApiClient.isConfigured()) {
        const amazonOrderId = order.amazon_order_id || (order.channel === 'AMAZON' ? order.external_order_id : null);

        if (amazonOrderId) {
          try {
            await spApiClient.confirmShipment(amazonOrderId, {
              carrierCode,
              carrierName: carrierCode,
              trackingNumber,
              shipDate: new Date().toISOString(),
            });
            results.amazonConfirmed++;
          } catch (amazonErr) {
            results.errors.push({ orderId, amazonOrderId, error: `Amazon: ${amazonErr.message}` });
          }
        }
      }
    } catch (err) {
      results.errors.push({ orderId, error: err.message });
    }
  }

  await recordSystemEvent({
    eventType: 'BULK_SHIPMENT_CONFIRMED',
    description: `Bulk confirmed ${results.confirmed} shipments, ${results.amazonConfirmed} on Amazon`,
    metadata: results,
  });

  sendSuccess(res, results);
});

/**
 * GET /shipping/tracking/:orderId
 * Get tracking info for an order
 */
router.get('/tracking/:orderId', requireStaff, async (req, res) => {
  const { orderId } = req.params;

  try {
    const { data: shipment, error } = await supabase
      .from('amazon_shipments')
      .select('*')
      .eq('order_id', orderId)
      .maybeSingle();

    if (error) throw error;

    if (!shipment) {
      return sendSuccess(res, { shipped: false });
    }

    sendSuccess(res, {
      shipped: true,
      ...shipment,
    });
  } catch (err) {
    console.error('Failed to get tracking:', err);
    errors.internal(res, 'Failed to get tracking');
  }
});

export default router;
