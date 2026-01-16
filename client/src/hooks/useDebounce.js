import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Debounce a value - Returns a debounced version that only updates after delay
 *
 * @param {any} value - The value to debounce
 * @param {number} delay - Delay in milliseconds (default 300ms)
 * @returns {any} - The debounced value
 *
 * @example
 * const [searchQuery, setSearchQuery] = useState('');
 * const debouncedQuery = useDebounce(searchQuery, 300);
 *
 * useEffect(() => {
 *   if (debouncedQuery) {
 *     searchAPI(debouncedQuery);
 *   }
 * }, [debouncedQuery]);
 */
export function useDebounce(value, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Debounced callback - Returns a debounced version of a function
 *
 * @param {Function} callback - The function to debounce
 * @param {number} delay - Delay in milliseconds (default 300ms)
 * @returns {Function} - The debounced function
 *
 * @example
 * const handleSearch = useDebouncedCallback((query) => {
 *   searchAPI(query);
 * }, 300);
 *
 * <input onChange={(e) => handleSearch(e.target.value)} />
 */
export function useDebouncedCallback(callback, delay = 300) {
  const timeoutRef = useRef(null);
  const callbackRef = useRef(callback);

  // Keep callback ref up to date
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const debouncedCallback = useCallback((...args) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      callbackRef.current(...args);
    }, delay);
  }, [delay]);

  return debouncedCallback;
}

/**
 * Debounced state - Combines useState with debouncing
 * Returns [immediateValue, setImmediateValue, debouncedValue]
 *
 * @param {any} initialValue - Initial state value
 * @param {number} delay - Delay in milliseconds (default 300ms)
 * @returns {Array} - [immediateValue, setImmediateValue, debouncedValue]
 *
 * @example
 * const [query, setQuery, debouncedQuery] = useDebouncedState('', 300);
 *
 * // query updates immediately (for input display)
 * // debouncedQuery updates after delay (for API calls)
 * <input value={query} onChange={(e) => setQuery(e.target.value)} />
 */
export function useDebouncedState(initialValue, delay = 300) {
  const [value, setValue] = useState(initialValue);
  const debouncedValue = useDebounce(value, delay);

  return [value, setValue, debouncedValue];
}

/**
 * Throttled callback - Returns a throttled version of a function
 * Unlike debounce, throttle ensures the function runs at most once per interval
 *
 * @param {Function} callback - The function to throttle
 * @param {number} limit - Minimum time between calls in milliseconds
 * @returns {Function} - The throttled function
 *
 * @example
 * const handleScroll = useThrottledCallback(() => {
 *   updateScrollPosition();
 * }, 100);
 */
export function useThrottledCallback(callback, limit = 100) {
  const lastRanRef = useRef(0);
  const timeoutRef = useRef(null);
  const callbackRef = useRef(callback);

  // Keep callback ref up to date
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const throttledCallback = useCallback((...args) => {
    const now = Date.now();
    const timeSinceLastRun = now - lastRanRef.current;

    if (timeSinceLastRun >= limit) {
      lastRanRef.current = now;
      callbackRef.current(...args);
    } else {
      // Schedule the callback to run after the remaining time
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        lastRanRef.current = Date.now();
        callbackRef.current(...args);
      }, limit - timeSinceLastRun);
    }
  }, [limit]);

  return throttledCallback;
}

export default {
  useDebounce,
  useDebouncedCallback,
  useDebouncedState,
  useThrottledCallback,
};
