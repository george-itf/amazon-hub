/**
 * Unit tests for Keepa Demand Model
 *
 * Tests the ridge regression fitting, prediction, and utility functions
 * used for calibrated demand forecasting.
 *
 * These tests import from the pure math utility file to avoid database dependencies.
 */

import {
  fitRidgeRegression,
  predictUnitsPerDayFromMetrics,
  isHoldout,
  mean,
  std,
  median,
} from '../utils/demandModelMath.js';

describe('fitRidgeRegression', () => {
  it('should fit a simple linear relationship', () => {
    // y = 2 + 3*x1 (with intercept column)
    const X = [
      [1, 0],
      [1, 1],
      [1, 2],
      [1, 3],
      [1, 4],
    ];
    const y = [2, 5, 8, 11, 14];

    const beta = fitRidgeRegression(X, y, 0.001); // Small lambda

    // Intercept should be close to 2, slope close to 3
    expect(beta[0]).toBeCloseTo(2, 0);
    expect(beta[1]).toBeCloseTo(3, 0);
  });

  it('should regularize coefficients with higher lambda', () => {
    // Same data, but with regularization
    const X = [
      [1, 0],
      [1, 1],
      [1, 2],
      [1, 3],
      [1, 4],
    ];
    const y = [2, 5, 8, 11, 14];

    const betaLow = fitRidgeRegression(X, y, 0.001);
    const betaHigh = fitRidgeRegression(X, y, 100);

    // Higher lambda should shrink the non-intercept coefficient
    expect(Math.abs(betaHigh[1])).toBeLessThan(Math.abs(betaLow[1]));
  });

  it('should handle multiple features', () => {
    // y = 1 + 2*x1 + 0.5*x2 (approximately)
    const X = [
      [1, 0, 0],
      [1, 1, 2],
      [1, 2, 4],
      [1, 3, 6],
      [1, 4, 8],
    ];
    const y = [1, 4, 7, 10, 13];

    const beta = fitRidgeRegression(X, y, 0.01);

    // Should have 3 coefficients
    expect(beta.length).toBe(3);

    // Predictions should be close to actual values
    for (let i = 0; i < X.length; i++) {
      const pred = beta[0] + beta[1] * X[i][1] + beta[2] * X[i][2];
      expect(pred).toBeCloseTo(y[i], 0);
    }
  });

  it('should return sane coefficients for rank->sales relationship', () => {
    // Simulate: higher rank (worse) = lower sales
    // y (log sales) decreases as ln_rank increases
    const X = [
      [1, 5, 1, 2],  // ln_rank=5 (rank ~50), ln_offer=1, ln_price=2
      [1, 7, 2, 2],  // ln_rank=7 (rank ~1000)
      [1, 9, 2, 2],  // ln_rank=9 (rank ~8000)
      [1, 11, 3, 2], // ln_rank=11 (rank ~60000)
      [1, 6, 1, 2],  // ln_rank=6 (rank ~300)
      [1, 8, 2, 2],  // ln_rank=8 (rank ~3000)
    ];
    const y = [2, 0.5, -0.5, -2, 1.5, 0]; // log(units_per_day + eps)

    const beta = fitRidgeRegression(X, y, 1);

    // ln_rank coefficient should be negative (higher rank = lower sales)
    expect(beta[1]).toBeLessThan(0);
  });
});

