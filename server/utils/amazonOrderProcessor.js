/**
 * Amazon Order Processor
 * Shared utility for processing Amazon orders from SP-API
 * Used by both the API routes and the scheduler
 */
import supabase from '../services/supabase.js';
import spApiClient from '../services/spApi.js';
import { resolveListing } from './memoryResolution.js';
import { normalizeAsin, normalizeSku, fingerprintTitle } from './identityNormalization.js';

/**
 * Map Amazon order status to internal status
 */
const STATUS_MAP = {
  'Pending': 'IMPORTED',
  'Unshipped': 'READY_TO_PICK',
  'PartiallyShipped': 'PICKED',
  'Shipped': 'DISPATCHED',
  'Canceled': 'CANCELLED',
  'Unfulfillable': 'CANCELLED',
};

/**
 * Process a single Amazon order
 * @param {Object} amazonOrder - Raw Amazon order data from SP-API
 * @param {Object} results - Results tracking object (modified in place)
 * @returns {Promise<void>}
 */
export async function processAmazonOrder(amazonOrder, results) {
  const amazonOrderId = amazonOrder.AmazonOrderId;

  // Check if this Amazon order already exists
  const { data: existingAmazon } = await supabase
    .from('orders')
    .select('id, status')
    .eq('external_order_id', amazonOrderId)
    .eq('channel', 'AMAZON')
    .maybeSingle();

  const amazonStatus = STATUS_MAP[amazonOrder.OrderStatus] || 'NEEDS_REVIEW';

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
  const { data: matchingShopify } = await supabase
    .from('orders')
    .select('id, status, external_order_id')
    .eq('channel', 'shopify')
    .eq('amazon_order_id', amazonOrderId)
    .maybeSingle();

  // Also check if Shopify order has Amazon order ID in raw_payload
  let linkedShopifyOrder = matchingShopify;
  if (!linkedShopifyOrder) {
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

        const noteMatch = payload.note?.includes(amazonOrderId);
        const tagMatch = payload.tags?.includes(amazonOrderId);
        const nameMatch = payload.name?.includes(amazonOrderId);

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

    console.log(`[Amazon] Linked Amazon order ${amazonOrderId} to Shopify order ${linkedShopifyOrder.external_order_id}`);
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
 * Create a new results tracking object
 */
export function createResultsTracker() {
  return {
    total: 0,
    created: 0,
    updated: 0,
    linked: 0,
    skipped: 0,
    errors: [],
  };
}
