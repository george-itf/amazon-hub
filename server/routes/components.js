import express from 'express';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { auditLog, getAuditContext } from '../services/audit.js';

const router = express.Router();

// Supabase default limit is 1000 rows, so we paginate to fetch all
const PAGE_SIZE = 1000;

/**
 * GET /components
 * Returns components with proper server-side pagination
 * Uses single database query with offset/limit for efficiency
 * Requires authentication (all users)
 */
router.get('/', async (req, res) => {
  const {
    active_only = 'true',
    limit = 100,  // Sensible default - don't load thousands at once
    offset = 0,
    search = '',
    usage_filter = 'all'  // 'all', 'active', 'unassigned'
  } = req.query;

  // Cap limit to prevent memory issues
  const requestedLimit = Math.min(parseInt(limit) || 100, 500);
  const requestedOffset = parseInt(offset) || 0;

  try {
    // Build base query for counting
    let countQuery = supabase
      .from('components')
      .select('*', { count: 'exact', head: true });

    if (active_only === 'true') {
      countQuery = countQuery.eq('is_active', true);
    }

    if (search) {
      countQuery = countQuery.or(`internal_sku.ilike.%${search}%,description.ilike.%${search}%,brand.ilike.%${search}%`);
    }

    const { count: totalCount, error: countError } = await countQuery;

    if (countError) {
      console.error('Components count error:', countError);
      return errors.internal(res, 'Failed to fetch components');
    }

    // Single paginated query - use database offset/limit directly
    // Note: Using left join (no !inner) for bom_components to include components without BOM associations
    let query = supabase
      .from('components')
      .select(`
        *,
        component_stock (
          id,
          location,
          on_hand,
          reserved
        ),
        bom_components (
          bom_id,
          boms (
            id,
            is_active
          )
        )
      `)
      .order('internal_sku', { ascending: true })
      .range(requestedOffset, requestedOffset + requestedLimit - 1);

    if (active_only === 'true') {
      query = query.eq('is_active', true);
    }

    if (search) {
      query = query.or(`internal_sku.ilike.%${search}%,description.ilike.%${search}%,brand.ilike.%${search}%`);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Components fetch error:', error);
      return errors.internal(res, 'Failed to fetch components');
    }

    // Add computed available stock and active BOM count
    let componentsWithAvailable = (data || []).map(c => {
      const totalOnHand = (c.component_stock || []).reduce((sum, s) => sum + s.on_hand, 0);
      const totalReserved = (c.component_stock || []).reduce((sum, s) => sum + s.reserved, 0);
      // Count unique active BOMs this component is used in
      const activeBomIds = new Set(
        (c.bom_components || [])
          .filter(bc => bc.boms?.is_active)
          .map(bc => bc.bom_id)
      );
      return {
        ...c,
        total_on_hand: totalOnHand,
        total_reserved: totalReserved,
        total_available: totalOnHand - totalReserved,
        active_bom_count: activeBomIds.size,
        bom_components: undefined // Don't send the raw join data
      };
    });

    // Apply usage filter in-memory (for small paginated results this is fine)
    if (usage_filter === 'active') {
      componentsWithAvailable = componentsWithAvailable.filter(c => c.active_bom_count > 0);
    } else if (usage_filter === 'unassigned') {
      componentsWithAvailable = componentsWithAvailable.filter(c => c.active_bom_count === 0);
    }

    sendSuccess(res, {
      components: componentsWithAvailable,
      total: totalCount,
      limit: requestedLimit,
      offset: requestedOffset
    });
  } catch (err) {
    console.error('Components fetch error:', err);
    errors.internal(res, 'Failed to fetch components');
  }
});

