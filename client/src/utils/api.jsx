const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001';

// Token storage helpers
const TOKEN_KEY = 'amazon_hub_token';

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function clearStoredToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// Default request timeout (30 seconds)
const DEFAULT_TIMEOUT = 30000;

/**
 * Helper to make an authenticated HTTP request.
 * Sends the stored token via Authorization header.
 * Parses JSON responses and throws on non-2xx statuses with structured error info.
 *
 * @param {string} url
 * @param {Object} options
 */
async function request(url, options = {}) {
  const token = getStoredToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  // Add auth token if available
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Add idempotency key if provided
  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  // Set up request timeout with AbortController
  const timeout = options.timeout || DEFAULT_TIMEOUT;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  let resp;
  try {
    resp = await fetch(`${API_BASE}${url}`, {
      ...options,
      headers,
      signal: controller.signal,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      const error = new Error(`Request timeout after ${timeout}ms`);
      error.code = 'TIMEOUT';
      throw error;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  // Handle non-JSON responses
  const contentType = resp.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    if (!resp.ok) {
      throw new Error(`Request failed: ${resp.status}`);
    }
    return resp.status === 204 ? null : await resp.text();
  }

  const json = await resp.json();

  if (!resp.ok) {
    // Handle server error envelope: { ok: false, error: { code, message } }
    const errorMessage = json.message
      || json.error?.message
      || (typeof json.error === 'string' ? json.error : null)
      || `Request failed: ${resp.status}`;
    const error = new Error(errorMessage);
    error.status = resp.status;
    error.code = json.code || json.error?.code;
    error.correlationId = json.correlationId || json.correlation_id;
    error.details = json.details || json.error?.details;
    throw error;
  }

  // Return data from success envelope
  return json.data !== undefined ? json.data : json;
}

/**
 * Generate a unique idempotency key
 */
export function generateIdempotencyKey() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

// ============ Auth API ============

export async function login(email, password) {
  return request('/auth/login', {
    method: 'POST',
    body: { email, password }
  });
}

export async function logout() {
  return request('/auth/logout', { method: 'POST' });
}

export async function register(email, password, name) {
  return request('/auth/register', {
    method: 'POST',
    body: { email, password, name }
  });
}

export async function getCurrentUser() {
  return request('/auth/me');
}

export async function changePassword(currentPassword, newPassword) {
  return request('/auth/change-password', {
    method: 'POST',
    body: { current_password: currentPassword, new_password: newPassword }
  });
}

// ============ Dashboard API ============

export async function getDashboard() {
  return request('/dashboard');
}

export async function getDashboardStats() {
  return request('/dashboard/stats');
}

export async function getDashboardPulse() {
  return request('/dashboard/pulse');
}

export async function getStockHeatmap() {
  return request('/dashboard/stock-heatmap');
}

// ============ Components API ============

export async function getComponents(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/components${query ? `?${query}` : ''}`);
}

export async function getComponent(id) {
  return request(`/components/${id}`);
}

export async function createComponent(component) {
  return request('/components', { method: 'POST', body: component });
}

export async function updateComponent(id, updates) {
  return request(`/components/${id}`, { method: 'PUT', body: updates });
}

export async function getComponentMovements(id, params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/components/${id}/movements${query ? `?${query}` : ''}`);
}

// ============ BOMs API ============

export async function getBoms(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/boms${query ? `?${query}` : ''}`);
}

export async function getBom(id) {
  return request(`/boms/${id}`);
}

export async function createBom(bom) {
  return request('/boms', { method: 'POST', body: bom });
}

export async function updateBom(id, updates) {
  return request(`/boms/${id}`, { method: 'PUT', body: updates });
}

export async function getBomAvailability(id, location) {
  const query = location ? `?location=${encodeURIComponent(location)}` : '';
  return request(`/boms/${id}/availability${query}`);
}

// ============ BOM Review API ============

export async function getBomReviewQueue(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/boms/review${query ? `?${query}` : ''}`);
}

export async function getBomReviewStats() {
  return request('/boms/review/stats');
}

export async function approveBom(id, updates = {}) {
  return request(`/boms/${id}/approve`, {
    method: 'POST',
    body: updates
  });
}

