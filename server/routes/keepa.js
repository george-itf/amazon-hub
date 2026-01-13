import express from 'express';
import fetch from 'node-fetch';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { requireAdmin } from '../middleware/auth.js';
import { recordSystemEvent } from '../services/audit.js';

const router = express.Router();

// Keepa API configuration
const KEEPA_API_BASE = 'https://api.keepa.com';
const KEEPA_TOKENS_PER_PRODUCT = 1;

/**
 * Get Keepa settings from database
 */
async function getKeepaSettings() {
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
      domain_id: 3
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
async function canMakeRequest(tokensNeeded, settings) {
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

/**
 * Log a Keepa request
 */
async function logKeepaRequest(endpoint, asinsCount, tokensEstimated, status, tokensSpent = null, latencyMs = null, errorMessage = null) {
  await supabase.from('keepa_request_log').insert({
    endpoint,
    asins_count: asinsCount,
    tokens_estimated: tokensEstimated,
    tokens_spent: tokensSpent,
    status,
    latency_ms: latencyMs,
    error_message: errorMessage
  });
}

/**
 * Fetch product from Keepa API
 */
async function fetchFromKeepa(asins, domainId) {
  const apiKey = process.env.KEEPA_API_KEY;
  if (!apiKey) {
    throw new Error('KEEPA_API_KEY not configured');
  }

  const asinList = Array.isArray(asins) ? asins.join(',') : asins;
  const url = `${KEEPA_API_BASE}/product?key=${apiKey}&domain=${domainId}&asin=${asinList}`;

  const startTime = Date.now();
  const response = await fetch(url);
  const latencyMs = Date.now() - startTime;

  if (!response.ok) {
    throw new Error(`Keepa API error: ${response.status}`);
  }

  const data = await response.json();
  return { data, latencyMs, tokensSpent: data.tokensConsumed || asins.length };
}

/**
 * GET /keepa/product/:asin
 * Get cached product data, refresh if stale and budget allows
 */
router.get('/product/:asin', async (req, res) => {
  const { asin } = req.params;
  const { force_refresh = 'false' } = req.query;

  try {
    const settings = await getKeepaSettings();

    // Check cache first
    if (force_refresh !== 'true') {
      const { data: cached, error } = await supabase
        .from('keepa_products_cache')
        .select('*')
        .eq('asin', asin.toUpperCase())
        .single();

      if (!error && cached && new Date(cached.expires_at) > new Date()) {
        return sendSuccess(res, {
          asin: cached.asin,
          data: cached.payload_json,
          fetched_at: cached.fetched_at,
          expires_at: cached.expires_at,
          from_cache: true
        });
      }
    }

    // Check if API key is configured
    if (!process.env.KEEPA_API_KEY) {
      return errors.badRequest(res, 'Keepa API not configured');
    }

    // Check budget
    const budgetCheck = await canMakeRequest(KEEPA_TOKENS_PER_PRODUCT, settings);
    if (!budgetCheck.allowed) {
      return errors.badRequest(res, 'Keepa token budget exceeded', {
        reason: budgetCheck.reason,
        remaining: budgetCheck.remaining
      });
    }

    // Fetch from Keepa
    try {
      const { data, latencyMs, tokensSpent } = await fetchFromKeepa([asin.toUpperCase()], settings.domain_id);

      await logKeepaRequest('/product', 1, KEEPA_TOKENS_PER_PRODUCT, 'SUCCESS', tokensSpent, latencyMs);

      if (!data.products || data.products.length === 0) {
        return errors.notFound(res, 'Product');
      }

      const product = data.products[0];
      const expiresAt = new Date(Date.now() + settings.min_refresh_minutes * 60 * 1000);

      // Cache the result
      await supabase.from('keepa_products_cache').upsert({
        asin: asin.toUpperCase(),
        domain_id: settings.domain_id,
        payload_json: product,
        fetched_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString()
      });

      // Extract and store daily metrics if available
      await storeKeepaMetrics(asin.toUpperCase(), product);

      sendSuccess(res, {
        asin: asin.toUpperCase(),
        data: product,
        fetched_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        from_cache: false,
        tokens_spent: tokensSpent
      });
    } catch (fetchError) {
      await logKeepaRequest('/product', 1, KEEPA_TOKENS_PER_PRODUCT, 'FAILED', null, null, fetchError.message);
      throw fetchError;
    }
  } catch (err) {
    console.error('Keepa product error:', err);
    errors.internal(res, 'Failed to fetch Keepa data');
  }
});

/**
 * POST /keepa/refresh
 * Refresh data for multiple ASINs
 * ADMIN only, budgeted
 */
router.post('/refresh', requireAdmin, async (req, res) => {
  const { asins } = req.body;

  if (!asins || !Array.isArray(asins) || asins.length === 0) {
    return errors.badRequest(res, 'asins array is required');
  }

  if (asins.length > 100) {
    return errors.badRequest(res, 'Maximum 100 ASINs per request');
  }

  try {
    if (!process.env.KEEPA_API_KEY) {
      return errors.badRequest(res, 'Keepa API not configured');
    }

    const settings = await getKeepaSettings();
    const tokensNeeded = asins.length * KEEPA_TOKENS_PER_PRODUCT;

    // Check budget
    const budgetCheck = await canMakeRequest(tokensNeeded, settings);
    if (!budgetCheck.allowed) {
      await logKeepaRequest('/refresh', asins.length, tokensNeeded, 'BUDGET_EXCEEDED');
      return errors.badRequest(res, 'Keepa token budget exceeded', {
        reason: budgetCheck.reason,
        remaining: budgetCheck.remaining,
        tokens_needed: tokensNeeded
      });
    }

    // Fetch from Keepa
    const normalizedAsins = asins.map(a => a.toUpperCase());
    const { data, latencyMs, tokensSpent } = await fetchFromKeepa(normalizedAsins, settings.domain_id);

    await logKeepaRequest('/refresh', asins.length, tokensNeeded, 'SUCCESS', tokensSpent, latencyMs);

    const expiresAt = new Date(Date.now() + settings.min_refresh_minutes * 60 * 1000);
    const results = [];

    for (const product of (data.products || [])) {
      if (!product || !product.asin) continue;

      await supabase.from('keepa_products_cache').upsert({
        asin: product.asin,
        domain_id: settings.domain_id,
        payload_json: product,
        fetched_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString()
      });

      await storeKeepaMetrics(product.asin, product);

      results.push({
        asin: product.asin,
        title: product.title,
        success: true
      });
    }

    await recordSystemEvent({
      eventType: 'KEEPA_REFRESH',
      description: `Refreshed ${results.length} products`,
      metadata: { asins_requested: asins.length, asins_refreshed: results.length, tokens_spent: tokensSpent }
    });

    sendSuccess(res, {
      refreshed: results.length,
      tokens_spent: tokensSpent,
      results
    });
  } catch (err) {
    console.error('Keepa refresh error:', err);
    errors.internal(res, 'Failed to refresh Keepa data');
  }
});

/**
 * GET /keepa/metrics/:asin
 * Get historical metrics for an ASIN
 */
router.get('/metrics/:asin', async (req, res) => {
  const { asin } = req.params;
  const { range = '90' } = req.query; // days

  try {
    const since = new Date(Date.now() - parseInt(range) * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('keepa_metrics_daily')
      .select('*')
      .eq('asin', asin.toUpperCase())
      .gte('date', since.split('T')[0])
      .order('date', { ascending: true });

    if (error) {
      console.error('Keepa metrics error:', error);
      return errors.internal(res, 'Failed to fetch metrics');
    }

    sendSuccess(res, {
      asin: asin.toUpperCase(),
      range_days: parseInt(range),
      metrics: data || []
    });
  } catch (err) {
    console.error('Keepa metrics error:', err);
    errors.internal(res, 'Failed to fetch metrics');
  }
});

/**
 * GET /keepa/status
 * Get Keepa integration status (no secrets)
 */
router.get('/status', async (req, res) => {
  try {
    const settings = await getKeepaSettings();

    const tokensSpentHour = await getTokensSpent(60);
    const tokensSpentDay = await getTokensSpent(24 * 60);

    // Get cache stats
    const { count: cacheCount } = await supabase
      .from('keepa_products_cache')
      .select('*', { count: 'exact', head: true });

    const { count: staleCount } = await supabase
      .from('keepa_products_cache')
      .select('*', { count: 'exact', head: true })
      .lt('expires_at', new Date().toISOString());

    // Get last successful request
    const { data: lastRequest } = await supabase
      .from('keepa_request_log')
      .select('requested_at, endpoint, tokens_spent')
      .eq('status', 'SUCCESS')
      .order('requested_at', { ascending: false })
      .limit(1);

    sendSuccess(res, {
      configured: !!process.env.KEEPA_API_KEY,
      domain_id: settings.domain_id,
      budget: {
        max_tokens_per_hour: settings.max_tokens_per_hour,
        max_tokens_per_day: settings.max_tokens_per_day,
        min_reserve: settings.min_reserve,
        tokens_spent_hour: tokensSpentHour,
        tokens_spent_day: tokensSpentDay,
        tokens_remaining_hour: settings.max_tokens_per_hour - tokensSpentHour,
        tokens_remaining_day: settings.max_tokens_per_day - tokensSpentDay
      },
      cache: {
        total_products: cacheCount || 0,
        stale_products: staleCount || 0,
        min_refresh_minutes: settings.min_refresh_minutes
      },
      last_request: lastRequest?.[0] || null
    });
  } catch (err) {
    console.error('Keepa status error:', err);
    errors.internal(res, 'Failed to fetch Keepa status');
  }
});

/**
 * PUT /keepa/settings
 * Update Keepa settings
 * ADMIN only
 */
router.put('/settings', requireAdmin, async (req, res) => {
  const { max_tokens_per_hour, max_tokens_per_day, min_reserve, min_refresh_minutes, domain_id } = req.body;

  try {
    const updates = [];

    if (max_tokens_per_hour !== undefined) {
      updates.push({ setting_key: 'max_tokens_per_hour', setting_value: max_tokens_per_hour.toString() });
    }
    if (max_tokens_per_day !== undefined) {
      updates.push({ setting_key: 'max_tokens_per_day', setting_value: max_tokens_per_day.toString() });
    }
    if (min_reserve !== undefined) {
      updates.push({ setting_key: 'min_reserve', setting_value: min_reserve.toString() });
    }
    if (min_refresh_minutes !== undefined) {
      updates.push({ setting_key: 'min_refresh_minutes', setting_value: min_refresh_minutes.toString() });
    }
    if (domain_id !== undefined) {
      updates.push({ setting_key: 'domain_id', setting_value: domain_id.toString() });
    }

    for (const update of updates) {
      await supabase.from('keepa_settings').upsert(update);
    }

    const newSettings = await getKeepaSettings();
    sendSuccess(res, newSettings);
  } catch (err) {
    console.error('Keepa settings update error:', err);
    errors.internal(res, 'Failed to update Keepa settings');
  }
});

/**
 * Helper: Store Keepa metrics from product data
 */
async function storeKeepaMetrics(asin, product) {
  try {
    if (!product.csv) return;

    const today = new Date().toISOString().split('T')[0];

    // Extract current metrics from Keepa CSV data
    // Keepa stores prices in their proprietary format (cents * 100)
    const metrics = {
      asin,
      date: today,
      buybox_price_pence: extractLatestPrice(product.csv[0]),
      amazon_price_pence: extractLatestPrice(product.csv[1]),
      new_price_pence: extractLatestPrice(product.csv[2]),
      used_price_pence: extractLatestPrice(product.csv[3]),
      sales_rank: extractLatestValue(product.csv[4]),
      offer_count: extractLatestValue(product.csv[11]),
      rating: product.lastRatingUpdate ? product.csv[16]?.[product.csv[16].length - 1] / 10 : null,
      review_count: extractLatestValue(product.csv[17])
    };

    await supabase.from('keepa_metrics_daily').upsert(metrics);
  } catch (err) {
    console.error('Failed to store Keepa metrics:', err);
  }
}

/**
 * Helper: Extract latest price from Keepa CSV array
 */
function extractLatestPrice(csvArray) {
  if (!csvArray || csvArray.length < 2) return null;
  const value = csvArray[csvArray.length - 1];
  if (value === -1 || value === -2) return null;
  // Keepa prices are in cents, convert to pence (assuming 1:1 for UK)
  return value;
}

/**
 * Helper: Extract latest value from Keepa CSV array
 */
function extractLatestValue(csvArray) {
  if (!csvArray || csvArray.length < 2) return null;
  const value = csvArray[csvArray.length - 1];
  if (value === -1 || value === -2) return null;
  return value;
}

export default router;
