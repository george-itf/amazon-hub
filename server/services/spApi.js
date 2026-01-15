/**
 * Amazon Selling Partner API (SP-API) Client
 * Handles authentication and API calls to Amazon's SP-API
 *
 * Features:
 * - Automatic token refresh
 * - Rate limiting with per-endpoint tracking (persisted to DB)
 * - Exponential backoff for rate limit errors
 * - Retry logic for transient failures
 */
import fetch from 'node-fetch';
import persistentRateLimiter from '../utils/persistentRateLimiter.js';

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

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 4,
  baseDelayMs: 1000,      // 1 second base delay
  maxDelayMs: 16000,      // 16 seconds max delay
  retryableStatuses: [429, 500, 502, 503, 504],
};

// Default timeout for API calls (30 seconds)
const DEFAULT_TIMEOUT_MS = 30000;

// Note: Rate limit configuration is now defined in utils/persistentRateLimiter.js
// which persists state to database to survive server restarts (Fix for audit finding)

/**
 * Calculate exponential backoff delay
 */
function calculateBackoff(attempt, baseDelay = RETRY_CONFIG.baseDelayMs) {
  const delay = baseDelay * Math.pow(2, attempt);
  // Add jitter (±25%)
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.min(delay + jitter, RETRY_CONFIG.maxDelayMs);
}

/**
 * Check if error is retryable
 */
