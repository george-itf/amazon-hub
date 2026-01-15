import express from 'express';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { getActiveDemandModel } from '../services/keepaDemandModel.js';
import { predictUnitsPerDayFromMetrics } from '../utils/demandModelMath.js';

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

/**
 * GET /dashboard/pulse
 * Pulse Ticker - Revenue and Estimated Profit metrics
 *
 * Revenue: sum of total_price_pence from orders
 * Estimated Profit: calculated from order_lines → listing_memory → boms
 *   - SKIP unresolved lines
 *   - DO NOT block dashboard on errors
 */
router.get('/pulse', async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.setHours(0, 0, 0, 0)).toISOString();
    const weekStart = new Date(now.setDate(now.getDate() - now.getDay())).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // Reset now for accurate queries
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekStr = weekAgo.toISOString().split('T')[0];
    const monthAgo = new Date(today);
    monthAgo.setDate(1);
    const monthStr = monthAgo.toISOString().split('T')[0];

    // Fetch Amazon orders for different time periods in parallel
    const [todayOrders, weekOrders, monthOrders] = await Promise.all([
      // Today's orders (Amazon only)
      supabase
        .from('orders')
        .select('id, total_price_pence')
        .eq('channel', 'AMAZON')
        .eq('order_date', todayStr)
        .not('status', 'eq', 'CANCELLED'),

      // This week's orders - last 7 days (Amazon only)
      supabase
        .from('orders')
        .select('id, total_price_pence')
        .eq('channel', 'AMAZON')
        .gte('order_date', weekStr)
        .not('status', 'eq', 'CANCELLED'),

      // This month's orders (Amazon only)
      supabase
        .from('orders')
        .select('id, total_price_pence')
        .eq('channel', 'AMAZON')
        .gte('order_date', monthStr)
        .not('status', 'eq', 'CANCELLED'),
    ]);

    // Calculate revenue
    const revenueToday = (todayOrders.data || []).reduce((sum, o) => sum + (o.total_price_pence || 0), 0);
    const revenueWeek = (weekOrders.data || []).reduce((sum, o) => sum + (o.total_price_pence || 0), 0);
    const revenueMonth = (monthOrders.data || []).reduce((sum, o) => sum + (o.total_price_pence || 0), 0);

    // Get order IDs for profit calculation
    const todayOrderIds = (todayOrders.data || []).map(o => o.id);
    const weekOrderIds = (weekOrders.data || []).map(o => o.id);
    const monthOrderIds = (monthOrders.data || []).map(o => o.id);

    // Calculate estimated profit (non-blocking)
    let profitToday = 0;
    let profitWeek = 0;
    let profitMonth = 0;

    try {
      // Fetch order lines with BOM cost data for all periods
      // We use month orders to get all relevant data in one query
      if (monthOrderIds.length > 0) {
        const { data: orderLines } = await supabase
          .from('order_lines')
          .select(`
            order_id,
            quantity,
            unit_price_pence,
            is_resolved,
            bom_id,
            boms (
              id,
              bom_components (
                qty_required,
                components (
                  cost_price_pence
                )
              )
            )
          `)
          .in('order_id', monthOrderIds)
          .eq('is_resolved', true);

        // Calculate profit for each line
        for (const line of orderLines || []) {
          if (!line.boms) continue;

          // Calculate BOM cost (sum of component costs × qty)
          let bomCostPence = 0;
          for (const bc of line.boms.bom_components || []) {
            const compCost = bc.components?.cost_price_pence || 0;
            bomCostPence += compCost * (bc.qty_required || 1);
          }

          // Line revenue and profit
          const lineRevenue = (line.unit_price_pence || 0) * (line.quantity || 1);
          // Estimate Amazon fees at 15%
          const estimatedFees = Math.round(lineRevenue * 0.15);
          const lineCost = bomCostPence * (line.quantity || 1);
          const lineProfit = lineRevenue - estimatedFees - lineCost;

          // Attribute to time periods
          if (todayOrderIds.includes(line.order_id)) {
            profitToday += lineProfit;
          }
          if (weekOrderIds.includes(line.order_id)) {
            profitWeek += lineProfit;
          }
          profitMonth += lineProfit;
        }
      }
    } catch (profitError) {
      // Non-blocking - log and continue with zero profit
      console.error('[Pulse] Profit calculation error:', profitError.message);
    }

    sendSuccess(res, {
      revenue: {
        today: revenueToday,
        week: revenueWeek,
        month: revenueMonth,
      },
      estimated_profit: {
        today: profitToday,
        week: profitWeek,
        month: profitMonth,
      },
      orders: {
        today: todayOrders.data?.length || 0,
        week: weekOrders.data?.length || 0,
        month: monthOrders.data?.length || 0,
      },
      as_of: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Pulse ticker error:', err);
    errors.internal(res, 'Failed to load pulse data');
  }
});

/**
 * GET /dashboard/stock-heatmap
 * Stock Heatmap - Days of Coverage by Component
 *
 * For each component:
 * - Find BOMs containing the component
 * - Find listings mapped to those BOMs
 * - Predict ASIN demand using Keepa demand model
 * - Convert to component demand (sum across listings × qty_required)
 * - Days of cover = on_hand / daily_demand
 * - Bucket: 0-7 (critical) / 7-14 (low) / 14-30 (medium) / 30+ (healthy)
 */
