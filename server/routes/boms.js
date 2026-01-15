import express from 'express';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { requireAdmin, requireStaff } from '../middleware/auth.js';
import { auditLog, getAuditContext } from '../services/audit.js';

const router = express.Router();

/**
 * GET /boms/review
 * Returns BOMs that need review (auto-created ones)
 * Must be defined BEFORE /:id route
 */
router.get('/review', async (req, res) => {
  const { status = 'PENDING_REVIEW', limit = 50, offset = 0 } = req.query;

  try {
    // First, fetch BOMs with components
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
            brand,
            cost_ex_vat_pence,
            total_available
          )
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false });

    // Only filter by review_status if not 'ALL'
    // Handle case where column might not exist yet
    if (status !== 'ALL') {
      query = query.eq('review_status', status);
    }

    const { data: boms, error, count } = await query.range(
      parseInt(offset),
      parseInt(offset) + parseInt(limit) - 1
    );

    if (error) {
      // If error mentions 'review_status' column, the migration hasn't been run
      if (error.message?.includes('review_status') || error.code === '42703') {
        console.warn('BOM review_status column not found - migration 003 may need to be run');
        // Return empty result gracefully
        return sendSuccess(res, {
          boms: [],
          total: 0,
          limit: parseInt(limit),
          offset: parseInt(offset),
          warning: 'BOM review feature requires database migration. Please run migration 003_bom_review_status.sql'
        });
      }
      console.error('BOM review fetch error:', error);
      return errors.internal(res, `Failed to fetch BOM review queue: ${error.message}`);
    }

    // Fetch linked listings separately for each BOM (reverse relationship)
    const bomsWithListings = await Promise.all((boms || []).map(async (bom) => {
      const { data: listings } = await supabase
        .from('listing_memory')
        .select('id, asin, sku, title_fingerprint, is_active')
        .eq('bom_id', bom.id)
        .eq('is_active', true);

      return {
        ...bom,
        listing_memory: listings || []
      };
    }));

    sendSuccess(res, {
      boms: bomsWithListings,
      total: count || 0,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (err) {
    console.error('BOM review fetch error:', err);
    errors.internal(res, `Failed to fetch BOM review queue: ${err.message}`);
  }
});

/**
 * POST /boms/review/reset-all
 * Reset all APPROVED BOMs back to PENDING_REVIEW
 * ADMIN only
 */
router.post('/review/reset-all', requireAdmin, async (req, res) => {
  try {
    const { data: updated, error } = await supabase
      .from('boms')
      .update({
        review_status: 'PENDING_REVIEW',
        reviewed_at: null
      })
      .eq('review_status', 'APPROVED')
      .select('id, bundle_sku');

    if (error) {
      console.error('BOM reset error:', error);
      return errors.internal(res, `Failed to reset BOMs: ${error.message}`);
    }

    await auditLog({
      entityType: 'BOM',
      entityId: 'BULK',
      action: 'BULK_RESET',
      changesSummary: `Reset ${updated?.length || 0} BOMs from APPROVED to PENDING_REVIEW`,
      ...getAuditContext(req)
    });

    sendSuccess(res, {
      reset: true,
      count: updated?.length || 0,
      boms: updated || []
    });
  } catch (err) {
    console.error('BOM reset error:', err);
    errors.internal(res, `Failed to reset BOMs: ${err.message}`);
  }
});

/**
 * GET /boms/review/stats
 * Get BOM review queue statistics
 */
router.get('/review/stats', async (req, res) => {
  try {
    const [pending, approved, rejected] = await Promise.all([
      supabase.from('boms').select('*', { count: 'exact', head: true }).eq('review_status', 'PENDING_REVIEW'),
      supabase.from('boms').select('*', { count: 'exact', head: true }).eq('review_status', 'APPROVED'),
      supabase.from('boms').select('*', { count: 'exact', head: true }).eq('review_status', 'REJECTED')
    ]);

    sendSuccess(res, {
      pending: pending.count || 0,
      approved: approved.count || 0,
      rejected: rejected.count || 0
    });
  } catch (err) {
    console.error('BOM review stats error:', err);
    errors.internal(res, 'Failed to fetch BOM review statistics');
  }
});

/**
 * POST /boms/review/suggest-components
 * Analyze listing title/SKU and suggest matching components
 * Uses fuzzy matching on component SKUs, descriptions, and brands
 */
