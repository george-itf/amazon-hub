/**
 * Inventory Management Routes
 * Handles inventory pools and allocation recommendations
 */
import express from 'express';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { requireAdmin, requireStaff } from '../middleware/auth.js';
import { auditLog, getAuditContext } from '../services/audit.js';
import { allocatePool, computeRecommendations, validateAllocation } from '../utils/poolAllocation.js';

const router = express.Router();

// ============================================================================
// INVENTORY RECOMMENDATIONS
// ============================================================================

/**
 * GET /inventory/recommendations
 * Get per-BOM quantity recommendations based on pool allocations
 */
router.get('/recommendations', requireStaff, async (req, res) => {
  const { location = 'Warehouse' } = req.query;

  try {
    // Try RPC first for pool data
    let poolData = { pools: [] };
    let nonPooledData = { boms: [] };

    const { data: poolResult, error: poolError } = await supabase.rpc('rpc_get_pool_allocation_data', {
      p_location: location,
    });

    if (poolError) {
      // Fallback to manual calculation
      if (poolError.message?.includes('function') || poolError.code === '42883') {
        console.warn('rpc_get_pool_allocation_data not found - using fallback');
        poolData = await getPoolDataFallback(location);
      } else {
        throw poolError;
      }
    } else if (poolResult?.ok) {
      poolData = poolResult.data;
    }

    // Get non-pooled BOMs
    const { data: nonPooledResult, error: nonPooledError } = await supabase.rpc('rpc_get_non_pooled_boms', {
      p_location: location,
    });

    if (nonPooledError) {
      if (nonPooledError.message?.includes('function') || nonPooledError.code === '42883') {
        console.warn('rpc_get_non_pooled_boms not found - using fallback');
        nonPooledData = await getNonPooledBomsFallback(location);
      } else {
        throw nonPooledError;
      }
    } else if (nonPooledResult?.ok) {
      nonPooledData = nonPooledResult.data;
    }

    // Compute recommendations using the allocation algorithm
    const recommendations = computeRecommendations(poolData, nonPooledData);

    // Compute pool summaries with validation
    const poolSummaries = [];
    for (const pool of poolData.pools || []) {
      const allocation = allocatePool(pool);
      const validation = validateAllocation(pool, allocation);

      poolSummaries.push({
        pool_id: pool.pool_id,
        pool_name: pool.pool_name,
        pool_component_sku: pool.pool_component_sku,
        pool_available: pool.pool_available,
        total_allocated: validation.totalAllocated,
        utilization_percent: validation.utilizationPercent,
        member_count: pool.member_count,
        is_valid: validation.valid,
      });
    }

    sendSuccess(res, {
      recommendations,
      pools: poolSummaries,
      location,
      total_boms: recommendations.length,
      pooled_boms: recommendations.filter(r => r.pool_id).length,
      non_pooled_boms: recommendations.filter(r => !r.pool_id).length,
    });
  } catch (err) {
    console.error('Failed to get recommendations:', err);
    return errors.internal(res, `Failed to get recommendations: ${err.message}`);
  }
});

// ============================================================================
// INVENTORY POOLS CRUD
// ============================================================================

/**
 * GET /inventory/pools
 * List all inventory pools
 */
