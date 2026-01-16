import express from 'express';
import crypto from 'crypto';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { auditLog, getAuditContext } from '../services/audit.js';
import { fingerprintTitle, normalizeAsin, normalizeSku } from '../utils/identityNormalization.js';

const router = express.Router();

/**
 * Sanitize search input for Supabase PostgREST queries
 * Escapes special characters that could break or exploit the filter syntax
 */
function sanitizeSearchInput(input) {
  if (!input || typeof input !== 'string') return '';
  return input
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\./g, '\\.')
    .substring(0, 100);
}

/**
 * GET /listings/inventory
 * Returns all listings with BOM-based inventory availability
 * Shows max sellable quantity per listing and constraint info
 */
router.get('/inventory', async (req, res) => {
  const { location = 'Warehouse', include_inactive = 'false' } = req.query;

  try {
    const { data: result, error } = await supabase.rpc('rpc_get_listing_inventory', {
      p_location: location,
      p_include_inactive: include_inactive === 'true'
    });

    if (error) {
      // If RPC doesn't exist yet, fall back to manual calculation
      if (error.message?.includes('function') || error.code === '42883') {
        console.warn('rpc_get_listing_inventory not found - using fallback calculation');
        return await calculateListingInventoryFallback(req, res, location, include_inactive === 'true');
      }
      console.error('Listing inventory fetch error:', error);
      return errors.internal(res, `Failed to fetch listing inventory: ${error.message}`);
    }

    // Handle RPC result format
    if (result?.ok === false) {
      return errors.internal(res, result.error?.message || 'Failed to fetch listing inventory');
    }

    sendSuccess(res, result?.data || result);
  } catch (err) {
    console.error('Listing inventory fetch error:', err);
    errors.internal(res, `Failed to fetch listing inventory: ${err.message}`);
  }
});

/**
 * Fallback calculation when RPC is not available
 */
async function calculateListingInventoryFallback(req, res, location, includeInactive) {
  try {
    // Get all active listings with BOMs
    let listingQuery = supabase
      .from('listing_memory')
      .select(`
        id,
        asin,
        sku,
        title_fingerprint,
        is_active,
        bom_id,
        boms (
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
              description
            )
          )
        )
      `)
      .not('bom_id', 'is', null);

    if (!includeInactive) {
      listingQuery = listingQuery.eq('is_active', true);
    }

    const { data: listings, error: listingsError } = await listingQuery;

    if (listingsError) {
      console.error('Fallback listings fetch error:', listingsError);
      return errors.internal(res, 'Failed to fetch listings');
    }

    // Get all stock for location
    const { data: allStock, error: stockError } = await supabase
      .from('component_stock')
      .select('component_id, on_hand, reserved')
      .eq('location', location);

    if (stockError) {
      console.error('Fallback stock fetch error:', stockError);
      return errors.internal(res, 'Failed to fetch stock');
    }

    const stockMap = new Map(
      (allStock || []).map(s => [s.component_id, {
        on_hand: s.on_hand || 0,
        reserved: s.reserved || 0,
        available: (s.on_hand || 0) - (s.reserved || 0)
      }])
    );

    // Calculate availability for each listing
    const results = [];
    let outOfStockCount = 0;
    let lowStockCount = 0;

    for (const listing of listings || []) {
      if (!listing.boms || (!includeInactive && !listing.boms.is_active)) continue;

      let minBuildable = Infinity;
      let constraintComponentId = null;
      let constraintInternalSku = null;
      const components = [];

      for (const bc of listing.boms.bom_components || []) {
        const stock = stockMap.get(bc.component_id) || { on_hand: 0, reserved: 0, available: 0 };
        const available = Math.max(0, stock.available);
        const buildable = Math.floor(available / bc.qty_required);

        components.push({
          component_id: bc.component_id,
          internal_sku: bc.components?.internal_sku,
          description: bc.components?.description,
          qty_required: bc.qty_required,
          on_hand: stock.on_hand,
          reserved: stock.reserved,
          available,
          buildable,
          is_constraint: false
        });

        if (buildable < minBuildable) {
          minBuildable = buildable;
          constraintComponentId = bc.component_id;
          constraintInternalSku = bc.components?.internal_sku;
        }
      }

      // Mark constraint components
      components.forEach(c => {
        if (c.component_id === constraintComponentId) {
          c.is_constraint = true;
        }
      });

      if (minBuildable === Infinity) minBuildable = 0;

      const stockStatus = minBuildable === 0 ? 'OUT_OF_STOCK'
        : minBuildable <= 3 ? 'LOW_STOCK'
        : minBuildable <= 10 ? 'MODERATE_STOCK'
        : 'IN_STOCK';

      if (stockStatus === 'OUT_OF_STOCK') outOfStockCount++;
      if (stockStatus === 'LOW_STOCK') lowStockCount++;

      results.push({
        listing_id: listing.id,
        asin: listing.asin,
        sku: listing.sku,
        title_fingerprint: listing.title_fingerprint,
        is_active: listing.is_active,
        bom_id: listing.bom_id,
        bundle_sku: listing.boms.bundle_sku,
        bom_description: listing.boms.description,
        bom_is_active: listing.boms.is_active,
        max_sellable: minBuildable,
        constraint_component_id: constraintComponentId,
        constraint_internal_sku: constraintInternalSku,
        components,
        stock_status: stockStatus
      });
    }

    sendSuccess(res, {
      listings: results,
      location,
      total: results.length,
      out_of_stock_count: outOfStockCount,
      low_stock_count: lowStockCount
    });
  } catch (err) {
    console.error('Fallback calculation error:', err);
    errors.internal(res, `Failed to calculate listing inventory: ${err.message}`);
  }
}

