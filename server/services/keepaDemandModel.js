/**
 * Keepa Demand Model Service
 *
 * Trains and predicts demand (units/day) from Keepa market signals using
 * calibrated log-linear ridge regression. Trained daily on internal sales data.
 *
 * Features:
 * - ln_rank: log(sales_rank + 100)
 * - ln_offer: log(offer_count + 1)
 * - ln_price: log((buybox_price_pence/100) + 1) -- in pounds for scale
 *
 * Target: ln(units_per_day + 0.02)
 */

import supabase from './supabase.js';
import { recordSystemEvent } from './audit.js';
import {
  EPS,
  mean,
  std,
  median,
  fitRidgeRegression,
  isHoldout,
  predictUnitsPerDayFromMetrics,
} from '../utils/demandModelMath.js';

// Default settings
const DEFAULT_SETTINGS = {
  demand_model_enabled: 'true',
  demand_model_refresh_minutes: '1440',
  demand_model_lookback_days: '60',
  demand_model_min_asins: '50',
  demand_model_ridge_lambda: '1',
  domain_id: '2',  // UK (amazon.co.uk)
};

// ============================================================================
// SETTINGS MANAGEMENT
// ============================================================================

/**
 * Get demand model settings from keepa_settings table
 */
export async function getDemandModelSettings() {
  try {
    const { data, error } = await supabase
      .from('keepa_settings')
      .select('setting_key, setting_value');

    if (error) throw error;

    const settings = { ...DEFAULT_SETTINGS };
    for (const row of data || []) {
      settings[row.setting_key] = row.setting_value;
    }

    return {
      enabled: settings.demand_model_enabled === 'true',
      refreshMinutes: parseInt(settings.demand_model_refresh_minutes, 10) || 1440,
      lookbackDays: parseInt(settings.demand_model_lookback_days, 10) || 60,
      minAsins: parseInt(settings.demand_model_min_asins, 10) || 50,
      ridgeLambda: parseFloat(settings.demand_model_ridge_lambda) || 1,
      domainId: parseInt(settings.domain_id, 10) || 2,  // UK default
    };
  } catch (err) {
    console.error('[DemandModel] Failed to load settings:', err);
    return {
      enabled: true,
      refreshMinutes: 1440,
      lookbackDays: 60,
      minAsins: 50,
      ridgeLambda: 1,
      domainId: 2,  // UK (amazon.co.uk)
    };
  }
}

/**
 * Get active demand model for a domain
 */
export async function getActiveDemandModel(domainId = 2) {  // UK default
  try {
    const { data, error } = await supabase
      .from('keepa_demand_model_runs')
      .select('*')
      .eq('domain_id', domainId)
      .eq('is_active', true)
      .maybeSingle();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('[DemandModel] Failed to get active model:', err);
    return null;
  }
}


// ============================================================================
// TRAINING DATA CONSTRUCTION
// ============================================================================

/**
 * Build training dataset from orders and Keepa metrics
 */
