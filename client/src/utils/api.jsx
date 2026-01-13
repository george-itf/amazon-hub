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

  const resp = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

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
    const error = new Error(json.message || json.error || `Request failed: ${resp.status}`);
    error.status = resp.status;
    error.code = json.code;
    error.correlationId = json.correlationId;
    error.details = json.details;
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

export async function resolveReview(id, bomId, saveAsRule) {
  return request(`/review/${id}/resolve`, {
    method: 'POST',
    body: { bom_id: bomId, save_as_rule: saveAsRule }
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
