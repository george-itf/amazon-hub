/**
 * Amazon SP-API Integration Routes
 * Handles syncing orders, inventory, and other data from Amazon
 */
import express from 'express';
import spApiClient from '../services/spApi.js';
import supabase from '../services/supabase.js';
import scheduler from '../services/scheduler.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { recordSystemEvent } from '../services/audit.js';
import { normalizeAsin, fingerprintTitle } from '../utils/identityNormalization.js';
import { processAmazonOrder, createResultsTracker } from '../utils/amazonOrderProcessor.js';

const router = express.Router();

/**
 * Sanitize search input for Supabase PostgREST queries
 * Escapes special characters that could break or exploit the filter syntax
 */
function sanitizeSearchInput(input) {
  if (!input || typeof input !== 'string') return '';
  // Escape characters that have special meaning in PostgREST filter syntax
  // and could be used for injection: commas, periods, parentheses, backslashes
  return input
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\./g, '\\.')
    .substring(0, 100); // Limit length to prevent abuse
}

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
router.post('/sync/orders', async (req, res) => {
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

    // Process each order using shared processor
    const results = createResultsTracker();
    results.total = amazonOrders.length;

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
    return errors.internal(res, `Sync failed: ${err.message}`);
  }
});

/**
 * GET /amazon/orders/recent
 * Get recent orders from Amazon (preview without importing)
 */
router.get('/orders/recent', async (req, res) => {
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
    return errors.internal(res, `Failed to fetch orders: ${err.message}`);
  }
});

/**
 * GET /amazon/order/:orderId
 * Get details for a specific Amazon order
 */
router.get('/order/:orderId', async (req, res) => {
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
    return errors.internal(res, `Failed to fetch order: ${err.message}`);
  }
});

/**
 * POST /amazon/shipment/confirm
 * Confirm shipment for an FBM order (sends tracking to Amazon)
 */
router.post('/shipment/confirm', async (req, res) => {
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
    return errors.internal(res, `Failed to confirm shipment: ${err.message}`);
  }
});

/**
 * GET /amazon/orders/pending-shipment
 * Get Amazon orders that need shipment confirmation
 */
router.get('/orders/pending-shipment', async (req, res) => {
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
    return errors.internal(res, `Failed to fetch orders: ${err.message}`);
  }
});

/**
 * POST /amazon/sync/fees
 * Sync financial events (fees) from Amazon
 */
router.post('/sync/fees', async (req, res) => {
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
    return errors.internal(res, `Sync failed: ${err.message}`);
  }
});

/**
 * GET /amazon/catalog/:asin
 * Get catalog data for an ASIN
 */
router.get('/catalog/:asin', async (req, res) => {
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
    return errors.internal(res, `Failed to fetch catalog: ${err.message}`);
  }
});

/**
 * POST /amazon/sync/catalog
 * Batch sync catalog data for ASINs from recent orders
 */
router.post('/sync/catalog', async (req, res) => {
  const { asins, daysBack = 30 } = req.body;

  if (!spApiClient.isConfigured()) {
    return errors.badRequest(res, 'SP-API credentials not configured');
  }

  try {
    let asinList = asins;

    // If no specific ASINs provided, get from recent orders
    if (!asinList || asinList.length === 0) {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysBack);

      const { data: orderLines } = await supabase
        .from('order_lines')
        .select('asin, orders!inner(order_date)')
        .gte('orders.order_date', startDate.toISOString().split('T')[0])
        .not('asin', 'is', null);

      // Get unique ASINs
      const uniqueAsins = new Set();
      for (const line of orderLines || []) {
        if (line.asin) uniqueAsins.add(line.asin);
      }
      asinList = [...uniqueAsins];
    }

    // Check which ASINs need syncing (not synced in last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: recentlySynced } = await supabase
      .from('amazon_catalog')
      .select('asin')
      .in('asin', asinList)
      .gte('last_synced_at', sevenDaysAgo.toISOString());

    const recentlySyncedSet = new Set(recentlySynced?.map(r => r.asin) || []);
    const asinsToSync = asinList.filter(a => !recentlySyncedSet.has(a));

    console.log(`[SP-API] Syncing catalog for ${asinsToSync.length} ASINs (${asinList.length - asinsToSync.length} recently synced)`);

    const results = {
      total: asinsToSync.length,
      synced: 0,
      skipped: asinList.length - asinsToSync.length,
      errors: [],
    };

    // Sync each ASIN (with rate limiting)
    for (const asin of asinsToSync) {
      try {
        const catalogData = await spApiClient.getCatalogItem(asin);

        const summary = catalogData.summaries?.[0] || {};
        const attributes = catalogData.attributes || {};
        const salesRanks = catalogData.salesRanks?.[0] || {};
        const images = catalogData.images?.[0]?.images || [];

        await supabase
          .from('amazon_catalog')
          .upsert({
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
          }, { onConflict: 'asin' });

        results.synced++;

        // Small delay to respect rate limits
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        console.error(`Failed to sync catalog for ${asin}:`, err.message);
        results.errors.push({ asin, error: err.message });
      }
    }

    await recordSystemEvent({
      eventType: 'AMAZON_CATALOG_SYNC',
      description: `Synced catalog for ${results.synced} ASINs`,
      metadata: results,
    });

    sendSuccess(res, results);
  } catch (err) {
    console.error('Catalog sync failed:', err);
    return errors.internal(res, `Sync failed: ${err.message}`);
  }
});

