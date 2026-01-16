import express from 'express';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { buildAllocationPreview, getPoolCandidates } from '../services/allocationEngine.js';
import { requireAdmin, requireStaff } from '../middleware/auth.js';
import spApiClient from '../services/spApi.js';
import { recordSystemEvent } from '../services/audit.js';
import {
  getDemandModelSettings,
  getActiveDemandModel,
  trainDemandModelRun,
  predictUnitsPerDayForAsin,
} from '../services/keepaDemandModel.js';

const router = express.Router();

/**
 * GET /intelligence/constraints
 * Get constraint intelligence - components blocking orders
 */
router.get('/constraints', async (req, res) => {
  try {
    const result = await supabase.rpc('rpc_get_constraints');

    if (result.error) {
      console.error('Constraints RPC error:', result.error);
      return errors.internal(res, 'Failed to fetch constraints');
    }

    const rpcResult = result.data;
    if (!rpcResult.ok) {
      return errors.internal(res, rpcResult.error?.message || 'Failed to fetch constraints');
    }

    // Sort by severity and orders blocked
    const constraints = (rpcResult.data || []).sort((a, b) => {
      const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      const aSev = severityOrder[a.severity] ?? 4;
      const bSev = severityOrder[b.severity] ?? 4;
      if (aSev !== bSev) return aSev - bSev;
      return (b.orders_affected || 0) - (a.orders_affected || 0);
    });

    sendSuccess(res, {
      constraints,
      summary: {
        total_constraints: constraints.length,
        critical: constraints.filter(c => c.severity === 'CRITICAL').length,
        high: constraints.filter(c => c.severity === 'HIGH').length,
        medium: constraints.filter(c => c.severity === 'MEDIUM').length,
        low: constraints.filter(c => c.severity === 'LOW').length,
        total_orders_blocked: constraints.reduce((sum, c) => sum + (c.orders_affected || 0), 0)
      }
    });
  } catch (err) {
    console.error('Constraints error:', err);
    errors.internal(res, 'Failed to fetch constraints');
  }
});

/**
 * GET /intelligence/constraints/:componentId
 * Get detailed constraint info for a specific component
 */
