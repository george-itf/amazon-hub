/**
 * ASIN Analyzer Routes
 *
 * Comprehensive ASIN analysis for listing decisions:
 * - Multi-ASIN batch analysis with scoring
 * - BOM suggestion matching
 * - Reverse search from component to opportunities
 */

import express from 'express';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { requireStaff } from '../middleware/auth.js';
import {
  getActiveDemandModel,
  predictUnitsPerDayFromMetrics,
} from '../services/keepaDemandModel.js';
import { parseTitle, suggestComponents } from '../utils/deterministicParser.js';
import {
  calculateProfit,
  calculateTargetPrice,
  DEFAULT_FEE_CONFIG,
} from '../services/feeCalculator.js';

const router = express.Router();

// Default scoring configuration
const DEFAULT_SCORING = {
  min_margin: 10,
  target_margin: 15,
  horizon_days: 14,
};

// Default fee rate for estimation
const DEFAULT_FEE_RATE = 0.15;

// ============================================================================
// SCORING MODEL (Explainable, not ML)
// ============================================================================

/**
 * Calculate ASIN score (0-100) with explainable reasons
 */
function calculateScore({
  marginPercent,
  forecastUnitsHorizon,
  offerCount,
  priceVolatilityPct,
  buildableUnits,
  hasBom,
  hasPrice,
  scoring,
}) {
  const { min_margin = 10, target_margin = 15 } = scoring;
  let score = 50; // Start at 50
  const reasons = [];

  // Hard constraint: Margin below minimum caps score at 39
  let hardCapped = false;
  if (marginPercent !== null && marginPercent < min_margin) {
    score = Math.min(score - 40, 39);
    hardCapped = true;
    reasons.push({
      code: 'MARGIN_BELOW_MIN',
      weight: -40,
      detail: `Margin ${marginPercent.toFixed(1)}% below ${min_margin}% minimum`,
    });
  }

  // A) Margin contribution (max +30)
  if (marginPercent !== null && !hardCapped) {
    if (marginPercent >= target_margin) {
      score += 30;
      reasons.push({
        code: 'MARGIN_STRONG',
        weight: 30,
        detail: `Margin ${marginPercent.toFixed(1)}% meets target ${target_margin}%`,
      });
    } else if (marginPercent >= min_margin) {
      const contribution = ((marginPercent - min_margin) / (target_margin - min_margin)) * 30;
      score += contribution;
      reasons.push({
        code: 'MARGIN_OK_NOT_GREAT',
        weight: Math.round(contribution),
        detail: `Margin ${marginPercent.toFixed(1)}% between ${min_margin}%-${target_margin}%`,
      });
    }
  }

  // B) Demand contribution (max +25)
  if (forecastUnitsHorizon !== null && forecastUnitsHorizon > 0) {
    // Log scale normalization: baseline ~50 units over horizon
    const contribution = 25 * Math.min(1, Math.log(1 + forecastUnitsHorizon) / Math.log(1 + 50));
    score += contribution;
    if (contribution >= 20) {
      reasons.push({
        code: 'DEMAND_STRONG',
        weight: Math.round(contribution),
        detail: `Forecast ${forecastUnitsHorizon.toFixed(1)} units in ${scoring.horizon_days}d`,
      });
    } else if (contribution < 10) {
      reasons.push({
        code: 'DEMAND_WEAK',
        weight: Math.round(contribution),
        detail: `Low forecast ${forecastUnitsHorizon.toFixed(1)} units in ${scoring.horizon_days}d`,
      });
    }
  }

  // C) Competition penalty (max -15)
  if (offerCount !== null) {
    let penalty = 0;
    if (offerCount > 25) {
      penalty = -15;
    } else if (offerCount > 10) {
      penalty = -10;
    } else if (offerCount > 3) {
      penalty = -5;
    }
    if (penalty !== 0) {
      score += penalty;
      reasons.push({
        code: 'COMPETITION_HIGH',
        weight: penalty,
        detail: `${offerCount} competing offers`,
      });
    }
  }

  // D) Price volatility penalty (max -10)
  if (priceVolatilityPct !== null) {
    if (priceVolatilityPct > 15) {
      score -= 10;
      reasons.push({
        code: 'VOLATILITY_HIGH',
        weight: -10,
        detail: `Price volatility ${priceVolatilityPct.toFixed(1)}% > 15%`,
      });
    } else if (priceVolatilityPct > 8) {
      score -= 5;
      reasons.push({
        code: 'VOLATILITY_HIGH',
        weight: -5,
        detail: `Price volatility ${priceVolatilityPct.toFixed(1)}% > 8%`,
      });
    }
  }

  // E) Feasibility bonus (max +10)
  if (buildableUnits !== null) {
    if (buildableUnits >= 10) {
      score += 10;
      reasons.push({
        code: 'STOCK_HEALTHY',
        weight: 10,
        detail: `${buildableUnits} buildable units available`,
      });
    } else if (buildableUnits >= 3) {
      score += 5;
      reasons.push({
        code: 'STOCK_LOW',
        weight: 5,
        detail: `Only ${buildableUnits} buildable units`,
      });
    } else if (buildableUnits < 3) {
      reasons.push({
        code: 'STOCK_LOW',
        weight: 0,
        detail: `Only ${buildableUnits} buildable units - insufficient stock`,
      });
    }
  }

  // Add warnings for missing data
  if (!hasBom) {
    reasons.push({
      code: 'BOM_UNKNOWN',
      weight: 0,
      detail: 'No BOM mapped - COGS estimated',
    });
  }
  if (!hasPrice) {
    reasons.push({
      code: 'PRICE_UNKNOWN',
      weight: 0,
      detail: 'No price data available',
    });
  }

  // Clamp score
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Determine band
  const passesMinMargin = marginPercent === null || marginPercent >= min_margin;
  let band = 'AMBER';
  if (score >= 75 && passesMinMargin && hasPrice && hasBom) {
    band = 'GREEN';
  } else if (score < 40 || !passesMinMargin) {
    band = 'RED';
  }

  // Cap score if missing critical data
  if (!hasPrice || !hasBom) {
    score = Math.min(score, 69);
    if (band === 'GREEN') band = 'AMBER';
  }

  return { value: score, band, reasons };
}

