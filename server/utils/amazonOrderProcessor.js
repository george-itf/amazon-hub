/**
 * Amazon Order Processor
 * Shared utility for processing Amazon orders from SP-API
 * Used by both the API routes and the scheduler
 */
import supabase from '../services/supabase.js';
import spApiClient from '../services/spApi.js';
import { resolveListing } from './memoryResolution.js';
import { normalizeAsin, normalizeSku, fingerprintTitle } from './identityNormalization.js';
import { isCompoundSku, parseAndMatchSku, generateBundleSku } from './skuParser.js';

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
 * Attempt to infer a BOM from a compound SKU
 *
 * If the SKU contains patterns like "DHR242Z+2xBL1850+DC18RC", attempt to:
 * 1. Parse it into component parts with quantities
 * 2. Match against existing components
 * 3. Auto-create a BOM with review_status='PENDING_REVIEW' if all parts match
 * 4. Create a listing_memory entry for future resolution
 *
 * @param {string} asin - The ASIN of the listing
 * @param {string} sku - The seller SKU to parse
 * @param {string} title - The listing title
 * @param {string} fingerprint - The title fingerprint
 * @returns {Promise<{id: string, bom_id: string, resolution_source: string}|null>}
 */
async function attemptSkuBasedBomInference(asin, sku, title, fingerprint) {
  // Only attempt if SKU looks like a compound SKU
  if (!isCompoundSku(sku)) {
    return null;
  }

  try {
    // Fetch all active components for matching
    const { data: components, error: compError } = await supabase
      .from('components')
      .select('id, internal_sku')
      .eq('is_active', true);

    if (compError || !components || components.length === 0) {
      console.log('[SKU Parser] No components found for matching');
      return null;
    }

    // Parse SKU and try to match
    const result = parseAndMatchSku(sku, components);

    // Only proceed if ALL parts matched
    if (!result.allMatched || result.totalParts === 0) {
      console.log(`[SKU Parser] Partial match for SKU ${sku}: ${result.matchedCount}/${result.totalParts} parts matched`);
      return null;
    }

    console.log(`[SKU Parser] All ${result.totalParts} parts matched for SKU ${sku}`);

    // Filter out null matches and build matched components array
    const matchedComponents = result.matches.filter(m => m !== null);

    // Generate a canonical bundle_sku from matched components
    const bundleSku = generateBundleSku(matchedComponents);

    // Check if a BOM with this bundle_sku already exists
    const { data: existingBom } = await supabase
      .from('boms')
      .select('id, review_status')
      .eq('bundle_sku', bundleSku)
      .maybeSingle();

    let bomId;
    let bomCreated = false;

    if (existingBom) {
      // Use existing BOM (could be PENDING_REVIEW, APPROVED, or REJECTED)
      bomId = existingBom.id;
      console.log(`[SKU Parser] Found existing BOM ${bundleSku} (status: ${existingBom.review_status})`);
    } else {
      // Create new BOM with PENDING_REVIEW status
      const { data: newBom, error: bomError } = await supabase
        .from('boms')
        .insert({
          bundle_sku: bundleSku,
          description: `Auto-inferred from SKU: ${sku}`,
          is_active: true,
          review_status: 'PENDING_REVIEW',
        })
        .select('id')
        .single();

      if (bomError) {
        console.error('[SKU Parser] Failed to create BOM:', bomError.message);
        return null;
      }

      bomId = newBom.id;
      bomCreated = true;

      // Insert bom_components for the new BOM
      const bomComponents = matchedComponents.map(m => ({
        bom_id: bomId,
        component_id: m.component_id,
        qty_required: m.qty_required,
      }));

      const { error: compInsertError } = await supabase
        .from('bom_components')
        .insert(bomComponents);

      if (compInsertError) {
        console.error('[SKU Parser] Failed to insert bom_components:', compInsertError.message);
        // Clean up the orphaned BOM
        await supabase.from('boms').delete().eq('id', bomId);
        return null;
      }

      console.log(`[SKU Parser] Created new BOM ${bundleSku} with ${bomComponents.length} components (PENDING_REVIEW)`);
    }

    // Check if listing_memory entry already exists for this SKU
    const { data: existingMemory } = await supabase
      .from('listing_memory')
      .select('id, bom_id')
      .eq('sku', sku)
      .eq('is_active', true)
      .maybeSingle();

    let listingMemoryId;

    if (existingMemory) {
      // Update existing listing_memory if bom_id is not set
      if (!existingMemory.bom_id) {
        await supabase
          .from('listing_memory')
          .update({
            bom_id: bomId,
            resolution_source: 'SKU_INFERENCE',
          })
          .eq('id', existingMemory.id);
      }
      listingMemoryId = existingMemory.id;
    } else {
      // Create new listing_memory entry
      const { data: newMemory, error: memError } = await supabase
        .from('listing_memory')
        .insert({
          asin: asin,
          sku: sku,
          title_fingerprint: fingerprint,
          bom_id: bomId,
          resolution_source: 'SKU_INFERENCE',
          is_active: true,
          created_by_actor_type: 'SYSTEM',
          created_by_actor_display: 'SKU Parser',
        })
        .select('id')
        .single();

      if (memError) {
        console.error('[SKU Parser] Failed to create listing_memory:', memError.message);
        // Don't fail completely - BOM still exists for future use
        return null;
      }

      listingMemoryId = newMemory.id;
      console.log(`[SKU Parser] Created listing_memory for SKU ${sku}`);
    }

    return {
      id: listingMemoryId,
      bom_id: bomId,
      resolution_source: 'SKU_INFERENCE',
      bom_created: bomCreated,
    };
  } catch (error) {
    console.error('[SKU Parser] Error during SKU-based inference:', error.message);
    return null;
  }
}

