/**
 * System Health Routes
 * Provides a unified view of system integrations and sync status
 */
import express from 'express';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { requireStaff } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /health/system
 * Returns aggregated system health data from event logs:
 * - Last Amazon sync time + success/fail counts
 * - Last Keepa refresh time + tokens used
 * - Last demand model trained_at
 * - Last Royal Mail batch outcome
 */
router.get('/system', requireStaff, async (req, res) => {
  const { days_back = 30 } = req.query;
  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - parseInt(days_back));
  const lookbackIso = lookbackDate.toISOString();

  try {
    // Run all queries in parallel for performance
    const [
      amazonSyncResult,
      keepaRefreshResult,
      demandModelResult,
      royalMailResult,
      amazonSyncCountsResult,
      keepaTotalsResult,
      royalMailTotalsResult,
    ] = await Promise.all([
      // Last Amazon sync event
      supabase
        .from('system_events')
        .select('created_at, metadata, severity, description')
        .eq('event_type', 'AMAZON_SYNC')
        .order('created_at', { ascending: false })
        .limit(1),

      // Last Keepa refresh event
      supabase
        .from('system_events')
        .select('created_at, metadata, severity, description')
        .eq('event_type', 'KEEPA_REFRESH')
        .order('created_at', { ascending: false })
        .limit(1),

      // Last demand model training from keepa_demand_model_runs
      supabase
        .from('keepa_demand_model_runs')
        .select('id, trained_at, model_name, metrics, training_summary, is_active')
        .eq('is_active', true)
        .order('trained_at', { ascending: false })
        .limit(1),

      // Last Royal Mail batch event
      supabase
        .from('system_events')
        .select('created_at, metadata, severity, description')
        .eq('event_type', 'ROYALMAIL_BATCH_CREATE')
        .order('created_at', { ascending: false })
        .limit(1),

      // Amazon sync counts (last N days)
      supabase
        .from('system_events')
        .select('severity, metadata')
        .eq('event_type', 'AMAZON_SYNC')
        .gte('created_at', lookbackIso),

      // Keepa totals (last N days)
      supabase
        .from('system_events')
        .select('metadata')
        .eq('event_type', 'KEEPA_REFRESH')
        .gte('created_at', lookbackIso),

      // Royal Mail batch totals (last N days)
      supabase
        .from('system_events')
        .select('metadata')
        .eq('event_type', 'ROYALMAIL_BATCH_CREATE')
        .gte('created_at', lookbackIso),
    ]);

    // Process Amazon sync data
    const lastAmazonSync = amazonSyncResult.data?.[0];
    let amazonSyncCounts = { success: 0, failed: 0, total_orders: 0, total_errors: 0 };
    for (const event of amazonSyncCountsResult.data || []) {
      if (event.severity === 'WARN' || event.severity === 'ERROR') {
        amazonSyncCounts.failed++;
      } else {
        amazonSyncCounts.success++;
      }
      amazonSyncCounts.total_orders += event.metadata?.total || 0;
      amazonSyncCounts.total_errors += event.metadata?.errors || 0;
    }

    // Process Keepa refresh data
    const lastKeepaRefresh = keepaRefreshResult.data?.[0];
    let keepaTotals = { requests: 0, tokens_spent: 0, asins_refreshed: 0 };
    for (const event of keepaTotalsResult.data || []) {
      keepaTotals.requests++;
      keepaTotals.tokens_spent += event.metadata?.tokens_spent || 0;
      keepaTotals.asins_refreshed += event.metadata?.asins_refreshed || 0;
    }

    // Process demand model data
    const lastDemandModel = demandModelResult.data?.[0];

    // Process Royal Mail batch data
    const lastRoyalMailBatch = royalMailResult.data?.[0];
    let royalMailTotals = { batches: 0, success: 0, failed: 0, total_cost_pence: 0 };
    for (const event of royalMailTotalsResult.data || []) {
      if (!event.metadata?.dry_run) {
        royalMailTotals.batches++;
        royalMailTotals.success += event.metadata?.success || 0;
        royalMailTotals.failed += event.metadata?.failed || 0;
        royalMailTotals.total_cost_pence += event.metadata?.total_cost_pence || 0;
      }
    }

    // Build response
    const response = {
      generated_at: new Date().toISOString(),
      lookback_days: parseInt(days_back),

      amazon_sync: {
        last_sync_at: lastAmazonSync?.created_at || null,
        last_status: lastAmazonSync?.severity === 'WARN' || lastAmazonSync?.severity === 'ERROR' ? 'failed' : 'success',
        last_result: lastAmazonSync?.metadata || null,
        last_description: lastAmazonSync?.description || null,
        period_stats: {
          success_count: amazonSyncCounts.success,
          failed_count: amazonSyncCounts.failed,
          total_orders_synced: amazonSyncCounts.total_orders,
          total_errors: amazonSyncCounts.total_errors,
        },
      },

      keepa_refresh: {
        last_refresh_at: lastKeepaRefresh?.created_at || null,
        last_tokens_spent: lastKeepaRefresh?.metadata?.tokens_spent || 0,
        last_asins_refreshed: lastKeepaRefresh?.metadata?.asins_refreshed || 0,
        last_description: lastKeepaRefresh?.description || null,
        period_stats: {
          total_requests: keepaTotals.requests,
          total_tokens_spent: keepaTotals.tokens_spent,
          total_asins_refreshed: keepaTotals.asins_refreshed,
        },
      },

      demand_model: {
        trained_at: lastDemandModel?.trained_at || null,
        model_name: lastDemandModel?.model_name || null,
        is_active: lastDemandModel?.is_active || false,
        metrics: lastDemandModel?.metrics || null,
        training_summary: lastDemandModel?.training_summary || null,
      },

      royal_mail: {
        last_batch_at: lastRoyalMailBatch?.created_at || null,
        last_batch_dry_run: lastRoyalMailBatch?.metadata?.dry_run || false,
        last_batch_success: lastRoyalMailBatch?.metadata?.success || 0,
        last_batch_failed: lastRoyalMailBatch?.metadata?.failed || 0,
        last_batch_cost_pence: lastRoyalMailBatch?.metadata?.total_cost_pence || 0,
        last_description: lastRoyalMailBatch?.description || null,
        period_stats: {
          total_batches: royalMailTotals.batches,
          total_labels_success: royalMailTotals.success,
          total_labels_failed: royalMailTotals.failed,
          total_cost_pence: royalMailTotals.total_cost_pence,
        },
      },
    };

    sendSuccess(res, response);
  } catch (err) {
    console.error('Failed to fetch system health:', err);
    errors.internal(res, 'Failed to fetch system health');
  }
});

/**
 * GET /health/events
 * Get recent system events for the timeline view
 */
router.get('/events', requireStaff, async (req, res) => {
  const { limit = 50, event_type, severity } = req.query;

  try {
    let query = supabase
      .from('system_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Math.min(parseInt(limit) || 50, 200));

    if (event_type) {
      query = query.eq('event_type', event_type);
    }
    if (severity) {
      query = query.eq('severity', severity);
    }

    const { data, error } = await query;

    if (error) throw error;

    sendSuccess(res, {
      count: data.length,
      events: data,
    });
  } catch (err) {
    console.error('Failed to fetch system events:', err);
    errors.internal(res, 'Failed to fetch system events');
  }
});

export default router;
