#!/usr/bin/env node
/**
 * Import Amazon All Orders Report TSV
 *
 * Purpose: Import historical Amazon order data for demand model training.
 * Report source: Amazon Seller Central > Reports > Fulfillment > All Orders
 *
 * Usage:
 *   node server/scripts/importAmazonAllOrdersReport.js --file ./report.txt [--dry-run]
 *
 * Report format (TSV):
 *   - order-id, order-item-id, purchase-date, sku, product-name, quantity-purchased
 *   - currency, item-price, item-tax, shipping-price, shipping-tax
 *   - buyer-email, buyer-name, recipient-name, ship-address-* fields
 *
 * Behavior:
 *   - Orders are upserted on conflict (external_order_id, channel)
 *   - Order lines use partial unique index on (order_id, external_line_id)
 *   - Historical orders get status='DISPATCHED' to avoid polluting picking queues
 *   - SKU->ASIN mapping via listing_memory for demand model training accuracy
 */

import fs from 'fs';
import readline from 'readline';
import { createClient } from '@supabase/supabase-js';
import { recordSystemEvent } from '../services/audit.js';

// Parse command line arguments
const args = process.argv.slice(2);
const fileIndex = args.indexOf('--file');
const dryRun = args.includes('--dry-run');

if (fileIndex === -1 || !args[fileIndex + 1]) {
  console.error('Usage: node importAmazonAllOrdersReport.js --file <path> [--dry-run]');
  process.exit(1);
}

const filePath = args[fileIndex + 1];

if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Parse a TSV line into an object using headers
 */
function parseTsvLine(line, headers) {
  const values = line.split('\t');
  const obj = {};
  for (let i = 0; i < headers.length; i++) {
    obj[headers[i]] = values[i] || null;
  }
  return obj;
}

/**
 * Parse currency amount to pence (handles "GBP 12.99" or "12.99")
 */
function parsePriceToPence(priceStr) {
  if (!priceStr || priceStr.trim() === '') return null;
  // Remove currency code if present
  const numStr = priceStr.replace(/[A-Z]{3}\s*/i, '').trim();
  const num = parseFloat(numStr);
  if (isNaN(num)) return null;
  return Math.round(num * 100);
}

/**
 * Parse ISO 8601 date to YYYY-MM-DD
 */
function parseDateOnly(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    return d.toISOString().split('T')[0];
  } catch {
    return null;
  }
}

/**
 * Build shipping address JSON from report fields
 */
function buildShippingAddress(row) {
  const address = {};
  const fields = [
    'ship-address-1', 'ship-address-2', 'ship-address-3',
    'ship-city', 'ship-state', 'ship-postal-code', 'ship-country'
  ];

  let hasData = false;
  for (const field of fields) {
    const key = field.replace('ship-', '').replace(/-/g, '_');
    if (row[field]) {
      address[key] = row[field];
      hasData = true;
    }
  }

  return hasData ? address : null;
}

/**
 * Main import function
 */
