/**
 * Amazon Selling Partner API (SP-API) Client
 * Handles authentication and API calls to Amazon's SP-API
 */
import fetch from 'node-fetch';

// SP-API endpoints by region
const ENDPOINTS = {
  EU: 'https://sellingpartnerapi-eu.amazon.com',
  NA: 'https://sellingpartnerapi-na.amazon.com',
  FE: 'https://sellingpartnerapi-fe.amazon.com',
};

// LWA (Login With Amazon) token endpoint
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

// UK Marketplace ID
const UK_MARKETPLACE_ID = 'A1F83G8C2ARO7P';

/**
 * SP-API Client class
 */
class SpApiClient {
  constructor() {
    // LWA (Login With Amazon) credentials for OAuth
    this.clientId = process.env.SP_API_CLIENT_ID;
    this.clientSecret = process.env.SP_API_CLIENT_SECRET;
    this.refreshToken = process.env.SP_API_REFRESH_TOKEN;

    // SP-API Application ID (for identification)
    this.applicationId = process.env.SP_API_APPLICATION_ID;

    this.endpoint = ENDPOINTS.EU; // UK is in EU region
    this.marketplaceId = process.env.SP_API_MARKETPLACE_ID || UK_MARKETPLACE_ID;

    this.accessToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Check if credentials are configured
   */
  isConfigured() {
    return !!(this.clientId && this.clientSecret && this.refreshToken);
  }

  /**
   * Get a valid access token, refreshing if needed
   */
  async getAccessToken() {
    // Return cached token if still valid (with 60s buffer)
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry - 60000) {
      return this.accessToken;
    }

    // Refresh the token
    const response = await fetch(LWA_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('SP-API token refresh failed:', error);
      throw new Error(`Failed to refresh SP-API token: ${response.status}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000);

    return this.accessToken;
  }

  /**
   * Make an authenticated request to SP-API
   */
  async request(path, options = {}) {
    const token = await this.getAccessToken();

    const url = `${this.endpoint}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'x-amz-access-token': token,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`SP-API request failed: ${response.status}`, errorText);
      throw new Error(`SP-API error: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Get orders from Amazon
   * @param {Object} params - Query parameters
   * @param {string} params.createdAfter - ISO date string
   * @param {string} params.createdBefore - ISO date string (optional)
   * @param {string[]} params.orderStatuses - Filter by status (optional)
   */
  async getOrders(params = {}) {
    const queryParams = new URLSearchParams({
      MarketplaceIds: this.marketplaceId,
    });

    if (params.createdAfter) {
      queryParams.append('CreatedAfter', params.createdAfter);
    }
    if (params.createdBefore) {
      queryParams.append('CreatedBefore', params.createdBefore);
    }
    if (params.orderStatuses && params.orderStatuses.length > 0) {
      params.orderStatuses.forEach(status => {
        queryParams.append('OrderStatuses', status);
      });
    }
    if (params.nextToken) {
      queryParams.append('NextToken', params.nextToken);
    }

    const response = await this.request(`/orders/v0/orders?${queryParams}`);
    return response.payload || response;
  }

  /**
   * Get order items for a specific order
   */
  async getOrderItems(orderId) {
    const response = await this.request(`/orders/v0/orders/${orderId}/orderItems`);
    return response.payload || response;
  }

  /**
   * Get all orders with pagination
   */
  async getAllOrders(params = {}) {
    const allOrders = [];
    let nextToken = null;

    do {
      const response = await this.getOrders({
        ...params,
        nextToken,
      });

      if (response.Orders) {
        allOrders.push(...response.Orders);
      }

      nextToken = response.NextToken;

      // Rate limiting - SP-API has burst limits
      if (nextToken) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } while (nextToken);

    return allOrders;
  }

  /**
   * Get inventory summaries
   */
  async getInventorySummaries(params = {}) {
    const queryParams = new URLSearchParams({
      granularityType: 'Marketplace',
      granularityId: this.marketplaceId,
      marketplaceIds: this.marketplaceId,
    });

    if (params.sellerSkus && params.sellerSkus.length > 0) {
      params.sellerSkus.forEach(sku => {
        queryParams.append('sellerSkus', sku);
      });
    }
    if (params.nextToken) {
      queryParams.append('nextToken', params.nextToken);
    }

    const response = await this.request(`/fba/inventory/v1/summaries?${queryParams}`);
    return response.payload || response;
  }

  /**
   * Get financial events (for fees/revenue)
   */
  async getFinancialEvents(params = {}) {
    const queryParams = new URLSearchParams();

    if (params.postedAfter) {
      queryParams.append('PostedAfter', params.postedAfter);
    }
    if (params.postedBefore) {
      queryParams.append('PostedBefore', params.postedBefore);
    }
    if (params.nextToken) {
      queryParams.append('NextToken', params.nextToken);
    }

    const response = await this.request(`/finances/v0/financialEvents?${queryParams}`);
    return response.payload || response;
  }

  /**
   * Get catalog item by ASIN
   */
  async getCatalogItem(asin) {
    const queryParams = new URLSearchParams({
      marketplaceIds: this.marketplaceId,
      includedData: 'summaries,attributes,salesRanks',
    });

    const response = await this.request(`/catalog/2022-04-01/items/${asin}?${queryParams}`);
    return response;
  }
}

// Singleton instance
const spApiClient = new SpApiClient();

export default spApiClient;
export { SpApiClient, UK_MARKETPLACE_ID };