async function buildTrainingData(domainId, lookbackDays) {
  const trainedTo = new Date();
  trainedTo.setDate(trainedTo.getDate() - 1); // Exclude today
  const trainedToStr = trainedTo.toISOString().split('T')[0];

  const trainedFrom = new Date(trainedTo);
  trainedFrom.setDate(trainedFrom.getDate() - lookbackDays + 1);
  const trainedFromStr = trainedFrom.toISOString().split('T')[0];

  console.log(`[DemandModel] Building training data: ${trainedFromStr} to ${trainedToStr}`);

  // Step 1: Load SKU -> ASIN mapping from listing_memory
  const { data: listings } = await supabase
    .from('listing_memory')
    .select('sku, asin')
    .eq('is_active', true)
    .not('sku', 'is', null)
    .not('asin', 'is', null);

  const skuToAsin = new Map();
  for (const listing of listings || []) {
    if (listing.sku && listing.asin) {
      skuToAsin.set(listing.sku, listing.asin);
    }
  }
  console.log(`[DemandModel] Loaded ${skuToAsin.size} SKU->ASIN mappings`);

  // Step 2: Get sales data from order_lines
  const { data: orderLines, error: salesError } = await supabase
    .from('order_lines')
    .select(`
      asin,
      sku,
      quantity,
      unit_price_pence,
      orders!inner (
        channel,
        order_date,
        status
      )
    `)
    .eq('orders.channel', 'AMAZON')
    .gte('orders.order_date', trainedFromStr)
    .lte('orders.order_date', trainedToStr)
    .not('orders.status', 'eq', 'CANCELLED');

  if (salesError) {
    throw new Error(`Failed to fetch sales data: ${salesError.message}`);
  }

  // Aggregate sales by ASIN
  const salesByAsin = new Map();
  let skuMapped = 0;

  for (const line of orderLines || []) {
    // Determine ASIN (prefer line.asin, fallback to SKU mapping)
    let asin = line.asin;
    if (!asin && line.sku) {
      asin = skuToAsin.get(line.sku);
      if (asin) skuMapped++;
    }

    if (!asin) continue;

    if (!salesByAsin.has(asin)) {
      salesByAsin.set(asin, {
        units_total: 0,
        revenue_total: 0,
        price_count: 0,
      });
    }

    const data = salesByAsin.get(asin);
    data.units_total += line.quantity || 1;
    if (line.unit_price_pence) {
      data.revenue_total += line.unit_price_pence * (line.quantity || 1);
      data.price_count += line.quantity || 1;
    }
  }

  console.log(`[DemandModel] Found ${salesByAsin.size} ASINs with sales (${skuMapped} via SKU mapping)`);

  // Step 3: Get Keepa metrics for these ASINs
  const asins = Array.from(salesByAsin.keys());
  if (asins.length === 0) {
    return {
      trainRows: [],
      holdoutRows: [],
      trainedFrom: trainedFromStr,
      trainedTo: trainedToStr,
      summary: {
        asins_total: 0,
        rows_total: 0,
        dropped_missing_keepa: 0,
        dropped_zero_sales: 0,
        sku_mapped: skuMapped,
      },
    };
  }

  const { data: keepaMetrics, error: keepaError } = await supabase
    .from('keepa_metrics_daily')
    .select('asin, date, sales_rank, offer_count, buybox_price_pence')
    .in('asin', asins)
    .gte('date', trainedFromStr)
    .lte('date', trainedToStr);

  if (keepaError) {
    throw new Error(`Failed to fetch Keepa metrics: ${keepaError.message}`);
  }

  // Aggregate Keepa metrics per ASIN (median of each feature)
  const keepaByAsin = new Map();
  for (const row of keepaMetrics || []) {
    if (!keepaByAsin.has(row.asin)) {
      keepaByAsin.set(row.asin, {
        ranks: [],
        offers: [],
        prices: [],
      });
    }
    const data = keepaByAsin.get(row.asin);
    if (row.sales_rank != null) data.ranks.push(row.sales_rank);
    if (row.offer_count != null) data.offers.push(row.offer_count);
    if (row.buybox_price_pence != null) data.prices.push(row.buybox_price_pence);
  }

  // Step 4: Build training rows
  const trainRows = [];
  const holdoutRows = [];
  let droppedMissingKeepa = 0;

  for (const [asin, sales] of salesByAsin.entries()) {
    // Skip zero-sales ASINs (shouldn't exist but safety check)
    if (sales.units_total <= 0) continue;

    // Get Keepa aggregates
    const keepa = keepaByAsin.get(asin);
    if (!keepa || keepa.ranks.length === 0) {
      droppedMissingKeepa++;
      continue;
    }

    const rankAgg = median(keepa.ranks);
    const offerAgg = keepa.offers.length > 0 ? median(keepa.offers) : null;
    let priceAgg = keepa.prices.length > 0 ? median(keepa.prices) : null;

    // Fallback price to ASP if no Keepa price
    if (priceAgg === null && sales.price_count > 0) {
      priceAgg = Math.round(sales.revenue_total / sales.price_count);
    }

    // Skip if no rank (required feature)
    if (rankAgg === null) {
      droppedMissingKeepa++;
      continue;
    }

    // Compute features
    const unitsPerDay = sales.units_total / lookbackDays;
    const y = Math.log(unitsPerDay + EPS);
    const lnRank = Math.log(rankAgg + 100);
    const lnOffer = Math.log((offerAgg || 0) + 1);
    const lnPrice = priceAgg != null ? Math.log((priceAgg / 100) + 1) : null;

    const row = {
      asin,
      units_total: sales.units_total,
      units_per_day: unitsPerDay,
      y,
      ln_rank: lnRank,
      ln_offer: lnOffer,
      ln_price: lnPrice,
      rank_agg: rankAgg,
      offer_agg: offerAgg,
      price_agg: priceAgg,
    };

    // Split into train/holdout
    if (isHoldout(asin)) {
      holdoutRows.push(row);
    } else {
      trainRows.push(row);
    }
  }

  console.log(`[DemandModel] Train rows: ${trainRows.length}, Holdout rows: ${holdoutRows.length}`);
  console.log(`[DemandModel] Dropped (missing Keepa): ${droppedMissingKeepa}`);

  return {
    trainRows,
    holdoutRows,
    trainedFrom: trainedFromStr,
    trainedTo: trainedToStr,
    summary: {
      asins_total: asins.length,
      rows_total: trainRows.length + holdoutRows.length,
      dropped_missing_keepa: droppedMissingKeepa,
      dropped_zero_sales: 0,
      sku_mapped: skuMapped,
    },
  };
}