/**
 * Determine suggested next step based on analysis
 */
function determineSuggestedAction(result) {
  const { score, feasibility, bom_suggestion, finance } = result;

  if (score.band === 'RED') {
    if (finance.margin_percent !== null && finance.margin_percent < 10) {
      return 'DO_NOT_LIST';
    }
    return 'INVESTIGATE';
  }

  if (!bom_suggestion.suggested_bom_id) {
    return 'MAP_BOM';
  }

  if (feasibility.buildable_units !== null && feasibility.buildable_units < 3) {
    return 'BUY_STOCK';
  }

  if (score.band === 'GREEN') {
    return 'LIST_TEST';
  }

  return 'INVESTIGATE';
}

// ============================================================================
// POST /asin/analyze - Multi-ASIN Batch Analysis
// ============================================================================

router.post('/analyze', requireStaff, async (req, res) => {
  const {
    asins = [],
    location = 'Warehouse',
    bom_id = null,
    scoring = {},
  } = req.body;

  if (!asins || !Array.isArray(asins) || asins.length === 0) {
    return errors.badRequest(res, 'asins array is required');
  }

  // Validate ASINs (10 alphanumeric chars)
  const validAsins = [...new Set(
    asins
      .map(a => String(a).trim().toUpperCase())
      .filter(a => /^[A-Z0-9]{10}$/.test(a))
  )];

  const invalidAsins = asins.filter(a => !validAsins.includes(String(a).trim().toUpperCase()));

  if (validAsins.length === 0) {
    return errors.badRequest(res, 'No valid ASINs provided (must be 10 alphanumeric chars)');
  }

  const scoringConfig = { ...DEFAULT_SCORING, ...scoring };

  try {
    // Get active demand model
    const demandModel = await getActiveDemandModel();

    // 1. Batch fetch latest Keepa metrics for all ASINs
    const { data: keepaMetrics, error: keepaError } = await supabase
      .from('keepa_metrics_daily')
      .select('asin, date, sales_rank, offer_count, buybox_price_pence')
      .in('asin', validAsins)
      .order('date', { ascending: false });

    if (keepaError) throw keepaError;

    // Dedupe to latest per ASIN
    const keepaByAsin = new Map();
    for (const row of keepaMetrics || []) {
      if (!keepaByAsin.has(row.asin)) {
        keepaByAsin.set(row.asin, row);
      }
    }

    // 2. Batch fetch Keepa product cache for titles/images
    const { data: keepaProducts } = await supabase
      .from('keepa_products_cache')
      .select('asin, payload_json')
      .in('asin', validAsins);

    const productInfoByAsin = new Map();
    for (const row of keepaProducts || []) {
      if (row.payload_json) {
        const payload = row.payload_json;
        productInfoByAsin.set(row.asin, {
          title: payload.title || null,
          brand: payload.brand || null,
          image_url: payload.imagesCSV
            ? `https://images-na.ssl-images-amazon.com/images/I/${payload.imagesCSV.split(',')[0]}`
            : null,
        });
      }
    }

    // 3. Batch fetch existing listing_memory entries
    const { data: existingListings } = await supabase
      .from('listing_memory')
      .select('asin, bom_id, sku, amazon_fee_percent')
      .in('asin', validAsins)
      .eq('is_active', true);

    const listingByAsin = new Map();
    for (const listing of existingListings || []) {
      listingByAsin.set(listing.asin, listing);
    }

    // 4. Fetch all BOMs with components for matching
    const { data: allBoms } = await supabase
      .from('boms')
      .select(`
        id,
        bundle_sku,
        description,
        is_active,
        bom_components (
          component_id,
          qty_required,
          components (
            id,
            internal_sku,
            description,
            cost_ex_vat_pence
          )
        )
      `)
      .eq('is_active', true);

    // Build BOM lookup
    const bomById = new Map();
    for (const bom of allBoms || []) {
      bomById.set(bom.id, bom);
    }

    // 5. Fetch component stock for buildable units
    const { data: componentStock } = await supabase
      .from('component_stock')
      .select('component_id, on_hand, reserved')
      .eq('location', location);

    const stockByComponentId = new Map();
    for (const stock of componentStock || []) {
      stockByComponentId.set(stock.component_id, {
        on_hand: stock.on_hand,
        reserved: stock.reserved,
        available: stock.on_hand - stock.reserved,
      });
    }

    // 6. Fetch historical price data for volatility (last 14 days)
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const fourteenDaysAgoStr = fourteenDaysAgo.toISOString().split('T')[0];

    const { data: priceHistory } = await supabase
      .from('keepa_metrics_daily')
      .select('asin, buybox_price_pence')
      .in('asin', validAsins)
      .gte('date', fourteenDaysAgoStr)
      .not('buybox_price_pence', 'is', null);

    // Calculate price volatility per ASIN
    const priceVolatilityByAsin = new Map();
    const pricesByAsin = new Map();
    for (const row of priceHistory || []) {
      if (!pricesByAsin.has(row.asin)) {
        pricesByAsin.set(row.asin, []);
      }
      pricesByAsin.get(row.asin).push(row.buybox_price_pence);
    }
    for (const [asin, prices] of pricesByAsin) {
      if (prices.length >= 2) {
        const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
        const std = Math.sqrt(prices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / (prices.length - 1));
        const volatilityPct = mean > 0 ? (std / mean) * 100 : 0;
        priceVolatilityByAsin.set(asin, volatilityPct);
      }
    }

    // 7. Process each ASIN
    const results = [];
    const unresolvedAsins = [];

    for (const asin of validAsins) {
      const keepa = keepaByAsin.get(asin);
      const productInfo = productInfoByAsin.get(asin);
      const existingListing = listingByAsin.get(asin);

      // Basic product info
      const result = {
        asin,
        title: productInfo?.title || null,
        brand: productInfo?.brand || null,
        image_url: productInfo?.image_url || null,
        keepa: null,
        demand: null,
        bom_suggestion: null,
        finance: null,
        feasibility: null,
        score: null,
        actions: null,
      };

      // Keepa data
      if (keepa) {
        const medianPrice = pricesByAsin.get(asin);
        const median14d = medianPrice && medianPrice.length > 0
          ? medianPrice.sort((a, b) => a - b)[Math.floor(medianPrice.length / 2)]
          : null;

        result.keepa = {
          buybox_price_pence: keepa.buybox_price_pence,
          buybox_price_14d_median_pence: median14d,
          price_volatility_pct: priceVolatilityByAsin.get(asin) || null,
          sales_rank_14d_avg: keepa.sales_rank,
          offer_count_14d_avg: keepa.offer_count,
          last_date: keepa.date,
        };
      } else {
        unresolvedAsins.push(asin);
      }

      // Demand prediction
      if (demandModel && keepa?.sales_rank) {
        const prediction = predictUnitsPerDayFromMetrics({
          salesRank: keepa.sales_rank,
          offerCount: keepa.offer_count,
          buyboxPricePence: keepa.buybox_price_pence,
          model: demandModel,
        });

        const unitsPerDay = prediction.units_per_day_pred || 0;
        result.demand = {
          units_per_day_pred: unitsPerDay,
          source: prediction.error ? 'FALLBACK' : 'KEEPA_MODEL',
          horizon_days: scoringConfig.horizon_days,
          forecast_units_horizon: unitsPerDay * scoringConfig.horizon_days,
        };
      } else {
        result.demand = {
          units_per_day_pred: null,
          source: 'FALLBACK',
          horizon_days: scoringConfig.horizon_days,
          forecast_units_horizon: null,
        };
      }

      // BOM suggestion
      let selectedBomId = bom_id; // Use forced BOM if provided
      let bomConfidence = 'HIGH';
      let bomRationale = [];

      if (!selectedBomId && existingListing?.bom_id) {
        selectedBomId = existingListing.bom_id;
        bomConfidence = 'HIGH';
        bomRationale.push('Existing listing_memory mapping');
      }

      if (!selectedBomId && productInfo?.title) {
        // Try deterministic parser
        const parseIntent = parseTitle(productInfo.title);
        const suggestion = suggestComponents(parseIntent);

        // Match against BOMs
        const bomMatches = matchBomsByIntent(parseIntent, allBoms || []);
        if (bomMatches.length > 0) {
          selectedBomId = bomMatches[0].bom_id;
          bomConfidence = bomMatches[0].confidence;
          bomRationale = bomMatches[0].rationale;
        }
      }

      const selectedBom = selectedBomId ? bomById.get(selectedBomId) : null;

      result.bom_suggestion = {
        suggested_bom_id: selectedBomId,
        suggested_bom_name: selectedBom?.bundle_sku || selectedBom?.description || null,
        confidence: selectedBomId ? bomConfidence : null,
        rationale: bomRationale,
      };

      // Finance calculation
      const pricePence = result.keepa?.buybox_price_14d_median_pence
        || result.keepa?.buybox_price_pence
        || null;

      let cogsPence = 0;
      if (selectedBom?.bom_components) {
        for (const bc of selectedBom.bom_components) {
          cogsPence += (bc.components?.cost_ex_vat_pence || 0) * bc.qty_required;
        }
      }

      // Fee rate
      const feeRate = existingListing?.amazon_fee_percent
        ? existingListing.amazon_fee_percent / 100
        : DEFAULT_FEE_RATE;

      let marginPercent = null;
      let profitPence = null;
      let feesPence = null;

      if (pricePence && cogsPence > 0) {
        feesPence = Math.round(pricePence * feeRate);
        profitPence = pricePence - cogsPence - feesPence;
        marginPercent = (profitPence / pricePence) * 100;
      }

      // Calculate min prices for margins
      const minPrice10 = cogsPence > 0
        ? calculateTargetPrice({
            costPence: cogsPence,
            targetMarginPercent: 10,
            sizeTier: 'standard',
          }).targetPricePence
        : null;

      const minPrice15 = cogsPence > 0
        ? calculateTargetPrice({
            costPence: cogsPence,
            targetMarginPercent: 15,
            sizeTier: 'standard',
          }).targetPricePence
        : null;

      result.finance = {
        price_pence: pricePence,
        fees_pence: feesPence,
        fee_rate: feeRate,
        fees_estimated: !existingListing?.amazon_fee_percent,
        cogs_pence: cogsPence > 0 ? cogsPence : null,
        profit_pence: profitPence,
        margin_percent: marginPercent !== null ? Math.round(marginPercent * 10) / 10 : null,
        min_price_for_10_margin_pence: minPrice10,
        min_price_for_15_margin_pence: minPrice15,
      };

      // Feasibility (buildable units, days of cover)
      let buildableUnits = null;
      let bottleneckComponentId = null;
      const notes = [];

      if (selectedBom?.bom_components) {
        buildableUnits = Infinity;
        for (const bc of selectedBom.bom_components) {
          const stock = stockByComponentId.get(bc.component_id);
          const available = stock?.available || 0;
          const canBuild = Math.floor(available / bc.qty_required);
          if (canBuild < buildableUnits) {
            buildableUnits = canBuild;
            bottleneckComponentId = bc.component_id;
          }
        }
        if (buildableUnits === Infinity) buildableUnits = 0;
      }

      const daysOfCover = buildableUnits !== null && result.demand?.units_per_day_pred > 0.01
        ? Math.round(buildableUnits / result.demand.units_per_day_pred)
        : null;

      if (buildableUnits !== null && buildableUnits < 3) {
        notes.push('Low stock - consider ordering components');
      }
      if (result.finance.fees_estimated) {
        notes.push('Fee rate estimated at 15% - actual may vary');
      }
      if (!selectedBom) {
        notes.push('No BOM matched - COGS unknown');
      }

      result.feasibility = {
        passes_min_margin: marginPercent === null || marginPercent >= scoringConfig.min_margin,
        buildable_units: buildableUnits,
        days_of_cover: daysOfCover,
        bottleneck_component_id: bottleneckComponentId,
        notes,
      };

      // Calculate score
      result.score = calculateScore({
        marginPercent,
        forecastUnitsHorizon: result.demand?.forecast_units_horizon,
        offerCount: result.keepa?.offer_count_14d_avg,
        priceVolatilityPct: result.keepa?.price_volatility_pct,
        buildableUnits,
        hasBom: !!selectedBom,
        hasPrice: !!pricePence,
        scoring: scoringConfig,
      });

      // Actions
      const suggestedNextStep = determineSuggestedAction(result);
      result.actions = {
        can_create_listing_memory: !existingListing && !!selectedBomId,
        can_add_to_review_queue: true,
        suggested_next_step: suggestedNextStep,
      };

      results.push(result);
    }

    // Sort results by score descending
    results.sort((a, b) => (b.score?.value || 0) - (a.score?.value || 0));

    sendSuccess(res, {
      results,
      meta: {
        total_analyzed: validAsins.length,
        unresolved_asins: unresolvedAsins,
        invalid_asins: invalidAsins,
        has_demand_model: !!demandModel,
        used_defaults: {
          location,
          scoring: scoringConfig,
          fee_rate: DEFAULT_FEE_RATE,
        },
      },
    });
  } catch (err) {
    console.error('[AsinAnalyzer] Analysis error:', err);
    errors.internal(res, 'Failed to analyze ASINs');
  }
});