router.get('/pools', requireStaff, async (req, res) => {
  const { location, include_inactive = 'false' } = req.query;

  try {
    let query = supabase
      .from('inventory_pools')
      .select(`
        *,
        components:pool_component_id (
          id,
          internal_sku,
          description,
          brand
        ),
        inventory_pool_members (
          id,
          bom_id,
          weight,
          min_qty,
          max_qty,
          priority,
          is_active,
          boms (
            id,
            bundle_sku,
            description,
            is_active
          )
        )
      `)
      .order('name');

    if (location) {
      query = query.eq('location', location);
    }

    if (include_inactive !== 'true') {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;

    if (error) {
      // Table might not exist yet
      if (error.code === '42P01') {
        return sendSuccess(res, { pools: [], total: 0 });
      }
      throw error;
    }

    // Enrich with member count and stock info
    const enrichedPools = await Promise.all(
      (data || []).map(async (pool) => {
        // Get stock for pool component
        const { data: stock } = await supabase
          .from('component_stock')
          .select('on_hand, reserved')
          .eq('component_id', pool.pool_component_id)
          .eq('location', pool.location)
          .maybeSingle();

        const activeMembers = (pool.inventory_pool_members || [])
          .filter(m => m.is_active && m.boms?.is_active);

        return {
          ...pool,
          pool_on_hand: stock?.on_hand || 0,
          pool_reserved: stock?.reserved || 0,
          pool_available: Math.max(0, (stock?.on_hand || 0) - (stock?.reserved || 0)),
          active_member_count: activeMembers.length,
          total_weight: activeMembers.reduce((sum, m) => sum + (m.weight || 1), 0),
        };
      })
    );

    sendSuccess(res, {
      pools: enrichedPools,
      total: enrichedPools.length,
    });
  } catch (err) {
    console.error('Failed to list pools:', err);
    return errors.internal(res, `Failed to list pools: ${err.message}`);
  }
});

/**
 * GET /inventory/pools/:id
 * Get a specific pool with full details
 */
router.get('/pools/:id', requireStaff, async (req, res) => {
  const { id } = req.params;

  try {
    const { data: pool, error } = await supabase
      .from('inventory_pools')
      .select(`
        *,
        components:pool_component_id (
          id,
          internal_sku,
          description,
          brand
        ),
        inventory_pool_members (
          id,
          bom_id,
          weight,
          min_qty,
          max_qty,
          priority,
          is_active,
          boms (
            id,
            bundle_sku,
            description,
            is_active
          )
        )
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return errors.notFound(res, 'Pool');
      }
      throw error;
    }

    // Get stock info
    const { data: stock } = await supabase
      .from('component_stock')
      .select('on_hand, reserved')
      .eq('component_id', pool.pool_component_id)
      .eq('location', pool.location)
      .maybeSingle();

    const enrichedPool = {
      ...pool,
      pool_on_hand: stock?.on_hand || 0,
      pool_reserved: stock?.reserved || 0,
      pool_available: Math.max(0, (stock?.on_hand || 0) - (stock?.reserved || 0)),
    };

    // Calculate allocations
    const poolData = {
      pool_available: enrichedPool.pool_available,
      members: (pool.inventory_pool_members || [])
        .filter(m => m.is_active && m.boms?.is_active)
        .map(m => ({
          bom_id: m.bom_id,
          bundle_sku: m.boms?.bundle_sku,
          weight: m.weight,
          min_qty: m.min_qty,
          max_qty: m.max_qty,
          priority: m.priority,
          buildable: 0, // Will be calculated
        })),
    };

    // Get buildable for each member
    for (const member of poolData.members) {
      const { data: buildableData } = await supabase.rpc('rpc_get_bom_availability', {
        p_bom_id: member.bom_id,
        p_location: pool.location,
      }).catch(() => ({ data: null }));

      member.buildable = buildableData?.data?.buildable || 0;
    }

    const allocation = allocatePool(poolData);
    const validation = validateAllocation(poolData, allocation);

    // Add allocation info to members
    enrichedPool.inventory_pool_members = (pool.inventory_pool_members || []).map(m => ({
      ...m,
      allocated_qty: allocation.get(m.bom_id) || 0,
    }));

    enrichedPool.allocation_summary = {
      total_allocated: validation.totalAllocated,
      utilization_percent: validation.utilizationPercent,
      is_valid: validation.valid,
      errors: validation.errors,
    };

    sendSuccess(res, enrichedPool);
  } catch (err) {
    console.error('Failed to get pool:', err);
    return errors.internal(res, `Failed to get pool: ${err.message}`);
  }
});

/**
 * POST /inventory/pools
 * Create a new inventory pool
 */
router.post('/pools', requireAdmin, async (req, res) => {
  const { name, description, pool_component_id, location = 'Warehouse' } = req.body;

  if (!name || !pool_component_id) {
    return errors.badRequest(res, 'name and pool_component_id are required');
  }

  try {
    // Verify component exists
    const { data: component, error: compError } = await supabase
      .from('components')
      .select('id, internal_sku')
      .eq('id', pool_component_id)
      .single();

    if (compError || !component) {
      return errors.notFound(res, 'Component');
    }

    const actor = getAuditContext(req);

    const { data: pool, error } = await supabase
      .from('inventory_pools')
      .insert({
        name,
        description,
        pool_component_id,
        location,
        is_active: true,
        created_by_actor_type: actor.type,
        created_by_actor_id: actor.id,
        created_by_actor_display: actor.display,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return errors.badRequest(res, `A pool already exists for component ${component.internal_sku} at ${location}`);
      }
      throw error;
    }

    await auditLog({
      entityType: 'INVENTORY_POOL',
      entityId: pool.id,
      action: 'CREATE',
      afterJson: pool,
      ...actor,
      correlationId: req.correlationId,
    });

    sendSuccess(res, pool, 201);
  } catch (err) {
    console.error('Failed to create pool:', err);
    return errors.internal(res, `Failed to create pool: ${err.message}`);
  }
});

/**
 * PUT /inventory/pools/:id
 * Update a pool
 */
router.put('/pools/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, description, is_active } = req.body;

  try {
    const { data: existing, error: fetchError } = await supabase
      .from('inventory_pools')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return errors.notFound(res, 'Pool');
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (is_active !== undefined) updates.is_active = is_active;

    if (Object.keys(updates).length === 0) {
      return sendSuccess(res, existing);
    }

    const { data: pool, error } = await supabase
      .from('inventory_pools')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    const actor = getAuditContext(req);
    await auditLog({
      entityType: 'INVENTORY_POOL',
      entityId: id,
      action: 'UPDATE',
      beforeJson: existing,
      afterJson: pool,
      ...actor,
      correlationId: req.correlationId,
    });

    sendSuccess(res, pool);
  } catch (err) {
    console.error('Failed to update pool:', err);
    return errors.internal(res, `Failed to update pool: ${err.message}`);
  }
});

/**
 * DELETE /inventory/pools/:id
 * Delete a pool (soft delete - sets is_active=false)
 */
router.delete('/pools/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const { data: existing, error: fetchError } = await supabase
      .from('inventory_pools')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return errors.notFound(res, 'Pool');
    }

    const { error } = await supabase
      .from('inventory_pools')
      .update({ is_active: false })
      .eq('id', id);

    if (error) throw error;

    const actor = getAuditContext(req);
    await auditLog({
      entityType: 'INVENTORY_POOL',
      entityId: id,
      action: 'DELETE',
      beforeJson: existing,
      ...actor,
      correlationId: req.correlationId,
    });

    sendSuccess(res, { message: 'Pool deactivated' });
  } catch (err) {
    console.error('Failed to delete pool:', err);
    return errors.internal(res, `Failed to delete pool: ${err.message}`);
  }
});

// ============================================================================
// POOL MEMBERS
// ============================================================================

/**
 * POST /inventory/pools/:poolId/members
 * Add a BOM to a pool
 */
router.post('/pools/:poolId/members', requireAdmin, async (req, res) => {
  const { poolId } = req.params;
  const { bom_id, weight = 1.0, min_qty = 0, max_qty = null, priority = 0 } = req.body;

  if (!bom_id) {
    return errors.badRequest(res, 'bom_id is required');
  }

  try {
    // Verify pool exists
    const { data: pool, error: poolError } = await supabase
      .from('inventory_pools')
      .select('id, name')
      .eq('id', poolId)
      .single();

    if (poolError || !pool) {
      return errors.notFound(res, 'Pool');
    }

    // Verify BOM exists
    const { data: bom, error: bomError } = await supabase
      .from('boms')
      .select('id, bundle_sku')
      .eq('id', bom_id)
      .single();

    if (bomError || !bom) {
      return errors.notFound(res, 'BOM');
    }

    const { data: member, error } = await supabase
      .from('inventory_pool_members')
      .insert({
        pool_id: poolId,
        bom_id,
        weight,
        min_qty,
        max_qty,
        priority,
        is_active: true,
      })
      .select(`
        *,
        boms (id, bundle_sku, description)
      `)
      .single();

    if (error) {
      if (error.code === '23505') {
        return errors.badRequest(res, `BOM ${bom.bundle_sku} is already a member of pool ${pool.name}`);
      }
      throw error;
    }

    const actor = getAuditContext(req);
    await auditLog({
      entityType: 'POOL_MEMBER',
      entityId: member.id,
      action: 'CREATE',
      afterJson: member,
      ...actor,
      correlationId: req.correlationId,
    });

    sendSuccess(res, member, 201);
  } catch (err) {
    console.error('Failed to add pool member:', err);
    return errors.internal(res, `Failed to add pool member: ${err.message}`);
  }
});

/**
 * PUT /inventory/pools/:poolId/members/:memberId
 * Update a pool member
 */
router.put('/pools/:poolId/members/:memberId', requireAdmin, async (req, res) => {
  const { poolId, memberId } = req.params;
  const { weight, min_qty, max_qty, priority, is_active } = req.body;

  try {
    const { data: existing, error: fetchError } = await supabase
      .from('inventory_pool_members')
      .select('*')
      .eq('id', memberId)
      .eq('pool_id', poolId)
      .single();

    if (fetchError || !existing) {
      return errors.notFound(res, 'Pool member');
    }

    const updates = {};
    if (weight !== undefined) updates.weight = weight;
    if (min_qty !== undefined) updates.min_qty = min_qty;
    if (max_qty !== undefined) updates.max_qty = max_qty;
    if (priority !== undefined) updates.priority = priority;
    if (is_active !== undefined) updates.is_active = is_active;

    if (Object.keys(updates).length === 0) {
      return sendSuccess(res, existing);
    }

    const { data: member, error } = await supabase
      .from('inventory_pool_members')
      .update(updates)
      .eq('id', memberId)
      .select(`
        *,
        boms (id, bundle_sku, description)
      `)
      .single();

    if (error) throw error;

    const actor = getAuditContext(req);
    await auditLog({
      entityType: 'POOL_MEMBER',
      entityId: memberId,
      action: 'UPDATE',
      beforeJson: existing,
      afterJson: member,
      ...actor,
      correlationId: req.correlationId,
    });

    sendSuccess(res, member);
  } catch (err) {
    console.error('Failed to update pool member:', err);
    return errors.internal(res, `Failed to update pool member: ${err.message}`);
  }
});

/**
 * DELETE /inventory/pools/:poolId/members/:memberId
 * Remove a BOM from a pool
 */
router.delete('/pools/:poolId/members/:memberId', requireAdmin, async (req, res) => {
  const { poolId, memberId } = req.params;

  try {
    const { data: existing, error: fetchError } = await supabase
      .from('inventory_pool_members')
      .select('*')
      .eq('id', memberId)
      .eq('pool_id', poolId)
      .single();

    if (fetchError || !existing) {
      return errors.notFound(res, 'Pool member');
    }

    const { error } = await supabase
      .from('inventory_pool_members')
      .delete()
      .eq('id', memberId);

    if (error) throw error;

    const actor = getAuditContext(req);
    await auditLog({
      entityType: 'POOL_MEMBER',
      entityId: memberId,
      action: 'DELETE',
      beforeJson: existing,
      ...actor,
      correlationId: req.correlationId,
    });

    sendSuccess(res, { message: 'Member removed from pool' });
  } catch (err) {
    console.error('Failed to remove pool member:', err);
    return errors.internal(res, `Failed to remove pool member: ${err.message}`);
  }
});

// ============================================================================
// FALLBACK FUNCTIONS (when RPC not available)
// ============================================================================

async function getPoolDataFallback(location) {
  const { data: pools, error } = await supabase
    .from('inventory_pools')
    .select(`
      id,
      name,
      description,
      pool_component_id,
      components:pool_component_id (
        id,
        internal_sku,
        description
      ),
      inventory_pool_members (
        id,
        bom_id,
        weight,
        min_qty,
        max_qty,
        priority,
        is_active,
        boms (
          id,
          bundle_sku,
          description,
          is_active,
          bom_components (
            component_id,
            qty_required
          )
        )
      )
    `)
    .eq('is_active', true)
    .eq('location', location);

  if (error) {
    if (error.code === '42P01') {
      return { pools: [] };
    }
    throw error;
  }

  // Get stock for pool components
  const componentIds = [...new Set((pools || []).map(p => p.pool_component_id))];
  const { data: stockData } = await supabase
    .from('component_stock')
    .select('component_id, on_hand, reserved')
    .in('component_id', componentIds)
    .eq('location', location);

  const stockMap = new Map(
    (stockData || []).map(s => [s.component_id, s])
  );

  // Get all stock for buildable calculations
  const { data: allStock } = await supabase
    .from('component_stock')
    .select('component_id, on_hand, reserved')
    .eq('location', location);

  const allStockMap = new Map(
    (allStock || []).map(s => [s.component_id, {
      on_hand: s.on_hand || 0,
      reserved: s.reserved || 0,
      available: Math.max(0, (s.on_hand || 0) - (s.reserved || 0)),
    }])
  );

  const enrichedPools = [];

  for (const pool of pools || []) {
    const stock = stockMap.get(pool.pool_component_id);
    const poolAvailable = Math.max(0, (stock?.on_hand || 0) - (stock?.reserved || 0));

    const members = [];
    for (const member of pool.inventory_pool_members || []) {
      if (!member.is_active || !member.boms?.is_active) continue;

      // Calculate buildable for this BOM
      let buildable = Infinity;
      let constraintComponentId = null;
      let constraintInternalSku = null;

      for (const bc of member.boms?.bom_components || []) {
        const compStock = allStockMap.get(bc.component_id) || { available: 0 };
        const canBuild = Math.floor(compStock.available / bc.qty_required);

        if (canBuild < buildable) {
          buildable = canBuild;
          constraintComponentId = bc.component_id;
        }
      }

      if (buildable === Infinity) buildable = 0;

      members.push({
        member_id: member.id,
        bom_id: member.bom_id,
        bundle_sku: member.boms?.bundle_sku,
        bom_description: member.boms?.description,
        weight: member.weight,
        min_qty: member.min_qty,
        max_qty: member.max_qty,
        priority: member.priority,
        buildable,
        constraint_component_id: constraintComponentId,
      });
    }

    enrichedPools.push({
      pool_id: pool.id,
      pool_name: pool.name,
      pool_description: pool.description,
      pool_component_id: pool.pool_component_id,
      pool_component_sku: pool.components?.internal_sku,
      pool_component_description: pool.components?.description,
      pool_on_hand: stock?.on_hand || 0,
      pool_reserved: stock?.reserved || 0,
      pool_available: poolAvailable,
      members,
      member_count: members.length,
    });
  }

  return { pools: enrichedPools, location };
}

async function getNonPooledBomsFallback(location) {
  // Get all pool member BOM IDs
  const { data: poolMembers } = await supabase
    .from('inventory_pool_members')
    .select(`
      bom_id,
      inventory_pools!inner (
        is_active,
        location
      )
    `)
    .eq('is_active', true)
    .eq('inventory_pools.is_active', true)
    .eq('inventory_pools.location', location)
    .catch(() => ({ data: [] }));

  const pooledBomIds = new Set((poolMembers || []).map(m => m.bom_id));

  // Get all active BOMs
  const { data: boms } = await supabase
    .from('boms')
    .select(`
      id,
      bundle_sku,
      description,
      bom_components (
        component_id,
        qty_required
      )
    `)
    .eq('is_active', true);

  // Get all stock
  const { data: stock } = await supabase
    .from('component_stock')
    .select('component_id, on_hand, reserved')
    .eq('location', location);

  const stockMap = new Map(
    (stock || []).map(s => [s.component_id, {
      available: Math.max(0, (s.on_hand || 0) - (s.reserved || 0)),
    }])
  );

  const nonPooledBoms = [];

  for (const bom of boms || []) {
    if (pooledBomIds.has(bom.id)) continue;

    // Calculate buildable
    let buildable = Infinity;
    let constraintComponentId = null;

    for (const bc of bom.bom_components || []) {
      const compStock = stockMap.get(bc.component_id) || { available: 0 };
      const canBuild = Math.floor(compStock.available / bc.qty_required);

      if (canBuild < buildable) {
        buildable = canBuild;
        constraintComponentId = bc.component_id;
      }
    }

    if (buildable === Infinity) buildable = 0;

    nonPooledBoms.push({
      bom_id: bom.id,
      bundle_sku: bom.bundle_sku,
      bom_description: bom.description,
      buildable,
      recommended_qty: buildable,
      constraint_component_id: constraintComponentId,
    });
  }

  return { boms: nonPooledBoms, location, total: nonPooledBoms.length };
}

export default router;
