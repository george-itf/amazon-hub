/**
 * Allocation Engine
 *
 * Prioritizes and allocates limited stock across multiple Amazon listings
 * that share the same core component. Objective: maximize unit volume while
 * enforcing net margin >= minMarginPercent (prefer targetMarginPercent when possible).
 */
import supabase from './supabase.js';
import {
  getActiveDemandModel,
  predictUnitsPerDayFromMetrics,
  getDemandModelSettings,
} from './keepaDemandModel.js';

/**
 * Compute demand score based on internal sales and Keepa metrics
 *
 * Formula:
 * - internal_score = log(1 + units_30d)
 * - rank_score = sales_rank ? 1 / log10(sales_rank + 100) : 0
 * - offer_score = offer_count != null ? 1 / (1 + offer_count) : 0
 * - if units_30d >= 3: demand = 0.75*internal_score + 0.20*rank_score + 0.05*offer_score
 *   else: demand = 0.40*internal_score + 0.50*rank_score + 0.10*offer_score
 *
 * @param {number} units30d - Units sold in last 30 days
 * @param {number|null} salesRank - Keepa sales rank
 * @param {number|null} offerCount - Keepa offer count
 * @returns {number}
 */
function computeDemandScore(units30d, salesRank, offerCount) {
  const internalScore = Math.log(1 + units30d);
  const rankScore = salesRank ? 1 / Math.log10(salesRank + 100) : 0;
  const offerScore = offerCount != null ? 1 / (1 + offerCount) : 0;

  if (units30d >= 3) {
    return 0.75 * internalScore + 0.20 * rankScore + 0.05 * offerScore;
  } else {
    return 0.40 * internalScore + 0.50 * rankScore + 0.10 * offerScore;
  }
}

/**
 * Compute blended units/day forecast using internal data and calibrated model
 *
 * Blending strategy:
 * - w = clamp(units_90d / 30, 0, 1) - weight for internal data based on sample size
 * - blended = w * internal_units_per_day + (1-w) * model_units_per_day
 *
 * Returns demand source for transparency:
 * - 'INTERNAL': sufficient internal data (units_90d >= 30)
 * - 'BLENDED': mix of internal and model
 * - 'KEEPA_MODEL': primarily model-based (sparse internal data)
 * - 'FALLBACK': no model, using rank heuristic
 *
 * @param {Object} params
 * @param {number} params.units30d - Units sold in last 30 days
 * @param {number} params.units90d - Units sold in last 90 days
 * @param {number|null} params.salesRank - Keepa sales rank
 * @param {number|null} params.offerCount - Keepa offer count
 * @param {number|null} params.buyboxPricePence - Keepa buybox price
 * @param {Object|null} params.demandModel - Active demand model (or null)
 * @returns {Object} - {units_per_day, demand_source, model_prediction}
 */
function computeBlendedDemand({
  units30d,
  units90d,
  salesRank,
  offerCount,
  buyboxPricePence,
  demandModel,
}) {
  // Internal units per day (from 30-day sales)
  const internalUnitsPerDay = units30d / 30;

  // Weight for internal data based on 90-day sample size
  // Full weight when we have 30+ units in 90 days
  const w = Math.min(1, Math.max(0, units90d / 30));

  // Get model prediction if available
  let modelUnitsPerDay = null;
  let modelPrediction = null;

  if (demandModel && salesRank != null) {
    const prediction = predictUnitsPerDayFromMetrics({
      salesRank,
      offerCount,
      buyboxPricePence,
      model: demandModel,
    });

    if (!prediction.error && prediction.units_per_day_pred != null) {
      modelUnitsPerDay = prediction.units_per_day_pred;
      modelPrediction = {
        units_per_day_pred: prediction.units_per_day_pred,
        y_log_pred: prediction.y_log_pred,
        debug_features: prediction.debug_features,
      };
    }
  }

  // Determine demand source and compute blended value
  let unitsPerDay;
  let demandSource;

  if (w >= 0.95) {
    // Strong internal signal - use internal only
    unitsPerDay = internalUnitsPerDay;
    demandSource = 'INTERNAL';
  } else if (modelUnitsPerDay != null) {
    // Blend internal and model
    unitsPerDay = w * internalUnitsPerDay + (1 - w) * modelUnitsPerDay;
    demandSource = w > 0.3 ? 'BLENDED' : 'KEEPA_MODEL';
  } else {
    // No model - fallback to internal only (even if sparse)
    unitsPerDay = internalUnitsPerDay;
    demandSource = 'FALLBACK';
  }

  return {
    units_per_day: unitsPerDay,
    demand_source: demandSource,
    internal_weight: w,
    internal_units_per_day: internalUnitsPerDay,
    model_prediction: modelPrediction,
  };
}

