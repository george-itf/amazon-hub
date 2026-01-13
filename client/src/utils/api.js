const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001';

/**
 * Helper to make an authenticated HTTP request.  Automatically
 * attaches the `Authorization` header if a token is available in
 * localStorage.  Parses JSON responses and throws on non‑2xx
 * statuses.
 *
 * @param {string} url
 * @param {Object} options
 */
async function request(url, options = {}) {
  const stored = localStorage.getItem('auth');
  let token;
  if (stored) {
    try {
      token = JSON.parse(stored).token;
    } catch {
      token = null;
    }
  }
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const resp = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Request failed: ${resp.status} ${text}`);
  }
  return resp.status === 204 ? null : await resp.json();
}

export async function loginWithGoogleToken(idToken) {
  const data = await request('/auth/google', {
    method: 'POST',
    body: { id_token: idToken }
  });
  return data;
}

export async function getComponents() {
  return request('/components');
}

export async function createComponent(component) {
  return request('/components', { method: 'POST', body: component });
}

export async function getBoms() {
  return request('/boms');
}

export async function createBom(bom) {
  return request('/boms', { method: 'POST', body: bom });
}

export async function getListings() {
  return request('/listings');
}

export async function createListing(listing) {
  return request('/listings', { method: 'POST', body: listing });
}

export async function importOrders() {
  return request('/orders/import', { method: 'POST' });
}

export async function getOrders() {
  return request('/orders');
}

export async function getPicklist() {
  return request('/picklists');
}

export async function getReviewQueue() {
  return request('/review');
}

export async function resolveReview(id, body) {
  return request(`/review/${id}/resolve`, { method: 'POST', body });
}