// ============================================================================
// MODEL TRAINING
// ============================================================================

/**
 * Train a new demand model run
 *
 * @param {Object} options
 * @param {number} options.domainId - Keepa domain ID (default: 2 = UK amazon.co.uk)
 * @param {number} options.lookbackDays - Days to look back for training
 * @param {number} options.ridgeLambda - Ridge regularization parameter
 * @param {number} options.minAsins - Minimum ASINs required to train
 * @returns {Object} - Training result with model info and metrics
 */
export async function trainDemandModelRun({
  domainId = 2,  // UK (amazon.co.uk)
  lookbackDays = 60,
  ridgeLambda = 1,
  minAsins = 50,
} = {}) {
  console.log(`[DemandModel] Starting training: domain=${domainId}, lookback=${lookbackDays}, lambda=${ridgeLambda}`);

  // Build training data
  const {
    trainRows,
    holdoutRows,
    trainedFrom,
    trainedTo,
    summary,
  } = await buildTrainingData(domainId, lookbackDays);

  // Check minimum ASINs requirement
  if (trainRows.length < minAsins) {
    const msg = `Insufficient training data: ${trainRows.length} ASINs (need ${minAsins})`;
    console.warn(`[DemandModel] ${msg}`);
    await recordSystemEvent({
      eventType: 'KEEPA_DEMAND_MODEL_TRAINING_FAILED',
      description: msg,
      severity: 'WARN',
      metadata: { ...summary, required: minAsins },
    });
    throw new Error(msg);
  }

  // Define feature names (excluding intercept)
  const featureNames = ['ln_rank', 'ln_offer', 'ln_price'];

  // Filter rows with all features present
  const validTrainRows = trainRows.filter(r =>
    r.ln_rank != null && r.ln_offer != null && r.ln_price != null
  );

  if (validTrainRows.length < minAsins) {
    const msg = `Insufficient valid training rows: ${validTrainRows.length} (need ${minAsins})`;
    throw new Error(msg);
  }

  // Compute feature means and stds for standardization
  const featureMeans = {};
  const featureStds = {};

  for (const fname of featureNames) {
    const values = validTrainRows.map(r => r[fname]);
    featureMeans[fname] = mean(values);
    featureStds[fname] = std(values, featureMeans[fname]);
  }

  // Build design matrix X (with intercept column)
  const X = validTrainRows.map(row => {
    const zLnRank = (row.ln_rank - featureMeans.ln_rank) / featureStds.ln_rank;
    const zLnOffer = (row.ln_offer - featureMeans.ln_offer) / featureStds.ln_offer;
    const zLnPrice = (row.ln_price - featureMeans.ln_price) / featureStds.ln_price;
    return [1, zLnRank, zLnOffer, zLnPrice]; // 1 for intercept
  });

  // Target vector
  const y = validTrainRows.map(r => r.y);

  // Fit model
  console.log(`[DemandModel] Fitting ridge regression on ${X.length} rows...`);
  const beta = fitRidgeRegression(X, y, ridgeLambda);

  const coefficients = {
    intercept: beta[0],
    ln_rank: beta[1],
    ln_offer: beta[2],
    ln_price: beta[3],
  };

  console.log(`[DemandModel] Coefficients:`, coefficients);

  // Evaluate on holdout set
  const validHoldoutRows = holdoutRows.filter(r =>
    r.ln_rank != null && r.ln_offer != null && r.ln_price != null
  );

  const metrics = computeMetrics(validHoldoutRows, coefficients, featureMeans, featureStds);
  console.log(`[DemandModel] Holdout metrics:`, metrics);

  // Store model in database
  const modelData = {
    domain_id: domainId,
    model_name: 'rank_loglinear_ridge_v1',
    lookback_days: lookbackDays,
    trained_from: trainedFrom,
    trained_to: trainedTo,
    feature_names: featureNames,
    feature_means: featureMeans,
    feature_stds: featureStds,
    coefficients: coefficients,
    ridge_lambda: ridgeLambda,
    training_summary: summary,
    metrics: metrics,
    is_active: false, // Will activate after insert
    trained_at: new Date().toISOString(),
  };

  // Insert new model run
  const { data: insertedModel, error: insertError } = await supabase
    .from('keepa_demand_model_runs')
    .insert(modelData)
    .select()
    .single();

  if (insertError) {
    throw new Error(`Failed to insert model: ${insertError.message}`);
  }

  // Deactivate previous models
  await supabase
    .from('keepa_demand_model_runs')
    .update({ is_active: false })
    .eq('domain_id', domainId)
    .neq('id', insertedModel.id);

  // Activate new model
  await supabase
    .from('keepa_demand_model_runs')
    .update({ is_active: true })
    .eq('id', insertedModel.id);

  // Record system event
  await recordSystemEvent({
    eventType: 'KEEPA_DEMAND_MODEL_TRAINED',
    description: `Trained demand model on ${summary.rows_total} ASINs (holdout MAE: ${metrics.holdout_mae?.toFixed(3) || 'N/A'})`,
    metadata: {
      model_id: insertedModel.id,
      trained_from: trainedFrom,
      trained_to: trainedTo,
      training_summary: summary,
      metrics: metrics,
      coefficients: coefficients,
    },
  });

  return {
    model_id: insertedModel.id,
    domain_id: domainId,
    model_name: 'rank_loglinear_ridge_v1',
    trained_from: trainedFrom,
    trained_to: trainedTo,
    training_summary: summary,
    metrics: metrics,
    coefficients: coefficients,
  };
}