/**
 * Replace Shopify order lines with Amazon-sourced lines
 *
 * When a Shopify order is linked to an Amazon order, we need to replace
 * the original Shopify line items with Amazon's authoritative data because:
 * - Amazon always provides ASIN (Shopify often doesn't)
 * - Amazon has accurate SKU mapping
 * - Resolution is more reliable with direct ASIN lookup
 *
 * @param {string} orderId - The internal order UUID
 * @param {string} amazonOrderId - The Amazon order ID (e.g., 206-1234567-8901234)
 * @param {Object} amazonOrder - Raw Amazon order data from SP-API
 * @returns {Promise<{replaced: number, resolved: number, unresolved: number, allResolved: boolean}>}
 */
export async function replaceOrderLinesFromAmazon(orderId, amazonOrderId, amazonOrder) {
  console.log(`[Amazon] Replacing order lines for ${orderId} with Amazon data from ${amazonOrderId}`);

  // Step 1: Delete existing order lines for this order
  const { data: existingLines, error: fetchError } = await supabase
    .from('order_lines')
    .select('id')
    .eq('order_id', orderId);

  if (fetchError) {
    console.error('[Amazon] Failed to fetch existing order lines:', fetchError.message);
    throw new Error(`Failed to fetch existing order lines: ${fetchError.message}`);
  }

  const existingLineIds = (existingLines || []).map(l => l.id);

  if (existingLineIds.length > 0) {
    // Delete the existing order lines
    const { error: deleteError } = await supabase
      .from('order_lines')
      .delete()
      .eq('order_id', orderId);

    if (deleteError) {
      console.error('[Amazon] Failed to delete existing order lines:', deleteError.message);
      throw new Error(`Failed to delete existing order lines: ${deleteError.message}`);
    }

    console.log(`[Amazon] Deleted ${existingLineIds.length} existing Shopify order lines`);
  }

  // Step 2: Delete stale review_queue entries for this order
  const { error: reviewDeleteError } = await supabase
    .from('review_queue')
    .delete()
    .eq('order_id', orderId)
    .eq('status', 'PENDING');

  if (reviewDeleteError) {
    console.warn('[Amazon] Failed to clean up review queue:', reviewDeleteError.message);
    // Non-fatal - continue processing
  }

  // Step 3: Fetch order items from Amazon
  const orderItems = await spApiClient.getOrderItems(amazonOrderId);
  const items = orderItems.OrderItems || [];

  if (items.length === 0) {
    console.warn(`[Amazon] No order items found for ${amazonOrderId}`);
    return { replaced: 0, resolved: 0, unresolved: 0, allResolved: true };
  }

  // Step 4: Process each Amazon line item
  const processedLines = [];
  let resolvedCount = 0;
  let unresolvedCount = 0;

  for (const item of items) {
    const asin = normalizeAsin(item.ASIN);
    const sku = normalizeSku(item.SellerSKU);
    const title = item.Title || '';
    const fingerprint = fingerprintTitle(title);

    // Attempt to resolve listing using the standard resolution flow
    let resolution = await resolveListing(asin, sku, title);
    let isResolved = resolution !== null && resolution.bom_id !== null;
    let resolutionSource = isResolved ? 'MEMORY' : null;

    // If standard resolution failed, try SKU-based BOM inference
    if (!isResolved) {
      const skuInference = await attemptSkuBasedBomInference(asin, sku, title, fingerprint);
      if (skuInference) {
        resolution = skuInference;
        isResolved = true;
        resolutionSource = 'SKU_INFERENCE';
        console.log(`[Amazon] SKU inference succeeded for ${sku} -> BOM ${resolution.bom_id}`);
      }
    }

    if (isResolved) {
      resolvedCount++;
    } else {
      unresolvedCount++;
    }

    const quantity = item.QuantityOrdered || 1;
    const pricePerUnit = item.ItemPrice
      ? Math.round(parseFloat(item.ItemPrice.Amount) / quantity * 100)
      : 0;

    processedLines.push({
      item,
      asin,
      sku,
      title,
      fingerprint,
      resolution,
      isResolved,
      resolutionSource,
      quantity,
      pricePerUnit,
    });
  }

  // Step 5: Insert new Amazon-sourced order lines
  for (const processed of processedLines) {
    const { item, asin, sku, title, fingerprint, resolution, isResolved, resolutionSource, quantity, pricePerUnit } = processed;

    const { error: lineError } = await supabase
      .from('order_lines')
      .insert({
        order_id: orderId,
        external_line_id: item.OrderItemId || null,
        asin: asin,
        sku: sku,
        title: title,
        title_fingerprint: fingerprint,
        quantity: quantity,
        unit_price_pence: pricePerUnit,
        listing_memory_id: resolution?.id || null,
        bom_id: resolution?.bom_id || null,
        resolution_source: resolutionSource,
        is_resolved: isResolved,
        parse_intent: null,
        line_source: 'AMAZON',
      });

    if (lineError) {
      console.error('[Amazon] Order line insert error:', lineError.message);
      // Continue processing other lines
    }

    // Create review queue entry for unresolved items
    if (!isResolved) {
      await supabase.from('review_queue').insert({
        order_id: orderId,
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

  const allResolved = unresolvedCount === 0;

  console.log(`[Amazon] Replaced ${processedLines.length} lines: ${resolvedCount} resolved, ${unresolvedCount} unresolved`);

  return {
    replaced: processedLines.length,
    resolved: resolvedCount,
    unresolved: unresolvedCount,
    allResolved,
  };
}

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

  // If we found a matching Shopify order, link them and replace order lines
  if (linkedShopifyOrder) {
    console.log(`[Amazon] Found matching Shopify order ${linkedShopifyOrder.external_order_id} for Amazon order ${amazonOrderId}`);

    // Parse Amazon shipping address for enrichment
    const amazonShippingAddress = amazonOrder.ShippingAddress || {};
    const amazonCustomerName = amazonShippingAddress.Name || amazonOrder.BuyerInfo?.BuyerName || null;
    const amazonCustomerEmail = amazonOrder.BuyerInfo?.BuyerEmail || null;

    // Build Amazon shipping address as jsonb
    const amazonShippingAddressJson = amazonShippingAddress.AddressLine1 ? {
      name: amazonShippingAddress.Name,
      address1: amazonShippingAddress.AddressLine1,
      address2: amazonShippingAddress.AddressLine2 || null,
      city: amazonShippingAddress.City,
      province: amazonShippingAddress.StateOrRegion || null,
      zip: amazonShippingAddress.PostalCode,
      country: amazonShippingAddress.CountryCode,
      phone: amazonShippingAddress.Phone || null,
    } : null;

    // Parse order total from Amazon
    const amazonOrderTotalPence = amazonOrder.OrderTotal
      ? Math.round(parseFloat(amazonOrder.OrderTotal.Amount) * 100)
      : null;

    // Replace order lines with Amazon-sourced data
    const lineResult = await replaceOrderLinesFromAmazon(
      linkedShopifyOrder.id,
      amazonOrderId,
      amazonOrder
    );

    // Determine new status based on line resolution and Amazon status
    let newStatus = linkedShopifyOrder.status;
    const amazonStatus = STATUS_MAP[amazonOrder.OrderStatus] || 'NEEDS_REVIEW';

    // If Amazon says it's shipped/cancelled, use that status
    if (amazonStatus === 'DISPATCHED' || amazonStatus === 'CANCELLED') {
      newStatus = amazonStatus;
    } else if (lineResult.allResolved) {
      // All lines resolved - order is ready to pick
      newStatus = 'READY_TO_PICK';
    } else {
      // Some lines unresolved - needs review
      newStatus = 'NEEDS_REVIEW';
    }

    // Update order with Amazon data and new status
    const { error: updateError } = await supabase
      .from('orders')
      .update({
        amazon_order_id: amazonOrderId,
        source_channel: 'AMAZON',
        status: newStatus,
        // Enrich with Amazon data (prefer Amazon shipping address if available)
        shipping_address: amazonShippingAddressJson || linkedShopifyOrder.shipping_address,
        customer_name: amazonCustomerName || linkedShopifyOrder.customer_name,
        customer_email: amazonCustomerEmail || linkedShopifyOrder.customer_email,
        // Update total if Amazon provides it
        total_price_pence: amazonOrderTotalPence || linkedShopifyOrder.total_price_pence,
        raw_payload: {
          ...linkedShopifyOrder.raw_payload,
          _amazon_data: amazonOrder,
          _lines_replaced_at: new Date().toISOString(),
          _lines_replaced_count: lineResult.replaced,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', linkedShopifyOrder.id);

    if (updateError) {
      console.error('[Amazon] Failed to update linked order:', updateError.message);
      throw new Error(`Failed to update linked order: ${updateError.message}`);
    }

    console.log(`[Amazon] Linked and updated order ${amazonOrderId}: ${lineResult.replaced} lines replaced, status=${newStatus} (${lineResult.resolved} resolved, ${lineResult.unresolved} unresolved)`);
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
    let resolution = await resolveListing(asin, sku, title);
    let isResolved = resolution !== null && resolution.bom_id !== null;
    let resolutionSource = isResolved ? 'MEMORY' : null;

    // If standard resolution failed, try SKU-based BOM inference
    if (!isResolved) {
      const skuInference = await attemptSkuBasedBomInference(asin, sku, title, fingerprint);
      if (skuInference) {
        resolution = skuInference;
        isResolved = true;
        resolutionSource = 'SKU_INFERENCE';
        console.log(`[Amazon Processor] SKU inference succeeded for ${sku} -> BOM ${resolution.bom_id}`);
      }
    }

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
      resolutionSource,
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
    const { item, asin, sku, title, fingerprint, resolution, isResolved, resolutionSource } = processed;
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
        resolution_source: resolutionSource,
        is_resolved: isResolved,
        parse_intent: null,
        line_source: 'AMAZON',
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
