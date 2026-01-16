import express from 'express';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { recordSystemEvent } from '../services/audit.js';
import {
  getKeepaProduct,
  refreshKeepaProducts,
  getKeepaSettings,
  canMakeRequest,
  getCacheStats,
  resetCacheStats,
  KEEPA_TOKENS_PER_PRODUCT,
} from '../services/keepaService.js';

const router = express.Router();

/**
 * Get tokens spent in time window (kept for status endpoint)
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
 * GET /keepa/product/:asin
 * Get cached product data, refresh if stale and budget allows
 * Uses shared Keepa service for budget enforcement, caching, and logging
 */
router.get('/product/:asin', async (req, res) => {
  const { asin } = req.params;
  const { force_refresh = 'false' } = req.query;

  try {
    const result = await getKeepaProduct(asin, {
      forceRefresh: force_refresh === 'true',
    });

    sendSuccess(res, {
      asin: result.asin,
      data: result.product,
      metrics: result.metrics,
      fetched_at: result.fetched_at,
      expires_at: result.expires_at,
      from_cache: result.fromCache,
      tokens_spent: result.tokensSpent,
      tokens_left: result.tokensLeft,
    });
  } catch (err) {
    console.error('Keepa product error:', err);

    if (err.code === 'NOT_FOUND') {
      return errors.notFound(res, 'Product');
    }
    if (err.code === 'HOURLY_BUDGET_EXCEEDED' || err.code === 'DAILY_BUDGET_EXCEEDED') {
      return errors.badRequest(res, 'Keepa token budget exceeded', {
        reason: err.code,
        remaining: err.remaining
      });
    }
    if (err.message === 'KEEPA_API_KEY not configured') {
      return errors.badRequest(res, 'Keepa API not configured');
    }

    errors.internal(res, 'Failed to fetch Keepa data');
  }
});

/**
 * POST /keepa/refresh
 * Refresh data for multiple ASINs
 * ADMIN only, budgeted
 * Uses shared Keepa service for budget enforcement, caching, and logging
 */