async function importReport() {
  console.log(`\n[Amazon Report Import] Starting import from: ${filePath}`);
  console.log(`[Amazon Report Import] Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);

  // Pre-load SKU -> ASIN mapping from listing_memory
  console.log('[Amazon Report Import] Loading SKU -> ASIN mapping...');
  const { data: listings, error: listingsError } = await supabase
    .from('listing_memory')
    .select('sku, asin, bom_id, id')
    .eq('is_active', true)
    .not('sku', 'is', null);

  if (listingsError) {
    console.error('Failed to load listing_memory:', listingsError);
    process.exit(1);
  }

  const skuToListing = new Map();
  for (const listing of listings || []) {
    if (listing.sku) {
      skuToListing.set(listing.sku, listing);
    }
  }
  console.log(`[Amazon Report Import] Loaded ${skuToListing.size} SKU mappings`);

  // Stats tracking
  const stats = {
    ordersProcessed: 0,
    ordersCreated: 0,
    ordersUpdated: 0,
    orderLinesProcessed: 0,
    orderLinesCreated: 0,
    orderLinesUpdated: 0,
    skuMapped: 0,
    errors: [],
  };

  // Group rows by order-id for batch processing
  const orderRows = new Map(); // order-id -> [rows]

  // Read and parse file
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let headers = null;
  let lineNum = 0;

  for await (const line of rl) {
    lineNum++;

    // Skip empty lines
    if (!line.trim()) continue;

    // First line is headers
    if (headers === null) {
      headers = line.split('\t').map(h => h.trim().toLowerCase());
      console.log(`[Amazon Report Import] Found ${headers.length} columns`);
      continue;
    }

    // Parse data row
    const row = parseTsvLine(line, headers);
    const orderId = row['order-id'];

    if (!orderId) {
      stats.errors.push({ line: lineNum, error: 'Missing order-id' });
      continue;
    }

    if (!orderRows.has(orderId)) {
      orderRows.set(orderId, []);
    }
    orderRows.get(orderId).push(row);
  }

  console.log(`[Amazon Report Import] Parsed ${orderRows.size} orders from ${lineNum} lines`);

  // Process orders in batches
  const BATCH_SIZE = 100;
  const orderIds = Array.from(orderRows.keys());

  for (let i = 0; i < orderIds.length; i += BATCH_SIZE) {
    const batchOrderIds = orderIds.slice(i, i + BATCH_SIZE);

    for (const orderId of batchOrderIds) {
      const rows = orderRows.get(orderId);
      const firstRow = rows[0];

      try {
        // Build order object from first row (order-level data)
        const orderDate = parseDateOnly(firstRow['purchase-date']);

        // Calculate total price from all line items
        let totalPricePence = 0;
        for (const row of rows) {
          const itemPrice = parsePriceToPence(row['item-price']) || 0;
          const itemTax = parsePriceToPence(row['item-tax']) || 0;
          const shippingPrice = parsePriceToPence(row['shipping-price']) || 0;
          const shippingTax = parsePriceToPence(row['shipping-tax']) || 0;
          totalPricePence += itemPrice + itemTax + shippingPrice + shippingTax;
        }

        const orderData = {
          external_order_id: orderId,
          amazon_order_id: orderId,
          channel: 'AMAZON',
          status: 'DISPATCHED', // Historical orders - already fulfilled
          order_date: orderDate,
          customer_email: firstRow['buyer-email'] || null,
          customer_name: firstRow['buyer-name'] || firstRow['recipient-name'] || null,
          shipping_address: buildShippingAddress(firstRow),
          total_price_pence: totalPricePence || null,
          currency: firstRow['currency'] || 'GBP',
          raw_payload: {
            source: 'AMAZON_ALL_ORDERS_REPORT',
            imported_at: new Date().toISOString(),
          },
        };

        if (dryRun) {
          console.log(`[DRY RUN] Would upsert order: ${orderId}`);
          stats.ordersProcessed++;
          stats.ordersCreated++;
        } else {
          // Upsert order
          const { data: upsertedOrder, error: orderError } = await supabase
            .from('orders')
            .upsert(orderData, {
              onConflict: 'external_order_id,channel',
              ignoreDuplicates: false,
            })
            .select('id')
            .single();

          if (orderError) {
            // Try to fetch existing order
            const { data: existingOrder } = await supabase
              .from('orders')
              .select('id')
              .eq('external_order_id', orderId)
              .eq('channel', 'AMAZON')
              .maybeSingle();

            if (existingOrder) {
              stats.ordersUpdated++;
              await processOrderLines(existingOrder.id, rows, skuToListing, stats, dryRun);
            } else {
              stats.errors.push({ orderId, error: orderError.message });
            }
          } else {
            stats.ordersCreated++;
            await processOrderLines(upsertedOrder.id, rows, skuToListing, stats, dryRun);
          }

          stats.ordersProcessed++;
        }

        // Process order lines in dry run mode
        if (dryRun) {
          for (const row of rows) {
            const sku = row['sku'];
            const listing = sku ? skuToListing.get(sku) : null;
            if (listing?.asin) stats.skuMapped++;
            stats.orderLinesProcessed++;
            stats.orderLinesCreated++;
          }
        }

      } catch (err) {
        stats.errors.push({ orderId, error: err.message });
      }
    }

    // Progress update
    const processed = Math.min(i + BATCH_SIZE, orderIds.length);
    console.log(`[Amazon Report Import] Processed ${processed}/${orderIds.length} orders...`);
  }

  // Print summary
  console.log('\n[Amazon Report Import] ===== IMPORT SUMMARY =====');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Orders processed: ${stats.ordersProcessed}`);
  console.log(`Orders created: ${stats.ordersCreated}`);
  console.log(`Orders updated: ${stats.ordersUpdated}`);
  console.log(`Order lines processed: ${stats.orderLinesProcessed}`);
  console.log(`Order lines created: ${stats.orderLinesCreated}`);
  console.log(`Order lines updated: ${stats.orderLinesUpdated}`);
  console.log(`SKUs mapped to ASIN: ${stats.skuMapped}`);
  console.log(`Errors: ${stats.errors.length}`);

  if (stats.errors.length > 0) {
    console.log('\nFirst 10 errors:');
    for (const err of stats.errors.slice(0, 10)) {
      console.log(`  - ${err.orderId || err.line}: ${err.error}`);
    }
  }

  // Record system event (unless dry run)
  if (!dryRun) {
    await recordSystemEvent({
      eventType: 'AMAZON_ORDER_REPORT_IMPORT',
      description: `Imported ${stats.ordersCreated} orders, ${stats.orderLinesCreated} lines from Amazon All Orders Report`,
      metadata: {
        file: filePath,
        orders_created: stats.ordersCreated,
        orders_updated: stats.ordersUpdated,
        lines_created: stats.orderLinesCreated,
        lines_updated: stats.orderLinesUpdated,
        sku_mapped: stats.skuMapped,
        errors: stats.errors.length,
      },
      severity: stats.errors.length > 0 ? 'WARN' : 'INFO',
    });
  }

  console.log('\n[Amazon Report Import] Done!');
}

