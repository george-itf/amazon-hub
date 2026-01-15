/**
 * Pool Allocation Algorithm
 *
 * Allocates shared component inventory across multiple BOMs fairly,
 * preventing overselling when multiple Amazon listings share the same
 * tool core component.
 *
 * Algorithm:
 * 1. Satisfy minimum guaranteed quantities (in priority order)
 * 2. Distribute remaining pool capacity by weights (proportional allocation)
 * 3. Cap each allocation by the BOM's buildable quantity
 * 4. Use largest remainder method for fair rounding
 */

/**
 * Allocate pool inventory across member BOMs
 *
 * @param {Object} pool - Pool data with available units and members
 * @param {number} pool.pool_available - Available units of the pool component
 * @param {Array} pool.members - Array of member BOMs
 * @param {string} pool.members[].bom_id - BOM identifier
 * @param {number} pool.members[].weight - Allocation weight (default 1.0)
 * @param {number} pool.members[].min_qty - Minimum guaranteed quantity
 * @param {number|null} pool.members[].max_qty - Maximum cap (null = no cap)
 * @param {number} pool.members[].buildable - BOM's buildable quantity
 * @param {number} pool.members[].priority - Priority for min allocation
 *
 * @returns {Map} Map of bom_id -> allocated quantity
 */
export function allocatePool(pool) {
  const { pool_available, members } = pool;

  if (!members || members.length === 0) {
    return new Map();
  }

  // Initialize allocation map
  const allocation = new Map();
  members.forEach(m => allocation.set(m.bom_id, 0));

  let remainingPool = pool_available;

  // Phase 1: Satisfy minimum guaranteed quantities (in priority order)
  const sortedByPriority = [...members].sort((a, b) => b.priority - a.priority);

  for (const member of sortedByPriority) {
    const minQty = member.min_qty || 0;
    const buildable = member.buildable || 0;
    const maxQty = member.max_qty !== null && member.max_qty !== undefined
      ? member.max_qty
      : Infinity;

    // Cap by buildable and max_qty
    const effectiveCap = Math.min(buildable, maxQty);
    const minToAllocate = Math.min(minQty, effectiveCap, remainingPool);

    if (minToAllocate > 0) {
      allocation.set(member.bom_id, minToAllocate);
      remainingPool -= minToAllocate;
    }
  }

  // If no remaining capacity, return current allocation
  if (remainingPool <= 0) {
    return allocation;
  }

  // Phase 2: Calculate remaining capacity for each member after minimums
  const eligibleMembers = members.filter(m => {
    const current = allocation.get(m.bom_id) || 0;
    const buildable = m.buildable || 0;
    const maxQty = m.max_qty !== null && m.max_qty !== undefined ? m.max_qty : Infinity;
    const cap = Math.min(buildable, maxQty);
    return current < cap;
  });

  if (eligibleMembers.length === 0) {
    return allocation;
  }

  // Phase 3: Weighted proportional allocation using largest remainder method
  const totalWeight = eligibleMembers.reduce((sum, m) => sum + (m.weight || 1), 0);

  if (totalWeight <= 0) {
    return allocation;
  }

  // Calculate ideal (fractional) allocations
  const idealAllocations = eligibleMembers.map(m => {
    const current = allocation.get(m.bom_id) || 0;
    const buildable = m.buildable || 0;
    const maxQty = m.max_qty !== null && m.max_qty !== undefined ? m.max_qty : Infinity;
    const cap = Math.min(buildable, maxQty);
    const remainingCap = cap - current;

    const weight = m.weight || 1;
    const idealShare = (weight / totalWeight) * remainingPool;
    const cappedShare = Math.min(idealShare, remainingCap);

    return {
      bom_id: m.bom_id,
      weight,
      idealShare: cappedShare,
      floor: Math.floor(cappedShare),
      remainder: cappedShare - Math.floor(cappedShare),
      remainingCap,
    };
  });

  // Allocate floor values first
  let allocatedFromPool = 0;
  for (const item of idealAllocations) {
    const current = allocation.get(item.bom_id) || 0;
    allocation.set(item.bom_id, current + item.floor);
    allocatedFromPool += item.floor;
  }

  // Distribute leftover units using largest remainder method
  let leftover = remainingPool - allocatedFromPool;

  // Sort by remainder descending for fair distribution
  const sortedByRemainder = [...idealAllocations]
    .filter(item => item.remainder > 0 && item.floor < item.remainingCap)
    .sort((a, b) => b.remainder - a.remainder);

  for (const item of sortedByRemainder) {
    if (leftover <= 0) break;

    const current = allocation.get(item.bom_id);
    const buildable = members.find(m => m.bom_id === item.bom_id)?.buildable || 0;
    const maxQty = members.find(m => m.bom_id === item.bom_id)?.max_qty;
    const cap = maxQty !== null && maxQty !== undefined
      ? Math.min(buildable, maxQty)
      : buildable;

    if (current < cap) {
      allocation.set(item.bom_id, current + 1);
      leftover--;
    }
  }

  return allocation;
}

