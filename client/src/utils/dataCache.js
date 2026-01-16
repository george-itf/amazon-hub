/**
 * Client-side Data Cache
 *
 * Simple in-memory cache with TTL for memoizing API responses.
 * Designed for frequently accessed data that doesn't need real-time updates.
 *
 * Features:
 * - TTL-based expiration
 * - Namespace support for grouped invalidation
 * - Stale-while-revalidate pattern
 * - Integration with React hooks
 */

// Cache storage
const cache = new Map();

// Default configuration
const DEFAULT_TTL_MS = 30 * 1000; // 30 seconds
const STALE_THRESHOLD_MS = 60 * 1000; // Consider stale after 1 minute

/**
 * Cache entry structure
 * @typedef {Object} CacheEntry
 * @property {any} data - The cached data
 * @property {number} expiresAt - Timestamp when entry is fresh until
 * @property {number} staleAt - Timestamp when entry becomes stale
 * @property {string} namespace - Optional namespace
 * @property {boolean} isRevalidating - Whether entry is being revalidated
 */

/**
 * Get a value from cache
 *
 * @param {string} key - Cache key
 * @param {string} [namespace='default'] - Namespace
 * @returns {Object|null} - { data, isFresh, isStale } or null if not found
 */
export function get(key, namespace = 'default') {
  const fullKey = `${namespace}:${key}`;
  const entry = cache.get(fullKey);

  if (!entry) {
    return null;
  }

  const now = Date.now();

  // Check if completely expired (beyond stale threshold)
  if (now > entry.staleAt) {
    cache.delete(fullKey);
    return null;
  }

  return {
    data: entry.data,
    isFresh: now < entry.expiresAt,
    isStale: now >= entry.expiresAt && now < entry.staleAt,
    isRevalidating: entry.isRevalidating,
  };
}

/**
 * Set a value in cache
 *
 * @param {string} key - Cache key
 * @param {any} data - Data to cache
 * @param {Object} options - Cache options
 * @param {number} [options.ttlMs=30000] - Fresh duration
 * @param {number} [options.staleTtlMs=60000] - Stale duration (total)
 * @param {string} [options.namespace='default'] - Namespace
 */
export function set(key, data, options = {}) {
  const {
    ttlMs = DEFAULT_TTL_MS,
    staleTtlMs = STALE_THRESHOLD_MS,
    namespace = 'default',
  } = options;

  const fullKey = `${namespace}:${key}`;
  const now = Date.now();

  cache.set(fullKey, {
    data,
    expiresAt: now + ttlMs,
    staleAt: now + staleTtlMs,
    namespace,
    isRevalidating: false,
  });
}

/**
 * Mark an entry as revalidating
 *
 * @param {string} key - Cache key
 * @param {string} [namespace='default'] - Namespace
 */
export function markRevalidating(key, namespace = 'default') {
  const fullKey = `${namespace}:${key}`;
  const entry = cache.get(fullKey);
  if (entry) {
    entry.isRevalidating = true;
  }
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
  keysToDelete.forEach(key => cache.delete(key));
}

/**
 * Clear all cache entries
 */
export function clearAll() {
  cache.clear();
}

/**
 * Get cache statistics
 *
 * @returns {Object} - Cache stats
 */
export function getStats() {
  const now = Date.now();
  let fresh = 0;
  let stale = 0;
  let expired = 0;

  for (const entry of cache.values()) {
    if (now < entry.expiresAt) {
      fresh++;
    } else if (now < entry.staleAt) {
      stale++;
    } else {
      expired++;
    }
  }

  return {
    total: cache.size,
    fresh,
    stale,
    expired,
  };
}

// Pre-defined cache namespaces
export const NAMESPACES = {
  DASHBOARD: 'dashboard',
  ANALYTICS: 'analytics',
  INVENTORY: 'inventory',
  COMPONENTS: 'components',
  LISTINGS: 'listings',
  KEEPA: 'keepa',
};

// Pre-defined TTLs for different data types
export const TTL = {
  // Dashboard data - refreshes frequently
  REALTIME: 10 * 1000, // 10 seconds
  // General operational data
  SHORT: 30 * 1000, // 30 seconds
  // Analytics and reports
  MEDIUM: 60 * 1000, // 1 minute
  // Static/reference data
  LONG: 5 * 60 * 1000, // 5 minutes
  // Rarely changing config
  VERY_LONG: 15 * 60 * 1000, // 15 minutes
};

export default {
  get,
  set,
  markRevalidating,
  invalidate,
  invalidateNamespace,
  clearAll,
  getStats,
  NAMESPACES,
  TTL,
};