/**
 * Compute margin multiplier for final score calculation
 *
 * @param {number} marginPercent - Current margin percentage
 * @param {number} minMargin - Minimum required margin
 * @param {number} targetMargin - Target preferred margin
 * @returns {number}
 */
function computeMarginMultiplier(marginPercent, minMargin, targetMargin) {
  if (marginPercent < minMargin) {
    return 0;
  }
  if (marginPercent < targetMargin) {
    return 1.0;
  }
  // Small bonus for exceeding target, capped at 1.2
  const bonus = Math.min(0.2, (marginPercent - targetMargin) / 100);
  return 1.0 + bonus;
}

/**
 * Build allocation preview for a pool component
 *
 * @param {Object} options
 * @param {string} options.poolComponentId - UUID of the shared/pool component
 * @param {string} [options.location='Warehouse'] - Stock location
 * @param {number} [options.lookbackDays=30] - Days to look back for ASP calculation
 * @param {number} [options.minMarginPercent=10] - Minimum margin to be eligible
 * @param {number} [options.targetMarginPercent=15] - Target margin for bonus
 * @param {number} [options.bufferUnits=1] - Units to hold back from pool
 * @returns {Promise<Object>}
 */
export async function buildAllocationPreview({
  poolComponentId,
  location = 'Warehouse',
  lookbackDays = 30,
  minMarginPercent = 10,
  targetMarginPercent = 15,
  bufferUnits = 1,
}) {
  // Step 1: Get pool component info and stock
  const { data: poolComponent, error: poolError } = await supabase
    .from('components')
    .select('id, internal_sku, description')
    .eq('id', poolComponentId)
    .single();

  if (poolError || !poolComponent) {
    throw new Error(`Pool component not found: ${poolComponentId}`);
  }

  const { data: poolStock } = await supabase
    .from('component_stock')
    .select('on_hand, reserved')
    .eq('component_id', poolComponentId)
    .eq('location', location)
    .maybeSingle();

  const poolOnHand = poolStock?.on_hand || 0;
  const poolReserved = poolStock?.reserved || 0;
  const poolAvailable = Math.max(0, poolOnHand - poolReserved);
  const allocatableUnits = Math.max(0, poolAvailable - bufferUnits);

  // Step 2: Find BOMs that include this pool component
  const { data: bomComponentsWithPool, error: bomError } = await supabase
    .from('bom_components')
    .select(`
      bom_id,
      qty_required,
      boms!inner (
        id,
        bundle_sku,
        description,
        is_active
      )
    `)
    .eq('component_id', poolComponentId)
    .eq('boms.is_active', true);

  if (bomError) {
    throw new Error(`Failed to fetch BOMs: ${bomError.message}`);
  }

  const bomIds = (bomComponentsWithPool || []).map(bc => bc.bom_id);

  if (bomIds.length === 0) {
    return buildEmptyResult(poolComponent, location, poolOnHand, poolReserved, poolAvailable, bufferUnits, allocatableUnits);
  }

  // Step 3: Find candidate listings (listing_memory with bom_id in bomIds)
  const { data: listings, error: listingsError } = await supabase
    .from('listing_memory')
    .select('id, asin, sku, bom_id')
    .in('bom_id', bomIds)
    .eq('is_active', true)
    .not('bom_id', 'is', null);

  if (listingsError) {
    throw new Error(`Failed to fetch listings: ${listingsError.message}`);
  }

  if (!listings || listings.length === 0) {
    return buildEmptyResult(poolComponent, location, poolOnHand, poolReserved, poolAvailable, bufferUnits, allocatableUnits);
  }

  // Step 3b: Fetch listing_settings for all candidate listings
  const listingIds = listings.map(l => l.id);
  const { data: listingSettings } = await supabase
    .from('listing_settings')
    .select(`
      listing_memory_id,
      price_override_pence,
      quantity_cap,
      quantity_override,
      min_margin_override,
      target_margin_override,
      shipping_profile_id,
      tags,
      group_key
    `)
    .in('listing_memory_id', listingIds);

  // Build settings lookup map
  const settingsMap = {};
  for (const s of listingSettings || []) {
    settingsMap[s.listing_memory_id] = s;
  }

  // Step 4: Get full BOM composition for all BOMs (to compute COGS)
  const { data: allBomComponents, error: allBomError } = await supabase
    .from('bom_components')
    .select(`
      bom_id,
      component_id,
      qty_required,
      components (
        id,
        internal_sku,
        cost_ex_vat_pence
      )
    `)
    .in('bom_id', bomIds);

  if (allBomError) {
    throw new Error(`Failed to fetch BOM components: ${allBomError.message}`);
  }

  // Build BOM composition map: bom_id -> [{component_id, qty_required, cost_ex_vat_pence}]
  const bomComposition = {};
  const allComponentIds = new Set();

  for (const bc of allBomComponents || []) {
    if (!bomComposition[bc.bom_id]) {
      bomComposition[bc.bom_id] = [];
    }
    bomComposition[bc.bom_id].push({
      component_id: bc.component_id,
      qty_required: bc.qty_required,
      cost_ex_vat_pence: bc.components?.cost_ex_vat_pence || 0,
      internal_sku: bc.components?.internal_sku,
    });
    allComponentIds.add(bc.component_id);
  }

  // Compute COGS per BOM
  const bomCogs = {};
  for (const [bomId, components] of Object.entries(bomComposition)) {
    bomCogs[bomId] = components.reduce(
      (sum, c) => sum + c.qty_required * c.cost_ex_vat_pence,
      0
    );
  }

  // Step 5: Fetch component stock for ALL components at location
  const { data: allStock, error: stockError } = await supabase
    .from('component_stock')
    .select('component_id, on_hand, reserved')
    .in('component_id', [...allComponentIds])
    .eq('location', location);

  if (stockError) {
    throw new Error(`Failed to fetch stock: ${stockError.message}`);
  }

  // Build remaining stock map (will be decremented during allocation)
  const remainingStock = new Map();
  for (const compId of allComponentIds) {
    const stock = (allStock || []).find(s => s.component_id === compId);
    const available = stock ? Math.max(0, stock.on_hand - stock.reserved) : 0;
    remainingStock.set(compId, available);
  }

  // Step 6: Compute prices - ASP from orders and Keepa buybox
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // Get ASINs and SKUs for lookups
  const asins = [...new Set(listings.map(l => l.asin).filter(Boolean))];
  const skus = [...new Set(listings.map(l => l.sku).filter(Boolean))];

  // Fetch order line sales data (last 90 days for volume, last 30 for ASP)
  const { data: orderLines } = await supabase
    .from('order_lines')
    .select(`
      sku,
      asin,
      quantity,
      unit_price_pence,
      orders!inner (
        channel,
        order_date,
        status
      )
    `)
    .eq('orders.channel', 'AMAZON')
    .gte('orders.order_date', ninetyDaysAgo.toISOString().split('T')[0])
    .not('orders.status', 'eq', 'CANCELLED');

  // Aggregate sales by SKU
  const salesBySku = {};
  for (const ol of orderLines || []) {
    const key = ol.sku || ol.asin;
    if (!key) continue;

    if (!salesBySku[key]) {
      salesBySku[key] = { units_30d: 0, units_90d: 0, total_revenue_30d: 0, total_units_30d: 0 };
    }

    const orderDate = new Date(ol.orders.order_date);
    salesBySku[key].units_90d += ol.quantity;

    if (orderDate >= thirtyDaysAgo) {
      salesBySku[key].units_30d += ol.quantity;
      if (ol.unit_price_pence) {
        salesBySku[key].total_revenue_30d += ol.unit_price_pence * ol.quantity;
        salesBySku[key].total_units_30d += ol.quantity;
      }
    }
  }

  // Fetch Keepa metrics (last 14 days for buybox median)
  let keepaData = {};
  if (asins.length > 0) {
    const { data: keepaMetrics } = await supabase
      .from('keepa_metrics_daily')
      .select('asin, date, buybox_price_pence, sales_rank, offer_count')
      .in('asin', asins)
      .gte('date', fourteenDaysAgo.toISOString().split('T')[0])
      .order('date', { ascending: false });

    // Aggregate Keepa data by ASIN
    for (const km of keepaMetrics || []) {
      if (!keepaData[km.asin]) {
        keepaData[km.asin] = {
          buybox_prices: [],
          sales_rank: null,
          offer_count: null,
          last_date: null,
        };
      }
      if (km.buybox_price_pence) {
        keepaData[km.asin].buybox_prices.push(km.buybox_price_pence);
      }
      // Take most recent non-null values
      if (keepaData[km.asin].sales_rank === null && km.sales_rank) {
        keepaData[km.asin].sales_rank = km.sales_rank;
      }
      if (keepaData[km.asin].offer_count === null && km.offer_count != null) {
        keepaData[km.asin].offer_count = km.offer_count;
      }
      if (keepaData[km.asin].last_date === null) {
        keepaData[km.asin].last_date = km.date;
      }
    }

    // Compute median buybox price
    for (const asin of Object.keys(keepaData)) {
      const prices = keepaData[asin].buybox_prices.sort((a, b) => a - b);
      if (prices.length > 0) {
        const mid = Math.floor(prices.length / 2);
        keepaData[asin].buybox_median =
          prices.length % 2 === 0
            ? Math.round((prices[mid - 1] + prices[mid]) / 2)
            : prices[mid];
      }
    }
  }

  // Step 6b: Load demand model for calibrated predictions
  let demandModel = null;
  let demandModelInfo = null;
  try {
    const settings = await getDemandModelSettings();
    if (settings.enabled) {
      demandModel = await getActiveDemandModel(settings.domainId);
      if (demandModel) {
        demandModelInfo = {
          id: demandModel.id,
          model_name: demandModel.model_name,
          trained_at: demandModel.trained_at,
        };
      }
    }
  } catch (err) {
    console.warn('[Allocation] Failed to load demand model:', err.message);
  }

  // Step 7: Fetch amazon_fees for fee_rate calculation (last 90 days)
  const feeRateBySku = {};
  if (skus.length > 0) {
    const { data: fees } = await supabase
      .from('amazon_fees')
      .select('seller_sku, total_fees_pence, item_price_pence')
      .in('seller_sku', skus)
      .gte('posted_date', ninetyDaysAgo.toISOString());

    // Aggregate fees by SKU
    for (const fee of fees || []) {
      if (!fee.seller_sku || !fee.item_price_pence) continue;

      if (!feeRateBySku[fee.seller_sku]) {
        feeRateBySku[fee.seller_sku] = { total_fees: 0, total_revenue: 0 };
      }
      feeRateBySku[fee.seller_sku].total_fees += fee.total_fees_pence || 0;
      feeRateBySku[fee.seller_sku].total_revenue += fee.item_price_pence;
    }

    // Compute fee rate
    for (const sku of Object.keys(feeRateBySku)) {
      const data = feeRateBySku[sku];
      if (data.total_revenue > 0) {
        feeRateBySku[sku].rate = data.total_fees / data.total_revenue;
      }
    }
  }

  // Step 8: Build candidates with all computed metrics
  const candidates = [];
  let missingKeepaCount = 0;

  // Build bundle_sku lookup from bomComponentsWithPool
  const bomBundleSku = {};
  for (const bc of bomComponentsWithPool || []) {
    bomBundleSku[bc.bom_id] = bc.boms.bundle_sku;
  }

  for (const listing of listings) {
    const sku = listing.sku;
    const asin = listing.asin;
    const bomId = listing.bom_id;
    const bundleSku = bomBundleSku[bomId] || null;

    // Get per-listing settings (if any)
    const settings = settingsMap[listing.id] || {};

    // COGS
    const cogsPence = bomCogs[bomId] || 0;

    // Price: check override first, then ASP, then Keepa buybox
    let pricePence = null;
    let priceSource = null;

    if (settings.price_override_pence != null) {
      // Use price override
      pricePence = settings.price_override_pence;
      priceSource = 'OVERRIDE';
    } else {
      const sales = salesBySku[sku] || salesBySku[asin];
      if (sales?.total_units_30d > 0) {
        pricePence = Math.round(sales.total_revenue_30d / sales.total_units_30d);
        priceSource = 'ASP_30D';
      } else if (asin && keepaData[asin]?.buybox_median) {
        pricePence = keepaData[asin].buybox_median;
        priceSource = 'KEEPA_BUYBOX';
      }
    }

    // Fee rate
    let feeRate = 0.15; // Default fallback
    if (sku && feeRateBySku[sku]?.rate != null) {
      feeRate = feeRateBySku[sku].rate;
    }

    // Profit and margin
    let expectedFeesPence = null;
    let profitPence = null;
    let marginPercent = null;

    if (pricePence) {
      expectedFeesPence = Math.round(pricePence * feeRate);
      profitPence = pricePence - expectedFeesPence - cogsPence;
      marginPercent = (profitPence / pricePence) * 100;
    }

    // Keepa data for this listing
    const keepa = asin && keepaData[asin]
      ? {
          buybox_price_pence: keepaData[asin].buybox_median || null,
          sales_rank: keepaData[asin].sales_rank,
          offer_count: keepaData[asin].offer_count,
          last_date: keepaData[asin].last_date,
        }
      : null;

    if (!keepa && asin) {
      missingKeepaCount++;
    }

    // Sales volumes
    const salesData = salesBySku[sku] || salesBySku[asin] || { units_30d: 0, units_90d: 0 };
    const units30d = salesData.units_30d;
    const units90d = salesData.units_90d;

    // Compute blended demand using calibrated model when available
    const blendedDemand = computeBlendedDemand({
      units30d,
      units90d,
      salesRank: keepa?.sales_rank,
      offerCount: keepa?.offer_count,
      buyboxPricePence: keepa?.buybox_price_pence,
      demandModel,
    });

    // Demand score (still using original formula for scoring/ranking)
    const demandScore = computeDemandScore(
      units30d,
      keepa?.sales_rank,
      keepa?.offer_count
    );

    // Use margin overrides if set, otherwise use function params (defaults: min=10, target=15)
    const effectiveMinMargin = settings.min_margin_override != null
      ? parseFloat(settings.min_margin_override)
      : minMarginPercent;
    const effectiveTargetMargin = settings.target_margin_override != null
      ? parseFloat(settings.target_margin_override)
      : targetMarginPercent;

    // Margin multiplier and final score
    const marginMultiplier =
      marginPercent != null
        ? computeMarginMultiplier(marginPercent, effectiveMinMargin, effectiveTargetMargin)
        : 0;

    const score = demandScore * marginMultiplier;

    // Eligibility check (using effective min margin)
    const eligible = pricePence != null && marginPercent != null && marginPercent >= effectiveMinMargin;

    candidates.push({
      listing_memory_id: listing.id,
      sku,
      asin,
      bom_id: bomId,
      bundle_sku: bundleSku,
      cogs_pence: cogsPence,
      price_pence: pricePence,
      price_source: priceSource,
      fee_rate: Math.round(feeRate * 10000) / 10000, // 4 decimal places
      expected_fees_pence: expectedFeesPence,
      profit_pence: profitPence,
      margin_percent: marginPercent != null ? Math.round(marginPercent * 100) / 100 : null,
      units_30d: units30d,
      units_90d: units90d,
      keepa,
      demand_score: Math.round(demandScore * 1000) / 1000,
      margin_multiplier: Math.round(marginMultiplier * 1000) / 1000,
      score: Math.round(score * 1000) / 1000,
      eligible,
      recommended_qty: 0, // Will be set during allocation
      // Calibrated demand forecasting
      demand_forecast: {
        units_per_day: Math.round(blendedDemand.units_per_day * 1000) / 1000,
        source: blendedDemand.demand_source,
        internal_weight: Math.round(blendedDemand.internal_weight * 100) / 100,
        model_prediction: blendedDemand.model_prediction,
      },
      // Per-listing settings
      quantity_cap: settings.quantity_cap ?? null,
      quantity_override: settings.quantity_override ?? null,
      margin_overrides: {
        min: settings.min_margin_override != null ? parseFloat(settings.min_margin_override) : null,
        target: settings.target_margin_override != null ? parseFloat(settings.target_margin_override) : null,
      },
      tags: settings.tags || [],
      group_key: settings.group_key || null,
      shipping_profile_id: settings.shipping_profile_id || null,
      _bom_composition: bomComposition[bomId], // Internal use for allocation
    });
  }

  // Step 9: Unit-by-unit allocation using feasible algorithm
  // Create a working copy of remaining stock
  const workingStock = new Map(remainingStock);

  // Only consider eligible candidates
  const eligibleCandidates = candidates.filter(c => c.eligible);
  let unitsToAllocate = allocatableUnits;

  // Step 9a: Handle quantity_override first - allocate fixed quantities
  for (const candidate of eligibleCandidates) {
    if (candidate.quantity_override != null && candidate.quantity_override > 0) {
      // Determine max buildable units
      const bomComp = candidate._bom_composition;
      let maxBuildable = Infinity;

      for (const comp of bomComp) {
        const available = workingStock.get(comp.component_id) || 0;
        maxBuildable = Math.min(maxBuildable, Math.floor(available / comp.qty_required));
      }

      // Clamp override to buildable and available pool
      const allocateQty = Math.min(
        candidate.quantity_override,
        maxBuildable,
        unitsToAllocate
      );

      if (allocateQty > 0) {
        candidate.recommended_qty = allocateQty;
        unitsToAllocate -= allocateQty;

        // Decrement stock for all BOM components
        for (const comp of bomComp) {
          const current = workingStock.get(comp.component_id) || 0;
          workingStock.set(comp.component_id, current - comp.qty_required * allocateQty);
        }
      }
    }
  }

  // Step 9b: Standard allocation for remaining candidates
  while (unitsToAllocate > 0 && eligibleCandidates.length > 0) {
    // Find best candidate: max score/(allocated+1)
    let bestCandidate = null;
    let bestScore = -1;

    for (const candidate of eligibleCandidates) {
      // Skip if quantity_override was already handled
      if (candidate.quantity_override != null) continue;

      // Skip if at quantity_cap
      if (candidate.quantity_cap != null && candidate.recommended_qty >= candidate.quantity_cap) {
        continue;
      }

      // Check feasibility: can we allocate one more unit?
      const bomComp = candidate._bom_composition;
      let feasible = true;

      for (const comp of bomComp) {
        const available = workingStock.get(comp.component_id) || 0;
        if (available < comp.qty_required) {
          feasible = false;
          break;
        }
      }

      if (!feasible) continue;

      // Score: demand * margin_multiplier / (allocated + 1) for diminishing returns
      const effectiveScore = candidate.score / (candidate.recommended_qty + 1);

      if (effectiveScore > bestScore) {
        bestScore = effectiveScore;
        bestCandidate = candidate;
      }
    }

    if (!bestCandidate) {
      // No feasible candidate found
      break;
    }

    // Allocate one unit
    bestCandidate.recommended_qty++;
    unitsToAllocate--;

    // Decrement stock for all BOM components
    for (const comp of bestCandidate._bom_composition) {
      const current = workingStock.get(comp.component_id) || 0;
      workingStock.set(comp.component_id, current - comp.qty_required);
    }
  }

  // Step 10: Remove internal fields and build summary
  const cleanCandidates = candidates.map(c => {
    const { _bom_composition, ...rest } = c;
    return rest;
  });

  const allocatedTotal = cleanCandidates.reduce((sum, c) => sum + c.recommended_qty, 0);
  const blockedByMargin = cleanCandidates.filter(
    c => c.margin_percent != null && c.margin_percent < minMarginPercent
  ).length;
  const blockedByStock = cleanCandidates.filter(
    c => c.eligible && c.recommended_qty === 0
  ).length;

  // Count demand sources
  const demandSourceCounts = {
    INTERNAL: 0,
    BLENDED: 0,
    KEEPA_MODEL: 0,
    FALLBACK: 0,
  };
  for (const c of cleanCandidates) {
    const src = c.demand_forecast?.source;
    if (src && demandSourceCounts[src] !== undefined) {
      demandSourceCounts[src]++;
    }
  }

  return {
    pool: {
      component_id: poolComponent.id,
      internal_sku: poolComponent.internal_sku,
      description: poolComponent.description,
      location,
      on_hand: poolOnHand,
      reserved: poolReserved,
      available: poolAvailable,
      buffer_units: bufferUnits,
      allocatable_units: allocatableUnits,
    },
    candidates: cleanCandidates.sort((a, b) => b.score - a.score),
    summary: {
      candidate_count: cleanCandidates.length,
      eligible_count: eligibleCandidates.length,
      allocated_total: allocatedTotal,
      blocked_by_margin_count: blockedByMargin,
      blocked_by_stock_count: blockedByStock,
      missing_keepa_count: missingKeepaCount,
      demand_source_counts: demandSourceCounts,
    },
    demand_model: demandModelInfo,
  };
}