router.get('/constraints/:componentId', async (req, res) => {
  const { componentId } = req.params;

  try {
    // OPTIMIZED: Get component info with stock in a single query
    const { data: component, error: componentError } = await supabase
      .from('components')
      .select(`
        *,
        component_stock (
          id,
          location,
          on_hand,
          reserved
        )
      `)
      .eq('id', componentId)
      .single();

    if (componentError) {
      if (componentError.code === 'PGRST116') {
        return errors.notFound(res, 'Component');
      }
      throw componentError;
    }

    // Extract stock from nested result
    const stock = component.component_stock || [];

    const totalOnHand = stock.reduce((sum, s) => sum + s.on_hand, 0);
    const totalReserved = stock.reduce((sum, s) => sum + s.reserved, 0);
    const totalAvailable = totalOnHand - totalReserved;

    // Get affected BOMs
    const { data: bomComponents, error: bomError } = await supabase
      .from('bom_components')
      .select(`
        qty_required,
        boms (
          id,
          bundle_sku,
          description
        )
      `)
      .eq('component_id', componentId);

    if (bomError) throw bomError;

    const affectedBoms = (bomComponents || []).map(bc => ({
      bom_id: bc.boms.id,
      bundle_sku: bc.boms.bundle_sku,
      description: bc.boms.description,
      qty_required: bc.qty_required,
      bundles_possible: Math.floor(totalAvailable / bc.qty_required)
    }));

    // Build lookup map for qty_required by bom_id
    const bomQtyMap = {};
    for (const bc of bomComponents || []) {
      bomQtyMap[bc.boms.id] = bc.qty_required;
    }

    // Get affected orders (fetch order_lines separately without FK hint to bom_components)
    const affectedBomIds = affectedBoms.map(b => b.bom_id);
    let affectedOrders = [];

    if (affectedBomIds.length > 0) {
      const { data: orderLinesData, error: ordersError } = await supabase
        .from('order_lines')
        .select(`
          id,
          quantity,
          bom_id,
          orders (
            id,
            external_order_id,
            status,
            customer_name
          )
        `)
        .in('bom_id', affectedBomIds);

      if (ordersError) throw ordersError;

      // Manually add qty_required from bomQtyMap
      affectedOrders = (orderLinesData || []).map(ol => ({
        ...ol,
        bom_components: { qty_required: bomQtyMap[ol.bom_id] || 0 }
      }));
    }

    // Calculate what "+1 unit" would unlock
    const ordersBlockedByThis = affectedOrders.filter(ol => {
      const needed = ol.bom_components.qty_required * ol.quantity;
      return totalAvailable < needed && ol.orders?.status !== 'PICKED';
    });

    // OPTIMIZED: Get Keepa price estimate with batched queries
    let blockedPoundsEstimate = null;

    if (affectedBomIds.length > 0 && ordersBlockedByThis.length > 0) {
      // Batch fetch listings with their keepa cache data
      const { data: listings } = await supabase
        .from('listing_memory')
        .select('asin, bom_id')
        .in('bom_id', affectedBomIds)
        .not('asin', 'is', null);

      if (listings && listings.length > 0) {
        const asins = [...new Set(listings.map(l => l.asin))];
        const { data: keepaData } = await supabase
          .from('keepa_products_cache')
          .select('asin, payload_json')
          .in('asin', asins);

        if (keepaData) {
          // Create a map for faster lookups
          const keepaMap = new Map(keepaData.map(k => [k.asin, k]));
          const listingMap = new Map(listings.map(l => [l.bom_id, l]));

          // Sum up blocked value based on buy box prices
          blockedPoundsEstimate = 0;
          for (const ol of ordersBlockedByThis) {
            const listing = listingMap.get(ol.bom_id);
            if (listing) {
              const keepa = keepaMap.get(listing.asin);
              if (keepa?.payload_json?.csv?.[0]) {
                const prices = keepa.payload_json.csv[0];
                const latestPrice = prices[prices.length - 1];
                if (latestPrice > 0) {
                  blockedPoundsEstimate += (latestPrice / 100) * ol.quantity;
                }
              }
            }
          }
        }
      }
    }

    sendSuccess(res, {
      component: {
        id: component.id,
        internal_sku: component.internal_sku,
        description: component.description,
        brand: component.brand
      },
      stock: {
        on_hand: totalOnHand,
        reserved: totalReserved,
        available: totalAvailable,
        by_location: stock || []
      },
      affected_boms: affectedBoms,
      orders_blocked: ordersBlockedByThis.length,
      blocked_pounds_estimate: blockedPoundsEstimate,
      unlock_analysis: {
        description: '+1 unit analysis',
        units_needed_to_unblock_next_order: ordersBlockedByThis.length > 0
          ? Math.min(...ordersBlockedByThis.map(ol =>
              (ol.bom_components.qty_required * ol.quantity) - totalAvailable
            ))
          : 0
      }
    });
  } catch (err) {
    console.error('Constraint detail error:', err);
    errors.internal(res, 'Failed to fetch constraint details');
  }
});

/**
 * GET /intelligence/bottlenecks
 * Alias for constraints with different grouping
 */