describe('predictUnitsPerDayFromMetrics', () => {
  const mockModel = {
    feature_means: {
      ln_rank: 8,
      ln_offer: 2,
      ln_price: 3,
    },
    feature_stds: {
      ln_rank: 2,
      ln_offer: 1,
      ln_price: 0.5,
    },
    coefficients: {
      intercept: 0,
      ln_rank: -0.5,  // Higher rank = lower sales
      ln_offer: -0.1, // More offers = more competition = lower sales
      ln_price: 0.2,  // Higher price = premium product = slightly higher sales
    },
  };

  it('should return prediction for valid inputs', () => {
    const result = predictUnitsPerDayFromMetrics({
      salesRank: 1000,
      offerCount: 5,
      buyboxPricePence: 2500,
      model: mockModel,
    });

    expect(result.error).toBeNull();
    expect(result.units_per_day_pred).toBeGreaterThanOrEqual(0);
    expect(result.y_log_pred).toBeDefined();
    expect(result.debug_features).toBeDefined();
  });

  it('should handle missing model', () => {
    const result = predictUnitsPerDayFromMetrics({
      salesRank: 1000,
      offerCount: 5,
      buyboxPricePence: 2500,
      model: null,
    });

    expect(result.error).toBe('No model provided');
    expect(result.units_per_day_pred).toBeNull();
  });

  it('should handle missing sales rank (required feature)', () => {
    const result = predictUnitsPerDayFromMetrics({
      salesRank: null,
      offerCount: 5,
      buyboxPricePence: 2500,
      model: mockModel,
    });

    expect(result.error).toBe('Missing sales_rank');
    expect(result.units_per_day_pred).toBeNull();
  });

  it('should handle missing offer count and price', () => {
    const result = predictUnitsPerDayFromMetrics({
      salesRank: 1000,
      offerCount: null,
      buyboxPricePence: null,
      model: mockModel,
    });

    // Should still work - uses defaults
    expect(result.error).toBeNull();
    expect(result.units_per_day_pred).toBeGreaterThanOrEqual(0);
  });

  it('should clamp prediction to >= 0', () => {
    // Model with coefficients that would produce very negative log output
    const extremeModel = {
      feature_means: { ln_rank: 5, ln_offer: 1, ln_price: 2 },
      feature_stds: { ln_rank: 1, ln_offer: 1, ln_price: 1 },
      coefficients: {
        intercept: -10,
        ln_rank: -2,
        ln_offer: -1,
        ln_price: -1,
      },
    };

    const result = predictUnitsPerDayFromMetrics({
      salesRank: 100000, // Very high rank
      offerCount: 50,
      buyboxPricePence: 500,
      model: extremeModel,
    });

    expect(result.units_per_day_pred).toBeGreaterThanOrEqual(0);
  });

  it('should produce higher predictions for better rank', () => {
    const resultGoodRank = predictUnitsPerDayFromMetrics({
      salesRank: 100,
      offerCount: 5,
      buyboxPricePence: 2500,
      model: mockModel,
    });

    const resultBadRank = predictUnitsPerDayFromMetrics({
      salesRank: 100000,
      offerCount: 5,
      buyboxPricePence: 2500,
      model: mockModel,
    });

    expect(resultGoodRank.units_per_day_pred).toBeGreaterThan(resultBadRank.units_per_day_pred);
  });
});

describe('isHoldout', () => {
  it('should return boolean for any ASIN', () => {
    const result1 = isHoldout('B001234567');
    const result2 = isHoldout('B009876543');

    expect(typeof result1).toBe('boolean');
    expect(typeof result2).toBe('boolean');
  });

  it('should be deterministic (same ASIN always returns same result)', () => {
    const asin = 'B00TESTASIN';
    const results = [];

    for (let i = 0; i < 10; i++) {
      results.push(isHoldout(asin));
    }

    // All results should be the same
    expect(new Set(results).size).toBe(1);
  });

  it('should produce approximately 20% holdout rate', () => {
    // Generate 1000 "random" ASINs and check holdout rate
    const asins = [];
    for (let i = 0; i < 1000; i++) {
      asins.push(`B00${String(i).padStart(7, '0')}`);
    }

    const holdoutCount = asins.filter(isHoldout).length;
    const holdoutRate = holdoutCount / asins.length;

    // Should be roughly 20% (hash mod 5 == 0)
    // Allow some variance due to hash distribution
    expect(holdoutRate).toBeGreaterThan(0.15);
    expect(holdoutRate).toBeLessThan(0.25);
  });

  it('should handle empty string', () => {
    const result = isHoldout('');
    expect(typeof result).toBe('boolean');
  });
});

describe('mean', () => {
  it('should calculate mean correctly', () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
    expect(mean([10, 20])).toBe(15);
    expect(mean([5])).toBe(5);
  });

  it('should handle empty array', () => {
    expect(mean([])).toBe(0);
  });

  it('should handle negative numbers', () => {
    expect(mean([-2, 0, 2])).toBe(0);
    expect(mean([-5, -3, -1])).toBeCloseTo(-3, 5);
  });
});

describe('std', () => {
  it('should calculate standard deviation correctly', () => {
    // [1, 2, 3, 4, 5] has mean=3, variance=2.5, std=sqrt(2.5)
    const result = std([1, 2, 3, 4, 5]);
    expect(result).toBeCloseTo(Math.sqrt(2.5), 5);
  });

  it('should return 1 for arrays with fewer than 2 elements', () => {
    expect(std([])).toBe(1);
    expect(std([5])).toBe(1);
  });

  it('should use provided mean if given', () => {
    const arr = [1, 2, 3, 4, 5];
    const m = mean(arr);
    const result = std(arr, m);
    expect(result).toBeCloseTo(Math.sqrt(2.5), 5);
  });
});

describe('median', () => {
  it('should find median of odd-length array', () => {
    expect(median([1, 2, 3, 4, 5])).toBe(3);
    expect(median([5, 1, 3])).toBe(3);
  });

  it('should find median of even-length array', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([10, 20])).toBe(15);
  });

  it('should handle single element', () => {
    expect(median([42])).toBe(42);
  });

  it('should return null for empty array', () => {
    expect(median([])).toBeNull();
  });

  it('should not modify original array', () => {
    const original = [5, 1, 3, 2, 4];
    const copy = [...original];
    median(original);
    expect(original).toEqual(copy);
  });
});
