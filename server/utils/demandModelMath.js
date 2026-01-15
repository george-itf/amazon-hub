/**
 * Demand Model Math Utilities
 *
 * Pure mathematical functions for the demand calibration model.
 * These functions have no external dependencies and can be tested in isolation.
 */

// Small epsilon for log transform of units/day
export const EPS = 0.02;

// ============================================================================
// STATISTICS UTILITIES
// ============================================================================

/**
 * Compute mean of an array
 * @param {number[]} arr
 * @returns {number}
 */
export function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Compute standard deviation of an array
 * @param {number[]} arr
 * @param {number|null} meanVal - Optional pre-computed mean
 * @returns {number}
 */
export function std(arr, meanVal = null) {
  if (arr.length < 2) return 1; // Prevent division by zero
  const m = meanVal !== null ? meanVal : mean(arr);
  const variance = arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance) || 1; // Prevent zero std
}

/**
 * Compute median of an array
 * @param {number[]} arr
 * @returns {number|null}
 */
export function median(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// ============================================================================
// MATRIX ALGEBRA UTILITIES
// ============================================================================

/**
 * Transpose a matrix (2D array)
 * @param {number[][]} matrix
 * @returns {number[][]}
 */
export function transpose(matrix) {
  if (matrix.length === 0) return [];
  const rows = matrix.length;
  const cols = matrix[0].length;
  const result = [];
  for (let j = 0; j < cols; j++) {
    result[j] = [];
    for (let i = 0; i < rows; i++) {
      result[j][i] = matrix[i][j];
    }
  }
  return result;
}

/**
 * Multiply two matrices
 * @param {number[][]} A
 * @param {number[][]} B
 * @returns {number[][]}
 */
export function matMul(A, B) {
  const rowsA = A.length;
  const colsA = A[0].length;
  const colsB = B[0].length;
  const result = [];

  for (let i = 0; i < rowsA; i++) {
    result[i] = [];
    for (let j = 0; j < colsB; j++) {
      let sum = 0;
      for (let k = 0; k < colsA; k++) {
        sum += A[i][k] * B[k][j];
      }
      result[i][j] = sum;
    }
  }
  return result;
}

/**
 * Multiply matrix by vector, returns vector
 * @param {number[][]} A
 * @param {number[]} v
 * @returns {number[]}
 */
export function matVecMul(A, v) {
  const result = [];
  for (let i = 0; i < A.length; i++) {
    let sum = 0;
    for (let j = 0; j < A[i].length; j++) {
      sum += A[i][j] * v[j];
    }
    result[i] = sum;
  }
  return result;
}

/**
 * Add lambda * I to diagonal of a square matrix (in-place modification)
 * Skips first row/col (intercept) if skipIntercept is true
 * @param {number[][]} matrix
 * @param {number} lambda
 * @param {boolean} skipIntercept
 */
export function addRidgePenalty(matrix, lambda, skipIntercept = true) {
  const n = matrix.length;
  const start = skipIntercept ? 1 : 0;
  for (let i = start; i < n; i++) {
    matrix[i][i] += lambda;
  }
}

/**
 * Solve Ax = b using Gaussian elimination with partial pivoting
 * @param {number[][]} A
 * @param {number[]} b
 * @returns {number[]}
 */
export function solveLinearSystem(A, b) {
  const n = A.length;

  // Create augmented matrix
  const aug = A.map((row, i) => [...row, b[i]]);

  // Forward elimination with partial pivoting
  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxRow = col;
    let maxVal = Math.abs(aug[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > maxVal) {
        maxVal = Math.abs(aug[row][col]);
        maxRow = row;
      }
    }

    // Swap rows
    if (maxRow !== col) {
      [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    }

    // Check for singular matrix
    if (Math.abs(aug[col][col]) < 1e-10) {
      throw new Error('Matrix is singular or nearly singular');
    }

    // Eliminate below
    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / aug[col][col];
      for (let j = col; j <= n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // Back substitution
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = aug[i][n];
    for (let j = i + 1; j < n; j++) {
      x[i] -= aug[i][j] * x[j];
    }
    x[i] /= aug[i][i];
  }

  return x;
}

/**
 * Fit ridge regression: beta = (XᵀX + λI)⁻¹ Xᵀy
 *
 * @param {number[][]} X - Design matrix (n x p) with intercept column
 * @param {number[]} y - Target vector (n)
 * @param {number} lambda - Regularization parameter
 * @returns {number[]} - Coefficient vector (p)
 */
export function fitRidgeRegression(X, y, lambda = 1) {
  // XᵀX
  const Xt = transpose(X);
  const XtX = matMul(Xt, X);

  // Add ridge penalty (skip intercept)
  addRidgePenalty(XtX, lambda, true);

  // Xᵀy
  const Xty = matVecMul(Xt, y);

  // Solve (XᵀX + λI)β = Xᵀy
  return solveLinearSystem(XtX, Xty);
}

// ============================================================================
// HOLDOUT SPLIT
// ============================================================================

/**
 * Deterministic holdout split using hash of ASIN
 * Returns true if ASIN should be in holdout set (~20%)
 * @param {string} asin
 * @returns {boolean}
 */
export function isHoldout(asin) {
  // Simple string hash
  let hash = 0;
  for (let i = 0; i < asin.length; i++) {
    hash = ((hash << 5) - hash + asin.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 5) === 0;
}

// ============================================================================
// PREDICTION
// ============================================================================

/**
 * Predict units/day from raw Keepa metrics using a model
 *
 * @param {Object} params
 * @param {number} params.salesRank - Sales rank
 * @param {number|null} params.offerCount - Offer count
 * @param {number|null} params.buyboxPricePence - Buybox price in pence
 * @param {Object} params.model - Model object with coefficients, means, stds
 * @returns {Object} - {units_per_day_pred, y_log_pred, debug_features}
 */
export function predictUnitsPerDayFromMetrics({
  salesRank,
  offerCount,
  buyboxPricePence,
  model,
}) {
  // Handle missing model
  if (!model) {
    return {
      units_per_day_pred: null,
      y_log_pred: null,
      debug_features: null,
      error: 'No model provided',
    };
  }

  // Handle missing rank (required feature)
  if (salesRank == null) {
    return {
      units_per_day_pred: null,
      y_log_pred: null,
      debug_features: { sales_rank: null, offer_count: offerCount, buybox_price_pence: buyboxPricePence },
      error: 'Missing sales_rank',
    };
  }

  // Compute raw features
  const lnRank = Math.log(salesRank + 100);
  const lnOffer = Math.log((offerCount || 0) + 1);

  // Handle missing price - use mean from training
  let lnPrice;
  if (buyboxPricePence != null) {
    lnPrice = Math.log((buyboxPricePence / 100) + 1);
  } else {
    // Use training mean as fallback
    lnPrice = model.feature_means?.ln_price || 0;
  }

  const debugFeatures = {
    sales_rank: salesRank,
    offer_count: offerCount,
    buybox_price_pence: buyboxPricePence,
    ln_rank: lnRank,
    ln_offer: lnOffer,
    ln_price: lnPrice,
  };

  // Standardize features
  const { feature_means: means, feature_stds: stds, coefficients: coef } = model;

  const zLnRank = (lnRank - (means?.ln_rank || 0)) / (stds?.ln_rank || 1);
  const zLnOffer = (lnOffer - (means?.ln_offer || 0)) / (stds?.ln_offer || 1);
  const zLnPrice = (lnPrice - (means?.ln_price || 0)) / (stds?.ln_price || 1);

  debugFeatures.z_ln_rank = zLnRank;
  debugFeatures.z_ln_offer = zLnOffer;
  debugFeatures.z_ln_price = zLnPrice;

  // Predict log units
  const yLogPred = (coef?.intercept || 0) +
    (coef?.ln_rank || 0) * zLnRank +
    (coef?.ln_offer || 0) * zLnOffer +
    (coef?.ln_price || 0) * zLnPrice;

  // Convert to units scale
  const unitsPerDayPred = Math.max(0, Math.exp(yLogPred) - EPS);

  return {
    units_per_day_pred: unitsPerDayPred,
    y_log_pred: yLogPred,
    debug_features: debugFeatures,
    error: null,
  };
}