router.get('/bottlenecks', async (req, res) => {
  try {
    // Get all components that are in active BOMs
    const { data: bomComponents, error } = await supabase
      .from('bom_components')
      .select(`
        component_id,
        qty_required,
        boms!inner (
          id,
          bundle_sku,
          is_active
        ),
        components (
          id,
          internal_sku,
          description
        )
      `)
      .eq('boms.is_active', true);

    if (error) throw error;

    // Get stock for all these components
    const componentIds = [...new Set((bomComponents || []).map(bc => bc.component_id))];

    const { data: stock } = await supabase
      .from('component_stock')
      .select('*')
      .in('component_id', componentIds);

    // OPTIMIZED: Pre-compute available stock per component using a Map (O(n) instead of O(n²))
    const stockByComponent = new Map();
    for (const s of stock || []) {
      const current = stockByComponent.get(s.component_id) || 0;
      stockByComponent.set(s.component_id, current + (s.on_hand - s.reserved));
    }

    // Calculate bottleneck score for each component
    const bottlenecks = {};

    for (const bc of bomComponents || []) {
      // O(1) lookup instead of O(n) filter
      const available = stockByComponent.get(bc.component_id) || 0;
      const bundlesPossible = Math.floor(available / bc.qty_required);

      if (!bottlenecks[bc.component_id]) {
        bottlenecks[bc.component_id] = {
          component_id: bc.component_id,
          internal_sku: bc.components.internal_sku,
          description: bc.components.description,
          available,
          min_bundles_constrained: bundlesPossible,
          boms_affected: []
        };
      }

      bottlenecks[bc.component_id].boms_affected.push({
        bom_id: bc.boms.id,
        bundle_sku: bc.boms.bundle_sku,
        qty_required: bc.qty_required,
        bundles_possible: bundlesPossible
      });

      bottlenecks[bc.component_id].min_bundles_constrained = Math.min(
        bottlenecks[bc.component_id].min_bundles_constrained,
        bundlesPossible
      );
    }

    // Sort by most constraining (with deterministic tiebreaker)
    const sorted = Object.values(bottlenecks).sort((a, b) => {
      // Primary: lowest bundles possible first (most constraining)
      if (a.min_bundles_constrained !== b.min_bundles_constrained) {
        return a.min_bundles_constrained - b.min_bundles_constrained;
      }
      // Secondary: most BOMs affected first
      if (b.boms_affected.length !== a.boms_affected.length) {
        return b.boms_affected.length - a.boms_affected.length;
      }
      // Tertiary: deterministic tiebreaker by internal_sku for stable ordering
      return (a.internal_sku || '').localeCompare(b.internal_sku || '');
    });

    sendSuccess(res, {
      bottlenecks: sorted,
      summary: {
        total_components: sorted.length,
        zero_available: sorted.filter(b => b.available === 0).length,
        constraining_multiple_boms: sorted.filter(b => b.boms_affected.length > 1).length
      }
    });
  } catch (err) {
    console.error('Bottlenecks error:', err);
    errors.internal(res, 'Failed to fetch bottlenecks');
  }
});

/**
 * GET /intelligence/fulfillment-readiness
 * Overview of what can be fulfilled vs what's blocked
 */
router.get('/fulfillment-readiness', async (req, res) => {
  try {
    const { data: orders, error } = await supabase
      .from('orders')
      .select(`
        id,
        external_order_id,
        status,
        order_lines (
          id,
          quantity,
          is_resolved,
          bom_id
        )
      `)
      .in('status', ['IMPORTED', 'NEEDS_REVIEW', 'READY_TO_PICK']);

    if (error) throw error;

    const summary = {
      total_orders: orders?.length || 0,
      imported: 0,
      needs_review: 0,
      ready_to_pick: 0,
      blocked_by_stock: 0
    };

    for (const order of orders || []) {
      switch (order.status) {
        case 'IMPORTED':
          summary.imported++;
          break;
        case 'NEEDS_REVIEW':
          summary.needs_review++;
          break;
        case 'READY_TO_PICK':
          summary.ready_to_pick++;
          break;
      }
    }

    sendSuccess(res, summary);
  } catch (err) {
    console.error('Fulfillment readiness error:', err);
    errors.internal(res, 'Failed to fetch fulfillment readiness');
  }
});

// ============================================================================
// ALLOCATION ENGINE ROUTES
// ============================================================================

/**
 * GET /intelligence/allocation/pools
 * Get components that appear in multiple active BOMs (pool candidates)
 * These are shared components where allocation decisions matter
 *
 * Query params:
 * - location (default: 'Warehouse')
 * - min_boms (default: 2) - minimum number of BOMs to be considered a pool
 */
router.get('/allocation/pools', async (req, res) => {
  try {
    const location = req.query.location || 'Warehouse';
    const minBoms = parseInt(req.query.min_boms, 10) || 2;

    if (minBoms < 1) {
      return errors.badRequest(res, 'min_boms must be at least 1');
    }

    console.log(`[Allocation] Fetching pool candidates: location=${location}, min_boms=${minBoms}`);

    const pools = await getPoolCandidates(location, minBoms);

    sendSuccess(res, {
      location,
      min_boms: minBoms,
      pools,
      summary: {
        total_pools: pools.length,
        total_boms_covered: [...new Set(pools.flatMap(p => p.boms.map(b => b.bom_id)))].length,
        zero_available: pools.filter(p => p.available === 0).length,
      },
    });
  } catch (err) {
    console.error('Allocation pools error:', err);
    errors.internal(res, `Failed to fetch allocation pools: ${err.message}`);
  }
});