export async function rejectBom(id, reason) {
  return request(`/boms/${id}/reject`, {
    method: 'POST',
    body: { reason }
  });
}

export async function resetAllBomReviews() {
  return request('/boms/review/reset-all', { method: 'POST' });
}

export async function suggestBomComponents(data) {
  return request('/boms/review/suggest-components', {
    method: 'POST',
    body: data
  });
}

// ============ Listings API ============

export async function getListings(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/listings${query ? `?${query}` : ''}`);
}

export async function getListing(id) {
  return request(`/listings/${id}`);
}

export async function createListing(listing) {
  return request('/listings', { method: 'POST', body: listing });
}

export async function updateListing(id, updates) {
  return request(`/listings/${id}`, { method: 'PUT', body: updates });
}

export async function supersedeListing(id, data) {
  return request(`/listings/${id}/supersede`, { method: 'POST', body: data });
}

export async function searchListings(query, activeOnly = true) {
  return request(`/listings/search/query?q=${encodeURIComponent(query)}&active_only=${activeOnly}`);
}

export async function getListingInventory(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/listings/inventory${query ? `?${query}` : ''}`);
}

export async function getSharedComponents(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/listings/shared-components${query ? `?${query}` : ''}`);
}

export async function getComponentDependentListings(componentId, params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/components/${componentId}/dependent-listings${query ? `?${query}` : ''}`);
}

// ============ Orders API ============

export async function getOrders(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/orders${query ? `?${query}` : ''}`);
}

export async function getOrder(id) {
  return request(`/orders/${id}`);
}

export async function importOrders() {
  return request('/orders/import', { method: 'POST' });
}

export async function importHistoricalOrders(options) {
  return request('/orders/import-historical', {
    method: 'POST',
    body: options
  });
}

export async function reEvaluateOrders(orderIds) {
  return request('/orders/re-evaluate', {
    method: 'POST',
    body: { order_ids: orderIds }
  });
}

export async function getReadyToPickOrders() {
  return request('/orders/status/ready-to-pick');
}

export async function cancelOrder(id, note) {
  return request(`/orders/${id}/cancel`, {
    method: 'POST',
    body: { note }
  });
}

// ============ Pick Batches API ============

export async function getPickBatches(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/pick-batches${query ? `?${query}` : ''}`);
}

export async function getPickBatch(id) {
  return request(`/pick-batches/${id}`);
}

export async function createPickBatch(orderIds) {
  return request('/pick-batches', {
    method: 'POST',
    body: { order_ids: orderIds }
  });
}

export async function reservePickBatch(id, idempotencyKey) {
  return request(`/pick-batches/${id}/reserve`, {
    method: 'POST',
    idempotencyKey
  });
}

export async function confirmPickBatch(id, idempotencyKey) {
  return request(`/pick-batches/${id}/confirm`, {
    method: 'POST',
    idempotencyKey
  });
}

export async function cancelPickBatch(id, reason, idempotencyKey) {
  return request(`/pick-batches/${id}/cancel`, {
    method: 'POST',
    body: { reason },
    idempotencyKey
  });
}

export async function getPickBatchPrint(id) {
  return request(`/pick-batches/${id}/print`);
}

// ============ Stock API ============

export async function getStock(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/stock${query ? `?${query}` : ''}`);
}

export async function getComponentStock(componentId) {
  return request(`/stock/${componentId}`);
}

export async function receiveStock(componentId, location, quantity, note, idempotencyKey) {
  return request('/stock/receive', {
    method: 'POST',
    body: { component_id: componentId, location, quantity, note },
    idempotencyKey
  });
}

export async function adjustStock(componentId, location, delta, reason, note, idempotencyKey) {
  return request('/stock/adjust', {
    method: 'POST',
    body: { component_id: componentId, location, delta, reason, note },
    idempotencyKey
  });
}

export async function getStockMovements(componentId, params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/stock/${componentId}/movements${query ? `?${query}` : ''}`);
}

// ============ Returns API ============