/**
 * GET /listings/shared-components
 * Returns components shared across multiple BOMs/listings
 * Useful for identifying overselling risks
 */
router.get('/shared-components', async (req, res) => {
  const { location = 'Warehouse' } = req.query;

  try {
    const { data: result, error } = await supabase.rpc('rpc_get_shared_components_report', {
      p_location: location
    });

    if (error) {
      // Fall back to manual calculation if RPC doesn't exist
      if (error.message?.includes('function') || error.code === '42883') {
        console.warn('rpc_get_shared_components_report not found - using fallback');
        return await calculateSharedComponentsFallback(req, res, location);
      }
      console.error('Shared components fetch error:', error);
      return errors.internal(res, `Failed to fetch shared components: ${error.message}`);
    }

    if (result?.ok === false) {
      return errors.internal(res, result.error?.message || 'Failed to fetch shared components');
    }

    sendSuccess(res, result?.data || result);
  } catch (err) {
    console.error('Shared components fetch error:', err);
    errors.internal(res, `Failed to fetch shared components: ${err.message}`);
  }
});

/**
 * Fallback for shared components when RPC not available
 */
async function calculateSharedComponentsFallback(req, res, location) {
  try {
    // Get components used in multiple BOMs
    const { data: bomComponents, error: bcError } = await supabase
      .from('bom_components')
      .select(`
        component_id,
        qty_required,
        bom_id,
        components (
          id,
          internal_sku,
          description,
          brand,
          is_active
        ),
        boms (
          id,
          is_active
        )
      `);

    if (bcError) {
      return errors.internal(res, 'Failed to fetch BOM components');
    }

    // Group by component
    const componentUsage = new Map();
    for (const bc of bomComponents || []) {
      if (!bc.boms?.is_active || !bc.components?.is_active) continue;

      if (!componentUsage.has(bc.component_id)) {
        componentUsage.set(bc.component_id, {
          component: bc.components,
          bom_ids: new Set()
        });
      }
      componentUsage.get(bc.component_id).bom_ids.add(bc.bom_id);
    }

    // Filter to components in multiple BOMs
    const sharedComponents = Array.from(componentUsage.entries())
      .filter(([_, data]) => data.bom_ids.size > 1)
      .map(([componentId, data]) => ({
        component_id: componentId,
        internal_sku: data.component.internal_sku,
        description: data.component.description,
        brand: data.component.brand,
        bom_count: data.bom_ids.size
      }));

    // Get stock for these components
    const componentIds = sharedComponents.map(c => c.component_id);
    const { data: stock } = await supabase
      .from('component_stock')
      .select('component_id, on_hand, reserved')
      .in('component_id', componentIds)
      .eq('location', location);

    const stockMap = new Map(
      (stock || []).map(s => [s.component_id, s])
    );

    // Get listing counts
    const { data: listings } = await supabase
      .from('listing_memory')
      .select('id, bom_id')
      .eq('is_active', true);

    const bomListingCount = new Map();
    for (const listing of listings || []) {
      if (listing.bom_id) {
        bomListingCount.set(listing.bom_id, (bomListingCount.get(listing.bom_id) || 0) + 1);
      }
    }

    let criticalCount = 0;
    let highRiskCount = 0;

    const results = sharedComponents.map(c => {
      const s = stockMap.get(c.component_id);
      const onHand = s?.on_hand || 0;
      const reserved = s?.reserved || 0;
      const available = Math.max(0, onHand - reserved);

      // Count listings using this component
      const usage = componentUsage.get(c.component_id);
      let listingCount = 0;
      for (const bomId of usage.bom_ids) {
        listingCount += bomListingCount.get(bomId) || 0;
      }

      const riskLevel = available === 0 ? 'CRITICAL'
        : available < c.bom_count * 2 ? 'HIGH'
        : available < c.bom_count * 5 ? 'MEDIUM'
        : 'LOW';

      if (riskLevel === 'CRITICAL') criticalCount++;
      if (riskLevel === 'HIGH') highRiskCount++;

      return {
        ...c,
        on_hand: onHand,
        reserved,
        available,
        listing_count: listingCount,
        risk_level: riskLevel
      };
    });

    results.sort((a, b) => {
      const riskOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return (riskOrder[a.risk_level] || 4) - (riskOrder[b.risk_level] || 4);
    });

    sendSuccess(res, {
      shared_components: results,
      location,
      total: results.length,
      critical_count: criticalCount,
      high_risk_count: highRiskCount
    });
  } catch (err) {
    console.error('Shared components fallback error:', err);
    errors.internal(res, `Failed to calculate shared components: ${err.message}`);
  }
}

