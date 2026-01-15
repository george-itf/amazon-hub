/**
 * Persistent Rate Limiter
 *
 * Stores rate limit state in the database so it survives server restarts.
 * Uses the rate_limit_buckets table created by 2026-01-15_fixes.sql migration.
 *
 * This solves the audit finding: "Rate limiter state lost on restart"
 * allowing more aggressive post-restart request bursts than intended.
 */
import supabase from '../services/supabase.js';

// Rate limit configuration per API type (requests per second)
const RATE_LIMITS = {
  '/orders/': { burst: 20, rate: 0.5 },      // Orders API
  '/finances/': { burst: 30, rate: 0.5 },    // Finances API
  '/catalog/': { burst: 10, rate: 1 },       // Catalog API
  '/listings/': { burst: 5, rate: 1 },       // Listings API
  '/reports/': { burst: 10, rate: 0.5 },     // Reports API
  '/fba/inventory/': { burst: 2, rate: 0.5 }, // Inventory API
  default: { burst: 10, rate: 1 },
};

// In-memory cache to reduce DB reads (synced on write)
const memoryCache = new Map();

// Cache TTL - refresh from DB every 5 seconds for accuracy
const CACHE_TTL_MS = 5000;
const cacheTimestamps = new Map();

/**
 * Persistent Rate Limiter class - tracks requests per endpoint with DB persistence
 */
class PersistentRateLimiter {
  /**
   * Get rate limit config for a path
   */
  getConfig(path) {
    for (const [prefix, config] of Object.entries(RATE_LIMITS)) {
      if (prefix !== 'default' && path.includes(prefix)) {
        return config;
      }
    }
    return RATE_LIMITS.default;
  }

  /**
   * Get bucket key from path
   */
  getBucketKey(path) {
    for (const prefix of Object.keys(RATE_LIMITS)) {
      if (prefix !== 'default' && path.includes(prefix)) {
        return `sp_api:${prefix}`;
      }
    }
    return 'sp_api:default';
  }

  /**
   * Load bucket state from database
   */
  async loadBucket(bucketKey, config) {
    // Check memory cache first
    const cacheTime = cacheTimestamps.get(bucketKey);
    if (cacheTime && Date.now() - cacheTime < CACHE_TTL_MS && memoryCache.has(bucketKey)) {
      return memoryCache.get(bucketKey);
    }

    try {
      const { data, error } = await supabase
        .from('rate_limit_buckets')
        .select('*')
        .eq('bucket_key', bucketKey)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        console.error('[PersistentRateLimiter] Error loading bucket:', error);
        // Fallback to memory-only on DB error
        return this.getDefaultBucket(config);
      }

      if (data) {
        const bucket = {
          tokens: parseFloat(data.tokens),
          lastRefill: new Date(data.last_refill).getTime(),
          burst: data.burst_limit,
          rate: parseFloat(data.rate_per_second),
        };
        memoryCache.set(bucketKey, bucket);
        cacheTimestamps.set(bucketKey, Date.now());
        return bucket;
      }

      // No existing bucket - create new one
      const newBucket = this.getDefaultBucket(config);
      await this.saveBucket(bucketKey, newBucket, config);
      return newBucket;
    } catch (err) {
      console.error('[PersistentRateLimiter] Exception loading bucket:', err);
      return this.getDefaultBucket(config);
    }
  }

  /**
   * Get default bucket state
   */
  getDefaultBucket(config) {
    return {
      tokens: config.burst,
      lastRefill: Date.now(),
      burst: config.burst,
      rate: config.rate,
    };
  }

  /**
   * Save bucket state to database
   */
  async saveBucket(bucketKey, bucket, config) {
    try {
      const { error } = await supabase
        .from('rate_limit_buckets')
        .upsert({
          bucket_key: bucketKey,
          tokens: bucket.tokens,
          last_refill: new Date(bucket.lastRefill).toISOString(),
          burst_limit: config.burst,
          rate_per_second: config.rate,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'bucket_key',
        });

      if (error) {
        console.error('[PersistentRateLimiter] Error saving bucket:', error);
      }

      // Update memory cache
      memoryCache.set(bucketKey, bucket);
      cacheTimestamps.set(bucketKey, Date.now());
    } catch (err) {
      console.error('[PersistentRateLimiter] Exception saving bucket:', err);
    }
  }

  /**
   * Wait for rate limit slot, returns delay applied in ms
   * Updates database state to ensure consistency across restarts
   */
  async acquire(path) {
    const bucketKey = this.getBucketKey(path);
    const config = this.getConfig(path);

    const bucket = await this.loadBucket(bucketKey, config);
    const now = Date.now();
    const timePassed = (now - bucket.lastRefill) / 1000;

    // Refill tokens based on time passed
    bucket.tokens = Math.min(config.burst, bucket.tokens + timePassed * config.rate);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      // Save updated state asynchronously (don't block)
      this.saveBucket(bucketKey, bucket, config).catch(() => {});
      return 0;
    }

    // Need to wait for a token
    const waitTime = Math.ceil((1 - bucket.tokens) / config.rate * 1000);
    await this.sleep(waitTime);
    bucket.tokens = 0;
    bucket.lastRefill = Date.now();

    // Save updated state
    await this.saveBucket(bucketKey, bucket, config);
    return waitTime;
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current state of all buckets (for monitoring/debugging)
   */
  async getAllBucketStates() {
    try {
      const { data, error } = await supabase
        .from('rate_limit_buckets')
        .select('*')
        .order('bucket_key');

      if (error) {
        console.error('[PersistentRateLimiter] Error getting all buckets:', error);
        return [];
      }

      return (data || []).map(row => ({
        key: row.bucket_key,
        tokens: parseFloat(row.tokens),
        lastRefill: row.last_refill,
        burstLimit: row.burst_limit,
        ratePerSecond: parseFloat(row.rate_per_second),
        updatedAt: row.updated_at,
      }));
    } catch (err) {
      console.error('[PersistentRateLimiter] Exception getting all buckets:', err);
      return [];
    }
  }

  /**
   * Reset a specific bucket (useful for testing or manual intervention)
   */
  async resetBucket(bucketKey) {
    try {
      const { error } = await supabase
        .from('rate_limit_buckets')
        .delete()
        .eq('bucket_key', bucketKey);

      if (error) {
        console.error('[PersistentRateLimiter] Error resetting bucket:', error);
        return false;
      }

      memoryCache.delete(bucketKey);
      cacheTimestamps.delete(bucketKey);
      return true;
    } catch (err) {
      console.error('[PersistentRateLimiter] Exception resetting bucket:', err);
      return false;
    }
  }

  /**
   * Clear memory cache (forces DB reload on next acquire)
   */
  clearCache() {
    memoryCache.clear();
    cacheTimestamps.clear();
  }
}

// Export singleton instance
const persistentRateLimiter = new PersistentRateLimiter();

export default persistentRateLimiter;
export { PersistentRateLimiter, RATE_LIMITS };
