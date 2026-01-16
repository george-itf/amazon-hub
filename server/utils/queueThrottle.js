/**
 * Queue Throttle Utility
 * Provides rate-limited job execution with retry logic for batch operations
 */

/**
 * Create a throttled queue that limits concurrent execution
 * @param {number} concurrency - Maximum concurrent jobs (default 3)
 * @param {number} intervalMs - Minimum interval between job starts (default 500ms)
 * @returns {Object} Queue controller with enqueue method
 */
export function createThrottledQueue(concurrency = 3, intervalMs = 500) {
  const queue = [];
  let active = 0;
  let lastStart = 0;
  let processing = false;

  async function processQueue() {
    if (processing) return;
    processing = true;

    while (queue.length > 0 && active < concurrency) {
      // Enforce minimum interval between job starts
      const now = Date.now();
      const timeSinceLast = now - lastStart;
      if (timeSinceLast < intervalMs) {
        await sleep(intervalMs - timeSinceLast);
      }

      if (active >= concurrency || queue.length === 0) break;

      active++;
      lastStart = Date.now();
      const { job, resolve, reject } = queue.shift();

      // Execute job asynchronously
      job()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          active--;
          processQueue();
        });
    }

    processing = false;
  }

  return {
    /**
     * Enqueue a job for throttled execution
     * @param {Function} job - Async function to execute
     * @returns {Promise} Resolves when job completes
     */
    enqueue(job) {
      return new Promise((resolve, reject) => {
        queue.push({ job, resolve, reject });
        processQueue();
      });
    },

    /**
     * Get current queue status
     */
    getStatus() {
      return {
        pending: queue.length,
        active,
        concurrency,
      };
    },

    /**
     * Clear all pending jobs
     */
    clear() {
      const cleared = queue.length;
      queue.length = 0;
      return cleared;
    },
  };
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry configuration
 */
const DEFAULT_RETRY_CONFIG = {
  maxRetries: 4,
  baseDelayMs: 1000,
  maxDelayMs: 16000,
  retryableStatuses: [429, 500, 502, 503, 504],
};

/**
 * Calculate exponential backoff delay with jitter
 * @param {number} attempt - Current attempt number (0-based)
 * @param {number} baseDelay - Base delay in milliseconds
 * @param {number} maxDelay - Maximum delay in milliseconds
 * @returns {number} Delay in milliseconds
 */
export function calculateBackoff(attempt, baseDelay = 1000, maxDelay = 16000) {
  const delay = baseDelay * Math.pow(2, attempt);
  // Add jitter (±25%)
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.min(Math.round(delay + jitter), maxDelay);
}

/**
 * Check if an error/status is retryable
 * @param {Error} error - The error object
 * @param {number} status - HTTP status code
 * @param {Object} config - Retry configuration
 * @returns {boolean}
 */
export function isRetryableError(error, status, config = DEFAULT_RETRY_CONFIG) {
  // Network errors
  if (error && (
    error.code === 'ECONNRESET' ||
    error.code === 'ETIMEDOUT' ||
    error.code === 'ENOTFOUND' ||
    error.code === 'ECONNREFUSED' ||
    error.message?.includes('network') ||
    error.message?.includes('timeout') ||
    error.message?.includes('socket')
  )) {
    return true;
  }

  // HTTP status codes
  if (status && config.retryableStatuses.includes(status)) {
    return true;
  }

  return false;
}

/**
 * Execute a function with retry logic
 * @param {Function} fn - Async function to execute
 * @param {Object} options - Retry options
 * @returns {Promise} Result of the function
 */
export async function withRetry(fn, options = {}) {
  const config = { ...DEFAULT_RETRY_CONFIG, ...options };
  let lastError = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if error is retryable
      const status = error.status || error.statusCode;
      if (!isRetryableError(error, status, config) || attempt >= config.maxRetries) {
        throw error;
      }

      // Calculate delay
      const delay = calculateBackoff(attempt, config.baseDelayMs, config.maxDelayMs);

      if (options.onRetry) {
        options.onRetry(attempt + 1, delay, error);
      }

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Process items in batches with throttling and retry
 * @param {Array} items - Items to process
 * @param {Function} processor - Async function(item) => result
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Results with success/failure counts
 */
export async function processBatch(items, processor, options = {}) {
  const {
    concurrency = 3,
    intervalMs = 500,
    retryConfig = DEFAULT_RETRY_CONFIG,
    onProgress,
    onItemComplete,
  } = options;

  const queue = createThrottledQueue(concurrency, intervalMs);
  const results = [];
  let completed = 0;

  const processItem = async (item, index) => {
    try {
      const result = await withRetry(
        () => processor(item, index),
        {
          ...retryConfig,
          onRetry: (attempt, delay, error) => {
            console.log(`[Batch] Retrying item ${index} (attempt ${attempt}), waiting ${delay}ms: ${error.message}`);
          },
        }
      );

      const itemResult = { index, item, success: true, result };
      results[index] = itemResult;

      if (onItemComplete) {
        onItemComplete(itemResult);
      }

      return itemResult;
    } catch (error) {
      const itemResult = {
        index,
        item,
        success: false,
        error: error.message || String(error),
      };
      results[index] = itemResult;

      if (onItemComplete) {
        onItemComplete(itemResult);
      }

      return itemResult;
    } finally {
      completed++;
      if (onProgress) {
        onProgress(completed, items.length);
      }
    }
  };

  // Enqueue all items
  const promises = items.map((item, index) =>
    queue.enqueue(() => processItem(item, index))
  );

  await Promise.all(promises);

  // Compile summary
  const successCount = results.filter(r => r?.success).length;
  const failedCount = results.filter(r => r && !r.success).length;

  return {
    total: items.length,
    success: successCount,
    failed: failedCount,
    results,
  };
}

export { sleep, DEFAULT_RETRY_CONFIG };
