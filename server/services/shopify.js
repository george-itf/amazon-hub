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