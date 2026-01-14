import express from 'express';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';

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
    // Get component info
    const { data: component, error: componentError } = await supabase
      .from('components')
      .select('*')
      .eq('id', componentId)
      .single();

    if (componentError) {
      if (componentError.code === 'PGRST116') {
        return errors.notFound(res, 'Component');
      }
      throw componentError;
    }

    // Get stock levels
    const { data: stock, error: stockError } = await supabase
      .from('component_stock')
      .select('*')
      .eq('component_id', componentId);

    if (stockError) throw stockError;

    const totalOnHand = (stock || []).reduce((sum, s) => sum + s.on_hand, 0);
    const totalReserved = (stock || []).reduce((sum, s) => sum + s.reserved, 0);
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

    // Get Keepa price estimate for blocked value
    let blockedPoundsEstimate = null;

    if (affectedBomIds.length > 0) {
      const { data: listings } = await supabase
        .from('listing_memory')
        .select('asin, bom_id')
        .in('bom_id', affectedBomIds)
        .not('asin', 'is', null);

      if (listings && listings.length > 0) {
        const asins = listings.map(l => l.asin);
        const { data: keepaData } = await supabase
          .from('keepa_products_cache')
          .select('asin, payload_json')
          .in('asin', asins);

        if (keepaData) {
          // Sum up blocked value based on buy box prices
          blockedPoundsEstimate = 0;
          for (const ol of ordersBlockedByThis) {
            const listing = listings.find(l => l.bom_id === ol.bom_id);
            if (listing) {
              const keepa = keepaData.find(k => k.asin === listing.asin);
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

    // Calculate bottleneck score for each component
    const bottlenecks = {};

    for (const bc of bomComponents || []) {
      const compStock = (stock || []).filter(s => s.component_id === bc.component_id);
      const available = compStock.reduce((sum, s) => sum + (s.on_hand - s.reserved), 0);
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

    // Sort by most constraining
    const sorted = Object.values(bottlenecks).sort((a, b) => {
      if (a.min_bundles_constrained !== b.min_bundles_constrained) {
        return a.min_bundles_constrained - b.min_bundles_constrained;
      }
      return b.boms_affected.length - a.boms_affected.length;
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

export default router;
