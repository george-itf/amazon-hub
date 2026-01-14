import express from 'express';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { requireAdmin, requireStaff } from '../middleware/auth.js';
import { auditLog, getAuditContext } from '../services/audit.js';

const router = express.Router();

/**
 * GET /boms
 * Returns all BOMs with their component requirements
 */
router.get('/', async (req, res) => {
  const { active_only = 'true', limit = 1000, offset = 0 } = req.query;

  try {
    let query = supabase
      .from('boms')
      .select(`
        *,
        bom_components (
          id,
          component_id,
          qty_required,
          components (
            id,
            internal_sku,
            description,
            brand
          )
        )
      `, { count: 'exact' })
      .order('bundle_sku', { ascending: true });

    if (active_only === 'true') {
      query = query.eq('is_active', true);
    }

    const { data, error, count } = await query.range(
      parseInt(offset),
      parseInt(offset) + parseInt(limit) - 1
    );

    if (error) {
      console.error('BOMs fetch error:', error);
      return errors.internal(res, 'Failed to fetch BOMs');
    }

    sendSuccess(res, {
      boms: data,
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (err) {
    console.error('BOMs fetch error:', err);
    errors.internal(res, 'Failed to fetch BOMs');
  }
});

/**
 * GET /boms/:id
 * Get a single BOM with all details
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from('boms')
      .select(`
        *,
        bom_components (
          id,
          component_id,
          qty_required,
          components (
            id,
            internal_sku,
            description,
            brand,
            cost_ex_vat_pence
          )
        ),
        listing_memory (
          id,
          asin,
          sku,
          title_fingerprint,
          is_active
        )
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return errors.notFound(res, 'BOM');
      }
      console.error('BOM fetch error:', error);
      return errors.internal(res, 'Failed to fetch BOM');
    }

    // Calculate total cost
    const totalCostPence = (data.bom_components || []).reduce((sum, bc) => {
      return sum + ((bc.components?.cost_ex_vat_pence || 0) * bc.qty_required);
    }, 0);

    sendSuccess(res, {
      ...data,
      total_cost_pence: totalCostPence
    });
  } catch (err) {
    console.error('BOM fetch error:', err);
    errors.internal(res, 'Failed to fetch BOM');
  }
});

/**
 * POST /boms
 * Create a new BOM with components
 * ADMIN only
 */
router.post('/', requireAdmin, async (req, res) => {
  const { bundle_sku, description, components } = req.body;

  if (!bundle_sku) {
    return errors.badRequest(res, 'bundle_sku is required');
  }

  if (!components || !Array.isArray(components) || components.length === 0) {
    return errors.badRequest(res, 'At least one component is required');
  }

  // Validate components
  for (const comp of components) {
    if (!comp.component_id) {
      return errors.badRequest(res, 'Each component must have a component_id');
    }
    if (!comp.qty_required || comp.qty_required <= 0) {
      return errors.badRequest(res, 'Each component must have a positive qty_required');
    }
  }

  try {
    // Create BOM
    const { data: bom, error: bomError } = await supabase
      .from('boms')
      .insert({
        bundle_sku: bundle_sku.toUpperCase().trim(),
        description
      })
      .select()
      .single();

    if (bomError) {
      if (bomError.code === '23505') {
        return errors.conflict(res, 'A BOM with this SKU already exists');
      }
      console.error('BOM create error:', bomError);
      return errors.internal(res, 'Failed to create BOM');
    }

    // Create component lines
    const { error: linesError } = await supabase
      .from('bom_components')
      .insert(components.map(c => ({
        bom_id: bom.id,
        component_id: c.component_id,
        qty_required: c.qty_required
      })));

    if (linesError) {
      console.error('BOM components create error:', linesError);
      // Cleanup
      await supabase.from('boms').delete().eq('id', bom.id);
      return errors.internal(res, 'Failed to create BOM components');
    }

    // Fetch complete BOM
    const { data: fullBom, error: fetchError } = await supabase
      .from('boms')
      .select(`
        *,
        bom_components (
          id,
          component_id,
          qty_required,
          components (
            internal_sku,
            description
          )
        )
      `)
      .eq('id', bom.id)
      .single();

    if (fetchError) {
      console.error('BOM fetch error:', fetchError);
    }

    await auditLog({
      entityType: 'BOM',
      entityId: bom.id,
      action: 'CREATE',
      afterJson: fullBom || bom,
      changesSummary: `Created BOM ${bom.bundle_sku} with ${components.length} components`,
      ...getAuditContext(req)
    });

    sendSuccess(res, fullBom || bom, 201);
  } catch (err) {
    console.error('BOM create error:', err);
    errors.internal(res, 'Failed to create BOM');
  }
});

/**
 * PUT /boms/:id
 * Update a BOM
 * ADMIN only
 */
router.put('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { description, components, is_active } = req.body;

  try {
    // Get current state for audit
    const { data: current, error: fetchError } = await supabase
      .from('boms')
      .select(`
        *,
        bom_components (
          id,
          component_id,
          qty_required
        )
      `)
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return errors.notFound(res, 'BOM');
      }
      throw fetchError;
    }

    // Update BOM fields
    const updates = {};
    if (description !== undefined) updates.description = description;
    if (is_active !== undefined) updates.is_active = is_active;

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase
        .from('boms')
        .update(updates)
        .eq('id', id);

      if (updateError) {
        console.error('BOM update error:', updateError);
        return errors.internal(res, 'Failed to update BOM');
      }
    }

    // Update components if provided
    if (components && Array.isArray(components)) {
      // Delete existing components
      await supabase.from('bom_components').delete().eq('bom_id', id);

      // Insert new components
      if (components.length > 0) {
        const { error: linesError } = await supabase
          .from('bom_components')
          .insert(components.map(c => ({
            bom_id: id,
            component_id: c.component_id,
            qty_required: c.qty_required
          })));

        if (linesError) {
          console.error('BOM components update error:', linesError);
          return errors.internal(res, 'Failed to update BOM components');
        }
      }
    }

    // Fetch updated BOM
    const { data: updated, error: refetchError } = await supabase
      .from('boms')
      .select(`
        *,
        bom_components (
          id,
          component_id,
          qty_required,
          components (
            internal_sku,
            description
          )
        )
      `)
      .eq('id', id)
      .single();

    if (refetchError) {
      console.error('BOM refetch error:', refetchError);
    }

    await auditLog({
      entityType: 'BOM',
      entityId: id,
      action: 'UPDATE',
      beforeJson: current,
      afterJson: updated,
      changesSummary: `Updated BOM ${updated?.bundle_sku || id}`,
      ...getAuditContext(req)
    });

    sendSuccess(res, updated);
  } catch (err) {
    console.error('BOM update error:', err);
    errors.internal(res, 'Failed to update BOM');
  }
});

