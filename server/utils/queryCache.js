/**
 * Server-side Query Cache
 *
 * Simple in-memory cache with TTL for expensive database queries.
 * Designed for read-heavy analytics endpoints where stale data is acceptable.
 *
 * Features:
 * - TTL-based expiration
 * - LRU eviction when max entries exceeded
 * - Namespace support for easy invalidation
 * - Promise coalescing (prevents thundering herd)
 */

// Default configuration
const DEFAULT_TTL_MS = 60 * 1000; // 1 minute
const MAX_ENTRIES = 500;

// Cache storage
const cache = new Map();
const accessOrder = [];
const pendingPromises = new Map();

/**
 * Cache entry structure
 * @typedef {Object} CacheEntry
 * @property {any} data - The cached data
 * @property {number} expiresAt - Timestamp when entry expires
 * @property {string} namespace - Optional namespace for grouped invalidation
 */

/**
 * Get a value from cache or compute it if missing/expired
 *
 * @param {string} key - Cache key
 * @param {Function} computeFn - Async function to compute value if not cached
 * @param {Object} options - Cache options
 * @param {number} [options.ttlMs=60000] - Time to live in milliseconds
 * @param {string} [options.namespace='default'] - Namespace for grouped invalidation
 * @returns {Promise<any>} - Cached or computed value
 */
export async function getOrCompute(key, computeFn, options = {}) {
  const { ttlMs = DEFAULT_TTL_MS, namespace = 'default' } = options;
  const fullKey = `${namespace}:${key}`;

  // Check cache
  const entry = cache.get(fullKey);
  if (entry && entry.expiresAt > Date.now()) {
    // Update access order for LRU
    updateAccessOrder(fullKey);
    return entry.data;
  }

  // Check if already computing (promise coalescing)
  if (pendingPromises.has(fullKey)) {
    return pendingPromises.get(fullKey);
  }

  // Compute new value
  const promise = computeFn().then(data => {
    // Store in cache
    cache.set(fullKey, {
      data,
      expiresAt: Date.now() + ttlMs,
      namespace
    });

    // Update access order
    updateAccessOrder(fullKey);

    // Evict if over limit
    evictIfNeeded();

    // Clear pending promise
    pendingPromises.delete(fullKey);

    return data;
  }).catch(err => {
    pendingPromises.delete(fullKey);
    throw err;
  });

  pendingPromises.set(fullKey, promise);
  return promise;
}

/**
 * Get a value from cache without computing
 *
 * @param {string} key - Cache key
 * @param {string} [namespace='default'] - Namespace
 * @returns {any|undefined} - Cached value or undefined
 */
export function get(key, namespace = 'default') {
  const fullKey = `${namespace}:${key}`;
  const entry = cache.get(fullKey);

  if (entry && entry.expiresAt > Date.now()) {
    updateAccessOrder(fullKey);
    return entry.data;
  }

  // Remove expired entry
  if (entry) {
    cache.delete(fullKey);
  }

  return undefined;
}

/**
 * Set a value in cache
 *
 * @param {string} key - Cache key
 * @param {any} data - Data to cache
 * @param {Object} options - Cache options
 * @param {number} [options.ttlMs=60000] - Time to live
 * @param {string} [options.namespace='default'] - Namespace
 */
export function set(key, data, options = {}) {
  const { ttlMs = DEFAULT_TTL_MS, namespace = 'default' } = options;
  const fullKey = `${namespace}:${key}`;

  cache.set(fullKey, {
    data,
    expiresAt: Date.now() + ttlMs,
    namespace
  });

  updateAccessOrder(fullKey);
  evictIfNeeded();
}

/**
 * Invalidate a specific key
 *
 * @param {string} key - Cache key
 * @param {string} [namespace='default'] - Namespace
 */
export function invalidate(key, namespace = 'default') {
  const fullKey = `${namespace}:${key}`;
  cache.delete(fullKey);
  const idx = accessOrder.indexOf(fullKey);
  if (idx !== -1) {
    accessOrder.splice(idx, 1);
  }
}

/**
 * Invalidate all keys in a namespace
 *
 * @param {string} namespace - Namespace to invalidate
 */
export function invalidateNamespace(namespace) {
  const keysToDelete = [];

  for (const [key, entry] of cache.entries()) {
    if (entry.namespace === namespace) {
      keysToDelete.push(key);
    }
  }

  for (const key of keysToDelete) {
    cache.delete(key);
    const idx = accessOrder.indexOf(key);
    if (idx !== -1) {
      accessOrder.splice(idx, 1);
    }
  }
}

/**
 * Clear all cache entries
 */
export function clearAll() {
  cache.clear();
  accessOrder.length = 0;
  pendingPromises.clear();
}

/**
 * Get cache statistics
 *
 * @returns {Object} - Cache stats
 */
export function getStats() {
  let expired = 0;
  let valid = 0;
  const now = Date.now();

  for (const entry of cache.values()) {
    if (entry.expiresAt > now) {
      valid++;
    } else {
      expired++;
    }
  }

  return {
    totalEntries: cache.size,
    validEntries: valid,
    expiredEntries: expired,
    pendingPromises: pendingPromises.size,
    maxEntries: MAX_ENTRIES
  };
}

// Internal helpers

function updateAccessOrder(key) {
  const idx = accessOrder.indexOf(key);
  if (idx !== -1) {
    accessOrder.splice(idx, 1);
  }
  accessOrder.push(key);
}

function evictIfNeeded() {
  while (cache.size > MAX_ENTRIES && accessOrder.length > 0) {
    const oldestKey = accessOrder.shift();
    cache.delete(oldestKey);
  }
}

// Pre-defined cache namespaces for different data types
export const NAMESPACES = {
  ANALYTICS: 'analytics',
  DASHBOARD: 'dashboard',
  INVENTORY: 'inventory',
  KEEPA: 'keepa',
  COMPONENTS: 'components'
};

// Pre-defined TTLs for different data freshness requirements
export const TTL = {
  SHORT: 30 * 1000,      // 30 seconds - for frequently changing data
  MEDIUM: 60 * 1000,     // 1 minute - default
  LONG: 5 * 60 * 1000,   // 5 minutes - for stable data
  VERY_LONG: 15 * 60 * 1000  // 15 minutes - for rarely changing data
};

export default {
  getOrCompute,
  get,
  set,
  invalidate,
  invalidateNamespace,
  clearAll,
  getStats,
  NAMESPACES,
  TTL
};