/**
 * GET /intelligence/allocation/preview
 * Build allocation preview for a specific pool component
 *
 * Query params:
 * - pool_component_id (required) - UUID of the shared component
 * - location (default: 'Warehouse')
 * - min_margin (default: 10) - minimum margin % to be eligible
 * - target_margin (default: 15) - target margin % for bonus multiplier
 * - buffer_units (default: 1) - units to hold back from allocation
 * - lookback_days (default: 30) - days to look back for ASP calculation
 */
router.get('/allocation/preview', async (req, res) => {
  try {
    const poolComponentId = req.query.pool_component_id;

    if (!poolComponentId) {
      return errors.badRequest(res, 'pool_component_id is required');
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(poolComponentId)) {
      return errors.badRequest(res, 'pool_component_id must be a valid UUID');
    }

    const location = req.query.location || 'Warehouse';
    const minMarginPercent = parseFloat(req.query.min_margin) || 10;
    const targetMarginPercent = parseFloat(req.query.target_margin) || 15;
    const bufferUnits = parseInt(req.query.buffer_units, 10) || 1;
    const lookbackDays = parseInt(req.query.lookback_days, 10) || 30;

    // Validate parameters
    if (minMarginPercent < 0 || minMarginPercent > 100) {
      return errors.badRequest(res, 'min_margin must be between 0 and 100');
    }
    if (targetMarginPercent < minMarginPercent) {
      return errors.badRequest(res, 'target_margin must be >= min_margin');
    }
    if (bufferUnits < 0) {
      return errors.badRequest(res, 'buffer_units must be >= 0');
    }

    console.log(`[Allocation] Building preview: component=${poolComponentId}, location=${location}, min_margin=${minMarginPercent}%, target=${targetMarginPercent}%, buffer=${bufferUnits}`);

    const result = await buildAllocationPreview({
      poolComponentId,
      location,
      lookbackDays,
      minMarginPercent,
      targetMarginPercent,
      bufferUnits,
    });

    // Add preview timestamp for staleness detection
    const generatedAt = new Date().toISOString();

    sendSuccess(res, {
      ...result,
      generated_at: generatedAt,
      constraints_applied: {
        min_margin_percent: minMarginPercent,
        target_margin_percent: targetMarginPercent,
        buffer_units: bufferUnits,
        location,
        priority_method: 'demand_score_with_margin_multiplier',
        allocation_method: 'unit_by_unit_greedy',
      },
    });
  } catch (err) {
    console.error('Allocation preview error:', err);

    if (err.message.includes('not found')) {
      return errors.notFound(res, 'Component');
    }

    errors.internal(res, `Failed to build allocation preview: ${err.message}`);
  }
});

/**
 * POST /intelligence/allocation/apply
 * Apply allocation preview to Amazon inventory via SP-API
 * ADMIN only, requires Idempotency-Key header
 *
 * Body:
 * - pool_component_id (required) - UUID of the shared component
 * - location (default: 'Warehouse')
 * - min_margin (default: 10)
 * - target_margin (default: 15)
 * - buffer_units (default: 1)
 * - dry_run (default: true) - If true, compute but don't apply
 */
