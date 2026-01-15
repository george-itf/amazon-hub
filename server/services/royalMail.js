/**
 * Royal Mail Click & Drop API Client
 * Handles shipping label creation and tracking retrieval
 */
import fetch from 'node-fetch';

const CLICK_DROP_API_URL = 'https://api.parcel.royalmail.com/api/v1';

class RoyalMailClient {
  constructor() {
    this.apiKey = process.env.ROYAL_MAIL_API_KEY;
    this.apiSecret = process.env.ROYAL_MAIL_API_SECRET;
  }

  /**
   * Check if credentials are configured
   */
  isConfigured() {
    return !!(this.apiKey);
  }

  /**
   * Make an authenticated request to Click & Drop API
   */
  async request(path, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('Royal Mail API not configured');
    }

    const url = `${CLICK_DROP_API_URL}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Royal Mail API error: ${response.status}`, errorText);
      throw new Error(`Royal Mail API error: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Get recent orders from Click & Drop
   */
  async getOrders(params = {}) {
    const queryParams = new URLSearchParams();
    if (params.status) {
      queryParams.append('status', params.status);
    }
    if (params.pageSize) {
      queryParams.append('pageSize', params.pageSize);
    }
    if (params.pageNumber) {
      queryParams.append('pageNumber', params.pageNumber);
    }

    const query = queryParams.toString();
    return this.request(`/orders${query ? `?${query}` : ''}`);
  }

  /**
   * Get a specific order by ID
   */
  async getOrder(orderId) {
    return this.request(`/orders/${orderId}`);
  }

  /**
   * Get orders by channel reference (e.g., Amazon order ID)
   */
  async getOrdersByReference(reference) {
    return this.request(`/orders?channelShippingRef=${encodeURIComponent(reference)}`);
  }

  /**
   * Create a new shipment order
   */
  async createOrder(orderData) {
    return this.request('/orders', {
      method: 'POST',
      body: JSON.stringify(orderData),
    });
  }

  /**
   * Get tracking info for an order
   */
  async getTracking(orderId) {
    return this.request(`/orders/${orderId}/tracking`);
  }

  /**
   * Get all shipped orders with tracking numbers
   * Useful for syncing tracking back to Amazon
   */
  async getShippedOrders(sinceDate) {
    const params = new URLSearchParams({
      status: 'dispatched',
      pageSize: '100',
    });

    if (sinceDate) {
      params.append('createdFrom', sinceDate.toISOString());
    }

    return this.request(`/orders?${params}`);
  }

  /**
   * Build order payload for Click & Drop
   */
  buildOrderPayload(order, items, serviceCode = 'TPN') {
    const shippingAddress = order.shipping_address || {};

    return {
      orderReference: order.external_order_id || order.amazon_order_id,
      channelShippingRef: order.amazon_order_id || order.external_order_id,
      recipient: {
        fullName: shippingAddress.name || order.customer_name,
        addressLine1: shippingAddress.address1 || shippingAddress.AddressLine1,
        addressLine2: shippingAddress.address2 || shippingAddress.AddressLine2 || '',
        city: shippingAddress.city || shippingAddress.City,
        postcode: shippingAddress.zip || shippingAddress.PostalCode,
        countryCode: shippingAddress.country || shippingAddress.CountryCode || 'GB',
        emailAddress: order.customer_email,
        phoneNumber: shippingAddress.phone || '',
      },
      orderValue: {
        amount: (order.total_price_pence || 0) / 100,
        currencyCode: order.currency || 'GBP',
      },
      items: items.map(item => ({
        name: item.title || item.name || 'Item',
        quantity: item.quantity || 1,
        unitValue: {
          amount: (item.unit_price_pence || 0) / 100,
          currencyCode: 'GBP',
        },
        sku: item.sku || item.asin,
      })),
      serviceCode: serviceCode,
      shippingDate: new Date().toISOString().split('T')[0],
    };
  }
}

// Common Royal Mail service codes
const SERVICE_CODES = {
  // Domestic UK
  FIRST_CLASS: 'STL1', // 1st Class
  SECOND_CLASS: 'STL2', // 2nd Class
  SIGNED_FOR_1ST: 'SD1', // Signed For 1st Class
  SIGNED_FOR_2ND: 'SD2', // Signed For 2nd Class
  SPECIAL_DELIVERY_9AM: 'SD6', // Special Delivery Guaranteed by 9am
  SPECIAL_DELIVERY_1PM: 'SD4', // Special Delivery Guaranteed by 1pm
  TRACKED_24: 'TPN', // Tracked 24
  TRACKED_48: 'TPS', // Tracked 48

  // International
  INTERNATIONAL_STANDARD: 'OLA', // International Standard
  INTERNATIONAL_TRACKED: 'OTD', // International Tracked
  INTERNATIONAL_TRACKED_SIGNED: 'OSA', // International Tracked & Signed
};

// Singleton instance
const royalMailClient = new RoyalMailClient();

export default royalMailClient;
export { RoyalMailClient, SERVICE_CODES };