// ============================================================================
// GET /asin/bom-candidates - BOM Suggestions for ASIN
// ============================================================================

router.get('/bom-candidates', requireStaff, async (req, res) => {
  const { asin } = req.query;

  if (!asin) {
    return errors.badRequest(res, 'asin query parameter is required');
  }

  const normalizedAsin = asin.toUpperCase().trim();
  if (!/^[A-Z0-9]{10}$/.test(normalizedAsin)) {
    return errors.badRequest(res, 'Invalid ASIN format');
  }

  try {
    // Get product title from cache
    const { data: productCache } = await supabase
      .from('keepa_products_cache')
      .select('payload_json')
      .eq('asin', normalizedAsin)
      .maybeSingle();

    const title = productCache?.payload_json?.title || null;

    // Parse title if available
    let parseIntent = null;
    if (title) {
      parseIntent = parseTitle(title);
    }

    // Get all active BOMs
    const { data: allBoms } = await supabase
      .from('boms')
      .select(`
        id,
        bundle_sku,
        description,
        bom_components (
          component_id,
          qty_required,
          components (
            internal_sku,
            description
          )
        )
      `)
      .eq('is_active', true);

    // Match BOMs
    const candidates = matchBomsByIntent(parseIntent, allBoms || []).slice(0, 5);

    sendSuccess(res, {
      asin: normalizedAsin,
      title,
      parse_intent: parseIntent,
      candidates,
    });
  } catch (err) {
    console.error('[AsinAnalyzer] BOM candidates error:', err);
    errors.internal(res, 'Failed to get BOM candidates');
  }
});

