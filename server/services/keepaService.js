/**
 * Shared Keepa Service
 * Consolidates all Keepa API logic including:
 * - Budget enforcement (hourly/daily limits)
 * - Request logging
 * - Account balance tracking
 * - Caching with TTL
 * - CSV parsing utilities
 */

import fetch from 'node-fetch';
import supabase from './supabase.js';

// Keepa API configuration
const KEEPA_API_BASE = 'https://api.keepa.com';
const KEEPA_TOKENS_PER_PRODUCT = 1;

// Cache tracking for metrics
let cacheStats = {
  hits: 0,
  misses: 0,
  lastReset: new Date()
};

// ============================================================================
// KEEPA CSV INDEX MAPPING (aligned with Keepa API documentation)
// ============================================================================
// Keepa CSV array indices (price types):
//   csv[0]  = AMAZON: Amazon price
//   csv[1]  = NEW: Marketplace New price (combined FBA+FBM)
//   csv[2]  = USED: Marketplace Used price
//   csv[3]  = SALES: Sales Rank
//   csv[7]  = NEW_FBM_SHIPPING: FBM price with shipping
//   csv[10] = NEW_FBA: FBA-specific price (for margin analysis)
//   csv[11] = COUNT_NEW: New offer count
//   csv[16] = RATING: Rating (multiply by 10 in Keepa format, e.g., 45 = 4.5 stars)
//   csv[17] = COUNT_REVIEWS: Review count
//   csv[18] = BUY_BOX_SHIPPING: Buy Box price with shipping
//
// Stats object (from &stats=90 parameter - FREE):
//   stats.current[18] = Current Buy Box price
//   stats.min[18]     = Minimum Buy Box price over period
//   stats.max[18]     = Maximum Buy Box price over period
//   stats.avg[18]     = Average Buy Box price over period
// ============================================================================

export const CSV_INDICES = {
  AMAZON: 0,
  NEW: 1,
  USED: 2,
  SALES_RANK: 3,
  FBM_SHIPPING: 7,
  FBA: 10,
  OFFER_COUNT: 11,
  RATING: 16,
  REVIEW_COUNT: 17,
  BUY_BOX: 18,
};

// ============================================================================
// CSV PARSING UTILITIES
// ============================================================================

/**
 * Extract latest non-null price value from a Keepa CSV array
 * Searches backwards from the end to find the most recent valid price.
 *
 * @param {Array<number>} csvArray - Keepa CSV array (timestamp, value, timestamp, value, ...)
 * @returns {number|null} - Latest valid price in pence, or null if none found
 */
export function latestPriceFromCsv(csvArray) {
  if (!csvArray || !Array.isArray(csvArray) || csvArray.length < 2) {
    return null;
  }

  // Keepa CSV format: [timestamp, value, timestamp, value, ...]
  // Search backwards for the first valid value
  for (let i = csvArray.length - 1; i >= 0; i--) {
    const value = csvArray[i];
    // Keepa uses -1 for "no data" and -2 for "out of stock"
    if (typeof value === 'number' && value > 0) {
      return value;
    }
  }

  return null;
}

/**
 * Extract latest non-null integer value from a Keepa CSV array
 * Used for sales rank, offer count, review count, etc.
 *
 * @param {Array<number>} csvArray - Keepa CSV array
 * @returns {number|null} - Latest valid integer, or null if none found
 */
export function latestIntFromCsv(csvArray) {
  if (!csvArray || !Array.isArray(csvArray) || csvArray.length < 2) {
    return null;
  }

  // Search backwards for the first valid value
  for (let i = csvArray.length - 1; i >= 0; i--) {
    const value = csvArray[i];
    // Keepa uses -1 for "no data"
    if (typeof value === 'number' && value >= 0) {
      return value;
    }
  }

  return null;
}

/**
 * Extract latest rating from Keepa CSV array
 * Keepa stores ratings multiplied by 10 (e.g., 45 = 4.5 stars)
 *
 * @param {Array<number>} csvArray - Keepa CSV array for rating
 * @returns {number|null} - Latest rating as decimal (e.g., 4.5), or null
 */