/**
 * Compute evaluation metrics on holdout set
 */
function computeMetrics(holdoutRows, coefficients, featureMeans, featureStds) {
  if (holdoutRows.length === 0) {
    return {
      holdout_count: 0,
      holdout_mae: null,
      holdout_rmse: null,
      holdout_r2_log: null,
      holdout_mape_nonzero: null,
    };
  }

  const predictions = [];
  const actuals = [];
  const actualsUnits = [];
  const predsUnits = [];

  for (const row of holdoutRows) {
    // Predict y (log scale)
    const yPred = predictLogUnits(row, coefficients, featureMeans, featureStds);
    const yActual = row.y;

    predictions.push(yPred);
    actuals.push(yActual);

    // Convert back to units scale
    const unitsActual = row.units_per_day;
    const unitsPred = Math.max(0, Math.exp(yPred) - EPS);

    actualsUnits.push(unitsActual);
    predsUnits.push(unitsPred);
  }

  // MAE on units scale
  let sumAbsError = 0;
  for (let i = 0; i < actualsUnits.length; i++) {
    sumAbsError += Math.abs(actualsUnits[i] - predsUnits[i]);
  }
  const mae = sumAbsError / actualsUnits.length;

  // RMSE on units scale
  let sumSqError = 0;
  for (let i = 0; i < actualsUnits.length; i++) {
    sumSqError += (actualsUnits[i] - predsUnits[i]) ** 2;
  }
  const rmse = Math.sqrt(sumSqError / actualsUnits.length);

  // R² on log scale
  const yMean = mean(actuals);
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < actuals.length; i++) {
    ssRes += (actuals[i] - predictions[i]) ** 2;
    ssTot += (actuals[i] - yMean) ** 2;
  }
  const r2Log = ssTot > 0 ? 1 - ssRes / ssTot : null;

  // MAPE on non-zero actuals only
  let sumPctError = 0;
  let nonZeroCount = 0;
  for (let i = 0; i < actualsUnits.length; i++) {
    if (actualsUnits[i] > 0.01) { // Threshold for "non-zero"
      sumPctError += Math.abs(actualsUnits[i] - predsUnits[i]) / actualsUnits[i];
      nonZeroCount++;
    }
  }
  const mapeNonZero = nonZeroCount > 0 ? (sumPctError / nonZeroCount) * 100 : null;

  return {
    holdout_count: holdoutRows.length,
    holdout_mae: mae,
    holdout_rmse: rmse,
    holdout_r2_log: r2Log,
    holdout_mape_nonzero: mapeNonZero,
  };
}