router.post('/allocation/apply', requireAdmin, async (req, res) => {
  try {
    const {
      pool_component_id: poolComponentId,
      location = 'Warehouse',
      min_margin: minMargin = 10,
      target_margin: targetMargin = 15,
      buffer_units: bufferUnits = 1,
      dry_run: dryRun = true,
      preview_generated_at: previewGeneratedAt = null,
      force_apply: forceApply = false,
    } = req.body;

    // Validate required params
    if (!poolComponentId) {
      return errors.badRequest(res, 'pool_component_id is required');
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(poolComponentId)) {
      return errors.badRequest(res, 'pool_component_id must be a valid UUID');
    }

    // Check idempotency key for non-dry-run requests
    const idempotencyKey = req.headers['idempotency-key'];
    if (!dryRun && !idempotencyKey) {
      return errors.badRequest(res, 'Idempotency-Key header is required for non-dry-run requests');
    }

    // Check SP-API configuration
    if (!dryRun && !spApiClient.isConfigured()) {
      return errors.badRequest(res, 'Amazon SP-API is not configured');
    }

    // Staleness check: warn if preview is older than 5 minutes
    const STALENESS_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
    let stalenessWarning = null;

    if (previewGeneratedAt && !forceApply) {
      const previewTime = new Date(previewGeneratedAt).getTime();
      const now = Date.now();
      const ageMs = now - previewTime;

      if (ageMs > STALENESS_THRESHOLD_MS) {
        const ageMinutes = Math.round(ageMs / 60000);
        stalenessWarning = {
          message: `Preview is ${ageMinutes} minutes old. Data may have changed since preview was generated.`,
          preview_age_minutes: ageMinutes,
          recommendation: 'Refresh preview before applying, or set force_apply=true to proceed anyway.',
        };

        // If not forcing, return warning and don't apply
        if (!dryRun) {
          return sendSuccess(res, {
            warning: 'STALE_PREVIEW',
            ...stalenessWarning,
            action_required: 'Set force_apply=true to proceed, or refresh the preview first.',
          }, 200);
        }
      }
    }

    // Validate numeric params
    const minMarginPercent = parseFloat(minMargin);
    const targetMarginPercent = parseFloat(targetMargin);
    const bufferUnitsInt = parseInt(bufferUnits, 10);

    if (minMarginPercent < 0 || minMarginPercent > 100) {
      return errors.badRequest(res, 'min_margin must be between 0 and 100');
    }
    if (targetMarginPercent < minMarginPercent) {
      return errors.badRequest(res, 'target_margin must be >= min_margin');
    }
    if (bufferUnitsInt < 0) {
      return errors.badRequest(res, 'buffer_units must be >= 0');
    }

    console.log(`[Allocation Apply] Starting: component=${poolComponentId}, location=${location}, dry_run=${dryRun}`);

    // Step 0: Check for data drift - get current pool stock for comparison
    const { data: currentPoolStock } = await supabase
      .from('component_stock')
      .select('on_hand, reserved')
      .eq('component_id', poolComponentId)
      .eq('location', location)
      .maybeSingle();

    const currentPoolAvailable = Math.max(0, (currentPoolStock?.on_hand || 0) - (currentPoolStock?.reserved || 0));

    // Step 1: Recompute allocation preview (never trust client-passed allocations)
    const preview = await buildAllocationPreview({
      poolComponentId,
      location,
      lookbackDays: 30,
      minMarginPercent,
      targetMarginPercent,
      bufferUnits: bufferUnitsInt,
    });

    // Step 2: Prepare allocations to apply
    const allocationsToApply = preview.candidates
      .filter(c => c.recommended_qty > 0 && c.sku)
      .map(c => ({
        sku: c.sku,
        asin: c.asin,
        listing_memory_id: c.listing_memory_id,
        bundle_sku: c.bundle_sku,
        recommended_qty: c.recommended_qty,
        margin_percent: c.margin_percent,
        score: c.score,
      }));

    // Track skipped (no SKU)
    const skipped = preview.candidates.filter(c => c.recommended_qty > 0 && !c.sku);

    // Step 3: Apply to Amazon (unless dry_run)
    const results = {
      success: [],
      failed: [],
      skipped: skipped.map(c => ({
        listing_memory_id: c.listing_memory_id,
        asin: c.asin,
        reason: 'Missing seller SKU',
      })),
    };

    if (!dryRun) {
      // Sequential calls with small delay to avoid rate limiting
      const DELAY_MS = 200;

      for (const allocation of allocationsToApply) {
        try {
          await spApiClient.updateListingQuantity(allocation.sku, allocation.recommended_qty);

          results.success.push({
            sku: allocation.sku,
            asin: allocation.asin,
            quantity: allocation.recommended_qty,
          });

          console.log(`[Allocation Apply] Updated ${allocation.sku} to qty=${allocation.recommended_qty}`);

          // Small delay between calls
          if (allocationsToApply.indexOf(allocation) < allocationsToApply.length - 1) {
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
          }
        } catch (apiErr) {
          console.error(`[Allocation Apply] Failed to update ${allocation.sku}:`, apiErr.message);

          results.failed.push({
            sku: allocation.sku,
            asin: allocation.asin,
            quantity: allocation.recommended_qty,
            error: 'Failed to update Amazon listing',
          });
        }
      }
    } else {
      // Dry run - mark all as "would apply"
      for (const allocation of allocationsToApply) {
        results.success.push({
          sku: allocation.sku,
          asin: allocation.asin,
          quantity: allocation.recommended_qty,
          dry_run: true,
        });
      }
    }

    // Step 4: Record detailed audit trail entry
    const appliedAt = new Date().toISOString();
    const auditMetadata = {
      // Request parameters
      params: {
        pool_component_id: poolComponentId,
        location,
        min_margin: minMarginPercent,
        target_margin: targetMarginPercent,
        buffer_units: bufferUnitsInt,
      },
      // Execution context
      dry_run: dryRun,
      idempotency_key: idempotencyKey || null,
      force_apply: forceApply,
      preview_generated_at: previewGeneratedAt || null,
      applied_at: appliedAt,
      // Actor info
      actor: {
        user_id: req.user?.id || null,
        email: req.user?.email || null,
        role: req.user?.role || null,
      },
      // Pool state at apply time
      pool: {
        internal_sku: preview.pool.internal_sku,
        available: preview.pool.available,
        allocatable_units: preview.pool.allocatable_units,
        on_hand: preview.pool.on_hand,
        reserved: preview.pool.reserved,
      },
      // Detailed allocations (with before/after for rollback reference)
      allocations: allocationsToApply.map(a => ({
        sku: a.sku,
        asin: a.asin,
        bundle_sku: a.bundle_sku,
        listing_memory_id: a.listing_memory_id,
        quantity_allocated: a.recommended_qty,
        margin_percent: a.margin_percent,
        score: a.score,
      })),
      // Summary for quick reference
      results_summary: {
        success_count: results.success.length,
        failed_count: results.failed.length,
        skipped_count: results.skipped.length,
        total_units_allocated: allocationsToApply.reduce((sum, a) => sum + a.recommended_qty, 0),
        total_listings_affected: allocationsToApply.length,
      },
      // Constraints used (for explainability)
      constraints: {
        min_margin_percent: minMarginPercent,
        target_margin_percent: targetMarginPercent,
        buffer_units: bufferUnitsInt,
        priority_method: 'demand_score_with_margin_multiplier',
        allocation_method: 'unit_by_unit_greedy',
      },
    };

    await recordSystemEvent({
      eventType: 'AMAZON_INVENTORY_ALLOCATION_APPLIED',
      description: dryRun
        ? `Dry run: would allocate ${results.success.length} listings from pool ${preview.pool.internal_sku}`
        : `Applied allocation to ${results.success.length} Amazon listings from pool ${preview.pool.internal_sku} (${allocationsToApply.reduce((sum, a) => sum + a.recommended_qty, 0)} units)`,
      metadata: auditMetadata,
      severity: results.failed.length > 0 ? 'WARN' : 'INFO',
    });

    // Step 5: Return results with rollback guidance
    const rollbackGuidance = !dryRun && results.success.length > 0 ? {
      message: 'To undo this allocation, you can either: (1) Re-run allocation with different parameters, (2) Manually adjust quantities in Amazon Seller Central, or (3) Use the listing inventory page to set individual quantities.',
      affected_skus: results.success.map(s => s.sku),
      audit_reference: appliedAt,
    } : null;

    sendSuccess(res, {
      dry_run: dryRun,
      applied_at: appliedAt,
      pool: preview.pool,
      summary: {
        total_candidates: preview.candidates.length,
        eligible_for_apply: allocationsToApply.length,
        success_count: results.success.length,
        failed_count: results.failed.length,
        skipped_count: results.skipped.length,
        total_units_allocated: allocationsToApply.reduce((sum, a) => sum + a.recommended_qty, 0),
      },
      constraints_applied: {
        min_margin_percent: minMarginPercent,
        target_margin_percent: targetMarginPercent,
        buffer_units: bufferUnitsInt,
        location,
      },
      results,
      rollback_guidance: rollbackGuidance,
      staleness_warning: stalenessWarning,
    });
  } catch (err) {
    console.error('Allocation apply error:', err);

    if (err.message.includes('not found')) {
      return errors.notFound(res, 'Component');
    }

    errors.internal(res, 'Failed to apply allocation');
  }
});