/**
 * GET /listings
 * Returns all listing memory entries
 */
router.get('/', async (req, res) => {
  const { active_only = 'true', bom_id, limit = 1000, offset = 0 } = req.query;

  try {
    let query = supabase
      .from('listing_memory')
      .select(`
        *,
        boms (
          id,
          bundle_sku,
          description
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (active_only === 'true') {
      query = query.eq('is_active', true);
    }

    if (bom_id) {
      query = query.eq('bom_id', bom_id);
    }

    const { data, error, count } = await query.range(
      parseInt(offset),
      parseInt(offset) + parseInt(limit) - 1
    );

    if (error) {
      console.error('Listings fetch error:', error);
      return errors.internal(res, 'Failed to fetch listings');
    }

    sendSuccess(res, {
      listings: data,
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (err) {
    console.error('Listings fetch error:', err);
    errors.internal(res, 'Failed to fetch listings');
  }
});

/**
 * GET /listings/:id
 * Get a single listing memory entry
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from('listing_memory')
      .select(`
        *,
        boms (
          id,
          bundle_sku,
          description,
          bom_components (
            qty_required,
            components (
              id,
              internal_sku,
              description
            )
          )
        ),
        superseded_listing:superseded_by (
          id,
          asin,
          sku
        )
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return errors.notFound(res, 'Listing');
      }
      console.error('Listing fetch error:', error);
      return errors.internal(res, 'Failed to fetch listing');
    }

    sendSuccess(res, data);
  } catch (err) {
    console.error('Listing fetch error:', err);
    errors.internal(res, 'Failed to fetch listing');
  }
});

/**
 * POST /listings
 * Create a new listing memory entry
 * ADMIN only
 */