function isRetryableError(error, status) {
  // Network errors
  if (error && (
    error.code === 'ECONNRESET' ||
    error.code === 'ETIMEDOUT' ||
    error.code === 'ENOTFOUND' ||
    error.code === 'ECONNREFUSED' ||
    error.message?.includes('network') ||
    error.message?.includes('timeout')
  )) {
    return true;
  }

  // HTTP status codes
  if (status && RETRY_CONFIG.retryableStatuses.includes(status)) {
    return true;
  }

  return false;
}

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

    // Rate limiter for request throttling - uses persistent DB-backed limiter
    // This survives server restarts to prevent post-restart burst abuse
    this.rateLimiter = persistentRateLimiter;
  }

  /**
   * Check if credentials are configured
   */
  isConfigured() {
    return !!(this.clientId && this.clientSecret && this.refreshToken);
  }

  /**
   * Get a valid access token, refreshing if needed
   * Includes retry logic for transient failures
   */
  async getAccessToken() {
    // Return cached token if still valid (with 60s buffer)
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry - 60000) {
      return this.accessToken;
    }

    let lastError = null;

    for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      // Set up request timeout with AbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

      try {
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
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          const error = await response.text();

          // Check if retryable
          if (isRetryableError(null, response.status) && attempt < RETRY_CONFIG.maxRetries) {
            const delay = calculateBackoff(attempt);
            console.warn(`[SP-API] Token refresh failed (${response.status}), retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries})`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }

          console.error('SP-API token refresh failed:', error);
          throw new Error(`Failed to refresh SP-API token: ${response.status}`);
        }

        const data = await response.json();
        this.accessToken = data.access_token;
        this.tokenExpiry = Date.now() + (data.expires_in * 1000);

        return this.accessToken;
      } catch (err) {
        clearTimeout(timeoutId);
        lastError = err;

        // Handle AbortError (timeout)
        if (err.name === 'AbortError') {
          const timeoutError = new Error(`SP-API token refresh timeout after ${DEFAULT_TIMEOUT_MS}ms`);
          timeoutError.code = 'ETIMEDOUT';

          if (attempt < RETRY_CONFIG.maxRetries) {
            const delay = calculateBackoff(attempt);
            console.warn(`[SP-API] Token refresh timeout, retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries})`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          throw timeoutError;
        }

        // Check if network error is retryable
        if (isRetryableError(err, null) && attempt < RETRY_CONFIG.maxRetries) {
          const delay = calculateBackoff(attempt);
          console.warn(`[SP-API] Token refresh network error, retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries}):`, err.message);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        throw err;
      }
    }

    throw lastError || new Error('Failed to refresh SP-API token after retries');
  }

  /**
   * Make an authenticated request to SP-API
   * Includes rate limiting and retry logic with exponential backoff
   */
  async request(path, options = {}) {
    // Apply rate limiting
    const waitTime = await this.rateLimiter.acquire(path);
    if (waitTime > 0) {
      console.log(`[SP-API] Rate limited, waited ${waitTime}ms for ${path}`);
    }

    let lastError = null;
    let lastStatus = null;

    for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      // Set up request timeout with AbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

      try {
        const token = await this.getAccessToken();
        const url = `${this.endpoint}${path}`;

        const response = await fetch(url, {
          ...options,
          headers: {
            'x-amz-access-token': token,
            'Content-Type': 'application/json',
            ...options.headers,
          },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        lastStatus = response.status;

        if (!response.ok) {
          const errorText = await response.text();

          // Handle rate limiting specifically (429)
          if (response.status === 429) {
            // Check for Retry-After header
            const retryAfter = response.headers.get('Retry-After');
            const delay = retryAfter
              ? parseInt(retryAfter) * 1000
              : calculateBackoff(attempt, 2000); // Higher base for rate limits

            if (attempt < RETRY_CONFIG.maxRetries) {
              console.warn(`[SP-API] Rate limited (429), retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries})`);
              await new Promise(r => setTimeout(r, delay));
              continue;
            }
          }

          // Handle other retryable errors
          if (isRetryableError(null, response.status) && attempt < RETRY_CONFIG.maxRetries) {
            const delay = calculateBackoff(attempt);
            console.warn(`[SP-API] Request failed (${response.status}), retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries})`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }

          console.error(`SP-API request failed: ${response.status}`, errorText);
          const error = new Error(`SP-API error: ${response.status} - ${errorText}`);
          error.status = response.status;
          throw error;
        }

        return response.json();
      } catch (err) {
        clearTimeout(timeoutId);
        lastError = err;

        // Handle AbortError (timeout)
        if (err.name === 'AbortError') {
          const timeoutError = new Error(`SP-API request timeout after ${DEFAULT_TIMEOUT_MS}ms for ${path}`);
          timeoutError.code = 'ETIMEDOUT';

          if (attempt < RETRY_CONFIG.maxRetries) {
            const delay = calculateBackoff(attempt);
            console.warn(`[SP-API] Request timeout on ${path}, retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries})`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          throw timeoutError;
        }

        // Don't retry if it's an API error we already handled
        if (err.status && !isRetryableError(null, err.status)) {
          throw err;
        }

        // Check if network error is retryable
        if (isRetryableError(err, null) && attempt < RETRY_CONFIG.maxRetries) {
          const delay = calculateBackoff(attempt);
          console.warn(`[SP-API] Network error on ${path}, retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries}):`, err.message);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        throw err;
      }
    }

    throw lastError || new Error(`SP-API request failed after ${RETRY_CONFIG.maxRetries} retries`);
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
   * Rate limiting is handled automatically by the request method
   */
  async getAllOrders(params = {}) {
    const allOrders = [];
    let nextToken = null;
    let pageCount = 0;

    do {
      const response = await this.getOrders({
        ...params,
        nextToken,
      });

      if (response.Orders) {
        allOrders.push(...response.Orders);
      }

      nextToken = response.NextToken;
      pageCount++;

      // Log progress for large fetches
      if (pageCount % 5 === 0) {
        console.log(`[SP-API] Fetched ${allOrders.length} orders (${pageCount} pages)...`);
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
      includedData: 'summaries,attributes,salesRanks,images,dimensions',
    });

    const response = await this.request(`/catalog/2022-04-01/items/${asin}?${queryParams}`);
    return response;
  }

  /**
   * Get a single order with buyer info
   */
  async getOrder(orderId) {
    const response = await this.request(`/orders/v0/orders/${orderId}`);
    return response.payload || response;
  }

  /**
   * Get buyer info for an order (requires additional permissions)
   */
  async getOrderBuyerInfo(orderId) {
    try {
      const response = await this.request(`/orders/v0/orders/${orderId}/buyerInfo`);
      return response.payload || response;
    } catch (err) {
      console.warn(`Could not get buyer info for ${orderId}:`, err.message);
      return null;
    }
  }

  /**
   * Confirm shipment for FBM order
   * @param {string} orderId - Amazon order ID
   * @param {Object} shipmentInfo - Shipment details
   * @param {string} shipmentInfo.carrierCode - Carrier code (e.g., 'Royal Mail', 'DPD')
   * @param {string} shipmentInfo.trackingNumber - Tracking number
   * @param {string} shipmentInfo.shipDate - ISO date string (optional, defaults to now)
   */
  async confirmShipment(orderId, shipmentInfo) {
    const { carrierCode, carrierName, trackingNumber, shipDate } = shipmentInfo;

    // Build the shipment confirmation request
    const body = {
      marketplaceId: this.marketplaceId,
      codCollectionMethod: 'DirectPayment',
      packageDetail: {
        packageReferenceId: `PKG-${orderId}`,
        carrierCode: carrierCode,
        carrierName: carrierName || carrierCode,
        shippingMethod: 'Standard',
        trackingNumber: trackingNumber,
        shipDate: shipDate || new Date().toISOString(),
      },
    };

    const response = await this.request(`/orders/v0/orders/${orderId}/shipmentConfirmation`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return response;
  }

  /**
   * Get financial events for a specific order
   */
  async getOrderFinancialEvents(orderId) {
    const response = await this.request(`/finances/v0/orders/${orderId}/financialEvents`);
    return response.payload || response;
  }

  /**
   * Get all financial events with pagination
   * Rate limiting is handled automatically by the request method
   */
  async getAllFinancialEvents(params = {}) {
    const allEvents = {
      ShipmentEventList: [],
      RefundEventList: [],
      ServiceFeeEventList: [],
    };
    let nextToken = null;
    let pageCount = 0;

    do {
      const response = await this.getFinancialEvents({
        ...params,
        nextToken,
      });

      const events = response.FinancialEvents || {};

      if (events.ShipmentEventList) {
        allEvents.ShipmentEventList.push(...events.ShipmentEventList);
      }
      if (events.RefundEventList) {
        allEvents.RefundEventList.push(...events.RefundEventList);
      }
      if (events.ServiceFeeEventList) {
        allEvents.ServiceFeeEventList.push(...events.ServiceFeeEventList);
      }

      nextToken = response.NextToken;
      pageCount++;

      // Log progress for large fetches
      if (pageCount % 5 === 0) {
        const total = allEvents.ShipmentEventList.length +
                      allEvents.RefundEventList.length +
                      allEvents.ServiceFeeEventList.length;
        console.log(`[SP-API] Fetched ${total} financial events (${pageCount} pages)...`);
      }
    } while (nextToken);

    return allEvents;
  }

  /**
   * Get seller listings (for inventory management)
   */
  async getListingsItem(sellerSku) {
    const queryParams = new URLSearchParams({
      marketplaceIds: this.marketplaceId,
      includedData: 'summaries,attributes,offers,fulfillmentAvailability',
    });

    const sellerId = process.env.SP_API_SELLER_ID;
    if (!sellerId) {
      throw new Error('SP_API_SELLER_ID not configured');
    }

    const response = await this.request(
      `/listings/2021-08-01/items/${sellerId}/${encodeURIComponent(sellerSku)}?${queryParams}`
    );
    return response;
  }

  /**
   * Update listing quantity (FBM inventory)
   */
  async updateListingQuantity(sellerSku, quantity) {
    const sellerId = process.env.SP_API_SELLER_ID;
    if (!sellerId) {
      throw new Error('SP_API_SELLER_ID not configured');
    }

    const body = {
      productType: 'PRODUCT',
      patches: [
        {
          op: 'replace',
          path: '/attributes/fulfillment_availability',
          value: [
            {
              fulfillment_channel_code: 'DEFAULT',
              quantity: quantity,
            },
          ],
        },
      ],
    };

    const response = await this.request(
      `/listings/2021-08-01/items/${sellerId}/${encodeURIComponent(sellerSku)}?marketplaceIds=${this.marketplaceId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      }
    );
    return response;
  }

  /**
   * Get seller's active listings report
   */
  async requestListingsReport() {
    const body = {
      reportType: 'GET_MERCHANT_LISTINGS_ALL_DATA',
      marketplaceIds: [this.marketplaceId],
    };

    const response = await this.request('/reports/2021-06-30/reports', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return response;
  }

  /**
   * Get report status
   */
  async getReport(reportId) {
    const response = await this.request(`/reports/2021-06-30/reports/${reportId}`);
    return response;
  }

  /**
   * Get report document
   */
  async getReportDocument(reportDocumentId) {
    const response = await this.request(`/reports/2021-06-30/documents/${reportDocumentId}`);
    return response;
  }
}

// Singleton instance
const spApiClient = new SpApiClient();

export default spApiClient;
export { SpApiClient, UK_MARKETPLACE_ID };