/**
 * GET /components/:id
 * Get a single component with stock and movement history
 * Requires STAFF or ADMIN role
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from('components')
      .select(`
        *,
        component_stock (
          id,
          location,
          on_hand,
          reserved
        ),
        bom_components (
          bom_id,
          qty_required,
          boms (
            id,
            bundle_sku,
            description
          )
        )
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return errors.notFound(res, 'Component');
      }
      console.error('Component fetch error:', error);
      return errors.internal(res, 'Failed to fetch component');
    }

    // Add computed totals
    const totalOnHand = (data.component_stock || []).reduce((sum, s) => sum + s.on_hand, 0);
    const totalReserved = (data.component_stock || []).reduce((sum, s) => sum + s.reserved, 0);

    sendSuccess(res, {
      ...data,
      total_on_hand: totalOnHand,
      total_reserved: totalReserved,
      total_available: totalOnHand - totalReserved
    });
  } catch (err) {
    console.error('Component fetch error:', err);
    errors.internal(res, 'Failed to fetch component');
  }
});

/**
 * POST /components
 * Create a new component
 * ADMIN only
 */
router.post('/', async (req, res) => {
  const { internal_sku, description, brand, cost_ex_vat_pence, weight_grams } = req.body;

  if (!internal_sku) {
    return errors.badRequest(res, 'internal_sku is required');
  }

  try {
    const { data, error } = await supabase
      .from('components')
      .insert({
        internal_sku: internal_sku.toUpperCase().trim(),
        description,
        brand,
        cost_ex_vat_pence,
        weight_grams
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return errors.conflict(res, 'A component with this SKU already exists');
      }
      console.error('Component create error:', error);
      return errors.internal(res, 'Failed to create component');
    }

    await auditLog({
      entityType: 'COMPONENT',
      entityId: data.id,
      action: 'CREATE',
      afterJson: data,
      changesSummary: `Created component ${data.internal_sku}`,
      ...getAuditContext(req)
    });

    sendSuccess(res, data, 201);
  } catch (err) {
    console.error('Component create error:', err);
    errors.internal(res, 'Failed to create component');
  }
});

/**
 * PUT /components/:id
 * Update a component
 * ADMIN only
 */
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { description, brand, cost_ex_vat_pence, weight_grams, is_active } = req.body;

  try {
    // Get current state for audit
    const { data: current, error: fetchError } = await supabase
      .from('components')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return errors.notFound(res, 'Component');
      }
      throw fetchError;
    }

    const updates = {};
    if (description !== undefined) updates.description = description;
    if (brand !== undefined) updates.brand = brand;
    if (cost_ex_vat_pence !== undefined) updates.cost_ex_vat_pence = cost_ex_vat_pence;
    if (weight_grams !== undefined) updates.weight_grams = weight_grams;
    if (is_active !== undefined) updates.is_active = is_active;

    const { data, error } = await supabase
      .from('components')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Component update error:', error);
      return errors.internal(res, 'Failed to update component');
    }

    await auditLog({
      entityType: 'COMPONENT',
      entityId: id,
      action: 'UPDATE',
      beforeJson: current,
      afterJson: data,
      changesSummary: `Updated component ${data.internal_sku}`,
      ...getAuditContext(req)
    });

    sendSuccess(res, data);
  } catch (err) {
    console.error('Component update error:', err);
    errors.internal(res, 'Failed to update component');
  }
});

/**
 * GET /components/:id/movements
 * Get stock movements for a component
 * Requires STAFF or ADMIN role
 */