/**
 * GET /boms/:id/availability
 * Check how many of this BOM can be built with current stock
 */
router.get('/:id/availability', async (req, res) => {
  const { id } = req.params;
  const { location = 'Warehouse' } = req.query;

  try {
    const { data: bom, error } = await supabase
      .from('boms')
      .select(`
        id,
        bundle_sku,
        description,
        bom_components (
          component_id,
          qty_required,
          components (
            id,
            internal_sku,
            description
          )
        )
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return errors.notFound(res, 'BOM');
      }
      throw error;
    }

    // Get stock for all components
    const componentIds = (bom.bom_components || []).map(bc => bc.component_id);
    const { data: stock } = await supabase
      .from('component_stock')
      .select('component_id, on_hand, reserved')
      .in('component_id', componentIds)
      .eq('location', location);

    // Calculate availability for each component
    let minBuildable = Infinity;
    const componentAvailability = [];

    for (const bc of bom.bom_components || []) {
      const compStock = stock?.find(s => s.component_id === bc.component_id);
      const available = compStock ? (compStock.on_hand - compStock.reserved) : 0;
      const buildable = Math.floor(available / bc.qty_required);

      componentAvailability.push({
        component_id: bc.component_id,
        internal_sku: bc.components.internal_sku,
        description: bc.components.description,
        qty_required: bc.qty_required,
        available,
        buildable,
        is_constraint: buildable < minBuildable
      });

      minBuildable = Math.min(minBuildable, buildable);
    }

    // Mark the actual constraint
    for (const ca of componentAvailability) {
      ca.is_constraint = ca.buildable === minBuildable;
    }

    sendSuccess(res, {
      bom_id: bom.id,
      bundle_sku: bom.bundle_sku,
      location,
      buildable: minBuildable === Infinity ? 0 : minBuildable,
      components: componentAvailability
    });
  } catch (err) {
    console.error('BOM availability error:', err);
    errors.internal(res, 'Failed to check BOM availability');
  }
});

export default router;
