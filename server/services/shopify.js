import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const domain = process.env.SHOPIFY_DOMAIN;
const token = process.env.SHOPIFY_ADMIN_TOKEN;

if (!domain || !token) {
  console.warn('Shopify domain or token not configured.  Order import will not work until these are set.');
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
  const resp = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Failed to fetch orders from Shopify: ${resp.status} ${body}`);
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

  // Date filters
  if (options.created_at_min) {
    params.set('created_at_min', options.created_at_min);
  }
  if (options.created_at_max) {
    params.set('created_at_max', options.created_at_max);
  }

  // Limit (max 250 per Shopify API)
  const limit = Math.min(options.limit || 50, 250);
  params.set('limit', limit.toString());

  const allOrders = [];
  let url = `https://${domain}/admin/api/2023-10/orders.json?${params.toString()}`;

  // Paginate through all results
  while (url) {
    const resp = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Failed to fetch orders from Shopify: ${resp.status} ${body}`);
    }

    const data = await resp.json();
    allOrders.push(...(data.orders || []));

    // Check for next page via Link header
    const linkHeader = resp.headers.get('Link');
    url = null;
    if (linkHeader) {
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      if (nextMatch) {
        url = nextMatch[1];
      }
    }

    // Safety limit to prevent infinite loops
    if (allOrders.length >= (options.maxTotal || 1000)) {
      console.warn(`Historical import capped at ${allOrders.length} orders`);
      break;
    }
  }

  return allOrders;
}