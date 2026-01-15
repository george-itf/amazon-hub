/**
 * Amazon SP-API Integration Routes
 * Handles syncing orders, inventory, and other data from Amazon
 */
import express from 'express';
import spApiClient from '../services/spApi.js';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { requireAdmin } from '../middleware/auth.js';
import { recordSystemEvent } from '../services/audit.js';
import { resolveListing } from '../utils/memoryResolution.js';
import { normalizeAsin, normalizeSku, fingerprintTitle } from '../utils/identityNormalization.js';

const router = express.Router();

/**
 * GET /amazon/status
 * Check SP-API connection status
 */
router.get('/status', async (req, res) => {
  const configured = spApiClient.isConfigured();

  if (!configured) {
    return sendSuccess(res, {
      connected: false,
      configured: false,
      message: 'SP-API credentials not configured',
    });
  }

  try {
    // Try to get a token to verify credentials work
    await spApiClient.getAccessToken();

    sendSuccess(res, {
      connected: true,
      configured: true,
      applicationId: spApiClient.applicationId,
      marketplaceId: spApiClient.marketplaceId,
      message: 'Connected to Amazon SP-API',
    });
  } catch (err) {
    console.error('SP-API status check failed:', err);
    sendSuccess(res, {
      connected: false,
      configured: true,
      message: `Connection failed: ${err.message}`,
    });
  }
});

/**
 * POST /amazon/sync/orders
 * Sync orders from Amazon
 * ADMIN only
 */
router.post('/sync/orders', requireAdmin, async (req, res) => {
  const { daysBack = 7, statuses } = req.body;

  if (!spApiClient.isConfigured()) {
    return errors.badRequest(res, 'SP-API credentials not configured');
  }

  try {
    // Calculate date range
    const createdAfter = new Date();
    createdAfter.setDate(createdAfter.getDate() - daysBack);

    console.log(`[SP-API] Fetching Amazon orders from ${createdAfter.toISOString()}`);

    // Fetch orders from Amazon
    const amazonOrders = await spApiClient.getAllOrders({
      createdAfter: createdAfter.toISOString(),
      orderStatuses: statuses || ['Unshipped', 'Shipped', 'PartiallyShipped'],
    });

    console.log(`[SP-API] Found ${amazonOrders.length} orders from Amazon`);

    // Process each order
    const results = {
      total: amazonOrders.length,
      created: 0,
      updated: 0,
      linked: 0,
      skipped: 0,
      errors: [],
    };

    for (const amazonOrder of amazonOrders) {
      try {
        await processAmazonOrder(amazonOrder, results);
      } catch (err) {
        console.error(`Error processing order ${amazonOrder.AmazonOrderId}:`, err);
        results.errors.push({
          orderId: amazonOrder.AmazonOrderId,
          error: err.message,
        });
      }
    }

    await recordSystemEvent({
      eventType: 'AMAZON_SYNC',
      description: `Synced ${results.total} Amazon orders: ${results.created} created, ${results.linked} linked to Shopify, ${results.updated} updated, ${results.skipped} skipped`,
      metadata: {
        total: results.total,
        created: results.created,
        linked: results.linked,
        updated: results.updated,
        skipped: results.skipped,
        errors: results.errors.length,
      },
      severity: results.errors.length > 0 ? 'WARN' : 'INFO',
    });

    sendSuccess(res, results);
  } catch (err) {
    console.error('Amazon order sync failed:', err);
    errors.internal(res, `Sync failed: ${err.message}`);
  }
});

/**
 * Process a single Amazon order
 */
