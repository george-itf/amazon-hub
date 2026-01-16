import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const domain = process.env.SHOPIFY_DOMAIN;
const token = process.env.SHOPIFY_ADMIN_TOKEN;

// Request timeout (30 seconds)
const REQUEST_TIMEOUT = 30000;

// ISO date format regex (YYYY-MM-DD or full ISO string)
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})?)?$/;

if (!domain || !token) {
  console.warn('Shopify domain or token not configured.  Order import will not work until these are set.');
}

/**
 * Helper to validate ISO date strings
 */
function isValidISODate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  if (!ISO_DATE_REGEX.test(dateStr)) return false;
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

/**
 * Helper to make fetch request with timeout
 */
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Shopify API request timeout after ${REQUEST_TIMEOUT}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetches all open and unfulfilled orders from the Shopify Admin API.  The
 * request filters to only include orders that are open and not yet
 * fulfilled, per the binder specification.  The returned JSON
 * structure follows the Shopify API documentation.  Throws on any
 * non‑200 status.
 *
 * @returns {Promise<Array>} list of order objects
 */
export async function fetchOpenOrders() {
  if (!domain || !token) {
    throw new Error('Shopify credentials are not configured.');
  }
  const url = `https://${domain}/admin/api/2023-10/orders.json?status=open&fulfillment_status=unfulfilled`;
  const resp = await fetchWithTimeout(url, {
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  });
  if (!resp.ok) {
    // Limit error body size to prevent memory issues
    const body = await resp.text();
    const truncatedBody = body.length > 500 ? body.substring(0, 500) + '...' : body;
    throw new Error(`Failed to fetch orders from Shopify: ${resp.status} ${truncatedBody}`);
  }
  const data = await resp.json();
  return data.orders || [];
}

/**
 * Fetches historical orders from Shopify with configurable filters.
 * Supports pagination to fetch large batches of orders.
 *
 * @param {Object} options - Filter options
 * @param {string} options.status - Order status: 'any', 'open', 'closed', 'cancelled'
 * @param {string} options.fulfillment_status - 'any', 'fulfilled', 'unfulfilled', 'partial'
 * @param {string} options.created_at_min - ISO date string for minimum created date
 * @param {string} options.created_at_max - ISO date string for maximum created date
 * @param {number} options.limit - Max orders per page (default 50, max 250)
 * @returns {Promise<Array>} list of order objects
 */
export async function fetchHistoricalOrders(options = {}) {
  if (!domain || !token) {
    throw new Error('Shopify credentials are not configured.');
  }

  const params = new URLSearchParams();

  // Status filter (default to 'any' for historical)
  params.set('status', options.status || 'any');

  // Fulfillment status (default to 'any' for historical)
  if (options.fulfillment_status) {
    params.set('fulfillment_status', options.fulfillment_status);
  }

  // Date filters with validation
  if (options.created_at_min) {
    if (!isValidISODate(options.created_at_min)) {
      throw new Error('Invalid created_at_min date format. Use ISO 8601 format (YYYY-MM-DD or full ISO string).');
    }
    params.set('created_at_min', options.created_at_min);
  }
  if (options.created_at_max) {
    if (!isValidISODate(options.created_at_max)) {
      throw new Error('Invalid created_at_max date format. Use ISO 8601 format (YYYY-MM-DD or full ISO string).');
    }
    params.set('created_at_max', options.created_at_max);
  }

  // Limit (max 250 per Shopify API)
  const limit = Math.min(Math.max(options.limit || 50, 1), 250);
  params.set('limit', limit.toString());

  // Validate maxTotal
  const maxTotal = Math.min(Math.max(options.maxTotal || 1000, 1), 10000);

  const allOrders = [];
  let url = `https://${domain}/admin/api/2023-10/orders.json?${params.toString()}`;

  // Paginate through all results
  while (url) {
    const resp = await fetchWithTimeout(url, {
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    if (!resp.ok) {
      // Limit error body size
      const body = await resp.text();
      const truncatedBody = body.length > 500 ? body.substring(0, 500) + '...' : body;
      throw new Error(`Failed to fetch orders from Shopify: ${resp.status} ${truncatedBody}`);
    }

    const data = await resp.json();
    allOrders.push(...(data.orders || []));

    // Check for next page via Link header
    const linkHeader = resp.headers.get('Link');
    url = null;
    if (linkHeader) {
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      if (nextMatch && nextMatch[1]) {
        url = nextMatch[1];
      }
    }

    // Safety limit to prevent infinite loops
    if (allOrders.length >= maxTotal) {
      console.warn(`Historical import capped at ${allOrders.length} orders`);
      break;
    }
  }

  return allOrders;
}

/**
 * Create a fulfillment for an order with tracking information
 * @param {Object} order - Order object with shopify_order_id or external_order_id
 * @param {string} trackingNumber - Tracking number
 * @param {string} trackingCompany - Carrier name (default: 'Royal Mail')
 * @returns {Promise<Object>} Fulfillment response
 */
export async function createShopifyFulfillment(order, trackingNumber, trackingCompany = 'Royal Mail') {
  if (!domain || !token) {
    throw new Error('Shopify credentials are not configured.');
  }

  // Determine the Shopify order ID
  const shopifyOrderId = order.shopify_order_id ||
    (order.channel === 'SHOPIFY' ? order.external_order_id : null);

  if (!shopifyOrderId) {
    throw new Error('No Shopify order ID found');
  }

  // First, get the order's fulfillment orders
  const fulfillmentOrdersUrl = `https://${domain}/admin/api/2023-10/orders/${shopifyOrderId}/fulfillment_orders.json`;

  const foResp = await fetchWithTimeout(fulfillmentOrdersUrl, {
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  });

  if (!foResp.ok) {
    const body = await foResp.text();
    throw new Error(`Failed to get fulfillment orders: ${foResp.status} ${body.substring(0, 200)}`);
  }

  const foData = await foResp.json();
  const fulfillmentOrders = foData.fulfillment_orders || [];

  if (fulfillmentOrders.length === 0) {
    throw new Error('No fulfillment orders found for this order');
  }

  // Find an open fulfillment order
  const openFO = fulfillmentOrders.find(fo =>
    fo.status === 'open' || fo.status === 'in_progress'
  );

  if (!openFO) {
    console.log('[Shopify] No open fulfillment orders, order may already be fulfilled');
    return { already_fulfilled: true };
  }

  // Create the fulfillment
  const fulfillmentUrl = `https://${domain}/admin/api/2023-10/fulfillments.json`;

  const fulfillmentPayload = {
    fulfillment: {
      line_items_by_fulfillment_order: [
        {
          fulfillment_order_id: openFO.id,
          fulfillment_order_line_items: openFO.line_items.map(li => ({
            id: li.id,
            quantity: li.fulfillable_quantity
          }))
        }
      ],
      tracking_info: {
        company: trackingCompany,
        number: trackingNumber,
        url: trackingCompany === 'Royal Mail'
          ? `https://www.royalmail.com/track-your-item#/tracking-results/${trackingNumber}`
          : null
      },
      notify_customer: true
    }
  };

  const fulfillResp = await fetchWithTimeout(fulfillmentUrl, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(fulfillmentPayload)
  });

  if (!fulfillResp.ok) {
    const body = await fulfillResp.text();
    throw new Error(`Failed to create fulfillment: ${fulfillResp.status} ${body.substring(0, 200)}`);
  }

  const result = await fulfillResp.json();
  console.log(`[Shopify] Created fulfillment for order ${shopifyOrderId}: ${result.fulfillment?.id}`);

  return result.fulfillment;
}