router.post('/', async (req, res) => {
  const { asin, sku, title, bom_id } = req.body;

  if (!asin && !sku && !title) {
    return errors.badRequest(res, 'At least one of asin, sku, or title must be provided');
  }

  const normalizedAsin = normalizeAsin(asin);
  const normalizedSku = normalizeSku(sku);
  const fingerprint = fingerprintTitle(title);
  const fingerprintHash = fingerprint
    ? crypto.createHash('sha256').update(fingerprint).digest('hex')
    : null;

  try {
    // Check for conflicts with existing active entries
    const conflicts = [];

    if (normalizedAsin) {
      const { data: existingAsin } = await supabase
        .from('listing_memory')
        .select('id, asin')
        .eq('asin', normalizedAsin)
        .eq('is_active', true)
        .maybeSingle();

      if (existingAsin) {
        conflicts.push({ type: 'ASIN', existing_id: existingAsin.id });
      }
    }

    if (normalizedSku) {
      const { data: existingSku } = await supabase
        .from('listing_memory')
        .select('id, sku')
        .eq('sku', normalizedSku)
        .eq('is_active', true)
        .maybeSingle();

      if (existingSku && existingSku.id !== conflicts[0]?.existing_id) {
        conflicts.push({ type: 'SKU', existing_id: existingSku.id });
      }
    }

    if (fingerprintHash) {
      const { data: existingFp } = await supabase
        .from('listing_memory')
        .select('id, title_fingerprint')
        .eq('title_fingerprint_hash', fingerprintHash)
        .eq('is_active', true)
        .maybeSingle();

      if (existingFp && !conflicts.some(c => c.existing_id === existingFp.id)) {
        conflicts.push({ type: 'FINGERPRINT', existing_id: existingFp.id });
      }
    }

    if (conflicts.length > 0) {
      return errors.conflict(res, 'Active listing memory entries already exist for these identities', {
        conflicts
      });
    }

    // Verify BOM exists if provided
    if (bom_id) {
      const { data: bom, error: bomError } = await supabase
        .from('boms')
        .select('id')
        .eq('id', bom_id)
        .single();

      if (bomError || !bom) {
        return errors.notFound(res, 'BOM');
      }
    }

    // Create the listing memory entry
    const { data, error } = await supabase
      .from('listing_memory')
      .insert({
        asin: normalizedAsin,
        sku: normalizedSku,
        title_fingerprint: fingerprint,
        title_fingerprint_hash: fingerprintHash,
        bom_id: bom_id || null,
        resolution_source: 'MANUAL',
        is_active: true,
        created_by_actor_type: req.actor.type,
        created_by_actor_id: req.actor.id,
        created_by_actor_display: req.actor.display
      })
      .select(`
        *,
        boms (
          id,
          bundle_sku,
          description
        )
      `)
      .single();

    if (error) {
      console.error('Listing create error:', error);
      return errors.internal(res, 'Failed to create listing');
    }

    await auditLog({
      entityType: 'LISTING_MEMORY',
      entityId: data.id,
      action: 'CREATE',
      afterJson: data,
      changesSummary: `Created listing memory: ${normalizedAsin || normalizedSku || fingerprint?.substring(0, 30)}`,
      ...getAuditContext(req)
    });

    sendSuccess(res, data, 201);
  } catch (err) {
    console.error('Listing create error:', err);
    errors.internal(res, 'Failed to create listing');
  }
});

/**
 * PUT /listings/:id
 * Update a listing memory entry (primarily to change BOM assignment)
 * ADMIN only
 */
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { bom_id, is_active } = req.body;

  try {
    // Get current state
    const { data: current, error: fetchError } = await supabase
      .from('listing_memory')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return errors.notFound(res, 'Listing');
      }
      throw fetchError;
    }

    // Verify BOM exists if provided
    if (bom_id) {
      const { data: bom, error: bomError } = await supabase
        .from('boms')
        .select('id')
        .eq('id', bom_id)
        .single();

      if (bomError || !bom) {
        return errors.notFound(res, 'BOM');
      }
    }

    const updates = {};
    if (bom_id !== undefined) updates.bom_id = bom_id;
    if (is_active !== undefined) updates.is_active = is_active;

    const { data, error } = await supabase
      .from('listing_memory')
      .update(updates)
      .eq('id', id)
      .select(`
        *,
        boms (
          id,
          bundle_sku,
          description
        )
      `)
      .single();

    if (error) {
      console.error('Listing update error:', error);
      return errors.internal(res, 'Failed to update listing');
    }

    await auditLog({
      entityType: 'LISTING_MEMORY',
      entityId: id,
      action: 'UPDATE',
      beforeJson: current,
      afterJson: data,
      changesSummary: `Updated listing memory`,
      ...getAuditContext(req)
    });

    sendSuccess(res, data);
  } catch (err) {
    console.error('Listing update error:', err);
    errors.internal(res, 'Failed to update listing');
  }
});

/**
 * POST /listings/:id/supersede
 * Supersede a listing memory entry with a new one
 * ADMIN only
 */