async function processAmazonOrder(amazonOrder, results) {
  const amazonOrderId = amazonOrder.AmazonOrderId;

  // Check if this Amazon order already exists
  const { data: existingAmazon } = await supabase
    .from('orders')
    .select('id, status')
    .eq('external_order_id', amazonOrderId)
    .eq('channel', 'AMAZON')
    .maybeSingle();

  // Map Amazon status to our status
  const statusMap = {
    'Pending': 'IMPORTED',
    'Unshipped': 'READY_TO_PICK',
    'PartiallyShipped': 'PICKED',
    'Shipped': 'DISPATCHED',
    'Canceled': 'CANCELLED',
    'Unfulfillable': 'CANCELLED',
  };

  const amazonStatus = statusMap[amazonOrder.OrderStatus] || 'NEEDS_REVIEW';

  // Parse order total
  const orderTotalPence = amazonOrder.OrderTotal
    ? Math.round(parseFloat(amazonOrder.OrderTotal.Amount) * 100)
    : 0;

  if (existingAmazon) {
    // Update existing Amazon order if status changed
    if (amazonStatus === 'DISPATCHED' && existingAmazon.status !== 'DISPATCHED') {
      await supabase
        .from('orders')
        .update({
          status: 'DISPATCHED',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingAmazon.id);
      results.updated++;
    } else if (amazonStatus === 'CANCELLED' && existingAmazon.status !== 'CANCELLED') {
      await supabase
        .from('orders')
        .update({
          status: 'CANCELLED',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingAmazon.id);
      results.updated++;
    } else {
      results.skipped++;
    }
    return;
  }

  // Check if there's a matching Shopify order that has this Amazon order ID
  // (Shopify orders from Amazon apps often store the Amazon order ID in order notes or metadata)
  const { data: matchingShopify } = await supabase
    .from('orders')
    .select('id, status, external_order_id')
    .eq('channel', 'shopify')
    .eq('amazon_order_id', amazonOrderId)
    .maybeSingle();

  // Also check if Shopify order has Amazon order ID in raw_payload
  let linkedShopifyOrder = matchingShopify;
  if (!linkedShopifyOrder) {
    // Search for Shopify orders that might have the Amazon order ID in their payload
    const { data: shopifyOrders } = await supabase
      .from('orders')
      .select('id, status, external_order_id, raw_payload')
      .eq('channel', 'shopify')
      .is('amazon_order_id', null)
      .limit(100);

    if (shopifyOrders) {
      for (const order of shopifyOrders) {
        const payload = order.raw_payload;
        if (!payload) continue;

        // Check various places where Amazon order ID might be stored
        const noteMatch = payload.note?.includes(amazonOrderId);
        const tagMatch = payload.tags?.includes(amazonOrderId);
        const nameMatch = payload.name?.includes(amazonOrderId);

        // Check line item properties for ASIN/Amazon references
        const lineItemMatch = payload.line_items?.some(li =>
          li.properties?.some(p =>
            p.value === amazonOrderId ||
            (p.name?.toLowerCase().includes('amazon') && p.value?.includes(amazonOrderId))
          )
        );

        if (noteMatch || tagMatch || nameMatch || lineItemMatch) {
          linkedShopifyOrder = order;
          break;
        }
      }
    }
  }

  // If we found a matching Shopify order, link them
  if (linkedShopifyOrder) {
    await supabase
      .from('orders')
      .update({
        amazon_order_id: amazonOrderId,
        source_channel: 'AMAZON',
        raw_payload: {
          ...linkedShopifyOrder.raw_payload,
          _amazon_data: amazonOrder,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', linkedShopifyOrder.id);

    console.log(`[SP-API] Linked Amazon order ${amazonOrderId} to Shopify order ${linkedShopifyOrder.external_order_id}`);
    results.linked++;
    return;
  }

  // Fetch order items from Amazon
  const orderItems = await spApiClient.getOrderItems(amazonOrderId);
  const items = orderItems.OrderItems || [];

  // Parse shipping address for customer info
  const amazonShippingAddress = amazonOrder.ShippingAddress || {};
  const customerName = amazonShippingAddress.Name || amazonOrder.BuyerInfo?.BuyerName || null;
  const customerEmail = amazonOrder.BuyerInfo?.BuyerEmail || null;

  // Build shipping address as jsonb
  const shippingAddress = amazonShippingAddress.AddressLine1 ? {
    name: amazonShippingAddress.Name,
    address1: amazonShippingAddress.AddressLine1,
    address2: amazonShippingAddress.AddressLine2 || null,
    city: amazonShippingAddress.City,
    province: amazonShippingAddress.StateOrRegion || null,
    zip: amazonShippingAddress.PostalCode,
    country: amazonShippingAddress.CountryCode,
    phone: amazonShippingAddress.Phone || null,
  } : null;

  // Pre-process line items to determine resolution status BEFORE inserting order
  const processedLines = [];
  let allLinesResolved = true;

  for (const item of items) {
    const asin = normalizeAsin(item.ASIN);
    const sku = normalizeSku(item.SellerSKU);
    const title = item.Title || '';
    const fingerprint = fingerprintTitle(title);

    // Attempt to resolve listing using the standard resolution flow
    const resolution = await resolveListing(asin, sku, title);
    const isResolved = resolution !== null && resolution.bom_id !== null;

    if (!isResolved) {
      allLinesResolved = false;
    }

    processedLines.push({
      item,
      asin,
      sku,
      title,
      fingerprint,
      resolution,
      isResolved,
    });
  }

  // Determine final status based on Amazon status and resolution
  let finalStatus = amazonStatus;
  if (amazonStatus === 'READY_TO_PICK' && !allLinesResolved) {
    finalStatus = 'NEEDS_REVIEW';
  } else if (amazonStatus === 'IMPORTED' && allLinesResolved) {
    finalStatus = 'READY_TO_PICK';
  } else if (amazonStatus === 'IMPORTED' && !allLinesResolved) {
    finalStatus = 'NEEDS_REVIEW';
  }

  // Create the order with correct status
  const { data: newOrder, error: orderError } = await supabase
    .from('orders')
    .insert({
      external_order_id: amazonOrderId,
      order_number: amazonOrderId,
      channel: 'AMAZON',
      status: finalStatus,
      order_date: amazonOrder.PurchaseDate
        ? new Date(amazonOrder.PurchaseDate).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0],
      customer_name: customerName,
      customer_email: customerEmail,
      shipping_address: shippingAddress,
      raw_payload: amazonOrder,
      total_price_pence: orderTotalPence,
      currency: amazonOrder.OrderTotal?.CurrencyCode || 'GBP',
    })
    .select()
    .single();

  if (orderError) {
    throw new Error(`Failed to create order: ${orderError.message}`);
  }

  // Create order lines
  for (const processed of processedLines) {
    const { item, asin, sku, title, fingerprint, resolution, isResolved } = processed;
    const quantity = item.QuantityOrdered || 1;
    const pricePerUnit = item.ItemPrice
      ? Math.round(parseFloat(item.ItemPrice.Amount) / quantity * 100)
      : 0;

    // Insert order line
    const { error: lineError } = await supabase
      .from('order_lines')
      .insert({
        order_id: newOrder.id,
        external_line_id: item.OrderItemId || null,
        asin: asin,
        sku: sku,
        title: title,
        title_fingerprint: fingerprint,
        quantity: quantity,
        unit_price_pence: pricePerUnit,
        listing_memory_id: resolution?.id || null,
        bom_id: resolution?.bom_id || null,
        resolution_source: resolution ? 'MEMORY' : null,
        is_resolved: isResolved,
        parse_intent: null,
      });

    if (lineError) {
      console.error('Order line insert error:', lineError);
    }

    // If not resolved, create review queue entry
    if (!isResolved) {
      await supabase.from('review_queue').insert({
        order_id: newOrder.id,
        order_line_id: null,
        external_id: `${amazonOrderId}-${item.OrderItemId || item.ASIN}`,
        asin: asin,
        sku: sku,
        title: title,
        title_fingerprint: fingerprint,
        reason: resolution ? 'BOM_NOT_SET' : 'UNKNOWN_LISTING',
        status: 'PENDING',
      });
    }
  }

  results.created++;
}

/**
 * GET /amazon/orders/recent
 * Get recent orders from Amazon (preview without importing)
 */
router.get('/orders/recent', requireAdmin, async (req, res) => {
  const { daysBack = 3 } = req.query;

  if (!spApiClient.isConfigured()) {
    return errors.badRequest(res, 'SP-API credentials not configured');
  }

  try {
    const createdAfter = new Date();
    createdAfter.setDate(createdAfter.getDate() - parseInt(daysBack));

    const orders = await spApiClient.getOrders({
      createdAfter: createdAfter.toISOString(),
    });

    // Get a summary
    const summary = (orders.Orders || []).map(o => ({
      amazonOrderId: o.AmazonOrderId,
      purchaseDate: o.PurchaseDate,
      status: o.OrderStatus,
      total: o.OrderTotal,
      fulfillmentChannel: o.FulfillmentChannel,
      shipServiceLevel: o.ShipServiceLevel,
    }));

    sendSuccess(res, {
      count: summary.length,
      orders: summary,
    });
  } catch (err) {
    console.error('Failed to fetch recent Amazon orders:', err);
    errors.internal(res, `Failed to fetch orders: ${err.message}`);
  }
});

/**
 * GET /amazon/order/:orderId
 * Get details for a specific Amazon order
 */
router.get('/order/:orderId', requireAdmin, async (req, res) => {
  const { orderId } = req.params;

  if (!spApiClient.isConfigured()) {
    return errors.badRequest(res, 'SP-API credentials not configured');
  }

  try {
    // Get order items
    const orderItems = await spApiClient.getOrderItems(orderId);

    sendSuccess(res, {
      orderId,
      items: orderItems.OrderItems || [],
    });
  } catch (err) {
    console.error(`Failed to fetch Amazon order ${orderId}:`, err);
    errors.internal(res, `Failed to fetch order: ${err.message}`);
  }
});

/**
 * GET /amazon/inventory
 * Get inventory levels from Amazon FBA
 */
router.get('/inventory', requireAdmin, async (req, res) => {
  if (!spApiClient.isConfigured()) {
    return errors.badRequest(res, 'SP-API credentials not configured');
  }

  try {
    const inventory = await spApiClient.getInventorySummaries();

    sendSuccess(res, {
      summaries: inventory.inventorySummaries || [],
    });
  } catch (err) {
    console.error('Failed to fetch Amazon inventory:', err);
    errors.internal(res, `Failed to fetch inventory: ${err.message}`);
  }
});

export default router;