export function latestRatingFromCsv(csvArray) {
  const rawValue = latestIntFromCsv(csvArray);
  if (rawValue === null) return null;
  // Convert from Keepa format (45 = 4.5 stars)
  return Math.round((rawValue / 10) * 100) / 100;
}

/**
 * Extract all metrics from a Keepa product's CSV data
 * Returns a structured object with all available metrics
 *
 * @param {object} product - Keepa product object with csv and stats
 * @returns {object} - Structured metrics object
 */
export function extractKeepaMetrics(product) {
  if (!product || !product.csv) {
    return null;
  }

  const csv = product.csv;
  const stats = product.stats || {};

  // Extract buybox price with fallback to Amazon price
  const buyboxPrice = latestPriceFromCsv(csv[CSV_INDICES.BUY_BOX]) || latestPriceFromCsv(csv[CSV_INDICES.AMAZON]);

  return {
    // Core pricing
    buybox_price_pence: buyboxPrice,
    amazon_price_pence: latestPriceFromCsv(csv[CSV_INDICES.AMAZON]),
    new_price_pence: latestPriceFromCsv(csv[CSV_INDICES.NEW]),
    used_price_pence: latestPriceFromCsv(csv[CSV_INDICES.USED]),

    // FBA/FBM specific pricing
    fba_price_pence: latestPriceFromCsv(csv[CSV_INDICES.FBA]),
    fbm_price_pence: latestPriceFromCsv(csv[CSV_INDICES.FBM_SHIPPING]),

    // Sales data
    sales_rank: latestIntFromCsv(csv[CSV_INDICES.SALES_RANK]),
    offer_count: latestIntFromCsv(csv[CSV_INDICES.OFFER_COUNT]),

    // Ratings
    rating: latestRatingFromCsv(csv[CSV_INDICES.RATING]),
    review_count: latestIntFromCsv(csv[CSV_INDICES.REVIEW_COUNT]),

    // Stats from &stats=90 parameter (free)
    stats_min_price_90d: stats.min?.[CSV_INDICES.BUY_BOX] > 0 ? stats.min[CSV_INDICES.BUY_BOX] : null,
    stats_max_price_90d: stats.max?.[CSV_INDICES.BUY_BOX] > 0 ? stats.max[CSV_INDICES.BUY_BOX] : null,
    stats_avg_price_90d: stats.avg?.[CSV_INDICES.BUY_BOX] > 0 ? Math.round(stats.avg[CSV_INDICES.BUY_BOX]) : null,

    // Product info
    title: product.title || null,
    category: product.categoryTree?.[0]?.name || null,
    image_url: product.imagesCSV ? `https://images-na.ssl-images-amazon.com/images/I/${product.imagesCSV.split(',')[0]}` : null,
  };
}

// ============================================================================
// SETTINGS & BUDGET MANAGEMENT
// ============================================================================

/**
 * Get Keepa settings from database
 */
export async function getKeepaSettings() {
  const { data, error } = await supabase
    .from('keepa_settings')
    .select('setting_key, setting_value');

  if (error) {
    console.error('Failed to fetch Keepa settings:', error);
    return {
      max_tokens_per_hour: 800,
      max_tokens_per_day: 6000,
      min_reserve: 200,
      min_refresh_minutes: 720,
      domain_id: 2  // UK (amazon.co.uk)
    };
  }

  const settings = {};
  for (const row of data || []) {
    settings[row.setting_key] = parseInt(row.setting_value) || row.setting_value;
  }
  return settings;
}

/**
 * Get tokens spent in time window
 */
async function getTokensSpent(minutes) {
  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('keepa_request_log')
    .select('tokens_spent')
    .gte('requested_at', since)
    .eq('status', 'SUCCESS');

  if (error) {
    console.error('Failed to fetch token usage:', error);
    return 0;
  }

  return (data || []).reduce((sum, r) => sum + (r.tokens_spent || 0), 0);
}