export async function getReturns(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/returns${query ? `?${query}` : ''}`);
}

export async function getReturn(id) {
  return request(`/returns/${id}`);
}

export async function createReturn(returnData) {
  return request('/returns', { method: 'POST', body: returnData });
}

export async function inspectReturn(id, lineDispositions) {
  return request(`/returns/${id}/inspect`, {
    method: 'POST',
    body: { line_dispositions: lineDispositions }
  });
}

export async function processReturn(id, idempotencyKey) {
  return request(`/returns/${id}/process`, {
    method: 'POST',
    idempotencyKey
  });
}

export async function getQuarantineSummary() {
  return request('/returns/quarantine/summary');
}

// ============ Review Queue API ============

export async function getReviewQueue(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/review${query ? `?${query}` : ''}`);
}

export async function getReviewItem(id) {
  return request(`/review/${id}`);
}

export async function getReviewStats() {
  return request('/review/stats/summary');
}

export async function resolveReview(id, body) {
  return request(`/review/${id}/resolve`, {
    method: 'POST',
    body: body
  });
}

export async function skipReview(id, reason) {
  return request(`/review/${id}/skip`, {
    method: 'POST',
    body: { reason }
  });
}

export async function requeueReview(id) {
  return request(`/review/${id}/requeue`, { method: 'POST' });
}

// ============ Keepa API ============

export async function getKeepaProduct(asin, forceRefresh = false) {
  return request(`/keepa/product/${asin}?force_refresh=${forceRefresh}`);
}

export async function refreshKeepaProducts(asins) {
  return request('/keepa/refresh', {
    method: 'POST',
    body: { asins }
  });
}

export async function getKeepaMetrics(asin, rangeDays = 90) {
  return request(`/keepa/metrics/${asin}?range=${rangeDays}`);
}

export async function getKeepaStatus() {
  return request('/keepa/status');
}

export async function updateKeepaSettings(settings) {
  return request('/keepa/settings', {
    method: 'PUT',
    body: settings
  });
}

// ============ Intelligence API ============

export async function getConstraints(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/intelligence/constraints${query ? `?${query}` : ''}`);
}

export async function getConstraintDetails(componentId) {
  return request(`/intelligence/constraints/${componentId}`);
}

export async function getBottlenecks() {
  return request('/intelligence/bottlenecks');
}

export async function getFulfillmentReadiness() {
  return request('/intelligence/fulfillment-readiness');
}

// ============ Audit API ============

export async function getAuditTimeline(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/audit/timeline${query ? `?${query}` : ''}`);
}

export async function getMarketContext(asin, params = {}) {
  const query = new URLSearchParams({ asin, ...params }).toString();
  return request(`/audit/timeline/market-context?${query}`);
}

export async function getEntityHistory(entityType, entityId) {
  return request(`/audit/entity/${entityType}/${entityId}`);
}

export async function getRecentActivity() {
  return request('/audit/activity');
}

// ============ Brain API ============

export async function resolveListing(asin, sku, title) {
  return request('/brain/resolve', {
    method: 'POST',
    body: { asin, sku, title }
  });
}

export async function parseTitle(title) {
  return request('/brain/parse', {
    method: 'POST',
    body: { title }
  });
}

export async function compareTitles(title1, title2) {
  return request('/brain/compare', {
    method: 'POST',
    body: { title1, title2 }
  });
}

export async function batchResolveListing(items) {
  return request('/brain/batch-resolve', {
    method: 'POST',
    body: { items }
  });
}

export async function suggestBom(title) {
  return request(`/brain/suggest-bom?title=${encodeURIComponent(title)}`);
}

export async function getBrainHealth() {
  return request('/brain/health');
}

// ============ Analytics API ============

export async function getAnalyticsSummary(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/analytics/summary${query ? `?${query}` : ''}`);
}

export async function getAnalyticsProducts(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/analytics/products${query ? `?${query}` : ''}`);
}

export async function getAnalyticsTrends(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/analytics/trends${query ? `?${query}` : ''}`);
}

export async function getAnalyticsCustomers(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/analytics/customers${query ? `?${query}` : ''}`);
}