// ============================================================================
// DEMAND MODEL ROUTES
// ============================================================================

/**
 * GET /intelligence/demand-model/status
 * Get active demand model status and metrics
 */
router.get('/demand-model/status', async (req, res) => {
  try {
    const settings = await getDemandModelSettings();
    const model = await getActiveDemandModel(settings.domainId);

    if (!model) {
      return sendSuccess(res, {
        active: false,
        settings: {
          enabled: settings.enabled,
          refresh_minutes: settings.refreshMinutes,
          lookback_days: settings.lookbackDays,
          min_asins: settings.minAsins,
          ridge_lambda: settings.ridgeLambda,
          domain_id: settings.domainId,
        },
        model: null,
      });
    }

    sendSuccess(res, {
      active: true,
      settings: {
        enabled: settings.enabled,
        refresh_minutes: settings.refreshMinutes,
        lookback_days: settings.lookbackDays,
        min_asins: settings.minAsins,
        ridge_lambda: settings.ridgeLambda,
        domain_id: settings.domainId,
      },
      model: {
        id: model.id,
        model_name: model.model_name,
        trained_at: model.trained_at,
        trained_from: model.trained_from,
        trained_to: model.trained_to,
        lookback_days: model.lookback_days,
        ridge_lambda: model.ridge_lambda,
        training_summary: model.training_summary,
        metrics: model.metrics,
        coefficients: model.coefficients,
        feature_names: model.feature_names,
      },
    });
  } catch (err) {
    console.error('Demand model status error:', err);
    errors.internal(res, 'Failed to fetch demand model status');
  }
});

