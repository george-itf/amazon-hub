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
 * POST /amazon/shipment/confirm
 * Confirm shipment for an FBM order (sends tracking to Amazon)
 */
router.post('/shipment/confirm', requireAdmin, async (req, res) => {
  const { orderId, carrierCode, carrierName, trackingNumber, shipDate } = req.body;

  if (!orderId || !carrierCode || !trackingNumber) {
    return errors.badRequest(res, 'orderId, carrierCode, and trackingNumber are required');
  }

  if (!spApiClient.isConfigured()) {
    return errors.badRequest(res, 'SP-API credentials not configured');
  }

  try {
    // Confirm shipment with Amazon
    await spApiClient.confirmShipment(orderId, {
      carrierCode,
      carrierName,
      trackingNumber,
      shipDate: shipDate || new Date().toISOString(),
    });

    // Find and update our order
    const { data: order } = await supabase
      .from('orders')
      .select('id')
      .or(`external_order_id.eq.${orderId},amazon_order_id.eq.${orderId}`)
      .eq('channel', 'AMAZON')
      .maybeSingle();

    if (order) {
      // Record the shipment
      await supabase.from('amazon_shipments').insert({
        order_id: order.id,
        amazon_order_id: orderId,
        carrier_code: carrierCode,
        carrier_name: carrierName || carrierCode,
        tracking_number: trackingNumber,
        ship_date: shipDate || new Date().toISOString(),
        confirmed_at: new Date().toISOString(),
      });

      // Update order status to dispatched
      await supabase
        .from('orders')
        .update({
          status: 'DISPATCHED',
          updated_at: new Date().toISOString(),
        })
        .eq('id', order.id);
    }

    await recordSystemEvent({
      eventType: 'AMAZON_SHIPMENT_CONFIRMED',
      entityType: 'ORDER',
      entityId: orderId,
      description: `Shipment confirmed: ${carrierCode} ${trackingNumber}`,
      metadata: { carrierCode, trackingNumber },
    });

    sendSuccess(res, {
      message: 'Shipment confirmed with Amazon',
      orderId,
      trackingNumber,
    });
  } catch (err) {
    console.error('Failed to confirm shipment:', err);
    errors.internal(res, `Failed to confirm shipment: ${err.message}`);
  }
});

/**
 * GET /amazon/orders/pending-shipment
 * Get Amazon orders that need shipment confirmation
 */
router.get('/orders/pending-shipment', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select(`
        id,
        external_order_id,
        amazon_order_id,
        order_number,
        order_date,
        customer_name,
        shipping_address,
        status,
        total_price_pence,
        order_lines (
          id,
          title,
          quantity,
          asin,
          sku
        )
      `)
      .eq('channel', 'AMAZON')
      .in('status', ['PICKED', 'READY_TO_PICK'])
      .order('order_date', { ascending: true });

    if (error) throw error;

    // Filter out orders that already have shipment confirmation
    const orderIds = data.map(o => o.id);
    const { data: shipments } = await supabase
      .from('amazon_shipments')
      .select('order_id')
      .in('order_id', orderIds);

    const shippedOrderIds = new Set(shipments?.map(s => s.order_id) || []);
    const pendingOrders = data.filter(o => !shippedOrderIds.has(o.id));

    sendSuccess(res, {
      count: pendingOrders.length,
      orders: pendingOrders,
    });
  } catch (err) {
    console.error('Failed to fetch pending shipment orders:', err);
    errors.internal(res, `Failed to fetch orders: ${err.message}`);
  }
});

/**
 * POST /amazon/sync/fees
 * Sync financial events (fees) from Amazon
 */