/**
 * GET /amazon/catalog
 * Get all cached catalog items with optional filtering
 */
router.get('/catalog', async (req, res) => {
  const { search, limit = 50, offset = 0, needsSync } = req.query;

  try {
    let query = supabase
      .from('amazon_catalog')
      .select('*', { count: 'exact' });

    if (search) {
      const sanitized = sanitizeSearchInput(search);
      query = query.or(`asin.ilike.%${sanitized}%,title.ilike.%${sanitized}%,brand.ilike.%${sanitized}%`);
    }

    if (needsSync === 'true') {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      query = query.lt('last_synced_at', sevenDaysAgo.toISOString());
    }

    query = query
      .order('last_synced_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    const { data, count, error } = await query;

    if (error) throw error;

    sendSuccess(res, {
      items: data || [],
      total: count || 0,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (err) {
    console.error('Failed to fetch catalog:', err);
    return errors.internal(res, 'Failed to fetch catalog');
  }
});

/**
 * GET /amazon/listings
 * Get Amazon listings with their BOM mappings
 */
router.get('/listings', async (req, res) => {
  const { search, mapped, limit = 50, offset = 0 } = req.query;

  try {
    // Get catalog items with listing memory matches
    let query = supabase
      .from('amazon_catalog')
      .select(`
        asin,
        title,
        brand,
        main_image_url,
        sales_rank,
        last_synced_at
      `, { count: 'exact' });

    if (search) {
      const sanitized = sanitizeSearchInput(search);
      query = query.or(`asin.ilike.%${sanitized}%,title.ilike.%${sanitized}%,brand.ilike.%${sanitized}%`);
    }

    query = query
      .order('last_synced_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    const { data: catalogItems, count, error } = await query;

    // Handle missing table gracefully (migration not run yet)
    if (error?.code === 'PGRST205' || error?.message?.includes('amazon_catalog')) {
      console.warn('amazon_catalog table not found - returning empty listings');
      return sendSuccess(res, {
        listings: [],
        total: 0,
        mapped_count: 0,
        unmapped_count: 0,
        migration_needed: true,
      });
    }

    if (error) throw error;

    // Enrich with listing memory info
    // NOTE: Schema fix - boms uses bundle_sku/description, not name
    const asins = catalogItems?.map(c => c.asin) || [];

    // Skip memory lookup if no catalog items (avoid empty .in() query)
    let memoryMatches = [];
    if (asins.length > 0) {
      const { data, error: memError } = await supabase
        .from('listing_memory')
        .select('asin, bom_id, boms(id, bundle_sku, description)')
        .in('asin', asins)
        .eq('is_active', true);

      if (memError) {
        console.error('Memory lookup error:', memError);
      }
      memoryMatches = data || [];
    }

    const memoryByAsin = {};
    for (const match of memoryMatches || []) {
      memoryByAsin[match.asin] = {
        bom_id: match.bom_id,
        // Map bundle_sku to bom_name for client compatibility
        bom_name: match.boms?.bundle_sku || match.boms?.description,
      };
    }

    const listings = catalogItems?.map(item => ({
      ...item,
      bom_id: memoryByAsin[item.asin]?.bom_id || null,
      bom_name: memoryByAsin[item.asin]?.bom_name || null,
      is_mapped: !!memoryByAsin[item.asin]?.bom_id,
    })) || [];

    // Filter by mapping status if requested
    let filteredListings = listings;
    if (mapped === 'true') {
      filteredListings = listings.filter(l => l.is_mapped);
    } else if (mapped === 'false') {
      filteredListings = listings.filter(l => !l.is_mapped);
    }

    sendSuccess(res, {
      listings: filteredListings,
      total: count || 0,
      mapped_count: listings.filter(l => l.is_mapped).length,
      unmapped_count: listings.filter(l => !l.is_mapped).length,
    });
  } catch (err) {
    console.error('Failed to fetch listings:', err);
    return errors.internal(res, 'Failed to fetch listings');
  }
});

/**
 * GET /amazon/settings
 * Get Amazon integration settings
 */
router.get('/settings', async (req, res) => {
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
    return errors.internal(res, 'Failed to fetch settings');
  }
});

/**
 * PUT /amazon/settings
 * Update Amazon integration settings
 */
router.put('/settings', async (req, res) => {
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
    return errors.internal(res, 'Failed to update settings');
  }
});

/**
 * GET /amazon/sync/history
 * Get sync history
 */
router.get('/sync/history', async (req, res) => {
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
    return errors.internal(res, 'Failed to fetch sync history');
  }
});

/**
 * GET /amazon/order/:orderId/details
 * Get enhanced order details including fees and profit
 */
router.get('/order/:orderId/details', async (req, res) => {
  const { orderId } = req.params;

  try {
    // Get order with all related data
    // NOTE: Schema fix - Use correct column names:
    // - boms: bundle_sku/description (not name/sku)
    // - bom_components: qty_required (not quantity)
    // - components: internal_sku/description/cost_ex_vat_pence (not name/sku/unit_cost_pence)
    const { data: order, error: orderError } = await supabase
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
          bom_id,
          listing_memory_id,
          boms (
            id,
            bundle_sku,
            description,
            bom_components (
              component_id,
              qty_required,
              components (
                id,
                internal_sku,
                description,
                cost_ex_vat_pence
              )
            )
          )
        )
      `)
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return errors.notFound(res, 'Order');
    }

    // Get shipment info
    const { data: shipment } = await supabase
      .from('amazon_shipments')
      .select('*')
      .eq('order_id', orderId)
      .maybeSingle();

    // Get fees for this order
    const amazonOrderId = order.amazon_order_id || order.external_order_id;
    const { data: fees } = await supabase
      .from('amazon_fees')
      .select('*')
      .eq('amazon_order_id', amazonOrderId);

    // Calculate totals and profit
    let totalRevenue = order.total_price_pence || 0;
    let totalFees = 0;
    let totalCost = 0;

    // Sum fees
    for (const fee of fees || []) {
      totalFees += fee.total_fees_pence || 0;
    }

    // Calculate component costs
    // NOTE: Schema fix - use qty_required and cost_ex_vat_pence
    for (const line of order.order_lines || []) {
      if (line.boms?.bom_components) {
        for (const bc of line.boms.bom_components) {
          const unitCost = bc.components?.cost_ex_vat_pence || 0;
          totalCost += unitCost * bc.qty_required * line.quantity;
        }
      }
    }

    // Build enhanced order response
    const enhancedOrder = {
      ...order,
      shipment,
      fees: fees || [],
      profit_analysis: {
        revenue_pence: totalRevenue,
        amazon_fees_pence: totalFees,
        component_cost_pence: totalCost,
        gross_profit_pence: totalRevenue - totalFees - totalCost,
        margin_percent: totalRevenue > 0
          ? ((totalRevenue - totalFees - totalCost) / totalRevenue * 100).toFixed(1)
          : 0,
      },
      amazon_data: order.raw_payload?._amazon_data || order.raw_payload,
    };

    sendSuccess(res, enhancedOrder);
  } catch (err) {
    console.error('Failed to fetch order details:', err);
    return errors.internal(res, 'Failed to fetch order details');
  }
});

/**
 * GET /amazon/scheduler/status
 * Get auto-sync scheduler status
 */
router.get('/scheduler/status', (req, res) => {
  sendSuccess(res, scheduler.getStatus());
});

/**
 * POST /amazon/scheduler/settings
 * Update scheduler settings
 */
router.post('/scheduler/settings', async (req, res) => {
  const { orderSyncEnabled, orderSyncInterval, trackingSyncEnabled, trackingSyncInterval, catalogSyncEnabled, catalogSyncInterval } = req.body;

  try {
    const updates = {};

    if (orderSyncEnabled !== undefined) {
      updates.order_sync_enabled = orderSyncEnabled ? 'true' : 'false';
    }
    if (orderSyncInterval !== undefined) {
      updates.order_sync_interval_minutes = String(orderSyncInterval);
    }
    if (trackingSyncEnabled !== undefined) {
      updates.tracking_sync_enabled = trackingSyncEnabled ? 'true' : 'false';
    }
    if (trackingSyncInterval !== undefined) {
      updates.tracking_sync_interval_minutes = String(trackingSyncInterval);
    }
    if (catalogSyncEnabled !== undefined) {
      updates.catalog_sync_enabled = catalogSyncEnabled ? 'true' : 'false';
    }
    if (catalogSyncInterval !== undefined) {
      updates.catalog_sync_interval_minutes = String(catalogSyncInterval);
    }

    for (const [key, value] of Object.entries(updates)) {
      await supabase
        .from('amazon_settings')
        .upsert({
          setting_key: key,
          setting_value: value,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'setting_key' });
    }

    await recordSystemEvent({
      eventType: 'SCHEDULER_SETTINGS_UPDATED',
      description: 'Auto-sync scheduler settings updated',
      metadata: updates,
    });

    sendSuccess(res, { message: 'Scheduler settings updated', settings: updates });
  } catch (err) {
    console.error('Failed to update scheduler settings:', err);
    return errors.internal(res, 'Failed to update settings');
  }
});

/**
 * POST /amazon/inventory/push
 * Push safe allocated quantities to Amazon FBM listings
 * Requires ADMIN and Idempotency-Key header
 */
router.post('/inventory/push', async (req, res) => {
  const {
    location = 'Warehouse',
    dry_run = true,
    only_mapped = true,
    limit = 50,
  } = req.body;

  // Require idempotency key for safety
  const idempotencyKey = req.headers['idempotency-key'];
  if (!idempotencyKey) {
    return errors.badRequest(res, 'Idempotency-Key header is required for inventory push');
  }

  // Safety cap
  const maxUpdates = Math.min(limit || 50, 200);

  try {
    // Import the allocation algorithm
    const { allocatePool, computeRecommendations } = await import('../utils/poolAllocation.js');

    // Step 1: Get pool allocation data
    const { data: poolResult, error: poolError } = await supabase
      .rpc('rpc_get_pool_allocation_data', { p_location: location });

    if (poolError) {
      console.warn('Pool RPC not available, using fallback:', poolError.message);
    }

    // Step 2: Get non-pooled BOMs data
    const { data: nonPooledResult, error: nonPooledError } = await supabase
      .rpc('rpc_get_non_pooled_boms', { p_location: location });

    if (nonPooledError) {
      console.warn('Non-pooled RPC not available, using fallback:', nonPooledError.message);
    }

    // Parse RPC results
    const poolData = poolResult?.ok ? poolResult.data : { pools: [] };
    const nonPooledData = nonPooledResult?.ok ? nonPooledResult.data : { boms: [] };

    // Step 3: Compute recommendations using allocation algorithm
    const recommendations = computeRecommendations(poolData, nonPooledData);

    // Create a map of bom_id -> recommended_qty
    const bomRecommendations = new Map();
    for (const rec of recommendations) {
      bomRecommendations.set(rec.bom_id, rec);
    }

    // Step 4: Get listing_memory entries with SKU and BOM mapping
    // These represent Amazon seller SKUs we control
    let listingQuery = supabase
      .from('listing_memory')
      .select(`
        id,
        asin,
        sku,
        bom_id,
        boms (
          id,
          bundle_sku,
          description
        )
      `)
      .eq('is_active', true)
      .not('bom_id', 'is', null);

    if (only_mapped) {
      listingQuery = listingQuery.not('sku', 'is', null);
    }

    const { data: listings, error: listingError } = await listingQuery;

    if (listingError) {
      throw listingError;
    }

    // Step 5: Build the update plan
    const updates = [];
    const skipped = [];

    for (const listing of listings || []) {
      // Must have a seller SKU to update Amazon
      if (!listing.sku) {
        skipped.push({
          asin: listing.asin,
          reason: 'No seller SKU',
        });
        continue;
      }

      // Get recommendation for this BOM
      const rec = bomRecommendations.get(listing.bom_id);
      if (!rec) {
        skipped.push({
          asin: listing.asin,
          sku: listing.sku,
          reason: 'BOM not found in recommendations',
        });
        continue;
      }

      updates.push({
        listing_memory_id: listing.id,
        asin: listing.asin,
        sku: listing.sku,
        bom_id: listing.bom_id,
        bundle_sku: listing.boms?.bundle_sku,
        bom_description: listing.boms?.description,
        new_qty: rec.recommended_qty,
        buildable: rec.buildable,
        pool_name: rec.pool_name || null,
        constraint_sku: rec.constraint_internal_sku || null,
      });
    }

    // Apply limit
    const limitedUpdates = updates.slice(0, maxUpdates);
    const truncated = updates.length > maxUpdates;

    // Step 6: If dry run, return the plan
    if (dry_run) {
      return sendSuccess(res, {
        dry_run: true,
        location,
        planned_updates: limitedUpdates.length,
        total_eligible: updates.length,
        truncated,
        max_limit: maxUpdates,
        skipped_count: skipped.length,
        updates: limitedUpdates,
        skipped: skipped.slice(0, 20), // Limit skipped list size
      });
    }

    // Step 7: Execute live push
    if (!spApiClient.isConfigured()) {
      return errors.badRequest(res, 'SP-API credentials not configured');
    }

    const results = {
      total: limitedUpdates.length,
      success: 0,
      failed: 0,
      errors: [],
    };

    const startedAt = new Date().toISOString();

    // Process updates sequentially with rate limiting
    for (const update of limitedUpdates) {
      try {
        await spApiClient.updateListingQuantity(update.sku, update.new_qty);
        results.success++;

        console.log(`[SP-API] Updated ${update.sku} quantity to ${update.new_qty}`);

        // Small delay between requests (rate limiting is also handled by spApiClient)
        await new Promise(r => setTimeout(r, 100));
      } catch (err) {
        results.failed++;
        results.errors.push({
          sku: update.sku,
          asin: update.asin,
          new_qty: update.new_qty,
          error: err.message,
        });
        console.error(`[SP-API] Failed to update ${update.sku}:`, err.message);
      }
    }

    const completedAt = new Date().toISOString();

    // Step 8: Log to amazon_sync_log
    try {
      await supabase.from('amazon_sync_log').insert({
        sync_type: 'INVENTORY_PUSH',
        started_at: startedAt,
        completed_at: completedAt,
        status: results.failed === 0 ? 'COMPLETED' : 'FAILED',
        items_processed: results.total,
        items_created: results.success,
        items_updated: 0,
        items_failed: results.failed,
        error_message: results.errors.length > 0 ? JSON.stringify(results.errors) : null,
        metadata: {
          location,
          idempotency_key: idempotencyKey,
          dry_run: false,
          truncated,
          skipped_count: skipped.length,
          partial_success: results.success > 0 && results.failed > 0,
        },
      });
    } catch (logErr) {
      console.error('Failed to log inventory push:', logErr.message);
    }

    // Record audit event
    await recordSystemEvent({
      eventType: 'AMAZON_INVENTORY_PUSH',
      description: `Pushed inventory to ${results.success} of ${results.total} Amazon listings`,
      metadata: {
        location,
        success: results.success,
        failed: results.failed,
        idempotency_key: idempotencyKey,
      },
      severity: results.failed > 0 ? 'WARN' : 'INFO',
    });

    sendSuccess(res, {
      dry_run: false,
      location,
      ...results,
      skipped_count: skipped.length,
      truncated,
    });
  } catch (err) {
    console.error('Inventory push failed:', err);
    return errors.internal(res, `Inventory push failed: ${err.message}`);
  }
});

/**
 * GET /amazon/stats
 * Get Amazon-specific statistics including sales dashboard data
 */
router.get('/stats', async (req, res) => {
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

    // Get start of last month for comparison
    const startOfLastMonth = new Date(startOfMonth);
    startOfLastMonth.setMonth(startOfLastMonth.getMonth() - 1);

    const { data: revenueData } = await supabase
      .from('orders')
      .select('total_price_pence')
      .eq('channel', 'AMAZON')
      .gte('order_date', startOfMonth.toISOString().split('T')[0])
      .not('status', 'eq', 'CANCELLED');

    const monthlyRevenue = revenueData?.reduce((sum, o) => sum + (o.total_price_pence || 0), 0) || 0;

    // Last month revenue for comparison
    const { data: lastMonthData } = await supabase
      .from('orders')
      .select('total_price_pence')
      .eq('channel', 'AMAZON')
      .gte('order_date', startOfLastMonth.toISOString().split('T')[0])
      .lt('order_date', startOfMonth.toISOString().split('T')[0])
      .not('status', 'eq', 'CANCELLED');

    const lastMonthRevenue = lastMonthData?.reduce((sum, o) => sum + (o.total_price_pence || 0), 0) || 0;

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

    // Get daily sales for the last 14 days
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const { data: dailyOrders } = await supabase
      .from('orders')
      .select('order_date, total_price_pence')
      .eq('channel', 'AMAZON')
      .gte('order_date', fourteenDaysAgo.toISOString().split('T')[0])
      .not('status', 'eq', 'CANCELLED');

    // Aggregate by day
    const dailySales = {};
    for (const order of dailyOrders || []) {
      const date = order.order_date;
      if (!dailySales[date]) {
        dailySales[date] = { date, orders: 0, revenue_pence: 0 };
      }
      dailySales[date].orders++;
      dailySales[date].revenue_pence += order.total_price_pence || 0;
    }

    // Sort by date and fill in missing days
    const salesTrend = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      salesTrend.push(dailySales[dateStr] || { date: dateStr, orders: 0, revenue_pence: 0 });
    }

    // Get top selling ASINs this month
    const { data: topProducts } = await supabase
      .from('order_lines')
      .select(`
        asin,
        title,
        quantity,
        orders!inner(order_date, channel, status)
      `)
      .eq('orders.channel', 'AMAZON')
      .not('orders.status', 'eq', 'CANCELLED')
      .gte('orders.order_date', startOfMonth.toISOString().split('T')[0]);

    // Aggregate by ASIN
    const asinSales = {};
    for (const line of topProducts || []) {
      const key = line.asin || 'UNKNOWN';
      if (!asinSales[key]) {
        asinSales[key] = { asin: key, title: line.title, quantity: 0 };
      }
      asinSales[key].quantity += line.quantity || 1;
    }

    const topAsins = Object.values(asinSales)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    // Calculate growth rate
    const revenueGrowth = lastMonthRevenue > 0
      ? ((monthlyRevenue - lastMonthRevenue) / lastMonthRevenue * 100).toFixed(1)
      : 0;

    sendSuccess(res, {
      orders_by_status: statusCounts,
      total_orders: orderStats?.length || 0,
      monthly_revenue_pence: monthlyRevenue,
      monthly_fees_pence: monthlyFees,
      monthly_net_pence: monthlyRevenue - monthlyFees,
      pending_shipments: pendingShipments || 0,
      last_month_revenue_pence: lastMonthRevenue,
      revenue_growth_percent: parseFloat(revenueGrowth),
      sales_trend: salesTrend,
      top_products: topAsins,
      monthly_order_count: revenueData?.length || 0,
    });
  } catch (err) {
    console.error('Failed to fetch Amazon stats:', err);
    return errors.internal(res, 'Failed to fetch stats');
  }
});

export default router;
