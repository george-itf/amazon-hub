import express from 'express';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';

const router = express.Router();

/**
 * GET /dashboard
 * Returns all data needed for the homepage ops command center
 */
router.get('/', async (req, res) => {
  try {
    // Execute all queries in parallel for performance
    const [
      constraintsResult,
      reviewResult,
      pickBatchResult,
      returnsResult,
      ordersResult,
      systemHealthResult
    ] = await Promise.all([
      // Get constraint intelligence
      supabase.rpc('rpc_get_constraints'),

      // Get review queue summary
      supabase
        .from('review_queue')
        .select('id, asin, sku, title, created_at')
        .eq('status', 'PENDING')
        .order('created_at', { ascending: false })
        .limit(5),

      // Get pick batch snapshot (today)
      supabase
        .from('pick_batches')
        .select('id, batch_number, status, created_at')
        .gte('created_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
        .order('created_at', { ascending: false }),

      // Get returns in quarantine (awaiting inspection or processing)
      supabase
        .from('returns')
        .select('id, return_number, status, created_at')
        .in('status', ['RECEIVED', 'INSPECTED'])
        .order('created_at', { ascending: false }),

      // Get order counts by status
      supabase
        .from('orders')
        .select('status'),

      // Get system health data
      Promise.all([
        // Last Shopify import
        supabase
          .from('system_events')
          .select('created_at')
          .eq('event_type', 'SHOPIFY_IMPORT')
          .order('created_at', { ascending: false })
          .limit(1),

        // Keepa tokens spent today
        supabase
          .from('keepa_request_log')
          .select('tokens_spent')
          .gte('requested_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
          .eq('status', 'SUCCESS'),

        // DB connection check (simple query)
        supabase.from('components').select('id', { count: 'exact', head: true })
      ])
    ]);

    // Process constraints
    let constraints = [];
    if (constraintsResult.data?.ok) {
      constraints = constraintsResult.data.data || [];
    }

    // Process review queue
    const reviewQueue = reviewResult.data || [];
    const reviewCount = await supabase
      .from('review_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'PENDING');

    const oldestReview = reviewQueue.length > 0 ? reviewQueue[reviewQueue.length - 1] : null;
    const oldestReviewAge = oldestReview
      ? Math.floor((Date.now() - new Date(oldestReview.created_at).getTime()) / (1000 * 60 * 60))
      : 0;

    // Process pick batches
    const pickBatches = pickBatchResult.data || [];
    const pickBatchSummary = {
      draft: pickBatches.filter(pb => pb.status === 'DRAFT').length,
      reserved: pickBatches.filter(pb => pb.status === 'RESERVED').length,
      confirmed: pickBatches.filter(pb => pb.status === 'CONFIRMED').length,
      recent: pickBatches.slice(0, 5)
    };

    // Process returns
    const returns = returnsResult.data || [];
    const returnsSummary = {
      awaiting_inspection: returns.filter(r => r.status === 'RECEIVED').length,
      awaiting_processing: returns.filter(r => r.status === 'INSPECTED').length,
      recent: returns.slice(0, 5)
    };

    // Process order counts
    const orderCounts = {
      imported: 0,
      needs_review: 0,
      ready_to_pick: 0,
      picked: 0,
      total: 0
    };
    (ordersResult.data || []).forEach(order => {
      orderCounts.total++;
      if (order.status === 'IMPORTED') orderCounts.imported++;
      if (order.status === 'NEEDS_REVIEW') orderCounts.needs_review++;
      if (order.status === 'READY_TO_PICK') orderCounts.ready_to_pick++;
      if (order.status === 'PICKED') orderCounts.picked++;
    });

    // Process system health
    const [lastImportResult, keepaTokensResult, dbCheck] = systemHealthResult;
    const keepaTokensSpent = (keepaTokensResult.data || [])
      .reduce((sum, r) => sum + (r.tokens_spent || 0), 0);

    const systemHealth = {
      last_shopify_import: lastImportResult.data?.[0]?.created_at || null,
      keepa_tokens_spent_today: keepaTokensSpent,
      db_connected: !dbCheck.error
    };

    // Determine critical state banner
    const ordersBlockedByStock = constraints
      .filter(c => c.severity === 'CRITICAL' || c.severity === 'HIGH')
      .reduce((sum, c) => sum + (c.orders_affected || 0), 0);

    let criticalBanner;
    if (ordersBlockedByStock > 0) {
      criticalBanner = {
        severity: 'RED',
        message: `${ordersBlockedByStock} order(s) blocked by stock constraints`,
        action_url: '/intelligence/constraints'
      };
    } else if ((reviewCount.count || 0) > 0) {
      criticalBanner = {
        severity: 'AMBER',
        message: `${reviewCount.count} item(s) in review queue`,
        action_url: '/review'
      };
    } else {
      criticalBanner = {
        severity: 'GREEN',
        message: 'All orders are pickable',
        action_url: '/pick-batches'
      };
    }

    sendSuccess(res, {
      critical_banner: criticalBanner,
      constraints: constraints.sort((a, b) => {
        // Sort by severity then by orders blocked
        const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
        const aSev = severityOrder[a.severity] ?? 4;
        const bSev = severityOrder[b.severity] ?? 4;
        if (aSev !== bSev) return aSev - bSev;
        return (b.orders_affected || 0) - (a.orders_affected || 0);
      }),
      review_queue: {
        count: reviewCount.count || 0,
        oldest_age_hours: oldestReviewAge,
        recent: reviewQueue.slice(0, 3)
      },
      pick_batches: pickBatchSummary,
      returns: returnsSummary,
      orders: orderCounts,
      system_health: systemHealth
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    errors.internal(res, 'Failed to load dashboard data');
  }
});

/**
 * GET /dashboard/stats
 * Returns summary statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const [components, boms, listings, orders, review] = await Promise.all([
      supabase.from('components').select('*', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('boms').select('*', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('listing_memory').select('*', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('orders').select('*', { count: 'exact', head: true }),
      supabase.from('review_queue').select('*', { count: 'exact', head: true }).eq('status', 'PENDING')
    ]);

    sendSuccess(res, {
      components: components.count || 0,
      boms: boms.count || 0,
      listings: listings.count || 0,
      orders: orders.count || 0,
      review: review.count || 0
    });
  } catch (err) {
    console.error('Stats error:', err);
    errors.internal(res, 'Failed to load statistics');
  }
});

export default router;