router.post('/sync/fees', requireAdmin, async (req, res) => {
  const { daysBack = 30 } = req.body;

  if (!spApiClient.isConfigured()) {
    return errors.badRequest(res, 'SP-API credentials not configured');
  }

  try {
    const postedAfter = new Date();
    postedAfter.setDate(postedAfter.getDate() - daysBack);

    console.log(`[SP-API] Fetching financial events from ${postedAfter.toISOString()}`);

    const events = await spApiClient.getAllFinancialEvents({
      postedAfter: postedAfter.toISOString(),
    });

    const results = {
      processed: 0,
      created: 0,
      updated: 0,
      errors: [],
    };

    // Process shipment events (order-level fees)
    for (const event of events.ShipmentEventList || []) {
      try {
        const amazonOrderId = event.AmazonOrderId;
        const postedDate = event.PostedDate;

        for (const item of event.ShipmentItemList || []) {
          results.processed++;

          // Calculate fees from item charges
          let referralFee = 0;
          let itemPrice = 0;
          let shippingCharge = 0;
          let promotionDiscount = 0;

          for (const charge of item.ItemChargeList || []) {
            const amount = Math.round(parseFloat(charge.ChargeAmount?.Amount || 0) * 100);
            if (charge.ChargeType === 'Principal') {
              itemPrice = amount;
            } else if (charge.ChargeType === 'Shipping') {
              shippingCharge = amount;
            }
          }

          for (const fee of item.ItemFeeList || []) {
            const amount = Math.round(parseFloat(fee.FeeAmount?.Amount || 0) * 100);
            if (fee.FeeType === 'Commission' || fee.FeeType === 'ReferralFee') {
              referralFee = Math.abs(amount);
            }
          }

          for (const promo of item.PromotionList || []) {
            promotionDiscount += Math.round(parseFloat(promo.PromotionAmount?.Amount || 0) * 100);
          }

          const totalFees = referralFee;
          const netProceeds = itemPrice + shippingCharge - totalFees + promotionDiscount;

          // Upsert fee record
          const { error } = await supabase
            .from('amazon_fees')
            .upsert({
              amazon_order_id: amazonOrderId,
              order_item_id: item.OrderItemId,
              asin: item.ASIN || item.SellerSKU,
              seller_sku: item.SellerSKU,
              posted_date: postedDate,
              referral_fee_pence: referralFee,
              item_price_pence: itemPrice,
              shipping_charge_pence: shippingCharge,
              promotion_discount_pence: promotionDiscount,
              total_fees_pence: totalFees,
              net_proceeds_pence: netProceeds,
              raw_data: item,
            }, {
              onConflict: 'amazon_order_id,order_item_id',
            });

          if (error) {
            results.errors.push({ orderId: amazonOrderId, error: error.message });
          } else {
            results.created++;
          }
        }
      } catch (err) {
        console.error('Error processing financial event:', err);
        results.errors.push({ error: err.message });
      }
    }

    // Link fees to our orders
    await supabase.rpc('link_amazon_fees_to_orders').catch(() => {
      // RPC might not exist yet, that's ok
    });

    await recordSystemEvent({
      eventType: 'AMAZON_FEES_SYNC',
      description: `Synced ${results.created} fee records from ${events.ShipmentEventList?.length || 0} shipment events`,
      metadata: results,
    });

    sendSuccess(res, results);
  } catch (err) {
    console.error('Amazon fees sync failed:', err);
    errors.internal(res, `Sync failed: ${err.message}`);
  }
});

/**
 * GET /amazon/catalog/:asin
 * Get catalog data for an ASIN
 */
router.get('/catalog/:asin', requireAdmin, async (req, res) => {
  const { asin } = req.params;
  const { refresh = false } = req.query;

  if (!spApiClient.isConfigured()) {
    return errors.badRequest(res, 'SP-API credentials not configured');
  }

  try {
    // Check cache first
    if (!refresh) {
      const { data: cached } = await supabase
        .from('amazon_catalog')
        .select('*')
        .eq('asin', asin)
        .maybeSingle();

      if (cached) {
        return sendSuccess(res, cached);
      }
    }

    // Fetch from Amazon
    const catalogData = await spApiClient.getCatalogItem(asin);

    // Extract relevant data
    const summary = catalogData.summaries?.[0] || {};
    const attributes = catalogData.attributes || {};
    const salesRanks = catalogData.salesRanks?.[0] || {};
    const images = catalogData.images?.[0]?.images || [];

    const catalogRecord = {
      asin,
      title: summary.itemName || attributes.item_name?.[0]?.value,
      brand: summary.brand || attributes.brand?.[0]?.value,
      manufacturer: attributes.manufacturer?.[0]?.value,
      model_number: attributes.model_number?.[0]?.value,
      part_number: attributes.part_number?.[0]?.value,
      color: attributes.color?.[0]?.value,
      size: attributes.size?.[0]?.value,
      product_type: summary.productType,
      main_image_url: images.find(i => i.variant === 'MAIN')?.link,
      images: images,
      sales_rank: salesRanks.ranks?.[0]?.rank,
      sales_rank_category: salesRanks.ranks?.[0]?.title,
      raw_data: catalogData,
      last_synced_at: new Date().toISOString(),
    };

    // Upsert to cache
    await supabase
      .from('amazon_catalog')
      .upsert(catalogRecord, { onConflict: 'asin' });

    sendSuccess(res, catalogRecord);
  } catch (err) {
    console.error(`Failed to fetch catalog for ${asin}:`, err);
    errors.internal(res, `Failed to fetch catalog: ${err.message}`);
  }
});

