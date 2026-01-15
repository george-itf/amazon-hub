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
import { processBatch, withRetry } from '../utils/queueThrottle.js';
import { createShopifyFulfillment } from '../services/shopify.js';

const router = express.Router();

// Default service profiles for shipping
const DEFAULT_SERVICE_CODE = 'TPN'; // Tracked 24
const BATCH_LIMIT = 100;

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

/**
 * POST /shipping/batch-create
 * Batch create shipping labels via Royal Mail Click & Drop
 * Supports dry_run mode for cost simulation
 */
router.post('/batch-create', requireStaff, async (req, res) => {
  const { order_ids, dry_run = false, service_code } = req.body;

  if (!Array.isArray(order_ids) || order_ids.length === 0) {
    return errors.badRequest(res, 'order_ids array is required');
  }

  if (order_ids.length > BATCH_LIMIT) {
    return errors.badRequest(res, `Maximum ${BATCH_LIMIT} orders per batch`);
  }

  if (!royalMailClient.isConfigured()) {
    return errors.badRequest(res, 'Royal Mail API not configured');
  }

  const batchId = `BATCH-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const startTime = Date.now();

  console.log(`[Shipping] Starting batch ${batchId}: ${order_ids.length} orders, dry_run=${dry_run}`);

  try {
    // Fetch all orders with their order lines
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select(`
        *,
        order_lines (*)
      `)
      .in('id', order_ids);

    if (ordersError) throw ordersError;

    if (!orders || orders.length === 0) {
      return errors.badRequest(res, 'No valid orders found');
    }

    // Check for existing active labels to prevent duplicates
    const { data: existingLabels } = await supabase
      .from('shipping_labels')
      .select('order_id')
      .in('order_id', order_ids)
      .in('status', ['CREATED', 'PENDING', 'DISPATCHED']);

    const existingLabelOrderIds = new Set(existingLabels?.map(l => l.order_id) || []);

    // Fetch listing settings for shipping profile overrides
    const listingMemoryIds = orders
      .flatMap(o => o.order_lines?.map(ol => ol.listing_memory_id) || [])
      .filter(Boolean);

    let listingSettingsMap = {};
    if (listingMemoryIds.length > 0) {
      const { data: settings } = await supabase
        .from('listing_settings')
        .select('listing_memory_id, shipping_profile_id')
        .in('listing_memory_id', listingMemoryIds);

      for (const s of settings || []) {
        listingSettingsMap[s.listing_memory_id] = s;
      }
    }

    // Process each order
    const results = [];
    let totalCostPence = 0;
    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    /**
     * Process a single order - create label or simulate
     */
    const processOrder = async (order) => {
      // Skip if already has active label
      if (existingLabelOrderIds.has(order.id)) {
        return {
          order_id: order.id,
          status: 'skipped',
          reason: 'Label already exists',
        };
      }

      // Determine service code: override > listing_settings > default
      let effectiveServiceCode = service_code || DEFAULT_SERVICE_CODE;

      // Check listing settings for shipping profile override
      for (const line of order.order_lines || []) {
        if (line.listing_memory_id) {
          const settings = listingSettingsMap[line.listing_memory_id];
          if (settings?.shipping_profile_id) {
            effectiveServiceCode = settings.shipping_profile_id;
            break;
          }
        }
      }

      // Build Royal Mail payload
      const payload = royalMailClient.buildOrderPayload(order, order.order_lines || [], effectiveServiceCode);

      // Simulate cost for dry run (estimate based on service code)
      const estimatedCostPence = estimateLabelCost(effectiveServiceCode);

      if (dry_run) {
        return {
          order_id: order.id,
          order_number: order.order_number || order.external_order_id,
          status: 'simulated',
          service_code: effectiveServiceCode,
          price_pence: estimatedCostPence,
          payload,
        };
      }

      // Create actual label
      try {
        const rmResult = await withRetry(
          () => royalMailClient.createOrder(payload),
          {
            maxRetries: 4,
            baseDelayMs: 1000,
            onRetry: (attempt, delay, error) => {
              console.log(`[Shipping] Retry ${attempt} for order ${order.id}: ${error.message}`);
            },
          }
        );

        // Extract label details from response
        const labelId = rmResult.orderId || rmResult.id;
        const trackingNumber = rmResult.trackingNumber || rmResult.tracking_number;
        const actualPrice = rmResult.totalPrice?.amount
          ? Math.round(rmResult.totalPrice.amount * 100)
          : estimatedCostPence;

        // Store label in database
        await supabase
          .from('shipping_labels')
          .insert({
            order_id: order.id,
            label_id: labelId,
            tracking_number: trackingNumber,
            service_code: effectiveServiceCode,
            price_pence: actualPrice,
            status: 'CREATED',
            carrier: 'Royal Mail',
            payload: rmResult,
          });

        // Update order status and tracking
        const rawPayload = order.raw_payload || {};
        await supabase
          .from('orders')
          .update({
            status: 'DISPATCHED',
            updated_at: new Date().toISOString(),
            raw_payload: {
              ...rawPayload,
              _royalmail_data: rmResult,
            },
          })
          .eq('id', order.id);

        // Update amazon_shipments table
        await supabase
          .from('amazon_shipments')
          .upsert({
            order_id: order.id,
            amazon_order_id: order.amazon_order_id || order.external_order_id,
            carrier_code: 'Royal Mail',
            carrier_name: 'Royal Mail',
            ship_method: effectiveServiceCode,
            tracking_number: trackingNumber,
            ship_date: new Date().toISOString(),
            confirmed_at: new Date().toISOString(),
          }, { onConflict: 'order_id' });

        // Update Shopify fulfillment (non-blocking)
        if (order.channel === 'SHOPIFY' || order.shopify_order_number) {
          try {
            await createShopifyFulfillment(order, trackingNumber, 'Royal Mail');
          } catch (shopifyErr) {
            console.warn(`[Shipping] Shopify fulfillment failed for ${order.id}:`, shopifyErr.message);
          }
        }

        // Confirm Amazon shipment (non-blocking)
        if (order.amazon_order_id && spApiClient.isConfigured()) {
          try {
            await spApiClient.confirmShipment(order.amazon_order_id, {
              carrierCode: 'Royal Mail',
              carrierName: 'Royal Mail',
              trackingNumber,
              shipDate: new Date().toISOString(),
            });
          } catch (amazonErr) {
            console.warn(`[Shipping] Amazon confirmation failed for ${order.id}:`, amazonErr.message);
          }
        }

        return {
          order_id: order.id,
          order_number: order.order_number || order.external_order_id,
          status: 'success',
          label_id: labelId,
          tracking_number: trackingNumber,
          service_code: effectiveServiceCode,
          price_pence: actualPrice,
        };
      } catch (err) {
        // Store failed label attempt
        await supabase
          .from('shipping_labels')
          .insert({
            order_id: order.id,
            service_code: effectiveServiceCode,
            status: 'FAILED',
            carrier: 'Royal Mail',
            error_message: err.message,
            payload: { error: err.message },
          });

        return {
          order_id: order.id,
          order_number: order.order_number || order.external_order_id,
          status: 'failed',
          error: err.message,
        };
      }
    };

    // Process all orders with throttling
    const batchResult = await processBatch(
      orders,
      processOrder,
      {
        concurrency: 3,
        intervalMs: 500,
        onProgress: (completed, total) => {
          if (completed % 10 === 0) {
            console.log(`[Shipping] Batch ${batchId}: ${completed}/${total} processed`);
          }
        },
      }
    );

    // Compile results
    for (const result of batchResult.results) {
      if (!result) continue;
      const item = result.success ? result.result : result;

      if (item.status === 'success') {
        successCount++;
        totalCostPence += item.price_pence || 0;
      } else if (item.status === 'failed') {
        failedCount++;
      } else if (item.status === 'skipped') {
        skippedCount++;
      } else if (item.status === 'simulated') {
        successCount++;
        totalCostPence += item.price_pence || 0;
      }

      results.push(item);
    }

    const duration = Date.now() - startTime;

    // Record system event
    await recordSystemEvent({
      eventType: 'ROYALMAIL_BATCH_CREATE',
      description: `Batch ${batchId}: ${successCount} labels created, ${failedCount} failed, ${skippedCount} skipped`,
      metadata: {
        batch_id: batchId,
        dry_run,
        total: orders.length,
        success: successCount,
        failed: failedCount,
        skipped: skippedCount,
        total_cost_pence: totalCostPence,
        duration_ms: duration,
        service_code: service_code || DEFAULT_SERVICE_CODE,
      },
    });

    console.log(`[Shipping] Batch ${batchId} completed in ${duration}ms: ${successCount} success, ${failedCount} failed, ${skippedCount} skipped`);

    sendSuccess(res, {
      batch_id: batchId,
      dry_run,
      summary: {
        total: orders.length,
        success: successCount,
        failed: failedCount,
        skipped: skippedCount,
        total_cost_pence: totalCostPence,
        avg_cost_pence: successCount > 0 ? Math.round(totalCostPence / successCount) : 0,
        duration_ms: duration,
      },
      results,
    });
  } catch (err) {
    console.error(`[Shipping] Batch ${batchId} error:`, err);

    await recordSystemEvent({
      eventType: 'ROYALMAIL_BATCH_CREATE',
      description: `Batch ${batchId} failed: ${err.message}`,
      metadata: { batch_id: batchId, error: err.message, dry_run },
    });

    errors.internal(res, `Batch creation failed: ${err.message}`);
  }
});

/**
 * GET /shipping/batches
 * Get recent batch operations from system_events
 */
router.get('/batches', requireStaff, async (req, res) => {
  const { limit = 20 } = req.query;

  try {
    const { data, error } = await supabase
      .from('system_events')
      .select('*')
      .eq('event_type', 'ROYALMAIL_BATCH_CREATE')
      .order('created_at', { ascending: false })
      .limit(Math.min(parseInt(limit) || 20, 100));

    if (error) throw error;

    sendSuccess(res, {
      count: data.length,
      batches: data.map(event => ({
        id: event.id,
        batch_id: event.metadata?.batch_id,
        dry_run: event.metadata?.dry_run || false,
        total: event.metadata?.total || 0,
        success: event.metadata?.success || 0,
        failed: event.metadata?.failed || 0,
        skipped: event.metadata?.skipped || 0,
        total_cost_pence: event.metadata?.total_cost_pence || 0,
        duration_ms: event.metadata?.duration_ms || 0,
        created_at: event.created_at,
        description: event.description,
      })),
    });
  } catch (err) {
    console.error('Failed to fetch batches:', err);
    errors.internal(res, 'Failed to fetch batch history');
  }
});

/**
 * GET /shipping/labels
 * Get shipping labels with optional filters
 */
router.get('/labels', requireStaff, async (req, res) => {
  const { order_id, status, limit = 50 } = req.query;

  try {
    let query = supabase
      .from('shipping_labels')
      .select(`
        *,
        orders!inner (
          id,
          external_order_id,
          order_number,
          channel,
          customer_name
        )
      `)
      .order('created_at', { ascending: false })
      .limit(Math.min(parseInt(limit) || 50, 200));

    if (order_id) {
      query = query.eq('order_id', order_id);
    }
    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) throw error;

    sendSuccess(res, {
      count: data.length,
      labels: data,
    });
  } catch (err) {
    console.error('Failed to fetch labels:', err);
    errors.internal(res, 'Failed to fetch labels');
  }
});

/**
 * GET /shipping/today-cost
 * Get today's total shipping cost
 */
router.get('/today-cost', requireStaff, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from('shipping_labels')
      .select('price_pence')
      .gte('created_at', today.toISOString())
      .in('status', ['CREATED', 'DISPATCHED']);

    if (error) throw error;

    const totalCostPence = data.reduce((sum, l) => sum + (l.price_pence || 0), 0);
    const labelCount = data.length;

    sendSuccess(res, {
      total_cost_pence: totalCostPence,
      total_cost_pounds: (totalCostPence / 100).toFixed(2),
      label_count: labelCount,
      avg_cost_pence: labelCount > 0 ? Math.round(totalCostPence / labelCount) : 0,
    });
  } catch (err) {
    console.error('Failed to get today cost:', err);
    errors.internal(res, 'Failed to get today cost');
  }
});

/**
 * Estimate label cost based on service code
 * Used for dry-run simulations
 */
function estimateLabelCost(serviceCode) {
  const estimates = {
    'STL1': 135,     // 1st Class ~£1.35
    'STL2': 85,      // 2nd Class ~£0.85
    'SD1': 275,      // Signed For 1st ~£2.75
    'SD2': 225,      // Signed For 2nd ~£2.25
    'SD4': 850,      // Special Delivery 1pm ~£8.50
    'SD6': 1200,     // Special Delivery 9am ~£12.00
    'TPN': 385,      // Tracked 24 ~£3.85
    'TPS': 295,      // Tracked 48 ~£2.95
    'OLA': 450,      // International Standard ~£4.50
    'OTD': 750,      // International Tracked ~£7.50
    'OSA': 950,      // International Tracked & Signed ~£9.50
  };

  return estimates[serviceCode] || 385; // Default to Tracked 24 estimate
}

export default router;