router.post('/:id/supersede', async (req, res) => {
  const { id } = req.params;
  const { asin, sku, title, bom_id, note } = req.body;

  try {
    // Get current listing
    const { data: current, error: fetchError } = await supabase
      .from('listing_memory')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return errors.notFound(res, 'Listing');
      }
      throw fetchError;
    }

    if (!current.is_active) {
      return errors.badRequest(res, 'Listing is already inactive');
    }

    // Use provided values or fall back to current
    const normalizedAsin = asin !== undefined ? normalizeAsin(asin) : current.asin;
    const normalizedSku = sku !== undefined ? normalizeSku(sku) : current.sku;
    const fingerprint = title !== undefined ? fingerprintTitle(title) : current.title_fingerprint;
    const fingerprintHash = fingerprint
      ? crypto.createHash('sha256').update(fingerprint).digest('hex')
      : null;
    const newBomId = bom_id !== undefined ? bom_id : current.bom_id;

    // Create new listing
    const { data: newListing, error: createError } = await supabase
      .from('listing_memory')
      .insert({
        asin: normalizedAsin,
        sku: normalizedSku,
        title_fingerprint: fingerprint,
        title_fingerprint_hash: fingerprintHash,
        bom_id: newBomId,
        resolution_source: 'SUPERSEDE',
        is_active: true,
        created_by_actor_type: req.actor.type,
        created_by_actor_id: req.actor.id,
        created_by_actor_display: req.actor.display
      })
      .select()
      .single();

    if (createError) {
      console.error('New listing create error:', createError);
      return errors.internal(res, 'Failed to create new listing');
    }

    // Deactivate old listing
    await supabase
      .from('listing_memory')
      .update({
        is_active: false,
        superseded_by: newListing.id,
        superseded_at: new Date().toISOString()
      })
      .eq('id', id);

    await auditLog({
      entityType: 'LISTING_MEMORY',
      entityId: id,
      action: 'SUPERSEDE',
      beforeJson: current,
      changesSummary: `Superseded by ${newListing.id}${note ? ': ' + note : ''}`,
      ...getAuditContext(req)
    });

    await auditLog({
      entityType: 'LISTING_MEMORY',
      entityId: newListing.id,
      action: 'CREATE',
      afterJson: newListing,
      changesSummary: `Created as supersession of ${id}`,
      ...getAuditContext(req)
    });

    sendSuccess(res, {
      superseded: {
        id: current.id,
        asin: current.asin,
        sku: current.sku
      },
      new_listing: newListing
    });
  } catch (err) {
    console.error('Listing supersede error:', err);
    errors.internal(res, 'Failed to supersede listing');
  }
});

/**
 * GET /listings/search
 * Search for listings by ASIN, SKU, or title
 */
router.get('/search/query', async (req, res) => {
  const { q, active_only = 'true' } = req.query;

  if (!q || q.length < 2) {
    return errors.badRequest(res, 'Search query must be at least 2 characters');
  }

  try {
    const searchTerm = sanitizeSearchInput(q.toUpperCase().trim());

    let query = supabase
      .from('listing_memory')
      .select(`
        *,
        boms (
          id,
          bundle_sku,
          description
        )
      `)
      .or(`asin.ilike.%${searchTerm}%,sku.ilike.%${searchTerm}%,title_fingerprint.ilike.%${searchTerm}%`)
      .order('created_at', { ascending: false })
      .limit(50);

    if (active_only === 'true') {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Listing search error:', error);
      return errors.internal(res, 'Failed to search listings');
    }

    sendSuccess(res, data || []);
  } catch (err) {
    console.error('Listing search error:', err);
    errors.internal(res, 'Failed to search listings');
  }
});

/**
 * POST /listings/admin/reset-all-boms
 * Admin-only endpoint to clear all BOM assignments from listings
 * Marks all listings for manual review and BOM assignment
 * ADMIN role required
 */
router.post('/admin/reset-all-boms', async (req, res) => {
  const { confirm } = req.body;

  if (confirm !== 'RESET_ALL_BOMS') {
    return errors.badRequest(res, 'Must provide confirm: "RESET_ALL_BOMS" to proceed');
  }

  try {
    // Get count before reset for audit
    const { count: beforeCount } = await supabase
      .from('listing_memory')
      .select('id', { count: 'exact', head: true })
      .not('bom_id', 'is', null);

    // Clear all BOM assignments
    const { error } = await supabase
      .from('listing_memory')
      .update({ bom_id: null })
      .not('bom_id', 'is', null);

    if (error) {
      console.error('Reset all BOMs error:', error);
      return errors.internal(res, 'Failed to reset BOM assignments');
    }

    // Audit log
    await auditLog({
      entityType: 'LISTING_MEMORY',
      entityId: 'ALL',
      action: 'BULK_UPDATE',
      changesSummary: `Reset all BOM assignments. ${beforeCount} listings cleared for review.`,
      ...getAuditContext(req)
    });

    sendSuccess(res, {
      message: 'All BOM assignments have been cleared',
      affected: beforeCount,
    });
  } catch (err) {
    console.error('Reset all BOMs error:', err);
    errors.internal(res, 'Failed to reset BOM assignments');
  }
});

export default router;