// ============================================================================
// POST /asin/reverse-search - Find Opportunities from Component
// ============================================================================

router.post('/reverse-search', requireStaff, async (req, res) => {
  const {
    component_id,
    location = 'Warehouse',
    horizon_days = 14,
  } = req.body;

  if (!component_id) {
    return errors.badRequest(res, 'component_id is required');
  }

  try {
    // 1. Find BOMs that use this component
    const { data: bomComponents } = await supabase
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
      .eq('component_id', component_id);

    const activeBomIds = (bomComponents || [])
      .filter(bc => bc.boms?.is_active)
      .map(bc => bc.bom_id);

    if (activeBomIds.length === 0) {
      return sendSuccess(res, {
        component_id,
        opportunities: [],
        message: 'No active BOMs use this component',
      });
    }

    // 2. Find listings that use these BOMs
    const { data: listings } = await supabase
      .from('listing_memory')
      .select(`
        id,
        asin,
        sku,
        title_fingerprint,
        bom_id,
        amazon_fee_percent,
        boms!inner (
          id,
          bundle_sku,
          bom_components (
            component_id,
            qty_required,
            components (
              id,
              internal_sku,
              cost_ex_vat_pence
            )
          )
        )
      `)
      .in('bom_id', activeBomIds)
      .eq('is_active', true);

    if (!listings || listings.length === 0) {
      return sendSuccess(res, {
        component_id,
        opportunities: [],
        message: 'No active listings linked to BOMs using this component',
      });
    }

    // 3. Get Keepa metrics for all ASINs
    const asins = listings.map(l => l.asin).filter(Boolean);
    const { data: keepaMetrics } = await supabase
      .from('keepa_metrics_daily')
      .select('asin, sales_rank, offer_count, buybox_price_pence')
      .in('asin', asins)
      .order('date', { ascending: false });

    const keepaByAsin = new Map();
    for (const row of keepaMetrics || []) {
      if (!keepaByAsin.has(row.asin)) {
        keepaByAsin.set(row.asin, row);
      }
    }

    // 4. Get component stock
    const { data: componentStock } = await supabase
      .from('component_stock')
      .select('component_id, on_hand, reserved')
      .eq('location', location);

    const stockByComponentId = new Map();
    for (const stock of componentStock || []) {
      stockByComponentId.set(stock.component_id, {
        available: stock.on_hand - stock.reserved,
      });
    }

    // 5. Get demand model
    const demandModel = await getActiveDemandModel();

    // 6. Calculate opportunities
    const opportunities = [];

    for (const listing of listings) {
      const keepa = keepaByAsin.get(listing.asin);
      if (!keepa) continue;

      // Calculate COGS
      let cogsPence = 0;
      for (const bc of listing.boms?.bom_components || []) {
        cogsPence += (bc.components?.cost_ex_vat_pence || 0) * bc.qty_required;
      }

      // Calculate buildable units
      let buildableUnits = Infinity;
      for (const bc of listing.boms?.bom_components || []) {
        const stock = stockByComponentId.get(bc.component_id);
        const available = stock?.available || 0;
        const canBuild = Math.floor(available / bc.qty_required);
        buildableUnits = Math.min(buildableUnits, canBuild);
      }
      if (buildableUnits === Infinity) buildableUnits = 0;

      // Predict demand
      let unitsPerDay = 0;
      if (demandModel && keepa.sales_rank) {
        const prediction = predictUnitsPerDayFromMetrics({
          salesRank: keepa.sales_rank,
          offerCount: keepa.offer_count,
          buyboxPricePence: keepa.buybox_price_pence,
          model: demandModel,
        });
        unitsPerDay = prediction.units_per_day_pred || 0;
      }

      // Calculate profit
      const pricePence = keepa.buybox_price_pence;
      const feeRate = listing.amazon_fee_percent
        ? listing.amazon_fee_percent / 100
        : DEFAULT_FEE_RATE;
      const feesPence = pricePence ? Math.round(pricePence * feeRate) : 0;
      const profitPerUnitPence = pricePence ? pricePence - cogsPence - feesPence : 0;

      // Calculate opportunity score
      const forecastUnits = unitsPerDay * horizon_days;
      const expectedProfitPence = profitPerUnitPence * forecastUnits;
      const daysOfCover = unitsPerDay > 0.01 ? Math.round(buildableUnits / unitsPerDay) : null;

      opportunities.push({
        listing_memory_id: listing.id,
        asin: listing.asin,
        sku: listing.sku,
        title: listing.title_fingerprint || listing.boms?.bundle_sku,
        bom_id: listing.bom_id,
        bom_sku: listing.boms?.bundle_sku,
        price_pence: pricePence,
        cogs_pence: cogsPence,
        profit_per_unit_pence: profitPerUnitPence,
        margin_percent: pricePence ? Math.round((profitPerUnitPence / pricePence) * 1000) / 10 : null,
        forecast_units: Math.round(forecastUnits * 10) / 10,
        expected_profit_pence: Math.round(expectedProfitPence),
        buildable_units: buildableUnits,
        days_of_cover: daysOfCover,
        sales_rank: keepa.sales_rank,
        offer_count: keepa.offer_count,
      });
    }

    // Sort by expected profit descending
    opportunities.sort((a, b) => b.expected_profit_pence - a.expected_profit_pence);

    sendSuccess(res, {
      component_id,
      horizon_days,
      location,
      opportunities,
      total_count: opportunities.length,
    });
  } catch (err) {
    console.error('[AsinAnalyzer] Reverse search error:', err);
    errors.internal(res, 'Failed to perform reverse search');
  }
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Match BOMs by parsed title intent
 */
function matchBomsByIntent(parseIntent, boms) {
  const candidates = [];

  for (const bom of boms) {
    let score = 0;
    const rationale = [];

    // Match by component SKUs in description
    const bomDesc = (bom.description || '').toLowerCase();
    const bomSku = (bom.bundle_sku || '').toLowerCase();

    // Check for brand match
    if (parseIntent?.brand) {
      const brand = parseIntent.brand.toLowerCase();
      if (bomDesc.includes(brand) || bomSku.includes(brand)) {
        score += 20;
        rationale.push(`Brand match: ${parseIntent.brand}`);
      }
    }

    // Check for tool type match
    if (parseIntent?.tool_core) {
      const toolType = parseIntent.tool_core.toLowerCase().replace('_', ' ');
      if (bomDesc.includes(toolType) || bomSku.includes(toolType)) {
        score += 30;
        rationale.push(`Tool type match: ${parseIntent.tool_core}`);
      }
    }

    // Check for voltage match
    if (parseIntent?.voltage) {
      const voltageStr = `${parseIntent.voltage}v`;
      if (bomDesc.includes(voltageStr) || bomSku.includes(voltageStr)) {
        score += 15;
        rationale.push(`Voltage match: ${parseIntent.voltage}V`);
      }
    }

    // Check for battery count
    if (parseIntent?.battery_qty !== null) {
      const batteryStr = `${parseIntent.battery_qty}x`;
      if (bomDesc.includes(batteryStr) || bomSku.includes(batteryStr)) {
        score += 15;
        rationale.push(`Battery qty match: ${parseIntent.battery_qty}`);
      }
    }

    // Check for bare tool
    if (parseIntent?.bare_tool === true) {
      if (bomDesc.includes('body') || bomDesc.includes('bare') || bomSku.includes('body')) {
        score += 20;
        rationale.push('Bare tool match');
      }
    }

    // Check for kit
    if (parseIntent?.kit === true) {
      if (bomDesc.includes('kit') || bomSku.includes('kit')) {
        score += 10;
        rationale.push('Kit match');
      }
    }

    // Check for charger
    if (parseIntent?.charger_included === true) {
      if (bomDesc.includes('charger') || bomSku.includes('charger')) {
        score += 10;
        rationale.push('Charger match');
      }
    }

    // Check for case
    if (parseIntent?.case_included === true) {
      if (bomDesc.includes('case') || bomDesc.includes('makpac')) {
        score += 10;
        rationale.push('Case match');
      }
    }

    // Determine confidence
    let confidence = 'LOW';
    if (score >= 60) confidence = 'HIGH';
    else if (score >= 30) confidence = 'MEDIUM';

    if (score > 0) {
      candidates.push({
        bom_id: bom.id,
        bom_sku: bom.bundle_sku,
        bom_description: bom.description,
        score,
        confidence,
        rationale,
      });
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  return candidates;
}

export default router;