/**
 * Check if we can make a request within budget
 */
export async function canMakeRequest(tokensNeeded, settings = null) {
  if (!settings) {
    settings = await getKeepaSettings();
  }

  const tokensSpentHour = await getTokensSpent(60);
  const tokensSpentDay = await getTokensSpent(24 * 60);

  const remainingHour = settings.max_tokens_per_hour - tokensSpentHour;
  const remainingDay = settings.max_tokens_per_day - tokensSpentDay;

  if (tokensNeeded > remainingHour - settings.min_reserve) {
    return { allowed: false, reason: 'HOURLY_BUDGET_EXCEEDED', remaining: remainingHour };
  }

  if (tokensNeeded > remainingDay - settings.min_reserve) {
    return { allowed: false, reason: 'DAILY_BUDGET_EXCEEDED', remaining: remainingDay };
  }

  return { allowed: true, remaining_hour: remainingHour, remaining_day: remainingDay };
}

// ============================================================================
// REQUEST LOGGING & ACCOUNT TRACKING
// ============================================================================

/**
 * Log a Keepa request
 */
async function logKeepaRequest(endpoint, asinsCount, tokensEstimated, status, tokensSpent = null, latencyMs = null, errorMessage = null, cacheHit = false) {
  await supabase.from('keepa_request_log').insert({
    endpoint,
    asins_count: asinsCount,
    tokens_estimated: tokensEstimated,
    tokens_spent: tokensSpent,
    status,
    latency_ms: latencyMs,
    error_message: errorMessage,
  });

  // Track cache stats
  if (cacheHit) {
    cacheStats.hits++;
  } else if (status === 'SUCCESS') {
    cacheStats.misses++;
  }
}

/**
 * Record Keepa account balance from API response
 * Tracks tokensLeft for monitoring actual Keepa account status
 */
async function recordAccountBalance(data, endpoint) {
  try {
    if (data.tokensLeft !== undefined) {
      await supabase.from('keepa_account_balance').insert({
        tokens_left: data.tokensLeft,
        refill_rate: data.refillRate || null,
        refill_in_ms: data.refillIn || null,
        token_flow_reduction: data.tokenFlowReduction || null,
        request_endpoint: endpoint,
      });
    }
  } catch (err) {
    // Non-critical, just log
    console.error('Failed to record Keepa account balance:', err.message);
  }
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  const now = new Date();
  const hoursSinceReset = (now - cacheStats.lastReset) / (1000 * 60 * 60);
  const total = cacheStats.hits + cacheStats.misses;
  const hitRate = total > 0 ? (cacheStats.hits / total * 100).toFixed(1) : 0;

  return {
    hits: cacheStats.hits,
    misses: cacheStats.misses,
    hitRate: `${hitRate}%`,
    hoursSinceReset: hoursSinceReset.toFixed(1),
    lastReset: cacheStats.lastReset.toISOString(),
  };
}

/**
 * Reset cache statistics
 */
export function resetCacheStats() {
  cacheStats = {
    hits: 0,
    misses: 0,
    lastReset: new Date()
  };
}

// ============================================================================
// METRICS STORAGE
// ============================================================================

/**
 * Store Keepa metrics from product data to keepa_metrics_daily
 */
async function storeKeepaMetrics(asin, product) {
  try {
    if (!product.csv) return;

    const today = new Date().toISOString().split('T')[0];
    const metrics = extractKeepaMetrics(product);

    if (!metrics) return;

    await supabase.from('keepa_metrics_daily').upsert({
      asin,
      date: today,
      buybox_price_pence: metrics.buybox_price_pence,
      amazon_price_pence: metrics.amazon_price_pence,
      new_price_pence: metrics.new_price_pence,
      used_price_pence: metrics.used_price_pence,
      sales_rank: metrics.sales_rank,
      offer_count: metrics.offer_count,
      rating: metrics.rating,
      review_count: metrics.review_count,
      fba_price_pence: metrics.fba_price_pence,
      fbm_price_pence: metrics.fbm_price_pence,
      stats_min_price_90d: metrics.stats_min_price_90d,
      stats_max_price_90d: metrics.stats_max_price_90d,
      stats_avg_price_90d: metrics.stats_avg_price_90d,
    });
  } catch (err) {
    console.error('Failed to store Keepa metrics:', err);
  }
}

