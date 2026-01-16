/**
 * Unit tests for the Pool Allocation Algorithm
 *
 * Tests the fair distribution of shared component inventory
 * across multiple BOMs to prevent overselling.
 */

import {
  allocatePool,
  computeRecommendations,
  validateAllocation,
} from '../utils/poolAllocation.js';

describe('allocatePool', () => {
  describe('basic allocation', () => {
    it('should return empty map for empty members', () => {
      const pool = { pool_available: 10, members: [] };
      const result = allocatePool(pool);
      expect(result.size).toBe(0);
    });

    it('should return empty map for undefined members', () => {
      const pool = { pool_available: 10 };
      const result = allocatePool(pool);
      expect(result.size).toBe(0);
    });

    it('should allocate all to single member if buildable allows', () => {
      const pool = {
        pool_available: 10,
        members: [
          { bom_id: 'bom1', weight: 1, min_qty: 0, max_qty: null, buildable: 20, priority: 0 }
        ]
      };
      const result = allocatePool(pool);
      expect(result.get('bom1')).toBe(10);
    });

    it('should cap allocation by buildable quantity', () => {
      const pool = {
        pool_available: 10,
        members: [
          { bom_id: 'bom1', weight: 1, min_qty: 0, max_qty: null, buildable: 5, priority: 0 }
        ]
      };
      const result = allocatePool(pool);
      expect(result.get('bom1')).toBe(5);
    });

    it('should cap allocation by max_qty', () => {
      const pool = {
        pool_available: 10,
        members: [
          { bom_id: 'bom1', weight: 1, min_qty: 0, max_qty: 3, buildable: 20, priority: 0 }
        ]
      };
      const result = allocatePool(pool);
      expect(result.get('bom1')).toBe(3);
    });
  });

  describe('minimum guaranteed quantities', () => {
    it('should satisfy minimum quantities first (in priority order)', () => {
      const pool = {
        pool_available: 9,
        members: [
          { bom_id: 'bom1', weight: 1, min_qty: 5, max_qty: null, buildable: 20, priority: 10 },
          { bom_id: 'bom2', weight: 1, min_qty: 5, max_qty: null, buildable: 20, priority: 5 },
        ]
      };
      const result = allocatePool(pool);
      // Higher priority bom1 gets its min_qty first
      expect(result.get('bom1')).toBe(5);
      // bom2 gets remaining (9-5=4)
      expect(result.get('bom2')).toBe(4);
    });

    it('should respect buildable cap when allocating minimums', () => {
      const pool = {
        pool_available: 10,
        members: [
          { bom_id: 'bom1', weight: 1, min_qty: 5, max_qty: null, buildable: 3, priority: 10 },
          { bom_id: 'bom2', weight: 1, min_qty: 5, max_qty: null, buildable: 20, priority: 5 },
        ]
      };
      const result = allocatePool(pool);
      // bom1 can only build 3, so min is capped
      expect(result.get('bom1')).toBe(3);
      // bom2 gets its full min_qty (5) + remaining 2 from proportional allocation
      // Total = 8 after minimums, so remaining 2 distributed
      // Only bom2 can accept more (buildable=20, current=5)
      expect(result.get('bom2')).toBe(7);
    });
  });

  describe('weighted proportional allocation', () => {
    it('should distribute evenly with equal weights', () => {
      const pool = {
        pool_available: 10,
        members: [
          { bom_id: 'bom1', weight: 1, min_qty: 0, max_qty: null, buildable: 20, priority: 0 },
          { bom_id: 'bom2', weight: 1, min_qty: 0, max_qty: null, buildable: 20, priority: 0 },
        ]
      };
      const result = allocatePool(pool);
      expect(result.get('bom1')).toBe(5);
      expect(result.get('bom2')).toBe(5);
    });

    it('should allocate proportionally with different weights', () => {
      const pool = {
        pool_available: 12,
        members: [
          { bom_id: 'bom1', weight: 2, min_qty: 0, max_qty: null, buildable: 20, priority: 0 },
          { bom_id: 'bom2', weight: 1, min_qty: 0, max_qty: null, buildable: 20, priority: 0 },
        ]
      };
      const result = allocatePool(pool);
      // weight 2 vs 1 means 2/3 vs 1/3
      // 12 * 2/3 = 8, 12 * 1/3 = 4
      expect(result.get('bom1')).toBe(8);
      expect(result.get('bom2')).toBe(4);
    });

    it('should use largest remainder method for fair rounding', () => {
      const pool = {
        pool_available: 10,
        members: [
          { bom_id: 'bom1', weight: 1, min_qty: 0, max_qty: null, buildable: 20, priority: 0 },
          { bom_id: 'bom2', weight: 1, min_qty: 0, max_qty: null, buildable: 20, priority: 0 },
          { bom_id: 'bom3', weight: 1, min_qty: 0, max_qty: null, buildable: 20, priority: 0 },
        ]
      };
      const result = allocatePool(pool);
      // 10 / 3 = 3.33 each, largest remainder handles the extra unit
      const total = result.get('bom1') + result.get('bom2') + result.get('bom3');
      expect(total).toBe(10);
      // Each should get at least 3
      expect(result.get('bom1')).toBeGreaterThanOrEqual(3);
      expect(result.get('bom2')).toBeGreaterThanOrEqual(3);
      expect(result.get('bom3')).toBeGreaterThanOrEqual(3);
    });
  });

  describe('acceptance criteria: 5 BOMs with 9 units', () => {
    it('should ensure sum of recommended_qty <= pool_available', () => {
      const pool = {
        pool_available: 9,
        members: [
          { bom_id: 'bom1', weight: 1, min_qty: 0, max_qty: null, buildable: 10, priority: 0 },
          { bom_id: 'bom2', weight: 1, min_qty: 0, max_qty: null, buildable: 10, priority: 0 },
          { bom_id: 'bom3', weight: 1, min_qty: 0, max_qty: null, buildable: 10, priority: 0 },
          { bom_id: 'bom4', weight: 1, min_qty: 0, max_qty: null, buildable: 10, priority: 0 },
          { bom_id: 'bom5', weight: 1, min_qty: 0, max_qty: null, buildable: 10, priority: 0 },
        ]
      };
      const result = allocatePool(pool);
      const total = Array.from(result.values()).reduce((sum, qty) => sum + qty, 0);
      expect(total).toBeLessThanOrEqual(9);
      expect(total).toBe(9); // Should use all available when possible
    });

    it('should distribute 9 units across 5 equal-weight BOMs fairly', () => {
      const pool = {
        pool_available: 9,
        members: [
          { bom_id: 'bom1', weight: 1, min_qty: 0, max_qty: null, buildable: 10, priority: 0 },
          { bom_id: 'bom2', weight: 1, min_qty: 0, max_qty: null, buildable: 10, priority: 0 },
          { bom_id: 'bom3', weight: 1, min_qty: 0, max_qty: null, buildable: 10, priority: 0 },
          { bom_id: 'bom4', weight: 1, min_qty: 0, max_qty: null, buildable: 10, priority: 0 },
          { bom_id: 'bom5', weight: 1, min_qty: 0, max_qty: null, buildable: 10, priority: 0 },
        ]
      };
      const result = allocatePool(pool);

      // 9 / 5 = 1.8 each
      // Floor = 1 each (5 total), remainder = 0.8 each
      // 4 extra units to distribute via largest remainder
      const allocations = Array.from(result.values());
      const minAlloc = Math.min(...allocations);
      const maxAlloc = Math.max(...allocations);

      // Each should get at least 1 (floor)
      expect(minAlloc).toBeGreaterThanOrEqual(1);
      // No one should get more than 2 (floor + 1 extra)
      expect(maxAlloc).toBeLessThanOrEqual(2);
      // Total should be 9
      expect(allocations.reduce((a, b) => a + b, 0)).toBe(9);
    });

    it('should handle mixed priorities and minimums', () => {
      const pool = {
        pool_available: 9,
        members: [
          { bom_id: 'bom1', weight: 2, min_qty: 3, max_qty: null, buildable: 10, priority: 10 },
          { bom_id: 'bom2', weight: 1, min_qty: 0, max_qty: null, buildable: 10, priority: 5 },
          { bom_id: 'bom3', weight: 1, min_qty: 0, max_qty: null, buildable: 10, priority: 0 },
          { bom_id: 'bom4', weight: 1, min_qty: 0, max_qty: null, buildable: 10, priority: 0 },
          { bom_id: 'bom5', weight: 1, min_qty: 0, max_qty: null, buildable: 10, priority: 0 },
        ]
      };
      const result = allocatePool(pool);

      // bom1 has min_qty=3 and highest priority, so gets at least 3
      expect(result.get('bom1')).toBeGreaterThanOrEqual(3);

      // Total should be <= 9
      const total = Array.from(result.values()).reduce((sum, qty) => sum + qty, 0);
      expect(total).toBeLessThanOrEqual(9);
    });
  });

  describe('edge cases', () => {
    it('should handle zero pool available', () => {
      const pool = {
        pool_available: 0,
        members: [
          { bom_id: 'bom1', weight: 1, min_qty: 5, max_qty: null, buildable: 10, priority: 0 },
        ]
      };
      const result = allocatePool(pool);
      expect(result.get('bom1')).toBe(0);
    });

    it('should handle all buildable = 0', () => {
      const pool = {
        pool_available: 10,
        members: [
          { bom_id: 'bom1', weight: 1, min_qty: 0, max_qty: null, buildable: 0, priority: 0 },
          { bom_id: 'bom2', weight: 1, min_qty: 0, max_qty: null, buildable: 0, priority: 0 },
        ]
      };
      const result = allocatePool(pool);
      expect(result.get('bom1')).toBe(0);
      expect(result.get('bom2')).toBe(0);
    });

    it('should handle default weight when not specified', () => {
      const pool = {
        pool_available: 10,
        members: [
          { bom_id: 'bom1', min_qty: 0, max_qty: null, buildable: 20, priority: 0 },
          { bom_id: 'bom2', min_qty: 0, max_qty: null, buildable: 20, priority: 0 },
        ]
      };
      const result = allocatePool(pool);
      expect(result.get('bom1')).toBe(5);
      expect(result.get('bom2')).toBe(5);
    });
  });
});

