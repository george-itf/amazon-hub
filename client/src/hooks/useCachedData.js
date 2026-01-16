import { useState, useEffect, useCallback, useRef } from 'react';
import * as dataCache from '../utils/dataCache.js';

/**
 * Custom hook for data fetching with caching and stale-while-revalidate
 *
 * Features:
 * - Automatic caching with TTL
 * - Returns stale data immediately while fetching fresh data
 * - Deduplicates concurrent requests
 * - Supports manual refresh
 * - Cleanup on unmount
 *
 * @param {string} key - Unique cache key
 * @param {Function} fetchFn - Async function that returns data
 * @param {Object} options - Options
 * @param {string} [options.namespace='default'] - Cache namespace
 * @param {number} [options.ttlMs=30000] - Fresh duration in ms
 * @param {number} [options.staleTtlMs=60000] - Stale duration in ms
 * @param {boolean} [options.enabled=true] - Whether to fetch data
 * @param {any[]} [options.deps=[]] - Additional dependencies for re-fetching
 * @returns {Object} - { data, loading, error, isStale, refresh }
 */
export function useCachedData(key, fetchFn, options = {}) {
  const {
    namespace = 'default',
    ttlMs = dataCache.TTL.SHORT,
    staleTtlMs = dataCache.TTL.MEDIUM,
    enabled = true,
    deps = [],
  } = options;

  const [data, setData] = useState(() => {
    // Initialize from cache if available
    const cached = dataCache.get(key, namespace);
    return cached?.data ?? null;
  });
  const [loading, setLoading] = useState(!dataCache.get(key, namespace));
  const [error, setError] = useState(null);
  const [isStale, setIsStale] = useState(false);

  // Track mounted state for cleanup
  const mountedRef = useRef(true);
  const fetchInProgressRef = useRef(false);

  const fetchData = useCallback(async (forceRefresh = false) => {
    if (!enabled) return;

    // Check cache first
    const cached = dataCache.get(key, namespace);

    if (cached && !forceRefresh) {
      // Return cached data immediately
      setData(cached.data);
      setIsStale(cached.isStale);

      // If fresh, don't refetch
      if (cached.isFresh) {
        setLoading(false);
        return;
      }

      // If stale and already revalidating, skip
      if (cached.isStale && cached.isRevalidating) {
        return;
      }
    }

    // Prevent duplicate concurrent fetches
    if (fetchInProgressRef.current && !forceRefresh) {
      return;
    }

    fetchInProgressRef.current = true;

    // Mark as revalidating if we have stale data
    if (cached?.isStale) {
      dataCache.markRevalidating(key, namespace);
    } else {
      setLoading(true);
    }

    try {
      const result = await fetchFn();

      if (!mountedRef.current) return;

      // Update cache
      dataCache.set(key, result, { ttlMs, staleTtlMs, namespace });

      setData(result);
      setIsStale(false);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;

      // Only set error if we don't have cached data
      if (!dataCache.get(key, namespace)?.data) {
        setError(err);
      }
      console.error(`useCachedData error for ${key}:`, err);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        fetchInProgressRef.current = false;
      }
    }
  }, [key, namespace, ttlMs, staleTtlMs, enabled, fetchFn]);

  // Fetch on mount and when deps change
  useEffect(() => {
    fetchData();
  }, [fetchData, ...deps]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    dataCache.invalidate(key, namespace);
    return fetchData(true);
  }, [key, namespace, fetchData]);

  return {
    data,
    loading,
    error,
    isStale,
    refresh,
  };
}

/**
 * Hook for invalidating cache namespaces
 * Useful for mutations that affect multiple cached queries
 *
 * @returns {Object} - { invalidate, invalidateNamespace, clearAll }
 */
export function useCacheInvalidation() {
  const invalidate = useCallback((key, namespace = 'default') => {
    dataCache.invalidate(key, namespace);
  }, []);

  const invalidateNamespace = useCallback((namespace) => {
    dataCache.invalidateNamespace(namespace);
  }, []);

  const clearAll = useCallback(() => {
    dataCache.clearAll();
  }, []);

  return {
    invalidate,
    invalidateNamespace,
    clearAll,
  };
}

export default useCachedData;