router.post('/review/suggest-components', async (req, res) => {
  const { listing_title, sku, asin, bundle_sku } = req.body;

  if (!listing_title && !sku && !bundle_sku) {
    return errors.badRequest(res, 'At least one of listing_title, sku, or bundle_sku is required');
  }

  try {
    // Fetch all components for matching
    const { data: components, error: compError } = await supabase
      .from('components')
      .select('id, internal_sku, description, brand, cost_ex_vat_pence')
      .eq('is_active', true);

    if (compError) {
      console.error('Component fetch error:', compError);
      return errors.internal(res, 'Failed to fetch components');
    }

    // Build searchable text from inputs
    const searchText = [
      listing_title || '',
      sku || '',
      bundle_sku || ''
    ].join(' ').toLowerCase();

    // Score each component based on keyword matches
    const suggestions = [];

    for (const comp of components || []) {
      let score = 0;
      const matchReasons = [];

      // Extract keywords from component
      const skuParts = (comp.internal_sku || '').toLowerCase().split(/[-_\s]+/);
      const descParts = (comp.description || '').toLowerCase().split(/[-_\s,]+/).filter(w => w.length > 2);
      const brandLower = (comp.brand || '').toLowerCase();

      // Match SKU parts (highest value)
      for (const part of skuParts) {
        if (part.length >= 3 && searchText.includes(part)) {
          score += 30;
          matchReasons.push(`SKU part "${part}" matched`);
        }
      }

      // Match brand (high value)
      if (brandLower && brandLower.length > 2 && searchText.includes(brandLower)) {
        score += 25;
        matchReasons.push(`Brand "${comp.brand}" matched`);
      }

      // Match description keywords
      for (const word of descParts) {
        if (searchText.includes(word)) {
          score += 10;
          matchReasons.push(`Keyword "${word}" matched`);
        }
      }

      // Check for common product patterns
      // Battery patterns: 6.0Ah, 5.0Ah, 4.0Ah, 3.0Ah, 2.0Ah, BL1860, BL1850, etc.
      const batteryPatterns = [
        /(\d\.?\d?\s*ah)/gi,
        /bl\d{4}/gi,
        /battery|batteries|batt/gi
      ];
      const batteryMatch = batteryPatterns.some(p => p.test(comp.description || comp.internal_sku));
      const searchHasBattery = batteryPatterns.some(p => p.test(searchText));
      if (batteryMatch && searchHasBattery) {
        // Check for capacity match
        const compCapacity = (comp.description || '').match(/(\d\.?\d?)\s*ah/i);
        const searchCapacity = searchText.match(/(\d\.?\d?)\s*ah/i);
        if (compCapacity && searchCapacity && compCapacity[1] === searchCapacity[1]) {
          score += 40;
          matchReasons.push(`Battery capacity ${compCapacity[0]} matched`);
        }
      }

      // Check for tool/charger type patterns
      const toolPatterns = /dhr|dga|dhp|dtd|dcf|dcd|dc18|charger/gi;
      if (toolPatterns.test(comp.internal_sku) && toolPatterns.test(searchText)) {
        score += 20;
        matchReasons.push('Tool type pattern matched');
      }

      // Check for quantity indicators like "x2", "2x", "twin", "pair"
      const quantityPatterns = /(\d)\s*x\s*|x\s*(\d)|twin|pair|double|triple/gi;
      const quantityMatch = searchText.match(quantityPatterns);

      if (score > 0) {
        suggestions.push({
          component_id: comp.id,
          internal_sku: comp.internal_sku,
          description: comp.description,
          brand: comp.brand,
          cost_ex_vat_pence: comp.cost_ex_vat_pence,
          score,
          match_reasons: [...new Set(matchReasons)],
          suggested_qty: quantityMatch ? 2 : 1
        });
      }
    }

    // Sort by score descending, take top 10
    suggestions.sort((a, b) => b.score - a.score);
    const topSuggestions = suggestions.slice(0, 10);

    sendSuccess(res, {
      suggestions: topSuggestions,
      search_text: searchText.substring(0, 200),
      total_matches: suggestions.length
    });
  } catch (err) {
    console.error('Component suggestion error:', err);
    errors.internal(res, `Failed to suggest components: ${err.message}`);
  }
});

/**
 * GET /boms
 * Returns all BOMs with their component requirements
 */