router.get('/stock-heatmap', async (req, res) => {
  try {
    // Get active demand model
    const model = await getActiveDemandModel();

    // Fetch all active components with stock
    const { data: components, error: compError } = await supabase
      .from('components')
      .select(`
        id,
        internal_sku,
        description,
        cost_price_pence,
        component_stock (
          on_hand,
          reserved,
          location
        )
      `)
      .eq('is_active', true)
      .order('internal_sku');

    if (compError) throw compError;

    // Fetch all bom_components to map component → BOMs
    const { data: bomComponents } = await supabase
      .from('bom_components')
      .select('component_id, bom_id, qty_required');

    // Fetch all active BOMs
    const { data: boms } = await supabase
      .from('boms')
      .select('id, bundle_sku')
      .eq('is_active', true);

    // Fetch listing_memory → BOM mappings
    const { data: listings } = await supabase
      .from('listing_memory')
      .select('id, asin, bom_id')
      .eq('is_active', true)
      .not('bom_id', 'is', null);

    // Fetch latest Keepa metrics for all relevant ASINs
    const relevantAsins = [...new Set((listings || []).map(l => l.asin).filter(Boolean))];
    let keepaMetrics = new Map();

    if (relevantAsins.length > 0) {
      // Get the latest metric per ASIN
      const { data: keepaData } = await supabase
        .from('keepa_metrics_daily')
        .select('asin, sales_rank, offer_count, buybox_price_pence')
        .in('asin', relevantAsins)
        .order('date', { ascending: false });

      // Dedupe to latest per ASIN
      for (const row of keepaData || []) {
        if (!keepaMetrics.has(row.asin)) {
          keepaMetrics.set(row.asin, row);
        }
      }
    }

    // Build component → BOMs → listings mapping
    const componentToBoms = new Map();
    for (const bc of bomComponents || []) {
      if (!componentToBoms.has(bc.component_id)) {
        componentToBoms.set(bc.component_id, []);
      }
      componentToBoms.get(bc.component_id).push({
        bom_id: bc.bom_id,
        qty_required: bc.qty_required || 1,
      });
    }

    const bomToListings = new Map();
    for (const listing of listings || []) {
      if (!bomToListings.has(listing.bom_id)) {
        bomToListings.set(listing.bom_id, []);
      }
      bomToListings.get(listing.bom_id).push(listing);
    }

    // Calculate days of coverage for each component
    const heatmapData = [];
    const buckets = {
      critical: [], // 0-7 days
      low: [],      // 7-14 days
      medium: [],   // 14-30 days
      healthy: [],  // 30+ days
    };

    for (const component of components || []) {
      // Calculate total on_hand across locations
      const totalOnHand = (component.component_stock || [])
        .reduce((sum, s) => sum + (s.on_hand || 0) - (s.reserved || 0), 0);

      // Calculate daily demand from all listings that use this component
      let dailyDemand = 0;
      const componentBoms = componentToBoms.get(component.id) || [];

      for (const { bom_id, qty_required } of componentBoms) {
        const bomListings = bomToListings.get(bom_id) || [];

        for (const listing of bomListings) {
          const keepa = keepaMetrics.get(listing.asin);
          if (!keepa || !model) {
            // Fallback: assume 0.1 units/day if no data
            dailyDemand += 0.1 * qty_required;
            continue;
          }

          // Predict demand using Keepa model
          const prediction = predictUnitsPerDayFromMetrics({
            salesRank: keepa.sales_rank,
            offerCount: keepa.offer_count,
            buyboxPricePence: keepa.buybox_price_pence,
            model,
          });

          const unitsPerDay = prediction.units_per_day_pred || 0.1;
          dailyDemand += unitsPerDay * qty_required;
        }
      }

      // Calculate days of coverage
      const daysOfCoverage = dailyDemand > 0.001
        ? Math.round(totalOnHand / dailyDemand)
        : totalOnHand > 0 ? 999 : 0;

      const item = {
        component_id: component.id,
        internal_sku: component.internal_sku,
        description: component.description,
        on_hand: totalOnHand,
        daily_demand: Math.round(dailyDemand * 100) / 100,
        days_of_coverage: daysOfCoverage,
        bucket: daysOfCoverage <= 7 ? 'critical'
          : daysOfCoverage <= 14 ? 'low'
          : daysOfCoverage <= 30 ? 'medium'
          : 'healthy',
      };

      heatmapData.push(item);

      // Add to bucket
      if (item.bucket === 'critical') buckets.critical.push(item);
      else if (item.bucket === 'low') buckets.low.push(item);
      else if (item.bucket === 'medium') buckets.medium.push(item);
      else buckets.healthy.push(item);
    }

    // Sort by days of coverage ascending (most critical first)
    heatmapData.sort((a, b) => a.days_of_coverage - b.days_of_coverage);

    sendSuccess(res, {
      components: heatmapData,
      buckets: {
        critical: buckets.critical.length,
        low: buckets.low.length,
        medium: buckets.medium.length,
        healthy: buckets.healthy.length,
      },
      summary: {
        total_components: heatmapData.length,
        out_of_stock: heatmapData.filter(c => c.on_hand === 0).length,
        critical_count: buckets.critical.length,
        model_available: !!model,
      },
      as_of: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Stock heatmap error:', err);
    errors.internal(res, 'Failed to load stock heatmap');
  }
});

export default router;