router.get('/:id/movements', async (req, res) => {
  const { id } = req.params;
  const { limit = 100, offset = 0 } = req.query;

  try {
    const { data, error, count } = await supabase
      .from('stock_movements')
      .select('*', { count: 'exact' })
      .eq('component_id', id)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) {
      console.error('Movements fetch error:', error);
      return errors.internal(res, 'Failed to fetch movements');
    }

    sendSuccess(res, {
      movements: data,
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (err) {
    console.error('Movements fetch error:', err);
    errors.internal(res, 'Failed to fetch movements');
  }
});

/**
 * GET /components/:id/dependent-listings
 * Get all listings/BOMs that depend on this component
 * Shows impact analysis when component stock is low
 * Requires STAFF or ADMIN role
 */
router.get('/:id/dependent-listings', async (req, res) => {
  const { id } = req.params;
  const { location = 'Warehouse' } = req.query;

  try {
    // Try RPC first
    const { data: result, error } = await supabase.rpc('rpc_get_component_dependent_listings', {
      p_component_id: id,
      p_location: location
    });

    if (error) {
      // Fall back to manual calculation if RPC doesn't exist
      if (error.message?.includes('function') || error.code === '42883') {
        console.warn('rpc_get_component_dependent_listings not found - using fallback');
        return await calculateDependentListingsFallback(req, res, id, location);
      }
      console.error('Dependent listings fetch error:', error);
      return errors.internal(res, `Failed to fetch dependent listings: ${error.message}`);
    }

    if (result?.ok === false) {
      if (result.error?.code === 'COMPONENT_NOT_FOUND') {
        return errors.notFound(res, 'Component');
      }
      return errors.internal(res, result.error?.message || 'Failed to fetch dependent listings');
    }

    sendSuccess(res, result?.data || result);
  } catch (err) {
    console.error('Dependent listings fetch error:', err);
    errors.internal(res, `Failed to fetch dependent listings: ${err.message}`);
  }
});

/**
 * Fallback for dependent listings when RPC not available
 */
async function calculateDependentListingsFallback(req, res, componentId, location) {
  try {
    // Get the component
    const { data: component, error: compError } = await supabase
      .from('components')
      .select('id, internal_sku, description, brand')
      .eq('id', componentId)
      .single();

    if (compError) {
      if (compError.code === 'PGRST116') {
        return errors.notFound(res, 'Component');
      }
      throw compError;
    }

    // Get stock for this component
    const { data: stock } = await supabase
      .from('component_stock')
      .select('on_hand, reserved')
      .eq('component_id', componentId)
      .eq('location', location)
      .maybeSingle();

    const onHand = stock?.on_hand || 0;
    const reserved = stock?.reserved || 0;
    const available = Math.max(0, onHand - reserved);

    // Get all BOMs using this component
    const { data: bomComponents, error: bcError } = await supabase
      .from('bom_components')
      .select(`
        qty_required,
        bom_id,
        boms (
          id,
          bundle_sku,
          description,
          is_active
        )
      `)
      .eq('component_id', componentId);

    if (bcError) {
      throw bcError;
    }

    // Get listings for these BOMs
    const bomIds = [...new Set((bomComponents || [])
      .filter(bc => bc.boms?.is_active)
      .map(bc => bc.bom_id))];

    const { data: listings } = await supabase
      .from('listing_memory')
      .select('id, asin, sku, title_fingerprint, is_active, bom_id')
      .in('bom_id', bomIds)
      .eq('is_active', true);

    // Build result
    const bomMap = new Map();
    for (const bc of bomComponents || []) {
      if (bc.boms?.is_active) {
        bomMap.set(bc.bom_id, {
          bundle_sku: bc.boms.bundle_sku,
          description: bc.boms.description,
          qty_required: bc.qty_required
        });
      }
    }

    const dependentListings = (listings || []).map(listing => {
      const bomInfo = bomMap.get(listing.bom_id);
      const maxSellable = Math.floor(available / (bomInfo?.qty_required || 1));

      return {
        listing_id: listing.id,
        asin: listing.asin,
        sku: listing.sku,
        title_fingerprint: listing.title_fingerprint,
        is_active: listing.is_active,
        bom_id: listing.bom_id,
        bundle_sku: bomInfo?.bundle_sku,
        bom_description: bomInfo?.description,
        qty_required_per_unit: bomInfo?.qty_required || 1,
        max_sellable_from_this_component: maxSellable
      };
    });

    sendSuccess(res, {
      component: {
        id: component.id,
        internal_sku: component.internal_sku,
        description: component.description,
        brand: component.brand,
        on_hand: onHand,
        reserved,
        available,
        location
      },
      dependent_listings: dependentListings,
      total_dependent: dependentListings.length
    });
  } catch (err) {
    console.error('Dependent listings fallback error:', err);
    errors.internal(res, `Failed to calculate dependent listings: ${err.message}`);
  }
}

export default router;