/**
 * Helper to build empty result when no candidates found
 */
function buildEmptyResult(poolComponent, location, onHand, reserved, available, bufferUnits, allocatableUnits) {
  return {
    pool: {
      component_id: poolComponent.id,
      internal_sku: poolComponent.internal_sku,
      description: poolComponent.description,
      location,
      on_hand: onHand,
      reserved: reserved,
      available: available,
      buffer_units: bufferUnits,
      allocatable_units: allocatableUnits,
    },
    candidates: [],
    summary: {
      candidate_count: 0,
      eligible_count: 0,
      allocated_total: 0,
      blocked_by_margin_count: 0,
      blocked_by_stock_count: 0,
      missing_keepa_count: 0,
    },
  };
}

/**
 * Get components that appear in multiple active BOMs (pool candidates)
 *
 * @param {string} location - Stock location
 * @param {number} minBoms - Minimum number of BOMs to be considered a pool
 * @returns {Promise<Array>}
 */
export async function getPoolCandidates(location = 'Warehouse', minBoms = 2) {
  // Get all bom_components for active BOMs
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

  if (error) {
    throw new Error(`Failed to fetch BOM components: ${error.message}`);
  }

  // Count BOMs per component
  const componentBomCount = {};
  for (const bc of bomComponents || []) {
    const compId = bc.component_id;
    if (!componentBomCount[compId]) {
      componentBomCount[compId] = {
        component_id: compId,
        internal_sku: bc.components.internal_sku,
        description: bc.components.description,
        bom_count: 0,
        boms: [],
      };
    }
    componentBomCount[compId].bom_count++;
    componentBomCount[compId].boms.push({
      bom_id: bc.boms.id,
      bundle_sku: bc.boms.bundle_sku,
      qty_required: bc.qty_required,
    });
  }

  // Filter to components in >= minBoms
  const poolCandidates = Object.values(componentBomCount).filter(
    c => c.bom_count >= minBoms
  );

  // Get stock for these components
  const componentIds = poolCandidates.map(c => c.component_id);
  if (componentIds.length === 0) {
    return [];
  }

  const { data: stock } = await supabase
    .from('component_stock')
    .select('component_id, on_hand, reserved')
    .in('component_id', componentIds)
    .eq('location', location);

  // Merge stock data
  const stockMap = new Map((stock || []).map(s => [s.component_id, s]));
  for (const candidate of poolCandidates) {
    const s = stockMap.get(candidate.component_id);
    candidate.on_hand = s?.on_hand || 0;
    candidate.reserved = s?.reserved || 0;
    candidate.available = Math.max(0, candidate.on_hand - candidate.reserved);
  }

  // Sort by bom_count desc, then available asc (most constrained first)
  return poolCandidates.sort((a, b) => {
    if (b.bom_count !== a.bom_count) return b.bom_count - a.bom_count;
    return a.available - b.available;
  });
}