// ============================================================================
// MAIN API FUNCTIONS
// ============================================================================

/**
 * Fetch product from Keepa API (raw fetch, no caching)
 * Uses &stats=90 parameter (free) for additional price statistics
 *
 * @private - Use getKeepaProduct instead for cached, budgeted access
 */
async function fetchFromKeepaApi(asins, domainId) {
  const apiKey = process.env.KEEPA_API_KEY;
  if (!apiKey) {
    throw new Error('KEEPA_API_KEY not configured');
  }

  const asinList = Array.isArray(asins) ? asins.join(',') : asins;
  // Added &stats=90 for free price statistics (min/max/avg over 90 days)
  const url = `${KEEPA_API_BASE}/product?key=${apiKey}&domain=${domainId}&asin=${asinList}&stats=90`;

  const startTime = Date.now();
  const response = await fetch(url);
  const latencyMs = Date.now() - startTime;

  if (!response.ok) {
    throw new Error(`Keepa API error: ${response.status}`);
  }

  const data = await response.json();

  // Record account balance for monitoring
  await recordAccountBalance(data, '/product');

  return {
    data,
    latencyMs,
    tokensSpent: data.tokensConsumed || asins.length,
    tokensLeft: data.tokensLeft,
    refillRate: data.refillRate,
    refillIn: data.refillIn,
  };
}

/**
 * Get Keepa product data with caching, budget enforcement, and logging
 * This is the main function that should be used by other modules
 *
 * @param {string} asin - ASIN to fetch
 * @param {object} options - Options
 * @param {boolean} options.forceRefresh - Skip cache and force API call
 * @param {boolean} options.skipBudgetCheck - Skip budget enforcement (use with caution)
 * @returns {object} - { product, fromCache, tokensSpent, tokensLeft }
 */
export async function getKeepaProduct(asin, options = {}) {
  const { forceRefresh = false, skipBudgetCheck = false } = options;
  const normalizedAsin = asin.toUpperCase();
  const settings = await getKeepaSettings();

  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const { data: cached, error } = await supabase
      .from('keepa_products_cache')
      .select('*')
      .eq('asin', normalizedAsin)
      .single();

    if (!error && cached && new Date(cached.expires_at) > new Date()) {
      // Track cache hit
      cacheStats.hits++;

      return {
        asin: cached.asin,
        product: cached.payload_json,
        metrics: extractKeepaMetrics(cached.payload_json),
        fetched_at: cached.fetched_at,
        expires_at: cached.expires_at,
        fromCache: true,
        tokensSpent: 0,
        tokensLeft: null,
      };
    }
  }

  // Track cache miss
  cacheStats.misses++;

  // Check if API key is configured
  if (!process.env.KEEPA_API_KEY) {
    throw new Error('KEEPA_API_KEY not configured');
  }

  // Check budget (unless skipped)
  if (!skipBudgetCheck) {
    const budgetCheck = await canMakeRequest(KEEPA_TOKENS_PER_PRODUCT, settings);
    if (!budgetCheck.allowed) {
      const error = new Error('Keepa token budget exceeded');
      error.code = budgetCheck.reason;
      error.remaining = budgetCheck.remaining;
      throw error;
    }
  }

  // Fetch from Keepa API
  try {
    const { data, latencyMs, tokensSpent, tokensLeft } = await fetchFromKeepaApi([normalizedAsin], settings.domain_id);

    await logKeepaRequest('/product', 1, KEEPA_TOKENS_PER_PRODUCT, 'SUCCESS', tokensSpent, latencyMs, null, false);

    if (!data.products || data.products.length === 0) {
      const error = new Error('Product not found');
      error.code = 'NOT_FOUND';
      throw error;
    }

    const product = data.products[0];
    const expiresAt = new Date(Date.now() + settings.min_refresh_minutes * 60 * 1000);

    // Cache the result
    await supabase.from('keepa_products_cache').upsert({
      asin: normalizedAsin,
      domain_id: settings.domain_id,
      payload_json: product,
      fetched_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString()
    });

    // Store daily metrics
    await storeKeepaMetrics(normalizedAsin, product);

    return {
      asin: normalizedAsin,
      product,
      metrics: extractKeepaMetrics(product),
      fetched_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
      fromCache: false,
      tokensSpent,
      tokensLeft,
    };
  } catch (fetchError) {
    await logKeepaRequest('/product', 1, KEEPA_TOKENS_PER_PRODUCT, 'FAILED', null, null, fetchError.message, false);
    throw fetchError;
  }
}