/**
 * POST /intelligence/demand-model/train
 * Trigger demand model training (ADMIN only)
 *
 * Body (optional):
 * - lookback_days: number (default from settings)
 * - ridge_lambda: number (default from settings)
 */
router.post('/demand-model/train', requireAdmin, async (req, res) => {
  try {
    const settings = await getDemandModelSettings();

    const lookbackDays = req.body.lookback_days || settings.lookbackDays;
    const ridgeLambda = req.body.ridge_lambda || settings.ridgeLambda;

    console.log(`[API] Training demand model: lookback=${lookbackDays}, lambda=${ridgeLambda}`);

    const result = await trainDemandModelRun({
      domainId: settings.domainId,
      lookbackDays,
      ridgeLambda,
      minAsins: settings.minAsins,
    });

    sendSuccess(res, {
      success: true,
      message: 'Demand model trained successfully',
      model: result,
    });
  } catch (err) {
    console.error('Demand model training error:', err);

    if (err.message.includes('Insufficient')) {
      return errors.badRequest(res, err.message);
    }

    errors.internal(res, `Failed to train demand model: ${err.message}`);
  }
});

/**
 * GET /intelligence/demand-model/predict
 * Get demand prediction for an ASIN
 *
 * Query params:
 * - asin (required)
 * - date (optional) - date to use for Keepa data lookup
 */
router.get('/demand-model/predict', requireStaff, async (req, res) => {
  try {
    const { asin, date } = req.query;

    if (!asin) {
      return errors.badRequest(res, 'asin query parameter is required');
    }

    const prediction = await predictUnitsPerDayForAsin({
      asin,
      date: date || null,
    });

    if (prediction.error) {
      return sendSuccess(res, {
        asin,
        prediction: null,
        error: prediction.error,
        model: prediction.model,
      });
    }

    sendSuccess(res, {
      asin,
      prediction: {
        units_per_day: prediction.units_per_day_pred,
        y_log: prediction.y_log_pred,
      },
      keepa_date: prediction.keepa_date,
      debug_features: prediction.debug_features,
      model: prediction.model,
    });
  } catch (err) {
    console.error('Demand model prediction error:', err);
    errors.internal(res, 'Failed to get demand prediction');
  }
});

/**
 * GET /intelligence/demand-model/history
 * Get demand model training history (ADMIN only)
 *
 * Query params:
 * - limit (default: 10)
 */
router.get('/demand-model/history', requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 10;
    const settings = await getDemandModelSettings();

    const { data, error } = await supabase
      .from('keepa_demand_model_runs')
      .select('id, model_name, trained_at, trained_from, trained_to, lookback_days, ridge_lambda, training_summary, metrics, is_active')
      .eq('domain_id', settings.domainId)
      .order('trained_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    sendSuccess(res, {
      domain_id: settings.domainId,
      runs: data || [],
    });
  } catch (err) {
    console.error('Demand model history error:', err);
    errors.internal(res, 'Failed to fetch demand model history');
  }
});

export default router;