describe('validateAllocation', () => {
  it('should return valid for correct allocation', () => {
    const pool = {
      pool_available: 10,
      members: [
        { bom_id: 'bom1', buildable: 10, max_qty: null, min_qty: 0 },
      ]
    };
    const allocation = new Map([['bom1', 10]]);
    const result = validateAllocation(pool, allocation);
    expect(result.valid).toBe(true);
    expect(result.totalAllocated).toBe(10);
    expect(result.utilizationPercent).toBe(100);
  });

  it('should detect over-allocation', () => {
    const pool = {
      pool_available: 10,
      members: [
        { bom_id: 'bom1', buildable: 20, max_qty: null, min_qty: 0 },
      ]
    };
    const allocation = new Map([['bom1', 15]]);
    const result = validateAllocation(pool, allocation);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.type === 'OVER_ALLOCATION')).toBe(true);
  });

  it('should detect exceeding buildable cap', () => {
    const pool = {
      pool_available: 20,
      members: [
        { bom_id: 'bom1', bundle_sku: 'SKU1', buildable: 5, max_qty: null, min_qty: 0 },
      ]
    };
    const allocation = new Map([['bom1', 10]]);
    const result = validateAllocation(pool, allocation);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.type === 'EXCEEDS_CAP')).toBe(true);
  });

  it('should detect below minimum when pool has enough', () => {
    const pool = {
      pool_available: 20,
      members: [
        { bom_id: 'bom1', bundle_sku: 'SKU1', buildable: 20, max_qty: null, min_qty: 10 },
      ]
    };
    const allocation = new Map([['bom1', 5]]);
    const result = validateAllocation(pool, allocation);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.type === 'BELOW_MINIMUM')).toBe(true);
  });

  it('should not flag below minimum if pool is insufficient', () => {
    const pool = {
      pool_available: 5,
      members: [
        { bom_id: 'bom1', bundle_sku: 'SKU1', buildable: 20, max_qty: null, min_qty: 10 },
      ]
    };
    const allocation = new Map([['bom1', 5]]);
    const result = validateAllocation(pool, allocation);
    // Should be valid because pool didn't have enough for the minimum anyway
    expect(result.errors.filter(e => e.type === 'BELOW_MINIMUM').length).toBe(0);
  });
});