/**
 * Predict y (log units) for a single row
 */
function predictLogUnits(row, coefficients, featureMeans, featureStds) {
  const zLnRank = (row.ln_rank - featureMeans.ln_rank) / featureStds.ln_rank;
  const zLnOffer = (row.ln_offer - featureMeans.ln_offer) / featureStds.ln_offer;
  const zLnPrice = (row.ln_price - featureMeans.ln_price) / featureStds.ln_price;

  return coefficients.intercept +
    coefficients.ln_rank * zLnRank +
    coefficients.ln_offer * zLnOffer +
    coefficients.ln_price * zLnPrice;
}

// ============================================================================
// PREDICTION
// ============================================================================

/**
 * Predict units/day for a specific ASIN using active model and latest Keepa data
 *
 * @param {Object} params
 * @param {string} params.asin - ASIN to predict
 * @param {string|null} params.date - Optional date to use (defaults to most recent)
 * @returns {Object} - Prediction result
 */
export async function predictUnitsPerDayForAsin({ asin, date = null }) {
  // Get active model
  const settings = await getDemandModelSettings();
  const model = await getActiveDemandModel(settings.domainId);

  if (!model) {
    return {
      asin,
      units_per_day_pred: null,
      error: 'No active demand model',
      model: null,
    };
  }

  // Get latest Keepa metrics for this ASIN
  let query = supabase
    .from('keepa_metrics_daily')
    .select('date, sales_rank, offer_count, buybox_price_pence')
    .eq('asin', asin)
    .order('date', { ascending: false })
    .limit(1);

  if (date) {
    query = query.lte('date', date);
  }

  const { data: keepaData, error: keepaError } = await query;

  if (keepaError) {
    return {
      asin,
      units_per_day_pred: null,
      error: `Failed to fetch Keepa data: ${keepaError.message}`,
      model: { id: model.id, trained_at: model.trained_at },
    };
  }

  const keepaRow = keepaData?.[0];
  if (!keepaRow) {
    return {
      asin,
      units_per_day_pred: null,
      error: 'No Keepa data found for ASIN',
      model: { id: model.id, trained_at: model.trained_at },
    };
  }

  // Make prediction
  const prediction = predictUnitsPerDayFromMetrics({
    salesRank: keepaRow.sales_rank,
    offerCount: keepaRow.offer_count,
    buyboxPricePence: keepaRow.buybox_price_pence,
    model,
  });

  return {
    asin,
    ...prediction,
    keepa_date: keepaRow.date,
    model: {
      id: model.id,
      model_name: model.model_name,
      trained_at: model.trained_at,
      trained_from: model.trained_from,
      trained_to: model.trained_to,
    },
  };
}

// Re-export utilities for testing and external use
export { fitRidgeRegression, predictUnitsPerDayFromMetrics, isHoldout, mean, std, median };