/**
 * Compute full inventory recommendations for all BOMs
 *
 * @param {Object} poolData - Pool allocation data from RPC
 * @param {Object} nonPooledData - Non-pooled BOMs data from RPC
 * @returns {Array} Array of BOM recommendations
 */
export function computeRecommendations(poolData, nonPooledData) {
  const recommendations = [];

  // Process pooled BOMs
  for (const pool of poolData.pools || []) {
    const allocation = allocatePool(pool);

    for (const member of pool.members || []) {
      const recommendedQty = allocation.get(member.bom_id) || 0;

      recommendations.push({
        bom_id: member.bom_id,
        bundle_sku: member.bundle_sku,
        bom_description: member.bom_description,
        buildable: member.buildable,
        recommended_qty: recommendedQty,
        constraint_component_id: member.constraint_component_id,
        constraint_internal_sku: member.constraint_internal_sku,
        pool_id: pool.pool_id,
        pool_name: pool.pool_name,
        pool_component_sku: pool.pool_component_sku,
        pool_available: pool.pool_available,
        allocation_weight: member.weight,
        min_qty: member.min_qty,
        max_qty: member.max_qty,
      });
    }
  }

  // Add non-pooled BOMs (recommended_qty = buildable)
  for (const bom of nonPooledData.boms || []) {
    recommendations.push({
      bom_id: bom.bom_id,
      bundle_sku: bom.bundle_sku,
      bom_description: bom.bom_description,
      buildable: bom.buildable,
      recommended_qty: bom.buildable,
      constraint_component_id: bom.constraint_component_id,
      constraint_internal_sku: bom.constraint_internal_sku,
      pool_id: null,
      pool_name: null,
      pool_component_sku: null,
      pool_available: null,
      allocation_weight: null,
      min_qty: null,
      max_qty: null,
    });
  }

  // Sort by bundle_sku
  recommendations.sort((a, b) => (a.bundle_sku || '').localeCompare(b.bundle_sku || ''));

  return recommendations;
}

/**
 * Validate pool allocation result
 * Ensures sum of allocations for pooled component doesn't exceed available
 *
 * @param {Object} pool - Pool data
 * @param {Map} allocation - Allocation result
 * @returns {Object} Validation result
 */
export function validateAllocation(pool, allocation) {
  const totalAllocated = Array.from(allocation.values()).reduce((sum, qty) => sum + qty, 0);
  const poolAvailable = pool.pool_available || 0;

  const errors = [];

  // Check total doesn't exceed available
  if (totalAllocated > poolAvailable) {
    errors.push({
      type: 'OVER_ALLOCATION',
      message: `Total allocated (${totalAllocated}) exceeds pool available (${poolAvailable})`,
    });
  }

  // Check each allocation doesn't exceed buildable
  for (const member of pool.members || []) {
    const allocated = allocation.get(member.bom_id) || 0;
    const buildable = member.buildable || 0;
    const maxQty = member.max_qty !== null && member.max_qty !== undefined
      ? member.max_qty
      : Infinity;
    const cap = Math.min(buildable, maxQty);

    if (allocated > cap) {
      errors.push({
        type: 'EXCEEDS_CAP',
        bom_id: member.bom_id,
        message: `Allocation (${allocated}) exceeds cap (${cap}) for BOM ${member.bundle_sku}`,
      });
    }

    if (allocated < (member.min_qty || 0) && poolAvailable >= (member.min_qty || 0)) {
      errors.push({
        type: 'BELOW_MINIMUM',
        bom_id: member.bom_id,
        message: `Allocation (${allocated}) below minimum (${member.min_qty}) for BOM ${member.bundle_sku}`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    totalAllocated,
    poolAvailable,
    utilizationPercent: poolAvailable > 0
      ? Math.round((totalAllocated / poolAvailable) * 100)
      : 0,
    errors,
  };
}