describe('computeRecommendations', () => {
  it('should combine pooled and non-pooled BOMs', () => {
    const poolData = {
      pools: [
        {
          pool_id: 'pool1',
          pool_name: 'DHR242Z Pool',
          pool_component_sku: 'DHR242Z',
          pool_available: 10,
          members: [
            {
              bom_id: 'bom1',
              bundle_sku: 'BUNDLE1',
              bom_description: 'Bundle 1',
              buildable: 5,
              weight: 1,
              min_qty: 0,
              max_qty: null,
              priority: 0,
              constraint_component_id: 'comp1',
              constraint_internal_sku: 'DHR242Z',
            },
          ],
        },
      ],
    };
    const nonPooledData = {
      boms: [
        {
          bom_id: 'bom2',
          bundle_sku: 'BUNDLE2',
          bom_description: 'Bundle 2',
          buildable: 10,
          constraint_component_id: 'comp2',
          constraint_internal_sku: 'OTHER',
        },
      ],
    };

    const result = computeRecommendations(poolData, nonPooledData);

    expect(result.length).toBe(2);

    const bom1 = result.find(r => r.bom_id === 'bom1');
    expect(bom1).toBeDefined();
    expect(bom1.pool_id).toBe('pool1');
    expect(bom1.pool_name).toBe('DHR242Z Pool');
    expect(bom1.recommended_qty).toBe(5); // Capped by buildable

    const bom2 = result.find(r => r.bom_id === 'bom2');
    expect(bom2).toBeDefined();
    expect(bom2.pool_id).toBeNull();
    expect(bom2.recommended_qty).toBe(10); // Non-pooled gets full buildable
  });

  it('should sort by bundle_sku', () => {
    const poolData = { pools: [] };
    const nonPooledData = {
      boms: [
        { bom_id: 'bom1', bundle_sku: 'ZZZ', buildable: 5 },
        { bom_id: 'bom2', bundle_sku: 'AAA', buildable: 5 },
        { bom_id: 'bom3', bundle_sku: 'MMM', buildable: 5 },
      ],
    };

    const result = computeRecommendations(poolData, nonPooledData);

    expect(result[0].bundle_sku).toBe('AAA');
    expect(result[1].bundle_sku).toBe('MMM');
    expect(result[2].bundle_sku).toBe('ZZZ');
  });

  it('should handle empty inputs', () => {
    const result = computeRecommendations({}, {});
    expect(result).toEqual([]);
  });
});