/**
 * Process order lines for a given order
 */
async function processOrderLines(orderId, rows, skuToListing, stats, dryRun) {
  for (const row of rows) {
    const orderItemId = row['order-item-id'];
    const sku = row['sku'];
    const quantity = parseInt(row['quantity-purchased'], 10) || 1;
    const itemPricePence = parsePriceToPence(row['item-price']);
    const unitPricePence = itemPricePence && quantity > 0
      ? Math.round(itemPricePence / quantity)
      : null;

    // Map SKU -> ASIN via listing_memory
    const listing = sku ? skuToListing.get(sku) : null;
    const asin = listing?.asin || null;
    const listingMemoryId = listing?.id || null;
    const bomId = listing?.bom_id || null;

    if (asin) {
      stats.skuMapped++;
    }

    const lineData = {
      order_id: orderId,
      external_line_id: orderItemId || null,
      sku: sku || null,
      asin: asin,
      title: row['product-name'] || null,
      quantity: quantity,
      unit_price_pence: unitPricePence,
      listing_memory_id: listingMemoryId,
      bom_id: bomId,
      resolution_source: bomId ? 'LISTING_MEMORY' : null,
      is_resolved: !!bomId,
    };

    if (dryRun) {
      stats.orderLinesProcessed++;
      stats.orderLinesCreated++;
    } else {
      // Try to upsert using external_line_id uniqueness
      if (orderItemId) {
        // Check if line exists
        const { data: existingLine } = await supabase
          .from('order_lines')
          .select('id')
          .eq('order_id', orderId)
          .eq('external_line_id', orderItemId)
          .maybeSingle();

        if (existingLine) {
          // Update existing
          await supabase
            .from('order_lines')
            .update({
              sku: lineData.sku,
              asin: lineData.asin,
              title: lineData.title,
              quantity: lineData.quantity,
              unit_price_pence: lineData.unit_price_pence,
              listing_memory_id: lineData.listing_memory_id,
              bom_id: lineData.bom_id,
              resolution_source: lineData.resolution_source,
              is_resolved: lineData.is_resolved,
            })
            .eq('id', existingLine.id);

          stats.orderLinesUpdated++;
        } else {
          // Insert new
          await supabase.from('order_lines').insert(lineData);
          stats.orderLinesCreated++;
        }
      } else {
        // No external_line_id, just insert (may create duplicates on re-run)
        await supabase.from('order_lines').insert(lineData);
        stats.orderLinesCreated++;
      }

      stats.orderLinesProcessed++;
    }
  }
}

// Run the import
importReport().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