router.post('/refresh', async (req, res) => {
  const { asins } = req.body;

  if (!asins || !Array.isArray(asins) || asins.length === 0) {
    return errors.badRequest(res, 'asins array is required');
  }

  try {
    const result = await refreshKeepaProducts(asins);

    await recordSystemEvent({
      eventType: 'KEEPA_REFRESH',
      description: `Refreshed ${result.refreshed} products`,
      metadata: {
        asins_requested: asins.length,
        asins_refreshed: result.refreshed,
        tokens_spent: result.tokensSpent
      }
    });

    sendSuccess(res, {
      refreshed: result.refreshed,
      tokens_spent: result.tokensSpent,
      tokens_left: result.tokensLeft,
      results: result.results
    });
  } catch (err) {
    console.error('Keepa refresh error:', err);

    if (err.message === 'Maximum 100 ASINs per request') {
      return errors.badRequest(res, err.message);
    }
    if (err.code === 'HOURLY_BUDGET_EXCEEDED' || err.code === 'DAILY_BUDGET_EXCEEDED') {
      return errors.badRequest(res, 'Keepa token budget exceeded', {
        reason: err.code,
        remaining: err.remaining,
        tokens_needed: err.tokens_needed
      });
    }
    if (err.message === 'KEEPA_API_KEY not configured') {
      return errors.badRequest(res, 'Keepa API not configured');
    }

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
 * Includes actual Keepa account balance from API responses
 * Includes cache hit/miss tracking metrics
 */
router.get('/status', async (req, res) => {
  try {
    const settings = await getKeepaSettings();

    const tokensSpentHour = await getTokensSpent(60);
    const tokensSpentDay = await getTokensSpent(24 * 60);

    // Get cache stats from database
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

    // Get latest Keepa account balance from API responses
    const { data: latestBalance } = await supabase
      .from('keepa_account_balance')
      .select('*')
      .order('recorded_at', { ascending: false })
      .limit(1);

    const accountBalance = latestBalance?.[0] || null;

    // Get in-memory cache hit/miss stats
    const cacheHitStats = getCacheStats();

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
      // Actual Keepa account balance from API responses
      account: accountBalance ? {
        tokens_left: accountBalance.tokens_left,
        refill_rate: accountBalance.refill_rate,
        refill_in_ms: accountBalance.refill_in_ms,
        token_flow_reduction: accountBalance.token_flow_reduction,
        last_updated: accountBalance.recorded_at,
      } : null,
      cache: {
        total_products: cacheCount || 0,
        stale_products: staleCount || 0,
        min_refresh_minutes: settings.min_refresh_minutes,
        // In-memory cache hit/miss tracking
        session_hits: cacheHitStats.hits,
        session_misses: cacheHitStats.misses,
        session_hit_rate: cacheHitStats.hitRate,
        session_hours: parseFloat(cacheHitStats.hoursSinceReset),
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
router.put('/settings', async (req, res) => {
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

    // Batch upsert all settings at once instead of sequential upserts
    if (updates.length > 0) {
      const { error: updateError } = await supabase.from('keepa_settings').upsert(updates);
      if (updateError) {
        console.error('Settings batch upsert error:', updateError);
        return errors.internal(res, 'Failed to update some settings');
      }
    }

    const newSettings = await getKeepaSettings();
    sendSuccess(res, newSettings);
  } catch (err) {
    console.error('Keepa settings update error:', err);
    errors.internal(res, 'Failed to update Keepa settings');
  }
});

/**
 * POST /keepa/cache/reset-stats
 * Reset cache hit/miss statistics (ADMIN only)
 */
router.post('/cache/reset-stats', async (req, res) => {
  try {
    resetCacheStats();
    sendSuccess(res, { message: 'Cache statistics reset successfully' });
  } catch (err) {
    console.error('Cache stats reset error:', err);
    errors.internal(res, 'Failed to reset cache statistics');
  }
});

/**
 * POST /keepa/cleanup
 * Run data cleanup for Keepa tables (ADMIN only)
 * Removes old request_log (30 days), account_balance (7 days), and stale cache
 */
router.post('/cleanup', async (req, res) => {
  try {
    const results = {};

    // Get cleanup retention settings
    const settings = await getKeepaSettings();
    const requestLogDays = parseInt(settings.cleanup_request_log_days) || 30;
    const accountBalanceDays = parseInt(settings.cleanup_account_balance_days) || 7;
    const staleCacheDays = parseInt(settings.cleanup_stale_cache_days) || 7;

    // Clean request logs
    const requestLogCutoff = new Date(Date.now() - requestLogDays * 24 * 60 * 60 * 1000).toISOString();
    const { error: requestLogError, count: requestLogCount } = await supabase
      .from('keepa_request_log')
      .delete({ count: 'exact' })
      .lt('requested_at', requestLogCutoff);

    if (requestLogError) {
      console.error('Request log cleanup error:', requestLogError);
      results.request_log = { error: requestLogError.message };
    } else {
      results.request_log = { deleted: requestLogCount || 0, retention_days: requestLogDays };
    }

    // Clean account balance
    const accountBalanceCutoff = new Date(Date.now() - accountBalanceDays * 24 * 60 * 60 * 1000).toISOString();
    const { error: accountBalanceError, count: accountBalanceCount } = await supabase
      .from('keepa_account_balance')
      .delete({ count: 'exact' })
      .lt('recorded_at', accountBalanceCutoff);

    if (accountBalanceError) {
      console.error('Account balance cleanup error:', accountBalanceError);
      results.account_balance = { error: accountBalanceError.message };
    } else {
      results.account_balance = { deleted: accountBalanceCount || 0, retention_days: accountBalanceDays };
    }

    // Clean stale cache entries
    const staleCacheCutoff = new Date(Date.now() - staleCacheDays * 24 * 60 * 60 * 1000).toISOString();
    const { error: staleCacheError, count: staleCacheCount } = await supabase
      .from('keepa_products_cache')
      .delete({ count: 'exact' })
      .lt('expires_at', staleCacheCutoff);

    if (staleCacheError) {
      console.error('Stale cache cleanup error:', staleCacheError);
      results.stale_cache = { error: staleCacheError.message };
    } else {
      results.stale_cache = { deleted: staleCacheCount || 0, retention_days: staleCacheDays };
    }

    await recordSystemEvent({
      eventType: 'KEEPA_CLEANUP',
      description: 'Data cleanup completed',
      metadata: results
    });

    sendSuccess(res, {
      message: 'Cleanup completed',
      results
    });
  } catch (err) {
    console.error('Keepa cleanup error:', err);
    errors.internal(res, 'Failed to run cleanup');
  }
});

export default router;