/**
 * GET /amazon/settings
 * Get Amazon integration settings
 */
router.get('/settings', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('amazon_settings')
      .select('*');

    if (error) throw error;

    // Convert to key-value object
    const settings = {};
    for (const row of data || []) {
      settings[row.setting_key] = row.setting_value;
    }

    sendSuccess(res, settings);
  } catch (err) {
    console.error('Failed to fetch settings:', err);
    errors.internal(res, 'Failed to fetch settings');
  }
});

/**
 * PUT /amazon/settings
 * Update Amazon integration settings
 */
router.put('/settings', requireAdmin, async (req, res) => {
  const updates = req.body;

  try {
    for (const [key, value] of Object.entries(updates)) {
      await supabase
        .from('amazon_settings')
        .upsert({
          setting_key: key,
          setting_value: value,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'setting_key' });
    }

    sendSuccess(res, { message: 'Settings updated' });
  } catch (err) {
    console.error('Failed to update settings:', err);
    errors.internal(res, 'Failed to update settings');
  }
});

/**
 * GET /amazon/sync/history
 * Get sync history
 */
router.get('/sync/history', requireAdmin, async (req, res) => {
  const { limit = 20 } = req.query;

  try {
    const { data, error } = await supabase
      .from('amazon_sync_log')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(parseInt(limit));

    if (error) throw error;

    sendSuccess(res, data || []);
  } catch (err) {
    console.error('Failed to fetch sync history:', err);
    errors.internal(res, 'Failed to fetch sync history');
  }
});

/**
 * GET /amazon/stats
 * Get Amazon-specific statistics
 */
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    // Get order counts by status
    const { data: orderStats } = await supabase
      .from('orders')
      .select('status')
      .eq('channel', 'AMAZON');

    const statusCounts = {};
    for (const order of orderStats || []) {
      statusCounts[order.status] = (statusCounts[order.status] || 0) + 1;
    }

    // Get total Amazon revenue this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { data: revenueData } = await supabase
      .from('orders')
      .select('total_price_pence')
      .eq('channel', 'AMAZON')
      .gte('order_date', startOfMonth.toISOString().split('T')[0])
      .not('status', 'eq', 'CANCELLED');

    const monthlyRevenue = revenueData?.reduce((sum, o) => sum + (o.total_price_pence || 0), 0) || 0;

    // Get pending shipment count
    const { count: pendingShipments } = await supabase
      .from('orders')
      .select('id', { count: 'exact' })
      .eq('channel', 'AMAZON')
      .in('status', ['PICKED', 'READY_TO_PICK']);

    // Get fees total this month
    const { data: feesData } = await supabase
      .from('amazon_fees')
      .select('total_fees_pence')
      .gte('posted_date', startOfMonth.toISOString());

    const monthlyFees = feesData?.reduce((sum, f) => sum + (f.total_fees_pence || 0), 0) || 0;

    sendSuccess(res, {
      orders_by_status: statusCounts,
      total_orders: orderStats?.length || 0,
      monthly_revenue_pence: monthlyRevenue,
      monthly_fees_pence: monthlyFees,
      monthly_net_pence: monthlyRevenue - monthlyFees,
      pending_shipments: pendingShipments || 0,
    });
  } catch (err) {
    console.error('Failed to fetch Amazon stats:', err);
    errors.internal(res, 'Failed to fetch stats');
  }
});

export default router;