export async function exportAnalytics(params = {}) {
  const query = new URLSearchParams(params).toString();
  const token = getStoredToken();

  // Set up request timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s for exports

  try {
    const response = await fetch(`${API_BASE}/analytics/export${query ? `?${query}` : ''}`, {
      headers: {
        'Authorization': token ? `Bearer ${token}` : '',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error('Export failed');
    }
    return response.blob();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Export request timeout');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============ Profit Analyzer API ============

export async function analyzeProfitability({ asin, components, sizeTier = 'standard', targetMarginPercent = 10 }) {
  return request('/profit/analyze', {
    method: 'POST',
    body: { asin, components, sizeTier, targetMarginPercent }
  });
}

export async function quickProfitCheck(asin) {
  return request(`/profit/quick/${asin}`);
}

// ============ Amazon SP-API ============

export async function getAmazonStatus() {
  return request('/amazon/status');
}

export async function syncAmazonOrders(daysBack = 7, statuses) {
  return request('/amazon/sync/orders', {
    method: 'POST',
    body: { daysBack, statuses },
    timeout: 120000, // 2 minute timeout for sync
  });
}

export async function getRecentAmazonOrders(daysBack = 3) {
  return request(`/amazon/orders/recent?daysBack=${daysBack}`);
}

export async function getAmazonOrderDetails(orderId) {
  return request(`/amazon/order/${orderId}`);
}

export async function getAmazonOrderEnhancedDetails(orderId) {
  return request(`/amazon/order/${orderId}/details`);
}

export async function getAmazonStats() {
  return request('/amazon/stats');
}

export async function getAmazonSettings() {
  return request('/amazon/settings');
}

export async function updateAmazonSettings(settings) {
  return request('/amazon/settings', {
    method: 'PUT',
    body: settings,
  });
}

export async function syncAmazonFees(daysBack = 30) {
  return request('/amazon/sync/fees', {
    method: 'POST',
    body: { daysBack },
    timeout: 120000,
  });
}

export async function getAmazonCatalog(asin, refresh = false) {
  return request(`/amazon/catalog/${asin}?refresh=${refresh}`);
}

export async function getAmazonSyncHistory(limit = 20) {
  return request(`/amazon/sync/history?limit=${limit}`);
}

export async function getAmazonPendingShipments() {
  return request('/amazon/orders/pending-shipment');
}

export async function confirmAmazonShipment(orderId, carrierCode, trackingNumber) {
  return request('/amazon/shipment/confirm', {
    method: 'POST',
    body: { orderId, carrierCode, trackingNumber },
  });
}

// ============ Shipping / Royal Mail ============

export async function getShippingStatus() {
  return request('/shipping/status');
}

export async function getShippingServices() {
  return request('/shipping/services');
}

export async function getReadyToShipOrders() {
  return request('/shipping/orders/ready');
}

export async function createShippingLabel(orderId, serviceCode = 'TPN') {
  return request('/shipping/label/create', {
    method: 'POST',
    body: { orderId, serviceCode },
  });
}

export async function syncShippingTracking(daysBack = 7, autoConfirmAmazon = true) {
  return request('/shipping/sync-tracking', {
    method: 'POST',
    body: { daysBack, autoConfirmAmazon },
    timeout: 120000,
  });
}

export async function confirmShipment(orderId, trackingNumber, carrierCode = 'Royal Mail', confirmOnAmazon = true) {
  return request(`/shipping/confirm/${orderId}`, {
    method: 'POST',
    body: { trackingNumber, carrierCode, confirmOnAmazon },
  });
}

export async function getOrderTracking(orderId) {
  return request(`/shipping/tracking/${orderId}`);
}

export async function confirmBulkShipments(shipments, confirmOnAmazon = true) {
  return request('/shipping/confirm-bulk', {
    method: 'POST',
    body: { shipments, confirmOnAmazon },
    timeout: 180000, // 3 minute timeout for bulk
  });
}

// ============ Amazon Catalog & Listings ============

export async function syncAmazonCatalog(asins, daysBack = 30) {
  return request('/amazon/sync/catalog', {
    method: 'POST',
    body: { asins, daysBack },
    timeout: 300000, // 5 minute timeout for catalog sync
  });
}

export async function getAmazonCatalogItems(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/amazon/catalog${query ? `?${query}` : ''}`);
}

export async function getAmazonListings(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/amazon/listings${query ? `?${query}` : ''}`);
}

export async function mapAmazonListing(asin, bomId) {
  return request(`/amazon/listings/${asin}/map`, {
    method: 'POST',
    body: { bomId },
  });
}

export async function getSchedulerStatus() {
  return request('/amazon/scheduler/status');
}

export async function updateSchedulerSettings(settings) {
  return request('/amazon/scheduler/settings', {
    method: 'POST',
    body: settings,
  });
}

// ============ Inventory Pools API ============

export async function getInventoryRecommendations(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/inventory/recommendations${query ? `?${query}` : ''}`);
}

export async function getInventoryPools(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/inventory/pools${query ? `?${query}` : ''}`);
}

export async function getInventoryPool(id) {
  return request(`/inventory/pools/${id}`);
}

export async function createInventoryPool(pool) {
  return request('/inventory/pools', { method: 'POST', body: pool });
}

export async function updateInventoryPool(id, updates) {
  return request(`/inventory/pools/${id}`, { method: 'PUT', body: updates });
}

export async function deleteInventoryPool(id) {
  return request(`/inventory/pools/${id}`, { method: 'DELETE' });
}

export async function addPoolMember(poolId, member) {
  return request(`/inventory/pools/${poolId}/members`, {
    method: 'POST',
    body: member,
  });
}

export async function updatePoolMember(poolId, memberId, updates) {
  return request(`/inventory/pools/${poolId}/members/${memberId}`, {
    method: 'PUT',
    body: updates,
  });
}

export async function removePoolMember(poolId, memberId) {
  return request(`/inventory/pools/${poolId}/members/${memberId}`, {
    method: 'DELETE',
  });
}

export async function pushAmazonInventory(options = {}) {
  const { location = 'Warehouse', dry_run = true, only_mapped = true, limit = 50 } = options;
  return request('/amazon/inventory/push', {
    method: 'POST',
    body: { location, dry_run, only_mapped, limit },
    idempotencyKey: generateIdempotencyKey(),
    timeout: 180000, // 3 minutes for live push
  });
}

// ============ Allocation Engine API ============

export async function getAllocationPools(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/intelligence/allocation/pools${query ? `?${query}` : ''}`);
}

export async function getAllocationPreview(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/intelligence/allocation/preview${query ? `?${query}` : ''}`);
}

export async function applyAllocation(params, idempotencyKey) {
  return request('/intelligence/allocation/apply', {
    method: 'POST',
    body: params,
    idempotencyKey,
    timeout: 180000, // 3 minutes for live push
  });
}

// ============ UI Views API ============

export async function getViews(context) {
  return request(`/views?context=${encodeURIComponent(context)}`);
}

export async function createView(context, name, config) {
  return request('/views', {
    method: 'POST',
    body: { context, name, config },
  });
}

export async function updateView(id, payload) {
  return request(`/views/${id}`, { method: 'PUT', body: payload });
}

export async function deleteView(id) {
  return request(`/views/${id}`, { method: 'DELETE' });
}

export async function reorderViews(context, viewIds) {
  return request('/views/reorder', {
    method: 'POST',
    body: { context, view_ids: viewIds },
  });
}

// ============ Listing Settings API ============

export async function getListingSettings(listingMemoryIds) {
  const params = listingMemoryIds && listingMemoryIds.length > 0
    ? `?listing_memory_ids=${listingMemoryIds.join(',')}`
    : '';
  return request(`/listing-settings${params}`);
}

export async function getListingSetting(listingMemoryId) {
  return request(`/listing-settings/${listingMemoryId}`);
}

export async function updateListingSettings(listingMemoryId, payload) {
  return request(`/listing-settings/${listingMemoryId}`, {
    method: 'PUT',
    body: payload,
  });
}

export async function deleteListingSettings(listingMemoryId) {
  return request(`/listing-settings/${listingMemoryId}`, { method: 'DELETE' });
}

export async function getListingSettingsByGroup(groupKey) {
  return request(`/listing-settings/by-group/${encodeURIComponent(groupKey)}`);
}

// ============ Shipping API ============

/**
 * Get Royal Mail API connection status
 */
export async function getShippingStatus() {
  return request('/shipping/status');
}

/**
 * Get available Royal Mail service codes
 */
export async function getShippingServices() {
  return request('/shipping/services');
}

/**
 * Get orders ready to ship
 */
export async function getReadyToShipOrders() {
  return request('/shipping/orders/ready');
}

/**
 * Create shipping labels in batch
 * @param {string[]} orderIds - Array of order UUIDs
 * @param {Object} options - Options
 * @param {boolean} options.dryRun - If true, simulate without creating labels
 * @param {string} options.serviceCode - Override service code for all labels
 */
export async function createShippingBatch(orderIds, options = {}) {
  return request('/shipping/batch-create', {
    method: 'POST',
    body: {
      order_ids: orderIds,
      dry_run: options.dryRun || false,
      service_code: options.serviceCode,
    },
    timeout: 120000, // 2 minute timeout for batch operations
  });
}

/**
 * Get recent batch operations history
 */
export async function getShippingBatches(limit = 20) {
  return request(`/shipping/batches?limit=${limit}`);
}

/**
 * Get shipping labels with optional filters
 */
export async function getShippingLabels(options = {}) {
  const params = new URLSearchParams();
  if (options.orderId) params.append('order_id', options.orderId);
  if (options.status) params.append('status', options.status);
  if (options.limit) params.append('limit', options.limit);
  const query = params.toString();
  return request(`/shipping/labels${query ? `?${query}` : ''}`);
}

/**
 * Get today's total shipping cost
 */
export async function getShippingTodayCost() {
  return request('/shipping/today-cost');
}

/**
 * Create a single shipping label
 */
export async function createShippingLabel(orderId, serviceCode = 'TPN') {
  return request('/shipping/label/create', {
    method: 'POST',
    body: { orderId, serviceCode },
  });
}

/**
 * Sync tracking numbers from Royal Mail
 */
export async function syncShippingTracking(options = {}) {
  return request('/shipping/sync-tracking', {
    method: 'POST',
    body: {
      daysBack: options.daysBack || 7,
      autoConfirmAmazon: options.autoConfirmAmazon !== false,
    },
  });
}

/**
 * Get tracking info for an order
 */
export async function getShippingTracking(orderId) {
  return request(`/shipping/tracking/${orderId}`);
}

/**
 * Manually confirm shipment with tracking
 */
export async function confirmShipment(orderId, trackingNumber, options = {}) {
  return request(`/shipping/confirm/${orderId}`, {
    method: 'POST',
    body: {
      trackingNumber,
      carrierCode: options.carrierCode || 'Royal Mail',
      confirmOnAmazon: options.confirmOnAmazon !== false,
    },
  });
}

// ============ Analytics Hub API ============

/**
 * Get analytics hub KPI summary
 * @param {Object} params - Query params (days_back, location)
 */
export async function getAnalyticsHubSummary(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/analytics/hub/summary${query ? `?${query}` : ''}`);
}

/**
 * Get dead stock analysis
 * @param {Object} params - Query params (days_threshold, min_value_pence, location, limit)
 */
export async function getAnalyticsHubDeadStock(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/analytics/hub/dead-stock${query ? `?${query}` : ''}`);
}

/**
 * Get movers analysis (gainers, losers, new winners)
 * @param {Object} params - Query params (min_change_percent, min_units, limit)
 */
export async function getAnalyticsHubMovers(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/analytics/hub/movers${query ? `?${query}` : ''}`);
}

/**
 * Get profitability analysis by listing
 * @param {Object} params - Query params (days_back, min_orders, sort_by, limit)
 */
export async function getAnalyticsHubProfitability(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/analytics/hub/profitability${query ? `?${query}` : ''}`);
}

/**
 * Get stock risk analysis (days of cover, stockout risks)
 * @param {Object} params - Query params (days_threshold, location, limit)
 */
export async function getAnalyticsHubStockRisk(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/analytics/hub/stock-risk${query ? `?${query}` : ''}`);
}

/**
 * Get data quality warnings for analytics accuracy
 */
export async function getAnalyticsHubDataQuality() {
  return request('/analytics/hub/data-quality');
}