router.get('/', async (req, res) => {
  const { active_only = 'true', limit = 99999, offset = 0 } = req.query;

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
    // Validate all component IDs exist and are active
    const componentIds = components.map(c => c.component_id);
    const { data: existingComponents, error: compCheckError } = await supabase
      .from('components')
      .select('id, internal_sku, is_active')
      .in('id', componentIds);

    if (compCheckError) {
      console.error('Component validation error:', compCheckError);
      return errors.internal(res, 'Failed to validate components');
    }

    const existingIds = new Set((existingComponents || []).map(c => c.id));
    const inactiveComponents = (existingComponents || []).filter(c => !c.is_active);
    const missingIds = componentIds.filter(id => !existingIds.has(id));

    if (missingIds.length > 0) {
      return errors.badRequest(res, `Component IDs not found: ${missingIds.join(', ')}`);
    }

    if (inactiveComponents.length > 0) {
      return errors.badRequest(res, `Components are inactive: ${inactiveComponents.map(c => c.internal_sku).join(', ')}`);
    }

    // Create BOM with PENDING_REVIEW status (requires admin approval)
    const { data: bom, error: bomError } = await supabase
      .from('boms')
      .insert({
        bundle_sku: bundle_sku.toUpperCase().trim(),
        description,
        review_status: 'PENDING_REVIEW'
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

      // CASCADE: If deactivating BOM, also deactivate linked listings
      if (is_active === false && current.is_active === true) {
        const { error: cascadeError } = await supabase
          .from('listing_memory')
          .update({ is_active: false })
          .eq('bom_id', id);

        if (cascadeError) {
          console.warn('Failed to cascade BOM deactivation to listings:', cascadeError);
        }
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
 * POST /boms/:id/approve
 * Approve a BOM from the review queue
 * ADMIN only
 */
router.post('/:id/approve', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { components, description } = req.body;

  try {
    // Get current BOM
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

    // Determine which components to use (provided or existing)
    const componentsToValidate = components && Array.isArray(components) && components.length > 0
      ? components
      : (current.bom_components || []).map(bc => ({
          component_id: bc.component_id,
          qty_required: bc.qty_required
        }));

    if (componentsToValidate.length === 0) {
      return errors.badRequest(res, 'Cannot approve BOM with no components');
    }

    // Validate all component IDs exist and are active
    const componentIds = componentsToValidate.map(c => c.component_id);
    const { data: existingComponents, error: compCheckError } = await supabase
      .from('components')
      .select('id, internal_sku, is_active, cost_ex_vat_pence')
      .in('id', componentIds);

    if (compCheckError) {
      console.error('Component validation error:', compCheckError);
      return errors.internal(res, 'Failed to validate components');
    }

    const existingIds = new Set((existingComponents || []).map(c => c.id));
    const inactiveComponents = (existingComponents || []).filter(c => !c.is_active);
    const missingIds = componentIds.filter(id => !existingIds.has(id));
    const missingCostComponents = (existingComponents || []).filter(c => !c.cost_ex_vat_pence || c.cost_ex_vat_pence <= 0);

    if (missingIds.length > 0) {
      return errors.badRequest(res, `Cannot approve: component IDs not found: ${missingIds.join(', ')}`);
    }

    if (inactiveComponents.length > 0) {
      return errors.badRequest(res, `Cannot approve: components are inactive: ${inactiveComponents.map(c => c.internal_sku).join(', ')}`);
    }

    if (missingCostComponents.length > 0) {
      return errors.badRequest(res, `Cannot approve: components missing cost data: ${missingCostComponents.map(c => c.internal_sku).join(', ')}`);
    }

    // Update components if provided (user edited them)
    if (components && Array.isArray(components) && components.length > 0) {
      // Delete existing components
      await supabase.from('bom_components').delete().eq('bom_id', id);

      // Insert new components
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

    // Update BOM status to APPROVED
    const updates = {
      review_status: 'APPROVED',
      reviewed_at: new Date().toISOString()
    };
    if (description !== undefined) {
      updates.description = description;
    }

    const { error: updateError } = await supabase
      .from('boms')
      .update(updates)
      .eq('id', id);

    if (updateError) {
      console.error('BOM approve error:', updateError);
      return errors.internal(res, 'Failed to approve BOM');
    }

    // Fetch updated BOM
    const { data: updated } = await supabase
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

    await auditLog({
      entityType: 'BOM',
      entityId: id,
      action: 'APPROVE',
      beforeJson: current,
      afterJson: updated,
      changesSummary: `Approved BOM ${updated?.bundle_sku || id}`,
      ...getAuditContext(req)
    });

    sendSuccess(res, { approved: true, bom: updated });
  } catch (err) {
    console.error('BOM approve error:', err);
    errors.internal(res, 'Failed to approve BOM');
  }
});

/**
 * POST /boms/:id/reject
 * Reject a BOM from the review queue
 * ADMIN only
 */
router.post('/:id/reject', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  try {
    // Get current BOM
    const { data: current, error: fetchError } = await supabase
      .from('boms')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return errors.notFound(res, 'BOM');
      }
      throw fetchError;
    }

    // Update BOM status to REJECTED and deactivate
    const { error: updateError } = await supabase
      .from('boms')
      .update({
        review_status: 'REJECTED',
        reviewed_at: new Date().toISOString(),
        is_active: false,
        rejection_reason: reason
      })
      .eq('id', id);

    if (updateError) {
      console.error('BOM reject error:', updateError);
      return errors.internal(res, 'Failed to reject BOM');
    }

    // Also deactivate any listing_memory entries pointing to this BOM
    await supabase
      .from('listing_memory')
      .update({ is_active: false })
      .eq('bom_id', id);

    await auditLog({
      entityType: 'BOM',
      entityId: id,
      action: 'REJECT',
      beforeJson: current,
      changesSummary: `Rejected BOM ${current?.bundle_sku || id}: ${reason || 'No reason given'}`,
      ...getAuditContext(req)
    });

    sendSuccess(res, { rejected: true });
  } catch (err) {
    console.error('BOM reject error:', err);
    errors.internal(res, 'Failed to reject BOM');
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
