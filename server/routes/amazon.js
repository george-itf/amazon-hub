/**
 * Amazon SP-API Integration Routes
 * Handles syncing orders, inventory, and other data from Amazon
 */
import express from 'express';
import spApiClient from '../services/spApi.js';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { requireAdmin } from '../middleware/auth.js';
import { auditLog, getAuditContext } from '../services/audit.js';

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

    await auditLog({
      entityType: 'SYSTEM',
      entityId: 'amazon-sync',
      action: 'SYNC_ORDERS',
      changesSummary: `Synced ${results.total} Amazon orders: ${results.created} created, ${results.updated} updated, ${results.skipped} skipped`,
      ...getAuditContext(req),
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

  // Check if order already exists
  const { data: existing } = await supabase
    .from('orders')
    .select('id, status')
    .eq('external_order_id', amazonOrderId)
    .eq('channel', 'AMAZON')
    .single();

  // Map Amazon status to our status
  const statusMap = {
    'Pending': 'PENDING',
    'Unshipped': 'READY_TO_PICK',
    'PartiallyShipped': 'IN_PROGRESS',
    'Shipped': 'DISPATCHED',
    'Canceled': 'CANCELLED',
    'Unfulfillable': 'CANCELLED',
  };

  const ourStatus = statusMap[amazonOrder.OrderStatus] || 'NEEDS_REVIEW';

  // Parse order total
  const orderTotalPence = amazonOrder.OrderTotal
    ? Math.round(parseFloat(amazonOrder.OrderTotal.Amount) * 100)
    : 0;

  if (existing) {
    // Update existing order if status changed
    if (existing.status !== ourStatus) {
      await supabase
        .from('orders')
        .update({
          status: ourStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      results.updated++;
    } else {
      results.skipped++;
    }
    return;
  }

  // Fetch order items from Amazon
  const orderItems = await spApiClient.getOrderItems(amazonOrderId);
  const items = orderItems.OrderItems || [];

  // Parse shipping address for customer info
  const shippingAddress = amazonOrder.ShippingAddress || {};
  const customerName = shippingAddress.Name || amazonOrder.BuyerInfo?.BuyerName || null;
  const customerEmail = amazonOrder.BuyerInfo?.BuyerEmail || null;

  // Create the order
  const { data: newOrder, error: orderError } = await supabase
    .from('orders')
    .insert({
      external_order_id: amazonOrderId,
      order_number: amazonOrderId,
      channel: 'AMAZON',
      status: ourStatus,
      order_date: amazonOrder.PurchaseDate
        ? new Date(amazonOrder.PurchaseDate).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0],
      customer_name: customerName,
      customer_email: customerEmail,
      shipping_address_line1: shippingAddress.AddressLine1,
      shipping_address_line2: shippingAddress.AddressLine2,
      shipping_city: shippingAddress.City,
      shipping_postal_code: shippingAddress.PostalCode,
      shipping_country: shippingAddress.CountryCode,
      order_total_pence: orderTotalPence,
      currency: amazonOrder.OrderTotal?.CurrencyCode || 'GBP',
      amazon_data: amazonOrder, // Store raw data for reference
    })
    .select()
    .single();

  if (orderError) {
    throw new Error(`Failed to create order: ${orderError.message}`);
  }

  // Create order lines
  for (const item of items) {
    const asin = item.ASIN;
    const sku = item.SellerSKU;
    const title = item.Title;
    const quantity = item.QuantityOrdered || 1;
    const pricePerUnit = item.ItemPrice
      ? Math.round(parseFloat(item.ItemPrice.Amount) / quantity * 100)
      : 0;

    // Try to find or create listing memory
    let listingId = null;

    // First try to match by ASIN
    if (asin) {
      const { data: listing } = await supabase
        .from('listing_memory')
        .select('id')
        .eq('asin', asin)
        .eq('is_active', true)
        .single();

      if (listing) {
        listingId = listing.id;
      }
    }

    // If no ASIN match, try SKU
    if (!listingId && sku) {
      const { data: listing } = await supabase
        .from('listing_memory')
        .select('id')
        .eq('sku', sku)
        .eq('is_active', true)
        .single();

      if (listing) {
        listingId = listing.id;
      }
    }

    // Create the order line
    await supabase
      .from('order_lines')
      .insert({
        order_id: newOrder.id,
        listing_id: listingId,
        quantity: quantity,
        title: title,
        asin: asin,
        sku: sku,
        unit_price_pence: pricePerUnit,
        line_total_pence: pricePerUnit * quantity,
      });
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