/**
 * Refresh multiple ASINs from Keepa API
 * Enforces budget, logs requests, and caches results
 *
 * @param {string[]} asins - Array of ASINs to refresh
 * @returns {object} - { results, tokensSpent, tokensLeft }
 */
export async function refreshKeepaProducts(asins) {
  if (!asins || !Array.isArray(asins) || asins.length === 0) {
    throw new Error('asins array is required');
  }

  if (asins.length > 100) {
    throw new Error('Maximum 100 ASINs per request');
  }

  if (!process.env.KEEPA_API_KEY) {
    throw new Error('KEEPA_API_KEY not configured');
  }

  const settings = await getKeepaSettings();
  const tokensNeeded = asins.length * KEEPA_TOKENS_PER_PRODUCT;

  // Check budget
  const budgetCheck = await canMakeRequest(tokensNeeded, settings);
  if (!budgetCheck.allowed) {
    await logKeepaRequest('/refresh', asins.length, tokensNeeded, 'BUDGET_EXCEEDED');
    const error = new Error('Keepa token budget exceeded');
    error.code = budgetCheck.reason;
    error.remaining = budgetCheck.remaining;
    error.tokens_needed = tokensNeeded;
    throw error;
  }

  // Fetch from Keepa
  const normalizedAsins = asins.map(a => a.toUpperCase());
  const { data, latencyMs, tokensSpent, tokensLeft } = await fetchFromKeepaApi(normalizedAsins, settings.domain_id);

  await logKeepaRequest('/refresh', asins.length, tokensNeeded, 'SUCCESS', tokensSpent, latencyMs);

  const expiresAt = new Date(Date.now() + settings.min_refresh_minutes * 60 * 1000);
  const results = [];
  const cacheUpserts = [];
  const validProducts = [];

  // Prepare batch data
  for (const product of (data.products || [])) {
    if (!product || !product.asin) continue;

    cacheUpserts.push({
      asin: product.asin,
      domain_id: settings.domain_id,
      payload_json: product,
      fetched_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString()
    });

    validProducts.push(product);

    results.push({
      asin: product.asin,
      title: product.title,
      metrics: extractKeepaMetrics(product),
      success: true
    });
  }

  // Batch upsert all cache entries at once
  if (cacheUpserts.length > 0) {
    const { error: cacheError } = await supabase.from('keepa_products_cache').upsert(cacheUpserts);
    if (cacheError) {
      console.error('Batch cache upsert error:', cacheError);
    }
  }

  // Store metrics in parallel for all valid products
  await Promise.all(validProducts.map(product => storeKeepaMetrics(product.asin, product)));

  return {
    refreshed: results.length,
    results,
    tokensSpent,
    tokensLeft,
  };
}

export default {
  // Main API functions
  getKeepaProduct,
  refreshKeepaProducts,

  // Settings & budget
  getKeepaSettings,
  canMakeRequest,

  // CSV parsing utilities
  latestPriceFromCsv,
  latestIntFromCsv,
  latestRatingFromCsv,
  extractKeepaMetrics,
  CSV_INDICES,

  // Cache stats
  getCacheStats,
  resetCacheStats,

  // Constants
  KEEPA_TOKENS_PER_PRODUCT,
};
