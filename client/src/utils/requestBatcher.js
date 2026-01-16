/**
 * Request Batcher
 *
 * Batches multiple similar API requests into a single request to reduce
 * network overhead and improve performance. Useful for N+1 query scenarios
 * where many individual item fetches could be batched into one bulk fetch.
 *
 * Features:
 * - Automatic batching within a configurable time window
 * - Promise-based interface (each caller gets their specific result)
 * - Configurable batch size limits
 * - Support for custom batch and unbatch functions
 */

/**
 * Creates a batched version of a fetch function
 *
 * @param {Object} options - Configuration options
 * @param {Function} options.batchFn - Function that takes array of keys and returns Promise<Map<key, value>>
 * @param {number} [options.maxBatchSize=50] - Maximum items per batch
 * @param {number} [options.delayMs=10] - Time to wait before executing batch
 * @param {Function} [options.keyFn] - Function to extract unique key from each item (default: identity)
 * @returns {Function} - Batched fetch function
 *
 * @example
 * // Create a batched component fetcher
 * const getComponentBatched = createBatcher({
 *   batchFn: async (ids) => {
 *     const result = await api.getComponentsByIds(ids);
 *     return new Map(result.map(c => [c.id, c]));
 *   },
 *   maxBatchSize: 100,
 *   delayMs: 10,
 * });
 *
 * // Use it like a normal function - calls will be automatically batched
 * const component1 = await getComponentBatched(123);
 * const component2 = await getComponentBatched(456);
 */
export function createBatcher(options) {
  const {
    batchFn,
    maxBatchSize = 50,
    delayMs = 10,
    keyFn = (x) => x,
  } = options;

  let pendingBatch = [];
  let batchTimeout = null;

  const executeBatch = async () => {
    if (pendingBatch.length === 0) return;

    const batch = pendingBatch;
    pendingBatch = [];
    batchTimeout = null;

    try {
      // Extract unique keys
      const keys = [...new Set(batch.map((item) => item.key))];

      // Execute batch function
      const results = await batchFn(keys);

      // Resolve each pending promise with its result
      for (const item of batch) {
        const result = results.get(item.key);
        if (result !== undefined) {
          item.resolve(result);
        } else {
          item.reject(new Error(`No result for key: ${item.key}`));
        }
      }
    } catch (error) {
      // Reject all pending promises on error
      for (const item of batch) {
        item.reject(error);
      }
    }
  };

  const scheduleBatch = () => {
    if (batchTimeout) return;

    // Check if we've hit max batch size
    if (pendingBatch.length >= maxBatchSize) {
      executeBatch();
      return;
    }

    batchTimeout = setTimeout(executeBatch, delayMs);
  };

  return function batchedFetch(input) {
    return new Promise((resolve, reject) => {
      const key = keyFn(input);

      pendingBatch.push({ key, input, resolve, reject });
      scheduleBatch();
    });
  };
}

/**
 * Creates a parallel request executor with concurrency control
 *
 * @param {number} maxConcurrent - Maximum concurrent requests
 * @returns {Function} - Executor function
 *
 * @example
 * const executor = createParallelExecutor(3);
 *
 * // These will run 3 at a time
 * const results = await Promise.all(
 *   items.map(item => executor(() => fetchItem(item)))
 * );
 */
export function createParallelExecutor(maxConcurrent = 5) {
  let running = 0;
  const queue = [];

  const processQueue = () => {
    while (running < maxConcurrent && queue.length > 0) {
      const { fn, resolve, reject } = queue.shift();
      running++;

      fn()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          running--;
          processQueue();
        });
    }
  };

  return function execute(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      processQueue();
    });
  };
}

/**
 * Deduplicates concurrent requests for the same key
 *
 * If multiple calls are made for the same key while a request is in flight,
 * they will all receive the same result without making additional requests.
 *
 * @param {Function} fetchFn - Async function that takes a key and returns a value
 * @param {Object} [options] - Configuration options
 * @param {Function} [options.keyFn] - Function to generate cache key from arguments
 * @returns {Function} - Deduplicated fetch function
 *
 * @example
 * const getUser = deduplicateRequests(async (userId) => {
 *   const response = await fetch(`/api/users/${userId}`);
 *   return response.json();
 * });
 *
 * // These two calls will result in only one network request
 * const [user1, user2] = await Promise.all([
 *   getUser(123),
 *   getUser(123),
 * ]);
 */
export function deduplicateRequests(fetchFn, options = {}) {
  const { keyFn = (...args) => JSON.stringify(args) } = options;
  const inFlight = new Map();

  return async function dedupedFetch(...args) {
    const key = keyFn(...args);

    // If request is already in flight, return the existing promise
    if (inFlight.has(key)) {
      return inFlight.get(key);
    }

    // Create new request and store promise
    const promise = fetchFn(...args).finally(() => {
      // Clean up after request completes
      inFlight.delete(key);
    });

    inFlight.set(key, promise);
    return promise;
  };
}

/**
 * Retry a function with exponential backoff
 *
 * @param {Function} fn - Async function to retry
 * @param {Object} [options] - Retry options
 * @param {number} [options.maxRetries=3] - Maximum retry attempts
 * @param {number} [options.initialDelayMs=100] - Initial delay between retries
 * @param {number} [options.maxDelayMs=5000] - Maximum delay between retries
 * @param {Function} [options.shouldRetry] - Function to determine if error is retryable
 * @returns {Promise} - Result of function or last error
 */
export async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 3,
    initialDelayMs = 100,
    maxDelayMs = 5000,
    shouldRetry = () => true,
  } = options;

  let lastError;
  let delay = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= maxRetries || !shouldRetry(error)) {
        throw error;
      }

      // Wait before retry with exponential backoff
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, maxDelayMs);
    }
  }

  throw lastError;
}

export default {
  createBatcher,
  createParallelExecutor,
  deduplicateRequests,
  retryWithBackoff,
};
